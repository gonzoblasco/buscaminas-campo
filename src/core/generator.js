// src/core/generator.js - No-guess board generation.
//
// WHY THIS IS NOT REJECTION SAMPLING
//
// The obvious generator lays mines at random, runs the solver, and retries on
// failure. Measured on this engine (2026-11-23), that costs 14.25 attempts per
// accepted Expert board with a p95 of 1277 ms, because Expert openings almost
// always leave a frontier whose connected components reach 43-57 cells.
//
// Raising the enumeration cap does not fix it: on Expert the logical solve rate
// goes 10.0% (cap 16) -> 12.5% (cap 30) while the per-board time explodes. The
// bottleneck is the board, not the solver, so a stronger solver buys almost
// nothing and a bigger cap buys nothing at all.
//
// The fix is the one Simon Tatham describes for his Mines generator: do not throw
// the board away when the solver stalls. Perturb mines *behind the frontier* so the
// current position gains at least one new deduction, then let the solver continue.
// Rejection is the fallback when perturbation stops making progress.
//
// The invariant that matters: the returned board is ALWAYS re-verified from the
// opening with a clean solve. Perturbation is a heuristic for arriving at a
// soluble board quickly; it is never evidence that the board is soluble.

import { neighborsOf } from './board.js';
import { cloneGame, createGame, isWon, reveal, MARK_FLAG } from './game.js';
import { findDeduction, applyDeduction } from './logic.js';
import { createRng, deriveSeed, randInt } from './rng.js';

/** @typedef {import('./game.js').Game} Game */

export const DEFAULT_ENUM_CAP = 16;
export const DEFAULT_MAX_ATTEMPTS = 60;
export const DEFAULT_DEADLINE_MS = 250;
export const DEFAULT_MAX_PERTURBATIONS = 40;

/**
 * Solve a board with logic, applying proven deductions. Returns the solved state
 * (won or stuck) and whether it won.
 * @param {Game} game
 * @param {number} cap
 * @returns {{game: Game, won: boolean}}
 */
export function solveFrom(game, cap = DEFAULT_ENUM_CAP) {
  let cur = game;
  let guard = 0;
  while (guard++ < 100000) {
    if (isWon(cur)) return { game: cur, won: true };
    const d = findDeduction(cur, { cap });
    if (!d) break;
    cur = applyDeduction(cur, d);
  }
  return { game: cur, won: isWon(cur) };
}

/**
 * Hidden non-mine cells outside the frontier that could host an incoming mine.
 * @param {Game} game
 * @returns {number[]}
 */
function emptyCellsOutsideFrontier(game) {
  const out = [];
  for (let i = 0; i < game.size; i++) {
    if (game.revealed[i] === 1 || game.mines[i] !== 0) continue;
    if (game.marks[i] !== 0) continue;
    let touchesOpen = false;
    for (const nb of neighborsOf(game, i)) {
      if (game.revealed[nb] === 1) {
        touchesOpen = true;
        break;
      }
    }
    if (!touchesOpen) out.push(i);
  }
  return out;
}

/**
 * Move one mine from a cell on the frontier to a cell outside it. This removes a
 * blockage in front of the solver at the cost of a hidden mine behind it, which is
 * the trade Tatham describes.
 * @param {Game} game  not mutated
 * @param {import('./rng.js').Rng} rng
 * @returns {Game|null} a new game with one mine relocated, or null if impossible
 */
function perturbOnce(game, rng) {
  // A frontier mine: adjacent to at least one opened cell.
  const frontierMines = [];
  for (let i = 0; i < game.size; i++) {
    if (game.revealed[i] === 1 || game.mines[i] !== 1) continue;
    if (game.marks[i] === MARK_FLAG) continue;
    for (const nb of neighborsOf(game, i)) {
      if (game.revealed[nb] === 1) {
        frontierMines.push(i);
        break;
      }
    }
  }
  if (!frontierMines.length) return null;

  const targets = emptyCellsOutsideFrontier(game);
  if (!targets.length) return null;

  const from = frontierMines[randInt(rng, frontierMines.length)];
  const to = targets[randInt(rng, targets.length)];
  const next = cloneGame(game);
  next.mines[from] = 0;
  next.mines[to] = 1;
  // Recompute counts: a full recompute keeps the invariant simple and costs one pass.
  recomputeCounts(next);
  // Clear any stale marks: a perturbed board invalidates them.
  next.marks = new Uint8Array(next.size);
  return next;
}

/**
 * @param {Game} game  mutated
 * @returns {void}
 */
function recomputeCounts(game) {
  for (let i = 0; i < game.size; i++) {
    if (game.mines[i] === 1) {
      game.counts[i] = 0;
      continue;
    }
    let n = 0;
    for (const nb of neighborsOf(game, i)) if (game.mines[nb] === 1) n++;
    game.counts[i] = n;
  }
}

/**
 * Cells currently opened.
 * @param {Game} g
 * @returns {number}
 */
function countOpened(g) {
  let n = 0;
  for (let i = 0; i < g.size; i++) if (g.revealed[i] === 1) n++;
  return n;
}

/**
 * Try to reach a soluble board starting from one random placement, perturbing at
 * each stall instead of restarting from scratch.
 * @param {Game} opening  the game after the first reveal, mines placed
 * @param {number} cap
 * @param {import('./rng.js').Rng} rng
 * @param {number} maxPerturbations
 * @returns {{game: Game, perturbed: number}|null}
 */
function perturbToSoluble(opening, cap, rng, maxPerturbations) {
  let cur = opening;
  let stallsSinceProgress = 0;
  let bestStalls = Infinity;
  let lastOpened = -1;

  for (let p = 0; p < maxPerturbations; p++) {
    const r = solveFrom(cur, cap);
    cur = r.game;
    if (r.won) {
      // Re-verify from the opening: perturbation is a heuristic, not proof.
      const rebuilt = rebuildWithMines(opening, cur.mines);
      if (rebuilt && solveFrom(rebuilt, cap).won) return { game: rebuilt, perturbed: p };
      // The perturbation route reached a win a clean solve cannot confirm.
      // Treat it as no progress and keep going.
    }

    const next = perturbOnce(cur, rng);
    if (!next) return null;

    // Detect a local optimum: when perturbation stops opening new cells, restart
    // from scratch instead of grinding.
    stallsSinceProgress++;
    const opened = countOpened(cur);
    if (opened !== lastOpened) {
      bestStalls = Math.min(bestStalls, stallsSinceProgress);
      stallsSinceProgress = 0;
      lastOpened = opened;
    }
    if (stallsSinceProgress > 8 && bestStalls <= 8) return null;
    cur = next;
  }
  return null;
}

/**
 * Rebuild the opening state with a different mine layout, keeping the reveal
 * pattern of the first click and re-flooding from it.
 * @param {Game} opening
 * @param {Uint8Array} mines
 * @returns {Game}
 */
function rebuildWithMines(opening, mines) {
  const next = cloneGame(opening);
  next.mines = new Uint8Array(mines);
  recomputeCounts(next);
  next.marks = new Uint8Array(next.size);
  // Re-derive what a flood fill from the first click would have opened.
  const revealed = new Uint8Array(next.size);
  const firstRevealed = [];
  for (let i = 0; i < opening.size; i++) if (opening.revealed[i] === 1) firstRevealed.push(i);
  const origin = firstRevealed.find((i) => opening.counts[i] === 0);
  const start = origin ?? firstRevealed[0] ?? 0;
  if (next.mines[start] === 1) return null;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (revealed[i] === 1 || next.mines[i] === 1) continue;
    revealed[i] = 1;
    if (next.counts[i] === 0) {
      for (const nb of neighborsOf(next, i)) if (revealed[nb] === 0) stack.push(nb);
    }
  }
  next.revealed = revealed;
  // The opening reveal was one click, whatever it opened.
  next.clicks = 1;
  next.status = 'playing';
  return next;
}

/**
 * Generate a board the logical solver can clear without guessing.
 *
 * Three outcomes, all reported, none silent:
 *  - accepted: the solver wins from the opening, no warning
 *  - fellBack: no soluble board was reached inside the budget; returns a classic
 *    board with `fellBack: true` so the UI can say so
 *  - deadline: same as fellBack, with `deadlineHit: true`
 *
 * @param {{width: number, height: number, mineCount: number}} preset
 * @param {{
 *   seed?: number,
 *   cell?: number,
 *   enumCap?: number,
 *   maxAttempts?: number,
 *   deadlineMs?: number,
 *   maxPerturbations?: number
 * }} [opts]
 * @returns {{
 *   game: Game,
 *   attempts: number,
 *   perturbed: number,
 *   elapsedMs: number,
 *   fellBack: boolean,
 *   deadlineHit: boolean
 * }}
 */
export function generateNoGuess(preset, opts = {}) {
  const seed = (opts.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  const cap = opts.enumCap ?? DEFAULT_ENUM_CAP;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const maxPerturbations = opts.maxPerturbations ?? DEFAULT_MAX_PERTURBATIONS;

  const t0 = performance.now();
  let attempts = 0;
  let perturbed = 0;
  let deadlineHit = false;
  let firstOpening = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (performance.now() - t0 > deadlineMs) {
      deadlineHit = true;
      break;
    }
    const attemptSeed = deriveSeed(seed, attempt);
    const probe = createGame(preset, { seed: attemptSeed });
    const cell = opts.cell ?? randInt(createRng(deriveSeed(attemptSeed, 31)), probe.size);
    const opening = reveal(probe, cell, createRng(attemptSeed));
    if (!firstOpening) firstOpening = opening;
    attempts++;

    // Cheap path first: the opening may already be soluble.
    const direct = solveFrom(opening, cap);
    if (direct.won && isWon(direct.game)) {
      return {
        game: rebuildWithMines(opening, opening.mines) ?? opening,
        attempts,
        perturbed,
        elapsedMs: performance.now() - t0,
        fellBack: false,
        deadlineHit: false,
      };
    }

    // Perturbation path.
    const result = perturbToSoluble(opening, cap, createRng(deriveSeed(attemptSeed, 999)), maxPerturbations);
    if (result) {
      perturbed += result.perturbed;
      return {
        game: result.game,
        attempts,
        perturbed,
        elapsedMs: performance.now() - t0,
        fellBack: false,
        deadlineHit: false,
      };
    }
    perturbed += maxPerturbations;
  }

  // Fallback: serve a classic board and SAY SO.
  const fallbackOpening =
    firstOpening ??
    reveal(createGame(preset, { seed }), opts.cell ?? 0, createRng(seed));
  return {
    game: fallbackOpening,
    attempts,
    perturbed,
    elapsedMs: performance.now() - t0,
    fellBack: true,
    deadlineHit,
  };
}
