// main.js — punto de entrada (el ÚLTIMO script de index.html).
// Detecta el soporte, aplica el tema, crea UN scope de Anime.js con la media query de movimiento reducido y
// arranca la máquina simulada, el enlace remoto y cada módulo de la página. Si cambia la preferencia de
// movimiento, el scope lo revierte todo y vuelve a ejecutar el constructor desde cero.
(() => {
  const { createScope, animate, stagger } = anime;
  const T = window.Torno;
  const soporte = T.detectarSoporte();
  // index.html#2d fuerza la vista alternativa (plano 2D) aunque haya WebGL2: sirve para comprobarla
  if (/(?:^#|[&,+])2d(?=$|[&,+])/.test(location.hash)) { soporte.webgl2 = false; soporte.forzado2d = true; }
  const informes = {};
  // Gancho para el verificador de la skill web-creativa: estado de cada módulo
  window.__verificacion = () => ({ soporte, ...Object.fromEntries(Object.entries(informes).map(([k, v]) => [k, typeof v === 'function' ? v() : v])) });

  // ---- tema claro/oscuro: por defecto el del sistema; el botón lo fija y se recuerda ----
  const raiz = document.documentElement, btnTema = document.querySelector('#btn-tema');
  const leerGuardado = () => { try { return localStorage.getItem('torno-tema'); } catch { return null; } };
  function ponerTema(tema, guardar) {
    raiz.dataset.tema = tema;
    btnTema.setAttribute('aria-pressed', String(tema === 'claro'));
    btnTema.querySelector('.tema__texto').textContent = tema === 'claro' ? 'Tema claro' : 'Tema oscuro';
    if (guardar) { try { localStorage.setItem('torno-tema', tema); } catch { /* file:// sin almacenamiento: no pasa nada */ } }
    // Los lienzos leen sus colores de variables CSS: se les avisa cuando el CSS ya está aplicado
    requestAnimationFrame(() => document.dispatchEvent(new Event('cambiotema')));
  }
  // index.html#claro / #oscuro fuerza el tema sin guardarlo (para presentar o comprobar la web)
  const temaUrl = /(?:^#|[&,+])(claro|oscuro)(?=$|[&,+])/.exec(location.hash)?.[1];
  ponerTema(temaUrl || leerGuardado() || (matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro'), false);
  btnTema.addEventListener('click', () => ponerTema(raiz.dataset.tema === 'claro' ? 'oscuro' : 'claro', true));

  createScope({ mediaQueries: { reducido: '(prefers-reduced-motion: reduce)' } }).add((scope) => {
    const reducido = scope.matches.reducido;
    const maquina = T.crearMaquina({ reducido });          // el mock
    const remoto = T.crearRemoto({ maquina, reducido });   // la red simulada entre la máquina y el panel
    const objetivo = T.crearObjetivo();                    // la pieza cargada desde un .step (vacía al principio)
    const ctx = { reducido, soporte, maquina, remoto, objetivo, informar: (k, v) => (informes[k] = v) };
    informes.maquina = () => {
      const e = maquina.estado;
      return { etapa: e.etapa, rpm: Math.round(e.husillo.rpm), z: +e.ejes.z.toFixed(2), x: +e.ejes.x.toFixed(2), c: +e.ejes.c.toFixed(1),
        quitado: Math.round(e.pieza.quitado), piezas: e.cont.piezas, alarma: e.alarma ? e.alarma.codigo : null };
    };
    const iniciadores = [T.iniciarEnlace, T.iniciarTelemetria, T.iniciarRegistro, T.iniciarGrafcet, T.iniciarObjetivo, T.iniciarPerfil,
      T.iniciarEscena3d, T.iniciarBotonera, T.iniciarManivelas, T.iniciarDemo, T.iniciarSonido];
    const modulos = iniciadores.map((iniciar) => {
      try { return iniciar(ctx); } catch (err) { console.error('[' + iniciar.name + ']', err); return null; }   // uno roto no tumba el resto
    });
    // Con todos escuchando: apretón de manos de la red y encendido de la máquina (prueba de lámparas y referencia)
    remoto.iniciar();
    maquina.encender();
    if (!reducido) animate('.tarjeta', { opacity: [0, 1], y: [18, 0], duration: 700, delay: stagger(70, { start: 120 }), ease: 'out(3)' });
    // Atajos por URL para presentar la web: index.html#demo (arranca el ciclo) y #corte (cámara en la zona de corte)
    const atajos = location.hash.slice(1).split(/[&,+]/);
    const temporizadorAtajos = setTimeout(() => {
      if (atajos.includes('corte')) modulos[iniciadores.indexOf(T.iniciarEscena3d)]?.irVista?.('corte');
      if (atajos.includes('demo')) document.querySelector('#btn-demo').click();
    }, reducido ? 600 : 3400);
    return () => { clearTimeout(temporizadorAtajos); modulos.forEach((m) => m?.destruir()); remoto.destruir(); maquina.destruir(); };
  });
})();
