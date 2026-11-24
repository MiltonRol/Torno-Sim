// manivelas.js — los tres VOLANTES (carro longitudinal Z, carro transversal X y caña del contrapunto).
// Cada volante es un SVG con su tambor graduado (nonio). Se gira arrastrando alrededor del centro, con el
// teclado (es un role="slider") o con los botones ±. El ángulo que se ve SIEMPRE sale de la posición real del
// eje en la máquina: si la cuchilla topa con la pieza parada, el volante no gira (como en la realidad).
(() => {
  const { animate, createTimer } = anime;
  const { DATOS, num, clamp } = window.Torno;
  const { PASO, DIV, LIM } = DATOS;
  const NS = 'http://www.w3.org/2000/svg';

  // Sentido: girar en el sentido de las agujas del reloj = "hacia la pieza" en los tres ejes
  const EJES = {
    z: { signo: -1, salto: 5, texto: (v) => num(v, 2, true) + ' mm', rango: [LIM.zMin, LIM.zMax] },
    x: { signo: -1, salto: 0.5, texto: (v) => 'Ø' + num(2 * v, 2) + ' mm', rango: [LIM.xMin, LIM.xMax] },
    c: { signo: 1, salto: 5, texto: (v) => num(v, 1) + ' mm', rango: [0, DATOS.CONTACTO] },
  };

  function crearSvg(eje) {
    const el = (tipo, attrs, padre) => {
      const n = document.createElementNS(NS, tipo);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      padre.append(n); return n;
    };
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-100 -100 200 200'); svg.setAttribute('aria-hidden', 'true');
    el('circle', { r: 97, class: 'vol-carcasa' }, svg);
    const giro = el('g', { class: 'vol-giro' }, svg);
    // tambor graduado: DIV divisiones, raya larga y número cada 10
    el('circle', { r: 60, class: 'vol-tambor' }, giro);
    const n = DIV[eje];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, larga = k % 10 === 0, r0 = larga ? 47 : 52;
      el('line', { x1: Math.sin(a) * r0, y1: -Math.cos(a) * r0, x2: Math.sin(a) * 59, y2: -Math.cos(a) * 59, class: larga ? 'vol-raya vol-raya--larga' : 'vol-raya' }, giro);
      if (larga) {
        const t = el('text', { x: Math.sin(a) * 37, y: -Math.cos(a) * 37 + 3.5, class: 'vol-num' }, giro);
        t.textContent = String(k);
      }
    }
    // radios, llanta y mango
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 3;
      el('line', { x1: Math.sin(a) * 61, y1: -Math.cos(a) * 61, x2: Math.sin(a) * 80, y2: -Math.cos(a) * 80, class: 'vol-radio' }, giro);
    }
    el('circle', { r: 84, class: 'vol-llanta' }, giro);
    el('circle', { r: 84, class: 'vol-llanta-brillo' }, giro);
    el('circle', { cx: 0, cy: -84, r: 12, class: 'vol-mango' }, giro);
    el('circle', { cx: -3, cy: -88, r: 4, class: 'vol-mango-brillo' }, giro);
    // índice fijo (la marca contra la que se lee el tambor)
    el('path', { d: 'M0 -62 L-6 -72 L6 -72 Z', class: 'vol-indice' }, svg);
    el('circle', { r: 9, class: 'vol-cubo' }, svg);
    return { svg, giro };
  }

  function iniciarManivelas({ maquina, reducido, informar }) {
    const e = maquina.estado;
    const volantes = [];
    const anims = new Set();
    const oyentes = [];
    const al = (el, tipo, fn, opc) => { el.addEventListener(tipo, fn, opc); oyentes.push(() => el.removeEventListener(tipo, fn, opc)); };

    document.querySelectorAll('.volante').forEach((caja) => {
      const eje = caja.dataset.eje, cfg = EJES[eje];
      const rueda = caja.querySelector('.volante__rueda'), salida = caja.querySelector('.volante__valor output');
      const { svg, giro } = crearSvg(eje);
      rueda.prepend(svg);
      rueda.setAttribute('aria-valuemin', String(cfg.rango[0]));
      rueda.setAttribute('aria-valuemax', String(cfg.rango[1]));
      const v = { eje, cfg, caja, rueda, salida, giro, ultimoAng: null, anim: null, destino: null };
      volantes.push(v);

      // ---- arrastre: se acumula el ángulo girado alrededor del centro ----
      let previo = null;
      const angulo = (ev) => { const r = rueda.getBoundingClientRect(); return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2)); };
      al(rueda, 'pointerdown', (ev) => {
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        v.anim?.cancel(); v.destino = null;
        previo = angulo(ev); rueda.setPointerCapture(ev.pointerId); rueda.classList.add('es-agarrado');
      });
      al(rueda, 'pointermove', (ev) => {
        if (previo === null) return;
        const a = angulo(ev);
        let d = a - previo;
        if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;   // sin saltos al cruzar ±180°
        previo = a;
        // d > 0 = horario en pantalla (el eje Y del navegador va hacia abajo)
        maquina.moverA(eje, e.ejes[eje] + cfg.signo * (d / (Math.PI * 2)) * PASO[eje], 'operario');
      });
      const soltar = () => { previo = null; rueda.classList.remove('es-agarrado'); };
      al(rueda, 'pointerup', soltar); al(rueda, 'pointercancel', soltar);

      // ---- teclado: flechas = 1 división, Re Pág / Av Pág = 10 divisiones ----
      al(rueda, 'keydown', (ev) => {
        const div = PASO[eje] / DIV[eje];
        const pasos = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[ev.key];
        if (!pasos) return;
        ev.preventDefault();
        v.anim?.cancel(); v.destino = null;
        maquina.moverA(eje, e.ejes[eje] + pasos * div, 'operario');
      });

      // ---- botones ±: movimiento suave con Anime.js; si se pulsa varias veces, se acumula el destino ----
      caja.querySelectorAll('[data-paso]').forEach((b) => al(b, 'click', () => {
        const base = v.destino ?? e.ejes[eje];
        const [mn, mx] = maquina.limites(eje);
        const pedido = base + Number(b.dataset.paso) * cfg.salto;
        v.destino = clamp(pedido, mn, mx);            // el acumulado no se sale del recorrido…
        v.anim?.cancel();
        // …pero a la máquina se le pide lo que pulsó el operario: ella recorta y explica el tope si lo hay
        v.anim = maquina.irA({ [eje]: pedido }, reducido ? 1 : 420, 'operario', 'out(3)');
        anims.add(v.anim);
        v.anim.then(() => { v.destino = null; anims.delete(v.anim); });
      }));
    });

    // Tope mecánico: sacudida del volante que lo ha alcanzado
    const baja = maquina.on('tope', ({ eje }) => {
      const v = volantes.find((q) => q.eje === eje);
      if (v && !reducido) anims.add(animate(v.caja.querySelector('.volante__rueda'), { x: [0, -5, 5, -3, 0], duration: 320, ease: 'linear' }));
    });

    // El ángulo se calcula de la posición del eje (un único dueño del giro: la máquina)
    const reloj = createTimer({
      onUpdate: () => {
        for (const v of volantes) {
          const pos = e.ejes[v.eje];
          const ang = -v.cfg.signo * (pos / PASO[v.eje]) * 360;
          if (ang !== v.ultimoAng) {
            v.ultimoAng = ang;
            v.giro.setAttribute('transform', 'rotate(' + ang.toFixed(2) + ')');
            const texto = v.cfg.texto(pos);
            v.salida.textContent = texto;
            v.rueda.setAttribute('aria-valuenow', pos.toFixed(2));
            v.rueda.setAttribute('aria-valuetext', texto);
          }
        }
      },
    });

    informar('manivelas', () => Object.fromEntries(volantes.map((v) => [v.eje, +e.ejes[v.eje].toFixed(3)])));
    return {
      destruir() {
        reloj.cancel(); baja(); oyentes.forEach((f) => f()); anims.forEach((a) => a.cancel());
        volantes.forEach((v) => v.rueda.querySelector('svg')?.remove());
      },
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarManivelas });
})();
