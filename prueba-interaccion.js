// prueba-interaccion.js — se ejecuta DENTRO de la página con el verificador de la skill web-creativa:
//   node <skill>/scripts/verificar-web.mjs "Torno Remoto" --sin-movil --prueba "Torno Remoto/prueba-interaccion.js"
// Simula al operario con clics y comprueba el estado de la máquina, del enlace y de las vistas.
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const v = () => window.__verificacion();
const $ = (s) => document.querySelector(s);
const r = {};
window.scrollTo(0, 0);
await espera(2500);                                   // conexión y referencia de ejes

// 1) Enclavamiento: con el protector abierto, Marcha no arranca y se avisa
$('#tg-protector').click(); await espera(250);
$('#btn-marcha').click(); await espera(400);
r.enclavamiento = v().maquina.etapa === 0 && $('#pupitre-aviso').textContent.includes('protector');
$('#tg-protector').click(); await espera(300);

// 2) Marcha: el husillo sube por la rampa
$('#btn-marcha').click(); await espera(1800);
r.marcha = v().maquina.etapa === 1 && v().maquina.rpm > 700;

// 3) Corte con las manivelas (botones ±): Z hacia la pieza, X hacia dentro y luego Z hacia el plato
const boton = (eje, paso) => $('.volante[data-eje="' + eje + '"] [data-paso="' + paso + '"]');
for (let i = 0; i < 8; i++) { boton('z', -1).click(); await espera(90); }      // Z 30 → −10
await espera(600);
for (let i = 0; i < 16; i++) { boton('x', -1).click(); await espera(90); }     // X 32 → 24 (Ø48)
await espera(700);
for (let i = 0; i < 6; i++) { boton('z', -1).click(); await espera(250); }     // Z −10 → −40 cortando
await espera(900);
// teclado en el volante X: 5 divisiones hacia dentro
const ruedaX = $('.volante[data-eje="x"] .volante__rueda');
ruedaX.focus();
for (let i = 0; i < 5; i++) ruedaX.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
await espera(500);
r.corte = { quitado: v().maquina.quitado, x: v().maquina.x, z: v().maquina.z, particulas: v().escena3d.particulas, tramos: v().perfil.tramos };
r.cortaOk = v().maquina.quitado > 1000 && Math.abs(v().maquina.x - 23.9) < 0.05 && v().escena3d.particulas > 20;

// 4) Seta: frenado rápido, etapa 3; Marcha bloqueada; rearme solo tras desenclavar
$('#btn-seta').click(); await espera(1000);
r.seta = v().maquina.etapa === 3 && Math.abs(v().maquina.rpm) < 5 && v().grafcet.activa === 3;
$('#btn-marcha').click(); await espera(200);
$('#btn-rearme').click(); await espera(200);
r.rearmeBloqueado = v().maquina.etapa === 3;
$('#btn-seta').click(); await espera(200);
$('#btn-rearme').click(); await espera(900);
r.rearme = v().maquina.etapa === 0 && v().grafcet.activa === 0;

// 5) Red: cortar la conexión → datos congelados y eventos en cola; reconectar → llegan con retraso
$('#btn-conexion').click(); await espera(400);
r.sinConexion = v().enlace.estado === 'sin-conexion' && document.documentElement.dataset.conexion === 'sin-conexion' && !$('#aviso-conexion').hidden;
$('#tg-luz').click(); await espera(300);                // evento mientras no hay red
r.enCola = v().enlace.cola >= 1;
$('#btn-conexion').click(); await espera(2000);
r.reconexion = v().enlace.estado === 'en-linea' && v().enlace.cola === 0 && $('#lista-eventos').textContent.includes('recibido con retraso');
$('#tg-luz').click(); await espera(200);

// 6) Nueva barra: la pieza mecanizada cuenta como terminada y el perfil vuelve a bruto
$('#btn-barra').click(); await espera(4200);
r.barra = v().maquina.quitado === 0 && v().maquina.piezas === 1;

// 7) Ciclo demo: arranca solo y un PARO REMOTO lo detiene
$('#btn-demo').click(); await espera(7000);
const demo = v().demo, maq = v().maquina;
r.demoCorre = demo.corriendo && maq.etapa === 1 && maq.quitado > 0;
$('#btn-paro-remoto').click(); await espera(1200);
r.paroRemoto = !v().demo.corriendo && v().maquina.etapa === 0 && $('#demo-estado').textContent.includes('remoto');

// 8) Sobrecarga: pasada brutal (X a Ø20 de golpe y Z rápido) → alarma y rearme
await espera(1500);
$('#btn-marcha').click(); await espera(1800);
for (let i = 0; i < 12; i++) { boton('x', -1).click(); await espera(40); }
await espera(500);
for (let i = 0; i < 10; i++) { boton('z', -1).click(); await espera(60); }
await espera(1800);
r.sobrecarga = v().maquina.alarma === 'SOBRECARGA' && v().maquina.etapa === 3;
$('#btn-rearme').click(); await espera(600);
r.trasSobrecarga = v().maquina.etapa === 0;

r.grafcet = v().grafcet; r.registro = v().registro;
const claves = ['enclavamiento', 'marcha', 'cortaOk', 'seta', 'rearmeBloqueado', 'rearme', 'sinConexion', 'enCola', 'reconexion', 'barra', 'demoCorre', 'paroRemoto', 'sobrecarga', 'trasSobrecarga'];
const fallan = claves.filter((k) => !r[k]);
return { ok: fallan.length === 0, motivo: fallan.join(', '), ...r };
