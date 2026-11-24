// demo.js — CICLO DEMO: un "operario fantasma" mecaniza una pieza solo (desbaste, escalón, ranura y chaflán).
// Si hay una pieza cargada desde un .step (objetivo.js), en vez de la pieza de ejemplo ejecuta las pasadas
// que calcula cam.js para ESA pieza: desbaste por capas y acabado del contorno.
// Es una secuencia async: cada paso espera a que termine su movimiento (Anime.js mueve los ejes con
// maquina.irA y la máquina corta de verdad). Las manivelas giran solas porque leen la posición de los ejes.
// Se cancela si el operario toca algo, si llega un paro remoto o si salta una alarma.
(() => {
  class Cancelado extends Error {}

  function iniciarDemo({ maquina, reducido, informar, objetivo }) {
    const btn = document.querySelector('#btn-demo'), texto = document.querySelector('#demo-estado');
    const barra = document.querySelector('#demo-progreso span');
    const e = maquina.estado;
    let corriendo = false, cancelar = null, motivo = '', movActual = null, completados = 0;

    const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
    function actualizarBoton() {
      btn.setAttribute('aria-pressed', String(corriendo));
      btn.textContent = corriendo ? '■ Detener demo' : '▶ Ciclo demo';
    }
    function detener(porque) {
      if (!corriendo || !cancelar) return;
      motivo = porque;
      movActual?.cancel();                       // solo SU movimiento (no los del operario)
      cancelar();
    }

    async function ciclo() {
      corriendo = true; motivo = ''; actualizarBoton();
      const cancelada = new Promise((ok) => { cancelar = ok; });
      // Espera "con salida": a lo que sea, o a la cancelación (y entonces se lanza Cancelado)
      const esperar = async (promesa) => {
        const r = await Promise.race([promesa.then(() => 'ok'), cancelada.then(() => 'cancelada')]);
        if (r === 'cancelada' || e.alarma) throw new Cancelado();
      };
      const mov = (destino, ms, ease = 'inOut(2)') => {
        movActual = maquina.irA(destino, reducido ? Math.min(ms, 400) : ms, 'demo', ease);
        return esperar(Promise.race([movActual, pausa(ms + 400)]));
      };
      const hasta = (cond, ms) => esperar(new Promise((ok) => {
        const t0 = performance.now();
        const mirar = () => (cond() || performance.now() - t0 > ms ? ok() : setTimeout(mirar, 60));
        mirar();
      }));
      // Con pieza cargada, el programa se calcula AL EMPEZAR (copia del objetivo: si cargas otra pieza a
      // mitad de ciclo, este sigue con la que tenía)
      const { PIEZA, ANCHO_HTA, LIM } = window.Torno.DATOS;
      const plan = objetivo?.radios
        ? window.Torno.cam.planificar(Float32Array.from(objetivo.radios), { ...PIEZA, ancho: ANCHO_HTA, zMin: LIM.zMin, xMin: LIM.xMin })
        : null;
      const nombre = objetivo?.nombre;
      const TOTAL = plan ? plan.fases.length + 4 : 10;
      const fase = (n, t) => { texto.textContent = 'Paso ' + n + '/' + TOTAL + ': ' + t; barra.style.transform = 'scaleX(' + n / TOTAL + ')'; };
      try {
        if (e.seta || e.alarma) { texto.textContent = 'No puede empezar: hay una alarma activa (desenclava la seta y pulsa Rearme).'; return; }
        fase(1, 'preparar la máquina');
        if (e.husillo.marcha) maquina.paro('demo');
        await hasta(() => Math.abs(e.husillo.rpm) < 5, 3000);
        if (e.pieza.quitado > 0) await esperar(maquina.nuevaBarra('demo'));    // empieza con una barra nueva
        if (!e.protector.cerrado) maquina.protector(true, 'demo');
        if (!e.plato.cerrado) maquina.plato(true, 'demo');
        if (e.ejes.c > 0) await mov({ c: 0 }, 600);
        await mov({ x: 30, z: 4 }, 900);
        fase(2, 'arranque M3 a 1 200 rpm con taladrina');
        maquina.sentido(1, 'demo'); maquina.consigna(1200, 'demo', true); maquina.refrigerante(true, 'demo');
        if (!maquina.marcha('demo')) throw new Cancelado();
        await hasta(() => Math.abs(e.husillo.rpm) > 1050, 3000);
        if (plan) {
          // ---- programa calculado para la pieza cargada ----
          // Los AVANCES (con v) duran lo que tocan aunque haya movimiento reducido: si se aceleraran,
          // el caudal de viruta se dispararía y saltaría la alarma de sobrecarga. Los rápidos sí se acortan.
          const paso = async (m) => {
            const z = m.z ?? e.ejes.z, x = m.x ?? e.ejes.x;
            const d = Math.hypot(z - e.ejes.z, x - e.ejes.x);
            if (d < 1e-3) return;
            const ms = m.v ? (d / m.v) * 1000 : Math.max(180, (d / 110) * 1000);
            // Con Z y X a la vez, la máquina interpola por la recta (moverZX): los conos salen a cota
            movActual = maquina.irA({ z, x }, m.v || !reducido ? ms : Math.min(ms, 300), 'demo', m.v ? 'linear' : 'inOut(2)');
            await esperar(Promise.race([movActual, pausa(ms + 400)]));
          };
          for (let k = 0; k < plan.fases.length; k++) {
            const f = plan.fases[k];
            fase(3 + k, f.texto);
            for (const m of f.movs) await paso(m);
          }
          fase(TOTAL - 1, 'retirada y paro');
          await mov({ x: 32, z: 30 }, 900);
          maquina.refrigerante(false, 'demo'); maquina.paro('demo');
          await hasta(() => Math.abs(e.husillo.rpm) < 5, 4000);
          fase(TOTAL, 'pieza «' + nombre + '» terminada');
          completados++;
          return;
        }
        // Pasada de cilindrado: profundidad, avance de trabajo a 20 mm/s, retirada y vuelta en rápido
        const pasada = async (n, r, zFin, t) => {
          fase(n, t);
          await mov({ x: r }, 450);
          await mov({ z: zFin }, (Math.abs(zFin - e.ejes.z) / 20) * 1000, 'linear');
          await mov({ x: r + 1.5 }, 250);
          await mov({ z: 4 }, 650);
        };
        await pasada(3, 23.5, -100, 'desbaste a Ø47 (1,5 mm por pasada)');
        await pasada(4, 22, -100, 'desbaste a Ø44');
        await pasada(5, 20.5, -62, 'escalón a Ø41');
        await pasada(6, 19, -62, 'escalón a Ø38');
        fase(7, 'ranura de Ø30 en Z −40');
        await mov({ x: 24 }, 300); await mov({ z: -40 }, 600); await mov({ x: 19.4 }, 250);
        await mov({ x: 15 }, 1500, 'linear');                  // penetración lenta
        await mov({ z: -44 }, 1200, 'linear');                 // ensanchar la ranura
        await mov({ x: 25 }, 450);
        fase(8, 'chaflán de 1 × 45° en la punta');
        await mov({ z: 2, x: 17 }, 700);
        await mov({ z: -2, x: 19.6 }, 900, 'linear');          // X y Z a la vez = chaflán
        fase(9, 'retirada y paro');
        await mov({ x: 32, z: 30 }, 900);
        maquina.refrigerante(false, 'demo'); maquina.paro('demo');
        await hasta(() => Math.abs(e.husillo.rpm) < 5, 4000);
        fase(10, 'pieza terminada: Ø47 · Ø44 · Ø38 · ranura Ø30 · chaflán');
        completados++;
      } catch (err) {
        if (!(err instanceof Cancelado)) console.error('[demo]', err);
        texto.textContent = 'Demo detenida: ' + (motivo || (e.alarma ? 'alarma en la máquina' : 'no se pudo continuar')) + '.';
      } finally {
        corriendo = false; cancelar = null; movActual = null; actualizarBoton();
      }
    }

    const onClick = () => (corriendo ? detener('la has parado tú') : ciclo());
    btn.addEventListener('click', onClick);
    const bajas = [
      maquina.on('orden', ({ origen }) => detener(origen === 'remoto' ? 'paro remoto recibido' : 'el operario ha tomado el control')),
      maquina.on('etapa', ({ a }) => { if (a === 3) detener('alarma en la máquina'); }),
    ];
    actualizarBoton();

    informar('demo', () => ({ corriendo, completados, texto: texto.textContent }));
    return { destruir() { detener('fin'); btn.removeEventListener('click', onClick); bajas.forEach((f) => f()); } };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarDemo });
})();
