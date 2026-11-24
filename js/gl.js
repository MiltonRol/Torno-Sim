// gl.js — mini motor WebGL2 propio (sin librerías): matrices, shaders, mallas y geometría básica.
// Por qué propio y no three.js: la web debe ir sin conexión y con doble clic, y para un torno basta con
// cajas, sólidos de revolución y toros. Así además se ve cómo funciona por dentro un motor 3D.
(() => {
  // ---------- vectores ----------
  const v3 = {
    resta: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    cruz: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    punto: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  };

  // ---------- matrices 4x4 en orden de COLUMNAS (como las espera WebGL) ----------
  // El elemento (fila f, columna c) está en el índice c*4 + f.
  const m4 = {
    id: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    // a·b: primero se aplica b y luego a (igual que en papel)
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let f = 0; f < 4; f++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + f] * b[c * 4 + k];
        o[c * 4 + f] = s;
      }
      return o;
    },
    cadena: (...ms) => ms.reduce((acc, m) => m4.mul(acc, m)),
    tras: (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
    rotX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
    rotY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
    rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
    // Proyección en perspectiva (fov vertical en radianes)
    persp(fov, aspecto, cerca, lejos) {
      const f = 1 / Math.tan(fov / 2), nf = 1 / (cerca - lejos);
      return new Float32Array([f / aspecto, 0, 0, 0, 0, f, 0, 0, 0, 0, (lejos + cerca) * nf, -1, 0, 0, 2 * lejos * cerca * nf, 0]);
    },
    // Cámara que mira desde "ojo" hacia "obj"
    mirar(ojo, obj, arriba = [0, 1, 0]) {
      const z = v3.norm(v3.resta(ojo, obj)), x = v3.norm(v3.cruz(arriba, z)), y = v3.cruz(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -v3.punto(x, ojo), -v3.punto(y, ojo), -v3.punto(z, ojo), 1]);
    },
    // Matriz cuya columna X apunta en la dirección t (para orientar piezas a lo largo de una curva)
    base(t, p) {
      const x = v3.norm(t), ref = Math.abs(x[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const z = v3.norm(v3.cruz(x, ref)), y = v3.cruz(z, x);
      return new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, p[0], p[1], p[2], 1]);
    },
    aplicar(m, [x, y, z]) {
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];
    },
  };

  // ---------- shaders ----------
  // Compila y enlaza; guarda las posiciones de TODOS los uniforms para no buscarlos en cada frame.
  function programa(gl, fuenteVS, fuenteFS) {
    const compilar = (tipo, src) => {
      const s = gl.createShader(tipo);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compilar(gl.VERTEX_SHADER, fuenteVS));
    gl.attachShader(p, compilar(gl.FRAGMENT_SHADER, fuenteFS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programa: ' + gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const nombre = gl.getActiveUniform(p, i).name;
      u[nombre.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, nombre);
    }
    return { p, u };
  }

  // ---------- geometría: arrays planos { pos, nor, idx } ----------
  // No se usa "culling": las caras se ven por los dos lados y la profundidad decide qué tapa a qué.
  // Así no hay que cuidar el sentido de giro de cada triángulo.
  const geo = {
    nueva: () => ({ pos: [], nor: [], idx: [] }),
    quad(g, a, b, c, d, n) {
      const o = g.pos.length / 3;
      for (const p of [a, b, c, d]) { g.pos.push(p[0], p[1], p[2]); g.nor.push(n[0], n[1], n[2]); }
      g.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    },
    tri(g, a, b, c, n) {
      const o = g.pos.length / 3;
      for (const p of [a, b, c]) { g.pos.push(p[0], p[1], p[2]); g.nor.push(n[0], n[1], n[2]); }
      g.idx.push(o, o + 1, o + 2);
    },

    // Caja centrada en el origen con las aristas BISELADAS (b mm): el chaflán recoge un brillo fino
    // en los cantos y la pieza deja de parecer de cartón. 6 caras + 12 chaflanes + 8 esquinas.
    caja(sx, sy, sz, b = 0) {
      const g = geo.nueva(), h = [sx / 2, sy / 2, sz / 2], i = h.map((v) => v - b);
      const P = (a, va, bb, vb, c, vc) => { const p = [0, 0, 0]; p[a] = va; p[bb] = vb; p[c] = vc; return p; };
      for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
        const b1 = (a + 1) % 3, b2 = (a + 2) % 3, n = [0, 0, 0]; n[a] = s;
        geo.quad(g, P(a, s * h[a], b1, -i[b1], b2, -i[b2]), P(a, s * h[a], b1, i[b1], b2, -i[b2]),
          P(a, s * h[a], b1, i[b1], b2, i[b2]), P(a, s * h[a], b1, -i[b1], b2, i[b2]), n);
      }
      if (b > 0) {
        for (const [a, bb, c] of [[0, 1, 2], [0, 2, 1], [1, 2, 0]]) for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
          const n = [0, 0, 0]; n[a] = sa * Math.SQRT1_2; n[bb] = sb * Math.SQRT1_2;
          geo.quad(g, P(a, sa * h[a], bb, sb * i[bb], c, -i[c]), P(a, sa * h[a], bb, sb * i[bb], c, i[c]),
            P(a, sa * i[a], bb, sb * h[bb], c, i[c]), P(a, sa * i[a], bb, sb * h[bb], c, -i[c]), n);
        }
        const k = 1 / Math.sqrt(3);
        for (const sx_ of [-1, 1]) for (const sy_ of [-1, 1]) for (const sz_ of [-1, 1]) {
          geo.tri(g, [sx_ * h[0], sy_ * i[1], sz_ * i[2]], [sx_ * i[0], sy_ * h[1], sz_ * i[2]],
            [sx_ * i[0], sy_ * i[1], sz_ * h[2]], [sx_ * k, sy_ * k, sz_ * k]);
        }
      }
      return g;
    },
    // Caja colocada por sus límites [x0,x1]×[y0,y1]×[z0,z1] (más cómodo para modelar a partir de cotas)
    cajaEntre(x0, x1, y0, y1, z0, z1, b = 0) {
      return geo.transformar(geo.caja(x1 - x0, y1 - y0, z1 - z0, b), m4.tras((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    },

    // Sólido de REVOLUCIÓN alrededor del eje X a partir de un perfil [[x, radio], ...] (como en el torno).
    // Cada tramo lleva sus propias normales: los cantos (chaflanes, escalones) quedan nítidos.
    // Recorre el perfil desde el eje (radio 0) para que las tapas salgan solas.
    revolucion(perfil, seg = 40) {
      const g = geo.nueva();
      for (let k = 0; k < perfil.length - 1; k++) {
        const [x0, r0] = perfil[k], [x1, r1] = perfil[k + 1];
        const dx = x1 - x0, dr = r1 - r0, l = Math.hypot(dx, dr) || 1;
        const nx = -dr / l, nr = dx / l;                 // tangente girada 90° = normal hacia fuera
        const o = g.pos.length / 3;
        for (let j = 0; j <= seg; j++) {
          const a = (j / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          g.pos.push(x0, r0 * c, r0 * s, x1, r1 * c, r1 * s);
          g.nor.push(nx, nr * c, nr * s, nx, nr * c, nr * s);
        }
        for (let j = 0; j < seg; j++) { const v = o + j * 2; g.idx.push(v, v + 1, v + 3, v, v + 3, v + 2); }
      }
      return g;
    },
    // Cilindro macizo a lo largo de X (de x0 a x1)
    cilindro: (r, x0, x1, seg = 32) => geo.revolucion([[x0, 0], [x0, r], [x1, r], [x1, 0]], seg),

    // Toro en el plano YZ (eje X): la llanta de los volantes
    toro(R, r, su = 48, sv = 12) {
      const g = geo.nueva();
      for (let i = 0; i <= su; i++) {
        const u = (i / su) * Math.PI * 2, cu = Math.cos(u), su_ = Math.sin(u);
        for (let j = 0; j <= sv; j++) {
          const v = (j / sv) * Math.PI * 2, cv = Math.cos(v), sv_ = Math.sin(v);
          g.pos.push(r * sv_, (R + r * cv) * cu, (R + r * cv) * su_);
          g.nor.push(sv_, cv * cu, cv * su_);
        }
      }
      for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) {
        const a = i * (sv + 1) + j, b = a + sv + 1;
        g.idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      return g;
    },

    // Aplica una matriz (solo giro + traslación: así las normales se giran con la misma matriz)
    transformar(g, m) {
      const out = { pos: new Array(g.pos.length), nor: new Array(g.nor.length), idx: g.idx.slice() };
      for (let i = 0; i < g.pos.length; i += 3) {
        const p = m4.aplicar(m, [g.pos[i], g.pos[i + 1], g.pos[i + 2]]);
        out.pos[i] = p[0]; out.pos[i + 1] = p[1]; out.pos[i + 2] = p[2];
        const x = g.nor[i], y = g.nor[i + 1], z = g.nor[i + 2];
        out.nor[i] = m[0] * x + m[4] * y + m[8] * z;
        out.nor[i + 1] = m[1] * x + m[5] * y + m[9] * z;
        out.nor[i + 2] = m[2] * x + m[6] * y + m[10] * z;
      }
      return out;
    },
    // Junta varias geometrías en una (menos llamadas de dibujo). Con bucles y no con push(...arr):
    // con arrays enormes el "spread" revienta la pila de llamadas.
    juntar(...gs) {
      const out = geo.nueva();
      for (const g of gs) {
        const o = out.pos.length / 3;
        for (const v of g.pos) out.pos.push(v);
        for (const v of g.nor) out.nor.push(v);
        for (const k of g.idx) out.idx.push(k + o);
      }
      return out;
    },
  };

  // Sube una geometría a la GPU: posición (location 0) y normal (location 1) intercaladas en un buffer.
  function subir(gl, g) {
    const n = g.pos.length / 3, datos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      datos[i * 6] = g.pos[i * 3]; datos[i * 6 + 1] = g.pos[i * 3 + 1]; datos[i * 6 + 2] = g.pos[i * 3 + 2];
      datos[i * 6 + 3] = g.nor[i * 3]; datos[i * 6 + 4] = g.nor[i * 3 + 1]; datos[i * 6 + 5] = g.nor[i * 3 + 2];
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, datos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(g.idx), gl.STATIC_DRAW);   // WebGL2 admite índices de 32 bits
    gl.bindVertexArray(null);
    return { vao, n: g.idx.length, liberar() { gl.deleteBuffer(vbo); gl.deleteBuffer(ibo); gl.deleteVertexArray(vao); } };
  }

  // '#cfd3d6' → [r, g, b] en espacio LINEAL (el shader ilumina en lineal y corrige gamma al final)
  function lineal(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2));
  }

  window.Torno = Object.assign(window.Torno || {}, { GL: { v3, m4, programa, geo, subir, lineal } });
})();
