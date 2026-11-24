// objetivo.js — la PIEZA A MECANIZAR cargada desde un archivo .step (botón "Cargar pieza" del perfil).
//   · crearObjetivo(): almacén con el perfil objetivo (un radio por muestra de la barra) y un emisor de cambios.
//     Lo leen el plano 2D (contorno a cota), el gemelo 3D (sobremetal en color) y el ciclo demo (pasadas).
//   · iniciarObjetivo(ctx): el botón, la ventana de búsqueda de archivos (<input type="file">), voltear,
//     quitar y la línea de progreso (% hecho, sobremetal y cotas pasadas) con los datos de la telemetría.
// El archivo se lee con FileReader: funciona con DOBLE CLIC (file://) porque es el usuario quien lo elige;
// fetch() de un archivo local estaría bloqueado por el navegador.
(() => {
  const { num } = window.Torno;

  function crearObjetivo() {
    const oyentes = new Set();
    const o = {
      nombre: null, radios: null, lectura: null, voltear: false, avisos: [], version: 0,
      on(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
      // Guarda una lectura de step.leer() y la convierte a las muestras de la máquina
      poner(nombre, lectura, voltear = false) {
        const { PIEZA, LIM } = window.Torno.DATOS;
        const m = window.Torno.step.aMaquina(lectura, PIEZA, { voltear });
        // El torno no baja de Ø8 (tope X): lo que el plano pida por debajo se deja a ese diámetro
        for (let i = 0; i < m.radios.length; i++) m.radios[i] = Math.max(LIM.xMin, m.radios[i]);
        Object.assign(o, { nombre, lectura, voltear, radios: m.radios, avisos: m.avisos });
        o.version++; oyentes.forEach((fn) => fn(o));
      },
      quitar() {
        Object.assign(o, { nombre: null, lectura: null, radios: null, avisos: [], voltear: false });
        o.version++; oyentes.forEach((fn) => fn(o));
      },
    };
    return o;
  }

  function iniciarObjetivo({ objetivo, remoto, informar }) {
    const { PIEZA, DZ } = window.Torno.DATOS;
    const entrada = document.querySelector('#archivo-step');
    const btnCargar = document.querySelector('#btn-cargar-step');
    const btnVoltear = document.querySelector('#btn-voltear-step');
    const btnQuitar = document.querySelector('#btn-quitar-step');
    const linea = document.querySelector('#perfil-objetivo');
    const demoTexto = document.querySelector('#demo-estado');
    let errores = 0, ultimo = null, detalle = [], errorHasta = 0;

    const pintarEstado = (texto, nivel = 'info') => { linea.textContent = texto; linea.dataset.nivel = nivel; };
    // Un error se queda a la vista 6 s: si no, la línea de progreso (10 veces por segundo) lo taparía al momento
    const pintarError = (texto) => { errores++; errorHasta = performance.now() + 6000; pintarEstado(texto, 'mal'); };
    function refrescarBotones() {
      const hay = !!objetivo.radios;
      btnVoltear.hidden = btnQuitar.hidden = !hay;
      btnCargar.textContent = hay ? 'Cambiar pieza…' : 'Cargar pieza (.step)…';
    }

    // El botón abre la ventana del sistema para buscar el archivo (el <input> va oculto: su aspecto no se
    // puede cambiar y el botón propio sigue el estilo de la web)
    const abrir = () => { entrada.value = ''; entrada.click(); };   // vaciar: si eliges el MISMO archivo, vuelve a saltar "change"
    btnCargar.addEventListener('click', abrir);
    const alElegir = () => {
      const f = entrada.files && entrada.files[0];
      if (!f) return;
      if (!/\.(step|stp)$/i.test(f.name)) { pintarError('«' + f.name + '» no es un .step / .stp.'); return; }
      if (f.size > 30 * 1024 * 1024) { pintarError('El archivo pesa más de 30 MB: no parece una pieza de torno.'); return; }
      pintarEstado('Leyendo ' + f.name + '…');
      const lector = new FileReader();
      lector.onload = () => {
        try {
          const lectura = window.Torno.step.leer(String(lector.result));
          objetivo.poner(f.name.replace(/\.(step|stp)$/i, ''), lectura, false);
        } catch (err) {
          pintarError('No se pudo cargar «' + f.name + '»: ' + err.message + (objetivo.radios ? ' (sigue cargada «' + objetivo.nombre + '»)' : ''));
          console.warn('[objetivo]', err);
        }
      };
      lector.onerror = () => pintarError('No se pudo leer el archivo.');
      lector.readAsText(f);
    };
    entrada.addEventListener('change', alElegir);
    const alVoltear = () => objetivo.lectura && objetivo.poner(objetivo.nombre, objetivo.lectura, !objetivo.voltear);
    const alQuitar = () => objetivo.quitar();
    btnVoltear.addEventListener('click', alVoltear);
    btnQuitar.addEventListener('click', alQuitar);

    // Línea de progreso: se recalcula con cada trama (los radios que ve el panel remoto)
    function progreso(f) {
      if (!objetivo.radios) return;
      const c = window.Torno.cam.comparar(f.radios, objetivo.radios, { R: PIEZA.R, dz: DZ });
      ultimo = c;
      // Para la verificación: dónde y cuánto se ha pasado de cota (las 5 primeras muestras)
      detalle = [];
      for (let i = 0; i < f.radios.length && detalle.length < 5; i++) if (f.radios[i] < objetivo.radios[i] - 0.1) detalle.push([i, +(-PIEZA.L + (i + 0.5) * DZ).toFixed(2), +objetivo.radios[i].toFixed(3), +f.radios[i].toFixed(3)]);
      if (performance.now() < errorHasta) return;
      const partes = [objetivo.nombre + '.step', 'L ' + num(objetivo.lectura.largo, 1) + ' mm', num(c.hecho * 100, 0) + ' % hecho',
        'sobremetal ' + num(c.resta / 1000, 2) + ' cm³'];
      let nivel = 'info';
      if (c.pasadas) { partes.push('⚠ ' + c.pasadas + ' muestras pasadas de cota'); nivel = 'mal'; }
      else if (c.enTolerancia) { partes.push('✔ pieza a cota (±0,1 mm)'); nivel = 'ok'; }
      if (objetivo.avisos.length) partes.push(objetivo.avisos.join(' '));
      pintarEstado(partes.join(' · '), nivel);
    }
    const baja = remoto.on('trama', progreso);
    const bajaObj = objetivo.on(() => {
      refrescarBotones();
      if (!objetivo.radios) { pintarEstado('Sin pieza cargada: el ciclo demo hace su pieza de ejemplo.'); demoTexto.textContent = 'El ciclo demo mecaniza una pieza solo: desbaste, escalón, ranura y chaflán.'; return; }
      pintarEstado('Pieza «' + objetivo.nombre + '» cargada' + (objetivo.voltear ? ' (volteada)' : '') + '. ' + objetivo.avisos.join(' '), objetivo.avisos.length ? 'aviso' : 'ok');
      demoTexto.textContent = 'El ciclo demo mecanizará «' + objetivo.nombre + '»: desbaste por capas y acabado del contorno.';
    });
    refrescarBotones();

    informar('objetivo', () => ({ cargado: !!objetivo.radios, nombre: objetivo.nombre, voltear: objetivo.voltear, avisos: objetivo.avisos.length,
      errores, detalle, hecho: ultimo ? +ultimo.hecho.toFixed(3) : null, pasadas: ultimo ? ultimo.pasadas : null, enTolerancia: ultimo ? ultimo.enTolerancia : null }));
    return { destruir() {
      baja(); bajaObj();
      btnCargar.removeEventListener('click', abrir); entrada.removeEventListener('change', alElegir);
      btnVoltear.removeEventListener('click', alVoltear); btnQuitar.removeEventListener('click', alQuitar);
    } };
  }

  window.Torno = Object.assign(window.Torno || {}, { crearObjetivo, iniciarObjetivo });
})();
