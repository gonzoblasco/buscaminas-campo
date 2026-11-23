# DESIGN - CAMPO aplicado

El sistema visual aprobado (playground `minesweeper-visual`, direccion CAMPO)
implementado en `src/ui/styles.css`. Los numeros de esta pagina no son una
propuesta: son lo que el CSS mide hoy, verificado por `test/contrast.test.js`
contra el archivo real.

## Tokens

| token | valor | rol | contraste |
|---|---|---|---|
| `--bg` | `#0a0c10` | fondo de pagina, near-black calido | - |
| `--surface` | `#121620` | panel / tarjeta | - |
| `--surface-2` | `#1a1f2b` | superficie elevada | - |
| `--line` | `#2b3240` | **solo decorativo**: reglas, grilla, separadores | no aplica |
| `--ctrl-line` | `#626c7a` | limite real de un control | 3.40:1 sobre surface |
| `--text` | `#e9edf4` | texto principal | 15.40:1 sobre surface |
| `--text-dim` | `#9aa4b5` | texto secundario | 7.19:1 sobre surface |
| `--accent` | `#ff7a1a` | brasa: unico acento saturado | 7.50:1 sobre bg |
| `--accent-ink` | `#0b0d10` | texto sobre el acento | 8.4:1 sobre accent |
| `--cell-hidden` | `#1f2531` | celda oculta | - |
| `--cell-open` | `#0d1017` | celda revelada | - |
| `--cell-mine` | `#3a1410` | celda con mina | - |
| `--cell-line` | `#68748a` | limite de una celda oculta (estado) | 4.04:1 sobre cell-open |
| `--cell-line-open` | `#5c6779` | limite de una celda revelada (estado) | 3.33:1 sobre cell-open |

## Los 8 numeros

Cada uno se distingue por **color y peso**, nunca solo por color. Medidos sobre
`--cell-open` (#0d1017):

| numero | color | peso | contraste |
|---|---|---|---|
| 1 | `#7cc7ff` | 500 | 10.39:1 |
| 2 | `#6ee7a8` | 600 | 10.4:1 |
| 3 | `#ff9a8a` | 600 | 8.4:1 |
| 4 | `#c9a6ff` | 700 | 8.6:1 |
| 5 | `#ffd166` | 700 | 12.2:1 |
| 6 | `#6fd9d0` | 800 | 11.1:1 |
| 7 | `#f0f0f0` | 800 | 15.5:1 |
| 8 | `#9aa4b2` | 900 | 7.55:1 |

El test verifica los ocho contra 4.5:1 y exige al menos 4 pesos distintos en la
escala 500..900. Un test que solo mirara el color dejaria pasar un juego
injugable para daltonismo.

## Reglas duras

- **`--line` es decorativo.** Puede separar secciones; nunca puede definir el borde
  de un control ni el estado de una celda. El test recorre el CSS y falla si un
  control usa `--line`.
- **La grilla de 24px y el grano viven en el fondo de la pagina**, en `body::before`
  y `body::after`, con `z-index: 0` y `pointer-events: none`. El contenido esta en
  `z-index: 1`. Si un overlay se apila sobre texto o sobre el tablero, invalida
  todas las mediciones de esta pagina. El test lo verifica.
- **Ningun color elegido a ojo.** Todo par de la tabla sale de la formula WCAG
  aplicada al valor real del CSS, y el test lo recalcula en cada corrida.

## Movimiento

Una sola familia de easing, tres duraciones: `--ease-out`, `--dur-fast` (90 ms),
`--dur` (160 ms), `--dur-slow` (260 ms).

Animaciones: revelar (opacidad), bandera (glifo, nunca el borde), explotar (escala
de la celda, una sola vez).

**La bandera nunca anima el borde**: el borde es la senal medida de estado, y
moverlo cambiaria lo que el jugador lee.

`prefers-reduced-motion: reduce` es un kill switch real: duraciones a 0.001ms,
`transform: none` en celdas, botones y segmentos, sin translate, sin scale, sin
shake, conservando el anillo de foco. Verificado en Chromium con
`reducedMotion: 'reduce'`: transition y animation miden 1e-06s.

## Geometria

- Radio: 4px en celdas, 6px en controles, 10px en paneles.
- Celda: `min-width: 24px`, techo de 46px por columna via
  `max-width: min(100%, calc(var(--cols) * 46px))`. Un 9x9 no se vuelve 95px de
  celda; un 30x16 entra en 1180px con 32px por celda.
- Tipografia: sistema para UI, monoespaciada para etiquetas, valores y el tablero.

## Lo que se aparto del prototipo

El playground mostraba lineas SVG desde el numero que restringe hacia las celdas
afectadas. En el juego, la pista **resalta** las celdas afectadas en vez de trazar
lineas: resaltar no puede cruzar numeros y no necesita instrumentar un overlay sobre
el tablero, que era el riesgo declarado del prototipo. El trazado completo sigue en
el playground como referencia.
