import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, reveal } from '../src/core/game.js';
import { tierOf, solveWithCeiling, findDeduction, verifyDeduction, applyDeduction } from '../src/core/logic.js';
import { generateNoGuess } from '../src/core/generator.js';
import { createRng, deriveSeed, randInt } from '../src/core/rng.js';
import { PRESETS } from '../src/core/presets.js';

const open = (presetId, seed) => {
  const preset = PRESETS[presetId];
  const base = createGame(preset, { seed });
  const cell = randInt(createRng(deriveSeed(seed, 7)), base.size);
  return reveal(base, cell, createRng(seed));
};

test('a board of tier N is not solvable with techniques below N', () => {
  // This is the claim the trainer rests on. If a tier-3 board could be cleared
  // with tier<=2 techniques, calling it "tier 3" would be a lie.
  let checked = 0;
  for (let s = 0; s < 120 && checked < 20; s++) {
    const game = open(['beginner', 'intermediate', 'expert'][s % 3], s);
    const tier = tierOf(game, { cap: 16 });
    if (tier === null || tier === 1) continue;
    const below = solveWithCeiling(game, tier - 1, 16);
    assert.equal(below.won, false, `board of tier ${tier} was solved with techniques up to ${tier - 1} (seed ${s})`);
    const at = solveWithCeiling(game, tier, 16);
    assert.equal(at.won, true, `board of tier ${tier} was not solved at its own tier (seed ${s})`);
    checked++;
  }
  assert.ok(checked >= 3, `only ${checked} multi-tier boards found to test`);
});

test('a generated no-guess board always has a finite tier', () => {
  for (let s = 0; s < 10; s++) {
    for (const id of ['beginner', 'intermediate']) {
      const r = generateNoGuess(PRESETS[id], { seed: deriveSeed(31, s), deadlineMs: 500 });
      if (r.fellBack) continue;
      const tier = tierOf(r.game, { cap: 16 });
      assert.notEqual(tier, null, `${id} seed ${s}: a no-guess board must have a tier`);
      assert.ok(tier >= 1 && tier <= 4);
    }
  }
});

test('the tier of a board is deterministic for its seed', () => {
  const a = open('intermediate', 21);
  const b = open('intermediate', 21);
  assert.equal(tierOf(a, { cap: 16 }), tierOf(b, { cap: 16 }));
});

test('a tier-N board needs a technique of exactly that tier', () => {
  // Every deducted step must carry a tier, and the highest tier used must equal the
  // board tier. A step with tier 0 or 5 would be a bug in the labelling.
  for (let s = 0; s < 30; s++) {
    const game = open('intermediate', s);
    const tier = tierOf(game, { cap: 16 });
    if (tier === null) continue;
    let cur = game;
    let maxSeen = 0;
    let guard = 0;
    while (guard++ < 2000) {
      const d = findDeduction(cur, { cap: 16 });
      if (!d) break;
      assert.ok(d.tier >= 1 && d.tier <= 4, `bad tier ${d.tier}`);
      assert.ok(verifyDeduction(cur, d));
      maxSeen = Math.max(maxSeen, d.tier);
      cur = applyDeduction(cur, d);
    }
    if (cur.status === 'won') {
      assert.equal(maxSeen, tier, `tierOf said ${tier} but the solve used up to ${maxSeen}`);
    }
  }
});
