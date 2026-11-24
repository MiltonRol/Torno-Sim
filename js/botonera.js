// botonera.js — el PUPITRE: lo que pulsaría el operario a pie de máquina (es el mando del mock).
// Cada botón llama a una orden de la máquina; las luces de los pulsadores se leen de la máquina EN VIVO
// (la botonera está "en el taller", no al otro lado de la red). Si una orden choca con un enclavamiento,
// se señala el mando culpable con una sacudida y un aviso.
(() => {
  const { animate, createTimer } = anime;
  const { entero, num } = window.Torno;

  function iniciarBotonera({ maquina, reducido, informar }) {
    const $ = (s) => document.querySelector(s);
    const e = maquina.estado;
    const aviso = $('#pupitre-aviso');
    const anims = new Set();
    const vigilar = (a) => { anims.add(a); a.then(() => anims.delete(a)); return a; };
    const oyentes = [];
    const al = (el, tipo, fn) => { el.addEventListener(tipo, fn); oyentes.push(() => el.removeEventListener(tipo, fn)); };

    // ---- pulsadores ----
    al($('#btn-marcha'), 'click', () => maquina.marcha());
    al($('#btn-paro'), 'click', () => maquina.paro());
    al($('#btn-rearme'), 'click', () => maquina.rearme());
    al($('#btn-seta'), 'click', () => maquina.seta(!e.seta));          // la seta se enclava; se suelta con otro clic ("girar")

    // ---- selector de sentido (M3 / M4) ----
    const flecha = $('.selector__flecha');
    let sentidoVisto = e.husillo.sentido;
    document.querySelectorAll('[data-sentido]').forEach((b) => al(b, 'click', () => maquina.sentido(Number(b.dataset.sentido))));

    // ---- consigna de velocidad ----
    const consigna = $('#consigna'), salida = $('#consigna-valor');
    let moviendo = false;
    al(consigna, 'input', () => { moviendo = true; maquina.consigna(Number(consigna.value)); salida.textContent = entero(consigna.value) + ' rpm'; });
    al(consigna, 'change', () => { moviendo = false; maquina.consigna(Number(consigna.value), 'operario', true); });

    // ---- interruptores (role="switch") ----
    const interruptores = {
      refrigerante: [$('#tg-refrigerante'), () => e.refrigerante.on, (v) => maquina.refrigerante(v)],
      luz: [$('#tg-luz'), () => e.luz.on, (v) => maquina.luz(v)],
      protector: [$('#tg-protector'), () => e.protector.cerrado, (v) => maquina.protector(v)],
      plato: [$('#tg-plato'), () => e.plato.cerrado, (v) => maquina.plato(v)],
      avance: [$('#tg-avance'), () => e.avance.auto, (v) => maquina.avance(v)],
    };
    Object.values(interruptores).forEach(([el, leer, poner]) => al(el, 'click', () => poner(!leer())));

    // ---- avance por vuelta ----
    const botonesF = [...document.querySelectorAll('[data-f]')];
    botonesF.forEach((b) => al(b, 'click', () => maquina.fijarAvance(Number(b.dataset.f))));

    // ---- nueva barra ----
    const btnBarra = $('#btn-barra');
    al(btnBarra, 'click', () => maquina.nuevaBarra());

    // ---- enclavamientos: sacudida del mando culpable + aviso ----
    let ocultarAviso = 0;
    const baja = maquina.on('enclavamiento', (c) => {
      aviso.textContent = '⚠ ' + c.texto.charAt(0).toUpperCase() + c.texto.slice(1);
      aviso.classList.add('es-visible');
      clearTimeout(ocultarAviso);
      ocultarAviso = setTimeout(() => aviso.classList.remove('es-visible'), 4200);
      document.querySelectorAll('[data-causa~="' + c.causa + '"]').forEach((el) => {
        el.classList.add('es-bloqueo');
        setTimeout(() => el.classList.remove('es-bloqueo'), 1100);
        // La sacudida va en el contenedor (.mando): el botón ya tiene su propio transform (:active en CSS)
        if (!reducido) vigilar(animate(el, { x: [0, -7, 7, -5, 5, -2, 0], duration: 460, ease: 'linear' }));
      });
    });

    // ---- sincronizar luces y estados con la máquina (15 veces por segundo sobra) ----
    const pon = (el, attr, v) => { if (el.getAttribute(attr) !== v) el.setAttribute(attr, v); };
    const clase = (el, c, on) => { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); };
    const marcha = $('#btn-marcha'), rearme = $('#btn-rearme'), seta = $('#btn-seta');
    const reloj = createTimer({
      frameRate: 15,
      onUpdate: () => {
        clase(marcha, 'es-encendido', e.husillo.marcha);
        clase(rearme, 'es-parpadeo', !!e.alarma && !e.seta);   // azul intermitente = "hace falta rearmar"
        pon(seta, 'aria-pressed', String(e.seta));
        document.querySelectorAll('[data-sentido]').forEach((b) => pon(b, 'aria-pressed', String(Number(b.dataset.sentido) === e.husillo.sentido)));
        if (sentidoVisto !== e.husillo.sentido) {
          sentidoVisto = e.husillo.sentido;
          const giro = sentidoVisto > 0 ? -40 : 40;
          if (reducido) flecha.style.transform = 'rotate(' + giro + 'deg)';
          else vigilar(animate(flecha, { rotate: giro, duration: 380, ease: 'outBack(2)' }));
        }
        if (!moviendo && Number(consigna.value) !== e.husillo.consigna) {
          consigna.value = String(e.husillo.consigna);
          salida.textContent = entero(e.husillo.consigna) + ' rpm';
        }
        for (const [el, leer] of Object.values(interruptores)) pon(el, 'aria-checked', String(leer()));
        botonesF.forEach((b) => pon(b, 'aria-pressed', String(Number(b.dataset.f) === e.avance.f)));
        btnBarra.disabled = e.ocupado;
        btnBarra.textContent = e.ocupado ? 'Cambiando barra…' : 'Nueva barra';
      },
    });
    flecha.style.transform = 'rotate(' + (e.husillo.sentido > 0 ? -40 : 40) + 'deg)';

    informar('botonera', () => ({ marcha: e.husillo.marcha, seta: e.seta, etapa: e.etapa }));
    return {
      destruir() { reloj.cancel(); baja(); oyentes.forEach((f) => f()); anims.forEach((a) => a.cancel()); clearTimeout(ocultarAviso); },
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarBotonera });
})();
