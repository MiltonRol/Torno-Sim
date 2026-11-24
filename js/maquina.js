// maquina.js — EL MOCK: un torno paralelo simulado dentro del navegador (estados, rampas, corte y alarmas).
// Va separado de las vistas a propósito: la "máquina" no sabe nada de WebGL ni del DOM. El gemelo 3D y la
// botonera la LEEN en vivo; la telemetría y el registro reciben sus datos a través del enlace remoto simulado
// (remoto.js), como pasaría con una máquina de verdad al otro lado de la red.
(() => {
  const { animate, createTimer } = anime;
  const { clamp, num, entero } = window.Torno;

  // ---------- datos de la máquina (mm, s, rpm) ----------
  const PIEZA = { L: 140, R: 25, N: 400 };   // voladizo 140 mm, barra bruta Ø50, perfil en 400 muestras
  const DZ = PIEZA.L / PIEZA.N;              // 0,35 mm por muestra
  const PASO = { z: 24, x: 2, c: 4 };        // mm que avanza cada eje por VUELTA de su volante
  const DIV = { z: 120, x: 100, c: 40 };     // divisiones del tambor graduado de cada volante
  const RPM_MAX = 2000;
  const Q_MAX = 6000;                        // mm³/s de viruta que equivalen al 100 % de carga (escala de maqueta)
  const ANCHO_HTA = 1.2;                     // mm de filo de la cuchilla que toca la pieza
  const CONTACTO = 85;                       // caña (mm) con la que el punto del contrapunto toca la cara de la pieza
  const LIM = { zMin: -PIEZA.L + 4, zMax: 70, xMin: 4, xMax: 45 };
  // Coordenadas como en el visualizador de cotas de un torno: Z = 0 en la cara de la pieza (negativo hacia
  // el plato) y X = RADIO de la punta de la herramienta (en pantalla se muestra el diámetro, 2·X).

  function crearMaquina({ reducido = false } = {}) {
    // ---- emisor de eventos mínimo: on(tipo, fn) devuelve la función para darse de baja ----
    const oyentes = new Map();
    const on = (tipo, fn) => {
      if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
      oyentes.get(tipo).add(fn);
      return () => oyentes.get(tipo)?.delete(fn);
    };
    const emitir = (tipo, datos) => oyentes.get(tipo)?.forEach((fn) => {
      try { fn(datos); } catch (err) { console.error('[maquina:' + tipo + ']', err); }   // un oyente roto no para la máquina
    });
    const evento = (nivel, texto) => emitir('evento', { nivel, texto, t: Date.now() });
    // Las órdenes del operario (o del panel remoto) se anuncian: el ciclo demo se cancela si alguien toca algo.
    const avisarOrden = (origen, tipo) => { if (origen === 'operario' || origen === 'remoto') emitir('orden', { origen, tipo }); };

    // ---- ESTADO: un único objeto que leen las vistas (no se modifica desde fuera) ----
    const e = {
      t: 0, prueba: false, referenciando: false,
      husillo: { rampa: 0, rpm: 0, consigna: 800, sentido: 1, angulo: 0, marcha: false },
      ejes: { z: 30, x: 32, c: 0 },
      avance: { auto: false, f: 0.2 },
      refrigerante: { on: false, caudal: 0 },          // caudal 0..1 lo anima Anime.js (la bomba "arranca")
      luz: { on: true, nivel: 1 },
      protector: { cerrado: true, apertura: 0 },       // apertura 0..1 animada: el gemelo gira la tapa con ella
      plato: { cerrado: true, apertura: 0 },           // garras: 0 apretadas … 1 abiertas
      seta: false, alarma: null,
      carga: 0, potencia: 0, temp: 23,
      etapa: 0, apoyo: false, ocupado: false,
      pieza: { radios: new Float32Array(PIEZA.N).fill(PIEZA.R), mec: new Float32Array(PIEZA.N), version: 0,
        numero: 1, quitado: 0, entrada: 0, salida: 0 },
      cont: { piezas: 0, husilloS: 0, viruta: 0 },
    };

    // ---- etapas del GRAFCET: 0 reposo · 1 husillo en marcha · 2 avance automático · 3 emergencia/alarma ----
    let motivo = 'Encendido';
    function actualizarEtapa(m) {
      if (m) motivo = m;
      const nueva = e.seta || e.alarma ? 3 : e.husillo.marcha && e.avance.auto ? 2 : e.husillo.marcha ? 1 : 0;
      if (nueva !== e.etapa) {
        const de = e.etapa; e.etapa = nueva;
        emitir('etapa', { de, a: nueva, motivo, t: Date.now() });
      }
    }

    // ---- rampa del variador: Anime.js anima un número (rpm con signo) y la simulación lo lee ----
    // Con signo para que invertir el giro sea una rampa continua que pasa por cero, como un variador real.
    let animRampa = null;
    function rampa(rapida = false) {
      const destino = e.husillo.marcha ? e.husillo.sentido * e.husillo.consigna : 0;
      animRampa?.cancel();
      const delta = Math.abs(destino - e.husillo.rampa);
      if (delta < 0.5) { e.husillo.rampa = destino; return; }
      animRampa = animate(e.husillo, {
        rampa: destino,
        duration: rapida ? 420 : Math.max(300, (delta / RPM_MAX) * 1800),   // 0 → 2000 rpm en 1,8 s
        ease: rapida ? 'out(2)' : 'inOut(2)',                                // rampa en S (sin tirones)
      });
    }

    function comprobarArranque() {
      if (e.seta) return { causa: 'seta', texto: 'la seta de emergencia está pulsada' };
      if (e.alarma) return { causa: 'rearme', texto: 'hay una alarma activa: pulsa Rearme' };
      if (!e.protector.cerrado) return { causa: 'protector', texto: 'el protector del plato está abierto' };
      if (!e.plato.cerrado) return { causa: 'plato', texto: 'el plato está abierto (pieza sin amarrar)' };
      if (e.ocupado) return { causa: 'barra', texto: 'hay un cambio de barra en curso' };
      return null;
    }
    // Un enclavamiento avisa a la botonera (para señalar el mando culpable) y deja constancia en el registro
    function enclavamiento(c, prefijo) { emitir('enclavamiento', c); evento('aviso', prefijo + c.texto); }

    // ---------- ÓRDENES (las llaman la botonera, las manivelas, el panel remoto y el ciclo demo) ----------
    const ordenes = {
      marcha(origen = 'operario') {
        avisarOrden(origen, 'marcha');
        if (e.husillo.marcha) return true;
        const bloqueo = comprobarArranque();
        if (bloqueo) { enclavamiento(bloqueo, 'No arranca: '); return false; }
        e.husillo.marcha = true; rampa();
        evento('info', 'Marcha: husillo ' + (e.husillo.sentido > 0 ? 'a derechas (M3)' : 'a izquierdas (M4)') + ' a ' + entero(e.husillo.consigna) + ' rpm');
        actualizarEtapa('Marcha');
        return true;
      },
      paro(origen = 'operario') {
        avisarOrden(origen, 'paro');
        if (!e.husillo.marcha) return false;
        e.husillo.marcha = false; e.avance.auto = false; rampa();
        evento('info', origen === 'remoto' ? 'Paro REMOTO recibido desde el panel' : origen === 'demo' ? 'Paro: fin del ciclo demo' : 'Paro');
        actualizarEtapa(origen === 'remoto' ? 'Paro remoto' : 'Paro');
        return true;
      },
      seta(pulsada, origen = 'operario') {
        avisarOrden(origen, 'seta');
        if (pulsada === e.seta) return;
        e.seta = pulsada;
        if (pulsada) {
          const giraba = Math.abs(e.husillo.rampa) > 1;
          e.alarma = { codigo: 'E-STOP', texto: 'Seta de emergencia' };
          e.husillo.marcha = false; e.avance.auto = false; rampa(true);   // frenado rápido
          pararMovimientos();
          if (e.refrigerante.on) ordenes.refrigerante(false, 'maquina');
          evento('alarma', 'SETA DE EMERGENCIA pulsada' + (giraba ? ': frenado rápido del husillo' : ''));
          actualizarEtapa('Seta');
        } else evento('aviso', 'Seta desenclavada: pulsa Rearme para volver a reposo');
      },
      rearme(origen = 'operario') {
        avisarOrden(origen, 'rearme');
        if (e.seta) { enclavamiento({ causa: 'seta', texto: 'desenclava antes la seta de emergencia' }, 'No se puede rearmar: '); return false; }
        if (!e.alarma) { evento('info', 'Rearme: no había ninguna alarma'); return false; }
        e.alarma = null;
        evento('ok', 'Rearme: máquina en reposo y lista');
        actualizarEtapa('Rearme');
        return true;
      },
      // "anunciar" = true al soltar el deslizador: así el registro no recibe un evento por cada paso
      consigna(rpm, origen = 'operario', anunciar = false) {
        avisarOrden(origen, 'consigna');
        e.husillo.consigna = clamp(Math.round(rpm), 50, RPM_MAX);
        if (e.husillo.marcha) rampa();
        if (anunciar) evento('info', 'Consigna de velocidad: ' + entero(e.husillo.consigna) + ' rpm');
      },
      sentido(s, origen = 'operario') {
        avisarOrden(origen, 'sentido');
        const nuevo = s > 0 ? 1 : -1;
        if (nuevo === e.husillo.sentido) return;
        e.husillo.sentido = nuevo;
        const texto = nuevo > 0 ? 'M3 (a derechas)' : 'M4 (a izquierdas)';
        if (e.husillo.marcha) { rampa(); evento('info', 'Inversión de giro con rampa: ' + texto); }
        else evento('info', 'Sentido de giro: ' + texto);
      },
      refrigerante(on, origen = 'operario') {
        avisarOrden(origen, 'refrigerante');
        if (on === e.refrigerante.on) return;
        e.refrigerante.on = on;
        animate(e.refrigerante, { caudal: on ? 1 : 0, duration: on ? 600 : 400, ease: 'out(2)' });
        evento('info', on ? 'Taladrina: bomba en marcha' : 'Taladrina: bomba parada');
      },
      luz(on, origen = 'operario') {
        avisarOrden(origen, 'luz');
        if (on === e.luz.on) return;
        e.luz.on = on;
        // Al encender, el parpadeo de una lámpara que arranca (keyframes); al apagar, una caída corta.
        animate(e.luz, on ? { nivel: [0, 0.9, 0.3, 1], duration: 650, ease: 'linear' } : { nivel: 0, duration: 250 });
        evento('info', on ? 'Lámpara de trabajo encendida' : 'Lámpara de trabajo apagada');
      },
      protector(cerrado, origen = 'operario') {
        avisarOrden(origen, 'protector');
        if (cerrado === e.protector.cerrado) return;
        e.protector.cerrado = cerrado;
        animate(e.protector, { apertura: cerrado ? 0 : 1, duration: 800, ease: 'inOut(3)' });
        if (!cerrado && e.husillo.marcha) {
          // Abrir la protección con el plato girando = paro de seguridad (el interruptor de la tapa corta la marcha)
          e.husillo.marcha = false; e.avance.auto = false; rampa(true);
          evento('aviso', 'Protector abierto con el husillo en marcha: PARO DE SEGURIDAD');
          actualizarEtapa('Protector abierto');
        } else evento('info', cerrado ? 'Protector del plato cerrado' : 'Protector del plato abierto');
      },
      plato(cerrado, origen = 'operario') {
        avisarOrden(origen, 'plato');
        if (cerrado === e.plato.cerrado) return true;
        if (!cerrado && (e.husillo.marcha || Math.abs(e.husillo.rpm) > 5)) {
          enclavamiento({ causa: 'plato', texto: 'el husillo está girando' }, 'No se puede abrir el plato: ');
          return false;
        }
        e.plato.cerrado = cerrado;
        animate(e.plato, { apertura: cerrado ? 0 : 1, duration: 650, ease: cerrado ? 'out(3)' : 'inOut(2)' });
        if (origen !== 'maquina') evento('info', cerrado ? 'Plato cerrado: pieza amarrada' : 'Plato abierto: pieza suelta');
        return true;
      },
      avance(on, origen = 'operario') {
        avisarOrden(origen, 'avance');
        if (on === e.avance.auto) return true;
        if (on && !e.husillo.marcha) { enclavamiento({ causa: 'avance', texto: 'arranca antes el husillo (el avance va engranado a él)' }, 'Avance no embragado: '); return false; }
        if (on && e.ejes.z <= LIM.zMin + 0.05) { enclavamiento({ causa: 'avance', texto: 'el carro ya está en el tope Z−' }, 'Avance no embragado: '); return false; }
        e.avance.auto = on;
        evento('info', on ? 'Avance automático embragado: ' + num(e.avance.f, 2) + ' mm/rev hacia el plato' : 'Avance automático desembragado');
        actualizarEtapa(on ? 'Avance ON' : 'Avance OFF');
        return true;
      },
      fijarAvance(f, origen = 'operario') {
        avisarOrden(origen, 'avance');
        if (f === e.avance.f) return;
        e.avance.f = f;
        evento('info', 'Avance por vuelta: ' + num(f, 2) + ' mm/rev');
      },
    };

    // ---------- EJES Y CORTE ----------
    // Límites de cada eje. El carro no puede chocar con el punto del contrapunto (deja 8 mm) y la caña
    // no puede pasar de la cara de la pieza (CONTACTO).
    // Devuelve [mínimo, máximo, qué limita el máximo] (el tercer dato sirve para explicar el tope al operario)
    function limites(eje) {
      if (eje === 'z') { const pc = CONTACTO - 8 - e.ejes.c; return pc < LIM.zMax ? [LIM.zMin, pc, 'contrapunto'] : [LIM.zMin, LIM.zMax, 'recorrido']; }
      if (eje === 'x') return [LIM.xMin, LIM.xMax, 'recorrido'];
      const pz = CONTACTO - 8 - e.ejes.z;
      return pz < CONTACTO ? [0, Math.max(0, pz), 'carro'] : [0, CONTACTO, 'pieza'];
    }
    const TOPES = {
      'z-min': 'Tope Z−: la cuchilla no puede acercarse más a las garras',
      'z-recorrido': 'Tope Z+: fin del recorrido del carro',
      'z-contrapunto': 'El carro topa con el punto del contrapunto: recoge antes la caña',
      'x-min': 'Tope X−: diámetro mínimo Ø8 (no se tronza la pieza)',
      'x-recorrido': 'Tope X+: fin del recorrido del transversal',
      'c-min': 'La caña ya está recogida del todo',
      'c-carro': 'La caña topa con el carro: aparta antes el carro hacia el plato',
    };

    let volTick = 0, sobrecargaT = 0, ultimoBloqueo = 0, ultimoTope = 0;
    // Material bajo el filo: las muestras del perfil que caen dentro de [z − ancho/2, z + ancho/2].
    // Si sobresalen por encima de x, se cortan (radio = x) y se cuenta el volumen quitado (corona circular).
    function cortar(z, x) {
      const P = e.pieza;
      if (e.ocupado) return 'libre';                 // durante el cambio de barra no hay pieza
      const i0 = Math.max(0, Math.floor((z - ANCHO_HTA / 2 + PIEZA.L) / DZ));
      const i1 = Math.min(PIEZA.N - 1, Math.floor((z + ANCHO_HTA / 2 + PIEZA.L) / DZ));
      if (i0 > i1) return 'libre';
      let rmax = 0;
      for (let i = i0; i <= i1; i++) rmax = Math.max(rmax, P.radios[i]);
      if (rmax <= x + 1e-4) return 'libre';
      // Toca material: sin giro (o con la pieza suelta) la cuchilla NO corta, se queda apoyada
      if (Math.abs(e.husillo.rpm) < 30 || !e.plato.cerrado) return 'bloqueo';
      let vol = 0;
      for (let i = i0; i <= i1; i++) {
        const r = P.radios[i];
        if (r > x) { vol += Math.PI * (r * r - x * x) * DZ; P.radios[i] = x; P.mec[i] = 1; }
      }
      P.version++; P.quitado += vol; e.cont.viruta += vol; volTick += vol;
      emitir('corte', { z, x, r: rmax, vol });       // el gemelo lanza virutas con esto
      return 'corta';
    }

    function avisoBloqueo() {
      const ahora = performance.now();
      if (ahora - ultimoBloqueo < 1800) return;      // sin inundar el registro mientras se gira el volante
      ultimoBloqueo = ahora;
      const c = !e.plato.cerrado
        ? { causa: 'plato', texto: 'la pieza está suelta (plato abierto)' }
        : { causa: 'marcha', texto: 'la cuchilla toca la pieza con el husillo parado: arranca para cortar' };
      enclavamiento(c, 'Avance bloqueado: ');
    }
    function avisoTope(eje, motivoTope) {
      const texto = TOPES[eje + '-' + motivoTope];
      if (!texto) return;                            // 'c-pieza' = punto apoyado: ya lo cuenta comprobarApoyo()
      const ahora = performance.now();
      if (ahora - ultimoTope < 2000) return;
      ultimoTope = ahora;
      emitir('tope', { eje, motivo: motivoTope });
      evento('aviso', texto);
    }
    function comprobarApoyo() {
      const apoyo = e.ejes.c >= CONTACTO - 0.01;
      if (apoyo !== e.apoyo) { e.apoyo = apoyo; evento('info', apoyo ? 'Contrapunto apoyado en la pieza' : 'Contrapunto retirado'); }
    }

    // Mueve un eje hasta "valor" respetando topes y material. Recorre el trayecto en pasos de 0,2 mm para
    // no "saltarse" material si el volante gira rápido. Devuelve la posición a la que llegó de verdad.
    function moverA(eje, valor, origen = 'operario') {
      if (origen === 'operario' || origen === 'remoto') avisarOrden(origen, 'mover');
      const [mn, mx, porQue] = limites(eje);
      const destino = clamp(valor, mn, mx);
      const antes = e.ejes[eje];
      if (valor !== destino && origen === 'operario') avisoTope(eje, valor < mn ? 'min' : porQue);
      if (Math.abs(destino - antes) < 1e-7) return antes;
      if (eje === 'c') { e.ejes.c = destino; comprobarApoyo(); return destino; }
      const pasos = Math.max(1, Math.ceil(Math.abs(destino - antes) / 0.2));
      for (let k = 1; k <= pasos; k++) {
        const v = antes + ((destino - antes) * k) / pasos;
        if (cortar(eje === 'z' ? v : e.ejes.z, eje === 'x' ? v : e.ejes.x) === 'bloqueo') { avisoBloqueo(); break; }
        e.ejes[eje] = v;
      }
      return e.ejes[eje];
    }

    // Movimiento SIMULTÁNEO de Z y X (interpolación lineal, como un G01 de CNC): se avanza en pasitos de
    // 0,1 mm por la recta. Si se moviera primero un eje y luego el otro en cada fotograma, en un cono la
    // punta "escalonaría": se comería material de más (cono que sube) o dejaría crestas (cono que baja).
    function moverZX(z, x, origen) {
      const [zMn, zMx] = limites('z'), [xMn, xMx] = limites('x');
      const z1 = clamp(z, zMn, zMx), x1 = clamp(x, xMn, xMx), z0 = e.ejes.z, x0 = e.ejes.x;
      const pasos = Math.max(1, Math.ceil(Math.max(Math.abs(z1 - z0), Math.abs(x1 - x0)) / 0.1));
      for (let k = 1; k <= pasos; k++) {
        const zk = z0 + ((z1 - z0) * k) / pasos, xk = x0 + ((x1 - x0) * k) / pasos;
        if (cortar(zk, xk) === 'bloqueo') { avisoBloqueo(); break; }
        e.ejes.z = zk; e.ejes.x = xk;
      }
    }

    // Movimiento suave de varios ejes a la vez (ciclo demo, botones ±, referencia): Anime.js anima un objeto
    // "fantasma" y en cada fotograma se le pide a la máquina que vaya ahí (ella decide topes y cortes).
    const movimientos = new Set();
    function irA(destino, ms, origen = 'demo', ease = 'inOut(2)') {
      const fantasma = { z: e.ejes.z, x: e.ejes.x, c: e.ejes.c };
      const claves = Object.keys(destino);
      const anim = animate(fantasma, {
        ...destino, duration: Math.max(1, ms), ease,
        onUpdate: () => {
          if (claves.includes('z') && claves.includes('x')) {
            moverZX(fantasma.z, fantasma.x, origen);                              // Z y X a la vez: por la recta
            if (claves.includes('c')) moverA('c', fantasma.c, origen);
          } else for (const k of claves) moverA(k, fantasma[k], origen);
        },
        onComplete: () => movimientos.delete(anim),
      });
      movimientos.add(anim);
      return anim;
    }
    function pararMovimientos() { movimientos.forEach((a) => a.cancel()); movimientos.clear(); }

    function sobrecarga() {
      e.alarma = { codigo: 'SOBRECARGA', texto: 'Sobrecarga del husillo' };
      e.husillo.marcha = false; e.avance.auto = false; rampa(true); pararMovimientos(); sobrecargaT = 0;
      evento('alarma', 'SOBRECARGA del husillo (' + entero(e.carga) + ' %): pasada demasiado profunda o avance excesivo');
      emitir('enclavamiento', { causa: 'rearme', texto: 'sobrecarga' });
      actualizarEtapa('Sobrecarga');
    }

    // ---------- BUCLE DE SIMULACIÓN (lo llama un createTimer, ver abajo) ----------
    function tick(dt) {
      if (dt <= 0) return;
      e.t += dt;
      const H = e.husillo;
      H.rpm = H.rampa * (1 - 0.1 * Math.min(e.carga / 100, 1.5));   // el motor "cae" un poco al cargarlo
      const rps = H.rpm / 60;
      H.angulo = (H.angulo + rps * dt * Math.PI * 2) % (Math.PI * 2000);
      const girando = Math.abs(H.rpm) > 30;

      // Avance automático: el carro va hacia el plato a f mm por vuelta (engranado al husillo)
      if (e.avance.auto && girando) {
        const antes = e.ejes.z;
        moverA('z', e.ejes.z - e.avance.f * Math.abs(rps) * dt, 'auto');
        const enTope = e.ejes.z <= LIM.zMin + 1e-3;
        if (enTope || e.ejes.z === antes) {
          e.avance.auto = false;
          evento('aviso', enTope ? 'Fin de carrera Z−: avance automático desembragado' : 'Avance detenido: el carro no puede seguir');
          actualizarEtapa('Fin de carrera');
        }
      }

      // Carga del husillo: rozamiento propio + viruta arrancada por segundo, con un filtro de 0,25 s
      const q = volTick / dt; volTick = 0;
      const objetivo = (girando ? 3 + (5 * Math.abs(H.rpm)) / RPM_MAX : 0) + (q / Q_MAX) * 100;
      e.carga += (objetivo - e.carga) * Math.min(1, dt / 0.25);
      if (e.carga > 115 && !e.alarma) { sobrecargaT += dt; if (sobrecargaT > 0.7) sobrecarga(); }
      else sobrecargaT = Math.max(0, sobrecargaT - dt);
      e.potencia = 0.075 * e.carga;                                   // motor de 7,5 kW

      // Temperatura del cabezal: sube despacio con las rpm y la carga (constante de tiempo de 30 s)
      const tObjetivo = 23 + (26 * Math.abs(H.rpm)) / RPM_MAX + 0.08 * e.carga;
      e.temp += (tObjetivo - e.temp) * Math.min(1, dt / 30);
      if (girando) e.cont.husilloS += dt;
      actualizarEtapa();
    }
    // Un único reloj para la simulación. dt acotado por los dos lados: el primer tick puede traer un delta
    // negativo o enorme (y tras volver a la pestaña, uno gigante) y la simulación daría un salto.
    const reloj = createTimer({ onUpdate: (t) => tick(clamp((t.deltaTime || 0) / 1000, 0, 1 / 30)) });

    // ---------- CAMBIO DE BARRA (secuencia asíncrona) ----------
    const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
    // Espera a una animación, pero con un máximo: si alguien la cancela (seta), la secuencia no se queda colgada
    const esperarAnim = (anim, ms) => Promise.race([anim, pausa(ms + 300)]);
    async function nuevaBarra(origen = 'operario') {
      avisarOrden(origen, 'barra');
      if (e.ocupado) return false;
      if (e.husillo.marcha || Math.abs(e.husillo.rpm) > 5) {
        enclavamiento({ causa: 'barra', texto: 'para antes el husillo' }, 'No se puede cambiar la barra: ');
        return false;
      }
      e.ocupado = true;
      const P = e.pieza, terminada = P.quitado > 300, rapido = reducido ? 0.15 : 1;
      evento('info', 'Cambio de barra: se retira la pieza nº ' + P.numero);
      try {
        if (e.ejes.c > 0 || e.ejes.x < 30) await esperarAnim(irA({ x: Math.max(e.ejes.x, 30), c: 0 }, 500 * rapido, 'maquina'), 500);
        ordenes.plato(false, 'maquina');
        await pausa(650 * rapido);
        await esperarAnim(animate(P, { salida: 1, duration: 700 * rapido, ease: 'in(2)' }), 700);   // sale hacia el operario
        if (terminada) {
          e.cont.piezas++;
          evento('ok', 'Pieza nº ' + P.numero + ' terminada (' + num(P.quitado / 1000, 1) + ' cm³ de viruta)');
        }
        P.radios.fill(PIEZA.R); P.mec.fill(0); P.version++; P.quitado = 0; P.numero++;
        P.salida = 0; P.entrada = -PIEZA.L;
        await esperarAnim(animate(P, { entrada: 0, duration: 900 * rapido, ease: 'out(3)' }), 900);   // barra pasante
        ordenes.plato(true, 'maquina');
        await pausa(600 * rapido);
        evento('ok', 'Barra nueva amarrada: pieza nº ' + P.numero + ' (Ø50 × 140)');
      } finally { e.ocupado = false; }
      return true;
    }

    // ---------- encendido: prueba de lámparas y búsqueda de referencia ----------
    // Se llama desde main.js cuando ya están todos los módulos escuchando (si no, los eventos se perderían).
    function encender() {
      evento('info', 'Máquina TR-01 encendida');
      if (reducido) { evento('ok', 'Referencia de ejes completada: máquina lista'); return; }
      e.prueba = true;
      setTimeout(() => { e.prueba = false; }, 1200);
      e.ejes.z = LIM.zMax; e.ejes.x = LIM.xMax; e.referenciando = true;
      evento('info', 'Prueba de lámparas y búsqueda de referencia de X y Z');
      irA({ z: 30, x: 32 }, 2000, 'maquina', 'inOut(3)').then(() => {
        e.referenciando = false;
        evento('ok', 'Referencia de ejes completada: máquina lista');
      });
    }

    // Foto "plana" del estado para la telemetría remota (copia: el que la recibe no toca la máquina)
    function instantanea() {
      return {
        t: e.t, etapa: e.etapa, prueba: e.prueba, rpm: Math.abs(e.husillo.rpm), rpmFirmado: e.husillo.rpm,
        sentido: e.husillo.sentido, consigna: e.husillo.consigna, marcha: e.husillo.marcha,
        z: e.ejes.z, x: e.ejes.x, c: e.ejes.c, auto: e.avance.auto, f: e.avance.f,
        refrigerante: e.refrigerante.on, luz: e.luz.on, protector: e.protector.cerrado, plato: e.plato.cerrado,
        seta: e.seta, alarma: e.alarma ? { ...e.alarma } : null, apoyo: e.apoyo, ocupado: e.ocupado,
        carga: e.carga, potencia: e.potencia, temp: e.temp,
        piezas: e.cont.piezas, husilloS: e.cont.husilloS, viruta: e.cont.viruta,
        numero: e.pieza.numero, quitado: e.pieza.quitado, version: e.pieza.version,
        radios: Float32Array.from(e.pieza.radios), mec: Float32Array.from(e.pieza.mec),
      };
    }

    function destruir() { reloj.cancel(); pararMovimientos(); animRampa?.cancel(); oyentes.clear(); }

    return { estado: e, on, tick, moverA, irA, pararMovimientos, limites, nuevaBarra, encender, instantanea, destruir, ...ordenes };
  }

  window.Torno = Object.assign(window.Torno || {}, {
    crearMaquina,
    DATOS: { PIEZA, DZ, PASO, DIV, RPM_MAX, LIM, CONTACTO, ANCHO_HTA },
  });
})();
