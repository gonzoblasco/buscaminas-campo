import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, deriveSeed, randInt, shuffle } from '../src/core/rng.js';

test('createRng yields values in [0,1)', () => {
  const rng = createRng(12345);
  for (let i = 0; i < 1000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `value out of range: ${v}`);
  }
});

test('same seed produces the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 500; i++) assert.equal(a.next(), b.next());
});

test('different seeds produce different sequences', () => {
  const a = createRng(1);
  const b = createRng(2);
  let same = 0;
  for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
  assert.ok(same < 5, `sequences too similar: ${same} equal positions`);
});

test('seed 0 is not degenerate', () => {
  const rng = createRng(0);
  const values = new Set();
  for (let i = 0; i < 50; i++) values.add(rng.next());
  assert.ok(values.size > 40, `seed 0 collapsed to ${values.size} values`);
});

test('deriveSeed is deterministic and changes with n', () => {
  assert.equal(deriveSeed(100, 3), deriveSeed(100, 3));
  const seeds = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => deriveSeed(100, n)));
  assert.equal(seeds.size, 10, 'derived seeds collided');
});

test('deriveSeed returns 32-bit unsigned values', () => {
  for (let n = 0; n < 200; n++) {
    const s = deriveSeed(20261123, n);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff, `bad seed ${s}`);
  }
});

test('randInt stays within bounds and is roughly uniform', () => {
  const rng = createRng(7);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 10000; i++) {
    const v = randInt(rng, 10);
    assert.ok(v >= 0 && v < 10, `out of bounds ${v}`);
    buckets[v]++;
  }
  for (const count of buckets) {
    assert.ok(count > 800 && count < 1200, `bucket uneven: ${buckets.join(',')}`);
  }
});

test('shuffle is a permutation and in place', () => {
  const rng = createRng(99);
  const original = Array.from({ length: 200 }, (_, i) => i);
  const array = original.slice();
  const result = shuffle(array, rng);
  assert.equal(result, array, 'shuffle must return the same array reference');
  assert.deepEqual(array.slice().sort((a, b) => a - b), original, 'not a permutation');
});

test('shuffle with the same seed is deterministic', () => {
  const a = shuffle(Array.from({ length: 50 }, (_, i) => i), createRng(5));
  const b = shuffle(Array.from({ length: 50 }, (_, i) => i), createRng(5));
  assert.deepEqual(a, b);
});
