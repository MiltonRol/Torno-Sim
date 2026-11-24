// perfil2d.js — el PLANO de la pieza en Canvas 2D, como un dibujo técnico: eje de trazo y punto, barra en bruto
// discontinua, perfil mecanizado, garras rayadas, cuchilla, punto del contrapunto, cotas de diámetro y cajetín.
// Se usa en dos sitios: la tarjeta "Perfil de la pieza" (con los datos de la telemetría remota) y, si el
// navegador no tiene WebGL2, en el hueco del gemelo 3D como alternativa (iniciarVistaPlano).
(() => {
  const { createTimer } = anime;
  const { DATOS, num, entero, dprLimitado, alVerse } = window.Torno;
  const { PIEZA, DZ, CONTACTO } = DATOS;

  // Tramos de diámetro constante (mecanizados y de al menos 3 mm): son los que llevan cota
  function tramos(radios) {
    const out = [];
    let ini = 0;
    for (let i = 1; i <= PIEZA.N; i++) {
      if (i === PIEZA.N || Math.abs(radios[i] - radios[ini]) > 0.02) {
        const r = radios[ini], largo = (i - ini) * DZ;
        if (r < PIEZA.R - 0.05 && largo >= 3) out.push({ x0: -PIEZA.L + ini * DZ, x1: -PIEZA.L + i * DZ, r, largo });
        ini = i;
      }
    }
    return out;
  }

  // Dibuja el plano. d = { radios, z, x, c, plato, numero, quitado, rpm?, angulo? } (foto plana)
  function dibujarPlano(g, w, h, d, colores, vista) {
    const X0 = -178, X1 = vista ? 75 : 48;                  // ventana en mm (en la vista grande cabe más)
    const mx = 18, my = 26;
    const esc = Math.min((w - mx * 2) / (X1 - X0), (h - my * 2 - 30) / ((PIEZA.R + 16) * 2));
    const ox = mx - X0 * esc, oy = (h - 30) / 2 + 6;        // origen: eje de la pieza en Z = 0
    const px = (x) => ox + x * esc, py = (r) => oy + r * esc;

    g.fillStyle = colores.fondo; g.fillRect(0, 0, w, h);
    // papel milimetrado tenue (cada 5 mm)
    g.strokeStyle = colores.rejilla; g.lineWidth = 1; g.beginPath();
    for (let x = Math.ceil(X0 / 5) * 5; x <= X1; x += 5) { g.moveTo(px(x) + 0.5, 0); g.lineTo(px(x) + 0.5, h); }
    for (let r = -60; r <= 60; r += 5) { g.moveTo(0, py(r) + 0.5); g.lineTo(w, py(r) + 0.5); }
    g.stroke();

    // garras (rayado de corte) y cara del plato
    const abre = d.plato ? 0 : 14;
    const rayado = (x0, y0, x1, y1) => {
      g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
      g.fillStyle = colores.garra; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = colores.linea; g.lineWidth = 1; g.beginPath();
      for (let k = -h; k < w; k += 6) { g.moveTo(k, y1); g.lineTo(k + (y1 - y0), y0); }
      g.stroke(); g.restore();
      g.strokeStyle = colores.linea; g.lineWidth = 1.5; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    };
    rayado(px(-178), py(-80), px(-165), py(80));
    rayado(px(-165), py(-52 - abre), px(-140), py(-PIEZA.R - abre));
    rayado(px(-165), py(PIEZA.R + abre), px(-140), py(52 + abre));

    // barra en bruto (discontinua) y perfil mecanizado (relleno + contorno)
    g.setLineDash([6, 4]); g.strokeStyle = colores.tenue; g.lineWidth = 1;
    g.strokeRect(px(-PIEZA.L), py(-PIEZA.R), PIEZA.L * esc, PIEZA.R * 2 * esc);
    g.setLineDash([]);
    if (d.radios) {
      g.beginPath();
      g.moveTo(px(-PIEZA.L), py(-d.radios[0]));
      for (let i = 0; i < PIEZA.N; i++) { const r = d.radios[i]; g.lineTo(px(-PIEZA.L + i * DZ), py(-r)); g.lineTo(px(-PIEZA.L + (i + 1) * DZ), py(-r)); }
      for (let i = PIEZA.N - 1; i >= 0; i--) { const r = d.radios[i]; g.lineTo(px(-PIEZA.L + (i + 1) * DZ), py(r)); g.lineTo(px(-PIEZA.L + i * DZ), py(r)); }
      g.closePath();
      g.fillStyle = colores.pieza; g.fill();
      g.strokeStyle = colores.linea; g.lineWidth = 1.6; g.stroke();
    }
    // PIEZA CARGADA (.step): su contorno a cota en naranja discontinuo, arriba y abajo del eje.
    // Donde la cuchilla se ha pasado de cota (radio real < objetivo − 0,1) se pinta una marca roja.
    if (d.objetivo) {
      const o = d.objetivo;
      g.setLineDash([5, 3]); g.strokeStyle = colores.acento; g.lineWidth = 1.6;
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(px(-PIEZA.L), py(s * o[0]));
        for (let i = 0; i < PIEZA.N; i++) { g.lineTo(px(-PIEZA.L + i * DZ), py(s * o[i])); g.lineTo(px(-PIEZA.L + (i + 1) * DZ), py(s * o[i])); }
        g.stroke();
      }
      g.setLineDash([]);
      if (d.radios) {
        g.fillStyle = colores.mal;
        for (let i = 0; i < PIEZA.N; i++) if (d.radios[i] < o[i] - 0.1) {
          for (const s of [-1, 1]) g.fillRect(px(-PIEZA.L + i * DZ), py(s * o[i]) - 2, Math.max(2, DZ * esc), 4);
        }
      }
    }
    // eje de simetría (trazo y punto)
    g.setLineDash([16, 4, 3, 4]); g.strokeStyle = colores.eje; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px(X0), py(0) + 0.5); g.lineTo(px(X1), py(0) + 0.5); g.stroke();
    g.setLineDash([]);

    // cotas de diámetro (como mucho 5, sin que se pisen las etiquetas)
    const lista = d.radios ? tramos(d.radios).sort((a, b) => b.largo - a.largo).slice(0, 5).sort((a, b) => a.x0 - b.x0) : [];
    g.font = '600 11px ' + colores.mono; g.textAlign = 'center'; g.textBaseline = 'bottom';
    let ultimaX = -Infinity;
    for (const t of lista) {
      const xm = px((t.x0 + t.x1) / 2);
      g.strokeStyle = colores.cota; g.fillStyle = colores.cota; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xm + 0.5, py(-t.r) + 2); g.lineTo(xm + 0.5, py(t.r) - 2); g.stroke();
      for (const [y, s] of [[py(-t.r), 1], [py(t.r), -1]]) {     // puntas de flecha
        g.beginPath(); g.moveTo(xm, y); g.lineTo(xm - 3, y + 7 * s); g.lineTo(xm + 3, y + 7 * s); g.closePath(); g.fill();
      }
      if (xm - ultimaX > 48) {
        g.fillStyle = colores.cotaTexto; g.fillText('Ø' + num(2 * t.r, 2), xm, py(-PIEZA.R) - 5);
        ultimaX = xm;
      }
    }

    // punto del contrapunto
    const xp = CONTACTO - d.c;
    if (xp < X1) {
      g.fillStyle = colores.tenue; g.strokeStyle = colores.linea; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(px(xp), py(0)); g.lineTo(px(xp + 35), py(-17)); g.lineTo(px(xp + 35), py(17)); g.closePath(); g.fill(); g.stroke();
      g.fillRect(px(xp + 35), py(-25), px(X1) - px(xp + 35), 50 * esc);
    }
    // cuchilla: llega desde DELANTE (abajo en esta vista en planta) con la punta en (Z, X)
    const tx = px(d.z), ty = py(d.x);
    g.fillStyle = colores.acento; g.strokeStyle = colores.linea; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + 9 * Math.max(1, esc / 2.2), ty + 14 * Math.max(1, esc / 2.2)); g.lineTo(tx - 2, ty + 14 * Math.max(1, esc / 2.2)); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = colores.htaMango; g.fillRect(tx - 2, ty + 14 * Math.max(1, esc / 2.2), 18 * Math.max(1, esc / 2.2), h);

    // cajetín
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const filas = ['TR-01 · Pieza nº ' + d.numero + (d.nombre ? ' · ' + d.nombre : ''), 'Bruto Ø50 × 140 · acero F-1140', 'Viruta: ' + num((d.quitado || 0) / 1000, 1) + ' cm³'];
    if (vista) filas.unshift('S ' + entero(d.rpm || 0) + ' rpm · X Ø' + num(2 * d.x, 2) + ' · Z' + num(d.z, 2, true));
    const ancho = 236, alto = filas.length * 15 + 10;
    g.fillStyle = colores.fondo; g.strokeStyle = colores.linea; g.lineWidth = 1;
    // Arriba a la derecha: abajo es por donde llega la cuchilla (vista en planta, el operario está abajo)
    g.fillRect(w - ancho - 8, 8, ancho, alto); g.strokeRect(w - ancho - 7.5, 8.5, ancho, alto);
    g.fillStyle = colores.cotaTexto; g.font = '11px ' + colores.mono;
    filas.forEach((f, k) => g.fillText(f, w - ancho, 24 + k * 15));
    return lista;
  }

  function leerColores() {
    const cs = getComputedStyle(document.documentElement), v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return {
      fondo: v('--plano-fondo', '#0f1820'), rejilla: v('--plano-rejilla', '#16222c'), linea: v('--plano-linea', '#cfe3f1'),
      tenue: v('--plano-tenue', '#5b7184'), pieza: v('--plano-pieza', '#243848'), garra: v('--plano-garra', '#1a2731'),
      eje: v('--plano-eje', '#ff9a4a'), cota: v('--plano-cota', '#7fc8ff'), cotaTexto: v('--plano-cota-texto', '#d9efff'),
      acento: v('--acento', '#ff7a1a'), mal: v('--mal', '#ff5a52'), htaMango: v('--plano-mango', '#3b4a56'), mono: v('--mono', 'monospace'),
    };
  }

  // Lienzo con su tamaño en píxeles reales (DPR limitado) y redibujo bajo demanda
  function crearLienzo(canvas, alDibujar) {
    const g = canvas.getContext('2d');
    let w = 1, h = 1;
    const ajustar = () => {
      const r = canvas.getBoundingClientRect(), dpr = dprLimitado();
      w = Math.max(1, r.width); h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      alDibujar();
    };
    const ro = new ResizeObserver(ajustar); ro.observe(canvas);
    return { g, tam: () => [w, h], destruir: () => ro.disconnect() };
  }

  // ---------- tarjeta "Perfil de la pieza": se alimenta de la telemetría remota ----------
  function iniciarPerfil({ remoto, objetivo, informar }) {
    const canvas = document.querySelector('#lienzo-perfil'), lista = document.querySelector('#perfil-tramos');
    let colores = leerColores(), ultima = null, clave = '', cotas = [];
    const pintar = () => {
      if (!ultima) { const [w, h] = lz.tam(); lz.g.fillStyle = colores.fondo; lz.g.fillRect(0, 0, w, h); return; }
      const [w, h] = lz.tam();
      // La pieza cargada no viaja en la trama (es del panel, no de la máquina): se añade al dibujar
      cotas = dibujarPlano(lz.g, w, h, { ...ultima, objetivo: objetivo?.radios, nombre: objetivo?.nombre }, colores, false);
    };
    const lz = crearLienzo(canvas, pintar);
    const baja = remoto.on('trama', (f) => {
      // Solo se redibuja si algo cambió (perfil, ejes o caña): 10 tramas/s sin cambios no cuestan nada
      const k = f.version + '|' + (objetivo?.version || 0) + '|' + f.z.toFixed(2) + '|' + f.x.toFixed(2) + '|' + f.c.toFixed(1) + '|' + f.plato + '|' + f.numero;
      ultima = f;
      if (k === clave) return;
      clave = k; pintar();
      const texto = cotas.length ? cotas.map((t) => 'Ø' + num(2 * t.r, 2) + ' × ' + num(t.largo, 1) + ' mm').join(' · ') : 'barra en bruto Ø50,00 (sin mecanizar)';
      if (lista.textContent !== texto) lista.textContent = texto;
      canvas.setAttribute('aria-label', 'Plano de la pieza nº ' + f.numero + ': ' + texto);
    });
    const alTema = () => { colores = leerColores(); pintar(); };
    document.addEventListener('cambiotema', alTema);
    const bajaObj = objetivo ? objetivo.on(() => { clave = ''; pintar(); }) : () => {};   // cargar/voltear/quitar: redibujar ya
    pintar();
    informar('perfil', () => ({ tramos: cotas.length }));
    return { destruir() { baja(); bajaObj(); lz.destruir(); document.removeEventListener('cambiotema', alTema); } };
  }

  // ---------- alternativa del gemelo: el plano a tamaño grande, en vivo ----------
  function iniciarVistaPlano({ remoto, objetivo, informar }, motivo) {
    const canvas = document.querySelector('#lienzo-plano');
    canvas.hidden = false;
    document.querySelector('#estado-3d').textContent = 'Vista alternativa en 2D (' + motivo + '): plano en planta en tiempo real.';
    document.querySelectorAll('.etiqueta').forEach((e) => { e.hidden = true; });
    let colores = leerColores(), frames = 0;
    const pintar = () => {
      const s = remoto.vista(), [w, h] = lz.tam();
      dibujarPlano(lz.g, w, h, { radios: s.pieza.radios, z: s.ejes.z, x: s.ejes.x, c: s.ejes.c, plato: s.plato.cerrado,
        numero: s.pieza.numero, quitado: s.pieza.quitado, rpm: Math.abs(s.husillo.rpm), objetivo: objetivo?.radios, nombre: objetivo?.nombre }, colores, true);
    };
    const lz = crearLienzo(canvas, pintar);
    const reloj = createTimer({ frameRate: 30, onUpdate: () => { pintar(); frames++; } });
    const dejar = alVerse(canvas, (v) => (v ? reloj.resume() : reloj.pause()));
    const alTema = () => { colores = leerColores(); };
    document.addEventListener('cambiotema', alTema);
    informar('escena3d', () => ({ modo: '2d', motivo, frames }));
    return { destruir() { reloj.cancel(); dejar(); lz.destruir(); document.removeEventListener('cambiotema', alTema); } };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarPerfil, iniciarVistaPlano });
})();
