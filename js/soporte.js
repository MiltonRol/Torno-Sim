// soporte.js — qué sabe hacer este navegador y utilidades que comparten todos los módulos.
// Script CLÁSICO (no módulo) para que la web funcione con DOBLE CLIC (file://): todo va dentro de una
// función que se ejecuta al momento (IIFE) y lo que necesitan otros archivos se publica en window.Torno.
(() => {
  // Se detecta la FUNCIÓN, no la versión del navegador: sirve igual para Chrome, Edge, Firefox o Safari.
  function detectarSoporte() {
    let webgl2 = false;
    try {
      // Canvas suelto para no "gastar" el contexto del lienzo real; después se libera.
      const gl = document.createElement('canvas').getContext('webgl2');
      // El gemelo lee el perfil de la pieza desde una textura DENTRO del vertex shader:
      // hace falta al menos una unidad de textura en esa etapa (en WebGL2 casi siempre hay 16).
      webgl2 = !!gl && gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) > 0;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { webgl2 = false; }
    return { webgl2, audio: !!(window.AudioContext || window.webkitAudioContext) };
  }

  // DPR limitado a 2: en pantallas 3x el coste en píxeles se dispara y apenas se nota la diferencia.
  const dprLimitado = () => Math.min(window.devicePixelRatio || 1, 2);

  // Avisa con true/false cuando el elemento entra o sale de pantalla (para PAUSAR lo que nadie ve).
  function alVerse(elemento, alCambiar) {
    const io = new IntersectionObserver(([e]) => alCambiar(e.isIntersecting), { rootMargin: '120px' });
    io.observe(elemento);
    return () => io.disconnect();
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Números a la española: coma decimal y signo menos tipográfico (−), que ocupa lo mismo que el "+"
  // y así las cifras del visualizador no "bailan" al cambiar de signo.
  function num(v, dec = 2, signo = false) {
    const s = Math.abs(v).toFixed(dec);
    const cero = Number(s) === 0;                       // evita mostrar "−0,00"
    const pre = v < 0 && !cero ? '−' : signo ? (cero ? ' ' : '+') : '';
    return pre + s.replace('.', ',');
  }
  // Entero con espacio fino como separador de miles: 1 250 rpm
  const entero = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const hora = (d = new Date()) => d.toLocaleTimeString('es-ES', { hour12: false });

  // Torre de señalización (colores de la IEC 60204-1): rojo = emergencia/alarma, ámbar = atención,
  // verde = funcionamiento normal. Recibe un estado "plano" para que valga para la máquina en vivo
  // (gemelo 3D) y para las tramas de telemetría (cabecera). Devuelve la intensidad de cada lámpara (0..1).
  function senalesBaliza(s, t, reducido) {
    const destello = reducido || (t * 2) % 1 < 0.55;   // 1 Hz; con movimiento reducido, luz fija
    const bajo = destello ? 1 : 0.12;
    if (s.prueba) return { rojo: 1, ambar: 1, verde: 1 };            // prueba de lámparas al encender
    if (s.seta || s.alarma) return { rojo: bajo, ambar: 0, verde: 0 };
    if (!s.protector || !s.plato) return { rojo: 0, ambar: bajo, verde: 0 };
    if (s.marcha) return { rojo: 0, ambar: 0, verde: 1 };
    return { rojo: 0, ambar: 1, verde: 0 };                            // parada y lista
  }

  window.Torno = Object.assign(window.Torno || {}, { detectarSoporte, dprLimitado, alVerse, clamp, num, entero, hora, senalesBaliza });
})();
