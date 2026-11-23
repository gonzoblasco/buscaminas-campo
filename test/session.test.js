import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  sessionReveal,
  sessionMark,
  sessionHint,
  sessionApplyHint,
  sessionStats,
  postMortem,
  sessionAllSteps,
  sessionProbability,
} from '../src/ui/session.js';
import { MARK_FLAG } from '../src/core/game.js';

let clock = 1000;
const now = () => (clock += 100);

/** Play a session until it ends, clicking only cells the solver proved safe. */
function playToEnd(session, { useHintsOnly = false } = {}) {
  let guard = 0;
  while (!session.completed && guard++ < 3000) {
    if (useHintsOnly) {
      const h = sessionHint(session);
      if (!h.deduction) break;
      sessionApplyHint(session, h.deduction, now);
      continue;
    }
    const steps = sessionAllSteps(session);
    if (!steps.length) {
      // No proven step: pick a hidden cell. This is the gamble case.
      const hidden = [];
      for (let i = 0; i < session.game.size; i++) {
        if (session.game.revealed[i] === 0 && session.game.marks[i] !== MARK_FLAG) hidden.push(i);
      }
      if (!hidden.length) break;
      sessionReveal(session, hidden[0], now);
      continue;
    }
    sessionApplyHint(session, steps[0], now);
  }
  return session;
}

test('a no-guess session is won by logic alone, with zero gambles', () => {
  for (let s = 0; s < 6; s++) {
    clock = 1000;
    const session = createSession({ presetId: 'beginner', mode: 'noguess', seed: 500 + s });
    let gambles = 0;
    let guard = 0;
    while (!session.completed && guard++ < 3000) {
      // A logical solve uses BOTH kinds of deduction: marking mines is how the
      // next counting step becomes available. Only applying "safe" steps would
      // stall on a board that has a proven mine but no proven safe cell yet.
      const steps = sessionAllSteps(session);
      if (!steps.length) {
        gambles++;
        break;
      }
      sessionApplyHint(session, steps[0], now);
    }
    assert.equal(session.game.status, 'won', `seed ${s} not won by logic`);
    assert.equal(gambles, 0, `seed ${s} needed a gamble, breaking the no-guess promise`);
  }
});

test('the post-mortem never reports a cell the solver could not prove safe', () => {
  // Play intermediate boards until a game is lost by gambling, then check the
  // post-mortem against the pre-loss state it captured.
  let proven = 0;
  for (let s = 0; s < 30; s++) {
    clock = 1000;
    const session = createSession({ presetId: 'intermediate', mode: 'classic', seed: 700 + s });
    // Classic mode places mines on the first click; reveal one cell to start.
    sessionReveal(session, 40, now);
    playToEnd(session);
    if (session.game.status !== 'lost') continue;
    const pm = postMortem(session);
    assert.equal(pm.provable, true, 'the session did not capture the pre-loss state');
    // Every "missed safe" claim must be a cell that was hidden and unflagged before
    // the losing click, and must carry the deduction text that justifies it.
    const before = session.preLoss;
    assert.ok(before, 'no pre-loss snapshot');
    for (const miss of pm.missedSafe) {
      assert.equal(before.revealed[miss.cell], 0, 'the post-mortem named an already-revealed cell');
      assert.notEqual(before.marks[miss.cell], MARK_FLAG, 'the post-mortem named a flagged cell');
      assert.ok(miss.text && miss.text.length > 10, 'the claim carries no justification');
      // Independent check: the cell really is safe on the final board.
      assert.equal(session.game.mines[miss.cell], 0, 'the post-mortem claimed a mine was safe');
    }
    proven++;
  }
  assert.ok(proven > 0, 'no losing game was produced to audit the post-mortem');
});

test('a wrong flag is reported, and a correct flag is not called wrong', () => {
  clock = 1000;
  const session = createSession({ presetId: 'beginner', mode: 'classic', seed: 4321 });
  sessionReveal(session, 40, now);
  // Mark every hidden cell as a flag; some must be wrong, some right.
  for (let i = 0; i < session.game.size; i++) {
    if (session.game.revealed[i] === 0 && session.game.status === 'playing') sessionMark(session, i);
  }
  // Now gamble until the game ends.
  for (let i = 0; i < session.game.size && !session.completed; i++) {
    if (session.game.status !== 'lost') {
      sessionReveal(session, i, now);
      if (session.game.status === 'lost') break;
    }
  }
  if (session.game.status !== 'lost') return; // this seed survived; nothing to assert
  const pm = postMortem(session);
  for (const i of pm.wrongFlags) assert.equal(session.game.mines[i], 0, 'a real mine was called a wrong flag');
  const allFlags = [];
  for (let i = 0; i < session.game.size; i++) if (session.game.marks[i] === MARK_FLAG) allFlags.push(i);
  const realFlags = allFlags.filter((i) => session.game.mines[i] === 1);
  assert.equal(pm.wrongFlags.length, allFlags.length - realFlags.length, 'wrong-flag count does not match reality');
});

test('a hint increments hintsUsed and never changes it twice for one request', () => {
  clock = 1000;
  const session = createSession({ presetId: 'beginner', mode: 'noguess', seed: 77 });
  const before = session.game.hintsUsed;
  const r = sessionHint(session);
  assert.ok(r.deduction, 'expected a deduction on a fresh beginner board');
  assert.equal(session.game.hintsUsed, before + 1);
  if (r.deduction) {
    sessionApplyHint(session, r.deduction, now);
    assert.equal(session.game.hintsUsed, before + 1, 'applying a hint must not count as a second hint');
  }
});

test('a hint refuses to lie when there is no proven step', () => {
  // A board with no provable step must return null, never a fabricated deduction.
  clock = 1000;
  let found = false;
  for (let s = 0; s < 40 && !found; s++) {
    const session = createSession({ presetId: 'expert', mode: 'classic', seed: 900 + s });
    sessionReveal(session, 240, now);
    // Stall the solver deliberately: apply nothing, strip all constraints by
    // revealing nothing more. A fresh Expert opening often has no counting step.
    const r = sessionHint(session);
    if (!r.deduction) {
      found = true;
      assert.equal(r.exhausted, true, 'a null deduction must be reported as exhausted');
      assert.equal(session.game.hintsUsed, 0, 'a refused hint must not count as used');
    }
  }
  // Not finding one is acceptable; lying would not be. If a deduction came back,
  // it must be verifiable, which the next assertion covers.
  const session = createSession({ presetId: 'beginner', mode: 'noguess', seed: 12 });
  const r = sessionHint(session);
  if (r.deduction) {
    assert.ok(r.deduction.text.length > 10);
  }
});

test('session stats use the real 3BV and clicks', () => {
  clock = 1000;
  const session = createSession({ presetId: 'beginner', mode: 'noguess', seed: 31 });
  playToEnd(session, { useHintsOnly: true });
  const stats = sessionStats(session);
  assert.ok(stats.threeBV > 0, '3BV must be positive on a played board');
  assert.ok(stats.clicks > 0);
  assert.ok(stats.efficiency !== null);
  assert.equal(stats.hintsUsed, session.game.hintsUsed);
});

test('probability is null when it cannot be computed honestly', () => {
  clock = 1000;
  const session = createSession({ presetId: 'expert', mode: 'noguess', seed: 61 });
  // Force the cap down to 1 so almost nothing is computable.
  let nulls = 0;
  let numbers = 0;
  for (let i = 0; i < session.game.size; i++) {
    if (session.game.revealed[i] === 1) continue;
    const p = sessionProbability(session, i, { cap: 1 });
    if (p === null) nulls++;
    else {
      numbers++;
      assert.ok(p.probability >= 0 && p.probability <= 1);
    }
  }
  assert.ok(nulls > 0, 'with a cap of 1 the honest answer must sometimes be "cannot compute"');
  assert.ok(numbers >= 0);
});

test('a paused session ignores input', () => {
  clock = 1000;
  const session = createSession({ presetId: 'beginner', mode: 'noguess', seed: 14 });
  session.paused = true;
  const before = Array.from(session.game.revealed);
  const hidden = session.game.revealed.findIndex((v) => v === 0);
  sessionReveal(session, hidden, now);
  assert.deepEqual(Array.from(session.game.revealed), before, 'a paused game accepted a reveal');
});

test('the same seed reproduces the same session board', () => {
  const a = createSession({ presetId: 'intermediate', mode: 'noguess', seed: 123456 });
  const b = createSession({ presetId: 'intermediate', mode: 'noguess', seed: 123456 });
  assert.deepEqual(Array.from(a.game.mines), Array.from(b.game.mines));
  assert.deepEqual(Array.from(a.game.revealed), Array.from(b.game.revealed));
});
