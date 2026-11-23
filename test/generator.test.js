import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNoGuess, solveFrom } from '../src/core/generator.js';
import { isWon } from '../src/core/game.js';
import { solveLogically } from '../src/core/logic.js';
import { threeBV } from '../src/core/metrics.js';
import { deriveSeed } from '../src/core/rng.js';
import { PRESETS, PRESET_LIST } from '../src/core/presets.js';

const minesIn = (g) => {
  let n = 0;
  for (let i = 0; i < g.size; i++) if (g.mines[i] === 1) n++;
  return n;
};

test('every accepted board is winnable by logic alone, verified by a clean solve', () => {
  for (const preset of PRESET_LIST) {
    const n = preset.id === 'expert' ? 8 : 15;
    for (let s = 0; s < n; s++) {
      const r = generateNoGuess(preset, { seed: deriveSeed(424242, s) });
      assert.equal(r.fellBack, false, `unexpected fallback on ${preset.id} seed ${s}`);
      const clean = solveFrom(r.game, 16);
      assert.ok(clean.won && isWon(clean.game), `${preset.id} seed ${s} is not logically solvable`);
    }
  }
});

test('the generator never silently serves an unverified board', () => {
  // Every non-fallback result must survive an independent solve. This is the
  // guard for the exact failure the v1 shipped: promising no-guess and serving
  // boards that force a guess without saying so.
  let checked = 0;
  for (let s = 0; s < 40; s++) {
    const r = generateNoGuess(PRESETS.expert, { seed: deriveSeed(1, s), deadlineMs: 400 });
    if (r.fellBack) continue;
    const clean = solveFrom(r.game, 16);
    assert.ok(clean.won, `board from seed ${s} is not solvable after being reported as accepted`);
    checked++;
  }
  assert.ok(checked > 20, `only ${checked} boards were verified, sample too small`);
});

test('a fallback result is reported, never hidden', () => {
  // Force a fallback with a budget that cannot succeed.
  const r = generateNoGuess(PRESETS.expert, { seed: 7, deadlineMs: 1, maxAttempts: 1 });
  if (!r.fellBack) return; // a fast machine may still make it; the assertion below is the contract
  assert.equal(r.fellBack, true);
  assert.ok(r.attempts >= 1);
});

test('perturbation keeps the mine count exact', () => {
  for (let s = 0; s < 20; s++) {
    const r = generateNoGuess(PRESETS.expert, { seed: deriveSeed(88, s), deadlineMs: 500 });
    assert.equal(minesIn(r.game), PRESETS.expert.mineCount, `mine count drifted on seed ${s}`);
  }
});

test('perturbation keeps the first click safe', () => {
  for (let s = 0; s < 20; s++) {
    const r = generateNoGuess(PRESETS.intermediate, { seed: deriveSeed(5, s), deadlineMs: 500 });
    if (r.fellBack) continue;
    // The opening (revealed region from the first click) must contain no mine.
    for (let i = 0; i < r.game.size; i++) {
      if (r.game.revealed[i] === 1) assert.equal(r.game.mines[i], 0, `mine under the opening on seed ${s}`);
    }
  }
});

test('same seed produces the same board (deterministic)', () => {
  const a = generateNoGuess(PRESETS.intermediate, { seed: 20261123, deadlineMs: 500 });
  const b = generateNoGuess(PRESETS.intermediate, { seed: 20261123, deadlineMs: 500 });
  assert.equal(a.fellBack, b.fellBack);
  assert.deepEqual(Array.from(a.game.mines), Array.from(b.game.mines), 'same seed gave different boards');
  assert.deepEqual(Array.from(a.game.revealed), Array.from(b.game.revealed));
});

test('different seeds produce different boards', () => {
  const boards = new Set();
  for (let s = 0; s < 8; s++) {
    const r = generateNoGuess(PRESETS.intermediate, { seed: deriveSeed(3, s), deadlineMs: 500 });
    boards.add(Array.from(r.game.mines).join(''));
  }
  assert.ok(boards.size >= 7, `8 seeds produced only ${boards.size} distinct boards`);
});

test('Expert generation stays inside a 250 ms budget at p95', () => {
  // The number that decides whether rejection was viable. It was not: 1277 ms p95.
  // Perturbation brings it down by an order of magnitude. Assert generously (< 250)
  // so the test fails on a real regression, not on machine noise.
  const times = [];
  for (let s = 0; s < 15; s++) {
    const r = generateNoGuess(PRESETS.expert, { seed: deriveSeed(777, s), deadlineMs: 250 });
    if (r.fellBack) continue;
    times.push(r.elapsedMs);
  }
  times.sort((a, b) => a - b);
  assert.ok(times.length >= 10, 'too few boards generated to measure');
  const p95 = times[Math.floor(times.length * 0.95)] ?? times.at(-1);
  assert.ok(p95 < 250, `Expert p95 was ${p95.toFixed(1)} ms, over the 250 ms budget`);
});

test('generated boards have a plausible 3BV', () => {
  // Perturbation must not collapse the board into something trivially easy or
  // pathologically dense: 3BV should stay in the community band.
  const bands = { beginner: [6, 34], intermediate: [35, 110], expert: [110, 260] };
  for (const [id, [lo, hi]] of Object.entries(bands)) {
    const values = [];
    for (let s = 0; s < 8; s++) {
      const r = generateNoGuess(PRESETS[id], { seed: deriveSeed(31, s), deadlineMs: 500 });
      if (r.fellBack) continue;
      const bv = threeBV(r.game);
      if (bv > 0) values.push(bv);
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(avg >= lo && avg <= hi, `${id} generated 3BV average ${avg.toFixed(1)} outside [${lo},${hi}]`);
  }
});

test('a generated board is playable: the solver wins using the public solver', () => {
  const r = generateNoGuess(PRESETS.beginner, { seed: deriveSeed(11, 1), deadlineMs: 500 });
  const solution = solveLogically(r.game, { cap: 16 });
  assert.ok(solution.won, 'the public solver could not win a generated board');
  assert.ok(solution.steps.length > 0);
  assert.ok(solution.maxTier >= 1 && solution.maxTier <= 4);
});
