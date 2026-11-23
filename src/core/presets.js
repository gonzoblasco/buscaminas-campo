// src/core/presets.js - Preset definitions. Pure data.
// Ids use the community names (beginner/intermediate/expert), not easy/medium/hard.

/**
 * @typedef {Object} Preset
 * @property {string} id
 * @property {string} label
 * @property {number} width
 * @property {number} height
 * @property {number} mineCount
 */

/** @type {Record<string, Preset>} */
export const PRESETS = {
  beginner: { id: 'beginner', label: 'Principiante', width: 9, height: 9, mineCount: 10 },
  intermediate: { id: 'intermediate', label: 'Intermedio', width: 16, height: 16, mineCount: 40 },
  expert: { id: 'expert', label: 'Experto', width: 30, height: 16, mineCount: 99 },
};

/** @type {Preset[]} */
export const PRESET_LIST = [PRESETS.beginner, PRESETS.intermediate, PRESETS.expert];

/**
 * Retrieve a preset by id.
 * @param {string} id
 * @returns {Preset}
 * @throws {RangeError} if the id is unknown
 */
export function presetOf(id) {
  const preset = PRESETS[id];
  if (!preset) throw new RangeError(`Unknown preset id: ${id}`);
  return preset;
}

/**
 * A preset is valid when the safe zone of the first click always fits:
 * every cell of the board has at least 9 cells available around it.
 * @param {Preset} preset
 * @returns {boolean}
 */
export function validatePreset(preset) {
  const { width, height, mineCount } = preset;
  if (!Number.isInteger(width) || width <= 0) return false;
  if (!Number.isInteger(height) || height <= 0) return false;
  if (!Number.isInteger(mineCount) || mineCount <= 0) return false;
  const size = width * height;
  return mineCount <= size - 9;
}
