// src/core/board.js - Geometry and mine placement. Pure: never mutates its inputs
// except the arrays inside the Game it is explicitly given to fill.
//
// Purity note that cost the v1 a bug: neighborsOf caches per-game neighbour tables
// in a module-level WeakMap. It must never write a cache field onto the caller's
// game object. test/board.test.js asserts that a structuredClone is unchanged.

/**
 * @typedef {import('./game.js').Game} Game
 */

/** @type {WeakMap<object, number[][]>} */
const NEIGHBOR_CACHE = new WeakMap();

/**
 * Cached neighbour table for a game's geometry.
 * @param {Game} game
 * @returns {number[][]}
 */
function neighborTable(game) {
  const cached = NEIGHBOR_CACHE.get(game);
  if (cached) return cached;
  const { width, height } = game;
  const table = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const out = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          out.push(ny * width + nx);
        }
      }
      table[y * width + x] = out;
    }
  }
  NEIGHBOR_CACHE.set(game, table);
  return table;
}

/**
 * Neighbour indices of a cell, in bounds.
 * @param {Game} game
 * @param {number} i
 * @returns {number[]}
 */
export function neighborsOf(game, i) {
  return neighborTable(game)[i];
}

/**
 * @param {Game} game
 * @param {number} i
 * @returns {number}
 */
export function xOf(game, i) {
  return i % game.width;
}

/**
 * @param {Game} game
 * @param {number} i
 * @returns {number}
 */
export function yOf(game, i) {
  return Math.floor(i / game.width);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function indexOf(game, x, y) {
  return y * game.width + x;
}

/**
 * The cells that must stay mine-free on the first click.
 * 1x1 keeps only the clicked cell, 3x3 (the default) adds its neighbours, 5x5
 * adds the ring around them. The presets reserve space for 5x5: the smallest
 * board is 9x9 with 10 mines, and 81 - 9 = 72 > 10.
 * @param {Game} game
 * @param {number} i
 * @param {'1x1'|'3x3'|'5x5'} [area]
 * @returns {Set<number>}
 */
export function safeZoneOf(game, i, area = '3x3') {
  const zone = new Set([i]);
  if (area === '1x1') return zone;
  const radius = area === '5x5' ? 2 : 1;
  const x = i % game.width;
  const y = Math.floor(i / game.width);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= game.width || ny >= game.height) continue;
      zone.add(ny * game.width + nx);
    }
  }
  return zone;
}

/**
 * Place mines uniformly at random, excluding the safe zone. Fills game.mines.
 * @param {Game} game
 * @param {{ next: () => number }} rng
 * @param {Set<number>} safeZone
 * @returns {void}
 */
export function placeMines(game, rng, safeZone) {
  const candidates = [];
  for (let i = 0; i < game.size; i++) {
    if (!safeZone.has(i)) candidates.push(i);
  }
  if (candidates.length < game.mineCount) {
    throw new RangeError('Not enough cells outside the safe zone to place mines');
  }
  // Partial Fisher-Yates: only the first mineCount slots need to be chosen.
  for (let k = 0; k < game.mineCount; k++) {
    const j = k + Math.floor(rng.next() * (candidates.length - k));
    const tmp = candidates[k];
    candidates[k] = candidates[j];
    candidates[j] = tmp;
    game.mines[candidates[k]] = 1;
  }
  computeCounts(game);
}

/**
 * Fill game.counts from game.mines.
 * @param {Game} game
 * @returns {void}
 */
export function computeCounts(game) {
  for (let i = 0; i < game.size; i++) {
    if (game.mines[i] === 1) {
      game.counts[i] = 0;
      continue;
    }
    let n = 0;
    for (const nb of neighborsOf(game, i)) {
      if (game.mines[nb] === 1) n++;
    }
    game.counts[i] = n;
  }
}
