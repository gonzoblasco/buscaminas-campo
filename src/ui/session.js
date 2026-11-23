// src/ui/session.js - Game session: owns state, timer, records, and the flows the
// UI calls (new game, reveal, mark, chord, hint, pause). No DOM here.
//
// This module is the boundary the tests poke: it is deterministic given a seed and
// has no browser dependency beyond `now()` injection.

import {
  createGame,
  reveal,
  chord,
  cycleMark,
  isWon,
  flagCount,
  MARK_FLAG,
} from '../core/game.js';
import { findDeduction, verifyDeduction, applyDeduction, allDeductions, mineProbabilityAt } from '../core/logic.js';
import { generateNoGuess } from '../core/generator.js';
import { threeBV, efficiency } from '../core/metrics.js';
import { createRng, deriveSeed } from '../core/rng.js';
import { presetOf, PRESETS } from '../core/presets.js';

/** @typedef {import('../core/game.js').Game} Game */
/** @typedef {import('./persistence.js').Settings} Settings */

/**
 * @typedef {Object} Session
 * @property {Game} game
 * @property {string} presetId
 * @property {'noguess'|'classic'} mode
 * @property {boolean} fellBack
 * @property {boolean} paused
 * @property {number} startedAt
 * @property {number} elapsedMs
 * @property {number} seed
 * @property {number|null} exploded
 * @property {boolean} completed
 * @property {Game|null} preLoss  state of the board just before the losing click
 */

/**
 * Create a session for a preset and mode. In no-guess mode the board comes from the
 * generator; in classic mode it is a plain random board placed on the first click.
 * @param {{
 *   presetId: string,
 *   mode: 'noguess'|'classic',
 *   seed?: number,
 *   now?: () => number,
 *   deadlineMs?: number
 * }} opts
 * @returns {Session}
 */
export function createSession(opts) {
  const preset = presetOf(opts.presetId);
  const mode = opts.mode;
  const seed = (opts.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;

  let game;
  let fellBack = false;
  if (mode === 'noguess') {
    const result = generateNoGuess(preset, { seed, deadlineMs: opts.deadlineMs ?? 250 });
    game = result.game;
    fellBack = result.fellBack;
  } else {
    // Classic: no mines until the first click, exactly like the original.
    game = createGame(preset, { seed });
  }

  return {
    game,
    presetId: opts.presetId,
    mode,
    fellBack,
    paused: false,
    startedAt: 0,
    elapsedMs: 0,
    seed,
    exploded: null,
    completed: false,
    preLoss: null,
  };
}

/**
 * The RNG for one action. Derived from the session seed and the action count so a
 * replay is reproducible.
 * @param {Session} session
 * @returns {{next: () => number}}
 */
function rngFor(session) {
  return createRng(deriveSeed(session.seed, session.game.actions.length + 1));
}

/**
 * Reveal a cell. Returns the same session object, mutated in place, for the UI's
 * convenience; the Game inside is replaced (reveal returns a new Game).
 * @param {Session} session
 * @param {number} i
 * @param {() => number} now
 * @returns {Session}
 */
export function sessionReveal(session, i, now = () => Date.now()) {
  if (session.completed || session.paused) return session;
  const before = session.game;
  if (before.revealed[i] === 1 || before.marks[i] === MARK_FLAG) return session;

  if (!session.startedAt) session.startedAt = now();

  const wasReady = before.status === 'ready';
  const next = reveal(before, i, rngFor(session));
  session.game = next;

  if (wasReady && next.status !== 'lost') {
    session.elapsedMs = 0;
  }
  if (next.status === 'lost') {
    session.preLoss = before;
    session.exploded = i;
    session.elapsedMs = session.startedAt ? now() - session.startedAt : 0;
    session.completed = true;
  } else if (isWon(next)) {
    session.elapsedMs = session.startedAt ? now() - session.startedAt : 0;
    session.completed = true;
  }
  return session;
}

/**
 * Cycle a mark: none -> flag -> question -> none.
 * @param {Session} session
 * @param {number} i
 * @returns {Session}
 */
export function sessionMark(session, i) {
  if (session.completed || session.paused) return session;
  session.game = cycleMark(session.game, i);
  return session;
}

/**
 * Chord around a revealed number.
 * @param {Session} session
 * @param {number} i
 * @param {() => number} [now]
 * @returns {Session}
 */
export function sessionChord(session, i, now = () => Date.now()) {
  if (session.completed || session.paused) return session;
  if (!session.startedAt) session.startedAt = now();
  const before = session.game;
  const next = chord(session.game, i, rngFor(session));
  session.game = next;
  if (next.status === 'lost') {
    session.preLoss = before;
    session.elapsedMs = session.startedAt ? now() - session.startedAt : 0;
    session.completed = true;
  } else if (isWon(next)) {
    session.elapsedMs = session.startedAt ? now() - session.startedAt : 0;
    session.completed = true;
  }
  return session;
}

/**
 * Ask for one hint. Returns the deduction shown (or null) plus, when the board has
 * no proven step, whether the player must gamble.
 * @param {Session} session
 * @param {{cap?: number}} [opts]
 * @returns {{deduction: import('../core/logic.js').Deduction|null, exhausted: boolean, tier: number}}
 */
export function sessionHint(session, opts = {}) {
  if (session.completed) return { deduction: null, exhausted: false, tier: 0 };
  const d = findDeduction(session.game, opts);
  if (!d) return { deduction: null, exhausted: true, tier: 0 };
  if (!verifyDeduction(session.game, d)) return { deduction: null, exhausted: true, tier: 0 };
  session.game = { ...session.game, hintsUsed: session.game.hintsUsed + 1 };
  return { deduction: d, exhausted: false, tier: d.tier };
}

/**
 * Apply a hint's deduction to the board (the player pressed "show me").
 * @param {Session} session
 * @param {import('../core/logic.js').Deduction} d
 * @param {() => number} [now]
 * @returns {Session}
 */
export function sessionApplyHint(session, d, now = () => Date.now()) {
  if (session.completed) return session;
  if (!verifyDeduction(session.game, d)) return session;
  if (!session.startedAt) session.startedAt = now();
  session.game = applyDeduction(session.game, d);
  if (isWon(session.game)) {
    session.elapsedMs = session.startedAt ? now() - session.startedAt : 0;
    session.completed = true;
  }
  return session;
}

/**
 * Every currently available step, for the trainer and for the post-mortem.
 * @param {Session} session
 * @param {{cap?: number}} [opts]
 * @returns {import('../core/logic.js').Deduction[]}
 */
export function sessionAllSteps(session, opts = {}) {
  return allDeductions(session.game, opts).filter((d) => verifyDeduction(session.game, d));
}

/**
 * Probability that one cell hides a mine. Null when it cannot be computed honestly.
 * @param {Session} session
 * @param {number} i
 * @param {{cap?: number}} [opts]
 * @returns {{probability: number, configurations: number}|null}
 */
export function sessionProbability(session, i, opts = {}) {
  return mineProbabilityAt(session.game, i, opts);
}

/**
 * Post-mortem for a lost game. Reports only what the solver can PROVE:
 *  - wrong flags: flagged cells that are not mines (provable: the mine count and the
 *    solver's knowledge)
 *  - safe cells the player could have opened: cells the solver could prove safe
 *    BEFORE the losing click.
 * Each entry carries the deduction that justifies it, so the claim is auditable.
 * @param {Session} session
 * @returns {{wrongFlags: number[], missedSafe: {cell: number, text: string}[], gamble: boolean, provable: boolean}}
 */
export function postMortem(session) {
  const game = session.game;
  const wrongFlags = [];
  if (game.status === 'lost') {
    for (let i = 0; i < game.size; i++) {
      if (game.marks[i] === MARK_FLAG && game.mines[i] === 0) wrongFlags.push(i);
    }
  }
  // The "missed safe" list is computed on the board as it was JUST BEFORE the
  // losing click, which the session captured for us. Without that snapshot we
  // refuse to claim anything: an unsupported claim is worse than no claim.
  const before = session.preLoss;
  if (!before) {
    return { wrongFlags, missedSafe: [], gamble: false, provable: false };
  }
  const missed = [];
  const steps = allDeductions(before, { cap: 16 }).filter((d) => d.action === 'safe');
  for (const d of steps) {
    if (!verifyDeduction(before, d)) continue;
    for (const cell of d.cells) {
      if (before.revealed[cell] === 0 && before.marks[cell] !== MARK_FLAG) {
        missed.push({ cell, text: d.text });
      }
    }
  }
  return { wrongFlags, missedSafe: missed, gamble: missed.length === 0, provable: true };
}

/**
 * Final stats for a completed game.
 * @param {Session} session
 * @returns {{threeBV: number, efficiency: number|null, clicks: number, hintsUsed: number, seconds: number}}
 */
export function sessionStats(session) {
  return {
    threeBV: threeBV(session.game),
    efficiency: efficiency(session.game),
    clicks: session.game.clicks,
    hintsUsed: session.game.hintsUsed,
    seconds: session.elapsedMs / 1000,
  };
}

export { PRESETS, flagCount };
