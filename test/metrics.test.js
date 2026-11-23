import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, reveal } from '../src/core/game.js';
import { threeBV, efficiency, threeBVPerSecond } from '../src/core/metrics.js';
import { createSession, sessionStats, sessionAllSteps, sessionApplyHint } from '../src/ui/session.js';
import { createRng, deriveSeed, randInt } from '../src/core/rng.js';
import { PRESETS, PRESET_LIST } from '../src/core/presets.js';

const open = (presetId, seed) => {
  const preset = PRESETS[presetId];
  const base = createGame(preset, { seed });
  const cell = randInt(createRng(deriveSeed(seed, 7)), base.size);
  return reveal(base, cell, createRng(seed));
};

test('one reveal is one click, however many cells it opens', () => {
  // The bug this locks: the v1 counted cells as clicks, so a 59-cell opening read as
  // 59 clicks and the efficiency came out at 322%.
  for (const id of ['beginner', 'intermediate', 'expert']) {
    const game = open(id, 5);
    const revealed = Array.from(game.revealed).filter((v) => v === 1).length;
    assert.ok(revealed > 1, `${id} opening should open more than one cell`);
    assert.equal(game.clicks, 1, `${id}: a ${revealed}-cell opening was counted as ${game.clicks} clicks`);
  }
});

test('efficiency never exceeds the theoretical maximum of 3BV per click', () => {
  // A perfect game can clear several 3BV units per chord, so >100% is reachable, but
  // it can never exceed 3BV divided by the number of clicks taken, and with one
  // click it must still be a finite, explainable number.
  for (const id of ['beginner', 'intermediate']) {
    const game = open(id, 9);
    const eff = efficiency(game);
    const bv = threeBV(game);
    assert.ok(eff !== null);
    assert.ok(Math.abs(eff - bv / game.clicks * 100) < 1e-9, 'efficiency is not 3BV/clicks');
  }
});

test('played-through efficiency is a sane percentage', () => {
  let checked = 0;
  for (let s = 0; s < 8; s++) {
    const session = createSession({ presetId: 'beginner', mode: 'noguess', seed: 300 + s });
    let guard = 0;
    while (!session.completed && guard++ < 2000) {
      const steps = sessionAllSteps(session);
      if (!steps.length) break;
      sessionApplyHint(session, steps[0]);
    }
    if (session.game.status !== 'won') continue;
    const stats = sessionStats(session);
    assert.ok(stats.clicks >= 1);
    assert.ok(stats.efficiency !== null);
    // A solved board takes at least 1 click and at most one per safe cell.
    const safe = session.game.size - session.game.mineCount;
    assert.ok(stats.clicks <= safe + 1, `clicks ${stats.clicks} exceed safe cells ${safe}`);
    checked++;
  }
  assert.ok(checked > 0, 'no game was played to a win');
});

test('3BV is consistent: it never exceeds the number of safe cells', () => {
  for (const preset of PRESET_LIST) {
    for (let s = 0; s < 10; s++) {
      const game = open(preset.id, s);
      const bv = threeBV(game);
      const safe = game.size - game.mineCount;
      assert.ok(bv > 0 && bv <= safe, `${preset.id}: 3BV ${bv} out of range (safe cells ${safe})`);
    }
  }
});

test('3BV per second divides by real seconds and rejects zero', () => {
  const game = open('beginner', 3);
  assert.equal(threeBVPerSecond(game, 0), null);
  assert.equal(threeBVPerSecond(game, -1), null);
  const v = threeBVPerSecond(game, 10);
  assert.ok(v > 0 && Number.isFinite(v));
});
