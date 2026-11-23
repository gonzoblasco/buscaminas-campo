# HANDOFF - buscaminas-campo

**Fecha:** 2026-11-23 04:49 GMT-3
**Proyecto:** buscaminas-campo
**Branch:** main
**Autor:** Kanam (CORE)

> HANDOFF generado en el cierre de sesion (2026-11-23). Es el punto de entrada para continuar este proyecto. El informe detallado de la sesion vive en `memory/2026-11-23.md`.

---

## Que se hizo en esta sesion

Sesion 2026-11-23: buscaminas nuevo desde cero en projects/buscaminas-campo, repo propio, 15/15 pasos del programa. Arranco con una pregunta: que seria 'maxima expresion' antes de planificar. Verifique el repo ANTES de opinar y encontre que ya existia gonzoblasco/kanam-minesweeper (vivo, 168 tests) con un EVOLUTION-PLAN de MIND+STUDIO+DEV del 2026-09-28 sin implementar, y un dato medido que dolia: el BRIEF prometia no forzar adivinanzas y el 95.4% de los tableros de Experto las forzaban. Gonzo eligio proyecto nuevo + direccion visual CAMPO + techo total.

## Estado actual

v0.1 jugable y verificado. 107 tests unitarios (107 pass), gate independiente 8/8, e2e en Chromium real 33/33 con offline REAL (red apagada + reload -> 81 celdas, se juega). Build 35.6 kB JS / 11.6 kB gzip. Cero dependencias de runtime. Dos commits: 743c509 (juego completo) y e6632a6 (entrenador).

## Proximos pasos

1) El repo remoto NO existe: falta gh repo create y push (requiere OK de Gonzo, es salida al mundo). 2) El workflow de CI esta escrito y validado en YAML pero nunca corrio en GitHub. 3) Falta el slider de replay (S8: el Action[] se guarda, falta la vista) y la UI de apuesta (S7: mineProbabilityAt existe y se niega a inventar). 4) El dibujo SVG del 'porque' esta prototipado en el playground, no en el juego.

## Decisiones y contexto que no debe perderse

1) NO-GUESS POR DEFECTO con records separados del clasico. Razon: la promesa vale solo si es lo que recibe el jugador sin pedirlo; opt-in la convierte en un checkbox que nadie tilda, pero el Experto clasico es vara de la comunidad y no se diluye. 2) LA PISTA NO INVALIDA EL RECORD: se registra en bucket aparte (clean/hinted). Razon: la pista es el diferencial del producto, castigarla empuja a no usarla. 3) GENERADOR POR PERTURBACION, NO RECHAZO. Medido: rechazo puro en Experto cuesta 14.25 intentos y p95 1276 ms; subir el cap de enumeracion de 16 a 30 mueve la tasa de solve de 10.0% a 12.5%, o sea el tablero era el cuello, no el solver. Perturbar (mover una mina de la frontera a detras) baja el p95 a 149 ms con 40/40 verificados.

## Archivos tocados

```
memory/2026-11-23.md
```

## Como continuar

1. Leer este HANDOFF (estado actual + proximos pasos).
2. Leer `memory/2026-11-23.md` para el informe completo de la sesion.
3. Verificar el estado real antes de actuar (git, tests, la DB).

---

*Generado por `scripts/session-handoff.py` (session-lifecycle). Se regenera en cada cierre de sesion.*
