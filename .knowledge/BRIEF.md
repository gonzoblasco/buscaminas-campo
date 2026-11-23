# BRIEF - Buscaminas CAMPO

## Qué

Un buscaminas para navegador, local y offline, cuya promesa central es que **el
azar nunca te obliga a adivinar**. No es un buscaminas con más features: es el
buscaminas más profundo que existe en un solo jugador, sin red.

## Por qué

El buscaminas clásico tiene un defecto que la comunidad nombró con nombre propio
(el "50/50"): hay tableros donde, con juego perfecto, no queda otra que apostar.
En Experto eso no es la excepción, es la regla.

El v1 del proyecto (`gonzoblasco/kanam-minesweeper`, 2026-09-28) declaró en su
BRIEF que no forzaba adivinanzas y el diferencial medido fue otro: **el 95.4% de
los tableros de Experto obligaban a adivinar**. Esa brecha entre lo prometido y
lo entregado es el origen de este proyecto.

## Las seis promesas

Cada una tiene un comando que la prueba. Si una no tiene gate, no existe.

### 1. El tablero nunca te obliga a adivinar, y está probado

100% de tableros resolubles por lógica en los tres presets, incluido Experto.
Generador que descarta hasta que el solver gana, con tope de enumeración acotado
y el costo medido en navegador.

**Gate:** N=300 tableros por preset, 100% resueltos por `solveLogically`; p95 del
tiempo de generación bajo presupuesto, medido en Chromium.

### 2. Cuando perdés, sabés por qué

Post-mortem que marca las banderas mal puestas y las celdas que **sí** se podían
probar seguras, cada una con la deducción que la justifica.

**Gate:** sobre una partida perdida, el post-mortem no reporta ninguna celda que
el solver no podía probar.

### 3. El juego te enseña la técnica que no aplicaste

Cada tablero queda calificado por la técnica más alta que exige. La pista nombra
la técnica y dibuja el razonamiento. Modo entrenador con progresión.

**Gate:** un tablero de tier N no se resuelve con las técnicas de tier N-1.

### 4. El tablero es comparable con el mundo

3BV, 3BV/s, eficiencia, rachas, records por preset y por modo, semilla
reproducible y compartible.

**Gate:** el 3BV coincide con el estándar de la comunidad dentro de tolerancia
declarada.

### 5. Lo juega cualquiera, en cualquier lado

Teclado completo, lector de pantalla, `prefers-reduced-motion` que reduce algo
real, contraste medido con fórmula y blindado con test, offline verificado con el
servidor apagado.

**Gate:** gate independiente donde cero casos corridos no cuenta como pase.

### 6. Cero dependencias de runtime

El juego entero es propio. Es una restricción, no una virtud: obliga a que cada
cosa que entra esté justificada.

**Gate:** `npm ls --omit=dev` vacío.

## Stack

- JavaScript vanilla (ESM), sin framework.
- Vite como única `devDependency` (bundler y dev server).
- PWA escrita a mano: manifest + service worker propio.
- Tests con el runner nativo de Node.
- E2E con `playwright-core` en Chromium.

## Alcance negativo (lo que NO es)

- Sin multijugador, sin cuentas, sin backend, sin ranking online.
- Sin telemetría, sin anuncios, sin pagos.
- Sin variantes hexagonales ni 3D.
- Sin undo libre: rompe la integridad de records. Si entra, solo en modo
  práctica sin record, y eso es una decisión de producto aparte.

"Máxima expresión" es el buscaminas más profundo que existe, no una plataforma.

## Decisiones de producto (fijas)

- **El modo sin adivinar es el default**, con su propia tabla de records. El
  clásico se elige por toggle y tiene records separados, porque el Experto
  clásico es una vara de la comunidad que no se diluye.
- **La pista no invalida el record.** Se registra `hintsUsed` y se muestra en la
  fila. Hay récord separado para partidas sin pista. Razonamiento: la pista es el
  diferencial del producto, no una trampa; castigarla empuja al jugador a no
  usarla, o sea a no ver el diferencial.

## Identidad visual

**CAMPO**: una placa de relevamiento topográfico. Grilla de líneas finas sobre
fondo cálido casi negro, un único acento de brasa naranja, y nada más saturado
que la bandera.

Tokens medidos, no elegidos a ojo:
- `--bg: #0a0c10`, `--surface: #121620`, `--surface-2: #1a1f2b`
- `--line: #2b3240` (solo decorativo), `--ctrl-line: #626c7a` (límite de control)
- `--accent: #ff7a1a`

Referencia viva: `workspace/playground/minesweeper-visual/`.

## Relación con el v1

`gonzoblasco/kanam-minesweeper` queda **vivo** como referencia y banco de
pruebas. No se modifica. De ahí se heredan los aprendizajes: el primer clic
seguro, el verificador de deducciones, la gramática de la pista, el gate que no
da falso verde, y la medición del costo de generación sin adivinanza.

No se hereda su deuda: el contrato congelado de `Game` que bloqueaba agregar
estados, y la promesa incumplida de no-guess.

## Estado

- [x] Discovery
- [x] Definition
- [ ] In Development
- [ ] Live
- [ ] Archived
