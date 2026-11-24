// prueba-step.js — comprueba la CARGA DE UNA PIEZA .step y el ciclo demo que la mecaniza.
//   node <skill>/scripts/verificar-web.mjs "Torno Remoto" --sin-movil --esperar 3000 --prueba "Torno Remoto/prueba-step.js"
// El archivo se fabrica aquí con el mismo escritor del generador (Torno.step.escribir) y se entrega al
// <input type="file"> con un DataTransfer: es el mismo camino que cuando eliges el archivo en la ventana.
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const v = () => window.__verificacion();
const $ = (s) => document.querySelector(s);
const r = {};
await espera(2500);

// Pieza corta (60 mm): escalón Ø44 → Ø36, cono hasta Ø30 y punta Ø30 con chaflán
const perfil = [{ z: 0, r: 22 }, { z: 25, r: 22 }, { z: 25, r: 18 }, { z: 45, r: 18 }, { z: 50, r: 15 }, { z: 59, r: 15 }, { z: 60, r: 14 }];
const texto = window.Torno.step.escribir(perfil, { nombre: 'prueba' });
const dt = new DataTransfer();
dt.items.add(new File([texto], 'prueba.step', { type: 'application/step' }));
const entrada = $('#archivo-step');
entrada.files = dt.files;
entrada.dispatchEvent(new Event('change'));
await espera(800);
r.cargada = v().objetivo.cargado && v().objetivo.nombre === 'prueba' && !$('#btn-quitar-step').hidden;
r.lineaObjetivo = $('#perfil-objetivo').textContent;

// Un archivo que no es STEP: error explicado, sin romper nada
const dt2 = new DataTransfer();
dt2.items.add(new File(['hola'], 'malo.step'));
entrada.files = dt2.files; entrada.dispatchEvent(new Event('change'));
await espera(500);
r.errorExplicado = v().objetivo.errores === 1 && $('#perfil-objetivo').textContent.includes('No se pudo cargar') && v().objetivo.cargado;

// Ciclo demo con la pieza cargada: hasta que termine (máx. 120 s)
$('#btn-demo').click();
const t0 = performance.now();
await espera(3000);
r.demoArranca = v().demo.corriendo;
while (v().demo.corriendo && performance.now() - t0 < 120000) await espera(1000);
await espera(1500);
r.segundos = Math.round((performance.now() - t0) / 1000);
r.demo = v().demo; r.objetivo = v().objetivo; r.maquina = v().maquina;
r.terminada = r.demo.completados === 1 && r.demo.texto.includes('prueba');
r.aCota = r.objetivo.enTolerancia === true && r.objetivo.pasadas === 0;
r.sinAlarma = r.maquina.alarma === null;
r.lineaFinal = $('#perfil-objetivo').textContent;

// Quitar la pieza: el demo vuelve a la de ejemplo
$('#btn-quitar-step').click(); await espera(300);
r.quitada = !v().objetivo.cargado && $('#btn-quitar-step').hidden;

const claves = ['cargada', 'errorExplicado', 'demoArranca', 'terminada', 'aCota', 'sinAlarma', 'quitada'];
const fallan = claves.filter((k) => !r[k]);
return { ok: fallan.length === 0, motivo: fallan.join(', '), ...r };
