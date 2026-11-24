// enlace.js — lo que se VE del enlace remoto: la píldora de conexión y el reloj de la cabecera, y la tarjeta
// "Enlace" con los paquetes que viajan, la latencia, el botón para cortar/reconectar y el paro remoto.
(() => {
  const { animate, createTimer } = anime;
  const { num, hora } = window.Torno;

  function iniciarEnlace({ remoto, reducido, informar }) {
    const raiz = document.documentElement;
    const $ = (s) => document.querySelector(s);
    const pildora = $('#conexion'), texto = $('#conexion-texto'), lat = $('#latencia'), ultimo = $('#ultimo-dato');
    const led = $('#conexion .led'), relojEl = $('#reloj');
    const btnConexion = $('#btn-conexion'), btnParo = $('#btn-paro-remoto');
    const pista = $('#enlace-pista'), linea = $('#enlace-latencias');
    const datos = { lat: $('#dato-latencia'), tramas: $('#dato-tramas'), cola: $('#dato-cola') };
    const aviso = $('#aviso-conexion'), avisoTexto = $('#aviso-conexion-texto');
    const anims = new Set();
    const vigilar = (a) => { anims.add(a); a.then(() => anims.delete(a)); return a; };

    // ---- estado de la conexión → atributos y textos (el CSS hace el resto: colores, gris de "dato viejo") ----
    const TEXTOS = { conectando: 'Conectando…', 'en-linea': 'En línea', 'sin-conexion': 'Sin conexión', reconectando: 'Reconectando…' };
    function alCambiarConexion(estado) {
      raiz.dataset.conexion = estado;
      pildora.dataset.estado = estado;
      texto.textContent = TEXTOS[estado];
      btnConexion.textContent = estado === 'en-linea' ? 'Cortar conexión' : estado === 'sin-conexion' ? 'Reconectar' : 'Espera…';
      btnConexion.disabled = estado === 'conectando' || estado === 'reconectando';
      btnConexion.setAttribute('aria-pressed', String(estado === 'sin-conexion'));
      aviso.hidden = estado === 'en-linea';
      avisoTexto.textContent = estado === 'sin-conexion' ? 'SIN CONEXIÓN · imagen congelada a las ' + hora()
        : estado === 'reconectando' ? 'Reconectando con TR-01…' : 'Conectando con TR-01…';
      if (estado === 'en-linea' && !reducido) {
        // destello verde al recuperar los datos: el gemelo "se pone al día"
        vigilar(animate('#gemelo .gemelo__lienzo', { boxShadow: ['0 0 0 3px rgba(56,214,120,0.9)', '0 0 0 0px rgba(56,214,120,0)'], duration: 900, ease: 'out(2)' }));
      }
    }
    const bajas = [remoto.on('conexion', alCambiarConexion)];
    alCambiarConexion(remoto.estado.estado);

    btnConexion.addEventListener('click', onConexion);
    btnParo.addEventListener('click', onParo);
    function onConexion() { remoto.estado.estado === 'en-linea' ? remoto.cortar() : remoto.reconectar(); }
    function onParo() {
      const ok = remoto.enviarParo();
      if (!ok && !reducido) vigilar(animate(btnParo, { x: [0, -6, 6, -4, 4, 0], duration: 380, ease: 'linear' }));
    }

    // ---- paquetes: puntos que cruzan la pista (bajada = telemetría, subida = orden) ----
    // Pool fijo de 14 puntos (no se crean elementos nuevos 10 veces por segundo).
    const pool = [];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('span');
      p.className = 'paquete'; p.setAttribute('aria-hidden', 'true');
      pista.append(p); pool.push(p);
    }
    let siguiente = 0, contador = 0;
    function lanzar(subida, latencia) {
      const p = pool[siguiente]; siguiente = (siguiente + 1) % pool.length;
      const ancho = pista.clientWidth - 10;
      p.classList.toggle('paquete--subida', subida);
      // Duración visible: lo que tarda de verdad no se vería (30 ms), así que se exagera de forma proporcional
      vigilar(animate(p, { x: subida ? [ancho, 0] : [0, ancho], opacity: [0, 1, 1, 0], duration: 500 + latencia * 6, ease: 'linear' }));
    }
    if (!reducido) {
      bajas.push(remoto.on('salida', ({ lat: l }) => { if (contador++ % 2 === 0) lanzar(false, l); }));   // 1 de cada 2 tramas
      bajas.push(remoto.on('subida', ({ lat: l }) => lanzar(true, l)));
    }
    // Latido del LED una vez por segundo (no 10: sería un parpadeo molesto)
    bajas.push(remoto.on('trama', () => {
      if (!reducido && remoto.estado.tramas % 10 === 0) vigilar(animate(led, { scale: [1.6, 1], opacity: [0.5, 1], duration: 500, ease: 'out(3)' }));
    }));

    // ---- números y gráfica de latencia (60 muestras = 6 s) ----
    const historia = [];
    let ultimaCuenta = 0, ultimaT = performance.now(), porSegundo = 0, ultimoSegundo = -1;
    const reloj = createTimer({
      frameRate: 10,
      onUpdate: () => {
        const r = remoto.estado, ahora = performance.now();
        if (ahora - ultimaT >= 1000) { porSegundo = (r.tramas - ultimaCuenta) / ((ahora - ultimaT) / 1000); ultimaCuenta = r.tramas; ultimaT = ahora; }
        const viejo = r.ultima ? (ahora - r.ultima) / 1000 : null;
        lat.textContent = r.estado === 'en-linea' ? Math.round(r.latUltima || r.latencia) + ' ms' : '— ms';
        ultimo.textContent = viejo === null ? 'sin datos' : 'último dato hace ' + num(viejo, 1) + ' s';
        datos.lat.textContent = r.estado === 'en-linea' ? Math.round(r.latUltima || r.latencia) + ' ms' : '—';
        datos.tramas.textContent = num(r.estado === 'en-linea' ? porSegundo : 0, 1) + ' /s · ' + r.tramas;
        datos.cola.textContent = String(r.cola.length);
        historia.push(r.estado === 'en-linea' ? (r.latUltima || r.latencia) : 0);
        if (historia.length > 60) historia.shift();
        linea.setAttribute('points', historia.map((v, i) => (i * 200) / 59 + ',' + (38 - Math.min(v, 180) / 180 * 34).toFixed(1)).join(' '));
        const s = new Date().getSeconds();
        if (s !== ultimoSegundo) { ultimoSegundo = s; relojEl.textContent = hora(); }
      },
    });

    informar('enlace', () => ({ estado: remoto.estado.estado, tramas: remoto.estado.tramas, cola: remoto.estado.cola.length }));

    return {
      destruir() {
        reloj.cancel(); anims.forEach((a) => a.cancel());
        bajas.forEach((f) => f());
        btnConexion.removeEventListener('click', onConexion); btnParo.removeEventListener('click', onParo);
        pool.forEach((p) => p.remove());
      },
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarEnlace });
})();
