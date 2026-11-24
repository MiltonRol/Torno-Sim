// registro.js — el REGISTRO DE EVENTOS que llegan por el enlace: hora, nivel (info, ok, aviso, alarma) y texto.
// Los que se reciben tras una reconexión se marcan como "recibido con retraso". Es una lista <ol role="log">:
// los lectores de pantalla anuncian las entradas nuevas sin robar el foco.
(() => {
  const { animate } = anime;
  const { hora } = window.Torno;
  const ICONOS = { info: 'ℹ', ok: '✔', aviso: '⚠', alarma: '⛔' };
  const MAX = 80;

  function iniciarRegistro({ remoto, reducido, informar }) {
    const lista = document.querySelector('#lista-eventos');
    const cuentaEv = document.querySelector('#cuenta-eventos'), cuentaAl = document.querySelector('#cuenta-alarmas');
    const filtros = [...document.querySelectorAll('[data-filtro]')];
    const vaciar = document.querySelector('#btn-vaciar');
    let total = 0, alarmas = 0;

    function anadir(ev) {
      total++;
      if (ev.nivel === 'alarma' || ev.nivel === 'aviso') alarmas++;
      const li = document.createElement('li');
      li.className = 'ev ev--' + ev.nivel + (ev.diferido ? ' ev--diferido' : '');
      const t = document.createElement('time');
      const fecha = new Date(ev.t || Date.now());
      t.dateTime = fecha.toISOString(); t.textContent = hora(fecha);
      const icono = document.createElement('span');
      icono.className = 'ev__icono'; icono.setAttribute('aria-hidden', 'true'); icono.textContent = ICONOS[ev.nivel] || '•';
      const texto = document.createElement('span');
      texto.className = 'ev__texto';
      texto.textContent = ev.texto + (ev.diferido ? ' · recibido con retraso' : '');      // textContent: nunca innerHTML con datos
      li.append(t, icono, texto);
      lista.prepend(li);
      while (lista.children.length > MAX) lista.lastElementChild.remove();
      if (!reducido) animate(li, { opacity: [0, 1], x: [-14, 0], duration: 360, ease: 'out(3)' });
      cuentaEv.textContent = String(total); cuentaAl.textContent = String(alarmas);
    }
    const baja = remoto.on('evento', anadir);

    const onFiltro = (ev) => {
      const b = ev.currentTarget;
      filtros.forEach((f) => f.setAttribute('aria-pressed', String(f === b)));
      lista.classList.toggle('solo-alertas', b.dataset.filtro === 'alertas');
    };
    const onVaciar = () => { lista.replaceChildren(); total = 0; alarmas = 0; cuentaEv.textContent = '0'; cuentaAl.textContent = '0'; };
    filtros.forEach((f) => f.addEventListener('click', onFiltro));
    vaciar.addEventListener('click', onVaciar);

    informar('registro', () => ({ total, alarmas }));
    return {
      destruir() { baja(); filtros.forEach((f) => f.removeEventListener('click', onFiltro)); vaciar.removeEventListener('click', onVaciar); },
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarRegistro });
})();
