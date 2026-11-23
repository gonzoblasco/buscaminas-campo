# Buscaminas CAMPO

Un buscaminas para navegador, local y offline, cuya promesa central es que **el
azar nunca te obliga a adivinar**.

- **Modo sin adivinar** (por defecto): cada tablero se genera de modo que el
  solver lógico lo gane sin apostar. Si el generador no lo logra, lo dice — nunca
  sirve en silencio un tablero que rompe la promesa.
- **Pistas que explican y dibujan el porqué**: cada deducción se re-valida contra
  el tablero antes de mostrarse.
- **Post-mortem honesto**: al perder, marca las banderas mal puestas y las celdas
  que sí se podían probar seguras, cada una con su justificación.
- **Métricas de la comunidad**: 3BV, 3BV/s, eficiencia.
- **Sin dependencias de runtime.** Sin backend, sin cuentas, sin telemetría.

Ver [.knowledge/BRIEF.md](.knowledge/BRIEF.md) para el alcance completo y
[.knowledge/SPEC.md](.knowledge/SPEC.md) para el contrato del motor.

## Estado

En desarrollo (S0). Ver [.knowledge/STATUS.md](.knowledge/STATUS.md).
