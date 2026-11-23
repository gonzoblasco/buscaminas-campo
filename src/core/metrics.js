// src/core/metrics.js - Community metrics: 3BV, 3BV/s and efficiency.
//
// 3BV (Bechtel's Board Benchmark Value) is the minimum number of left clicks
// needed to clear the board with perfect play and no flags. Community averages
// for the standard presets are ~15 (beginner), ~65 (intermediate), ~174 (expert).

import { neighborsOf } from './board.js';

/** @typedef {import('./game.js').Game} Game */

/**
 * Number of zero-regions plus numbered cells not adjacent to any zero cell.
 * @param {Game} game
 * @returns {number} 0 until mines are placed
 */
export function threeBV(game) {
  if (!game.minesPlaced) return 0;

  const isZero = (i) => game.mines[i] === 0 && game.counts[i] === 0;
  const seen = new Set();
  let regions = 0;
  const adjacentToZero = new Set();

  for (let i = 0; i < game.size; i++) {
    if (!isZero(i) || seen.has(i)) continue;
    regions++;
    const stack = [i];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const n of neighborsOf(game, cur)) {
        adjacentToZero.add(n);
        if (game.mines[n] === 0 && isZero(n)) stack.push(n);
      }
    }
  }

  let numbered = 0;
  for (let i = 0; i < game.size; i++) {
    if (game.mines[i] === 1) continue;
    if (game.counts[i] === 0) continue;
    if (adjacentToZero.has(i)) continue;
    numbered++;
  }

  return regions + numbered;
}

/**
 * Efficiency: 3BV divided by clicks, as a percentage. Above 100% is possible with
 * skilled chording, because one chord click can clear several 3BV units.
 * @param {Game} game
 * @returns {number|null} null before the first click
 */
export function efficiency(game) {
  if (game.clicks === 0) return null;
  return (threeBV(game) / game.clicks) * 100;
}

/**
 * 3BV per second, the community speed metric.
 * @param {Game} game
 * @param {number} seconds
 * @returns {number|null}
 */
export function threeBVPerSecond(game, seconds) {
  if (!seconds || seconds <= 0) return null;
  return threeBV(game) / seconds;
}

/**
 * Minimum clicks for the board, for the trainer to show the target.
 * Same value as 3BV; named separately so the UI reads clearly.
 * @param {Game} game
 * @returns {number}
 */
export function minimumClicks(game) {
  return threeBV(game);
}
