import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage shim: the persistence module probes for it.
class MemoryStorage {
  constructor(seed = {}) {
    this.map = new Map(Object.entries(seed));
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

function withStorage(seed) {
  const store = new MemoryStorage(seed);
  globalThis.localStorage = store;
  return store;
}

function dropStorage() {
  delete globalThis.localStorage;
}

const freshImport = async () => {
  // Re-import with a cache-busting query so module state is not shared.
  const mod = await import(`../src/ui/persistence.js?t=${Math.random()}`);
  return mod;
};

test('settings default to the no-guess mode', async () => {
  withStorage();
  const p = await freshImport();
  const s = p.loadSettings();
  assert.equal(s.mode, 'noguess', 'the game must start in no-guess mode');
  assert.equal(s.showWhy, false);
  dropStorage();
});

test('settings round-trip and survive a reload', async () => {
  withStorage();
  const p = await freshImport();
  p.saveSettings({ mode: 'classic', preset: 'expert', showWhy: true });
  const reloaded = (await freshImport()).loadSettings();
  assert.equal(reloaded.mode, 'classic');
  assert.equal(reloaded.preset, 'expert');
  assert.equal(reloaded.showWhy, true);
  dropStorage();
});

test('invalid settings are rejected, not stored blindly', async () => {
  withStorage({ 'bc.settings.v2': JSON.stringify({ mode: 'bogus', showWhy: 'yes', preset: 42 }) });
  const p = await freshImport();
  const s = p.loadSettings();
  assert.equal(s.mode, 'noguess', 'invalid mode must fall back to the default');
  assert.equal(s.showWhy, false);
  assert.equal(typeof s.preset, 'string');
  dropStorage();
});

test('records are separated by mode: noguess and classic never mix', async () => {
  withStorage();
  const p = await freshImport();
  const base = { presetId: 'beginner', hintsUsed: 0, timeMs: 5000, threeBV: 12, clicks: 14, efficiency: 85.7 };
  p.recordWin({ ...base, mode: 'noguess' });
  p.recordWin({ ...base, mode: 'classic', timeMs: 3000 });
  const ng = p.bestRecords('beginner', 'noguess');
  const cl = p.bestRecords('beginner', 'classic');
  assert.equal(ng.clean.timeMs, 5000);
  assert.equal(cl.clean.timeMs, 3000);
  dropStorage();
});

test('a hinted win lands in the hinted bucket and leaves the clean record intact', async () => {
  withStorage();
  const p = await freshImport();
  const clean = { presetId: 'beginner', mode: 'noguess', hintsUsed: 0, timeMs: 9000, threeBV: 12, clicks: 13, efficiency: 92 };
  p.recordWin(clean);
  const hinted = { presetId: 'beginner', mode: 'noguess', hintsUsed: 3, timeMs: 4000, threeBV: 12, clicks: 15, efficiency: 80 };
  const res = p.recordWin(hinted);
  assert.equal(res.bucket, 'hinted', 'a hinted win must not compete in the clean bucket');
  const rec = p.bestRecords('beginner', 'noguess');
  assert.equal(rec.clean.timeMs, 9000, 'the clean record must be untouched by a hinted win');
  assert.equal(rec.hinted.timeMs, 4000, 'the hinted record must be recorded, not discarded');
  assert.equal(rec.hinted.hintsUsed, 3);
  dropStorage();
});

test('a hinted win must never overwrite a clean record (the product decision)', async () => {
  withStorage();
  const p = await freshImport();
  p.recordWin({ presetId: 'intermediate', mode: 'noguess', hintsUsed: 0, timeMs: 30000, threeBV: 60, clicks: 70, efficiency: 85 });
  p.recordWin({ presetId: 'intermediate', mode: 'noguess', hintsUsed: 1, timeMs: 1000, threeBV: 60, clicks: 61, efficiency: 98 });
  const rec = p.bestRecords('intermediate', 'noguess');
  assert.equal(rec.clean.timeMs, 30000, 'a faster hinted run must not replace the clean record');
  assert.equal(rec.hinted.timeMs, 1000);
  dropStorage();
});

test('only a faster run replaces a record', async () => {
  withStorage();
  const p = await freshImport();
  const base = { presetId: 'beginner', mode: 'noguess', hintsUsed: 0, threeBV: 10, clicks: 12, efficiency: 83 };
  p.recordWin({ ...base, timeMs: 5000 });
  const slower = p.recordWin({ ...base, timeMs: 8000 });
  assert.equal(slower.improved, false, 'a slower run must not replace the record');
  const faster = p.recordWin({ ...base, timeMs: 4000 });
  assert.equal(faster.improved, true);
  assert.equal(p.bestRecords('beginner', 'noguess').clean.timeMs, 4000);
  dropStorage();
});

test('a corrupt records blob does not break the loader', async () => {
  withStorage({ 'bc.records.v2': '{{{not json' });
  const p = await freshImport();
  const rec = p.loadRecords();
  assert.deepEqual(rec, {});
  const best = p.bestRecords('beginner', 'noguess');
  assert.equal(best.clean, null);
  dropStorage();
});

test('migration from schema 1 keeps classic records and adds the mode dimension', async () => {
  withStorage({
    'bc.schema': '1',
    'bc.records': JSON.stringify({ beginner: { timeMs: 7000, threeBV: 11, clicks: 12, efficiency: 91, hintsUsed: 0, at: '2026-01-01T00:00:00.000Z' } }),
    'bc.settings': JSON.stringify({ preset: 'beginner', showWhy: true }),
  });
  const p = await freshImport();
  const records = p.loadRecords();
  assert.equal(records.beginner.classic.clean.timeMs, 7000, 'v1 records must survive as classic records');
  assert.equal(records.beginner.noguess.clean, null, 'a v1 record was not a no-guess record');
  const settings = p.loadSettings();
  assert.equal(settings.mode, 'noguess', 'migration must add the default mode');
  assert.equal(settings.showWhy, true, 'existing settings must be preserved');
  dropStorage();
});

test('an unknown schema version is discarded, not guessed at', async () => {
  withStorage({ 'bc.schema': '99', 'bc.records.v2': JSON.stringify({ beginner: { noguess: { clean: { timeMs: 'nonsense' } } } }) });
  const p = await freshImport();
  const records = p.loadRecords();
  assert.deepEqual(records, {});
  dropStorage();
});

test('game snapshot round-trips including typed arrays', async () => {
  withStorage();
  const p = await freshImport();
  const { createGame, reveal } = await import('../src/core/game.js');
  const { createRng } = await import('../src/core/rng.js');
  const { PRESETS } = await import('../src/core/presets.js');
  const opening = reveal(createGame(PRESETS.beginner, { seed: 12 }), 40, createRng(12));
  const snapshot = { presetId: 'beginner', mode: 'noguess', fellBack: false, elapsedMs: 1234, game: opening };
  p.saveGame(snapshot);
  const loaded = p.loadGame();
  assert.ok(loaded);
  assert.equal(loaded.presetId, 'beginner');
  assert.equal(loaded.mode, 'noguess');
  assert.equal(loaded.elapsedMs, 1234);
  assert.deepEqual(Array.from(loaded.game.mines), Array.from(opening.mines));
  assert.deepEqual(Array.from(loaded.game.revealed), Array.from(opening.revealed));
  assert.equal(loaded.game.size, opening.size);
  dropStorage();
});

test('a corrupt game blob returns null instead of throwing', async () => {
  withStorage({ 'bc.game.v2': '{ broken' });
  const p = await freshImport();
  assert.equal(p.loadGame(), null);
  dropStorage();
});

test('without storage the game still works in memory', async () => {
  dropStorage();
  const p = await freshImport();
  const s = p.loadSettings();
  assert.equal(s.mode, 'noguess');
  const res = p.recordWin({ presetId: 'beginner', mode: 'noguess', hintsUsed: 0, timeMs: 1000, threeBV: 5, clicks: 6, efficiency: 83 });
  assert.equal(res.improved, true, 'without storage a win still counts for the session');
  dropStorage();
});
