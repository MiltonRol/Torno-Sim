// telemetria.js — lo que llega por la RED: estado general, torre de señalización de la cabecera, visualizador de
// cotas, relojes de aguja, gráfica de los últimos 60 s y contadores. Todo se alimenta de las tramas del enlace
// remoto (10 por segundo, con su latencia): si se corta la conexión, los datos se quedan quietos y en gris.
(() => {
  const { createTimer, createAnimatable, animate } = anime;
  const { num, entero, dprLimitado, senalesBaliza } = window.Torno;
  const NS = 'http://www.w3.org/2000/svg';

  // Relojes: rango, zonas de color y formato del número
  const RELOJES = {
    rpm: { min: 0, max: 2000, marcas: 8, zonas: [[1800, 2000, 'aviso']], fmt: (v) => entero(v), unidad: 'rpm' },
    carga: { min: 0, max: 150, marcas: 6, zonas: [[0, 80, 'ok'], [80, 100, 'aviso'], [100, 150, 'mal']], fmt: (v) => entero(v), unidad: '% carga' },
    temp: { min: 20, max: 80, marcas: 6, zonas: [[20, 55, 'ok'], [55, 65, 'aviso'], [65, 80, 'mal']], fmt: (v) => num(v, 1), unidad: '°C cabezal' },
    potencia: { min: 0, max: 10, marcas: 5, zonas: [[7.5, 10, 'mal']], fmt: (v) => num(v, 2), unidad: 'kW' },
  };
  const ANG = 120;                                       // el arco va de −120° a +120°
  const punto = (a, r) => [Math.sin((a * Math.PI) / 180) * r, -Math.cos((a * Math.PI) / 180) * r];
  const arco = (a0, a1, r) => {
    const [x0, y0] = punto(a0, r), [x1, y1] = punto(a1, r);
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
  };

  function crearReloj(caja, cfg, reducido) {
    const el = (t, a, p) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); p.append(n); return n; };
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-60 -58 120 96'); svg.setAttribute('aria-hidden', 'true');
    const ang = (v) => -ANG + ((v - cfg.min) / (cfg.max - cfg.min)) * ANG * 2;
    el('path', { d: arco(-ANG, ANG, 48), class: 'reloj__fondo' }, svg);
    for (const [a, b, tipo] of cfg.zonas) el('path', { d: arco(ang(a), ang(b), 48), class: 'reloj__zona reloj__zona--' + tipo }, svg);
    for (let k = 0; k <= cfg.marcas; k++) {
      const a = -ANG + (k / cfg.marcas) * ANG * 2, [x0, y0] = punto(a, 40), [x1, y1] = punto(a, 45);
      el('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'reloj__marca' }, svg);
    }
    const aguja = el('g', { class: 'reloj__aguja' }, svg);
    el('path', { d: 'M-2.6 4 L0 -44 L2.6 4 Z', class: 'reloj__aguja-cuerpo' }, aguja);
    el('circle', { r: 5, class: 'reloj__eje' }, svg);
    const valor = el('text', { x: 0, y: 26, class: 'reloj__valor' }, svg);
    valor.textContent = '—';
    caja.prepend(svg);
    utilsRotar(aguja, -ANG);
    // La aguja la mueve un createAnimatable: recibe 10 valores por segundo y los suaviza (sin crear animaciones nuevas)
    const anim = createAnimatable(aguja, { rotate: reducido ? 0 : 280, ease: 'out(3)' });
    return { poner(v) { anim.rotate(ang(Math.min(cfg.max, Math.max(cfg.min, v)))); valor.textContent = cfg.fmt(v); }, svg, anim };
  }
  function utilsRotar(el, g) { el.style.transform = 'rotate(' + g + 'deg)'; }

  function iniciarTelemetria({ remoto, reducido, informar }) {
    const $ = (s) => document.querySelector(s);
    const banner = $('#estado-banner'), titulo = $('#estado-titulo'), detalle = $('#estado-detalle');
    const dro = { x: $('#dro-x'), z: $('#dro-z'), c: $('#dro-c'), s: $('#dro-s'), f: $('#dro-f') };
    const cont = { piezas: $('#cont-piezas'), husillo: $('#cont-husillo'), viruta: $('#cont-viruta'), numero: $('#cont-numero') };
    const luces = { rojo: $('.baliza__luz--rojo'), ambar: $('.baliza__luz--ambar'), verde: $('.baliza__luz--verde') };
    const baliza = $('#baliza');
    const relojes = {};
    document.querySelectorAll('[data-reloj]').forEach((c) => { relojes[c.dataset.reloj] = crearReloj(c, RELOJES[c.dataset.reloj], reducido); });

    // ---- gráfica de tendencia: 60 s a 5 muestras por segundo ----
    const lienzo = $('#lienzo-tendencia'), g = lienzo.getContext('2d');
    const MUESTRAS = 300, serie = { rpm: [], carga: [], temp: [] };
    let w = 1, h = 1, colores = leerColores();
    function leerColores() {
      const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
      return { rpm: v('--serie-rpm', '#ff7a1a'), carga: v('--serie-carga', '#38d6c4'), temp: v('--serie-temp', '#c48bff'),
        rejilla: v('--borde', '#2a333b'), texto: v('--texto-suave', '#8fa1ae'), mono: v('--mono', 'monospace') };
    }
    const ro = new ResizeObserver(() => {
      const r = lienzo.getBoundingClientRect(), dpr = dprLimitado();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      lienzo.width = Math.round(w * dpr); lienzo.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0); pintarGrafica();
    });
    ro.observe(lienzo);
    function pintarGrafica() {
      g.clearRect(0, 0, w, h);
      const izq = 34, abajo = h - 16, alto = abajo - 8;
      g.strokeStyle = colores.rejilla; g.lineWidth = 1; g.font = '10px ' + colores.mono; g.fillStyle = colores.texto;
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let k = 0; k <= 4; k++) {
        const y = Math.round(8 + (alto * k) / 4) + 0.5;
        g.beginPath(); g.moveTo(izq, y); g.lineTo(w - 4, y); g.stroke();
        g.fillText((100 - k * 25) + '%', izq - 4, y);
      }
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      [['−60 s', 0], ['−30 s', 0.5], ['ahora', 1]].forEach(([t, f]) => g.fillText(t, izq + (w - 4 - izq) * f - (f === 1 ? 14 : 0) + (f === 0 ? 14 : 0), h - 3));
      const normal = { rpm: (v) => v / 2000, carga: (v) => v / 150, temp: (v) => (v - 20) / 60 };
      for (const k of ['temp', 'carga', 'rpm']) {
        const datos = serie[k];
        if (datos.length < 2) continue;
        g.strokeStyle = colores[k]; g.lineWidth = k === 'rpm' ? 2 : 1.6; g.lineJoin = 'round';
        g.beginPath();
        datos.forEach((v, i) => {
          const x = izq + (w - 4 - izq) * ((MUESTRAS - datos.length + i) / (MUESTRAS - 1));
          const y = 8 + alto * (1 - Math.min(1, Math.max(0, normal[k](v))));
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        });
        g.stroke();
      }
    }

    // ---- textos del estado general ----
    const TITULOS = ['En reposo', 'Husillo en marcha', 'Avance automático', 'Emergencia'];
    let ultimaEtapa = null, ultima = null, cuenta = 0;
    const cuandoTrama = (f) => {
      ultima = f;
      // estado general
      const atencion = f.etapa === 0 && (!f.protector || !f.plato);
      const tituloTexto = f.etapa === 3 ? (f.alarma && f.alarma.codigo === 'SOBRECARGA' ? 'Alarma: sobrecarga' : 'Emergencia') : TITULOS[f.etapa] + (atencion ? ' · atención' : f.etapa === 0 ? ' · lista' : '');
      const det = f.etapa === 3 ? (f.seta ? 'Seta pulsada: desenclávala y pulsa Rearme' : 'Pulsa Rearme para volver a reposo')
        : !f.protector ? 'Protector del plato abierto' : !f.plato ? 'Plato abierto: pieza sin amarrar'
        : f.rpm > 1 ? entero(f.rpm) + ' rpm ' + (f.sentido > 0 ? 'a derechas' : 'a izquierdas') + ' · Ø' + num(2 * f.x, 2) + ' · Z' + num(f.z, 2, true)
        : 'Husillo parado · pieza nº ' + f.numero;
      if (titulo.textContent !== tituloTexto) titulo.textContent = tituloTexto;
      if (detalle.textContent !== det) detalle.textContent = det;
      const clase = f.etapa === 3 ? 'alarma' : atencion ? 'atencion' : f.etapa > 0 ? 'marcha' : 'reposo';
      if (banner.dataset.estado !== clase) {
        banner.dataset.estado = clase;
        if (!reducido && ultimaEtapa !== null) animate('#estado-banner .estado__caja', { scale: [1.04, 1], duration: 420, ease: 'out(3)' });
      }
      ultimaEtapa = f.etapa;
      // visualizador de cotas
      dro.x.textContent = num(2 * f.x, 3);
      dro.z.textContent = num(f.z, 3, true);
      dro.c.textContent = num(f.c, 1);
      dro.s.textContent = entero(f.rpm);
      dro.f.textContent = num(f.f, 2);
      // relojes
      relojes.rpm.poner(f.rpm); relojes.carga.poner(f.carga); relojes.temp.poner(f.temp); relojes.potencia.poner(f.potencia);
      // contadores
      cont.piezas.textContent = String(f.piezas);
      const s = Math.floor(f.husilloS);
      cont.husillo.textContent = Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      cont.viruta.textContent = num(f.viruta / 1000, 1);
      cont.numero.textContent = String(f.numero);
      // tendencia (1 de cada 2 tramas = 5 por segundo)
      if (cuenta++ % 2 === 0) {
        serie.rpm.push(f.rpm); serie.carga.push(f.carga); serie.temp.push(f.temp);
        for (const k in serie) if (serie[k].length > MUESTRAS) serie[k].shift();
        pintarGrafica();
      }
    };
    const bajas = [remoto.on('trama', cuandoTrama)];

    // ---- baliza de la cabecera (necesita su propio reloj para el destello) ----
    let t = 0;
    const reloj = createTimer({
      frameRate: 20,
      onUpdate: (tm) => {
        t += Math.min(0.2, Math.max(0, (tm.deltaTime || 0) / 1000));
        if (!ultima) return;
        const b = remoto.enLinea() ? senalesBaliza(ultima, t, reducido) : { rojo: 0, ambar: 0, verde: 0 };
        for (const k in luces) luces[k].style.setProperty('--i', b[k].toFixed(2));
        const nombre = b.rojo > 0.5 ? 'roja' : b.ambar > 0.5 ? 'ámbar' : b.verde > 0.5 ? 'verde' : 'apagada';
        const etiqueta = 'Torre de señalización: luz ' + nombre;
        if (baliza.getAttribute('aria-label') !== etiqueta) baliza.setAttribute('aria-label', etiqueta);
      },
    });
    const alTema = () => { colores = leerColores(); pintarGrafica(); };
    document.addEventListener('cambiotema', alTema);

    informar('telemetria', () => ({ tramas: cuenta, etapa: ultima?.etapa ?? null, rpm: ultima ? Math.round(ultima.rpm) : null }));
    return {
      destruir() {
        reloj.cancel(); ro.disconnect(); bajas.forEach((f) => f()); document.removeEventListener('cambiotema', alTema);
        Object.values(relojes).forEach((r) => { r.anim.revert(); r.svg.remove(); });
      },
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarTelemetria });
})();
