// grafcet.js — el ESTADO como un GRAFCET (el diagrama de etapas que se usa en automatización): la etapa activa
// se enciende y, cuando se dispara una transición, un pulso recorre el enlace desde la etapa anterior.
// El SVG está escrito en index.html (se entiende sin JS); aquí solo se cambian clases y textos.
(() => {
  const { animate, svg } = anime;
  const { num, entero } = window.Torno;

  // Enlace que recorre el pulso para cada transición "de-a"
  const CAMINOS = { '0-1': '#g-c01', '1-2': '#g-c12', '2-1': '#g-c21', '1-0': '#g-c10', '2-0': '#g-c20', '3-0': '#g-c30' };
  const BARRAS = { '0-1': '#g-t01', '1-2': '#g-t12', '2-1': '#g-t21', '1-0': '#g-tparo', '2-0': '#g-tparo', '3-0': '#g-t30' };

  function iniciarGrafcet({ remoto, reducido, informar }) {
    const etapas = [0, 1, 2, 3].map((i) => document.querySelector('#g-etapa-' + i));
    const accion1 = document.querySelector('#g-accion-1'), accion2 = document.querySelector('#g-accion-2');
    const motivo = document.querySelector('#grafcet-motivo');
    const pulso = document.querySelector('#g-pulso');
    let activa = null, disparos = 0, animando = 0;
    const anims = new Set();
    const vigilar = (a) => { anims.add(a); a.then(() => anims.delete(a)); return a; };

    function activar(n, animar) {
      if (n === activa) return;
      activa = n;
      etapas.forEach((g, i) => g.classList.toggle('es-activa', i === n));
      if (animar && !reducido) vigilar(animate(etapas[n].querySelector('.g-caja'), { scale: [1.25, 1], duration: 500, ease: 'outBack(2)' }));
    }

    const bajas = [
      remoto.on('etapa', ({ de, a, motivo: m }) => {
        disparos++;
        const clave = de + '-' + a;
        motivo.textContent = 'Última transición: ' + de + ' → ' + a + ' (' + m + ')';
        const barra = document.querySelector(a === 3 ? '#g-tforzado' : BARRAS[clave] || '#g-tforzado');
        if (barra) { barra.classList.add('es-disparada'); setTimeout(() => barra.classList.remove('es-disparada'), 900); }
        const camino = a === 3 ? '#g-cx3' : CAMINOS[clave];
        if (camino && !reducido) {
          // El punto sigue el enlace (createMotionPath da translateX/translateY/rotate en coordenadas del SVG)
          animando++;
          vigilar(animate(pulso, { ...svg.createMotionPath(camino), opacity: [1, 1, 0], duration: 650, ease: 'inOut(2)',
            onComplete: () => { animando = Math.max(0, animando - 1); activar(a, true); } }));
        } else activar(a, true);
      }),
      remoto.on('trama', (f) => {
        // Primera trama: etapa inicial sin animación. Después, si dos transiciones llegan casi juntas y un pulso
        // se pisa con otro, la trama corrige la etapa (la telemetría manda).
        if (activa === null || (!animando && f.etapa !== activa)) activar(f.etapa, false);
        const t1 = 'Husillo ' + (f.sentido > 0 ? 'M3' : 'M4') + ' · S ' + entero(f.consigna);
        const t2 = 'Avance Z− · f ' + num(f.f, 2);
        if (accion1.textContent !== t1) accion1.textContent = t1;
        if (accion2.textContent !== t2) accion2.textContent = t2;
      }),
    ];

    informar('grafcet', () => ({ activa, disparos }));
    return { destruir() { bajas.forEach((f) => f()); anims.forEach((a) => a.cancel()); } };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarGrafcet });
})();
