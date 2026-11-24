// prueba-generador.js — simula a una persona usando el MODO SEMIASISTIDO con el esquema de ejemplo:
//   node <skill>/scripts/verificar-web.mjs "Torno Remoto" --pagina generador.html --sin-movil --prueba "Torno Remoto/prueba-generador.js"
// Hace los clics de verdad (eventos de puntero sobre el lienzo) en la escala, el eje y cada esquina del
// contorno, y comprueba que los puntos salen iguales que la "solución" del ejemplo y que el .step se relee.
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const G = () => window.__generador.estado();
const r = {};
const lienzo = $('#lienzo-esquema');
lienzo.scrollIntoView({ block: 'center' }); await espera(300);
function clic(x, y) {                 // x, y en px de la IMAGEN
  const p = window.__generador.aPantalla(x, y);
  const o = { clientX: p.x, clientY: p.y, button: 0, pointerId: 7, bubbles: true, pointerType: 'mouse' };
  lienzo.dispatchEvent(new PointerEvent('pointermove', o));
  lienzo.dispatchEvent(new PointerEvent('pointerdown', o));
  lienzo.dispatchEvent(new PointerEvent('pointerup', o));
}
const E = window.Torno.esquemaEjemplo, K = 2;          // el SVG se dibuja a 2× (width = 2 · viewBox)
const X = (z) => (E.X0 + z * E.ESC) * K, Y = (rr) => (E.Y0 - rr * E.ESC) * K;

$('#btn-ejemplo').click(); await espera(700);
r.imagen = G().imagen && G().pix && G().modo === 'escala';
// Escala: extremos de la cota total (100 mm) que está debajo de la pieza
clic(X(0), Y(-30)); await espera(80); clic(X(100), Y(-30)); await espera(150);
r.formulario = !$('#form-escala').hidden;
$('#escala-mm').value = '100'; $('#form-escala').requestSubmit(); await espera(150);
r.escala = Math.abs(G().pxmm - E.ESC * K) < 0.15 && G().modo === 'eje';
// Eje: dos clics sobre la línea de trazo y punto
clic(X(-5), Y(0) + 3); await espera(80); clic(X(105), Y(0) - 2); await espera(150);
r.eje = G().eje && G().modo === 'contorno';
// Contorno: un clic por esquina, con un poco de "pulso" (±3 px) para probar el imán y el modo ortogonal
const temblor = [2, -3, 1, 3, -2, 0, -1, 2, 3, -3, 1];
E.perfil.forEach((p, i) => clic(X(p.z) + temblor[i], Y(p.r) - temblor[(i + 3) % 11]));
await espera(300);
const pts = G().puntos;
r.puntos = pts.map((p) => p.z + ':' + 2 * p.r).join(' ');
// Las esquinas entre líneas paralelas y perpendiculares al eje tienen que salir EXACTAS gracias al imán.
// La punta del chaflán (último punto) no tiene línea paralela al eje donde pegarse: puede salir a ±0,5 mm
// y se corrige con la tabla, que es justo lo que explica el tutorial.
const exacto = (p, q) => Math.abs(p.z - q.z) < 1e-6 && Math.abs(p.r - q.r) < 1e-6;
r.contornoExacto = pts.length === E.perfil.length && pts.slice(0, -1).every((p, i) => exacto(p, E.perfil[i]));
r.chaflanAprox = Math.abs(pts.at(-1).z - 100) < 0.51 && Math.abs(2 * pts.at(-1).r - 26) < 0.51;
r.sinErrores = G().errores === 0 && !$('#btn-descargar').disabled;
// Deshacer quita el último punto; se vuelve a poner con la tabla escribiendo la cota
const antes = pts.length;
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await espera(100);
r.deshacer = G().puntos.length === antes - 1;
clic(X(100), Y(13)); await espera(100);
r.rehecho = G().puntos.length === antes;
// Corregir una cota en la tabla (el Ø del primer punto a 44,02 y otra vez a 44)
const inp = document.querySelector('#tabla-puntos input[data-i="0"][data-campo="d"]');
inp.value = '44.02'; inp.dispatchEvent(new Event('change')); await espera(80);
r.tabla = Math.abs(G().puntos[0].r - 22.01) < 1e-9;
inp.value = '44'; inp.dispatchEvent(new Event('change')); await espera(80);
// Punta del chaflán: se escribe la cota del plano (Ø26 en Z 100)
const ult = G().puntos.length - 1;
for (const [campo, valor] of [['z', '100'], ['d', '26']]) {
  const c = document.querySelector('#tabla-puntos input[data-i="' + ult + '"][data-campo="' + campo + '"]');
  c.value = valor; c.dispatchEvent(new Event('change')); await espera(60);
}
r.todoExacto = G().puntos.length === E.perfil.length && G().puntos.every((p, i) => exacto(p, E.perfil[i]));
// Descargar el .step y releerlo con el lector del torno
$('#nombre').value = 'eje-prueba';
$('#btn-descargar').click(); await espera(300);
const s = G();
const lec = s.ultimoStep ? window.Torno.step.leer(s.ultimoStep) : null;
r.step = !!lec && Math.abs(lec.largo - 100) < 1e-6 && Math.abs(lec.rMax - 22) < 1e-6 && s.descargas === 1;
r.estadoDescarga = $('#estado-descarga').textContent;
r.pasos = [...document.querySelectorAll('#pasos li')].map((li) => li.dataset.estado).join(',');
const claves = ['imagen', 'formulario', 'escala', 'eje', 'contornoExacto', 'chaflanAprox', 'sinErrores', 'deshacer', 'rehecho', 'tabla', 'todoExacto', 'step'];
const fallan = claves.filter((k) => !r[k]);
return { ok: fallan.length === 0, motivo: fallan.join(', '), ...r };
