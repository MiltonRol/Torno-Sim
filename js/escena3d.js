// escena3d.js — el GEMELO DIGITAL: el torno en 3D con WebGL2 (motor propio de gl.js).
// Lee el estado que le da el enlace remoto (la máquina en vivo o, sin conexión, la última foto) y lo pinta:
// plato que gira, garras que abren, barra que se rebaja al cortar, carros que se mueven con las manivelas,
// virutas y taladrina como partículas, baliza, botonera, lámpara y protector. Las etiquetas con datos van en
// HTML encima del lienzo (accesibles y nítidas) y se colocan proyectando puntos 3D a la pantalla.
(() => {
  const { animate, createTimer, utils } = anime;
  const { GL, DATOS, clamp, num, entero, dprLimitado, alVerse, senalesBaliza } = window.Torno;
  const { m4, geo, programa, subir, lineal } = GL;
  const { PIEZA, PASO } = DATOS;

  // =====================================================================================
  // SHADERS (GLSL ES 3.0). Van como arrays de líneas para no usar plantillas con comillas invertidas.
  // =====================================================================================
  const LUZ = [
    'uniform vec3 uCam;',
    'uniform vec3 uLuzPos;',     // lámpara de trabajo (luz puntual cálida)
    'uniform float uLuzInt;',
    'uniform vec3 uCielo;',      // luz ambiente que viene de arriba
    'uniform vec3 uSuelo;',      // y la que rebota del suelo
    'vec3 sombrear(vec3 P, vec3 N, vec3 base, float metal, float rugo) {',
    '  vec3 V = normalize(uCam - P);',
    '  if (dot(N, V) < 0.0) N = -N;',                 // sin culling: se ilumina la cara que mira a la cámara
    '  vec3 L1 = normalize(vec3(-0.45, 0.85, 0.6));',  // principal: arriba, izquierda y delante
    '  vec3 L2 = normalize(vec3(0.8, 0.35, 0.45));',   // relleno frío desde la derecha
    '  vec3 L3 = normalize(vec3(0.1, 0.4, -1.0));',    // contraluz que recorta la silueta
    '  float d1 = max(dot(N, L1), 0.0), d2 = max(dot(N, L2), 0.0), d3 = max(dot(N, L3), 0.0);',
    '  vec3 amb = mix(uSuelo, uCielo, N.y * 0.5 + 0.5);',
    '  float brillo = mix(90.0, 8.0, rugo);',
    '  vec3 F0 = mix(vec3(0.04), base, metal);',
    '  vec3 dif = base * (1.0 - metal * 0.85) * (amb + d1 * vec3(1.0, 0.96, 0.9) * 1.05 + d2 * vec3(0.55, 0.62, 0.72) * 0.45 + d3 * 0.3);',
    '  vec3 esp = (pow(max(dot(N, normalize(L1 + V)), 0.0), brillo) + 0.35 * pow(max(dot(N, normalize(L2 + V)), 0.0), brillo)) * F0 * (1.0 - rugo * 0.6) * 2.0;',
    // Reflejo de un "estudio" inventado: el metal necesita algo que reflejar o parece plástico gris
    '  vec3 R = reflect(-V, N);',
    '  vec3 env = mix(vec3(0.04, 0.045, 0.05), vec3(0.5, 0.55, 0.6), smoothstep(-0.3, 0.55, R.y));',
    '  env += vec3(0.9) * smoothstep(0.16, 0.0, abs(R.y - 0.28)) * (1.0 - rugo);',
    '  vec3 refl = env * F0 * (0.3 + 0.7 * metal);',
    '  vec3 Lp = uLuzPos - P; float dist = length(Lp); Lp /= dist;',
    '  float att = uLuzInt / (1.0 + dist * dist * 0.000014);',
    '  dif += base * max(dot(N, Lp), 0.0) * vec3(1.0, 0.85, 0.65) * att * 0.85;',
    '  esp += pow(max(dot(N, normalize(Lp + V)), 0.0), brillo) * F0 * att * 1.4;',
    '  float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0);',
    '  return dif + refl + esp + fr * 0.08 * uCielo;',
    '}',
    // Compresión suave de brillos + corrección gamma (se ilumina en espacio lineal)
    'vec3 tono(vec3 c) { c = c / (1.0 + c * 0.22); return pow(c, vec3(1.0 / 2.2)); }',
  ].join('\n');

  const VS_OBJ = [
    '#version 300 es',
    'layout(location = 0) in vec3 aPos;',
    'layout(location = 1) in vec3 aNor;',
    'uniform mat4 uVP, uM;',
    'out vec3 vP; out vec3 vN;',
    'void main() { vec4 w = uM * vec4(aPos, 1.0); vP = w.xyz; vN = mat3(uM) * aNor; gl_Position = uVP * w; }',
  ].join('\n');

  const FS_OBJ = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vP; in vec3 vN;',
    'uniform vec3 uColor, uEmis;',
    'uniform float uMetal, uRugo, uAlfa;',
    LUZ,
    'out vec4 frag;',
    'void main() {',
    '  vec3 c = sombrear(vP, normalize(vN), uColor, uMetal, uRugo) + uEmis;',
    '  frag = vec4(tono(c) * uAlfa, uAlfa);',          // alfa PREMULTIPLICADO: el lienzo es transparente
    '}',
  ].join('\n');

  // Suelo: baldosas, cinta de seguridad amarilla y negra, sombra de contacto y fundido con el fondo de la página
  const FS_SUELO = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vP; in vec3 vN;',
    'uniform vec3 uColor;',
    LUZ,
    'out vec4 frag;',
    'float caja(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }',
    'void main() {',
    '  vec2 p = vP.xz;',
    '  float alfa = smoothstep(1.0, 0.45, length((p - vec2(-50.0, 120.0)) / vec2(1900.0, 1250.0)));',
    '  vec2 g = abs(fract(p / 250.0) - 0.5);',
    '  vec3 c = uColor * (1.0 - 0.22 * smoothstep(0.485, 0.5, max(g.x, g.y)));',
    '  float d = caja(p - vec2(-45.0, 90.0), vec2(660.0, 370.0));',
    '  float cinta = 1.0 - smoothstep(20.0, 23.0, abs(d));',
    '  float rayas = step(0.5, fract((p.x + p.y) / 70.0));',
    '  c = mix(c, mix(vec3(0.015), vec3(0.85, 0.6, 0.02), rayas), cinta);',
    '  float s = caja(p - vec2(-45.0, 10.0), vec2(500.0, 150.0));',
    '  float sombra = 1.0 - 0.6 * smoothstep(140.0, -40.0, s);',
    '  vec3 col = sombrear(vP, vec3(0.0, 1.0, 0.0), c, 0.0, 0.85) * sombra;',
    '  frag = vec4(tono(col) * alfa, alfa);',
    '}',
  ].join('\n');

  // Barra de trabajo: la malla es fija (anillos × ángulos) y el RADIO de cada anillo se lee de una textura
  // con el perfil. Al cortar solo se suben 400 números (texSubImage2D), no la malla entera.
  const VS_PIEZA = [
    '#version 300 es',
    'layout(location = 0) in vec3 aDat;',              // x: anillo (−1 = zona de amarre), y: ángulo, z: 0 lateral, 1 borde de tapa, 2 centro
    'uniform mat4 uVP, uM;',
    'uniform sampler2D uPerfil;',                      // RG32F: r = radio, g = mecanizado (0/1) + 2 × estado respecto a la pieza cargada (0 nada, 1 sobra, 2 pasada)
    'uniform float uN, uL, uR, uX0;',
    'out vec3 vP; out vec3 vN; out vec3 vL; out float vMec; out float vSobra; out float vPasada;',
    'vec2 muestra(int i) { return texelFetch(uPerfil, ivec2(clamp(i, 0, int(uN) - 1), 0), 0).rg; }',
    'void main() {',
    '  float ang = aDat.y; int tipo = int(aDat.z + 0.5);',
    '  float dz = uL / uN; int i = int(aDat.x + 0.5);',
    '  vec3 pos; vec3 nor; float mec = 0.0; float est = 0.0;',
    '  if (tipo == 0) {',
    '    float x; float r; float drdx = 0.0;',
    '    if (aDat.x < -0.5) { x = uX0; r = uR; }',
    '    else {',
    '      vec2 d = muestra(i); x = -uL + float(i) * dz; r = d.r; mec = mod(d.g, 2.0); est = floor(d.g * 0.5 + 0.01);',
    '      drdx = (muestra(i + 1).r - muestra(i - 1).r) / (2.0 * dz);',   // pendiente del perfil → normal (escalones y chaflanes)
    '    }',
    '    pos = vec3(x, r * cos(ang), r * sin(ang));',
    '    nor = normalize(vec3(-drdx, cos(ang), sin(ang)));',
    '  } else {',
    '    vec2 d = muestra(int(uN) - 1); float r = tipo == 1 ? d.r : 0.0;',
    '    pos = vec3(0.0, r * cos(ang), r * sin(ang)); nor = vec3(1.0, 0.0, 0.0); mec = mod(d.g, 2.0); est = floor(d.g * 0.5 + 0.01);',
    '  }',
    '  vec4 w = uM * vec4(pos, 1.0);',
    '  vP = w.xyz; vN = mat3(uM) * nor; vL = pos; vMec = mec;',
    // se decodifica por vértice (antes de interpolar): así las bandas de color tienen el borde suave
    '  vSobra = est > 0.5 && est < 1.5 ? 1.0 : 0.0; vPasada = est > 1.5 ? 1.0 : 0.0;',
    '  gl_Position = uVP * w;',
    '}',
  ].join('\n');

  const FS_PIEZA = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vP; in vec3 vN; in vec3 vL; in float vMec; in float vSobra; in float vPasada;',
    'uniform float uDifum;',                           // 0..1: a muchas rpm la textura se "emborrona" (se ve girar sin parpadeos)
    LUZ,
    'out vec4 frag;',
    'float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float ruido(vec3 x) {',
    '  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),',
    '             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);',
    '}',
    'void main() {',
    // Barra en bruto: cascarilla de laminación oscura a manchas. Va en coordenadas LOCALES de la pieza,
    // así que gira con ella y se nota la velocidad del husillo.
    '  float n = ruido(vL * 0.07) * 0.65 + ruido(vL * 0.3) * 0.35;',
    '  n = mix(n, 0.5, uDifum);',
    '  vec3 bruto = mix(vec3(0.05, 0.052, 0.056), vec3(0.2, 0.17, 0.14), smoothstep(0.3, 0.75, n));',
    // Superficie torneada: acero claro con las estrías finas del avance
    '  vec3 torneado = vec3(0.6, 0.62, 0.64) * (0.96 + 0.04 * sin(vL.x * 4.0));',   // estrías suaves (sin aliasing)
    '  float m = clamp(vMec, 0.0, 1.0);',
    '  vec3 base = mix(bruto, torneado, m);',
    // Con una pieza .step cargada: el material que AÚN sobra se tiñe de naranja (como el "stock" de un CAM)
    // y lo que se ha pasado de cota, de rojo. Sin pieza cargada, los dos valen 0 y no cambia nada.
    '  base = mix(base, vec3(0.75, 0.33, 0.06), clamp(vSobra, 0.0, 1.0) * 0.55);',
    '  base = mix(base, vec3(0.8, 0.08, 0.06), clamp(vPasada, 0.0, 1.0) * 0.8);',
    '  vec3 c = sombrear(vP, normalize(vN), base, mix(0.45, 1.0, m), mix(0.75, 0.2, m));',
    '  frag = vec4(tono(c), 1.0);',
    '}',
  ].join('\n');

  // Virutas y gotas de taladrina como puntos (gl.POINTS) con la forma dibujada en el fragment shader
  const VS_PUNTOS = [
    '#version 300 es',
    'layout(location = 0) in vec3 aPos;',
    'layout(location = 1) in vec4 aCol;',
    'layout(location = 2) in vec3 aExt;',              // x: tamaño en mm, y: giro, z: tipo (0 viruta, 1 gota)
    'uniform mat4 uVP; uniform float uEscala;',
    'out vec4 vCol; out float vRot; out float vTipo; out float vTam;',
    'void main() {',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '  gl_PointSize = clamp(aExt.x * uEscala / gl_Position.w, 2.5, 64.0);',   // tamaño en píxeles según la distancia
    '  vCol = aCol; vRot = aExt.y; vTipo = aExt.z; vTam = gl_PointSize;',
    '}',
  ].join('\n');

  const FS_PUNTOS = [
    '#version 300 es',
    'precision highp float;',
    'in vec4 vCol; in float vRot; in float vTipo; in float vTam;',
    'out vec4 frag;',
    'void main() {',
    '  vec2 p = gl_PointCoord * 2.0 - 1.0;',
    '  if (vTipo < 0.5 && vTam < 8.0) { if (dot(p, p) > 1.0) discard; frag = vec4(vCol.rgb * vCol.a, vCol.a); return; }',
    '  float c = cos(vRot), s = sin(vRot);',
    '  p = mat2(c, -s, s, c) * p;',
    '  if (vTipo < 0.5) {',
    // Viruta rizada (espiral): la típica del acero al cilindrar
    '    float r = length(p), a = atan(p.y, p.x);',
    '    float d = abs(r - (0.28 + 0.55 * (a + 3.14159) / 6.28318));',
    '    if (d > 0.12 || r > 0.98) discard;',
    '    float luz = 0.55 + 0.45 * sin(a * 3.0 + vRot);',
    '    float borde = smoothstep(0.12, 0.06, d);',              // centro claro, bordes oscuros: se recorta sobre fondos claros
    '    frag = vec4(vCol.rgb * (0.35 + 0.75 * luz) * mix(0.35, 1.0, borde) * vCol.a, vCol.a);',
    '  } else {',
    '    float r = dot(p, p); if (r > 1.0) discard;',
    '    float a = vCol.a * (1.0 - r * r);',
    '    frag = vec4(mix(vCol.rgb, vec3(1.0), smoothstep(0.35, 0.0, r)) * a, a);',   // brillo blanco en el centro de la gota
    '  }',
    '}',
  ].join('\n');

  // =====================================================================================
  // MATERIALES (colores en sRGB → lineal) y utilidades de matrices
  // =====================================================================================
  const MAT = {
    claro: { c: lineal('#c3c8cc'), m: 0, r: 0.55 },        // pintura gris claro (RAL 7035)
    oscuro: { c: lineal('#2f353a'), m: 0, r: 0.6 },        // antracita (RAL 7016)
    carro: { c: lineal('#7f8992'), m: 0.55, r: 0.42 },     // fundición mecanizada de los carros
    guia: { c: lineal('#aab3bb'), m: 0.95, r: 0.22 },      // guías rectificadas: brillan
    acero: { c: lineal('#9ea7af'), m: 0.9, r: 0.3 },
    aceroOsc: { c: lineal('#5d656c'), m: 0.85, r: 0.38 },  // garras, portaherramientas
    cromo: { c: lineal('#c9d1d8'), m: 1, r: 0.16 },        // volantes
    naranja: { c: lineal('#ff6a13'), m: 0, r: 0.4 },
    negro: { c: lineal('#14171a'), m: 0.1, r: 0.5 },
    amarillo: { c: lineal('#f2c200'), m: 0, r: 0.45 },
    oro: { c: lineal('#d6a63a'), m: 1, r: 0.28 },          // plaquita con recubrimiento de TiN
    bandeja: { c: lineal('#3f454b'), m: 0.5, r: 0.5 },
    manguera: { c: lineal('#2d4c6e'), m: 0.1, r: 0.35 },   // manguera articulada de la taladrina
    vidrio: { c: lineal('#bfdbe9'), m: 0.2, r: 0.1 },
  };
  const esc = (s) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  const T = m4.tras, X = m4.rotX, Y = m4.rotY, Z = m4.rotZ, cad = m4.cadena;
  const MEDIO = Math.PI / 2;

  // Punto de una curva de Bézier cúbica y su tangente (para mangueras y el brazo de la lámpara)
  function bezier(P, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    const da = -3 * u * u, db = 3 * u * u - 6 * u * t, dc = 6 * u * t - 3 * t * t, dd = 3 * t * t;
    const p = [0, 1, 2].map((k) => a * P[0][k] + b * P[1][k] + c * P[2][k] + d * P[3][k]);
    const tg = [0, 1, 2].map((k) => da * P[0][k] + db * P[1][k] + dc * P[2][k] + dd * P[3][k]);
    return { p, tg };
  }
  // Manguera de "cuentas" (como las de tipo Loc-Line) a lo largo de una curva
  function cuentas(P, n, radio) {
    const cuenta = geo.revolucion([[-radio * 0.8, 0], [-radio * 0.8, radio * 0.7], [-radio * 0.3, radio], [radio * 0.3, radio], [radio * 0.8, radio * 0.7], [radio * 0.8, 0]], 14);
    const partes = [];
    for (let i = 0; i <= n; i++) { const { p, tg } = bezier(P, i / n); partes.push(geo.transformar(cuenta, m4.base(tg, p))); }
    return geo.juntar(...partes);
  }
  // Arco de barritas alrededor del eje X (marco del protector)
  function arco(x, R, a0, a1, n, grosor) {
    const partes = [], paso = (a1 - a0) / n, largo = R * paso * 1.08;
    for (let k = 0; k < n; k++) partes.push(geo.transformar(geo.caja(grosor, grosor, largo, 1.5), cad(X(a0 + paso * (k + 0.5)), T(x, R, 0))));
    return geo.juntar(...partes);
  }
  // Volante: llanta (toro), 3 radios, cubo y mango. Eje de giro = X local; el mango sale hacia +X.
  function volante(R) {
    const radios = [0, 1, 2].map((k) => geo.transformar(geo.cilindro(4.2, 0, R - 17, 10), cad(X((k * 2 * Math.PI) / 3), T(0, 15, 0), Z(MEDIO))));
    const cromo = geo.juntar(
      geo.toro(R, 6.5, 56, 10), ...radios,
      geo.revolucion([[-13, 0], [-13, 13], [-9, 18], [9, 18], [13, 13], [13, 0]], 24),
      geo.transformar(geo.cilindro(4, 0, 28, 10), T(0, R, 0)),
    );
    const mango = geo.transformar(geo.revolucion([[26, 0], [26, 8], [30, 10.5], [62, 10.5], [66, 7], [66, 0]], 16), T(0, R, 0));
    return { cromo, mango };
  }

  // =====================================================================================
  // MODELO en mm. Ejes del MUNDO: X = eje del husillo (la Z del torno), Y = arriba, Z = hacia el operario.
  // El origen está en el eje, a la altura de la cara de la pieza (Z = 0 del torno).
  // =====================================================================================
  function construirModelo(gl) {
    const B = geo.cajaEntre, s = (g) => subir(gl, g), m = {};
    // ---- fijo ----
    m.bancada = s(geo.juntar(
      B(-560, 470, -330, -175, -135, 135, 8),                                  // bancada
      B(-560, -300, -760, -330, -150, 150, 8), B(270, 470, -760, -330, -150, 150, 8),   // pies
      B(-555, -305, -760, -738, -156, 156, 3), B(275, 465, -760, -738, -156, 156, 3),   // zócalos
    ));
    m.claro = s(geo.juntar(
      B(-560, -275, -175, 170, -150, 140, 12),                                 // cabezal
      B(-560, -320, -320, -190, 135, 172, 6),                                  // caja de avances (Norton)
      B(140, 330, -153, -122, -125, 125, 5),                                   // base del contrapunto
      B(150, 318, -122, -30, -78, 78, 8),                                      // cuerpo del contrapunto
      geo.cilindro(42, 120, 318, 36),                                          // cañón (coaxial con el husillo)
    ));
    m.tapa = s(B(-550, -285, 170, 182, -140, 130, 5));
    m.guias = s(geo.juntar(B(-560, 470, -175, -153, -112, -78, 3), B(-560, 470, -175, -153, 78, 112, 3)));
    m.acero = s(geo.juntar(
      geo.cilindro(56, -275, -250, 40),                                        // nariz del husillo
      geo.transformar(geo.cilindro(9, -300, 270, 16), T(0, -205, 150)),        // husillo de roscar
      geo.transformar(geo.cilindro(7, -300, 270, 14), T(0, -245, 150)),        // barra de cilindrar
      geo.cilindro(16, 318, 345, 20),                                          // cubo trasero del contrapunto
      geo.transformar(geo.cilindro(6, 0, 70, 10), cad(T(255, 40, 0), Y(-MEDIO))),
      ...[-520, -440, -360].map((x) => geo.transformar(geo.cilindro(5, 0, 40, 10), cad(T(x, -250, 172), Y(-MEDIO)))),
      ...[-500, -430].map((x) => geo.transformar(geo.cilindro(6, 0, 60, 10), cad(T(x, 182, 60), Z(MEDIO)))),
    ));
    const pomo = (r, l) => geo.revolucion([[0, 0], [0, r * 0.85], [r * 0.5, r], [l - r * 0.4, r], [l, r * 0.6], [l, 0]], 16);
    m.naranjaFija = s(geo.juntar(
      geo.transformar(pomo(10, 26), cad(T(255, 40, 70), Y(-MEDIO))),
      ...[-520, -440, -360].map((x) => geo.transformar(pomo(9, 22), cad(T(x, -250, 212), Y(-MEDIO)))),
      ...[-500, -430].map((x) => geo.transformar(pomo(11, 24), cad(T(x, 242, 60), Z(MEDIO)))),
    ));
    m.bandeja = s(geo.juntar(
      B(-300, 270, -690, -672, -170, 200, 3),                                  // bandeja de virutas
      B(-300, 270, -672, -632, 192, 200, 2), B(-300, 270, -672, -632, -170, -162, 2),
      B(-275, 330, -153, 60, -168, -160, 3),                                   // protección trasera
    ));
    m.negro = s(geo.juntar(B(-545, -300, -20, 140, 140, 146, 3), B(-540, -460, 0, 60, 146, 148, 1)));
    m.pantalla = s(B(-535, -465, 5, 55, 148, 149.5));
    m.amarillo = s(geo.transformar(geo.cilindro(34, 0, 4, 32), cad(T(-350, 60, 146), Y(-MEDIO))));
    m.pulsador = s(geo.revolucion([[0, 0], [0, 15], [6, 15], [9, 12], [9, 0]], 24));
    m.seta = s(geo.revolucion([[0, 0], [0, 9], [14, 9], [14, 28], [19, 27], [25, 21], [28, 11], [29, 0]], 28));
    m.poste = s(geo.transformar(geo.cilindro(7, 0, 90, 12), cad(T(-540, 182, -120), Z(MEDIO))));
    m.segmento = s(geo.revolucion([[0, 0], [0, 19], [2, 20], [32, 20], [34, 19], [34, 0]], 28));
    m.tapaBaliza = s(geo.transformar(geo.revolucion([[0, 0], [0, 20], [6, 16], [9, 0]], 24), cad(T(-540, 374, -120), Z(MEDIO))));
    // lámpara de trabajo con brazo flexible, apuntando a la zona de corte
    const cabeza = [-165, 238, 30], dirLuz = GL.v3.norm(GL.v3.resta([-40, 0, 30], cabeza));
    m.brazo = s(geo.juntar(cuentas([[-300, 182, -100], [-300, 300, -100], [-205, 305, -5], cabeza], 22, 7),
      geo.transformar(geo.cilindro(22, 0, 10, 20), cad(T(-300, 182, -100), Z(MEDIO)))));
    m.lampara = s(geo.transformar(geo.revolucion([[0, 0], [0, 12], [10, 16], [42, 30], [46, 30], [46, 0]], 28), m4.base(dirLuz, cabeza)));
    m.bombilla = s(geo.transformar(geo.cilindro(27, 44, 47, 28), m4.base(dirLuz, cabeza)));
    m.luzPos = [0, 1, 2].map((k) => cabeza[k] + dirLuz[k] * 70);

    // ---- plato (gira) ----
    m.plato = s(geo.revolucion([[-250, 0], [-250, 76], [-246, 82], [-173, 82], [-167, 77], [-165, 77], [-165, 0]], 48));
    m.ranuras = s(geo.juntar(...[0, 1, 2].map((k) => geo.transformar(B(-166, -164.6, 28, 78, -13, 13), X((k * 2 * Math.PI) / 3)))));
    m.marca = s(B(-238, -182, 80, 84, -7, 7, 1.5));          // franja naranja: así se ve girar el plato
    m.garra = s(geo.juntar(B(-165, -150, 44, 79, -12, 12, 2), B(-165, -140, 25, 52, -11, 11, 2)));
    m.borroso = s(geo.revolucion([[-166, 25.5], [-166, 80], [-149, 80], [-149, 53], [-139, 53], [-139, 25.5]], 48));

    // ---- carro longitudinal (se mueve con la Z del torno) ----
    m.carro = s(geo.juntar(B(-75, 105, -153, -123, -150, 150, 4), B(-45, 75, -123, -112, -150, 150, 2)));
    m.delantal = s(B(-95, 115, -320, -153, 135, 168, 6));
    // ---- grupo transversal (Z y X): coordenadas relativas a la PUNTA de la herramienta ----
    m.transversal = s(geo.juntar(B(-55, 85, -112, -95, -40, 230, 4), B(-40, 70, -95, -72, 40, 130, 4)));
    m.portaherr = s(geo.juntar(B(-8, 52, -72, -8, 26, 86, 3), B(-6, 12, -18, -3, 6, 80, 1.5)));
    m.plaquita = s(B(-1.5, 10, -4, 0.5, -0.5, 9, 0.6));
    m.aceroT = s(geo.juntar(
      geo.transformar(geo.cilindro(9, 0, 30, 14), cad(T(15, -103, 228), Y(-MEDIO))),   // eje del volante transversal
      geo.transformar(geo.cilindro(10, 0, 20, 16), cad(T(22, -8, 56), Z(MEDIO))),      // tuerca de la torreta
      geo.transformar(geo.cilindro(4, 0, 50, 10), cad(T(22, 6, 56), Y(-0.6))),         // maneta de apriete
    ));
    m.naranjaT = s(geo.juntar(geo.transformar(pomo(7, 17), cad(T(22, 6, 56), Y(-0.6), T(50, 0, 0)))));
    // Manguera articulada de la taladrina: sale de la parte TRASERA de la silla (se mueve solo con Z), sube por
    // detrás de la pieza y baja por encima hasta la punta. Así no tapa el corte desde las vistas habituales.
    const finManguera = [-20, 44, 22];
    m.manguera = s(geo.juntar(cuentas([[-60, -120, -118], [-88, 100, -125], [-48, 96, 12], finManguera], 22, 6.5),
      B(-74, -46, -123, -112, -132, -104, 2)));
    m.dirBoquilla = GL.v3.norm(GL.v3.resta([0, 4, 27], finManguera));      // apunta a la zona de corte
    m.boquilla = s(geo.transformar(geo.revolucion([[0, 0], [0, 6.5], [16, 3.5], [16, 0]], 14), m4.base(m.dirBoquilla, finManguera)));
    m.puntaBoquilla = [0, 1, 2].map((k) => finManguera[k] + m.dirBoquilla[k] * 16);
    const v = volante(60);
    m.volCromo = s(v.cromo); m.volMango = s(v.mango);
    m.palanca = s(geo.cilindro(5, 0, 50, 10));
    m.palancaPomo = s(geo.revolucion([[44, 0], [46, 8], [52, 11], [58, 8], [60, 0]], 14));

    // ---- contrapunto: caña y punto (se mueven con la caña) ----
    m.cana = s(geo.cilindro(25, 0, 200, 32));
    m.punto = s(geo.revolucion([[-35, 0], [0, 17], [0, 0]], 28));

    // ---- protector del plato: concha transparente con marco naranja y bisagra atrás ----
    const RP = 110, A0 = -0.55, A1 = 1.95, vidrio = geo.nueva(), nA = 26;
    for (let k = 0; k <= nA; k++) {
      const a = A0 + ((A1 - A0) * k) / nA, c = Math.cos(a), sn = Math.sin(a);
      vidrio.pos.push(-272, RP * c, RP * sn, -136, RP * c, RP * sn);
      vidrio.nor.push(0, c, sn, 0, c, sn);
    }
    for (let k = 0; k < nA; k++) { const q = k * 2; vidrio.idx.push(q, q + 1, q + 3, q, q + 3, q + 2); }
    m.vidrio = s(vidrio);
    m.marco = s(geo.juntar(arco(-272, RP, A0, A1, 18, 7), arco(-136, RP, A0, A1, 18, 7),
      geo.transformar(geo.caja(136, 7, 7, 1.5), cad(X(A0), T(-204, RP, 0))),
      geo.transformar(geo.caja(136, 7, 7, 1.5), cad(X(A1), T(-204, RP, 0)))));
    m.bisagra = [RP * Math.cos(A0), RP * Math.sin(A0)];

    const suelo = geo.nueva();
    geo.quad(suelo, [-2300, -760, -1600], [2000, -760, -1600], [2000, -760, 1800], [-2300, -760, 1800], [0, 1, 0]);
    m.suelo = s(suelo);

    // ---- pieza: malla fija de (N + 2) anillos × 49 ángulos + tapa; el radio sale de la textura ----
    const N = PIEZA.N, S = 48, dat = [], idx = [];
    for (let i = -1; i <= N; i++) for (let j = 0; j <= S; j++) dat.push(i, (j / S) * Math.PI * 2, 0);
    for (let f = 0; f < N + 1; f++) for (let j = 0; j < S; j++) { const a = f * (S + 1) + j, b = a + S + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const base = dat.length / 3;
    for (let j = 0; j <= S; j++) dat.push(N, (j / S) * Math.PI * 2, 1);
    dat.push(N, 0, 2);
    for (let j = 0; j < S; j++) idx.push(base + j, base + j + 1, base + S + 1);
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dat), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    m.pieza = { vao, n: idx.length };
    m.texPerfil = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, m.texPerfil);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, N, 1, 0, gl.RG, gl.FLOAT, null);
    for (const [p, val] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, val);
    return m;
  }

  // =====================================================================================
  // MÓDULO: cámara, bucle de dibujo, partículas y etiquetas
  // =====================================================================================
  const FOV = (32 * Math.PI) / 180;
  const PRESETS = {
    general: { yaw: 0.42, pitch: 0.3, dist: 2150, tx: -50, ty: -175, tz: 40, sigue: 0 },
    corte: { yaw: 0.22, pitch: 0.8, dist: 640, tx: 0, ty: -10, tz: 20, sigue: 1 },      // sigue a la herramienta, desde arriba
    cabezal: { yaw: -0.55, pitch: 0.26, dist: 1000, tx: -320, ty: -20, tz: 40, sigue: 0 },
  };
  const CALIENTES = [[0.86, 0.7, 0.38], [0.4, 0.5, 0.92], [0.58, 0.38, 0.7], [0.75, 0.52, 0.3]];   // virutas "pavonadas"
  const PLATA = [0.7, 0.74, 0.8];
  const MAXP = 1400, CERO = new Float32Array(3), ID = m4.id();
  const LUCES = { verde: [0.1, 1.3, 0.3], ambar: [1.4, 0.6, 0.05], rojo: [1.5, 0.08, 0.05] };
  const BASES = { verde: lineal('#1c5a2c'), ambar: lineal('#6a4a10'), rojo: lineal('#5a1414') };
  const PULS = { verde: lineal('#1fae4b'), rojo: lineal('#d4202a'), azul: lineal('#1f5fd4') };
  const suave = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function iniciarEscena3d(ctx) {
    const { soporte, reducido, informar, maquina, remoto, objetivo } = ctx;
    const lienzo = document.querySelector('#lienzo-3d');
    const linea = document.querySelector('#estado-3d');
    // Alternativa: sin WebGL2 se enseña el plano 2D (perfil2d.js) en el sitio del gemelo
    const alternativa = (motivo) => { lienzo.hidden = true; return window.Torno.iniciarVistaPlano(ctx, motivo); };
    if (!soporte.webgl2) return alternativa(soporte.forzado2d ? 'forzada con #2d en la dirección' : 'este navegador no tiene WebGL2');
    const gl = lienzo.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) return alternativa('no se pudo crear el contexto WebGL2');
    let m, pObj, pSuelo, pPieza, pPuntos;
    try {
      m = construirModelo(gl);
      pObj = programa(gl, VS_OBJ, FS_OBJ); pSuelo = programa(gl, VS_OBJ, FS_SUELO);
      pPieza = programa(gl, VS_PIEZA, FS_PIEZA); pPuntos = programa(gl, VS_PUNTOS, FS_PUNTOS);
    } catch (err) { console.error('[escena3d]', err); return alternativa('falló la preparación 3D'); }
    linea.textContent = 'Gemelo 3D (WebGL2) · arrastra para girar la cámara · Ctrl + rueda o los botones para acercar · doble clic: vista general';

    // ---------- partículas (virutas y gotas) en arrays tipados: nada de objetos por partícula ----------
    const P = { pos: new Float32Array(MAXP * 3), vel: new Float32Array(MAXP * 3), col: new Float32Array(MAXP * 4),
      ext: new Float32Array(MAXP * 3), edad: new Float32Array(MAXP), vida: new Float32Array(MAXP), est: new Uint8Array(MAXP) };
    const paquete = new Float32Array(MAXP * 10);
    const vaoP = gl.createVertexArray(); gl.bindVertexArray(vaoP);
    const vboP = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vboP);
    gl.bufferData(gl.ARRAY_BUFFER, paquete.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 28);
    gl.bindVertexArray(null);
    let cursor = 0, activas = 0, gotasAcum = 0, volPendiente = 0, ultimoCorte = null;
    const nueva = () => {              // hueco libre; si no hay, se recicla el más antiguo (round robin)
      for (let k = 0; k < MAXP; k++) { const i = (cursor + k) % MAXP; if (!P.est[i]) { cursor = (i + 1) % MAXP; return i; } }
      const i = cursor; cursor = (cursor + 1) % MAXP; return i;
    };
    const bajas = [maquina.on('corte', (c) => { if (remoto.enLinea()) { volPendiente += c.vol; ultimoCorte = c; } })];

    function viruta(c, s) {
      const i = nueva(), moja = s.refrigerante.caudal > 0.3, k = moja ? 0.6 : 1;
      const arriba = s.husillo.rpm >= 0 ? 1 : -1;              // con M4 la viruta sale hacia abajo
      P.est[i] = 1; P.edad[i] = 0;
      P.pos.set([c.z + (Math.random() - 0.5) * 3, 1 + Math.random() * 3, c.x + 1.5], i * 3);
      P.vel.set([(Math.random() * 360 - 120) * k, (220 + Math.random() * 420) * arriba * k, (220 + Math.random() * 480) * k], i * 3);
      // Seca y rápida → viruta "pavonada" (azul, pajiza, violeta); con taladrina sale plateada
      const tono = !moja && Math.abs(s.husillo.rpm) > 700 ? CALIENTES[(Math.random() * CALIENTES.length) | 0] : PLATA;
      P.col.set([tono[0], tono[1], tono[2], 1], i * 4);
      P.ext.set([9 + Math.random() * 8, Math.random() * 6.28, 0], i * 3);
    }
    function gota(s) {
      const i = nueva(), b = m.puntaBoquilla, d = m.dirBoquilla, v = 900 + Math.random() * 300;
      P.est[i] = 1; P.edad[i] = 0; P.vida[i] = 0.45 + Math.random() * 0.35;
      P.pos.set([s.ejes.z + b[0], b[1], b[2]], i * 3);                     // boquilla fija al carro longitudinal
      P.vel.set([0, 1, 2].map((q) => (d[q] + (Math.random() - 0.5) * 0.18) * v), i * 3);
      P.col.set([0.25, 0.62, 1.0, 0.9], i * 4);
      P.ext.set([4 + Math.random() * 3, 0, 1], i * 3);
    }
    function emitir(s, dt) {
      if (volPendiente > 0 && ultimoCorte) {
        const n = Math.min(6, Math.floor(volPendiente / 12));   // una viruta cada 12 mm³, como mucho 6 por fotograma
        for (let k = 0; k < n; k++) viruta(ultimoCorte, s);
        volPendiente = Math.min(volPendiente - n * 12, 300);
      }
      if (s.refrigerante.caudal > 0.05) {
        gotasAcum += dt * 150 * s.refrigerante.caudal;
        while (gotasAcum >= 1) { gotasAcum -= 1; gota(s); }
      }
    }
    function moverParticulas(dt) {
      if (dt <= 0) return;
      for (let i = 0; i < MAXP; i++) {
        const est = P.est[i];
        if (!est) continue;
        P.edad[i] += dt;
        if (est === 2) {                                  // posada: se desvanece a los 25 s
          if (P.edad[i] > 25) { const a = 1 - (P.edad[i] - 25) / 3; if (a <= 0) P.est[i] = 0; else P.col[i * 4 + 3] = a; }
          continue;
        }
        const k = i * 3, gotaTipo = P.ext[k + 2] > 0.5;
        if (gotaTipo && P.edad[i] > P.vida[i]) { P.est[i] = 0; continue; }
        P.vel[k + 1] -= 9800 * dt;                        // gravedad en mm/s²
        const roce = Math.max(0, 1 - (gotaTipo ? 0.4 : 1.5) * dt);
        P.vel[k] *= roce; P.vel[k + 1] *= roce; P.vel[k + 2] *= roce;
        P.pos[k] += P.vel[k] * dt; P.pos[k + 1] += P.vel[k + 1] * dt; P.pos[k + 2] += P.vel[k + 2] * dt;
        const x = P.pos[k], y = P.pos[k + 1], z = P.pos[k + 2];
        if (gotaTipo) {
          // La gota llega a la pieza y salpica (una sola vez: ext.y marca "ya salpicó")
          if (P.ext[k + 1] < 0.5 && x > -140 && x < 2 && Math.hypot(y, z) < 28) {
            P.ext[k + 1] = 1;
            P.vel.set([(Math.random() - 0.5) * 300, 150 + Math.random() * 300, 120 + Math.random() * 350], k);
          }
          if (y < -153) P.est[i] = 0;
          continue;
        }
        P.ext[k + 1] += dt * 9;                           // la viruta da vueltas en el aire
        let suelo = null;
        if (y < -152 && x > -560 && x < 470 && z > -135 && z < 135) suelo = -151;          // guías y bancada
        else if (y < -670 && x > -300 && x < 270 && z > -170 && z < 200) suelo = -669;    // bandeja de virutas
        else if (y < -758) suelo = -757;
        if (suelo !== null) { P.pos[k + 1] = suelo; P.est[i] = 2; P.edad[i] = 0; }
      }
    }

    // ---------- cámara: un objeto JS que anima Anime.js y lee el bucle de dibujo ----------
    const cam = { ...PRESETS.general };
    const botonesVista = [...document.querySelectorAll('[data-vista]')];
    let animCam = null, vistaActual = 'general', ultimaInteraccion = 0, pesoDeriva = 0;
    function irVista(nombre, ms = 1300) {
      vistaActual = nombre;
      botonesVista.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vista === nombre)));
      animCam?.cancel();
      if (reducido) { Object.assign(cam, PRESETS[nombre]); return; }
      animCam = animate(cam, { ...PRESETS[nombre], duration: ms, ease: 'inOut(3)' });
    }
    const vistaLibre = () => { vistaActual = 'libre'; botonesVista.forEach((b) => b.setAttribute('aria-pressed', 'false')); };
    const onVista = (ev) => { const b = ev.target.closest('[data-vista]'); if (b) { ultimaInteraccion = performance.now(); irVista(b.dataset.vista); } };
    const onZoom = (ev) => {
      const b = ev.target.closest('[data-zoom]'); if (!b) return;
      animCam?.cancel(); ultimaInteraccion = performance.now();
      const d = clamp(cam.dist * (b.dataset.zoom === '+' ? 0.75 : 1.33), 320, 3600);
      if (reducido) cam.dist = d; else animCam = animate(cam, { dist: d, duration: 450, ease: 'out(3)' });
    };
    const barra = document.querySelector('.gemelo__vistas');
    barra.addEventListener('click', onVista); barra.addEventListener('click', onZoom);

    // Arrastre para orbitar (un solo dueño de la cámara: al arrastrar se cancela la animación de vista)
    let arrastre = null;
    const abajo = (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      animCam?.cancel(); vistaLibre(); ultimaInteraccion = performance.now();
      arrastre = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      lienzo.setPointerCapture(ev.pointerId);
    };
    const mover = (ev) => {
      if (!arrastre || ev.pointerId !== arrastre.id) return;
      cam.yaw -= (ev.clientX - arrastre.x) * 0.006;
      if (ev.pointerType === 'mouse') cam.pitch = clamp(cam.pitch + (ev.clientY - arrastre.y) * 0.005, 0.04, 1.3);
      arrastre.x = ev.clientX; arrastre.y = ev.clientY; ultimaInteraccion = performance.now();
    };
    const arriba = (ev) => { if (arrastre && ev.pointerId === arrastre.id) arrastre = null; };
    const rueda = (ev) => {                 // solo con Ctrl: la rueda sola debe seguir desplazando la página
      if (!ev.ctrlKey) return;
      ev.preventDefault(); animCam?.cancel(); vistaLibre();
      cam.dist = clamp(cam.dist * (1 + ev.deltaY * 0.0012), 320, 3600); ultimaInteraccion = performance.now();
    };
    const doble = () => irVista('general');
    lienzo.addEventListener('pointerdown', abajo); lienzo.addEventListener('pointermove', mover);
    lienzo.addEventListener('pointerup', arriba); lienzo.addEventListener('pointercancel', arriba);
    lienzo.addEventListener('wheel', rueda, { passive: false }); lienzo.addEventListener('dblclick', doble);

    // Entrada: la cámara baja desde lo alto hasta la vista general (sin ella con movimiento reducido)
    if (!reducido) { Object.assign(cam, { yaw: 1.3, pitch: 0.95, dist: 3600 }); irVista('general', 2800); }

    // ---------- tamaño, colores del tema y textura del perfil ----------
    let W = 1, H = 1, cssW = 1, cssH = 1, cambioTam = true;
    const ro = new ResizeObserver(() => { cambioTam = true; });
    ro.observe(lienzo);
    function ajustarTam() {
      const r = lienzo.getBoundingClientRect(), dpr = dprLimitado();
      cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
      W = Math.round(cssW * dpr); H = Math.round(cssH * dpr);
      lienzo.width = W; lienzo.height = H; cambioTam = false;
    }
    const leerColores = () => {
      const cs = getComputedStyle(document.documentElement);
      const leer = (n, d) => lineal(cs.getPropertyValue(n).trim() || d);
      return { suelo: leer('--suelo-3d', '#1b2024'), cielo: leer('--cielo-3d', '#8d9aa8'), rebote: leer('--rebote-3d', '#2a2622') };
    };
    let colores = leerColores();
    const alTema = () => { colores = leerColores(); };
    document.addEventListener('cambiotema', alTema);
    let versionSubida = '';
    const bufPerfil = new Float32Array(PIEZA.N * 2);
    function subirPerfil(p) {
      // Se vuelve a subir si cambia la pieza real o la pieza cargada (.step)
      const clave = p.version + '|' + (objetivo?.version || 0);
      if (clave === versionSubida) return;
      const o = objetivo?.radios;
      for (let i = 0; i < PIEZA.N; i++) {
        // Estado respecto a la pieza cargada (tolerancia ±0,1 mm): 1 = sobra material, 2 = pasado de cota
        const est = !o ? 0 : p.radios[i] > o[i] + 0.1 ? 1 : p.radios[i] < o[i] - 0.1 ? 2 : 0;
        bufPerfil[i * 2] = p.radios[i]; bufPerfil[i * 2 + 1] = p.mec[i] + 2 * est;
      }
      gl.bindTexture(gl.TEXTURE_2D, m.texPerfil);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PIEZA.N, 1, gl.RG, gl.FLOAT, bufPerfil);
      versionSubida = clave;
    }

    // ---------- dibujo ----------
    let VP = ID, ojo = [0, 0, 1], luzInt = 1, dibujados = 0;
    function usar(p) {
      const u = p.u;
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(u.uVP, false, VP);
      gl.uniform3fv(u.uCam, ojo); gl.uniform3fv(u.uLuzPos, m.luzPos); gl.uniform1f(u.uLuzInt, luzInt);
      gl.uniform3fv(u.uCielo, colores.cielo); gl.uniform3fv(u.uSuelo, colores.rebote);
    }
    function obj(p, malla, mat, M, o) {
      const u = p.u;
      gl.uniformMatrix4fv(u.uM, false, M);
      gl.uniform3fv(u.uColor, (o && o.color) || mat.c);
      gl.uniform1f(u.uMetal, mat.m); gl.uniform1f(u.uRugo, mat.r);
      gl.uniform1f(u.uAlfa, o && o.alfa != null ? o.alfa : 1);
      gl.uniform3fv(u.uEmis, (o && o.emis) || CERO);
      gl.bindVertexArray(malla.vao);
      gl.drawElements(gl.TRIANGLES, malla.n, gl.UNSIGNED_INT, 0);
      dibujados++;
    }
    let angVis = 0, palanca = -0.45, tiempo = 0;

    function dibujar(s) {
      dibujados = 0;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);      // colores premultiplicados
      gl.depthMask(true);
      const asp = W / H, zt = s.ejes.z, xt = s.ejes.x, c = s.ejes.c;
      const yaw = cam.yaw + 0.07 * Math.sin(performance.now() / 1000 * 0.18) * pesoDeriva;
      const lejos = cam.dist * Math.max(1, 1.5 / asp);   // en vertical (móvil) se aleja para que quepa la máquina
      const tgt = [cam.tx + (zt - 25 - cam.tx) * cam.sigue, cam.ty + (-10 - cam.ty) * cam.sigue, cam.tz + (xt * 0.5 - cam.tz) * cam.sigue];
      ojo = [tgt[0] + lejos * Math.cos(cam.pitch) * Math.sin(yaw), tgt[1] + lejos * Math.sin(cam.pitch), tgt[2] + lejos * Math.cos(cam.pitch) * Math.cos(yaw)];
      VP = m4.mul(m4.persp(FOV, asp, 20, 14000), m4.mirar(ojo, tgt));
      luzInt = s.luz.nivel;

      usar(pSuelo); obj(pSuelo, m.suelo, MAT.oscuro, ID, { color: colores.suelo });
      usar(pObj);
      obj(pObj, m.bancada, MAT.oscuro, ID); obj(pObj, m.claro, MAT.claro, ID); obj(pObj, m.tapa, MAT.oscuro, ID);
      obj(pObj, m.guias, MAT.guia, ID); obj(pObj, m.acero, MAT.acero, ID); obj(pObj, m.naranjaFija, MAT.naranja, ID);
      obj(pObj, m.bandeja, MAT.bandeja, ID); obj(pObj, m.negro, MAT.negro, ID); obj(pObj, m.amarillo, MAT.amarillo, ID);
      obj(pObj, m.pantalla, MAT.negro, ID, { emis: [0.02, s.husillo.marcha ? 0.16 : 0.07, 0.1] });
      // botonera de la máquina: las mismas luces que la botonera de la web
      const destello = reducido || tiempo % 1 < 0.55;
      const PR = (x) => cad(T(x, 95, 146), Y(-MEDIO));
      obj(pObj, m.pulsador, MAT.naranja, PR(-515), { color: PULS.verde, emis: s.husillo.marcha ? [0.15, 1.1, 0.3] : CERO });
      obj(pObj, m.pulsador, MAT.naranja, PR(-475), { color: PULS.rojo });
      obj(pObj, m.pulsador, MAT.naranja, PR(-435), { color: PULS.azul, emis: s.alarma && !s.seta && destello ? [0.1, 0.35, 1.4] : CERO });
      obj(pObj, m.seta, MAT.naranja, cad(T(-350, 60, 150 - (s.seta ? 7 : 0)), Y(-MEDIO)), { color: PULS.rojo });
      // baliza
      const b = senalesBaliza({ prueba: s.prueba, seta: s.seta, alarma: s.alarma, protector: s.protector.cerrado,
        plato: s.plato.cerrado, marcha: s.husillo.marcha }, tiempo, reducido);
      [['verde', 272], ['ambar', 306], ['rojo', 340]].forEach(([k, y]) => obj(pObj, m.segmento, MAT.vidrio,
        cad(T(-540, y, -120), Z(MEDIO)), { color: BASES[k], emis: LUCES[k].map((v) => v * b[k] * 1.6) }));
      obj(pObj, m.poste, MAT.oscuro, ID); obj(pObj, m.tapaBaliza, MAT.negro, ID);
      // lámpara
      obj(pObj, m.brazo, MAT.oscuro, ID); obj(pObj, m.lampara, MAT.oscuro, ID);
      obj(pObj, m.bombilla, MAT.claro, ID, { emis: [2.2, 1.9, 1.4].map((v) => v * s.luz.nivel) });
      // plato y garras (giran con el husillo; las garras se abren 14 mm)
      const MP = X(angVis);
      obj(pObj, m.plato, MAT.acero, MP); obj(pObj, m.ranuras, MAT.negro, MP); obj(pObj, m.marca, MAT.naranja, MP);
      for (let k = 0; k < 3; k++) obj(pObj, m.garra, MAT.aceroOsc, cad(X(angVis + (k * 2 * Math.PI) / 3), T(0, 14 * s.plato.apertura, 0)));
      // carro longitudinal + delantal + volante del carro + palanca del avance
      const MC = T(zt, 0, 0);
      obj(pObj, m.carro, MAT.carro, MC); obj(pObj, m.delantal, MAT.claro, MC);
      const giro = (v, p) => (v / p) * Math.PI * 2;
      const MV = cad(T(zt - 55, -250, 176), Y(-MEDIO), X(giro(zt, PASO.z)));
      obj(pObj, m.volCromo, MAT.cromo, MV); obj(pObj, m.volMango, MAT.naranja, MV);
      const ML = cad(T(zt + 70, -205, 168), X(palanca), Y(-MEDIO));
      obj(pObj, m.palanca, MAT.cromo, ML); obj(pObj, m.palancaPomo, MAT.naranja, ML);
      // carro transversal, charriot, torreta, cuchilla, manguera y su volante
      const MT = T(zt, 0, xt);
      obj(pObj, m.transversal, MAT.carro, MT); obj(pObj, m.portaherr, MAT.aceroOsc, MT); obj(pObj, m.plaquita, MAT.oro, MT);
      obj(pObj, m.aceroT, MAT.acero, MT); obj(pObj, m.naranjaT, MAT.naranja, MT);
      obj(pObj, m.manguera, MAT.manguera, MC); obj(pObj, m.boquilla, MAT.naranja, MC);
      const MVx = cad(MT, T(15, -103, 258), Y(-MEDIO), X(giro(xt, PASO.x)), esc(0.72));
      obj(pObj, m.volCromo, MAT.cromo, MVx); obj(pObj, m.volMango, MAT.naranja, MVx);
      // contrapunto: caña, punto y volante trasero
      const MQ = T(120 - c, 0, 0);
      obj(pObj, m.cana, MAT.cromo, MQ); obj(pObj, m.punto, MAT.acero, MQ);
      const MVc = cad(T(352, 0, 0), X(-giro(c, PASO.c)), esc(0.85));
      obj(pObj, m.volCromo, MAT.cromo, MVc); obj(pObj, m.volMango, MAT.naranja, MVc);
      // protector: gira alrededor de la bisagra (trasladar al eje, girar y volver)
      const [hy, hz] = m.bisagra;
      const MG = cad(T(0, hy, hz), X(-s.protector.apertura * 1.75), T(0, -hy, -hz));
      obj(pObj, m.marco, MAT.naranja, MG);

      // pieza (shader propio: radio desde la textura del perfil)
      if (s.pieza.salida < 0.97) {
        subirPerfil(s.pieza);
        usar(pPieza);
        const u = pPieza.u, sal = s.pieza.salida;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, m.texPerfil); gl.uniform1i(u.uPerfil, 0);
        gl.uniform1f(u.uN, PIEZA.N); gl.uniform1f(u.uL, PIEZA.L); gl.uniform1f(u.uR, PIEZA.R); gl.uniform1f(u.uX0, -190);
        gl.uniform1f(u.uDifum, suave(150, 700, Math.abs(s.husillo.rpm)));
        gl.uniformMatrix4fv(u.uM, false, cad(T(s.pieza.entrada, 90 * sal, 330 * sal), X(angVis)));
        gl.bindVertexArray(m.pieza.vao);
        gl.drawElements(gl.TRIANGLES, m.pieza.n, gl.UNSIGNED_INT, 0);
        dibujados++;
      }

      // ---- pasada transparente: sin escribir profundidad (lo de detrás sigue viéndose) ----
      gl.depthMask(false);
      dibujarParticulas();
      usar(pObj);
      const borroso = suave(250, 900, Math.abs(s.husillo.rpm));
      if (borroso > 0.01) obj(pObj, m.borroso, MAT.aceroOsc, MP, { alfa: borroso * 0.75 });   // "estela" de las garras
      obj(pObj, m.vidrio, MAT.vidrio, MG, { alfa: 0.16 });
      gl.depthMask(true);
      gl.bindVertexArray(null);
    }

    function dibujarParticulas() {
      let n = 0;
      for (let i = 0; i < MAXP; i++) {
        if (!P.est[i]) continue;
        const o = n * 10;
        paquete[o] = P.pos[i * 3]; paquete[o + 1] = P.pos[i * 3 + 1]; paquete[o + 2] = P.pos[i * 3 + 2];
        paquete[o + 3] = P.col[i * 4]; paquete[o + 4] = P.col[i * 4 + 1]; paquete[o + 5] = P.col[i * 4 + 2]; paquete[o + 6] = P.col[i * 4 + 3];
        paquete[o + 7] = P.ext[i * 3]; paquete[o + 8] = P.ext[i * 3 + 1]; paquete[o + 9] = P.ext[i * 3 + 2];
        n++;
      }
      activas = n;
      if (!n) return;
      gl.useProgram(pPuntos.p);
      gl.uniformMatrix4fv(pPuntos.u.uVP, false, VP);
      gl.uniform1f(pPuntos.u.uEscala, H / (2 * Math.tan(FOV / 2)));   // mm → píxeles a esa distancia
      gl.bindVertexArray(vaoP);
      gl.bindBuffer(gl.ARRAY_BUFFER, vboP);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, paquete, 0, n * 10);
      gl.drawArrays(gl.POINTS, 0, n);
      dibujados++;
    }

    // ---------- etiquetas HTML pegadas a la máquina ----------
    const etiquetas = [...document.querySelectorAll('.etiqueta')].map((el) => ({ el, ancla: el.dataset.ancla, valor: el.querySelector('.etiqueta__valor') }));
    let ultimoTexto = 0, ultimoAria = 0;
    function proyectar(p) {
      const q = m4.aplicar(VP, p);
      if (q[3] <= 0) return null;
      return [(q[0] / q[3] * 0.5 + 0.5) * cssW, (0.5 - (q[1] / q[3]) * 0.5) * cssH];
    }
    function colocarEtiquetas(s) {
      const zt = s.ejes.z, xt = s.ejes.x;
      const anclas = { husillo: [-205, 100, 0], herramienta: [zt + 30, -8, xt + 96], contrapunto: [240, 48, 0] };
      for (const e of etiquetas) {
        const p = proyectar(anclas[e.ancla]);
        const fuera = !p || p[0] < 40 || p[0] > cssW - 40 || p[1] < 58 || p[1] > cssH - 4;
        e.el.style.visibility = fuera ? 'hidden' : '';
        if (!fuera) e.el.style.transform = 'translate(' + p[0].toFixed(1) + 'px, ' + p[1].toFixed(1) + 'px)';
      }
      const ahora = performance.now();
      if (ahora - ultimoTexto > 120) {
        ultimoTexto = ahora;
        const rpm = s.husillo.rpm;
        for (const e of etiquetas) {
          e.valor.textContent = e.ancla === 'husillo' ? (Math.abs(rpm) < 1 ? 'parado' : entero(Math.abs(rpm)) + ' rpm ' + (rpm > 0 ? '↻' : '↺'))
            : e.ancla === 'herramienta' ? 'Ø' + num(2 * xt, 2) + ' · Z' + num(zt, 2, true)
            : 'caña ' + num(s.ejes.c, 1) + ' mm' + (s.apoyo ? ' · apoyado' : '');
        }
      }
      if (ahora - ultimoAria > 1000) {
        ultimoAria = ahora;
        lienzo.setAttribute('aria-label', 'Gemelo digital del torno: husillo ' + (Math.abs(rpm0(s)) < 1 ? 'parado' : 'a ' + entero(Math.abs(rpm0(s))) + ' rpm')
          + ', herramienta en Ø ' + num(2 * xt, 2) + ' y Z ' + num(zt, 2) + ' mm' + (s.refrigerante.on ? ', taladrina en marcha' : '') + '.');
      }
    }
    const rpm0 = (s) => s.husillo.rpm;

    // ---------- bucle único (pausado fuera de pantalla) ----------
    let frames = 0;
    const reloj = createTimer({
      onUpdate: (t) => {
        const dt = clamp((t.deltaTime || 0) / 1000, 0, 1 / 30);
        const s = remoto.vista(), vivo = remoto.enLinea(), dtv = vivo ? dt : 0;   // sin conexión: imagen congelada
        tiempo += dtv;
        if (cambioTam) ajustarTam();
        // Giro visual del plato: como mucho 0,42 rad por fotograma. A 2000 rpm serían 3,5 rad y el ojo vería
        // el plato ir hacia atrás (efecto estroboscópico); la "estela" borrosa sugiere el resto de la velocidad.
        const paso = (s.husillo.rpm / 60) * Math.PI * 2 * dtv;
        angVis = (angVis + Math.sign(paso) * Math.min(Math.abs(paso), 0.42)) % (Math.PI * 2000);
        palanca += ((s.avance.auto ? 0.55 : -0.45) - palanca) * Math.min(1, dt * 10);
        const deriva = !reducido && vistaActual === 'general' && performance.now() - ultimaInteraccion > 6000;
        pesoDeriva += ((deriva ? 1 : 0) - pesoDeriva) * Math.min(1, dt * 0.8);
        if (vivo) emitir(s, dt); else volPendiente = 0;
        moverParticulas(dtv);
        dibujar(s);
        colocarEtiquetas(s);
        frames++;
      },
    });
    const dejarDeVer = alVerse(lienzo, (visible) => (visible ? reloj.resume() : reloj.pause()));
    const perdido = (ev) => { ev.preventDefault(); reloj.pause(); linea.textContent = 'La GPU reinició el contexto WebGL: recarga la página para recuperar el gemelo.'; };
    lienzo.addEventListener('webglcontextlost', perdido);

    informar('escena3d', () => ({ modo: 'webgl2', frames, dibujados, particulas: activas,
      herramienta: { z: +maquina.estado.ejes.z.toFixed(2), x: +maquina.estado.ejes.x.toFixed(2) }, vista: vistaActual }));

    return {
      irVista,
      destruir() {
        reloj.cancel(); animCam?.cancel(); ro.disconnect(); dejarDeVer();
        bajas.forEach((f) => f());
        barra.removeEventListener('click', onVista); barra.removeEventListener('click', onZoom);
        lienzo.removeEventListener('pointerdown', abajo); lienzo.removeEventListener('pointermove', mover);
        lienzo.removeEventListener('pointerup', arriba); lienzo.removeEventListener('pointercancel', arriba);
        lienzo.removeEventListener('wheel', rueda); lienzo.removeEventListener('dblclick', doble);
        lienzo.removeEventListener('webglcontextlost', perdido);
        document.removeEventListener('cambiotema', alTema);
      },
    };
  }

  window.Torno = Object.assign(window.Torno || {}, { iniciarEscena3d });
})();
