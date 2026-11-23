# CHANGELOG

## 0.1.0 - 2026-11-23

Primera version jugable. El buscaminas se puede jugar de punta a punta en el
navegador, offline, sin dependencias de runtime.

### Las seis promesas

**El tablero nunca te obliga a adivinar, y esta probado.**
Generador sin adivinanza por perturbacion (mueve una mina de la frontera a detras de
ella cuando el solver se traba) en vez de rechazo puro. Cada tablero aceptado se
re-verifica con un solve limpio e independiente. Medido: 40/40 verificados por
preset, 0 fallbacks, Experto p95 149 ms.

**Cuando perdes, sabes por que.**
Post-mortem que captura el estado previo al clic perdedor y solo afirma celdas que
el solver podia probar seguras, cada una con su deduccion.

**El juego te ensena la tecnica que no aplicaste.**
Solver de cuatro tiers (conteo, subconjunto, conteo global, enumeracion). La pista
nombra la tecnica y re-valida la deduccion antes de mostrarla: una deduccion que no
se puede re-validar no se muestra.

**El tablero es comparable con el mundo.**
3BV, eficiencia, semilla reproducible y visible. Records separados por preset, por
modo y por uso de pista.

**Lo juega cualquiera, en cualquier lado.**
Teclado completo, roles ARIA por celda, contraste medido con formula y blindado con
test, `prefers-reduced-motion` con kill switch real, offline verificado con la red
apagada y PWA con iconos generados localmente.

**Cero dependencias de runtime.**
Vite como unica devDependency. `npm ls --omit=dev` vacio.

### Decisiones de producto

- El modo sin adivinar es el **default**. El clasico se elige por toggle y tiene
  records aparte.
- Una pista **no invalida** el record: se registra en una fila separada.

### Verificacion

- 103 tests unitarios, 103 pass.
- Gate independiente 8/8, con guardas probadas en negativo.
- 29/29 checks de E2E en Chromium real, incluido offline.
- Build: 32.6 kB de JS, 10.7 kB gzip.

### Defectos corregidos antes de publicar

- La eficiencia reportaba 322% porque contaba celdas en vez de clics.
- `--cell-line` media 2.40:1, bajo el piso de 3:1.
- `--line` se usaba como borde de control en 6 reglas.
- El CSS no se importaba: el navegador medía 1.00:1 en todos los pares.
- El service worker no servía offline.
