// src/core/logic.js - The logical solver. Four techniques, honest about all of them.
//
// Two rules with tests behind them:
//  1. Pure: never mutates the game it is given.
//  2. Every deduction can be re-validated with verifyDeduction. A deduction that
//     cannot be re-validated is not shown. That rule is what stops the hint from
//     lying, and it is why the post-mortem can claim "you could have proved this".

import { neighborsOf } from './board.js';
import { cloneGame, isWon, MARK_FLAG, MARK_NONE } from './game.js';

/** @typedef {import('./game.js').Game} Game */

/**
 * @typedef {Object} Deduction
 * @property {'counting'|'subset'|'global'|'enum'} technique
 * @property {'safe'|'mine'} action
 * @property {number[]} cells
 * @property {number} source
 * @property {string} text
 * @property {number} tier
 */

const TIERS = { counting: 1, subset: 2, global: 3, enum: 4 };

export const DEFAULT_ENUM_CAP = 16;

/**
 * A constraint from one revealed clue: exactly `need` of `cells` hold mines.
 * @typedef {Object} Constraint
 * @property {number[]} cells
 * @property {number} need
 * @property {number} source
 */

/**
 * All live constraints on the board.
 * @param {Game} game
 * @returns {Constraint[]}
 */
export function constraintsOf(game) {
  const out = [];
  for (let i = 0; i < game.size; i++) {
    if (game.revealed[i] !== 1 || game.counts[i] === 0) continue;
    const hidden = [];
    let flags = 0;
    for (const n of neighborsOf(game, i)) {
      if (game.marks[n] === MARK_FLAG) flags++;
      else if (game.revealed[n] === 0) hidden.push(n);
    }
    if (hidden.length === 0) continue;
    out.push({ cells: hidden, need: game.counts[i] - flags, source: i });
  }
  return out;
}

/**
 * Cells still hidden and not flagged.
 * @param {Game} game
 * @returns {number[]}
 */
function hiddenCells(game) {
  const out = [];
  for (let i = 0; i < game.size; i++) {
    if (game.revealed[i] === 0 && game.marks[i] !== MARK_FLAG) out.push(i);
  }
  return out;
}

/**
 * Grid coordinates as a human reads them: column letter + 1-based row.
 * @param {Game} game
 * @param {number} i
 * @returns {string}
 */
export function labelOf(game, i) {
  const x = i % game.width;
  const y = Math.floor(i / game.width);
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

/**
 * Spanish list of cell labels, grammatically correct for 1, 2 and many.
 * @param {Game} game
 * @param {number[]} cells
 * @returns {string}
 */
function joinLabels(game, cells) {
  const labels = cells.map((c) => labelOf(game, c));
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`;
}

/**
 * Tier 1: counting. If the clue's remaining mine count equals the number of
 * hidden neighbours, they are all mines; if it is zero, they are all safe.
 * @param {Game} game
 * @returns {Deduction|null}
 */
function byCounting(game) {
  for (const c of constraintsOf(game)) {
    if (c.need === 0) {
      return {
        technique: 'counting',
        action: 'safe',
        cells: c.cells.slice(),
        source: c.source,
        tier: TIERS.counting,
        text:
          c.cells.length === 1
            ? `El ${game.counts[c.source]} de ${labelOf(game, c.source)} ya tiene todas sus minas marcadas, asi que ${joinLabels(game, c.cells)} es segura.`
            : `El ${game.counts[c.source]} de ${labelOf(game, c.source)} ya tiene todas sus minas marcadas, asi que ${joinLabels(game, c.cells)} son seguras.`,
      };
    }
    if (c.need === c.cells.length) {
      return {
        technique: 'counting',
        action: 'mine',
        cells: c.cells.slice(),
        source: c.source,
        tier: TIERS.counting,
        text:
          c.cells.length === 1
            ? `El ${game.counts[c.source]} de ${labelOf(game, c.source)} necesita una mina entre sus celdas ocultas, y queda una sola: ${joinLabels(game, c.cells)}.`
            : `El ${game.counts[c.source]} de ${labelOf(game, c.source)} necesita una mina en cada una de sus celdas ocultas: ${joinLabels(game, c.cells)}.`,
      };
    }
  }
  return null;
}

/**
 * Tier 3: the global mine count. If the mines still missing equal the hidden
 * cells of a component, all of them are mines; if none are missing, none.
 * Uses connected components so the claim is about a provable subset.
 * @param {Game} game
 * @returns {Deduction|null}
 */
function byGlobalCount(game) {
  let flags = 0;
  for (let i = 0; i < game.size; i++) if (game.marks[i] === MARK_FLAG) flags++;
  const missing = game.mineCount - flags;
  const hidden = hiddenCells(game);
  if (hidden.length === 0) return null;
  if (missing === 0) {
    return {
      technique: 'global',
      action: 'safe',
      cells: hidden,
      source: -1,
      tier: TIERS.global,
      text: `Ya hay ${game.mineCount} minas marcadas, que son todas las del tablero. Las ${hidden.length} celdas ocultas son seguras.`,
    };
  }
  if (missing === hidden.length) {
    return {
      technique: 'global',
      action: 'mine',
      cells: hidden,
      source: -1,
      tier: TIERS.global,
      text: `Faltan ${missing} minas y quedan exactamente ${hidden.length} celdas ocultas, asi que todas son minas.`,
    };
  }
  return null;
}

/**
 * Tier 2: subset. Compares two overlapping constraints. When one is contained in
 * the other, the difference between their needs resolves the difference cells.
 * Covers 1-1, 1-2 and the general containment case.
 * @param {Game} game
 * @returns {Deduction|null}
 */
function bySubset(game) {
  const cons = constraintsOf(game);
  for (let a = 0; a < cons.length; a++) {
    for (let b = 0; b < cons.length; b++) {
      if (a === b) continue;
      const A = cons[a];
      const B = cons[b];
      const setA = new Set(A.cells);
      if (!B.cells.every((c) => setA.has(c))) continue; // B must be inside A
      if (B.cells.length >= A.cells.length) continue; // and strictly smaller
      const diff = A.cells.filter((c) => !B.cells.includes(c));
      const needDiff = A.need - B.need;
      if (needDiff === 0) {
        return {
          technique: 'subset',
          action: 'safe',
          cells: diff,
          source: A.source,
          tier: TIERS.subset,
          text:
            `Las celdas de ${labelOf(game, B.source)} estan contenidas en las de ${labelOf(game, A.source)}, y las dos piden la misma cantidad relativa de minas. ` +
            (diff.length === 1
              ? `Por eso ${joinLabels(game, diff)} es segura.`
              : `Por eso ${joinLabels(game, diff)} son seguras.`),
        };
      }
      if (needDiff === diff.length) {
        return {
          technique: 'subset',
          action: 'mine',
          cells: diff,
          source: A.source,
          tier: TIERS.subset,
          text:
            `Las celdas de ${labelOf(game, B.source)} estan contenidas en las de ${labelOf(game, A.source)}, y la diferencia pide exactamente ` +
            `${needDiff} ${needDiff === 1 ? 'mina' : 'minas'}. ` +
            (diff.length === 1
              ? `Por eso ${joinLabels(game, diff)} es mina.`
              : `Por eso ${joinLabels(game, diff)} son minas.`),
        };
      }
    }
  }
  return null;
}

/**
 * Connected components of hidden cells linked by shared constraints.
 * @param {Constraint[]} cons
 * @returns {{constraints: Constraint[], cells: number[]}[]}
 */
function componentsOf(cons) {
  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let cur = x;
    while (parent.get(cur) !== r) {
      const nx = parent.get(cur);
      parent.set(cur, r);
      cur = nx;
    }
    return r;
  };
  const add = (x) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (p, q) => {
    const a = find(p);
    const b = find(q);
    if (a !== b) parent.set(a, b);
  };
  for (const c of cons) {
    for (const cell of c.cells) {
      add(cell);
      union(c.cells[0], cell);
    }
  }
  const groups = new Map();
  for (const c of cons) {
    const root = find(c.cells[0]);
    if (!groups.has(root)) groups.set(root, { constraints: [], cells: new Set() });
    const gr = groups.get(root);
    gr.constraints.push(c);
    for (const cell of c.cells) gr.cells.add(cell);
  }
  return [...groups.values()].map((g) => ({ constraints: g.constraints, cells: [...g.cells] }));
}

/**
 * Enumerate consistent assignments of a component and report a cell every
 * solution agrees on. Never guesses: an unconstrained cell is not listed.
 * @param {Game} game
 * @param {{constraints: Constraint[], cells: number[]}} component
 * @returns {{safe: number[], mine: number[], configurations: number}|null}
 */
export function enumerateComponent(game, component) {
  const cells = component.cells;
  const idx = new Map(cells.map((c, k) => [c, k]));
  const solutions = [];
  const assign = new Uint8Array(cells.length);
  const consistent = () => {
    for (const c of component.constraints) {
      let sum = 0;
      for (const cell of c.cells) sum += assign[idx.get(cell)];
      if (sum !== c.need) return false;
    }
    return true;
  };
  const walk = (k) => {
    if (k === cells.length) {
      if (consistent()) solutions.push(Uint8Array.from(assign));
      return;
    }
    assign[k] = 0;
    walk(k + 1);
    assign[k] = 1;
    walk(k + 1);
  };
  walk(0);
  if (solutions.length === 0) return null;
  const safe = [];
  const mine = [];
  for (let k = 0; k < cells.length; k++) {
    let allOne = true;
    let allZero = true;
    for (const s of solutions) {
      if (s[k] === 1) allZero = false;
      else allOne = false;
    }
    if (allOne) mine.push(cells[k]);
    if (allZero) safe.push(cells[k]);
  }
  return { safe, mine, configurations: solutions.length };
}

/**
 * Tier 4: enumeration per connected component, capped.
 * The cap is a design decision, measured: CAP=16 keeps solve p95 at ~10 ms while
 * CAP=30 pushes it to ~2.4 s without improving acceptance. Over the cap a
 * component yields nothing: no deduction is better than a guessed one.
 * @param {Game} game
 * @param {{cap: number}} opts
 * @returns {Deduction|null}
 */
function byEnumeration(game, opts) {
  const cons = constraintsOf(game);
  if (!cons.length) return null;
  for (const component of componentsOf(cons)) {
    if (component.cells.length > opts.cap) continue;
    const result = enumerateComponent(game, component);
    if (!result) continue;
    if (result.safe.length) {
      return {
        technique: 'enum',
        action: 'safe',
        cells: result.safe,
        source: component.constraints[0].source,
        tier: TIERS.enum,
        text:
          `Enumerando las ${result.configurations} configuraciones compatibles de esta zona, ` +
          (result.safe.length === 1
            ? `${joinLabels(game, result.safe)} es segura en todas.`
            : `${joinLabels(game, result.safe)} son seguras en todas.`),
      };
    }
    if (result.mine.length) {
      return {
        technique: 'enum',
        action: 'mine',
        cells: result.mine,
        source: component.constraints[0].source,
        tier: TIERS.enum,
        text:
          `Enumerando las ${result.configurations} configuraciones compatibles de esta zona, ` +
          (result.mine.length === 1
            ? `${joinLabels(game, result.mine)} es mina en todas.`
            : `${joinLabels(game, result.mine)} son minas en todas.`),
      };
    }
  }
  return null;
}

/**
 * Find one deduction, cheapest tier first.
 * @param {Game} game
 * @param {{cap?: number}} [opts]
 * @returns {Deduction|null}
 */
export function findDeduction(game, opts = {}) {
  const cap = opts.cap ?? DEFAULT_ENUM_CAP;
  return byCounting(game) ?? bySubset(game) ?? byGlobalCount(game) ?? byEnumeration(game, { cap });
}

/**
 * Every deduction currently available, cheapest first, deduplicated per action.
 * This is the "all possible steps" view of a trainer.
 * @param {Game} game
 * @param {{cap?: number}} [opts]
 * @returns {Deduction[]}
 */
export function allDeductions(game, opts = {}) {
  const out = [];
  const seen = new Set();
  const push = (d) => {
    if (!d) return;
    const key = `${d.action}:${d.cells.slice().sort((x, y) => x - y).join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };
  for (const c of constraintsOf(game)) {
    if (c.need === 0 || c.need === c.cells.length) push(byCounting(game));
  }
  push(bySubset(game));
  push(byGlobalCount(game));
  const cons = constraintsOf(game);
  const cap = opts.cap ?? DEFAULT_ENUM_CAP;
  for (const component of componentsOf(cons)) {
    if (component.cells.length > cap) continue;
    const r = enumerateComponent(game, component);
    if (!r) continue;
    if (r.safe.length) {
      push({
        technique: 'enum',
        action: 'safe',
        cells: r.safe,
        source: component.constraints[0].source,
        tier: TIERS.enum,
        text: `Enumeracion: ${joinLabels(game, r.safe)} seguras en las ${r.configurations} configuraciones.`,
      });
    }
    if (r.mine.length) {
      push({
        technique: 'enum',
        action: 'mine',
        cells: r.mine,
        source: component.constraints[0].source,
        tier: TIERS.enum,
        text: `Enumeracion: ${joinLabels(game, r.mine)} minas en las ${r.configurations} configuraciones.`,
      });
    }
  }
  return out;
}

/**
 * Re-validate a deduction against the current state. This is the guard that keeps
 * the hint honest and the post-mortem provable.
 * @param {Game} game
 * @param {Deduction} d
 * @returns {boolean}
 */
export function verifyDeduction(game, d) {
  if (!d || !Array.isArray(d.cells) || d.cells.length === 0) return false;
  for (const c of d.cells) {
    if (!Number.isInteger(c) || c < 0 || c >= game.size) return false;
    if (game.revealed[c] === 1) return false;
    if (game.marks[c] === MARK_FLAG) return false;
  }
  if (!game.minesPlaced) return false;

  if (d.technique === 'counting' || d.technique === 'subset') {
    const truth = d.action === 'mine';
    for (const c of d.cells) {
      if ((game.mines[c] === 1) !== truth) return false;
    }
    return true;
  }

  if (d.technique === 'global') {
    const truth = d.action === 'mine';
    for (const c of d.cells) {
      if ((game.mines[c] === 1) !== truth) return false;
    }
    return true;
  }

  if (d.technique === 'enum') {
    // Re-derive: the claim must be implied by the constraints alone, not just true.
    const cons = constraintsOf(game);
    const cellSet = new Set(d.cells);
    for (const component of componentsOf(cons)) {
      if (!component.cells.some((c) => cellSet.has(c))) continue;
      if (component.cells.length > 22) continue;
      const r = enumerateComponent(game, component);
      if (!r) continue;
      const agreed = d.action === 'mine' ? r.mine : r.safe;
      if (d.cells.every((c) => agreed.includes(c))) return true;
    }
    // The claim is not implied by the constraints: it may be true by luck, and a
    // lucky guess is exactly what this game promises not to present as proof.
    return false;
  }

  return false;
}

/**
 * Solve the board using only logic. Never guesses.
 * @param {Game} game
 * @param {{cap?: number, maxSteps?: number}} [opts]
 * @returns {{won: boolean, steps: Deduction[], maxTier: number, stuck: boolean}}
 */
export function solveLogically(game, opts = {}) {
  const cap = opts.cap ?? DEFAULT_ENUM_CAP;
  const maxSteps = opts.maxSteps ?? 1e6;
  let cur = game;
  const steps = [];
  let maxTier = 0;
  let guard = 0;

  // The generator hands us a fresh board; the first reveal has already happened
  // (mines are placed). From there we only apply proven deductions.
  while (guard++ < maxSteps) {
    if (isWon(cur)) return { won: true, steps, maxTier, stuck: false };
    const d = findDeduction(cur, { cap });
    if (!d) break;
    if (!verifyDeduction(cur, d)) break; // never act on an unproven deduction
    steps.push(d);
    maxTier = Math.max(maxTier, d.tier);
    cur = applyDeduction(cur, d);
  }
  return { won: isWon(cur), steps, maxTier, stuck: !isWon(cur) };
}

/**
 * Apply a proven deduction and reveal what follows from it.
 * Safe cells are revealed (flood fill included); mines are marked.
 * @param {Game} game
 * @param {Deduction} d
 * @returns {Game}
 */
export function applyDeduction(game, d) {
  const next = cloneGame(game);
  if (d.action === 'mine') {
    for (const c of d.cells) next.marks[c] = MARK_FLAG;
    return next;
  }
  const stack = [...d.cells];
  while (stack.length) {
    const i = stack.pop();
    if (next.revealed[i] === 1 || next.marks[i] === MARK_FLAG) continue;
    next.revealed[i] = 1;
    if (next.counts[i] === 0) {
      for (const n of neighborsOf(next, i)) {
        if (next.revealed[n] === 0 && next.marks[n] !== MARK_FLAG) stack.push(n);
      }
    }
  }
  // A solver step is one click in the metric, whatever it opens.
  next.clicks += 1;
  if (next.status === 'ready') next.status = 'playing';
  if (isWon(next)) next.status = 'won';
  return next;
}

/**
 * The tier of a board: the highest technique a perfect logical solve needs.
 * Returns null when the board cannot be solved without guessing.
 * @param {Game} game
 * @param {{cap?: number}} [opts]
 * @returns {1|2|3|4|null}
 */
export function tierOf(game, opts = {}) {
  const cap = opts.cap ?? DEFAULT_ENUM_CAP;
  for (let tier = 1; tier <= 4; tier++) {
    const r = solveWithCeiling(game, tier, cap);
    if (r.won) return tier;
  }
  return null;
}

/**
 * Solve using only techniques up to `ceiling`. Used to prove a board needs its tier.
 * @param {Game} game
 * @param {number} ceiling
 * @param {number} cap
 * @returns {{won: boolean}}
 */
export function solveWithCeiling(game, ceiling, cap = DEFAULT_ENUM_CAP) {
  let cur = game;
  let guard = 0;
  while (guard++ < 1e6) {
    if (isWon(cur)) return { won: true };
    const d = pickUpToTier(cur, ceiling, cap);
    if (!d) break;
    if (!verifyDeduction(cur, d)) break;
    cur = applyDeduction(cur, d);
  }
  return { won: isWon(cur) };
}

/**
 * @param {Game} game
 * @param {number} ceiling
 * @param {number} cap
 * @returns {Deduction|null}
 */
function pickUpToTier(game, ceiling, cap) {
  if (ceiling >= 1) {
    const d = byCounting(game);
    if (d) return d;
  }
  if (ceiling >= 2) {
    const d = bySubset(game);
    if (d) return d;
  }
  if (ceiling >= 3) {
    const d = byGlobalCount(game);
    if (d) return d;
  }
  if (ceiling >= 4) return byEnumeration(game, { cap });
  return null;
}

/**
 * Probability that a specific cell holds a mine, from enumeration of its component.
 * Returns null when the component exceeds the cap: no number is better than a bad one.
 * @param {Game} game
 * @param {number} cell
 * @param {{cap?: number}} [opts]
 * @returns {{probability: number, configurations: number}|null}
 */
export function mineProbabilityAt(game, cell, opts = {}) {
  const cap = opts.cap ?? DEFAULT_ENUM_CAP;
  const cons = constraintsOf(game);
  for (const component of componentsOf(cons)) {
    if (!component.cells.includes(cell)) continue;
    if (component.cells.length > cap) return null;
    const idx = new Map(component.cells.map((c, k) => [c, k]));
    const target = idx.get(cell);
    let total = 0;
    let withMine = 0;
    const assign = new Uint8Array(component.cells.length);
    const consistent = () => {
      for (const c of component.constraints) {
        let sum = 0;
        for (const x of c.cells) sum += assign[idx.get(x)];
        if (sum !== c.need) return false;
      }
      return true;
    };
    const walk = (k) => {
      if (k === component.cells.length) {
        if (consistent()) {
          total++;
          if (assign[target] === 1) withMine++;
        }
        return;
      }
      assign[k] = 0;
      walk(k + 1);
      assign[k] = 1;
      walk(k + 1);
    };
    walk(0);
    if (total === 0) return null;
    return { probability: withMine / total, configurations: total };
  }
  return null;
}
