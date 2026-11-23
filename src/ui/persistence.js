// src/ui/persistence.js - Local storage: settings, in-progress game, records.
//
// The records model is a product decision with a reason, not an accident:
// records are separated by MODE (noguess | classic) and by HINT USE (clean |
// hinted). A hint never invalidates a record; it files it in the other bucket.
// The reasoning lives in .knowledge/BRIEF.md: the hint is the product's
// differentiator, so punishing it would push players away from the feature.

import { createGame, cloneGame } from '../core/game.js';

export const SCHEMA_VERSION = 2;
const PREFIX = 'bc.';

const KEYS = {
  schema: `${PREFIX}schema`,
  settings: `${PREFIX}settings.v${SCHEMA_VERSION}`,
  game: `${PREFIX}game.v${SCHEMA_VERSION}`,
  records: `${PREFIX}records.v${SCHEMA_VERSION}`,
};

export const DEFAULT_SETTINGS = {
  mode: 'noguess',
  preset: 'beginner',
  showWhy: false,
  firstClickArea: '3x3',
};

/**
 * @typedef {Object} Settings
 * @property {'noguess'|'classic'} mode
 * @property {string} preset
 * @property {boolean} showWhy
 * @property {'1x1'|'3x3'|'5x5'} firstClickArea
 */

/**
 * @typedef {Object} Record
 * @property {number} timeMs
 * @property {number} threeBV
 * @property {number} clicks
 * @property {number} efficiency
 * @property {number} hintsUsed
 * @property {string} at  ISO date
 */

/** @returns {Storage|null} */
function storageOf() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = `${PREFIX}probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Read JSON with a fallback, so a corrupted entry never breaks the app.
 * @param {Storage} store
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
function readJson(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {Storage} store
 * @param {string} key
 * @param {*} value
 * @returns {void}
 */
function writeJson(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the game keeps working without persistence.
  }
}

/**
 * Migrate older schemas. v1 stored `bc.records` without the mode dimension and
 * `bc.settings` without `mode`. Anything unrecognised is discarded: a fresh
 * start beats a corrupted save.
 * @param {Storage} store
 * @returns {void}
 */
export function migrate(store) {
  const version = Number(store.getItem(KEYS.schema) ?? '0');
  if (version === SCHEMA_VERSION) return;

  if (version === 1) {
    // v1: flat records keyed by preset only, and settings without a mode.
    const oldRecords = readJson(store, 'bc.records', null);
    const migrated = {};
    if (oldRecords && typeof oldRecords === 'object') {
      for (const [preset, rec] of Object.entries(oldRecords)) {
        if (!rec || typeof rec !== 'object') continue;
        migrated[preset] = {
          noguess: { clean: null, hinted: null },
          classic: { clean: sanitizeRecord(rec), hinted: null },
        };
      }
    }
    writeJson(store, KEYS.records, migrated);
    const oldSettings = readJson(store, 'bc.settings', {});
    writeJson(store, KEYS.settings, { ...DEFAULT_SETTINGS, ...sanitizeSettings(oldSettings) });
  } else if (version !== SCHEMA_VERSION) {
    // Unknown or absent version: start clean rather than guess at the shape.
    writeJson(store, KEYS.records, {});
    writeJson(store, KEYS.settings, { ...DEFAULT_SETTINGS });
  }
  store.setItem(KEYS.schema, String(SCHEMA_VERSION));
}

/**
 * @param {*} r
 * @returns {Record|null}
 */
function sanitizeRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const { timeMs, threeBV, clicks, efficiency, hintsUsed, at } = r;
  if (!Number.isFinite(timeMs) || timeMs <= 0) return null;
  return {
    timeMs,
    threeBV: Number.isFinite(threeBV) ? threeBV : 0,
    clicks: Number.isFinite(clicks) ? clicks : 0,
    efficiency: Number.isFinite(efficiency) ? efficiency : 0,
    hintsUsed: Number.isFinite(hintsUsed) ? hintsUsed : 0,
    at: typeof at === 'string' ? at : new Date().toISOString(),
  };
}

/**
 * @param {*} s
 * @returns {Partial<Settings>}
 */
function sanitizeSettings(s) {
  if (!s || typeof s !== 'object') return {};
  const out = {};
  if (s.mode === 'noguess' || s.mode === 'classic') out.mode = s.mode;
  if (typeof s.preset === 'string') out.preset = s.preset;
  if (typeof s.showWhy === 'boolean') out.showWhy = s.showWhy;
  if (s.firstClickArea === '1x1' || s.firstClickArea === '3x3' || s.firstClickArea === '5x5') {
    out.firstClickArea = s.firstClickArea;
  }
  return out;
}

/**
 * Load settings, migrating first. Always returns a complete object.
 * @returns {Settings}
 */
export function loadSettings() {
  const store = storageOf();
  if (!store) return { ...DEFAULT_SETTINGS };
  migrate(store);
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(readJson(store, KEYS.settings, {})) };
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Settings}
 */
export function saveSettings(patch) {
  const current = loadSettings();
  const next = { ...current, ...sanitizeSettings(patch) };
  const store = storageOf();
  if (store) writeJson(store, KEYS.settings, next);
  return next;
}

/**
 * @typedef {Object} GameSnapshot
 * @property {string} presetId
 * @property {'noguess'|'classic'} mode
 * @property {boolean} fellBack
 * @property {number} elapsedMs
 * @property {ReturnType<typeof cloneGame>} game
 */

/**
 * Serialise a game. Typed arrays become plain arrays for JSON.
 * @param {GameSnapshot} snapshot
 * @returns {string}
 */
export function serializeGame(snapshot) {
  return JSON.stringify({
    presetId: snapshot.presetId,
    mode: snapshot.mode,
    fellBack: snapshot.fellBack,
    elapsedMs: snapshot.elapsedMs,
    game: {
      ...cloneGame(snapshot.game),
      mines: Array.from(snapshot.game.mines),
      counts: Array.from(snapshot.game.counts),
      revealed: Array.from(snapshot.game.revealed),
      marks: Array.from(snapshot.game.marks),
    },
  });
}

/**
 * @param {string} raw
 * @returns {GameSnapshot|null}
 */
export function deserializeGame(raw) {
  try {
    const data = JSON.parse(raw);
    if (!data || !data.game) return null;
    const g = data.game;
    if (!Number.isInteger(g.width) || !Number.isInteger(g.height)) return null;
    const game = {
      ...createGame({ width: g.width, height: g.height, mineCount: g.mineCount }, { seed: g.seed }),
      mines: Uint8Array.from(g.mines ?? []),
      counts: Uint8Array.from(g.counts ?? []),
      revealed: Uint8Array.from(g.revealed ?? []),
      marks: Uint8Array.from(g.marks ?? []),
      minesPlaced: Boolean(g.minesPlaced),
      status: g.status ?? 'ready',
      clicks: Number(g.clicks ?? 0),
      hintsUsed: Number(g.hintsUsed ?? 0),
      actions: Array.isArray(g.actions) ? g.actions : [],
      truncated: Boolean(g.truncated),
    };
    if (game.mines.length !== game.size) return null;
    return {
      presetId: String(data.presetId ?? 'beginner'),
      mode: data.mode === 'classic' ? 'classic' : 'noguess',
      fellBack: Boolean(data.fellBack),
      elapsedMs: Number(data.elapsedMs ?? 0),
      game,
    };
  } catch {
    return null;
  }
}

/** @returns {GameSnapshot|null} */
export function loadGame() {
  const store = storageOf();
  if (!store) return null;
  migrate(store);
  const raw = store.getItem(KEYS.game);
  return raw ? deserializeGame(raw) : null;
}

/**
 * @param {GameSnapshot} snapshot
 * @returns {void}
 */
export function saveGame(snapshot) {
  const store = storageOf();
  if (!store) return;
  try {
    store.setItem(KEYS.game, serializeGame(snapshot));
  } catch {
    // ignore
  }
}

export function clearGame() {
  const store = storageOf();
  if (store) store.removeItem(KEYS.game);
}

/**
 * @typedef {Object} RecordBuckets
 * @property {{clean: Record|null, hinted: Record|null}} noguess
 * @property {{clean: Record|null, hinted: Record|null}} classic
 */

/**
 * @returns {Record<string, RecordBuckets>}
 */
export function loadRecords() {
  const store = storageOf();
  if (!store) return {};
  migrate(store);
  const raw = readJson(store, KEYS.records, {});
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [preset, buckets] of Object.entries(raw)) {
    const nb = /** @type {RecordBuckets} */ ({
      noguess: { clean: null, hinted: null },
      classic: { clean: null, hinted: null },
    });
    if (buckets && typeof buckets === 'object') {
      for (const mode of ['noguess', 'classic']) {
        for (const bucket of ['clean', 'hinted']) {
          const rec = buckets[mode]?.[bucket];
          nb[mode][bucket] = sanitizeRecord(rec);
        }
      }
    }
    out[preset] = nb;
  }
  return out;
}

/**
 * Record a win. A hinted win goes to the `hinted` bucket; a clean win can
 * improve both its own bucket and the hinted one (a clean run is also a hinted
 * run with zero hints, but only the clean bucket is the headline).
 * @param {{presetId: string, mode: 'noguess'|'classic', hintsUsed: number, timeMs: number, threeBV: number, clicks: number, efficiency: number}} result
 * @returns {{improved: boolean, bucket: 'clean'|'hinted', previous: Record|null}}
 */
export function recordWin(result) {
  const store = storageOf();
  const bucket = result.hintsUsed > 0 ? 'hinted' : 'clean';
  const record = {
    timeMs: result.timeMs,
    threeBV: result.threeBV,
    clicks: result.clicks,
    efficiency: result.efficiency,
    hintsUsed: result.hintsUsed,
    at: new Date().toISOString(),
  };
  if (!store) return { improved: true, bucket, previous: null };
  migrate(store);
  const records = loadRecords();
  const preset = (records[result.presetId] ??= {
    noguess: { clean: null, hinted: null },
    classic: { clean: null, hinted: null },
  });
  const previous = preset[result.mode][bucket];
  // Faster wins the bucket. 3BV breaks ties: a harder board at equal time wins.
  const better =
    !previous ||
    record.timeMs < previous.timeMs ||
    (record.timeMs === previous.timeMs && record.threeBV > previous.threeBV);
  if (better) preset[result.mode][bucket] = record;
  writeJson(store, KEYS.records, records);
  return { improved: Boolean(better), bucket, previous };
}

/**
 * Best record for one preset and mode, preferring the clean bucket for display.
 * @param {string} presetId
 * @param {'noguess'|'classic'} mode
 * @returns {{clean: Record|null, hinted: Record|null}}
 */
export function bestRecords(presetId, mode) {
  const records = loadRecords();
  return records[presetId]?.[mode] ?? { clean: null, hinted: null };
}
