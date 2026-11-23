// scripts/bench.mjs - Measure generation cost and logical solve rate.
//
// This is the harness that decided the architecture. Keep it: the numbers in
// .knowledge/STATUS.md come from here, and a claim without a reproducible command
// is an opinion.
//
//   node scripts/bench.mjs              # generation cost + verification
//   node scripts/bench.mjs --solve-rate # how many boards a logical solve clears

import { generateNoGuess, solveFrom } from '../src/core/generator.js';
import { solveLogically } from '../src/core/logic.js';
import { isWon } from '../src/core/game.js';
import { threeBV } from '../src/core/metrics.js';
import { deriveSeed } from '../src/core/rng.js';
import { PRESETS } from '../src/core/presets.js';

const N = Number(process.env.N || 40);
const DEADLINE = Number(process.env.DEADLINE || 250);
const MODE = process.argv.includes('--solve-rate') ? 'solve-rate' : 'generate';

const pct = (values, p) => values[Math.min(values.length - 1, Math.floor(values.length * p))];

if (MODE === 'generate') {
  console.log(`generation cost, N=${N} per preset, deadline ${DEADLINE} ms`);
  console.log('preset        ok  fell  p50 ms  p95 ms  max ms  verified  attempts');
  for (const id of ['beginner', 'intermediate', 'expert']) {
    const times = [];
    let ok = 0;
    let fell = 0;
    let verified = 0;
    let attempts = 0;
    for (let s = 0; s < N; s++) {
      const r = generateNoGuess(PRESETS[id], { seed: deriveSeed(20261123, s), deadlineMs: DEADLINE });
      attempts += r.attempts;
      if (r.fellBack) {
        fell++;
        continue;
      }
      ok++;
      times.push(r.elapsedMs);
      // Independent verification: a clean solve from the opening, no perturbation.
      const clean = solveFrom(r.game, 16);
      if (clean.won && isWon(clean.game)) verified++;
    }
    times.sort((a, b) => a - b);
    const p50 = times.length ? pct(times, 0.5).toFixed(1) : '-';
    const p95 = times.length ? pct(times, 0.95).toFixed(1) : '-';
    const max = times.length ? times.at(-1).toFixed(1) : '-';
    console.log(
      `${id.padEnd(13)} ${String(ok).padStart(3)} ${String(fell).padStart(5)} ${String(p50).padStart(7)} ${String(p95).padStart(7)} ${String(max).padStart(7)} ${String(verified).padStart(9)} ${String(attempts).padStart(9)}`
    );
    if (verified !== ok) {
      console.error(`  WARNING: ${ok - verified} accepted boards failed an independent solve`);
      process.exitCode = 1;
    }
  }
} else {
  console.log(`logical solve rate on plain random boards, N=${N} per preset`);
  for (const id of ['beginner', 'intermediate', 'expert']) {
    let won = 0;
    let bv = 0;
    const caps = [16, 22, 30];
    const wins = {};
    for (const cap of caps) wins[cap] = 0;
    for (let s = 0; s < N; s++) {
      const r = generateNoGuess(PRESETS[id], { seed: deriveSeed(4242, s), deadlineMs: 3000 });
      if (r.fellBack) continue;
      const solution = solveLogically(r.game, { cap: 16 });
      if (solution.won) won++;
      bv += threeBV(r.game);
      for (const cap of caps) if (solveFrom(r.game, cap).won) wins[cap]++;
    }
    console.log(
      `${id.padEnd(13)} won=${won}/${N} (${((won / N) * 100).toFixed(1)}%) avg3BV=${(bv / N).toFixed(1)} ` +
        caps.map((c) => `cap${c}=${wins[c]}`).join(' ')
    );
  }
}
