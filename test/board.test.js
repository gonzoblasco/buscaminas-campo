import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/core/game.js';
import { neighborsOf, safeZoneOf, xOf, yOf, indexOf } from '../src/core/board.js';
import { PRESETS, PRESET_LIST, presetOf, validatePreset } from '../src/core/presets.js';

const g = (preset = PRESETS.intermediate) => createGame(preset, { seed: 1 });

test('every preset satisfies the safe-zone invariant', () => {
  for (const p of PRESET_LIST) assert.ok(validatePreset(p), `${p.id} is invalid`);
});

test('presetOf throws on unknown id', () => {
  assert.throws(() => presetOf('nope'), RangeError);
});

test('preset ids are the community names, not easy/medium/hard', () => {
  assert.deepEqual(Object.keys(PRESETS).sort(), ['beginner', 'expert', 'intermediate']);
});

test('board has one entry per cell and the right dimensions', () => {
  const game = g();
  assert.equal(game.size, 16 * 16);
  assert.equal(game.mines.length, game.size);
  assert.equal(game.revealed.length, game.size);
  assert.equal(game.marks.length, game.size);
});

test('neighborsOf returns only in-bounds cells, never the cell itself', () => {
  const game = g();
  for (let i = 0; i < game.size; i++) {
    const ns = neighborsOf(game, i);
    assert.ok(!ns.includes(i), 'a cell is its own neighbour');
    for (const n of ns) assert.ok(n >= 0 && n < game.size, 'neighbour out of bounds');
  }
});

test('corner has 3 neighbours, edge 5, interior 8', () => {
  const game = g();
  assert.equal(neighborsOf(game, indexOf(game, 0, 0)).length, 3);
  assert.equal(neighborsOf(game, indexOf(game, 0, 5)).length, 5);
  assert.equal(neighborsOf(game, indexOf(game, 5, 5)).length, 8);
  assert.equal(neighborsOf(game, indexOf(game, 15, 15)).length, 3);
});

test('xOf and yOf invert indexOf', () => {
  const game = g(PRESETS.expert);
  for (let i = 0; i < game.size; i++) {
    assert.equal(indexOf(game, xOf(game, i), yOf(game, i)), i);
  }
});

test('safeZoneOf covers the cell and its neighbours, at most 9', () => {
  const game = g();
  for (const i of [0, 5, indexOf(game, 8, 8), game.size - 1]) {
    const zone = safeZoneOf(game, i);
    assert.ok(zone.has(i));
    for (const n of neighborsOf(game, i)) assert.ok(zone.has(n));
    assert.ok(zone.size >= 3 && zone.size <= 9, `zone size ${zone.size}`);
  }
});

test('neighborsOf does not mutate the caller game (the v1 bug)', () => {
  const game = g();
  const snapshot = structuredClone({
    width: game.width,
    height: game.height,
    size: game.size,
    mines: Array.from(game.mines),
  });
  for (let i = 0; i < game.size; i++) neighborsOf(game, i);
  const after = {
    width: game.width,
    height: game.height,
    size: game.size,
    mines: Array.from(game.mines),
  };
  assert.deepEqual(after, snapshot, 'neighborsOf mutated the game it was given');
  const extraKeys = Object.keys(game).filter((k) => !['width', 'height', 'size', 'mineCount', 'seed', 'mines', 'counts', 'revealed', 'marks', 'minesPlaced', 'status', 'clicks', 'hintsUsed', 'actions', 'truncated'].includes(k));
  assert.deepEqual(extraKeys, [], `neighborsOf wrote cache fields onto the game: ${extraKeys}`);
});
