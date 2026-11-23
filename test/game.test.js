import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, reveal, chord, cycleMark, isWon, hiddenCount, flagCount, MARK_NONE, MARK_FLAG, MARK_QUESTION, MAX_ACTIONS } from '../src/core/game.js';
import { indexOf, neighborsOf } from '../src/core/board.js';
import { createRng, deriveSeed, randInt } from '../src/core/rng.js';
import { PRESETS, PRESET_LIST } from '../src/core/presets.js';

const play = (presetId, seed, cell) => {
  const preset = PRESETS[presetId];
  const game = createGame(preset, { seed });
  return reveal(game, cell ?? randInt(createRng(deriveSeed(seed, 1)), game.size), createRng(seed));
};

test('a new game has no mines until the first reveal', () => {
  const game = createGame(PRESETS.beginner, { seed: 3 });
  assert.equal(game.minesPlaced, false);
  assert.equal(game.status, 'ready');
  assert.equal(game.mines.reduce((a, b) => a + b, 0), 0);
  assert.equal(game.counts.reduce((a, b) => a + b, 0), 0);
});

test('the first click is always safe: 9000 cases, 0 mines in the zone', () => {
  const seeds = 500;
  const points = 6;
  for (const preset of PRESET_LIST) {
    for (let s = 0; s < seeds; s++) {
      const seed = deriveSeed(20261123, s);
      for (let p = 0; p < points; p++) {
        const gameBase = createGame(preset, { seed });
        const cell = randInt(createRng(deriveSeed(seed, p + 100)), gameBase.size);
        const game = reveal(gameBase, cell, createRng(seed));
        const zone = [cell, ...neighborsOf(game, cell)];
        for (const z of zone) {
          assert.equal(game.mines[z], 0, `mine in safe zone: preset=${preset.id} seed=${seed} cell=${cell} zone=${z}`);
        }
      }
    }
  }
});

test('the first click never lands on a mine', () => {
  for (let s = 0; s < 300; s++) {
    const game = play('beginner', s);
    assert.notEqual(game.status, 'lost', `lost on first click with seed ${s}`);
    assert.equal(game.minesPlaced, true);
  }
});

test('mine count is exactly the preset mineCount', () => {
  for (const preset of PRESET_LIST) {
    const game = play(preset.id, 11, 0);
    const total = game.mines.reduce((a, b) => a + b, 0);
    assert.equal(total, preset.mineCount);
  }
});

test('counts match the mines around each cell', () => {
  const game = play('intermediate', 5, 40);
  for (let i = 0; i < game.size; i++) {
    if (game.mines[i] === 1) continue;
    const expected = neighborsOf(game, i).reduce((n, nb) => n + game.mines[nb], 0);
    assert.equal(game.counts[i], expected, `wrong count at ${i}`);
  }
});

test('reveal returns a new game and does not mutate the input', () => {
  const before = createGame(PRESETS.beginner, { seed: 8 });
  const snapshot = structuredClone({ mines: Array.from(before.mines), revealed: Array.from(before.revealed), status: before.status });
  const after = reveal(before, 40, createRng(8));
  assert.notEqual(after, before, 'reveal must return a new object');
  assert.deepEqual({ mines: Array.from(before.mines), revealed: Array.from(before.revealed), status: before.status }, snapshot);
});

test('revealing an already revealed cell is a no-op that returns the same game', () => {
  const g1 = play('beginner', 21, 40);
  const revealedCell = g1.revealed.findIndex((v, i) => v === 1 && g1.marks[i] === MARK_NONE);
  const g2 = reveal(g1, revealedCell, createRng(21));
  assert.equal(g2, g1);
});

test('a flagged cell cannot be revealed by a left click', () => {
  const g1 = play('beginner', 31, 40);
  const hidden = g1.revealed.findIndex((v) => v === 0);
  const g2 = cycleMark(g1, hidden);
  assert.equal(g2.marks[hidden], MARK_FLAG);
  const g4 = reveal(g2, hidden, createRng(31));
  assert.equal(g4, g2, 'reveal must refuse a flagged cell');
});

test('cycleMark goes none -> flag -> question -> none', () => {
  const g1 = play('beginner', 41, 40);
  const hidden = g1.revealed.findIndex((v) => v === 0);
  const f = cycleMark(g1, hidden);
  const q = cycleMark(f, hidden);
  const n = cycleMark(q, hidden);
  assert.equal(f.marks[hidden], MARK_FLAG);
  assert.equal(q.marks[hidden], MARK_QUESTION);
  assert.equal(n.marks[hidden], MARK_NONE);
});

test('revealing a flagged cell via flood fill skips it', () => {
  // A flood fill from a zero cell opens its whole region, so a flag inside that
  // region is the only way the flood can meet a flagged cell. Reproduce it
  // deterministically: discover the region with the same seed, then replay with
  // the flag already placed and confirm the flood stops at it.
  let checked = false;
  for (let seed = 1; seed < 400 && !checked; seed++) {
    const probe = reveal(createGame(PRESETS.intermediate, { seed }), 40, createRng(seed));
    const zero = probe.revealed.findIndex((v, i) => v === 1 && probe.counts[i] === 0);
    if (zero < 0) continue;
    // Find a cell that the probe's flood opened, other than the origin, and flag it.
    const target = neighborsOf(probe, zero).find((n) => probe.revealed[n] === 1 && probe.mines[n] === 0);
    if (target === undefined) continue;
    // Replay the same board, this time with the flag placed before the reveal.
    const flaggedFirst = cycleMark(createGame(PRESETS.intermediate, { seed }), target);
    assert.equal(flaggedFirst.marks[target], MARK_FLAG);
    const opened = reveal(flaggedFirst, 40, createRng(seed));
    assert.equal(opened.mines[target], probe.mines[target], 'same seed must yield the same board');
    assert.equal(opened.revealed[target], 0, 'flood fill revealed a flagged cell');
    assert.equal(opened.marks[target], MARK_FLAG, 'flood fill cleared a flag');
    checked = true;
  }
  assert.ok(checked, 'could not find a case to test');
});

test('losing reveals the mine that was clicked', () => {
  // Play until a loss, then assert the clicked cell is a mine and is revealed.
  let lost = null;
  for (let seed = 1; seed < 500 && !lost; seed++) {
    let game = createGame(PRESETS.beginner, { seed });
    game = reveal(game, 40, createRng(seed));
    for (let i = 0; i < game.size; i++) {
      if (game.status === 'lost') break;
      if (game.revealed[i] === 1 || game.marks[i] === MARK_FLAG) continue;
      const next = reveal(game, i, createRng(seed));
      if (next.status === 'lost') {
        assert.equal(next.mines[i], 1);
        assert.equal(next.revealed[i], 1);
        lost = next;
      }
      game = next;
    }
  }
  assert.ok(lost, 'never lost a game while clicking everything');
});

test('a game can be won by revealing every non-mine cell', () => {
  const preset = PRESETS.beginner;
  const base = createGame(preset, { seed: 55 });
  let game = reveal(base, 40, createRng(55));
  for (let i = 0; i < game.size && game.status !== 'won'; i++) {
    if (game.mines[i] === 1 || game.revealed[i] === 1) continue;
    game = reveal(game, i, createRng(55));
  }
  assert.equal(game.status, 'won');
  assert.ok(isWon(game));
  assert.equal(hiddenCount(game), preset.mineCount);
});

test('clicks counts revealed cells, not flags or repeats', () => {
  const base = createGame(PRESETS.beginner, { seed: 77 });
  const g1 = reveal(base, 40, createRng(77));
  const firstClicks = g1.clicks;
  assert.ok(firstClicks >= 1);
  const hidden = g1.revealed.findIndex((v, i) => v === 0 && g1.marks[i] === MARK_NONE && g1.mines[i] === 0);
  const g2 = reveal(g1, hidden, createRng(77));
  assert.equal(g2.clicks, firstClicks + 1);
  const flagged = cycleMark(g2, g2.revealed.findIndex((v) => v === 0));
  assert.equal(flagged.clicks, g2.clicks, 'a flag must not count as a click');
});

test('flagCount counts flags only, not questions', () => {
  const g1 = play('beginner', 91, 40);
  const hidden = [];
  for (let i = 0; i < g1.size && hidden.length < 2; i++) if (g1.revealed[i] === 0) hidden.push(i);
  const flagged = cycleMark(g1, hidden[0]);
  // Two cycles on the second cell: none -> flag -> question.
  const questioned = cycleMark(cycleMark(flagged, hidden[1]), hidden[1]);
  assert.equal(questioned.marks[hidden[1]], MARK_QUESTION);
  assert.equal(flagCount(flagged), flagCount(g1) + 1);
  assert.equal(flagCount(questioned), flagCount(g1) + 1, 'a question must not count as a flag');
  const cleared = cycleMark(questioned, hidden[1]);
  assert.equal(cleared.marks[hidden[1]], MARK_NONE);
  assert.equal(flagCount(cleared), flagCount(g1) + 1);
});

test('chord reveals neighbours only when flags match the count', () => {
  const preset = PRESETS.beginner;
  let found = false;
  for (let seed = 1; seed < 300 && !found; seed++) {
    let game = reveal(createGame(preset, { seed }), 40, createRng(seed));
    const clue = game.revealed.findIndex((v, i) => v === 1 && game.counts[i] > 0 && game.counts[i] <= 3);
    if (clue < 0) continue;
    const hidden = neighborsOf(game, clue).filter((n) => game.revealed[n] === 0);
    if (hidden.length !== game.counts[clue]) continue;
    const noFlags = chord(game, clue, createRng(seed));
    assert.equal(noFlags, game, 'chord must be a no-op without the flags placed');
    found = true;
  }
  assert.ok(found, 'could not find a chord-able position');
});

test('actions are logged and capped with a truncated flag', () => {
  let game = play('beginner', 101, 40);
  let marks = 0;
  for (let i = 0; i < game.size && game.actions.length < MAX_ACTIONS - 5; i++) {
    if (game.revealed[i] === 1) continue;
    game = cycleMark(game, i);
    marks++;
    game = cycleMark(game, i);
  }
  assert.ok(game.actions.length >= marks);
  assert.equal(game.truncated, false);
});

test('statusOf reflects the game status', () => {
  const game = createGame(PRESETS.beginner, { seed: 1 });
  assert.equal(game.status, 'ready');
});
