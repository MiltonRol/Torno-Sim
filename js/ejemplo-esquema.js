// ejemplo-esquema.js — un ESQUEMA DE EJEMPLO (plano de un eje escalonado en SVG) para practicar el generador
// y para las figuras del tutorial. Va como texto en JS (y no solo como archivo .svg) por una razón:
// con doble clic (file://) una imagen cargada desde el disco "mancha" el lienzo y el imán no podría leer
// sus píxeles; una imagen hecha desde un texto (data:) no lo mancha. El mismo dibujo está en
// ejemplos/eje-ejemplo.svg para practicar abriéndolo con la ventana de archivos.
(() => {
  // Perfil exacto (z desde el extremo del plato, r = radio) en mm: es la "solución" del ejemplo
  const perfil = [
    { z: 0, r: 22 }, { z: 30, r: 22 }, { z: 30, r: 18 }, { z: 55, r: 18 }, { z: 55, r: 15 }, { z: 60, r: 15 },
    { z: 60, r: 18 }, { z: 75, r: 18 }, { z: 85, r: 14 }, { z: 99, r: 14 }, { z: 100, r: 13 },
  ];
  // Geometría del dibujo: 4 px por mm, eje horizontal en y = 170, extremo del plato en x = 80
  const ESC = 4, X0 = 80, Y0 = 170, ANCHO = 600, ALTO = 360;
  const X = (z) => X0 + z * ESC, Y = (r) => Y0 - r * ESC;

  function svg() {
    const L = [];
    const linea = (x1, y1, x2, y2, extra = '') => L.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" ' + extra + '/>');
    const texto = (x, y, t, extra = '') => L.push('<text x="' + x + '" y="' + y + '" ' + extra + '>' + t + '</text>');
    // contorno superior e inferior (línea gruesa, como en un plano)
    const arriba = perfil.map((p) => X(p.z) + ',' + Y(p.r)).join(' ');
    const abajo = perfil.map((p) => X(p.z) + ',' + Y(-p.r)).join(' ');
    L.push('<polyline class="c" points="' + arriba + '"/>', '<polyline class="c" points="' + abajo + '"/>');
    // aristas verticales (cada cambio de sección se ve como una línea de arriba abajo) y extremos
    const zs = [...new Set(perfil.map((p) => p.z))];
    for (const z of zs) {
      const rs = perfil.filter((p) => p.z === z).map((p) => p.r), r = Math.max(...rs);
      linea(X(z), Y(r), X(z), Y(-r), 'class="c"');
    }
    // eje de simetría (trazo y punto) que sobresale por los dos lados
    linea(X(-8), Y0, X(108), Y0, 'class="eje"');
    // cotas de diámetro: líneas verticales con flechas y el texto girado
    const diam = [[15, 22], [42.5, 18], [57.5, 15], [67.5, 18], [92, 14]];
    for (const [z, r] of diam) {
      linea(X(z), Y(r), X(z), Y(-r), 'class="cota" marker-start="url(#f)" marker-end="url(#f)"');
      texto(X(z) - 4, Y0 + 2, 'Ø' + 2 * r, 'class="t" transform="rotate(-90 ' + (X(z) - 4) + ' ' + (Y0 + 2) + ')" text-anchor="middle"');
    }
    // cotas de longitud parciales (arriba) y total (abajo)
    const parciales = [[0, 30], [30, 55], [55, 60], [60, 75], [75, 85], [85, 100]];
    const yP = Y(26);
    for (const [a, b] of parciales) {
      linea(X(a), yP, X(b), yP, 'class="cota" marker-start="url(#f)" marker-end="url(#f)"');
      texto((X(a) + X(b)) / 2, yP - 5, String(b - a), 'class="t" text-anchor="middle"');
    }
    for (const z of [0, 30, 55, 60, 75, 85, 100]) linea(X(z), yP - 6, X(z), Y(Math.max(...perfil.filter((p) => p.z === z || (z === 100 && p.z === 99)).map((p) => p.r))) - 3, 'class="ref"');
    const yT = Y(-30);
    linea(X(0), yT, X(100), yT, 'class="cota" marker-start="url(#f)" marker-end="url(#f)"');
    texto(X(50), yT - 5, '100', 'class="t" text-anchor="middle"');
    linea(X(0), Y(-22) + 3, X(0), yT + 6, 'class="ref"'); linea(X(100), Y(-13) + 3, X(100), yT + 6, 'class="ref"');
    // nota del chaflán y del cono
    linea(X(100), Y(13.5), X(108), Y(19), 'class="ref"'); texto(X(108) + 2, Y(19) - 2, '1×45°', 'class="t"');
    texto(X(80), Y(-19) + 14, 'cono', 'class="t peq" text-anchor="middle"');
    // cajetín
    L.push('<rect class="caja" x="' + (ANCHO - 230) + '" y="' + (ALTO - 52) + '" width="220" height="42"/>');
    texto(ANCHO - 222, ALTO - 34, 'EJE ESCALONADO · ejemplo', 'class="t b"');
    texto(ANCHO - 222, ALTO - 18, 'Acero F-1140 · cotas en mm · Ra 3,2', 'class="t peq"');
    texto(16, 26, 'Lado del plato ←', 'class="t peq"');
    texto(ANCHO - 120, 26, '→ Cara libre', 'class="t peq"');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + ANCHO + ' ' + ALTO + '" width="' + ANCHO * 2 + '" height="' + ALTO * 2 + '">' +
      '<defs><marker id="f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1.5 L10 5 L0 8.5 Z" fill="#1a1a1a"/></marker></defs>' +
      '<style>.c{fill:none;stroke:#111;stroke-width:2.2;stroke-linejoin:round}.eje{stroke:#111;stroke-width:.8;stroke-dasharray:14 3 2 3}' +
      '.cota{stroke:#1a1a1a;stroke-width:.8}.ref{stroke:#1a1a1a;stroke-width:.6}.t{font:12px Arial,Helvetica,sans-serif;fill:#111}.peq{font-size:10px}.b{font-weight:bold}' +
      '.caja{fill:none;stroke:#111;stroke-width:1}</style>' +
      '<rect width="100%" height="100%" fill="#fbfaf6"/>' + L.join('') + '</svg>';
  }

  window.Torno = Object.assign(window.Torno || {}, { esquemaEjemplo: { perfil, svg, ESC, X0, Y0, ANCHO, ALTO } });
})();
