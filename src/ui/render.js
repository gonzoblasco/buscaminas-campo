// src/ui/render.js - DOM rendering. Updates cells in place, never rebuilds the grid.
//
// The v1 rebuilt all cells on every action, which dropped keyboard focus. Here each
// cell is created once and mutated; focus survives a reveal because the node does.

import { MARK_FLAG, MARK_QUESTION } from '../core/game.js';

/** @typedef {import('../core/game.js').Game} Game */

const GLYPH_MINE = "\u25CF"; // filled circle
const GLYPH_FLAG = "\u2691"; // flag
const GLYPH_QUESTION = "?";

/**
 * Column letter + 1-based row, e.g. C4.
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
 * Visible text of a cell, for the screenshot and a11y to agree.
 * @param {Game} game
 * @param {number} i
 * @returns {string}
 */
export function cellText(game, i) {
  if (game.marks[i] === MARK_FLAG && game.revealed[i] === 0) return GLYPH_FLAG;
  if (game.marks[i] === MARK_QUESTION && game.revealed[i] === 0) return GLYPH_QUESTION;
  if (game.revealed[i] === 1) {
    if (game.mines[i] === 1) return GLYPH_MINE;
    return game.counts[i] > 0 ? String(game.counts[i]) : "";
  }
  return "";
}

/**
 * Accessible description of a cell. This is what a screen reader announces, and
 * it must never reveal a mine the player has not uncovered.
 * @param {Game} game
 * @param {number} i
 * @param {boolean} gameOver
 * @returns {string}
 */
export function ariaLabelOf(game, i, gameOver) {
  const where = labelOf(game, i);
  if (game.revealed[i] === 1) {
    if (game.mines[i] === 1) return `${where}, mina`;
    const n = game.counts[i];
    return n === 0 ? `${where}, vacia` : `${where}, ${n}`;
  }
  if (game.marks[i] === MARK_FLAG) return `${where}, bandera`;
  if (game.marks[i] === MARK_QUESTION) return `${where}, duda`;
  if (gameOver && game.mines[i] === 1) return `${where}, mina sin marcar`;
  return `${where}, oculta`;
}

/**
 * Build the grid once.
 * @param {HTMLElement} host
 * @param {Game} game
 * @returns {HTMLButtonElement[]}
 */
export function buildBoard(host, game) {
  host.innerHTML = "";
  host.style.setProperty("--cols", String(game.width));
  host.setAttribute("role", "grid");
  host.setAttribute("aria-rowcount", String(game.height));
  host.setAttribute("aria-colcount", String(game.width));
  const cells = new Array(game.size);
  for (let i = 0; i < game.size; i++) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "cell";
    el.setAttribute("role", "gridcell");
    el.dataset.index = String(i);
    // Roving tabindex: exactly one cell is in the tab order.
    el.tabIndex = i === 0 ? 0 : -1;
    const glyph = document.createElement("span");
    glyph.className = "cell__glyph";
    el.appendChild(glyph);
    host.appendChild(el);
    cells[i] = el;
  }
  return cells;
}

/**
 * Paint the board state onto existing nodes.
 * @param {HTMLButtonElement[]} cells
 * @param {Game} game
 * @param {{justRevealed?: Set<number>, showMines?: boolean, exploded?: number|null}} [opts]
 * @returns {void}
 */
export function paint(cells, game, opts = {}) {
  const over = game.status === 'won' || game.status === 'lost';
  const showMines = opts.showMines ?? game.status === 'lost';
  for (let i = 0; i < game.size; i++) {
    const el = cells[i];
    const glyph = el.firstChild;
    const classes = ["cell"];
    el.removeAttribute("data-count");
    delete el.dataset.count;

    if (game.revealed[i] === 1) {
      classes.push("is-revealed");
      if (game.mines[i] === 1) {
        classes.push("is-mine");
        if (opts.exploded === i) classes.push("is-exploded");
      } else if (game.counts[i] > 0) {
        el.dataset.count = String(game.counts[i]);
      }
      if (opts.justRevealed?.has(i)) classes.push("was-just-revealed");
    } else {
      if (game.marks[i] === MARK_FLAG) classes.push("is-flag");
      if (game.marks[i] === MARK_QUESTION) classes.push("is-question");
      // On a loss, show the mines the player did not find.
      if (showMines && game.mines[i] === 1 && game.marks[i] !== MARK_FLAG) {
        classes.push("is-mine");
      }
      if (showMines && game.marks[i] === MARK_FLAG && game.mines[i] === 0) {
        classes.push("is-wrong");
      }
    }

    el.className = classes.join(" ");
    glyph.textContent = cellText(game, i);
    el.setAttribute("aria-label", ariaLabelOf(game, i, over));
    el.setAttribute("aria-disabled", over ? "true" : "false");
  }
}

/**
 * Move the roving tabindex and focus to one cell.
 * @param {HTMLButtonElement[]} cells
 * @param {number} index
 * @param {boolean} [focus]
 * @returns {void}
 */
export function focusCell(cells, index, focus = true) {
  for (const el of cells) el.tabIndex = -1;
  const target = cells[index];
  if (!target) return;
  target.tabIndex = 0;
  if (focus) target.focus();
}

/**
 * Move by grid offset, clamped to the board.
 * @param {Game} game
 * @param {number} index
 * @param {number} dx
 * @param {number} dy
 * @returns {number}
 */
export function moveBy(game, index, dx, dy) {
  const x = index % game.width;
  const y = Math.floor(index / game.width);
  const nx = Math.max(0, Math.min(game.width - 1, x + dx));
  const ny = Math.max(0, Math.min(game.height - 1, y + dy));
  return ny * game.width + nx;
}

export { GLYPH_FLAG, GLYPH_MINE, GLYPH_QUESTION };
