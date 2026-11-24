// step.js — ESCRIBIR y LEER archivos STEP (ISO 10303-21, protocolo AP214) de piezas de REVOLUCIÓN.
// Lo usan las dos páginas:
//   · generador.html → escribir(perfil): convierte el contorno marcado sobre el esquema en un sólido B-rep
//     (caras planas, cilíndricas y cónicas) que abren FreeCAD, Fusion, SolidWorks…
//   · index.html (torno) → leer(texto): saca de cualquier STEP de una pieza torneada su contorno exterior
//     (radio en función de la posición sobre el eje) para que el simulador sepa qué hay que mecanizar.
// Script CLÁSICO (no módulo ES) para que funcione con DOBLE CLIC (file://): se publica en window.Torno.step.
(() => {
  // ======================================================================================
  //  PERFIL: lista de puntos {z, r} (mm) del contorno exterior, de izquierda (lado del plato)
  //  a derecha (cara libre). z crece hacia la cara; r es el RADIO (en pantalla se enseña Ø = 2r).
  // ======================================================================================

  // Limpia un perfil antes de usarlo: quita puntos repetidos, junta escalones seguidos y descarta
  // los que vuelven atrás en Z. Por qué: el B-rep necesita que cada tramo sea un cilindro, un cono
  // o una corona plana; dos puntos iguales darían una cara de área cero y el CAD la rechazaría.
  function normalizar(perfil) {
    const out = [];
    for (const p of perfil) {
      const q = { z: +(+p.z).toFixed(4), r: +(+p.r).toFixed(4) };
      if (!isFinite(q.z) || !isFinite(q.r) || q.r <= 0) continue;
      const a = out[out.length - 1];
      if (a && Math.abs(a.z - q.z) < 1e-4 && Math.abs(a.r - q.r) < 1e-4) continue;   // repetido
      if (a && q.z < a.z - 1e-4) continue;                                             // vuelve atrás: no es torneable
      // tres puntos con la misma Z (escalón dentro de escalón): el del medio sobra
      const b = out[out.length - 2];
      if (a && b && Math.abs(a.z - q.z) < 1e-4 && Math.abs(b.z - a.z) < 1e-4) out.pop();
      out.push(q);
    }
    return out;
  }

  // ======================================================================================
  //  ESCRITOR
  // ======================================================================================
  // Construye el archivo entidad a entidad. Cada add() devuelve la referencia "#n" para usarla en otras.
  // Topología del sólido de revolución (eje = Z):
  //   · un VÉRTICE por punto del perfil, en (r, 0, z) (sobre la "costura" del plano XZ);
  //   · una arista CIRCULAR por punto (vuelta completa alrededor del eje);
  //   · una arista RECTA de costura por cada tramo cilíndrico o cónico;
  //   · caras: discos en los extremos, coronas planas en los escalones y cilindros/conos en el resto.
  // Las orientaciones están calculadas para que la normal de cada cara apunte FUERA del material.
  function escribir(perfilEntrada, { nombre = 'pieza', descripcion = 'Pieza de revolucion', autor = '' } = {}) {
    const perfil = normalizar(perfilEntrada);
    if (perfil.length < 2) throw new Error('El perfil necesita al menos dos puntos.');
    if (Math.abs(perfil[0].z - perfil[1].z) < 1e-4) throw new Error('El primer tramo no puede ser un escalón: empieza por un cilindro.');
    if (Math.abs(perfil.at(-1).z - perfil.at(-2).z) < 1e-4) throw new Error('El último tramo no puede ser un escalón: termina en un cilindro o un chaflán.');

    const lineas = [];
    let n = 0;
    const add = (txt) => { n++; lineas.push('#' + n + '=' + txt + ';'); return '#' + n; };
    // Números en formato STEP: siempre con punto decimal ("10." es válido, "10" sería un entero)
    const f = (v) => { const s = (Math.abs(v) < 1e-12 ? 0 : v).toFixed(6).replace(/0+$/, ''); return s.endsWith('.') ? s : s; };
    const pt = (x, y, z) => add("CARTESIAN_POINT('',(" + f(x) + ',' + f(y) + ',' + f(z) + '))');
    const dir = (x, y, z) => add("DIRECTION('',(" + f(x) + ',' + f(y) + ',' + f(z) + '))');
    const txt = (s) => "'" + String(s).replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_') + "'";   // ASCII: STEP no admite tildes sin codificar

    // ---- contexto de producto (lo que todo CAD espera encontrar en un AP214) ----
    const appCtx = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    add("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000," + appCtx + ')');
    const prodCtx = add("PRODUCT_CONTEXT(''," + appCtx + ",'mechanical')");
    const prod = add('PRODUCT(' + txt(nombre) + ',' + txt(nombre) + ',' + txt(descripcion) + ',(' + prodCtx + '))');
    add("PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(" + prod + '))');
    const form = add("PRODUCT_DEFINITION_FORMATION('',''," + prod + ')');
    const defCtx = add("PRODUCT_DEFINITION_CONTEXT('part definition'," + appCtx + ",'design')");
    const def = add("PRODUCT_DEFINITION('design',''," + form + ',' + defCtx + ')');
    const forma = add("PRODUCT_DEFINITION_SHAPE('',''," + def + ')');

    // ---- unidades: milímetros y radianes; tolerancia 1e-7 mm ----
    const mm = add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
    const rad = add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
    const sr = add('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
    const tol = add("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07)," + mm + ",'distance_accuracy_value','confusion accuracy')");
    const geoCtx = add('( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((' + tol + ')) GLOBAL_UNIT_ASSIGNED_CONTEXT((' +
      mm + ',' + rad + ',' + sr + ")) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )");

    // ---- geometría auxiliar compartida ----
    const ejeZ = dir(0, 0, 1), ejeZn = dir(0, 0, -1), ejeX = dir(1, 0, 0);
    const origen = add("AXIS2_PLACEMENT_3D('',"+ pt(0, 0, 0) + ',' + ejeZ + ',' + ejeX + ')');
    // Sistema de coordenadas en la cota z (para círculos, planos, cilindros y conos)
    const sistema = (z, eje = ejeZ) => add("AXIS2_PLACEMENT_3D(''," + pt(0, 0, z) + ',' + eje + ',' + ejeX + ')');

    // ---- vértices y aristas circulares (una por punto del perfil) ----
    const V = [], C = [];
    for (const p of perfil) {
      const v = add("VERTEX_POINT(''," + pt(p.r, 0, p.z) + ')');
      const circ = add("CIRCLE(''," + sistema(p.z) + ',' + f(p.r) + ')');
      V.push(v);
      // Arista cerrada: empieza y acaba en el mismo vértice (la costura)
      C.push(add("EDGE_CURVE(''," + v + ',' + v + ',' + circ + ',.T.)'));
    }
    const orientada = (arista, sentido) => add("ORIENTED_EDGE('',*,*," + arista + ',' + (sentido ? '.T.' : '.F.') + ')');
    const lazo = (...aristas) => add("EDGE_LOOP('',(" + aristas.join(',') + '))');
    const caras = [];
    // Cara plana a la altura z con normal +Z (arriba = true) o −Z
    function caraPlana(z, arriba, exterior, interior) {
      const limites = [add("FACE_OUTER_BOUND(''," + lazo(exterior) + ',.T.)')];
      if (interior) limites.push(add("FACE_BOUND(''," + lazo(interior) + ',.T.)'));
      const plano = add("PLANE(''," + sistema(z) + ')');
      caras.push(add("ADVANCED_FACE('',(" + limites.join(',') + '),' + plano + ',' + (arriba ? '.T.' : '.F.') + ')'));
    }

    // Disco del extremo izquierdo (lado del plato): normal −Z → el círculo se recorre al revés
    caraPlana(perfil[0].z, false, orientada(C[0], false));

    for (let k = 0; k < perfil.length - 1; k++) {
      const a = perfil[k], b = perfil[k + 1];
      if (Math.abs(b.z - a.z) < 1e-4) {
        // ESCALÓN (corona plana). Si sube (b.r > a.r) el material queda a la derecha → normal −Z.
        // El círculo k se usa .T. y el k+1 .F. (cada arista aparece una vez en cada sentido en el sólido).
        if (b.r > a.r) caraPlana(a.z, false, orientada(C[k + 1], false), orientada(C[k], true));
        else caraPlana(a.z, true, orientada(C[k], true), orientada(C[k + 1], false));
        continue;
      }
      // CILINDRO o CONO: arista recta de costura del vértice k al k+1
      const recta = add("LINE(''," + pt(a.r, 0, a.z) + ',' + add("VECTOR(''," + dir(b.r - a.r, 0, b.z - a.z) + ',' + f(Math.hypot(b.r - a.r, b.z - a.z)) + ')') + ')');
      const costura = add("EDGE_CURVE(''," + V[k] + ',' + V[k + 1] + ',' + recta + ',.T.)');
      let sup;
      if (Math.abs(b.r - a.r) < 1e-4) {
        sup = add("CYLINDRICAL_SURFACE(''," + sistema(a.z) + ',' + f(a.r) + ')');
      } else {
        // El semiángulo de un cono STEP debe ser positivo: si el radio baja hacia la derecha,
        // se apunta el eje del cono hacia −Z (así, siguiendo su eje, el radio crece).
        const crece = b.r > a.r;
        const ang = Math.atan(Math.abs(b.r - a.r) / (b.z - a.z));
        sup = add("CONICAL_SURFACE(''," + sistema(a.z, crece ? ejeZ : ejeZn) + ',' + f(a.r) + ',' + f(ang) + ')');
      }
      // Lazo en el sentido correcto respecto a la normal hacia fuera: círculo de abajo, costura subiendo,
      // círculo de arriba al revés y costura bajando.
      const l = lazo(orientada(C[k], true), orientada(costura, true), orientada(C[k + 1], false), orientada(costura, false));
      caras.push(add("ADVANCED_FACE('',(" + add("FACE_OUTER_BOUND(''," + l + ',.T.)') + '),' + sup + ',.T.)'));
    }
    // Disco del extremo derecho (cara libre): normal +Z
    caraPlana(perfil.at(-1).z, true, orientada(C.at(-1), true));

    const concha = add("CLOSED_SHELL('',(" + caras.join(',') + '))');
    const solido = add('MANIFOLD_SOLID_BREP(' + txt(nombre) + ',' + concha + ')');
    const rep = add("ADVANCED_BREP_SHAPE_REPRESENTATION(''," + '(' + origen + ',' + solido + '),' + geoCtx + ')');
    add('SHAPE_DEFINITION_REPRESENTATION(' + forma + ',' + rep + ')');

    const fecha = new Date().toISOString().slice(0, 19);
    // El perfil también va como COMENTARIO (los CAD lo ignoran): sirve para revisar el archivo a mano.
    const resumen = perfil.map((p) => f(p.z) + ':' + f(2 * p.r)).join(' ');
    return [
      'ISO-10303-21;',
      'HEADER;',
      'FILE_DESCRIPTION((' + txt(descripcion) + "),'2;1');",
      'FILE_NAME(' + txt(nombre + '.step') + ",'" + fecha + "',(" + txt(autor) + "),(''),'Generador TR-01','Generador TR-01','');",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      'ENDSEC;',
      'DATA;',
      '/* Generador TR-01 - perfil z:diametro (mm) = ' + resumen + ' */',
      ...lineas,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }

  // ======================================================================================
  //  LECTOR
  // ======================================================================================
  // 1) Trocea la sección DATA en entidades "#n = TIPO(argumentos)" respetando las cadenas entre comillas.
  // 2) Convierte los argumentos en árboles JS (números, cadenas, referencias, listas).
  // 3) Busca el EJE de revolución (la dirección que comparten la mayoría de los círculos).
  // 4) Pasa cada arista "de perfil" (rectas y arcos que no giran alrededor del eje) a coordenadas
  //    (t = posición sobre el eje, r = distancia al eje) y se queda con la ENVOLVENTE exterior.
  // Así vale para los STEP del generador y para piezas torneadas exteriores hechas en otro CAD.

  function trocear(texto) {
    const ini = texto.search(/\bDATA\s*;/i);
    if (ini < 0) throw new Error('No es un archivo STEP (no tiene sección DATA).');
    const ent = new Map();
    let i = texto.indexOf(';', ini) + 1, buf = '', enCadena = false;
    for (; i < texto.length; i++) {
      const ch = texto[i];
      if (enCadena) { buf += ch; if (ch === "'") enCadena = false; continue; }   // '' dentro de la cadena = dos cierres seguidos: funciona igual
      if (ch === "'") { enCadena = true; buf += ch; continue; }
      if (ch === '/' && texto[i + 1] === '*') { const fin = texto.indexOf('*/', i + 2); i = fin < 0 ? texto.length : fin + 1; continue; }   // comentario
      if (ch === ';') {
        const s = buf.trim(); buf = '';
        if (/^ENDSEC$/i.test(s)) break;
        const m = /^#(\d+)\s*=\s*([\s\S]*)$/.exec(s);
        if (m) ent.set(+m[1], m[2].trim());
        continue;
      }
      buf += ch;
    }
    return ent;
  }

  // Analizador de argumentos: "('',(1.,2.,3.))" → ['', [1, 2, 3]]. Las referencias "#12" quedan como {ref: 12}.
  function analizarArgs(s) {
    let i = 0;
    const blanco = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function valor() {
      blanco();
      const ch = s[i];
      if (ch === '(') { i++; const lista = []; blanco(); if (s[i] === ')') { i++; return lista; }
        for (;;) { lista.push(valor()); blanco(); if (s[i] === ',') { i++; continue; } if (s[i] === ')') { i++; return lista; } throw new Error('lista mal cerrada'); } }
      if (ch === "'") { let out = ''; i++; for (;;) { if (s[i] === "'" && s[i + 1] === "'") { out += "'"; i += 2; } else if (s[i] === "'") { i++; return out; } else if (i >= s.length) return out; else out += s[i++]; } }
      if (ch === '#') { i++; const m = /^\d+/.exec(s.slice(i)); i += m[0].length; return { ref: +m[0] }; }
      if (ch === '.') { const m = /^\.[A-Z0-9_]+\./i.exec(s.slice(i)); i += m[0].length; return { enum: m[0] }; }
      if (ch === '$' || ch === '*') { i++; return null; }
      const num = /^[+-]?(\d+\.?\d*|\.\d+)(E[+-]?\d+)?/i.exec(s.slice(i));
      if (num) { i += num[0].length; return parseFloat(num[0]); }
      // tipo dentro de argumentos, p. ej. LENGTH_MEASURE(1.E-07): se devuelve {tipo, args}
      const tipo = /^[A-Z_][A-Z0-9_]*/i.exec(s.slice(i));
      if (tipo) { i += tipo[0].length; blanco(); const a = s[i] === '(' ? valor() : []; return { tipo: tipo[0].toUpperCase(), args: a }; }
      throw new Error('carácter inesperado "' + ch + '"');
    }
    return valor();
  }

  // Factor para pasar las unidades del archivo a mm (pulgadas o metros si el CAD exportó así)
  function factorUnidades(texto) {
    if (/CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i.test(texto)) return 25.4;
    if (/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(texto)) return 1;
    if (/SI_UNIT\s*\(\s*\.CENTI\.\s*,\s*\.METRE\.\s*\)/i.test(texto)) return 10;
    if (/SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)/i.test(texto)) return 1000;
    return 1;
  }

  const resta = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const punto = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const longitud = (a) => Math.hypot(a[0], a[1], a[2]);
  const unitario = (a) => { const l = longitud(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  function leer(texto) {
    if (!/ISO-10303-21/.test(texto)) throw new Error('No es un archivo STEP (falta la cabecera ISO-10303-21).');
    const crudo = trocear(texto), k = factorUnidades(texto);
    const cache = new Map();
    // Devuelve {tipo, args} de la entidad n (analizada una sola vez). Las entidades complejas "( A() B() )"
    // se marcan como tipo 'COMPLEJA' (aquí solo hacen falta para unidades, que ya se leen con regex).
    const E = (n) => {
      if (cache.has(n)) return cache.get(n);
      const s = crudo.get(n); let out = null;
      if (s) {
        const m = /^([A-Z_][A-Z0-9_]*)\s*(\([\s\S]*\))$/i.exec(s);
        if (m) { try { out = { tipo: m[1].toUpperCase(), args: analizarArgs(m[2]) }; } catch { out = null; } }
        else out = { tipo: 'COMPLEJA', args: [] };
      }
      cache.set(n, out);
      return out;
    };
    const ref = (v) => (v && v.ref ? E(v.ref) : null);
    const coords = (p) => p.args[1].map((v) => v * k);                 // CARTESIAN_POINT → [x, y, z] en mm
    const direccion = (d) => unitario(d.args[1]);                      // DIRECTION → unitario
    const sistema = (a) => ({                                           // AXIS2_PLACEMENT_3D
      o: coords(ref(a.args[1])),
      z: a.args[2] ? direccion(ref(a.args[2])) : [0, 0, 1],
      x: a.args[3] ? direccion(ref(a.args[3])) : null,
    });

    // ---- todas las aristas ----
    const aristas = [];
    for (const n of crudo.keys()) {
      const e = E(n);
      if (!e || e.tipo !== 'EDGE_CURVE') continue;
      const v1 = ref(e.args[1]), v2 = ref(e.args[2]);
      let curva = ref(e.args[3]);
      // Algunos CAD envuelven la curva (SURFACE_CURVE / SEAM_CURVE): la 3D es el primer argumento
      if (curva && /^(SURFACE_CURVE|SEAM_CURVE|INTERSECTION_CURVE)$/.test(curva.tipo)) curva = ref(curva.args[1]);
      if (!v1 || !v2 || !curva) continue;
      aristas.push({ p1: coords(ref(v1.args[1])), p2: coords(ref(v2.args[1])), curva });
    }
    if (!aristas.length) throw new Error('El archivo no tiene aristas: ¿es un STEP de un sólido?');

    // ---- eje de revolución: dirección más repetida entre los círculos ----
    const circulos = aristas.filter((a) => a.curva.tipo === 'CIRCLE').map((a) => ({ s: sistema(ref(a.curva.args[1])), r: a.curva.args[2] * k }));
    if (!circulos.length) throw new Error('No hay aristas circulares: no parece una pieza de revolución.');
    const grupos = [];
    for (const c of circulos) {
      const g = grupos.find((g) => Math.abs(punto(g.dir, c.s.z)) > 0.9999);
      if (g) { g.n++; g.centros.push(c.s.o); } else grupos.push({ dir: c.s.z, n: 1, centros: [c.s.o] });
    }
    grupos.sort((a, b) => b.n - a.n);
    let eje = grupos[0].dir;
    // Que el eje apunte hacia +Z (o +X / +Y) para que "derecha" sea siempre la misma en piezas del generador
    if (eje[2] < -1e-9 || (Math.abs(eje[2]) < 1e-9 && (eje[0] < -1e-9 || (Math.abs(eje[0]) < 1e-9 && eje[1] < 0)))) eje = eje.map((v) => -v);
    const O = grupos[0].centros[0];
    // ¿Todos los centros están sobre la misma recta? Si no, hay agujeros excéntricos o no es de revolución
    const fuera = grupos[0].centros.filter((c) => { const d = resta(c, O); const t = punto(d, eje); return longitud(resta(d, eje.map((v) => v * t))) > 0.05; }).length;
    const aTR = (p) => { const d = resta(p, O), t = punto(d, eje); return { t, r: longitud(resta(d, eje.map((v) => v * t))) }; };

    // ---- aristas de perfil → segmentos en (t, r) ----
    const segmentos = [];
    let tMin = Infinity, tMax = -Infinity, rMax = 0;
    for (const a of aristas) {
      const A = aTR(a.p1), B = aTR(a.p2);
      tMin = Math.min(tMin, A.t, B.t); tMax = Math.max(tMax, A.t, B.t); rMax = Math.max(rMax, A.r, B.r);
      if (a.curva.tipo === 'CIRCLE') {
        const s = sistema(ref(a.curva.args[1]));
        if (Math.abs(punto(s.z, eje)) > 0.999) continue;                 // círculo alrededor del eje: es un "paralelo", no perfil
        // Arco en un plano que contiene el eje (redondeo / radio de acuerdo): se muestrea el arco corto
        const Cc = aTR(s.o), R = a.curva.args[2] * k;
        let a0 = Math.atan2(A.r - Cc.r, A.t - Cc.t), a1 = Math.atan2(B.r - Cc.r, B.t - Cc.t);
        let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        let prev = A;
        for (let j = 1; j <= 12; j++) {
          const ang = a0 + (da * j) / 12;
          const q = j === 12 ? B : { t: Cc.t + R * Math.cos(ang), r: Cc.r + R * Math.sin(ang) };
          segmentos.push([prev, q]); prev = q;
          rMax = Math.max(rMax, q.r);
        }
        continue;
      }
      if (Math.abs(A.t - B.t) < 1e-6) continue;                         // radial (borde de una corona partida): la envolvente ya lo resuelve
      segmentos.push([A, B]);                                           // recta (costura de cilindro/cono) o curva libre aproximada por su cuerda
    }
    if (!segmentos.length) throw new Error('No se encontraron aristas de perfil (costuras): no se puede reconstruir el contorno.');
    return { segmentos, tMin, tMax, rMax, largo: tMax - tMin, eje, excentricos: fuera, unidades: k };
  }

  // Radio de la envolvente exterior en la posición t (el mayor de los segmentos que la cubren). null si ninguno.
  function radioEn(segmentos, t) {
    let r = null;
    for (const [A, B] of segmentos) {
      const t0 = Math.min(A.t, B.t), t1 = Math.max(A.t, B.t);
      if (t < t0 - 1e-6 || t > t1 + 1e-6) continue;
      const u = t1 - t0 < 1e-9 ? 0 : (t - A.t) / (B.t - A.t);
      const v = A.r + (B.r - A.r) * Math.min(1, Math.max(0, u));
      if (r === null || v > r) r = v;
    }
    return r;
  }

  // Pasa la pieza leída a las muestras de la máquina. Convenio del torno: Z = 0 en la cara libre y
  // negativo hacia el plato; la muestra i cubre [−L + i·dz, −L + (i+1)·dz]. Por defecto la cara libre
  // es el extremo de MAYOR t (la derecha del esquema); voltear = true la cambia por el de menor t.
  // Fuera de la pieza (entre su final y el plato) se deja la barra en bruto: ese trozo no se mecaniza.
  function aMaquina(lectura, { L, N, R, rMin = 0 }, { voltear = false } = {}) {
    const dz = L / N, radios = new Float32Array(N).fill(R);
    const avisos = [];
    let fueraDeBarra = 0, bajoMinimo = 0;
    for (let i = 0; i < N; i++) {
      const zc = -L + (i + 0.5) * dz;                                   // centro de la muestra en coordenadas de máquina
      const t = voltear ? lectura.tMin - zc : lectura.tMax + zc;
      const r = radioEn(lectura.segmentos, t);
      if (r === null) continue;
      if (r > R + 1e-3) fueraDeBarra++;
      if (r < rMin) bajoMinimo++;
      radios[i] = Math.min(R, Math.max(rMin, r));
    }
    if (lectura.rMax > R + 1e-3) avisos.push('La pieza (Ø' + (2 * lectura.rMax).toFixed(2) + ') es más gruesa que la barra Ø' + 2 * R + ': esos tramos quedan en bruto.');
    if (lectura.largo > L - 4) avisos.push('La pieza mide ' + lectura.largo.toFixed(1) + ' mm y solo caben ' + (L - 4) + ' mm de voladizo: se recorta por el lado del plato.');
    if (bajoMinimo) avisos.push('Hay tramos por debajo de Ø' + 2 * rMin + ' (mínimo del torno): se dejan a Ø' + 2 * rMin + '.');
    if (lectura.excentricos) avisos.push('Hay ' + lectura.excentricos + ' círculos fuera del eje (agujeros excéntricos): se ignoran.');
    return { radios, avisos, fueraDeBarra };
  }

  window.Torno = Object.assign(window.Torno || {}, { step: { normalizar, escribir, leer, radioEn, aMaquina } });
})();
