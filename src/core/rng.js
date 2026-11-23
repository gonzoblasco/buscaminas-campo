// src/core/rng.js - Deterministic pseudo-random number generator.
// mulberry32: small, fast, deterministic for a given seed, good enough for
// mine placement. No crypto requirements.

/**
 * @typedef {Object} Rng
 * @property {() => number} next  Returns a float in [0, 1).
 */

/**
 * Create a deterministic RNG from a 32-bit seed.
 * @param {number} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  let state = (seed >>> 0) || 1;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return { next };
}

/**
 * Derive a new seed from a base seed and an attempt counter.
 * Used by the no-guess generator to retry deterministically.
 * @param {number} seed
 * @param {number} n
 * @returns {number}
 */
export function deriveSeed(seed, n) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (n + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Uniform integer in [0, maxExclusive).
 * @param {Rng} rng
 * @param {number} maxExclusive
 * @returns {number}
 */
export function randInt(rng, maxExclusive) {
  return Math.floor(rng.next() * maxExclusive);
}

/**
 * Fisher-Yates shuffle, in place.
 * @template T
 * @param {T[]} array
 * @param {Rng} rng
 * @returns {T[]} the same array
 */
export function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}
