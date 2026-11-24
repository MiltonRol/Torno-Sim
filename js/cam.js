// cam.js — "CAM" mínimo: a partir del perfil OBJETIVO (radio de cada muestra de la barra) calcula las
// pasadas que hará el ciclo demo para mecanizar la pieza cargada desde un STEP.
//   1) DESBASTE por capas de 1,5 mm de profundidad, dejando un sobremetal de 0,3 mm.
//   2) ACABADO: una pasada que copia el contorno desde la cara hasta el último tramo mecanizado.
// Es una función PURA (no toca la máquina ni el DOM): recibe números y devuelve una lista de movimientos.
// Así se puede comprobar fuera del navegador simulando el corte, y demo.js solo tiene que ejecutarla.
(() => {
  // Movimiento: { z?, x?, v? } → posición destino de la punta (mm) y velocidad de AVANCE en mm/s.
  // Sin v es un movimiento RÁPIDO (en vacío). x es RADIO, como en la máquina.
  function planificar(obj, { L, N, R, ancho, zMin, xMin }, opciones = {}) {
    const { capa = 1.5, sobremetal = 0.3, fDesbaste = 20, fAcabado = 12, fPenetrar = 2.5 } = opciones;
    const dz = L / N, medio = ancho / 2, holgura = 0.03;
    const seguro = R + 1.5;                       // altura de seguridad: por encima de la barra en bruto, nunca corta
    const zCara = 2;                              // punto de aproximación delante de la cara (fuera de la pieza)
    const centro = (i) => -L + (i + 0.5) * dz;
    const fases = [];

    // ---------------- 1) DESBASTE ----------------
    // Lo más fino que hay que dejar en cada muestra durante el desbaste (objetivo + sobremetal, nunca bajo el tope X)
    const minDesbaste = Float32Array.from(obj, (o) => Math.max(xMin, o + sobremetal));
    const minimo = Math.min(...minDesbaste);
    const niveles = [];
    if (minimo < R - 0.05) {
      for (let x = R - capa; ; x -= capa) {
        if (x <= minimo + 1e-6) { niveles.push(minimo); break; }   // la última capa se ajusta para no pasarse
        niveles.push(x);
      }
    }
    niveles.forEach((nivel, k) => {
      const anterior = k === 0 ? R : niveles[k - 1];
      const movs = [];
      // Tramos (de la cara hacia el plato) donde el objetivo permite bajar hasta este nivel
      let i = N - 1;
      while (i >= 0) {
        if (minDesbaste[i] > nivel + 1e-6) { i--; continue; }
        const ib = i;
        while (i >= 0 && minDesbaste[i] <= nivel + 1e-6) i--;
        const ia = i + 1;
        // La punta tiene 1,2 mm de filo: su CENTRO debe quedar a medio filo de los bordes del tramo,
        // si no rozaría (y cortaría) las muestras vecinas que no tocan.
        const zLo = Math.max(-L + ia * dz + medio + holgura, zMin);
        const enCara = ib === N - 1;
        const zHi = enCara ? zCara : -L + (ib + 1) * dz - medio - holgura;
        if (zHi - zLo < 0.05) continue;           // ranura más estrecha que la cuchilla: se deja para el acabado
        movs.push({ x: seguro }, { z: zHi });
        if (enCara) movs.push({ x: nivel });                       // delante de la cara: baja en vacío
        else movs.push({ x: anterior + 0.5 }, { x: nivel, v: fPenetrar });   // dentro de la pieza: penetra despacio
        movs.push({ z: zLo, v: fDesbaste }, { x: seguro });
      }
      if (movs.length) fases.push({ tipo: 'desbaste', texto: 'desbaste a Ø' + (2 * nivel).toFixed(1).replace('.', ',') + ' (capa ' + (k + 1) + '/' + niveles.length + ')', nivel, movs });
    });

    // ---------------- 2) ACABADO ----------------
    // Altura de la punta en cada muestra: lo MÁS ALTO del objetivo bajo todo el filo (si no, la cuchilla
    // se comería el borde de un escalón que sube).
    // Se calcula para una posición cualquiera de la punta (null si el filo no toca ninguna muestra).
    const xfEn = (c) => {
      const lo = Math.max(0, Math.floor((c - medio + L) / dz)), hi = Math.min(N - 1, Math.floor((c + medio + L) / dz));
      if (lo > hi) return null;
      let m = 0;
      for (let j = lo; j <= hi; j++) m = Math.max(m, obj[j]);
      return Math.max(xMin, m);
    };
    const xf = Float32Array.from({ length: N }, (_, i) => xfEn(centro(i)));
    let iFin = -1;
    for (let i = 0; i < N; i++) if (obj[i] < R - 1e-3 && centro(i) >= zMin) { iFin = i; break; }
    if (iFin >= 0) {
      // Se empieza con la punta un poco FUERA de la cara (muestras "virtuales" N+2, N+1, N): así el filo
      // solo pisa la última muestra y un chaflán en la punta queda a cota hasta el final.
      const pts = [];
      for (let i = N + 2; i >= iFin; i--) { const x = xfEn(centro(i)); if (x !== null) pts.push({ z: centro(i), x }); }
      pts.unshift({ z: zCara, x: pts[0].x });
      // De punto a punto: en tramos empinados (más de 45°) se hace "en escalera" para no rebajar el canto:
      // si sube, primero sube y luego avanza; si baja, primero avanza y luego baja.
      const camino = [pts[0]];
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k], dx = b.x - a.x, dZ = Math.abs(b.z - a.z);
        if (Math.abs(dx) > dZ * 1.05) {
          if (dx > 0) camino.push({ z: a.z, x: b.x }, { z: b.z, x: b.x });
          else camino.push({ z: b.z, x: a.x }, { z: b.z, x: b.x });
        } else camino.push(b);
      }
      // Se juntan los puntos alineados: un cilindro de 80 mm es UN movimiento, no 230
      const simple = [camino[0]];
      for (let k = 1; k < camino.length; k++) {
        const p = camino[k];
        if (simple.length >= 2) {
          const a = simple[simple.length - 2], b = simple[simple.length - 1];
          const cruz = (b.z - a.z) * (p.x - a.x) - (b.x - a.x) * (p.z - a.z);
          const mismoSentido = (b.z - a.z) * (p.z - b.z) + (b.x - a.x) * (p.x - b.x) >= 0;
          if (Math.abs(cruz) < 1e-3 * Math.hypot(p.z - a.z, p.x - a.x) && mismoSentido) { simple[simple.length - 1] = p; continue; }
        }
        if (Math.abs(p.z - simple.at(-1).z) < 1e-6 && Math.abs(p.x - simple.at(-1).x) < 1e-6) continue;
        simple.push(p);
      }
      const movs = [{ x: seguro }, { z: simple[0].z }, { x: simple[0].x }];
      for (let k = 1; k < simple.length; k++) movs.push({ z: simple[k].z, x: simple[k].x, v: fAcabado });
      movs.push({ x: seguro });
      fases.push({ tipo: 'acabado', texto: 'acabado del contorno', movs });
    }
    return { fases, niveles, seguro, xf };
  }

  // Estado de la pieza respecto al objetivo: sobremetal que queda (mm³), % hecho y muestras pasadas de cota.
  // Tolerancia ±0,1 mm (la habitual de un torneado sin indicación): la cuchilla es plana y el perfil va en
  // muestras de 0,35 mm, así que en un cono empinado puede quedar o pasarse alguna centésima.
  // Se calcula con la telemetría (los radios que llegan por la red), no con la máquina directamente.
  function comparar(radios, obj, { R, dz, tolerancia = 0.1 }) {
    let inicial = 0, resta = 0, pasadas = 0, maxSobra = 0;
    for (let i = 0; i < obj.length; i++) {
      const o = obj[i], r = radios[i];
      inicial += Math.PI * (R * R - o * o) * dz;
      if (r > o) resta += Math.PI * (r * r - o * o) * dz;
      if (r < o - tolerancia) pasadas++;
      maxSobra = Math.max(maxSobra, r - o);
    }
    const hecho = inicial > 0 ? Math.max(0, Math.min(1, 1 - resta / inicial)) : 1;
    return { inicial, resta, hecho, pasadas, maxSobra, enTolerancia: maxSobra <= tolerancia && pasadas === 0 };
  }

  window.Torno = Object.assign(window.Torno || {}, { cam: { planificar, comparar } });
})();
