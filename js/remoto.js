// remoto.js — el ENLACE simulado entre la máquina y este panel (como una pasarela OPC UA o MQTT de taller).
// Qué hace: cada 100 ms saca una "trama" de telemetría (foto del estado) y la entrega con la latencia de la red;
// los eventos viajan igual. Si cortas la conexión, las tramas dejan de llegar, el gemelo se queda congelado con
// la última foto y los eventos se guardan en cola hasta reconectar (así se ve qué es "remoto" de verdad).
(() => {
  const { createTimer } = anime;
  const { clamp } = window.Torno;

  function crearRemoto({ maquina, reducido = false }) {
    const oyentes = new Map();
    const on = (tipo, fn) => {
      if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
      oyentes.get(tipo).add(fn);
      return () => oyentes.get(tipo)?.delete(fn);
    };
    const emitir = (tipo, d) => oyentes.get(tipo)?.forEach((fn) => {
      try { fn(d); } catch (err) { console.error('[remoto:' + tipo + ']', err); }
    });

    const r = { estado: 'conectando', latencia: 32, latUltima: 0, tramas: 0, ultima: 0, cola: [], desde: Date.now() };
    let congelado = null;                    // copia del estado de la máquina en el momento del corte
    const temporizadores = new Set();
    const tras = (ms, fn) => {
      const id = setTimeout(() => { temporizadores.delete(id); fn(); }, ms);
      temporizadores.add(id);
    };
    const enLinea = () => r.estado === 'en-linea';
    // Entrega con retraso; si la conexión cae mientras "viaja", el evento va a la cola (no se pierde)
    const entregar = (tipo, d) => {
      if (!enLinea()) { if (tipo === 'evento') r.cola.push(d); return; }
      tras(r.latencia, () => (enLinea() ? emitir(tipo, d) : tipo === 'evento' && r.cola.push(d)));
    };
    const bajas = [
      maquina.on('evento', (ev) => entregar('evento', ev)),
      maquina.on('etapa', (et) => entregar('etapa', et)),
    ];

    // Un único reloj: cada 100 ms, una trama
    let acumulado = 0;
    const reloj = createTimer({
      onUpdate: (t) => {
        acumulado += clamp((t.deltaTime || 0) / 1000, 0, 0.25);
        if (acumulado >= 0.1) { acumulado = 0; trama(); }
      },
    });
    function trama() {
      // Latencia: paseo aleatorio entre 18 y 60 ms y, de vez en cuando, un pico (como la wifi de un taller)
      r.latencia = clamp(r.latencia + (Math.random() - 0.5) * 8, 18, 60);
      const lat = Math.random() < 0.02 ? r.latencia + 60 + Math.random() * 90 : r.latencia;
      if (!enLinea()) return;
      const foto = maquina.instantanea();
      emitir('salida', { lat });                       // para dibujar el paquete que sale de la máquina
      tras(lat, () => {
        if (!enLinea()) return;
        r.tramas++; r.ultima = performance.now(); r.latUltima = lat;
        emitir('trama', foto);
      });
    }

    // inicial = primera conexión: lo que hay en cola es el historial del arranque, no eventos "perdidos"
    function conectar(texto, inicial = false) {
      r.estado = 'en-linea'; r.desde = Date.now(); congelado = null;
      emitir('conexion', r.estado);
      const pendientes = r.cola.splice(0);
      // Primero lo que estaba en cola (es más antiguo) y después el aviso de conexión: el registro queda en orden
      pendientes.forEach((ev) => emitir('evento', inicial ? ev : { ...ev, diferido: true }));
      emitir('evento', { nivel: 'ok', t: Date.now(),
        texto: texto + (!inicial && pendientes.length ? ': ' + pendientes.length + ' eventos recibidos con retraso' : '') });
    }
    // Arranque: "apretón de manos" con la máquina (lo llama main.js cuando todos escuchan)
    function iniciar() {
      emitir('conexion', r.estado);
      tras(reducido ? 300 : 1300, () => conectar('Conectado a TR-01 (pasarela simulada)', true));
    }
    function cortar() {
      if (r.estado !== 'en-linea') return;
      r.estado = 'sin-conexion'; r.desde = Date.now();
      congelado = structuredClone(maquina.estado);     // el gemelo se queda con la última foto
      emitir('conexion', r.estado);
    }
    function reconectar() {
      if (r.estado !== 'sin-conexion') return;
      r.estado = 'reconectando'; emitir('conexion', r.estado);
      tras(reducido ? 300 : 1500, () => conectar('Conexión restablecida'));
    }
    // Orden que SUBE del panel a la máquina: tarda la latencia y sin conexión no sale
    function enviarParo() {
      if (!enLinea()) {
        emitir('evento', { nivel: 'aviso', t: Date.now(), texto: 'Paro remoto NO enviado: no hay conexión con la máquina' });
        return false;
      }
      emitir('subida', { lat: r.latencia });
      tras(r.latencia, () => {
        if (!maquina.paro('remoto')) emitir('evento', { nivel: 'info', t: Date.now(), texto: 'Paro remoto: la máquina ya estaba parada' });
      });
      return true;
    }

    function destruir() {
      reloj.cancel();
      temporizadores.forEach(clearTimeout); temporizadores.clear();
      bajas.forEach((f) => f()); oyentes.clear();
    }

    return {
      on, estado: r, iniciar, cortar, reconectar, enviarParo, enLinea, destruir,
      // Lo que debe pintar el gemelo: la máquina en vivo o, sin conexión, la última foto recibida
      vista: () => congelado || maquina.estado,
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { crearRemoto });
})();
