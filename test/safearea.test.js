import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, reveal } from '../src/core/game.js';
import { safeZoneOf, neighborsOf } from '../src/core/board.js';
import { PRESETS, PRESET_LIST } from '../src/core/presets.js';
import { createRng, deriveSeed, randInt } from '../src/core/rng.js';

test('the safe zone grows with the setting: 1x1 < 3x3 < 5x5', () => {
  const game = createGame(PRESETS.beginner, { seed: 3 });
  const centre = 4 * 9 + 4; // a cell with room on every side
  assert.equal(safeZoneOf(game, centre, '1x1').size, 1);
  assert.equal(safeZoneOf(game, centre, '3x3').size, 9);
  assert.equal(safeZoneOf(game, centre, '5x5').size, 25);
});

test('the default area is 3x3, which is what the product has always done', () => {
  const game = createGame(PRESETS.beginner, { seed: 3 });
  const centre = 4 * 9 + 4;
  assert.deepEqual([...safeZoneOf(game, centre)].sort(), [...safeZoneOf(game, centre, '3x3')].sort());
});

test('a corner zone is clipped to the board, never out of bounds', () => {
  const game = createGame(PRESETS.beginner, { seed: 3 });
  for (const [cell, expected] of [
    [0, 9], // corner: a 5x5 clipped to the board is 3x3
    [4, 15], // top edge middle: 5 wide x 3 tall
    [8 * 9 + 4, 15], // bottom edge middle, same
  ]) {
    const zone = safeZoneOf(game, cell, '5x5');
    assert.equal(zone.size, expected, `cell ${cell} produced ${zone.size} cells`);
    for (const c of zone) assert.ok(c >= 0 && c < game.size);
  }
});

test('every area keeps mines out of the zone: 300 cases per area', () => {
  for (const area of ['1x1', '3x3', '5x5']) {
    for (const preset of PRESET_LIST) {
      for (let s = 0; s < 100; s++) {
        const seed = deriveSeed(20261123, s + area.length);
        const probe = createGame(preset, { seed });
        const cell = randInt(createRng(deriveSeed(seed, 11)), probe.size);
        const game = reveal(probe, cell, createRng(seed), { firstClickArea: area });
        for (const c of safeZoneOf(game, cell, area)) {
          assert.equal(game.mines[c], 0, `area ${area} left a mine in the zone (${preset.id}, seed ${s})`);
        }
      }
    }
  }
});

test('a larger area opens at least as much board as a smaller one', () => {
  // Same seed, same cell: the 5x5 zone must reveal at least what 3x3 reveals,
  // because its zero region can only be larger or equal.
  const preset = PRESETS.intermediate;
  let comparisons = 0;
  const opened = (area) => {
    const probe = createGame(preset, { seed: 777 });
    const game = reveal(probe, 8 * 16 + 8, createRng(777), { firstClickArea: area });
    return Array.from(game.revealed).filter((v) => v === 1).length;
  };
  const a1 = opened('1x1');
  const a3 = opened('3x3');
  const a5 = opened('5x5');
  assert.ok(a3 >= 1 && a5 >= 1);
  assert.ok(a5 >= a1, `5x5 opened ${a5}, 1x1 opened ${a1}`);
  comparisons++;
  assert.equal(comparisons, 1);
});

test('the area setting changes the opening, so it is not a dead setting', () => {
  // The regression this locks: firstClickArea was persisted and never read.
  const preset = PRESETS.intermediate;
  const cell = 8 * 16 + 8;
  const sizes = ['1x1', '3x3', '5x5'].map((area) => {
    const probe = createGame(preset, { seed: 4242 });
    const game = reveal(probe, cell, createRng(4242), { firstClickArea: area });
    return new Set(safeZoneOf(game, cell, area)).size;
  });
  assert.equal(new Set(sizes).size, 3, `the three areas produced ${sizes.join(',')} cells: the setting is inert`);
  assert.deepEqual(sizes, [1, 9, 25]);
});
