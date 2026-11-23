# STATUS - Buscaminas CAMPO

## Fase actual

**Development, v0.1 jugable.** Programa `buscaminas-campo` en el Planner:
13/15 pasos completos, 1 en progreso (S9, entrenador), 1 pendiente (S14, cierre).

El juego se puede jugar de punta a punta: tablero, primer clic, pistas que explican,
modo sin adivinar por defecto, records separados, post-mortem, metricas, offline,
PWA y una identidad visual medida.

## Verificado (medido, no afirmado)

Ultima corrida: 2026-11-23. Todos los numeros salen de un comando reproducible.

| Gate | Resultado | Comando |
|---|---|---|
| Tests unitarios | **103 tests, 103 pass, 0 fail** | `npm test` |
| Gate independiente | **8/8** (pass=8 fail=0 skip=0) | `bash scripts/review-gate.sh` |
| Build de produccion | verde, JS 32.6 kB / gzip 10.7 kB | `npm run build` |
| E2E en Chromium real | **29/29** con 0 errores de consola | `node scripts/e2e.mjs dist` |
| Cero dependencias de runtime | `npm ls --omit=dev` vacio | - |

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

## Que falta

- **S9 (en progreso):** modo entrenador con progresion por tecnica. `tierOf` y
  `solveWithCeiling` ya existen y tienen tests; falta la UI de progresion.
- **S14 (pendiente):** HANDOFF, CHANGELOG y corrida final desde un arbol limpio.
- El slider de replay (S8): el `Action[]` se guarda y el contrato esta congelado,
  falta la vista.
- La UI de apuesta (S7): la probabilidad honesta existe y se niega a inventar un
  numero cuando no puede calcularlo; falta mostrarla antes de un clic arriesgado.
- El dibujo del "porque" en SVG sobre el tablero (S5): hoy la pista resalta las
  celdas de la deduccion. El trazado completo esta prototipado en el playground.

## Numeros con fuente y fecha

Todo lo de arriba esta fechado 2026-11-23 y sale de un comando. El tamano de celda
del tablero de Experto (32 px en 1180 px de ancho) esta medido en Chromium.
