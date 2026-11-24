// generador.js — GENERADOR DE PIEZAS .step a partir de la imagen de un esquema (modo SEMIASISTIDO).
// El usuario hace lo que una máquina haría mal (reconocer qué línea es el contorno) y el programa lo que
// a un humano le cuesta (convertir píxeles en milímetros, enderezar el eje, redondear, escribir el STEP):
//   1. ESCALA: dos clics en los extremos de una cota conocida + su valor en mm → píxeles por mm.
//   2. EJE: dos clics sobre la línea de trazo y punto → dirección del eje (el plano puede estar torcido).
//   3. CONTORNO: un clic por esquina del contorno superior, del plato a la cara → puntos (Z, Ø) en mm.
//      Ayudas: "imán" (se pega a la línea oscura más cercana), "ortogonal" (si casi es un cilindro o un
//      escalón, lo deja exacto) y redondeo (a 0,5 mm por defecto).
//   4. TABLA: se corrigen los valores con las cotas exactas del plano.
//   5. DESCARGAR: Torno.step.escribir() → archivo .step (y se relee con Torno.step.leer() para comprobarlo).
// Todo pasa en el navegador: la imagen se lee con FileReader y no sale del equipo.
(() => {
  const T = window.Torno, { num } = T;
  const $ = (s) => document.querySelector(s);
  const BARRA = { R: 25, L: 136 };          // lo que admite el torno: barra Ø50 y 136 mm de recorrido útil
  const XMIN = 4, FILO = 1.2;               // Ø8 mínimo (tope X) y ancho del filo de la cuchilla

  // ================= ESTADO (un único objeto; las vistas se pintan a partir de él) =================
  const est = {
    img: null, nombreImg: '', pix: null, pixF: 1,           // imagen, sus píxeles (para el imán) y su escala
    vista: { s: 1, ox: 0, oy: 0 },                          // pantalla = imagen · s + o (px CSS)
    modo: 'escala',
    escala: null,                                           // { a, b, mm } en px de la imagen
    eje: null,                                              // { a, b }
    pend: [],                                               // clics a medias (escala o eje)
    puntos: [],                                             // contorno en mm: { z (desde el plato), r (radio) }
    origen: null,                                           // { t0 (mm sobre el eje), signo (±1), lado (±1), fijo }
    hover: null, sel: -1, historial: [], descargas: 0, ultimoStep: null,
  };
  const pxmm = () => (est.escala ? Math.hypot(est.escala.b.x - est.escala.a.x, est.escala.b.y - est.escala.a.y) / est.escala.mm : null);

  // ================= ELEMENTOS =================
  const lienzo = $('#lienzo-esquema'), g = lienzo.getContext('2d');
  const previa = $('#lienzo-previa'), gp = previa.getContext('2d');
  const zona = $('#zona-lienzo'), vacio = $('#vacio'), ayuda = $('#ayuda');
  const entrada = $('#archivo-imagen'), formEscala = $('#form-escala'), inEscala = $('#escala-mm');
  const tabla = $('#tabla-puntos'), lista = $('#comprobaciones'), btnDescargar = $('#btn-descargar');

  // ================= DESHACER =================
  // Se guarda una "foto" de lo que el usuario puede cambiar ANTES de cada cambio (structuredClone copia
  // en profundidad: si se guardara la referencia, la foto cambiaría con el estado).
  const foto = () => structuredClone({ escala: est.escala, eje: est.eje, puntos: est.puntos, origen: est.origen });
  function guardar() { est.historial.push(foto()); if (est.historial.length > 200) est.historial.shift(); }
  function deshacer() {
    if (est.pend.length) { est.pend = []; formEscala.hidden = true; return todo(); }   // primero, el clic a medias
    const f = est.historial.pop();
    if (!f) return aviso('No hay nada que deshacer.');
    Object.assign(est, f); est.sel = -1; todo(true);
  }

  // ================= GEOMETRÍA DEL EJE =================
  // Base del eje en la imagen: u = dirección del eje, n = perpendicular. Un punto p de la imagen pasa a
  // t (posición a lo largo del eje) y s (distancia con signo al eje), en px.
  function base() {
    const { a, b } = est.eje, l = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
    return { a, u, n: { x: -u.y, y: u.x } };
  }
  const aEje = (p) => { const { a, u, n } = base(), dx = p.x - a.x, dy = p.y - a.y; return { t: dx * u.x + dy * u.y, s: dx * n.x + dy * n.y }; };
  // Inverso: un punto del contorno (mm) → px de la imagen, en el lado marcado (lado = ±1) o en el reflejado
  function aImagen(p, lado = est.origen.lado) {
    const { a, u, n } = base(), k = pxmm(), t = (est.origen.t0 + p.z * est.origen.signo) * k, s = lado * p.r * k;
    return { x: a.x + u.x * t + n.x * s, y: a.y + u.y * t + n.y * s };
  }

  // ================= IMÁN =================
  // Un plano está hecho de líneas PARALELAS y PERPENDICULARES al eje (cilindros y escalones). El imán busca,
  // por separado, la línea paralela más cercana (corrige el Ø) y la perpendicular más cercana (corrige la Z):
  // si el clic cae cerca de una esquina, se pega justo a la esquina. Para saber si en una posición hay una
  // línea se mira la oscuridad MEDIA de un trocito de segmento en esa dirección (hacia un lado y hacia el
  // otro: en una esquina la línea solo sigue por un lado). Al final se toma el CENTRO del trazo, no su
  // borde, para que el grosor de la línea del plano no meta error.
  // Antes de marcar el eje se usan las direcciones de la imagen (los planos suelen estar derechos).
  function lum(x, y) {
    const { data, width, height } = est.pix;
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return 255;
    const i = (y * width + x) * 4, a = data[i + 3] / 255;
    return (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);   // transparente = papel
  }
  function mediaSegmento(x, y, d, L) {
    let s = 0;
    for (let k = 0; k <= L; k++) s += lum(x + d.x * k, y + d.y * k);
    return s / (L + 1);
  }
  // Desplazamiento (px de pix) a lo largo de "busca" hasta el centro de la línea orientada según "seg"; null si no hay
  function buscarLinea(c, seg, busca, R, L) {
    const m = [];
    let mejor = -1, mejorScore = Infinity;
    for (let k = -R; k <= R; k++) {
      const x = c.x + busca.x * k, y = c.y + busca.y * k;
      const v = Math.min(mediaSegmento(x, y, seg, L), mediaSegmento(x, y, { x: -seg.x, y: -seg.y }, L));
      m.push(v);
      const score = v + (60 * Math.abs(k)) / R;                     // a igual oscuridad, gana la más cercana al clic
      if (score < mejorScore) { mejorScore = score; mejor = k + R; }
    }
    if (m[mejor] > 150) return null;                                 // nada lo bastante oscuro: no se mueve
    // centro del trazo: media de las posiciones contiguas casi tan oscuras como la mejor
    let a = mejor, b = mejor;
    while (a > 0 && m[a - 1] <= m[mejor] + 25) a--;
    while (b < m.length - 1 && m[b + 1] <= m[mejor] + 25) b++;
    return (a + b) / 2 - R;
  }
  function imantar(p) {
    if (!$('#opt-iman').checked || !est.pix) return p;
    const f = est.pixF;
    const { u, n } = est.eje ? base() : { u: { x: 1, y: 0 }, n: { x: 0, y: 1 } };
    const c = { x: p.x * f, y: p.y * f };
    const R = Math.max(3, Math.round((10 / est.vista.s) * f)), L = Math.max(4, Math.round(8 * f));
    const ds = buscarLinea(c, u, n, R, L);                          // línea paralela al eje → corrige la distancia al eje
    const dt = buscarLinea(c, n, u, R, L);                          // línea perpendicular → corrige la posición sobre el eje
    if (ds === null && dt === null) return p;
    const k = 1 / f;
    return { x: p.x + (n.x * (ds || 0) + u.x * (dt || 0)) * k, y: p.y + (n.y * (ds || 0) + u.y * (dt || 0)) * k };
  }

  // ================= DEL CLIC AL PUNTO (mm) =================
  // Devuelve el punto que se AÑADIRÍA (o un motivo para no añadirlo). Se usa también para la "goma"
  // que sigue al ratón, así lo que ves antes de hacer clic es exactamente lo que se guardará.
  function candidato(pImg) {
    const k = pxmm();
    const p = imantar(pImg), { t, s } = aEje(p);
    const tm = t / k, rm = Math.abs(s) / k;
    const o = est.origen || { t0: tm, signo: 1, lado: Math.sign(s) || -1, fijo: false };
    let signo = o.signo, fijo = o.fijo;
    // El sentido (plato → cara) lo decide el primer clic que se separa más de 1 mm del primero
    if (!fijo && est.puntos.length && Math.abs(tm - o.t0) > 1) { signo = Math.sign(tm - o.t0); fijo = true; }
    let z = (tm - o.t0) * signo, r = rm;
    const q = +$('#opt-redondeo').value;
    const ult = est.puntos[est.puntos.length - 1];
    if (ult && $('#opt-orto').checked) {
      // Tolerancia: 0,6 mm o 3 px de pantalla, lo que sea mayor (con poco zoom un píxel son muchos mm).
      // Si fuera más grande, un cono corto o un escalón pequeño se "aplanarían" sin querer.
      const tol = Math.max(0.6, 3 / est.vista.s / k);
      if (Math.abs(z - ult.z) < tol) z = ult.z;                       // casi vertical → escalón exacto
      else if (Math.abs(r - ult.r) < tol) r = ult.r;                  // casi horizontal → cilindro exacto
      else { const igual = est.puntos.find((pt) => Math.abs(pt.r - r) < tol * 0.5); if (igual) r = igual.r; }   // vuelve a un Ø ya usado
    }
    z = Math.round(z / q) * q;
    r = (Math.round((2 * r) / q) * q) / 2;                            // se redondea el DIÁMETRO (es lo que pone el plano)
    if (!est.puntos.length) z = 0;
    let motivo = '';
    if (r < 0.5) motivo = 'Ese punto está sobre el eje: no hace falta marcarlo, los extremos se cierran solos. Haz clic en la esquina del contorno.';
    else if (ult && z < ult.z - 1e-6) motivo = 'El contorno se marca del plato hacia la cara: ese punto vuelve hacia atrás (Z ' + num(z, 2) + ' < ' + num(ult.z, 2) + ').';
    else if (ult && Math.abs(z - ult.z) < 1e-6 && Math.abs(r - ult.r) < 1e-6) motivo = 'Ese punto es igual que el anterior.';
    return { z: +z.toFixed(4), r: +r.toFixed(4), p, origen: { t0: o.t0, signo, lado: o.lado, fijo }, motivo };
  }

  function clicContorno(pImg) {
    if (!est.escala) { cambiarModo('escala'); return aviso('Antes de marcar el contorno, calibra la ESCALA (herramienta 1).'); }
    if (!est.eje) { cambiarModo('eje'); return aviso('Antes de marcar el contorno, marca el EJE (herramienta 2).'); }
    // Puntos escritos a mano (sin clics): no se sabe dónde caen en la imagen, así que no se mezclan
    if (est.puntos.length && !est.origen) return aviso('Este contorno se escribió con la tabla. Para marcarlo sobre el esquema, bórralo antes («Borrar el contorno»).');
    const c = candidato(pImg);
    if (c.motivo) return aviso(c.motivo);
    guardar();
    // Si el sentido se acaba de decidir y era al revés, los puntos ya guardados se recalculan (solo hay uno: z = 0)
    est.origen = c.origen;
    est.puntos.push({ z: c.z, r: c.r });
    est.sel = est.puntos.length - 1;
    todo(true);
  }

  function clicDosPuntos(pImg) {
    const p = imantar(pImg);
    est.pend.push(p);
    if (est.pend.length < 2) return todo();
    const [a, b] = est.pend;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8) { est.pend = [a]; return aviso('Los dos puntos están demasiado juntos: sepáralos más.'); }
    if (est.modo === 'escala') {
      formEscala.hidden = false;
      inEscala.value = '';
      inEscala.focus();
      return todo();
    }
    // EJE: si ya había contorno, se borra (sus mm dependían del eje anterior); Ctrl+Z lo recupera
    guardar();
    const habia = est.puntos.length;
    est.eje = { a, b }; est.pend = [];
    if (habia) { est.puntos = []; est.origen = null; aviso('Eje cambiado: se ha borrado el contorno (Ctrl+Z lo recupera).'); }
    cambiarModo('contorno');
  }

  formEscala.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const mm = parseFloat(String(inEscala.value).replace(',', '.'));
    if (!(mm > 0)) return inEscala.focus();
    const [a, b] = est.pend, antes = pxmm();
    guardar();
    est.escala = { a, b, mm }; est.pend = []; formEscala.hidden = true;
    // Si ya había contorno, se reescala (los clics siguen en el mismo sitio de la imagen)
    const k = antes ? antes / pxmm() : 1;
    if (antes && est.puntos.length) { est.puntos = est.puntos.map((p) => ({ z: p.z * k, r: p.r * k })); est.origen.t0 *= k; }
    cambiarModo(est.eje ? 'contorno' : 'eje');
  });
  $('#escala-cancelar').addEventListener('click', () => { est.pend = []; formEscala.hidden = true; todo(); });

  // ================= IMAGEN =================
  function cargarImagen(url, nombre) {
    const img = new Image();
    img.onload = () => {
      guardar();
      Object.assign(est, { img, nombreImg: nombre, escala: null, eje: null, pend: [], puntos: [], origen: null, sel: -1 });
      // Píxeles para el imán: copia reducida a 3000 px de lado como mucho (un escaneo A3 a 600 ppp tiene
      // ~10 000 px y getImageData ocuparía 400 MB)
      const f = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
      const cg = c.getContext('2d', { willReadFrequently: true });
      cg.fillStyle = '#fff'; cg.fillRect(0, 0, c.width, c.height); cg.drawImage(img, 0, 0, c.width, c.height);
      try { est.pix = cg.getImageData(0, 0, c.width, c.height); est.pixF = f; }
      catch { est.pix = null; aviso('No se pueden leer los píxeles de esta imagen: el imán queda desactivado.'); }
      const base = nombre.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w\-]+/g, '-').slice(0, 40) || 'pieza';
      $('#nombre').value = base;
      vacio.hidden = true;
      ajustar();
      cambiarModo('escala');
    };
    img.onerror = () => aviso('No se pudo abrir «' + nombre + '» como imagen.');
    img.src = url;
  }
  function leerArchivo(f) {
    if (!f) return;
    if (!/^image\//.test(f.type) && !/\.svg$/i.test(f.name)) return aviso('«' + f.name + '» no es una imagen (PNG, JPG, WebP o SVG).');
    const lector = new FileReader();
    lector.onload = () => cargarImagen(String(lector.result), f.name);
    lector.readAsDataURL(f);   // data: URL → el lienzo no queda "manchado" y el imán puede leer los píxeles
  }
  $('#btn-abrir').addEventListener('click', () => { entrada.value = ''; entrada.click(); });
  entrada.addEventListener('change', () => leerArchivo(entrada.files[0]));
  $('#btn-ejemplo').addEventListener('click', () => cargarImagen('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(T.esquemaEjemplo.svg()), 'eje-ejemplo.svg'));
  // Arrastrar y soltar sobre la zona del esquema
  zona.addEventListener('dragover', (ev) => { ev.preventDefault(); zona.dataset.arrastrando = 'true'; });
  zona.addEventListener('dragleave', () => { zona.dataset.arrastrando = 'false'; });
  zona.addEventListener('drop', (ev) => { ev.preventDefault(); zona.dataset.arrastrando = 'false'; leerArchivo(ev.dataTransfer.files[0]); });

  // ================= VISTA: tamaño, zoom y desplazamiento =================
  let W = 1, H = 1;
  function medir() {
    const r = lienzo.getBoundingClientRect(), dpr = T.dprLimitado();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    lienzo.width = Math.round(W * dpr); lienzo.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function ajustar() {
    if (!est.img) return;
    const m = 16, s = Math.min((W - m * 2) / est.img.naturalWidth, (H - m * 2) / est.img.naturalHeight);
    est.vista = { s, ox: (W - est.img.naturalWidth * s) / 2, oy: (H - est.img.naturalHeight * s) / 2 };
    pintar();
  }
  function zoom(factor, cx = W / 2, cy = H / 2) {
    const v = est.vista, s = Math.min(40, Math.max(0.05, v.s * factor));
    // El punto bajo el cursor se queda quieto: o' = c − (c − o)·(s'/s)
    v.ox = cx - (cx - v.ox) * (s / v.s); v.oy = cy - (cy - v.oy) * (s / v.s); v.s = s;
    pintar();
  }
  const aImg = (cx, cy) => ({ x: (cx - est.vista.ox) / est.vista.s, y: (cy - est.vista.oy) / est.vista.s });
  const aPant = (p) => ({ x: p.x * est.vista.s + est.vista.ox, y: p.y * est.vista.s + est.vista.oy });
  new ResizeObserver(() => { const primera = W === 1; medir(); if (primera) ajustar(); else pintar(); }).observe(lienzo);

  // ---- ratón / dedo: clic = marcar; arrastrar = mover la imagen ----
  let arrastre = null;
  const local = (ev) => { const r = lienzo.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  lienzo.addEventListener('pointerdown', (ev) => {
    if (!est.img) return;
    try { lienzo.setPointerCapture(ev.pointerId); } catch { /* puntero sintético (pruebas): no pasa nada */ }
    const p = local(ev);
    arrastre = { x0: p.x, y0: p.y, ox: est.vista.ox, oy: est.vista.oy, movido: ev.button === 1 };
  });
  lienzo.addEventListener('pointermove', (ev) => {
    const p = local(ev);
    if (arrastre) {
      const dx = p.x - arrastre.x0, dy = p.y - arrastre.y0;
      if (!arrastre.movido && Math.hypot(dx, dy) > 5) arrastre.movido = true;   // umbral: un clic tembloroso no mueve la imagen
      if (arrastre.movido) { est.vista.ox = arrastre.ox + dx; est.vista.oy = arrastre.oy + dy; lienzo.dataset.modo = 'mover'; }
    }
    est.hover = est.img ? aImg(p.x, p.y) : null;
    pintar();
  });
  lienzo.addEventListener('pointerup', (ev) => {
    if (!arrastre) return;
    const a = arrastre; arrastre = null; lienzo.dataset.modo = '';
    if (a.movido || ev.button !== 0 || !formEscala.hidden) return;
    const p = aImg(local(ev).x, local(ev).y);
    if (est.modo === 'contorno') clicContorno(p); else clicDosPuntos(p);
  });
  lienzo.addEventListener('pointercancel', () => { arrastre = null; });
  lienzo.addEventListener('pointerleave', () => { est.hover = null; pintar(); });
  lienzo.addEventListener('wheel', (ev) => {
    if (!est.img) return;
    ev.preventDefault();                       // la rueda dentro del esquema hace zoom (como en un CAD), no desplaza la página
    const p = local(ev);
    zoom(Math.pow(1.0015, -ev.deltaY), p.x, p.y);
  }, { passive: false });
  document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    const z = b.dataset.zoom;
    if (z === 'ajustar') ajustar(); else zoom(z === '+' ? 1.25 : 0.8);
  }));

  // ================= MODOS Y TECLADO =================
  function cambiarModo(m) {
    est.modo = m; est.pend = []; formEscala.hidden = true;
    document.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === m)));
    todo(true);
  }
  document.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => cambiarModo(b.dataset.modo)));
  $('#btn-deshacer').addEventListener('click', deshacer);
  document.addEventListener('keydown', (ev) => {
    const enCampo = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !enCampo) { ev.preventDefault(); return deshacer(); }
    if (ev.key === 'Escape') { est.pend = []; formEscala.hidden = true; return todo(); }
    if (enCampo || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === '1') cambiarModo('escala');
    else if (ev.key === '2') cambiarModo('eje');
    else if (ev.key === '3') cambiarModo('contorno');
    else if (ev.key === '0') ajustar();
    else if (ev.key === '+') zoom(1.25);
    else if (ev.key === '-') zoom(0.8);
  });

  // ================= PINTAR EL ESQUEMA =================
  const css = (n, d) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;
  let colores = {};
  const leerColores = () => {
    colores = { acento: css('--acento', '#ff7a1a'), info: css('--info', '#5fb4ff'), ok: css('--ok', '#38d678'), mal: css('--mal', '#ff5a52'),
      fondo: css('--plano-fondo', '#0d161d'), rejilla: css('--plano-rejilla', '#15212a'), linea: css('--plano-linea', '#cfe3f1'),
      tenue: css('--plano-tenue', '#5b7184'), pieza: css('--plano-pieza', '#22384a'), eje: css('--plano-eje', '#ff9a4a'),
      cota: css('--plano-cota', '#7fc8ff'), cotaTexto: css('--plano-cota-texto', '#d9efff'), mono: css('--mono', 'monospace') };
  };
  leerColores();
  document.addEventListener('cambiotema', () => { leerColores(); pintar(); pintarPrevia(); });

  function etiqueta(x, y, texto, color) {
    g.font = '600 12px ' + colores.mono;
    const w = g.measureText(texto).width + 10;
    g.fillStyle = 'rgba(10,14,18,.82)'; g.fillRect(x, y - 15, w, 19);
    g.fillStyle = color; g.fillText(texto, x + 5, y - 1);
  }
  function marca(p, color, r = 4.5) {
    const q = aPant(p);
    g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fillStyle = color; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = '#0b0f12'; g.stroke();
  }
  function pintar() {
    g.clearRect(0, 0, W, H);
    if (!est.img) return;
    const v = est.vista;
    g.imageSmoothingEnabled = v.s < 2;            // con mucho zoom, píxeles nítidos (se ve dónde está la línea)
    g.drawImage(est.img, v.ox, v.oy, est.img.naturalWidth * v.s, est.img.naturalHeight * v.s);
    g.lineCap = 'round';

    // ---- escala ----
    if (est.escala) {
      const a = aPant(est.escala.a), b = aPant(est.escala.b);
      g.strokeStyle = colores.info; g.lineWidth = 2.5; g.setLineDash([]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      marca(est.escala.a, colores.info); marca(est.escala.b, colores.info);
      etiqueta((a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 6, num(est.escala.mm, 2) + ' mm', colores.info);
    }
    // ---- eje (se alarga por toda la imagen) ----
    if (est.eje) {
      const { a, u } = base(), L = Math.hypot(est.img.naturalWidth, est.img.naturalHeight);
      const p1 = aPant({ x: a.x - u.x * L, y: a.y - u.y * L }), p2 = aPant({ x: a.x + u.x * L, y: a.y + u.y * L });
      g.strokeStyle = colores.eje; g.lineWidth = 1.5; g.setLineDash([16, 5, 3, 5]);
      g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); g.setLineDash([]);
      marca(est.eje.a, colores.eje, 3.5); marca(est.eje.b, colores.eje, 3.5);
    }
    // ---- contorno marcado y su reflejo ----
    if (est.puntos.length && est.origen && est.eje && est.escala) {
      for (const lado of [-est.origen.lado, est.origen.lado]) {
        const pts = est.puntos.map((p) => aPant(aImagen(p, lado)));
        // Cierre con el eje en los extremos: así se ve la silueta completa que tendrá el sólido
        const e0 = aPant(aImagen({ z: est.puntos[0].z, r: 0 })), e1 = aPant(aImagen({ z: est.puntos.at(-1).z, r: 0 }));
        g.strokeStyle = colores.acento; g.lineWidth = lado === est.origen.lado ? 2.6 : 1.4;
        g.setLineDash(lado === est.origen.lado ? [] : [6, 4]);
        g.beginPath(); g.moveTo(e0.x, e0.y); pts.forEach((q) => g.lineTo(q.x, q.y)); g.lineTo(e1.x, e1.y); g.stroke();
      }
      g.setLineDash([]);
      est.puntos.forEach((p, i) => marca(aImagen(p), i === est.sel ? colores.ok : colores.acento, i === est.sel ? 6 : 4.5));
      if (est.sel >= 0 && est.puntos[est.sel]) {
        const q = aPant(aImagen(est.puntos[est.sel])), p = est.puntos[est.sel];
        etiqueta(q.x + 9, q.y - 9, '#' + (est.sel + 1) + '  Z ' + num(p.z, 2) + '  Ø' + num(2 * p.r, 2), colores.ok);
      }
    }
    // ---- clics a medias y "goma" hasta el ratón ----
    const h = est.hover;
    if (est.pend.length) {
      const a = aPant(est.pend[0]);
      marca(est.pend[0], est.modo === 'eje' ? colores.eje : colores.info);
      if (h && est.pend.length === 1) {
        const b = aPant(imantar(h));
        g.strokeStyle = est.modo === 'eje' ? colores.eje : colores.info; g.lineWidth = 1.5; g.setLineDash([5, 4]);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      }
    }
    if (h && est.modo === 'contorno' && est.escala && est.eje && !arrastre?.movido && !(est.puntos.length && !est.origen)) {
      const c = candidato(h);
      const o = est.origen;
      est.origen = c.origen;                                  // para dibujar el candidato con su mismo sistema
      const q = aPant(aImagen({ z: c.z, r: c.r }));
      if (est.puntos.length) {
        const u = aPant(aImagen(est.puntos.at(-1)));
        g.strokeStyle = c.motivo ? colores.mal : colores.acento; g.lineWidth = 1.5; g.setLineDash([5, 4]);
        g.beginPath(); g.moveTo(u.x, u.y); g.lineTo(q.x, q.y); g.stroke(); g.setLineDash([]);
      }
      g.strokeStyle = c.motivo ? colores.mal : colores.acento; g.lineWidth = 1.5;
      g.beginPath(); g.arc(q.x, q.y, 7, 0, Math.PI * 2); g.stroke();
      etiqueta(q.x + 10, q.y + 22, c.motivo ? 'no válido' : 'Z ' + num(c.z, 2) + '  Ø' + num(2 * c.r, 2), c.motivo ? colores.mal : colores.acento);
      est.origen = o;
    }
    // ---- lupa (esquina superior derecha): 4 aumentos alrededor del cursor ----
    if (h) {
      const tam = Math.min(150, W * 0.3), Z = 4, lado = tam / (est.vista.s * Z);
      const x = W - tam - 10, y = 10;
      g.save();
      g.beginPath(); g.rect(x, y, tam, tam); g.clip();
      g.fillStyle = '#fff'; g.fillRect(x, y, tam, tam);
      g.imageSmoothingEnabled = false;
      g.drawImage(est.img, h.x - lado / 2, h.y - lado / 2, lado, lado, x, y, tam, tam);
      g.strokeStyle = colores.acento; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + tam / 2, y); g.lineTo(x + tam / 2, y + tam); g.moveTo(x, y + tam / 2); g.lineTo(x + tam, y + tam / 2); g.stroke();
      g.restore();
      g.strokeStyle = colores.acento; g.lineWidth = 2; g.strokeRect(x, y, tam, tam);
    }
  }

  // ================= TABLA =================
  function tipoTramo(i) {
    if (i === 0) return 'inicio (plato)';
    const a = est.puntos[i - 1], b = est.puntos[i], L = b.z - a.z;
    if (Math.abs(L) < 1e-6) return b.r > a.r ? 'escalón ↑' : 'escalón ↓';
    if (Math.abs(b.r - a.r) < 1e-6) return 'cilindro ' + num(L, 2) + ' mm';
    const ang = (Math.atan(Math.abs(b.r - a.r) / L) * 180) / Math.PI;
    return (L <= 3 && Math.abs(ang - 45) < 1 ? 'chaflán ' : 'cono ') + num(L, 2) + ' mm · ' + num(ang, 1) + '°';
  }
  function pintarTabla() {
    const enfocado = document.activeElement?.dataset?.campo ? { i: document.activeElement.dataset.i, c: document.activeElement.dataset.campo } : null;
    tabla.replaceChildren();
    if (!est.puntos.length) {
      const tr = document.createElement('tr'); tr.className = 'gen__tabla-vacia';
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'Aún no hay puntos: márcalos en el esquema o añade tramos a mano.';
      tr.append(td); tabla.append(tr); return;
    }
    est.puntos.forEach((p, i) => {
      const tr = document.createElement('tr'); tr.dataset.sel = String(i === est.sel);
      const celda = (contenido) => { const td = document.createElement('td'); td.append(contenido); tr.append(td); return td; };
      celda(String(i + 1));
      for (const [campo, valor] of [['z', p.z], ['d', 2 * p.r]]) {
        const inp = document.createElement('input');
        Object.assign(inp, { type: 'number', step: '0.01', value: String(+valor.toFixed(3)) });
        inp.dataset.i = String(i); inp.dataset.campo = campo;
        inp.setAttribute('aria-label', (campo === 'z' ? 'Z' : 'Diámetro') + ' del punto ' + (i + 1));
        inp.addEventListener('focus', () => { est.sel = i; pintar(); tabla.querySelectorAll('tr').forEach((f, k) => (f.dataset.sel = String(k === i))); });
        inp.addEventListener('change', () => {
          const v = parseFloat(String(inp.value).replace(',', '.'));
          if (!isFinite(v) || (campo === 'd' && v <= 0)) { inp.value = String(+valor.toFixed(3)); return; }
          guardar();
          if (campo === 'z') est.puntos[i].z = v; else est.puntos[i].r = v / 2;
          todo(true);
        });
        celda(inp);
      }
      celda(tipoTramo(i)).className = 'tramo';
      const quitar = document.createElement('button');
      quitar.type = 'button'; quitar.textContent = '✕'; quitar.setAttribute('aria-label', 'Quitar el punto ' + (i + 1));
      quitar.addEventListener('click', () => { guardar(); est.puntos.splice(i, 1); if (!est.puntos.length) est.origen = null; est.sel = -1; todo(true); });
      celda(quitar);
      tabla.append(tr);
    });
    if (enfocado) tabla.querySelector('input[data-i="' + enfocado.i + '"][data-campo="' + enfocado.c + '"]')?.focus();
  }

  // Añadir un tramo escribiendo las cotas (sirve también sin imagen)
  $('#form-tramo').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const leerN = (id) => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) && v > 0 ? v : null; };
    const d0 = leerN('#tramo-d0'), d1 = leerN('#tramo-d1'), L = leerN('#tramo-l');
    const ult = est.puntos.at(-1);
    const inicio = d0 ?? (ult ? 2 * ult.r : null);
    if (!L || !inicio) return aviso(ult ? 'Escribe al menos la longitud del tramo.' : 'Para el primer tramo escribe el Ø inicial y la longitud.');
    guardar();
    if (!ult) est.puntos.push({ z: 0, r: inicio / 2 });
    else if (Math.abs(inicio / 2 - ult.r) > 1e-6) est.puntos.push({ z: ult.z, r: inicio / 2 });   // escalón
    const z0 = est.puntos.at(-1).z;
    est.puntos.push({ z: +(z0 + L).toFixed(4), r: (d1 ?? inicio) / 2 });
    $('#tramo-d0').value = ''; $('#tramo-d1').value = ''; $('#tramo-l').value = '';
    est.sel = est.puntos.length - 1;
    todo(true);
  });
  $('#btn-borrar').addEventListener('click', () => { if (!est.puntos.length) return; guardar(); est.puntos = []; est.origen = null; est.sel = -1; todo(true); aviso('Contorno borrado (Ctrl+Z lo recupera).'); });

  // ================= COMPROBACIONES =================
  function validar() {
    const P = est.puntos, out = [];
    const add = (nivel, texto) => out.push({ nivel, texto });
    if (P.length < 2) { add('mal', 'Faltan puntos: como mínimo dos (un cilindro).'); return out; }
    const atras = P.findIndex((p, i) => i && p.z < P[i - 1].z - 1e-6);
    if (atras > 0) add('mal', 'El punto ' + (atras + 1) + ' vuelve hacia el plato (su Z es menor que la del ' + atras + ').');
    if (Math.abs(P[1].z - P[0].z) < 1e-6) add('mal', 'El primer tramo es un escalón: el contorno debe empezar con un cilindro o un cono.');
    if (Math.abs(P.at(-1).z - P.at(-2).z) < 1e-6) add('mal', 'El último tramo es un escalón: el contorno debe acabar en un cilindro, un cono o un chaflán.');
    const L = P.at(-1).z - P[0].z, dMax = 2 * Math.max(...P.map((p) => p.r)), dMin = 2 * Math.min(...P.map((p) => p.r));
    add(dMax <= 2 * BARRA.R + 1e-6 ? 'ok' : 'aviso', 'Ø máximo ' + num(dMax, 2) + ' mm' + (dMax <= 2 * BARRA.R + 1e-6 ? ': cabe en la barra Ø50.' : ': no cabe en la barra Ø50 del torno (esos tramos quedarán en bruto).'));
    add(L <= BARRA.L ? 'ok' : 'aviso', 'Longitud ' + num(L, 2) + ' mm' + (L <= BARRA.L ? ' (máx. 136 en el torno).' : ': el torno solo llega a 136 mm desde la cara.'));
    add(dMin >= 2 * XMIN - 1e-6 ? 'ok' : 'aviso', 'Ø mínimo ' + num(dMin, 2) + ' mm' + (dMin >= 2 * XMIN - 1e-6 ? '.' : ': el torno no baja de Ø8 (se dejará a Ø8).'));
    // Ranura más estrecha que el filo: cilindro entre dos escalones (uno baja y otro sube) de menos de 1,2 mm
    for (let i = 1; i < P.length - 2; i++) {
      const largo = P[i + 1].z - P[i].z;
      if (largo > 1e-6 && largo < FILO && Math.abs(P[i].r - P[i + 1].r) < 1e-6 && P[i - 1].r > P[i].r && P[i + 2].r > P[i + 1].r) add('aviso', 'Ranura de ' + num(largo, 2) + ' mm (puntos ' + (i + 1) + '–' + (i + 2) + '): más estrecha que la cuchilla (1,2 mm), el torno no la podrá hacer entera.');
    }
    if (!out.some((c) => c.nivel === 'mal')) add('ok', P.length + ' puntos · ' + (P.length - 1) + ' tramos: listo para generar el .step.');
    return out;
  }

  // ================= VISTA PREVIA (plano de la pieza) =================
  let pW = 1, pH = 1;
  new ResizeObserver(() => {
    const r = previa.getBoundingClientRect(), dpr = T.dprLimitado();
    pW = Math.max(1, r.width); pH = Math.max(1, r.height);
    previa.width = Math.round(pW * dpr); previa.height = Math.round(pH * dpr);
    gp.setTransform(dpr, 0, 0, dpr, 0, 0);
    pintarPrevia();
  }).observe(previa);
  function pintarPrevia() {
    const c = colores, P = est.puntos;
    gp.fillStyle = c.fondo; gp.fillRect(0, 0, pW, pH);
    const zf = P.length ? P.at(-1).z : 100;             // la cara libre (derecha) coincide con la cara de la barra
    const Z0 = zf - BARRA.L - 6, Z1 = zf + 8, Rv = BARRA.R + 7;
    const esc = Math.min((pW - 20) / (Z1 - Z0), (pH - 34) / (2 * Rv));
    const ox = 10 - Z0 * esc + ((pW - 20) - (Z1 - Z0) * esc) / 2, oy = pH / 2 - 6;
    const X = (z) => ox + z * esc, Y = (r) => oy - r * esc;
    // rejilla de 5 mm
    gp.strokeStyle = c.rejilla; gp.lineWidth = 1; gp.beginPath();
    for (let z = Math.ceil(Z0 / 5) * 5; z <= Z1; z += 5) { gp.moveTo(X(z) + 0.5, 0); gp.lineTo(X(z) + 0.5, pH); }
    for (let r = -Rv; r <= Rv; r += 5) { gp.moveTo(0, Y(r) + 0.5); gp.lineTo(pW, Y(r) + 0.5); }
    gp.stroke();
    // barra del torno (discontinua)
    gp.setLineDash([6, 4]); gp.strokeStyle = c.tenue;
    gp.strokeRect(X(zf - BARRA.L), Y(BARRA.R), BARRA.L * esc, 2 * BARRA.R * esc); gp.setLineDash([]);
    if (P.length >= 2) {
      gp.beginPath(); gp.moveTo(X(P[0].z), Y(0));
      P.forEach((p) => gp.lineTo(X(p.z), Y(p.r))); gp.lineTo(X(P.at(-1).z), Y(0));
      for (let i = P.length - 1; i >= 0; i--) gp.lineTo(X(P[i].z), Y(-P[i].r));
      gp.closePath();
      gp.fillStyle = c.pieza; gp.fill(); gp.strokeStyle = c.linea; gp.lineWidth = 1.5; gp.stroke();
      // cotas de Ø de los cilindros (como mucho 6, sin pisarse)
      gp.font = '600 10px ' + c.mono; gp.textAlign = 'center';
      let ultimaX = -Infinity;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i];
        if (Math.abs(a.r - b.r) > 1e-6 || b.z - a.z < 2) continue;
        const xm = X((a.z + b.z) / 2);
        gp.strokeStyle = c.cota; gp.beginPath(); gp.moveTo(xm + 0.5, Y(a.r) + 1); gp.lineTo(xm + 0.5, Y(-a.r) - 1); gp.stroke();
        if (xm - ultimaX > 34) { gp.fillStyle = c.cotaTexto; gp.fillText('Ø' + num(2 * a.r, 1), xm, Y(BARRA.R) - 4); ultimaX = xm; }
      }
      // longitud total
      const yT = Y(-BARRA.R) + 14;
      gp.strokeStyle = c.cota; gp.beginPath(); gp.moveTo(X(P[0].z), yT); gp.lineTo(X(zf), yT); gp.stroke();
      gp.fillStyle = c.cotaTexto; gp.fillText(num(zf - P[0].z, 2) + ' mm', X((P[0].z + zf) / 2), yT + 11);
    } else if (P.length === 1) {
      gp.fillStyle = c.acento; gp.beginPath(); gp.arc(X(P[0].z), Y(P[0].r), 3, 0, Math.PI * 2); gp.fill();
    }
    // eje
    gp.setLineDash([14, 4, 3, 4]); gp.strokeStyle = c.eje; gp.beginPath(); gp.moveTo(0, oy + 0.5); gp.lineTo(pW, oy + 0.5); gp.stroke(); gp.setLineDash([]);
    gp.textAlign = 'left'; gp.fillStyle = c.tenue; gp.font = '10px ' + c.mono;
    gp.fillText('plato ←', 6, 12); gp.textAlign = 'right'; gp.fillText('→ cara', pW - 6, 12);
  }

  // ================= DESCARGAR EL .step =================
  btnDescargar.addEventListener('click', () => {
    const nombre = ($('#nombre').value.trim().replace(/[^\w\-]+/g, '-') || 'pieza').slice(0, 40);
    try {
      // Z = 0 en el extremo del plato: el STEP va de z = 0 (plato) a z = L (cara libre), eje de revolución Z
      const z0 = est.puntos[0].z;
      const texto = T.step.escribir(est.puntos.map((p) => ({ z: p.z - z0, r: p.r })), { nombre, descripcion: 'Pieza de revolucion generada desde ' + (est.nombreImg || 'cotas') });
      const comprobacion = T.step.leer(texto);                 // se relee con el lector del torno: si falla aquí, fallaría allí
      const blob = new Blob([texto], { type: 'application/step' });
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = nombre + '.step';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      est.descargas++; est.ultimoStep = texto;
      const caras = (texto.match(/ADVANCED_FACE/g) || []).length;
      $('#estado-descarga').textContent = 'Descargado ' + nombre + '.step (' + num(texto.length / 1024, 1) + ' kB, ' + caras + ' caras, L ' + num(comprobacion.largo, 2) +
        ' mm). En el torno: «Cargar pieza (.step)…» en la tarjeta Perfil de la pieza.';
      todo();
    } catch (err) {
      $('#estado-descarga').textContent = 'No se pudo generar el .step: ' + err.message;
    }
  });

  // ================= AYUDA, PASOS Y REFRESCO GENERAL =================
  let avisoHasta = 0;
  function aviso(texto) { ayuda.textContent = texto; ayuda.dataset.nivel = 'aviso'; avisoHasta = performance.now() + 4000; }
  function textoAyuda() {
    if (!est.img) return est.puntos.length ? 'Sin imagen: estás construyendo la pieza con la tabla. Puedes abrir un esquema cuando quieras.' : 'Paso 1: abre la imagen del esquema (o pulsa «Usar el ejemplo»). También puedes escribir los tramos a mano en la tabla.';
    if (est.modo === 'escala') {
      if (!formEscala.hidden) return 'Escribe cuántos mm indica esa cota en el plano y pulsa Aceptar.';
      return est.pend.length ? 'Ahora haz clic en el OTRO extremo de la misma cota.' : 'Paso 2 · Escala: haz clic en un extremo de una cota que conozcas. Cuanto más larga, mejor (la longitud total es ideal).';
    }
    if (est.modo === 'eje') return est.pend.length ? 'Ahora haz clic sobre el eje cerca del OTRO extremo de la pieza (cuanto más separados, más recto).' : 'Paso 3 · Eje: haz clic sobre la línea de trazo y punto, cerca de un extremo de la pieza.';
    if (!est.puntos.length) return 'Paso 4 · Contorno: haz clic en la esquina SUPERIOR del extremo del plato (izquierda) y sigue esquina a esquina hacia la cara libre. Los extremos se cierran solos con el eje.';
    const p = est.puntos.at(-1);
    return 'Punto ' + est.puntos.length + ': Z ' + num(p.z, 2) + ' · Ø' + num(2 * p.r, 2) + '. Sigue con la siguiente esquina; al terminar, corrige las cotas en la tabla y descarga el .step.';
  }
  function pintarPasos(comprob) {
    const hecho = {
      imagen: !!est.img || est.puntos.length > 0, escala: !!est.escala || (!est.img && est.puntos.length > 0),
      eje: !!est.eje || (!est.img && est.puntos.length > 0), contorno: est.puntos.length >= 2 && !comprob.some((c) => c.nivel === 'mal'),
      exportar: est.descargas > 0,
    };
    let actual = false;
    document.querySelectorAll('#pasos li').forEach((li) => {
      const h = hecho[li.dataset.paso];
      li.dataset.estado = h ? 'hecho' : actual ? '' : 'actual';
      if (!h) actual = true;
    });
  }
  function todo(tablaTambien = false) {
    if (tablaTambien) pintarTabla();
    const comprob = validar();
    lista.replaceChildren(...comprob.map((c) => { const li = document.createElement('li'); li.dataset.nivel = c.nivel; li.textContent = c.texto; return li; }));
    btnDescargar.disabled = comprob.some((c) => c.nivel === 'mal');
    $('#escala-info').textContent = est.escala ? num(pxmm(), 2) + ' px/mm' + (est.eje ? ' · eje ' + num((Math.atan2(est.eje.b.y - est.eje.a.y, est.eje.b.x - est.eje.a.x) * 180) / Math.PI, 2) + '°' : '') : 'Sin escala';
    if (performance.now() > avisoHasta) { ayuda.textContent = textoAyuda(); ayuda.dataset.nivel = ''; }
    pintarPasos(comprob);
    pintar(); pintarPrevia();
  }
  cambiarModo('escala');

  // ================= GANCHOS PARA LA VERIFICACIÓN AUTOMÁTICA =================
  // Permiten a la prueba (prueba-generador.js) hacer clic en un punto CONCRETO de la imagen.
  window.__generador = {
    aPantalla: (x, y) => { const r = lienzo.getBoundingClientRect(), q = aPant({ x, y }); return { x: r.left + q.x, y: r.top + q.y }; },
    estado: () => ({ imagen: !!est.img, pix: !!est.pix, pxmm: pxmm(), eje: !!est.eje, modo: est.modo, puntos: structuredClone(est.puntos),
      errores: validar().filter((c) => c.nivel === 'mal').length, descargas: est.descargas, ultimoStep: est.ultimoStep }),
  };
  window.__verificacion = () => { const s = window.__generador.estado(); delete s.ultimoStep; return { generador: s }; };
})();
