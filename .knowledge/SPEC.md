# SPEC - Contrato del motor

**Estado: CONGELADO.** Este documento define las formas y firmas que el resto del
programa consume. Cambiar algo de acá obliga a subir `SCHEMA_VERSION` y a avisar
al orquestador antes de tocar código.

Autor: Kanam CORE. Fecha: 2026-11-23.

> **Por qué está congelado y por qué incluye lo que hoy no se usa.** El v1 congeló
> `Game` sin un estado de celda para la marca de duda, y agregarla después rompió
> el contrato, el schema de persistencia y los labels ARIA. Acá se congela con los
> estados y los campos que el programa va a necesitar (duda, apuestas, replay,
> tiers) aunque la UI los exponga en pasos posteriores. **Congelar de menos cuesta
> más que congelar de más.**

---

## 1. `Preset`

```js
/** @typedef {Object} Preset
 *  @property {string} id      - 'beginner' | 'intermediate' | 'expert'
 *  @property {string} label   - etiqueta humana en español
 *  @property {number} width   - columnas
 *  @property {number} height  - filas
 *  @property {number} mineCount
 */
```

| id | width | height | mineCount | 3BV esperado (comunidad) |
|---|---|---|---|---|
| `beginner` | 9 | 9 | 10 | ~15 |
| `intermediate` | 16 | 16 | 40 | ~65 |
| `expert` | 30 | 16 | 99 | ~174 |

Los `id` son `beginner`/`intermediate`/`expert` (nombres de la comunidad), no
`easy`/`medium`/`hard`. El v1 usó los segundos y la traducción costó trabajo.

`mineCount <= width*height - 9` es invariante: la zona segura del primer clic
siempre cabe.

## 2. `Game`

Todos los campos son públicos y serializables. Los arrays son planos, indexados
`y * width + x`.

```js
/** @typedef {Object} Game
 *  @property {number} width
 *  @property {number} height
 *  @property {number} size            - width * height
 *  @property {number} mineCount
 *  @property {number} seed            - semilla de la partida (reproducible)
 *  @property {Uint8Array} mines       - 0 | 1. TODO CERO hasta el primer clic.
 *  @property {Uint8Array} counts      - minas vecinas 0..8. TODO CERO hasta el primer clic.
 *  @property {Uint8Array} revealed    - 0 | 1
 *  @property {Uint8Array} marks       - 0 = ninguna | 1 = bandera | 2 = duda
 *  @property {boolean} minesPlaced    - false hasta el primer clic
 *  @property {'ready'|'playing'|'won'|'lost'} status
 *  @property {number} clicks          - clics izquierdos efectivos (revelados)
 *  @property {number} hintsUsed
 *  @property {Array<Action>} actions  - log acotado para replay (ver §5)
 *  @property {Array<Deduction>} [lastDeduction] - última pista entregada (no persistida)
 *  @property {Array<Bet>} [bets]       - apuestas registradas (ver §6)
 */
```

### Invariantes

1. `mines[i] === 1` implica `revealed[i] === 0`.
2. `marks[i] !== 0` implica `revealed[i] === 0`.
3. `status === 'ready'` implica `minesPlaced === false` y `mines` todo cero.
4. `status === 'won'` implica todas las celdas sin mina reveladas.
5. `status === 'lost'` implica al menos una mina revelada.
6. `clicks` cuenta solo revelados efectivos, no banderas ni clicks sobre celdas
   ya reveladas.

**Por qué `marks` es un array y no un booleano `flagged`:** un booleano obliga a
que la duda sea "ni bandera ni nada", y entonces no se puede distinguir "no marqué
nada" de "marqué duda". El v1 lo pagó. Un `Uint8Array` con tres estados cuesta lo
mismo y es extensible.

**Por qué `mines` existe antes del primer clic:** para que el generador no-guess
pueda evaluar candidatos sin revelar nada al jugador. Las minas se colocan en el
primer `reveal`, fuera de la zona segura. El campo existe desde el inicio (en
cero) y el invariante 3 garantiza que nadie lea minas antes de que existan.

## 3. `Deduction`

```js
/** @typedef {Object} Deduction
 *  @property {'counting'|'subset'|'global'|'enum'} technique
 *  @property {'safe'|'mine'} action
 *  @property {number[]} cells     - celdas que la deducción libera o marca
 *  @property {number} source      - índice de la celda revelada que la sostiene (o -1)
 *  @property {string} text        - explicación en español, gramaticalmente correcta
 *  @property {number} tier        - 1..4, ver §4
 */
```

`verifyDeduction(game, deduction) -> boolean` debe poder re-validar cualquier
deducción contra el estado actual. **Una deducción que no se puede re-validar no
se muestra.** Es la regla que impide que la pista mienta.

## 4. Tiers de técnica

Ordenados por potencia creciente. Un tablero pertenece al **tier de la técnica más
alta que necesita** para resolverse sin adivinar.

| tier | técnica | qué hace |
|---|---|---|
| 1 | `counting` | Sobre una celda revelada: si `count - banderas == ocultas`, todas son mina; si `count == banderas`, todas son seguras |
| 2 | `subset` | Relaciones entre dos restricciones contiguas: 1-1, 1-2, 1-2-1, 1-2-2-1 |
| 3 | `global` | El conteo total de minas: si `mineCount - banderas == ocultas de un componente`, todas son mina; si es 0, todas son seguras |
| 4 | `enum` | Enumeración de configuraciones consistentes por componente conexa, con tope de celdas |

**Gate del tiering:** un tablero de tier N no se resuelve usando solo las técnicas
de tier `< N`. Es lo que hace que el modo entrenador enseñe algo real.

**Tope de enumeración:** parámetro `enumCap` (celdas por componente). Valor
inicial **16**, medido: con CAP=16 el solve queda en p50 4.9 ms / p95 10.5 ms con
7.33 intentos por tablero aceptado, mientras CAP=30 sube el p95 a 2421 ms sin
comprar aceptación (5.5 intentos en ambos). Un componente por encima del tope no
se enumera: la deducción devuelve `null`, nunca una suposición.

**Medido después (2026-11-23), y corrige la expectativa:** en tableros generados,
el componente del borde mide p50 23 y llega a 57 celdas en Experto. Subir el tope
de 16 a 30 lleva la tasa de solve lógico en Experto de **10.0% a 12.5%**: casi
nada, a cambio de multiplicar el tiempo por dos órdenes. **La enumeración no es
la palanca de solubilidad; el tablero lo es.** Por eso el generador no insiste con
un tope más grande (ver §11).

## 5. `Action` (para el replay)

```js
/** @typedef {Object} Action
 *  @property {'reveal'|'mark'|'chord'} kind
 *  @property {number} cell
 *  @property {number} at          - timestamp relativo, ms desde el primer clic
 *  @property {string|null} technique - técnica que habilitaba esta jugada, o null
 *  @property {boolean} bet        - true si el jugador la jugó sin prueba
 */
```

El log se acota (`MAX_ACTIONS`, valor inicial 4096). Al excederlo se dejan de
registrar acciones y se marca `truncated: true` en el game; el replay reporta que
está incompleto en vez de mentir.

## 6. `Bet`

```js
/** @typedef {Object} Bet
 *  @property {number} cell
 *  @property {number} probability  - P(mina) en [0,1], calculada por enumeración
 *  @property {number} configurations - configuraciones consistentes evaluadas
 */
```

Si el componente excede `enumCap`, **no se registra apuesta y no se muestra
probabilidad**: el juego dice "no calculable". Un número inventado es peor que la
ausencia del número.

## 7. Firmas del core (`src/core/`)

```js
// rng.js
createRng(seed: number): Rng
deriveSeed(seed: number, n: number): number
randInt(rng: Rng, maxExclusive: number): number
shuffle(array: Array, rng: Rng): Array   // Fisher-Yates, in place, devuelve el array

// board.js  (puro: no muta la entrada)
neighborsOf(game: Game, i: number): number[]   // cacheado en WeakMap de módulo
xOf(game, i): number
yOf(game, i): number
indexOf(game, x, y): number

// game.js
createGame(preset: Preset, opts?: { seed?: number, noGuess?: boolean }): Game
reveal(game: Game, i: number, rng: Rng): Game      // devuelve NUEVO game
chord(game: Game, i: number, rng: Rng): Game
cycleMark(game: Game, i: number): Game              // 0 → 1 → 2 → 0
safeZoneOf(game: Game, i: number): Set<number>
statusOf(game: Game): Game['status']

// logic.js  (puro: NUNCA muta el game que recibe)
findDeduction(game: Game, opts?: { cap?: number }): Deduction | null
allDeductions(game: Game, opts?): Deduction[]
verifyDeduction(game: Game, d: Deduction): boolean
solveLogically(game: Game, opts?): { won: boolean, steps: Deduction[], maxTier: number }
tierOf(game: Game, opts?): 1|2|3|4|null

// generator.js
generateNoGuess(preset: Preset, opts: {
  seed: number,
  enumCap?: number,
  maxAttempts?: number,
  deadlineMs?: number
}): { game: Game, attempts: number, elapsedMs: number, fellBack: boolean }

// metrics.js
threeBV(game: Game): number
efficiency(game: Game): number      // 3BV / clicks
```

**Regla de pureza, con test:** `neighborsOf`, `findDeduction`, `solveLogically`
y `tierOf` no pueden mutar el `Game` que reciben. El v1 tuvo un bug donde
`neighborsOf` cacheaba escribiendo en el board del llamador; el test que lo
atrapa es comparar un `structuredClone` del game antes y después.

**Regla de inmutabilidad de `reveal`:** `reveal` devuelve un Game nuevo. La UI
puede reemplazar la referencia; el replay y el post-mortem dependen de poder
guardar estados viejos sin que se muten por debajo.

## 8. Persistencia

```js
SCHEMA_VERSION = 1
```

Claves de `localStorage`, todas prefijadas `bc.`:

| clave | contenido |
|---|---|
| `bc.schema` | número de versión |
| `bc.game.v1` | partida en curso (Game serializado + modo) |
| `bc.records.v1` | records por `preset × modo × pista-usada` |
| `bc.settings.v1` | modo por defecto, mostrar-el-porqué, área del primer clic |

**Los records se indexan por modo y por uso de pista**, no se invalidan:
`records[preset][mode]['clean'|'hinted']`. Es la decisión de producto de §BRIEF.

Una migración desde un schema anterior debe estar probada con un storage
sembrado del schema viejo. Un storage corrupto se descarta y el juego arranca en
modo nuevo, sin romperse.

## 9. Lo que este contrato NO fija

- La forma de los componentes UI. Eso vive en `DESIGN.md`.
- El texto exacto de las pistas, salvo que debe ser gramatical y re-validable.
- La estrategia de generación cuando el deadline se agota (ver §10).

## 10. Generación sin adivinar: perturbación, no rechazo

**Esto es una decisión de arquitectura con medición detrás, no un detalle.**

El enfoque obvio (tirar tableros hasta que uno sea soluble) **no se puede enviar**.
Medido con este motor el 2026-11-23:

| Enfoque | Experto: intentos | p50 | p95 |
|---|---|---|---|
| Rechazo puro | 14.25 | 158.5 ms | **1276.6 ms** |
| Perturbación | 2.3 | 27.4 ms | **85.3 ms** |

El generador sigue el método que Simon Tatham documenta para su Mines
(chiark.greenend.org.uk, 2019-08-26): cuando el solver se traba, **no se descarta
el tablero**. Se mueve una mina de la frontera (una mina adyacente a una celda
abierta) a una celda oculta detrás de la frontera, y se deja seguir al solver. Se
paga con una mina escondida lejos, que es un costo invisible para el jugador.

**La regla que no se negocia:** la perturbación es una heurística para *llegar*
rápido a un tablero soluble; **nunca es evidencia de que sea soluble.** Cada
tablero aceptado se re-verifica con un solve limpio desde la apertura, sin
perturbar. Si esa verificación falla, el tablero se descarta. El test
`the generator never silently serves an unverified board` siembra el error
(saltarse la verificación) y comprueba que el gate lo detecta.

**Detección de óptimo local:** si la perturbación deja de abrir celdas nuevas
durante más de 8 pasos, se abandona ese intento y se arranca de cero. Sin ese
corte, el generador puede quedarse girando en un tablero irreparable.

**Un componente por encima de `enumCap` no se enumera.** No es una optimización:
es la diferencia entre una deducción probada y una suposición disfrazada.

## 11. Fallback del generador (declarado, no escondido)

`generateNoGuess` tiene tres salidas posibles y las tres se reportan:

| resultado | cuándo | qué ve el jugador |
|---|---|---|
| aceptado | el solver gana sin adivinar | el tablero, sin aviso |
| aceptado con deadline agotado | se acabó `deadlineMs` sin aceptar | el mejor tablero evaluado, con un chip "tablero no verificado" |
| fallback | `maxAttempts` agotado | un tablero clásico, con un chip "modo clásico" |

**Nunca se sirve en silencio un tablero que no cumple la promesa.** El v1 falló
exactamente ahí: prometía no-guess y servía tableros que obligaban a adivinar, sin
decirlo.
