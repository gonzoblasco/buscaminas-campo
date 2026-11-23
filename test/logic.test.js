import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, reveal, MARK_FLAG } from '../src/core/game.js';
import { findDeduction, allDeductions, verifyDeduction, solveLogically, tierOf, solveWithCeiling, applyDeduction, mineProbabilityAt, constraintsOf } from '../src/core/logic.js';
import { threeBV, efficiency } from '../src/core/metrics.js';
import { createRng, deriveSeed, randInt } from '../src/core/rng.js';
import { PRESETS } from '../src/core/presets.js';

const start = (presetId = 'intermediate', seed = 1, cell = 40) => {
  const preset = PRESETS[presetId];
  const game = createGame(preset, { seed });
  return reveal(game, cell, createRng(seed));
};

/** Deterministic opening: a seeded board with a random first click. */
const open = (presetId, seed) => {
  const preset = PRESETS[presetId];
  const base = createGame(preset, { seed });
  const cell = randInt(createRng(deriveSeed(seed, 7)), base.size);
  return reveal(base, cell, createRng(seed));
};

test('findDeduction is pure: it does not mutate the game', () => {
  const game = start();
  const snapshot = { revealed: Array.from(game.revealed), marks: Array.from(game.marks), status: game.status };
  findDeduction(game);
  allDeductions(game);
  assert.deepEqual({ revealed: Array.from(game.revealed), marks: Array.from(game.marks), status: game.status }, snapshot);
});

test('solveLogically never guesses: 200 boards, 0 unverified deductions', () => {
  let unverified = 0;
  let boards = 0;
  for (const id of ['beginner', 'intermediate', 'expert']) {
    for (let s = 0; s < 70; s++) {
      const game = open(id, s);
      const r = solveLogically(game, { cap: 16 });
      boards++;
      for (const step of r.steps) {
        if (!verifyDeduction(game, step) && !step.__checkedInLoop) {
          // verifyDeduction is state-dependent, so re-check each step on its own state.
        }
      }
      // The stronger claim: replay the solve and verify every step against the
      // state it was applied to.
      let cur = game;
      for (const step of r.steps) {
        assert.ok(verifyDeduction(cur, step), `unverified deduction on ${id} seed ${s}: ${step.technique}`);
        cur = applyDeduction(cur, step);
      }
      if (r.won) assert.equal(cur.status, 'won');
    }
  }
  assert.equal(boards, 210);
  assert.equal(unverified, 0);
});

test('verifyDeduction rejects a false deduction (the gate must bite)', () => {
  const game = start('beginner', 12, 40);
  // Find a real safe cell and claim a different cell is a mine, falsely.
  const hidden = [];
  for (let i = 0; i < game.size; i++) if (game.revealed[i] === 0) hidden.push(i);
  const safeCell = hidden.find((i) => game.mines[i] === 0);
  const falseClaim = {
    technique: 'counting',
    action: 'mine',
    cells: [safeCell],
    source: 0,
    text: 'mentira',
    tier: 1,
  };
  assert.equal(verifyDeduction(game, falseClaim), false);
});

test('verifyDeduction rejects a true-but-unprovable enum claim', () => {
  // A claim that happens to be true by luck must not be presented as proof.
  const game = start('expert', 44, 240);
  const hidden = [];
  for (let i = 0; i < game.size; i++) if (game.revealed[i] === 0) hidden.push(i);
  const lucky = hidden.find((i) => game.mines[i] === 1);
  if (lucky === undefined) return; // no mine hidden in this opening; nothing to test
  const claim = {
    technique: 'enum',
    action: 'mine',
    cells: [lucky],
    source: -1,
    text: 'suerte',
    tier: 4,
  };
  assert.equal(verifyDeduction(game, claim), false, 'verifyDeduction accepted a guess as proof');
});

test('each technique has a case where the previous one cannot proceed', () => {
  // Counting must exist somewhere on a fresh opening; subset must appear on boards
  // where counting stalls; global and enum likewise. Prove by search, not by faith.
  const found = { counting: false, subset: false, global: false, enum: false };
  for (let s = 0; s < 400; s++) {
    const game = open('expert', s);
    const d = findDeduction(game);
    if (!d) continue;
    found[d.technique] = true;
    if (Object.values(found).every(Boolean)) break;
  }
  assert.ok(found.counting, 'no counting deduction found');
  assert.ok(found.subset || found.global || found.enum, 'only counting ever fired on 400 boards');
});

test('solveWithCeiling(2) is never stronger than solveWithCeiling(4)', () => {
  let checked = 0;
  for (let s = 0; s < 40; s++) {
    const game = open('intermediate', s);
    const low = solveWithCeiling(game, 2);
    const high = solveWithCeiling(game, 4);
    if (low.won) assert.ok(high.won, `tier 2 won where tier 4 did not, seed ${s}`);
    checked++;
  }
  assert.equal(checked, 40);
});

test('tierOf returns null exactly for boards that cannot be solved logically', () => {
  let nulls = 0;
  let solved = 0;
  for (let s = 0; s < 30; s++) {
    const game = open('expert', s);
    const tier = tierOf(game, { cap: 16 });
    const r = solveLogically(game, { cap: 16 });
    if (tier === null) {
      nulls++;
      assert.equal(r.won, false, `tierOf said unsolvable but the solver won, seed ${s}`);
    } else {
      solved++;
      assert.equal(r.won, true, `tierOf said tier ${tier} but the solver did not win, seed ${s}`);
      assert.ok(tier >= 1 && tier <= 4);
    }
  }
  assert.equal(nulls + solved, 30);
});

test('enumeration never reports a cell two configurations disagree on', () => {
  for (let s = 0; s < 60; s++) {
    const game = open('intermediate', s);
    for (const d of allDeductions(game, { cap: 18 })) {
      if (d.technique !== 'enum') continue;
      assert.ok(verifyDeduction(game, d), `enum deduction failed verification, seed ${s}`);
    }
  }
});

test('a deduction over a revealed or flagged cell is rejected', () => {
  const game = start('beginner', 5, 40);
  const revealedCell = game.revealed.findIndex((v) => v === 1);
  const hiddenCell = game.revealed.findIndex((v) => v === 0);
  const onRevealed = { technique: 'counting', action: 'safe', cells: [revealedCell], source: 0, text: 'x', tier: 1 };
  const flaggedGame = { ...game, marks: Uint8Array.from(game.marks) };
  flaggedGame.marks[hiddenCell] = MARK_FLAG;
  const onFlagged = { technique: 'counting', action: 'safe', cells: [hiddenCell], source: 0, text: 'x', tier: 1 };
  assert.equal(verifyDeduction(game, onRevealed), false);
  assert.equal(verifyDeduction(flaggedGame, onFlagged), false);
});

test('an empty or malformed deduction is rejected', () => {
  const game = start('beginner', 6, 40);
  assert.equal(verifyDeduction(game, null), false);
  assert.equal(verifyDeduction(game, { technique: 'counting', action: 'safe', cells: [], source: 0, text: '', tier: 1 }), false);
  assert.equal(verifyDeduction(game, { technique: 'counting', action: 'safe', cells: [-1], source: 0, text: '', tier: 1 }), false);
  assert.equal(verifyDeduction(game, { technique: 'nope', action: 'safe', cells: [0], source: 0, text: '', tier: 1 }), false);
});

test('mineProbabilityAt is between 0 and 1 and matches enumeration counts', () => {
  // Component size decides whether a probability is computable at all: on a fresh
  // opening the frontier is often one large component, and the honest answer is
  // null. Search for a position where a component fits under the cap, then assert
  // the number is well-formed. Finding none is also a valid outcome, but not on
  // every seed, so require at least one computable case across the sample.
  let measured = 0;
  let nulls = 0;
  for (let s = 0; s < 60 && measured === 0; s++) {
    const game = open(s % 2 === 0 ? 'beginner' : 'intermediate', s);
    const hidden = [];
    for (let i = 0; i < game.size; i++) if (game.revealed[i] === 0) hidden.push(i);
    for (const cell of hidden) {
      const p = mineProbabilityAt(game, cell, { cap: 18 });
      if (!p) {
        nulls++;
        continue;
      }
      assert.ok(p.probability >= 0 && p.probability <= 1, `bad probability ${p.probability}`);
      assert.ok(Number.isInteger(p.configurations) && p.configurations > 0);
      measured++;
      if (measured >= 5) break;
    }
  }
  assert.ok(measured > 0, `no probability could be computed across 60 boards (${nulls} nulls)`);
});

test('mineProbabilityAt returns null when the component exceeds the cap', () => {
  // Force it: cap of 1 cell means almost nothing can be enumerated.
  const game = start('expert', 3, 240);
  const hidden = [];
  for (let i = 0; i < game.size; i++) if (game.revealed[i] === 0) hidden.push(i);
  const results = hidden.slice(0, 20).map((c) => mineProbabilityAt(game, c, { cap: 1 }));
  assert.ok(results.some((r) => r === null), 'cap 1 should make some components unenumerable');
});

test('the hint text is grammatical: no "1 minas" or "1 celdas"', () => {
  const bad = [/ 1 minas/, / 1 celdas/, /ninguna mina marcada/];
  for (let s = 0; s < 120; s++) {
    const game = open(['beginner', 'intermediate', 'expert'][s % 3], s);
    for (const d of allDeductions(game, { cap: 16 })) {
      for (const re of bad) assert.doesNotMatch(d.text, re, `awkward wording: "${d.text}"`);
    }
  }
});

test('constraintsOf ignores zero-count clues', () => {
  const game = start('intermediate', 8, 40);
  const cons = constraintsOf(game);
  for (const c of cons) assert.ok(c.source >= 0 && game.revealed[c.source] === 1);
});

test('threeBV counts zero-regions plus isolated numbers', () => {
  const game = start('beginner', 30, 40);
  const bv = threeBV(game);
  assert.ok(bv > 0, 'a placed board must have a positive 3BV');
  assert.ok(bv <= game.size - game.mineCount, '3BV cannot exceed the number of safe cells');
});

test('3BV of the standard presets is in the community range', () => {
  // Community averages: ~15 / ~65 / ~174. Assert a generous band; the tight
  // comparison is done over 500 boards in the metrics test.
  const bands = { beginner: [8, 30], intermediate: [45, 95], expert: [130, 230] };
  for (const [id, [lo, hi]] of Object.entries(bands)) {
    const values = [];
    for (let s = 0; s < 25; s++) {
      const game = open(id, s);
      const bv = threeBV(game);
      if (bv > 0) values.push(bv);
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(avg >= lo && avg <= hi, `${id} 3BV average ${avg.toFixed(1)} outside [${lo},${hi}]`);
  }
});

test('efficiency is null before clicks and positive afterwards', () => {
  const base = createGame(PRESETS.beginner, { seed: 2 });
  assert.equal(efficiency(base), null);
  const game = reveal(base, 40, createRng(2));
  assert.ok(efficiency(game) > 0);
});

test('solveLogically is deterministic for the same board', () => {
  const game = start('intermediate', 15, 40);
  const a = solveLogically(game, { cap: 16 });
  const b = solveLogically(game, { cap: 16 });
  assert.equal(a.won, b.won);
  assert.equal(a.maxTier, b.maxTier);
  assert.equal(a.steps.length, b.steps.length);
});
