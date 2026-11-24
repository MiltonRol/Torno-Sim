# TR-01 · Torno remoto (mock)

Panel de **supervisión remota** de un torno paralelo **simulado** en el navegador. Hay un gemelo digital en 3D, telemetría, un GRAFCET del estado, el registro de eventos y el plano de la pieza. Con el pupitre y las manivelas haces de operario a pie de máquina.

Sigue la skill `web-creativa`: **se abre con doble clic en `index.html`**, sin Python, sin servidor y sin conexión a Internet.

## Qué hay y dónde

| Sección | Qué se ve | Conceptos | Archivo |
|---|---|---|---|
| La máquina (mock) | Torno con su lógica completa: rampa del variador (con signo, así la inversión M3/M4 pasa por cero), corte de material (perfil de 400 muestras), carga del husillo, temperatura, avance automático y contadores. **Enclavamientos**: protector abierto, plato abierto, seta, alarma activa y cambio de barra. **Alarmas**: seta de emergencia y sobrecarga por una pasada demasiado profunda. Topes con la causa explicada (carro contra punto, caña contra carro…) | Estado en un objeto JS; Anime.js anima números (`rampa`, `caudal`, `apertura`…) y la simulación los lee; `createTimer` con `dt` acotado; emisor de eventos | `js/maquina.js` |
| Enlace remoto | Cada 100 ms sale una **trama** con la foto del estado, que llega con latencia (de 18 a 60 ms, con picos). Botón para **cortar la conexión**: el gemelo se congela, los datos se ponen en gris y los eventos se guardan en cola. Al **reconectar**, llegan marcados «recibido con retraso». **Paro remoto**: una orden que sube a la máquina y no sale si no hay red | Patrón publicador/suscriptor, `structuredClone` para la foto congelada | `js/remoto.js`, `js/enlace.js` |
| Gemelo digital | Torno en 3D: bancada, cabezal con botonera y baliza, plato con garras que se abren, barra que **se rebaja al cortar** (bruto oscuro → torneado brillante), carros, torreta con plaquita, manguera articulada, contrapunto, protector abatible y lámpara. Hay **virutas** (rizadas; azuladas si se corta en seco y rápido) y **gotas de taladrina** que salpican. Etiquetas HTML pegadas a las piezas. Cámara con vistas (General, Zona de corte que sigue a la herramienta, Cabezal), arrastre para orbitar y Ctrl + rueda para acercar | **WebGL2 con motor propio** (`gl.js`: matrices, cajas biseladas, sólidos de revolución, toros). La barra es una malla fija cuyo radio se lee de una **textura** en el vertex shader. Partículas con `gl.POINTS`. Proyección 3D → 2D para las etiquetas | `js/gl.js`, `js/escena3d.js` |
| Pupitre | Marcha (luminoso), Paro, Rearme (azul intermitente cuando hace falta), **seta** que se enclava, selector M3/M4, consigna de rpm e interruptores (taladrina, luz, protector, plato, avance automático). También avance por vuelta, **Nueva barra** (la pieza sale y entra una barra nueva por el husillo) y **Ciclo demo** | `aria-pressed` y `role="switch"`. Si salta un enclavamiento, el mando culpable se **sacude** con Anime.js | `js/botonera.js` |
| Manivelas | Tres volantes SVG con **tambor graduado** (Z: 24 mm por vuelta, X: 4 mm de Ø por vuelta, caña: 4 mm por vuelta). Se giran **arrastrando en círculo**, con las flechas del teclado o con los botones ±. Si la cuchilla toca la pieza con el husillo parado, el volante **no gira** | Pointer events + `setPointerCapture`, `role="slider"`. El ángulo sale de la posición del eje (un único dueño) | `js/manivelas.js` |
| Telemetría | Estado general, **torre de señalización** (IEC 60204-1), visualizador de cotas, relojes de aguja (rpm, carga, temperatura, potencia), gráfica de 60 s y contadores | `createAnimatable` para las agujas (suaviza las 10 tramas por segundo), Canvas 2D | `js/telemetria.js` |
| Estado (GRAFCET) | Etapas 0 reposo · 1 husillo · 2 avance · 3 emergencia. La activa se enciende y, al dispararse una transición, **un pulso recorre el enlace** | SVG escrito en el HTML, `svg.createMotionPath` | `js/grafcet.js` |
| Perfil de la pieza | Plano en planta con eje de trazo y punto, garras rayadas, bruto discontinuo, perfil, **cotas de diámetro** de cada tramo y cajetín | Canvas 2D (también es la **alternativa sin WebGL2**) | `js/perfil2d.js` |
| Registro | Eventos con hora y nivel (info, ok, aviso, alarma), filtro y vaciado | `<ol role="log">`, `textContent` (nunca `innerHTML` con datos) | `js/registro.js` |
| Ciclo demo | Un «operario fantasma» mecaniza una pieza: desbaste a Ø47 y Ø44, escalón a Ø41 y Ø38, ranura de Ø30 y chaflán. Las manivelas giran solas. **Se cancela** si tocas algo, si llega un paro remoto o si salta una alarma | Secuencia `async` que espera a cada `irA`, con cancelación | `js/demo.js` |
| **Pieza cargada (.step)** | Botón **«Cargar pieza (.step)…»** en la tarjeta del perfil: abre la ventana de búsqueda de archivos y lee el STEP. El contorno a cota sale en naranja discontinuo en el plano. En el gemelo 3D, el material que sobra se tiñe de naranja y lo que se pasa de cota, de rojo. «⇄ Voltear» cambia qué extremo queda en la cara. La línea de estado da el % hecho, el sobremetal y si está a cota (±0,1 mm) | `<input type="file">` + `FileReader` (funciona con `file://`). Lector STEP propio: busca el eje por las aristas circulares y saca la envolvente exterior de las costuras y los arcos | `js/objetivo.js`, `js/step.js` |
| Ciclo demo con la pieza | Con una pieza cargada, el ciclo demo calcula sus pasadas: **desbaste por capas** de 1,5 mm (deja 0,3 mm) y **acabado** que copia el contorno. El filo de 1,2 mm se tiene en cuenta para no comerse los cantos | CAM mínimo como función pura (`planificar`). La máquina interpola Z y X a la vez (`moverZX`, como un G01): si moviera un eje y luego el otro, los conos se pasarían de cota | `js/cam.js`, `js/demo.js`, `js/maquina.js` |
| Sonido | Zumbido del motor según las rpm, ruido de corte según la carga, chorro de taladrina y pitidos de alarma. **Empieza apagado** | Web Audio sintetizado (sin archivos) | `js/sonido.js` |

`main.js` lo une todo: un `createScope` con la *media query* de movimiento reducido, un `try/catch` por módulo y el gancho `window.__verificacion`.

## Generador de piezas y tutorial

- **`generador.html`**: convierte la **imagen de un esquema** en un `.step` en **modo semiasistido**:
  1. **Escala**: dos clics en una cota conocida y su valor en mm.
  2. **Eje**: dos clics en la línea de trazo y punto; corrige el giro del escaneo.
  3. **Contorno**: un clic por esquina, del plato a la cara. Tiene imán a líneas (paralelas y perpendiculares al eje, al centro del trazo), modo ortogonal, redondeo, lupa, zoom con la rueda y deshacer.
  4. **Tabla**: aquí se corrigen las cotas exactas. También sirve para hacer la pieza sin imagen.
  5. **Descargar .step**: sólido de revolución AP214 (planos, cilindros y conos) que se relee antes de descargarlo.
- **`tutorial.html`**: el tutorial de ese modo en una pantalla aparte (7 pasos con figuras sobre el esquema de ejemplo, atajos, límites y problemas frecuentes).
- **`ejemplos/`**: `eje-ejemplo.svg` (plano para practicar) y `eje-ejemplo.step` (su solución). El mismo dibujo está en `js/ejemplo-esquema.js` para el botón «Usar el ejemplo».

## Modos y atajos

- **Con WebGL2** (lo normal): gemelo 3D.
- **Sin WebGL2**: el mismo hueco muestra el plano 2D en vivo, y la línea de estado lo indica.
- **Movimiento reducido**: sin intro de cámara, sin prueba de lámparas, sin paquetes animados ni parpadeos. Los botones y las manivelas siguen funcionando.
- **Tema claro/oscuro**: por defecto el del sistema; el botón de la cabecera lo cambia y lo recuerda.
- Atajos en la dirección (se pueden combinar con `+`):
  - `index.html#demo` arranca el ciclo demo.
  - `#corte` pone la cámara en la zona de corte.
  - `#claro` y `#oscuro` fuerzan el tema.
  - `#2d` fuerza la vista alternativa.
  - Ejemplo: `index.html#demo+corte`.

## Verificarlo

```powershell
$v = "$env:USERPROFILE\.claude\skills\web-creativa\scripts\verificar-web.mjs"
node $v "Torno Remoto" --esperar 4500                                  # file:// (doble clic), escritorio + móvil
node $v "Torno Remoto" --reducido --esperar 2500
node $v "Torno Remoto" --pagina "index.html#2d" --esperar 3000          # alternativa sin WebGL2
node $v "Torno Remoto" --pagina "index.html#claro" --sin-movil
node $v "Torno Remoto" --pagina "index.html#demo+corte" --esperar 9800 --sin-movil   # captura en pleno corte
node $v "Torno Remoto" --sin-movil --prueba "Torno Remoto/prueba-interaccion.js"
```

Generador y carga de piezas:

```powershell
node $v "Torno Remoto" --pagina generador.html --sin-movil --prueba "Torno Remoto/prueba-generador.js"   # clics reales: escala, eje, 11 esquinas, tabla, .step
node $v "Torno Remoto" --sin-movil --esperar 3000 --prueba "Torno Remoto/prueba-step.js"                 # carga un .step, mecaniza con el demo y comprueba la cota
node $v "Torno Remoto" --pagina tutorial.html
```

`prueba-interaccion.js` simula al operario y comprueba 14 cosas:

1. El enclavamiento del protector.
2. La marcha.
3. El corte con las manivelas y el teclado.
4. La seta.
5. Que el rearme queda bloqueado con la seta pulsada.
6. El rearme.
7. El corte de red.
8. La cola de eventos sin red.
9. La reconexión.
10. La nueva barra.
11. El ciclo demo.
12. Que el paro remoto detiene la demo.
13. La alarma de sobrecarga.
14. El rearme tras la sobrecarga.

Resultado del 24/11/2026 (generador, tutorial, carga de .step y regresión de las 14 pruebas): **todo OK**, sin errores de consola. La pieza de `prueba-step.js` queda a cota (±0,1 mm) en 28 s, sin alarmas. El STEP generado se ha comprobado de dos formas: cada arista se usa dos veces en sentidos opuestos, y se cumple Euler-Poincaré (V − E + F − (L − F) = 2). **No se ha abierto en un CAD real**: en este equipo no hay ninguno.

Resultado del 21/11/2026 con Chrome (headless, `file://`): **todo OK**, sin errores de consola y sin scroll horizontal en 1280 px ni en 390 px. Los tres lienzos pintan.

`vendor/anime.umd.min.js`: copia de `Anime Js/dist/bundles` (licencia MIT, en `vendor/LICENSE-animejs.md`).
