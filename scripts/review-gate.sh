#!/usr/bin/env bash
# scripts/review-gate.sh - Independent verification gate.
#
# Why this exists as a separate script: in the v1 the gate itself had two bugs and
# reported a false green. A gate that measures can be broken too, so this one
# REFUSES to pass on zero checked cases, prints every number it used, and can be
# run against a known-bad tree to prove it fails.
#
# Usage: bash scripts/review-gate.sh

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

PASS=0
FAIL=0
SKIP=0
declare -a LINES

ok()   { PASS=$((PASS+1)); LINES+=("  PASS  $1${2:+  ($2)}"); }
bad()  { FAIL=$((FAIL+1)); LINES+=("  FAIL  $1${2:+  ($2)}"); }
note() { LINES+=("  ----  $1"); }

# A check that produced no evidence is not a pass.
require_output() {
  local name="$1" out="$2"
  if [ -z "${out// /}" ]; then
    bad "$name" "the check produced NO output: that is not a pass"
    return 1
  fi
  return 0
}

echo "review-gate: buscaminas-campo"
echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# ---------------------------------------------------------------- 1. runtime deps
note "1. Zero runtime dependencies"
DEPS="$(npm ls --omit=dev --parseable --all 2>/dev/null | tail -n +2)"
if [ -z "$DEPS" ]; then
  ok "no runtime dependencies" "npm ls --omit=dev is empty"
else
  bad "runtime dependencies present" "$(echo "$DEPS" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- 2. tests
note "2. Unit tests (real counts, not a summary line)"
TEST_OUT="$(npm test 2>&1)"
TESTS_LINE="$(echo "$TEST_OUT" | grep -E '^. tests [0-9]+' | tail -1)"
PASS_LINE="$(echo "$TEST_OUT" | grep -E '^. pass [0-9]+' | tail -1)"
FAIL_LINE="$(echo "$TEST_OUT" | grep -E '^. fail [0-9]+' | tail -1)"
T_COUNT="$(echo "$TESTS_LINE" | grep -oE '[0-9]+')"
P_COUNT="$(echo "$PASS_LINE" | grep -oE '[0-9]+')"
F_COUNT="$(echo "$FAIL_LINE" | grep -oE '[0-9]+')"
if require_output "unit tests" "$TEST_OUT"; then
  if [ -z "$T_COUNT" ] || [ "$T_COUNT" -eq 0 ]; then
    bad "unit tests" "zero tests ran: that is not a pass"
  elif [ "${F_COUNT:-1}" -ne 0 ]; then
    bad "unit tests" "fail=$F_COUNT"
  else
    ok "unit tests" "tests=$T_COUNT pass=$P_COUNT fail=$F_COUNT"
  fi
fi

# ---------------------------------------------------------------- 3. build
note "3. Production build"
BUILD_OUT="$(npm run build 2>&1)"
if echo "$BUILD_OUT" | grep -q "built in"; then
  SIZE="$(echo "$BUILD_OUT" | grep -E 'assets/index-.*\.js' | head -1 | sed 's/.*  //')"
  ok "build succeeded" "js ${SIZE:-unknown}"
else
  bad "build failed" "$(echo "$BUILD_OUT" | tail -3 | tr '\n' ' ')"
fi

# ---------------------------------------------------------------- 4. contrast
note "4. Contrast measured on the real stylesheet"
CONTRAST_OUT="$(node --test test/contrast.test.js 2>&1)"
C_PASS="$(echo "$CONTRAST_OUT" | grep -E '^. pass [0-9]+' | tail -1 | grep -oE '[0-9]+')"
C_FAIL="$(echo "$CONTRAST_OUT" | grep -E '^. fail [0-9]+' | tail -1 | grep -oE '[0-9]+')"
if [ "${C_FAIL:-1}" -ne 0 ]; then
  bad "contrast" "fail=$C_FAIL"
elif [ "${C_PASS:-0}" -lt 10 ]; then
  bad "contrast" "only $C_PASS contrast checks ran"
else
  ok "contrast" "pass=$C_PASS fail=$C_FAIL"
fi

# ---------------------------------------------------------------- 5. no-guess claim
note "5. The no-guess promise, re-measured independently"
NOGUESS_OUT="$(node --input-type=module -e '
import { generateNoGuess, solveFrom } from "./src/core/generator.js";
import { isWon } from "./src/core/game.js";
import { PRESETS } from "./src/core/presets.js";
let accepted = 0, verified = 0, fell = 0;
for (const id of ["beginner","intermediate","expert"]) {
  for (let s = 0; s < 10; s++) {
    const r = generateNoGuess(PRESETS[id], { seed: 90000 + s, deadlineMs: 1500 });
    if (r.fellBack) { fell++; continue; }
    accepted++;
    const clean = solveFrom(r.game, 16);
    if (clean.won && isWon(clean.game)) verified++;
  }
}
console.log(JSON.stringify({ accepted, verified, fell }));
' 2>&1)"
if require_output "no-guess" "$NOGUESS_OUT"; then
  ACC="$(echo "$NOGUESS_OUT" | grep -oE '"accepted":[0-9]+' | grep -oE '[0-9]+')"
  VER="$(echo "$NOGUESS_OUT" | grep -oE '"verified":[0-9]+' | grep -oE '[0-9]+')"
  if [ -z "$ACC" ] || [ "$ACC" -eq 0 ]; then
    bad "no-guess" "no board was accepted: cannot claim the promise"
  elif [ "$VER" -ne "$ACC" ]; then
    bad "no-guess" "$VER of $ACC accepted boards failed an independent solve"
  else
    ok "no-guess" "$VER/$ACC accepted boards independently verified"
  fi
fi

# ---------------------------------------------------------------- 6. first click
note "6. First click is always safe (classic placement)"
FIRST_OUT="$(node --input-type=module -e '
import { createGame, reveal } from "./src/core/game.js";
import { neighborsOf } from "./src/core/board.js";
import { PRESETS } from "./src/core/presets.js";
import { createRng, deriveSeed, randInt } from "./src/core/rng.js";
let cases = 0, mines = 0;
for (const id of ["beginner","intermediate","expert"]) {
  for (let s = 0; s < 100; s++) {
    const seed = deriveSeed(555, s);
    const probe = createGame(PRESETS[id], { seed });
    const cell = randInt(createRng(deriveSeed(seed, 9)), probe.size);
    const g = reveal(probe, cell, createRng(seed));
    const zone = [cell, ...neighborsOf(g, cell)];
    cases++;
    for (const z of zone) if (g.mines[z] === 1) { mines++; break; }
  }
}
console.log(JSON.stringify({ cases, mines }));
' 2>&1)"
if require_output "first click" "$FIRST_OUT"; then
  FC_CASES="$(echo "$FIRST_OUT" | grep -oE '"cases":[0-9]+' | grep -oE '[0-9]+')"
  FC_MINES="$(echo "$FIRST_OUT" | grep -oE '"mines":[0-9]+' | grep -oE '[0-9]+')"
  if [ "${FC_CASES:-0}" -lt 100 ]; then
    bad "first click" "only $FC_CASES cases ran"
  elif [ "${FC_MINES:-1}" -ne 0 ]; then
    bad "first click" "$FC_MINES cases had a mine in the safe zone"
  else
    ok "first click" "$FC_CASES cases, 0 mines in the safe zone"
  fi
fi

# ---------------------------------------------------------------- 7. em dashes
note "7. Language hygiene: no em dashes in source"
DASHES="$(grep -rn '—' src/ index.html 2>/dev/null | wc -l | tr -d ' ')"
if [ "$DASHES" -eq 0 ]; then
  ok "no em dashes"
else
  bad "em dashes found" "$DASHES occurrences"
fi

# ---------------------------------------------------------------- 8. e2e
note "8. End to end in real Chromium"
if [ "${SKIP_E2E:-0}" = "1" ]; then
  SKIP=$((SKIP+1))
  LINES+=("  SKIP  e2e (explicitly skipped with SKIP_E2E=1, NOT a pass)")
else
  E2E_OUT="$(node scripts/e2e.mjs dist 2>&1)"
  E2E_LAST="$(echo "$E2E_OUT" | grep -E '^[0-9]+/[0-9]+ checks passed' | tail -1)"
  if [ -z "$E2E_LAST" ]; then
    bad "e2e" "no result line: the run did not complete"
  elif echo "$E2E_LAST" | grep -qE '^([0-9]+)/\1 '; then
    ok "e2e" "$E2E_LAST"
  else
    bad "e2e" "$E2E_LAST"
  fi
fi

# ---------------------------------------------------------------- report
echo
printf '%s\n' "${LINES[@]}"
echo
echo "review-gate: pass=$PASS fail=$FAIL skip=$SKIP"
if [ "$FAIL" -ne 0 ] || [ "$PASS" -eq 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
