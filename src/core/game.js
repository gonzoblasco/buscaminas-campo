// src/core/game.js - Game state and the actions that move it forward.
//
// Two rules this file has to keep, both learned the hard way in the v1:
//  1. reveal/chord/cycleMark return a NEW Game. The UI may swap the reference;
//     the replay and the post-mortem depend on old states not mutating underneath.
//  2. mines and counts stay all-zero until the first reveal. The no-guess
//     generator needs to evaluate candidate boards without leaking them.

import { neighborsOf, placeMines, safeZoneOf, computeCounts } from './board.js';

/**
 * @typedef {Object} Action
 * @property {'reveal'|'mark'|'chord'} kind
 * @property {number} cell
 * @property {number} at
 * @property {string|null} technique
 * @property {boolean} bet
 */

/**
 * @typedef {Object} Game
 * @property {number} width
 * @property {number} height
 * @property {number} size
 * @property {number} mineCount
 * @property {number} seed
 * @property {Uint8Array} mines
 * @property {Uint8Array} counts
 * @property {Uint8Array} revealed
 * @property {Uint8Array} marks
 * @property {boolean} minesPlaced
 * @property {'ready'|'playing'|'won'|'lost'} status
 * @property {number} clicks
 * @property {number} hintsUsed
 * @property {Action[]} actions
 * @property {boolean} truncated
 */

export const MAX_ACTIONS = 4096;

/** Mark states. */
export const MARK_NONE = 0;
/** @type {const} */ export const MARK_FLAG = 1;
/** @type {const} */ export const MARK_QUESTION = 2;

/**
 * Clone a game. Typed arrays are copied; the action log is copied shallowly
 * (its entries are never mutated once pushed).
 * @param {Game} game
 * @returns {Game}
 */
export function cloneGame(game) {
  return {
    width: game.width,
    height: game.height,
    size: game.size,
    mineCount: game.mineCount,
    seed: game.seed,
    mines: new Uint8Array(game.mines),
    counts: new Uint8Array(game.counts),
    revealed: new Uint8Array(game.revealed),
    marks: new Uint8Array(game.marks),
    minesPlaced: game.minesPlaced,
    status: game.status,
    clicks: game.clicks,
    hintsUsed: game.hintsUsed,
    actions: game.actions.slice(),
    truncated: game.truncated,
  };
}

/**
 * Create a fresh game. No mines are placed until the first reveal.
 * @param {{ width: number, height: number, mineCount: number }} preset
 * @param {{ seed?: number }} [opts]
 * @returns {Game}
 */
export function createGame(preset, opts = {}) {
  const { width, height, mineCount } = preset;
  const size = width * height;
  if (mineCount <= 0 || mineCount > size - 9) {
    throw new RangeError('mineCount must satisfy 1 <= mineCount <= size - 9');
  }
  const seed = (opts.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return {
    width,
    height,
    size,
    mineCount,
    seed,
    mines: new Uint8Array(size),
    counts: new Uint8Array(size),
    revealed: new Uint8Array(size),
    marks: new Uint8Array(size),
    minesPlaced: false,
    status: 'ready',
    clicks: 0,
    hintsUsed: 0,
    actions: [],
    truncated: false,
  };
}

/**
 * Append to the action log, respecting the cap. Silently truncates and flags it
 * rather than growing without bound; the replay reports incompleteness.
 * @param {Game} game
 * @param {Action} action
 * @returns {void}
 */
function log(game, action) {
  if (game.truncated) return;
  if (game.actions.length >= MAX_ACTIONS) {
    game.truncated = true;
    return;
  }
  game.actions.push(action);
}

/**
 * Place mines on the first reveal, keeping the safe zone clear.
 * @param {Game} game  mutated
 * @param {number} i
 * @param {{ next: () => number }} rng
 * @returns {void}
 */
function ensureMines(game, i, rng, area = '3x3') {
  if (game.minesPlaced) return;
  placeMines(game, rng, safeZoneOf(game, i, area));
  game.minesPlaced = true;
}

/**
 * Flood fill from a safe, zero-count cell.
 * @param {Game} game  mutated
 * @param {number} start
 * @returns {number} how many cells were newly revealed
 */
function floodFrom(game, start) {
  let opened = 0;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (game.revealed[i] === 1) continue;
    if (game.mines[i] === 1) continue;
    if (game.marks[i] !== MARK_NONE) continue;
    game.revealed[i] = 1;
    opened++;
    if (game.counts[i] === 0) {
      for (const n of neighborsOf(game, i)) {
        if (game.revealed[n] === 0 && game.marks[n] === MARK_NONE) stack.push(n);
      }
    }
  }
  return opened;
}

/**
 * Reveal a cell. Returns a new Game.
 * @param {Game} game
 * @param {number} i
 * @param {{ next: () => number }} rng
 * @param {{ technique?: string|null, bet?: boolean, firstClickArea?: '1x1'|'3x3'|'5x5' }} [meta]
 * @returns {Game}
 */
export function reveal(game, i, rng, meta = {}) {
  if (game.status === 'won' || game.status === 'lost') return game;
  if (i < 0 || i >= game.size) return game;
  if (game.revealed[i] === 1) return game;
  if (game.marks[i] === MARK_FLAG) return game;

  const next = cloneGame(game);
  ensureMines(next, i, rng, meta.firstClickArea);
  if (next.marks[i] !== MARK_NONE) next.marks[i] = MARK_NONE;

  if (next.mines[i] === 1) {
    next.revealed[i] = 1;
    next.status = 'lost';
    next.actions.push({ kind: 'reveal', cell: i, at: next.actions.length, technique: meta.technique ?? null, bet: Boolean(meta.bet) });
    return next;
  }

  if (next.counts[i] === 0) floodFrom(next, i);
  else next.revealed[i] = 1;
  // One click, however many cells it opens. Efficiency is 3BV per CLICK, not per
  // cell: counting a 59-cell flood fill as 59 clicks reported 322% efficiency.
  next.clicks += 1;
  if (next.status === 'ready') next.status = 'playing';
  log(next, { kind: 'reveal', cell: i, at: next.actions.length, technique: meta.technique ?? null, bet: Boolean(meta.bet) });
  if (isWon(next)) next.status = 'won';
  return next;
}

/**
 * Chording: reveal all unflagged neighbours of a satisfied numbered cell.
 * @param {Game} game
 * @param {number} i
 * @param {{ next: () => number }} rng
 * @returns {Game}
 */
export function chord(game, i, rng) {
  if (game.status === 'won' || game.status === 'lost') return game;
  if (game.revealed[i] !== 1 || game.counts[i] === 0) return game;
  const neigh = neighborsOf(game, i);
  let flags = 0;
  for (const n of neigh) if (game.marks[n] === MARK_FLAG) flags++;
  if (flags !== game.counts[i]) return game;

  let cur = cloneGame(game);
  log(cur, { kind: 'chord', cell: i, at: cur.actions.length, technique: null, bet: false });
  for (const n of neigh) {
    if (cur.revealed[n] === 1) continue;
    if (cur.marks[n] === MARK_FLAG) continue;
    cur = revealQuiet(cur, n, rng);
    if (cur.status === 'lost') return cur;
  }
  if (isWon(cur)) cur.status = 'won';
  return cur;
}

/**
 * Reveal without logging a second action (chord logs once).
 * @param {Game} game
 * @param {number} i
 * @param {{ next: () => number }} rng
 * @returns {Game}
 */
function revealQuiet(game, i, rng) {
  if (game.mines[i] === 1) {
    const next = cloneGame(game);
    next.revealed[i] = 1;
    next.status = 'lost';
    return next;
  }
  const next = cloneGame(game);
  if (next.marks[i] !== MARK_NONE) next.marks[i] = MARK_NONE;
  if (next.counts[i] === 0) floodFrom(next, i);
  else next.revealed[i] = 1;
  // One click, however many cells it opens. Efficiency is 3BV per CLICK, not per
  // cell: counting a 59-cell flood fill as 59 clicks reported 322% efficiency.
  next.clicks += 1;
  return next;
}

/**
 * Cycle the mark on a hidden cell: none -> flag -> question -> none.
 * @param {Game} game
 * @param {number} i
 * @returns {Game}
 */
export function cycleMark(game, i) {
  if (game.status === 'won' || game.status === 'lost') return game;
  if (game.revealed[i] === 1) return game;
  const next = cloneGame(game);
  const before = next.marks[i];
  next.marks[i] = before === MARK_NONE ? MARK_FLAG : before === MARK_FLAG ? MARK_QUESTION : MARK_NONE;
  log(next, { kind: 'mark', cell: i, at: next.actions.length, technique: null, bet: false });
  return next;
}

/**
 * @param {Game} game
 * @returns {boolean}
 */
export function isWon(game) {
  for (let i = 0; i < game.size; i++) {
    if (game.mines[i] === 0 && game.revealed[i] === 0) return false;
  }
  return true;
}

/**
 * @param {Game} game
 * @returns {Game['status']}
 */
export function statusOf(game) {
  return game.status;
}

/**
 * Cells still hidden.
 * @param {Game} game
 * @returns {number}
 */
export function hiddenCount(game) {
  let n = 0;
  for (let i = 0; i < game.size; i++) if (game.revealed[i] === 0) n++;
  return n;
}

/**
 * Flag count, for the mine counter.
 * @param {Game} game
 * @returns {number}
 */
export function flagCount(game) {
  let n = 0;
  for (let i = 0; i < game.size; i++) if (game.marks[i] === MARK_FLAG) n++;
  return n;
}

export { computeCounts };
