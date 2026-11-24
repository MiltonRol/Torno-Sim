// sonido.js — el sonido de la máquina con Web Audio (sintetizado: sin archivos de audio).
// Zumbido del motor que sube con las rpm, ruido de corte proporcional a la carga, chorro de taladrina y tres
// pitidos al saltar una alarma. Empieza APAGADO: el navegador solo deja sonar tras un gesto del usuario.
(() => {
  const { createTimer } = anime;

  function iniciarSonido({ maquina, soporte, informar }) {
    const btn = document.querySelector('#btn-sonido');
    if (!soporte.audio) { btn.disabled = true; btn.title = 'Este navegador no tiene Web Audio'; return { destruir() {} }; }
    let ac = null, n = null, activo = false;

    function crear() {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
      const conectar = (...nodos) => { nodos.reduce((a, b) => a.connect(b)); return nodos[nodos.length - 1]; };
      // motor: diente de sierra filtrado + un armónico triangular (los engranajes del cabezal)
      const osc = ac.createOscillator(); osc.type = 'sawtooth';
      const filtro = ac.createBiquadFilter(); filtro.type = 'lowpass'; filtro.Q.value = 2;
      const gMotor = ac.createGain(); gMotor.gain.value = 0;
      conectar(osc, filtro, gMotor, master); osc.start();
      const osc2 = ac.createOscillator(); osc2.type = 'triangle';
      const g2 = ac.createGain(); g2.gain.value = 0;
      conectar(osc2, g2, master); osc2.start();
      // ruido blanco (2 s en bucle) para el corte y para la taladrina
      const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ruido = (inicio) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, inicio); return s; };
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
      const gCorte = ac.createGain(); gCorte.gain.value = 0;
      conectar(ruido(0), bp, gCorte, master);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const gAgua = ac.createGain(); gAgua.gain.value = 0;
      conectar(ruido(0.7), lp, gAgua, master);
      n = { master, osc, osc2, g2, filtro, gMotor, bp, gCorte, gAgua };
    }

    function pitidos() {
      if (!activo || !ac) return;
      const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime;
      o.type = 'square'; o.frequency.value = 880; g.gain.value = 0;
      o.connect(g).connect(n.master);
      for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(0.08, t0 + k * 0.3); g.gain.setValueAtTime(0, t0 + k * 0.3 + 0.16); }
      o.start(t0); o.stop(t0 + 1);
    }
    const baja = maquina.on('evento', (ev) => { if (ev.nivel === 'alarma') pitidos(); });

    const onClick = () => {
      activo = !activo;
      if (activo && !ac) crear();
      ac.resume();
      n.master.gain.setTargetAtTime(activo ? 0.9 : 0, ac.currentTime, 0.08);
      btn.setAttribute('aria-pressed', String(activo));
      btn.querySelector('.sonido__texto').textContent = activo ? 'Sonido: sí' : 'Sonido: no';
    };
    btn.addEventListener('click', onClick);
    const onVisible = () => { if (!ac) return; document.hidden ? ac.suspend() : activo && ac.resume(); };
    document.addEventListener('visibilitychange', onVisible);

    // Se lee la máquina 20 veces por segundo y los parámetros se acercan con setTargetAtTime (sin chasquidos)
    const e = maquina.estado;
    const reloj = createTimer({
      frameRate: 20,
      onUpdate: () => {
        if (!activo || !ac) return;
        const rpm = Math.abs(e.husillo.rpm), k = rpm / 2000, t = ac.currentTime, gira = rpm > 5;
        n.osc.frequency.setTargetAtTime(30 + k * 120, t, 0.05);
        n.osc2.frequency.setTargetAtTime(60 + k * 380, t, 0.05);
        n.filtro.frequency.setTargetAtTime(250 + k * 1600, t, 0.05);
        n.gMotor.gain.setTargetAtTime(gira ? 0.05 + 0.07 * k : 0, t, 0.08);
        n.g2.gain.setTargetAtTime(gira ? 0.012 + 0.02 * k : 0, t, 0.08);
        n.gCorte.gain.setTargetAtTime(Math.min(0.25, Math.max(0, (e.carga - 9) / 100) * 0.25), t, 0.05);
        n.bp.frequency.setTargetAtTime(1800 + rpm, t, 0.1);
        n.gAgua.gain.setTargetAtTime(0.05 * e.refrigerante.caudal, t, 0.1);
      },
    });

    informar('sonido', () => ({ activo }));
    return {
      destruir() { reloj.cancel(); baja(); btn.removeEventListener('click', onClick); document.removeEventListener('visibilitychange', onVisible); ac?.close(); },
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarSonido });
})();
