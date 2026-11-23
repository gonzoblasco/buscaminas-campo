# STATUS - Buscaminas CAMPO

## Fase actual

**Live.** https://gonzoblasco.github.io/buscaminas-campo/ (HTTP 200, jugable,
sin errores de consola, ganado una partida usando solo las pistas).

Programa `buscaminas-campo`: **15/15 pasos completos**, lint verde.

El juego se puede jugar de punta a punta: tablero, primer clic, pistas que explican,
modo sin adivinar por defecto, records separados, post-mortem, metricas, offline,
PWA y una identidad visual medida.

## Verificado (medido, no afirmado)

Ultima corrida: 2026-11-23. Todos los numeros salen de un comando reproducible.

| Gate | Resultado | Comando |
|---|---|---|
| Tests unitarios | **115 tests, 115 pass, 0 fail** | `npm test` |
| Gate independiente | **8/8** (pass=8 fail=0 skip=0) | `bash scripts/review-gate.sh` |
| Build de produccion | verde, JS 32.6 kB / gzip 10.7 kB | `npm run build` |
| E2E en Chromium real | **46/46** con 0 errores de consola | `node scripts/e2e.mjs dist` |
| Cero dependencias de runtime | `dependencies`/`peer`/`optional` vacios; `vite` unica dev | lee `package.json` |
| CI en GitHub | **Gate success, Deploy success** | run 45137739938 |

## La promesa del no-guess, medida

Generacion del 2026-11-23, `node scripts/bench.mjs`, N=40 por preset, deadline 250 ms:

| Preset | aceptados | fallbacks | p50 | p95 | max | verificados |
|---|---|---|---|---|---|---|
| Principiante | 40 | 0 | 0.2 ms | 1.5 ms | 4.5 ms | 40/40 |
| Intermedio | 40 | 0 | 4.3 ms | 14.8 ms | 16.0 ms | 40/40 |
| Experto | 40 | 0 | 42.0 ms | 148.9 ms | 163.4 ms | 40/40 |

Cada tablero aceptado se re-verifica con un **solve limpio e independiente** desde
la apertura. "Verificados" es esa cuenta, no la del generador.

**Por que no es rechazo puro.** Medido con el mismo motor: rechazar tableros hasta
que uno sea soluble costaba en Experto 14.25 intentos y **p95 1276 ms**. Subir el
tope de enumeracion de 16 a 30 llevaba la tasa de solve logico de 10.0% a 12.5%:
la enumeracion no era la palanca, el tablero lo era. El generador perturba (mueve
una mina de la frontera a detras de ella) en vez de descartar, y recien acepta si un
solve limpio lo confirma.

## El primer clic

Medido: 300 casos en el gate (100 semillas x 3 presets), **0 minas en la zona
segura**. En los tests, 9000 casos (500 semillas x 6 puntos x 3 presets), 0 minas.
El guard se probo en negativo: quitando los vecinos de la zona segura, la suite
falla.

## Defectos que atrapo la verificacion (no la lectura)

1. **La eficiencia reportaba 322%.** `clicks` contaba celdas abiertas, no clics: un
   flood fill de 59 celdas contaba como 59 clics. Corregido; test de coherencia
   agregado y probado en negativo (duplicando el conteo, el test falla).
2. **`--cell-line` media 2.40:1**, bajo el piso de 3:1 para un limite de estado.
   Subido a `#68748a` (4.04:1 sobre la celda abierta, 3.84:1 sobre la superficie).
3. **`--line` se usaba en 6 bordes de control**, mezclando el rol decorativo con el
   de limite. Separado: los bordes de estado usan `--ctrl-line` / `--cell-line`.
4. **El CSS no se importaba**: `document.styleSheets.length` era 0 y el navegador
   midio 1.00:1 en todos los pares. Atrapado por el e2e, no por un test de unidad.
5. **El service worker no servia offline** en un contexto nuevo. El test estaba mal
   (contexto distinto); corregido a "mismo contexto, red apagada, reload". Ahora
   carga y se juega con la red cortada: 81 celdas, 53 reveladas al clickear.
6. **Dos tests propios mal escritos** que parecian defectos del motor: uno marcaba
   una celda ya revelada y otro aplicaba solo deducciones `safe` (ignorando las de
   tipo `mine`, que son como el solver destraba una zona).

## Guardas probadas en negativo (sembrando el defecto)

Un gate que nunca falla no es un gate. Cada guard se probo rompiendo el codigo a
proposito y comprobando que la suite detecta:

| Guard | Sabotaje aplicado | Resultado |
|---|---|---|
| Primer clic seguro | quitar los vecinos de la zona | falla |
| Pureza de `neighborsOf` | escribir cache en el game del llamador | falla |
| Records separados | mandar las partidas con pista al bucket limpio | fallan 2 tests |
| Verificacion del generador | saltar el solve limpio | falla |
| Conteo de clics | duplicar el incremento | falla |
| Contraste | usar el color decorativo como borde de control | falla |
| Gate completo | sabotaje del generador | `RESULT: FAIL` en 2 checks |

## Lo que encontro el CI (y no se veia local)

Cinco corridas hasta verde. Las cuatro primeras fallas fueron defectos reales,
tres de ellas en el gate y una en el sitio publicado:

1. **`node --test test/` se rompe en Node 22** (trata el directorio como modulo).
   Cambiado a un glob, que funciona de Node 20 a 26.
2. **El gate parseaba solo el reporter `spec`** (`ℹ pass`) y CI imprime TAP
   (`# pass`): en CI leia cero y lo llamaba pase. Ahora acepta los dos, y un check
   sin numero falla.
3. **Un deadline en milisegundos castiga al hardware lento.** En CI Experto caia
   al fallback, y el fallback rompe la promesa. Ahora el generador siempre hace un
   minimo de intentos antes de que el deadline lo corte.
4. **El gate ocultaba el diagnostico del e2e**, lo que costo una vuelta entera de
   CI para saber por que fallaba. Ahora imprime las ultimas 40 lineas.
5. **El sitio publicado daba HTTP 200 y pagina en blanco:** Vite emitia rutas
   absolutas `/assets/...` y Pages sirve en `/<repo>/`. `base: './'` lo arregla.
   Verificado sirviendo el build bajo un subpath: 81 celdas, offline, cero 404.

El patron detras de los cinco: **la verificacion local media un mundo distinto del
que corre en produccion** (otra version de Node, otro reporter, otro hardware,
otra ruta base). Lo que se comparte entre local y CI es el gate, y el gate estaba
midiendo el entorno en vez del producto.

## Que falta

- El slider de replay: el `Action[]` se guarda con tecnica y tope de 4096, el
  contrato esta congelado y hay tests; falta la vista.
- La UI de apuesta: `mineProbabilityAt` devuelve la probabilidad por enumeracion y
  devuelve `null` cuando no puede calcularla honestamente; falta mostrarla antes de
  un clic arriesgado.
- Lecciones de tier (practica dirigida): el tiering existe y esta testeado, pero el
  entrenador muestra pasos, no lecciones.

## Lo que se arreglo despues de publicar (defectos propios, no features)

1. **`firstClickArea` y `showWhy` se persistian y nunca se leian.** Dos ajustes
   muertos son dos promesas vacias. Ahora el area (1x1/3x3/5x5) cambia de verdad la
   zona segura de punta a punta hasta el generador, y "mostrar el porque" dibuja el
   trazado. Seis tests nuevos, y el del area se probo en negativo (ignorando el
   ajuste, tres tests fallan).
2. **El juego no se podia jugar en un telefono.** No habia `pointerdown` ni
   long-press: solo `contextmenu`, que iOS nunca dispara, asi que no habia forma de
   poner una bandera. Ahora hay pulsacion larga y un modo Marcar explicito.
3. **El hover se pegaba en tactil** y dejaba la ultima celda tocada como si estuviera
   seleccionada. Movido a `@media (hover: hover)`.
4. **Dos tests e2e mios estaban mal** y se corrigieron en vez de aflojarlos: uno
   clickeaba por posicion del DOM cuando importaba el indice, y otro asumia que un
   area segura mas grande siempre abre mas tablero (falso: cambia el tablero).

## Numeros con fuente y fecha

Todo lo de arriba esta fechado 2026-11-23 y sale de un comando. El tamano de celda
del tablero de Experto (32 px en 1180 px de ancho) esta medido en Chromium.
