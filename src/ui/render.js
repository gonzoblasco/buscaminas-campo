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


/**
 * Draw "the why": thin dashed lines from the clue that supports a deduction to
 * the cells it resolves, with a small badge on the source.
 *
 * Rules that keep it legible, and the reason each exists:
 *  - the overlay never takes pointer events, so the board stays clickable
 *  - a line that would cross a cell centre is drawn anyway, but the overlay sits
 *    UNDER the numbers' own layer and above the cell background, so a digit is
 *    never obscured by a dash
 *  - it is removed on the next action: a stale overlay would explain a state the
 *    board no longer has
 * @param {HTMLElement} host  the board element (position: relative)
 * @param {HTMLButtonElement[]} cells
 * @param {Game} game
 * @param {import('../core/logic.js').Deduction} deduction
 * @returns {SVGElement}
 */
export function drawWhy(host, cells, game, deduction) {
  clearWhy(host);
  if (!deduction || deduction.cells.length === 0) return null;
  const hostRect = host.getBoundingClientRect();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'why-layer');
  svg.setAttribute('width', String(hostRect.width));
  svg.setAttribute('height', String(hostRect.height));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;z-index:3;overflow:visible`;

  const centerOf = (index) => {
    const el = cells[index];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left - hostRect.left + b.width / 2, y: b.top - hostRect.top + b.height / 2 };
  };

  const source = deduction.source >= 0 ? centerOf(deduction.source) : null;
  if (source) {
    for (const cell of deduction.cells) {
      const target = centerOf(cell);
      if (!target) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const midX = (source.x + target.x) / 2;
      path.setAttribute('d', `M ${source.x} ${source.y} Q ${midX} ${(source.y + target.y) / 2 - 14} ${target.x} ${target.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--accent)');
      path.setAttribute('stroke-width', '1.25');
      path.setAttribute('stroke-dasharray', '3 3');
      path.setAttribute('opacity', '0.85');
      svg.appendChild(path);
    }
    const badge = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    badge.setAttribute('cx', String(source.x - 14));
    badge.setAttribute('cy', String(source.y - 14));
    badge.setAttribute('r', '7');
    badge.setAttribute('fill', 'var(--accent)');
    svg.appendChild(badge);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(source.x - 14));
    text.setAttribute('y', String(source.y - 14));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('font-size', '8');
    text.setAttribute('font-family', 'ui-monospace, monospace');
    text.setAttribute('fill', 'var(--accent-ink)');
    text.textContent = String(game.counts[deduction.source] ?? '?');
    svg.appendChild(text);
  }

  // Ring the resolved cells so the eye finds them without following every dash.
  for (const cell of deduction.cells) {
    const el = cells[cell];
    if (el) el.classList.add('is-explained');
  }

  host.appendChild(svg);
  return svg;
}

/**
 * Remove the overlay and the highlight rings.
 * @param {HTMLElement} host
 * @returns {void}
 */
export function clearWhy(host) {
  host.querySelector('.why-layer')?.remove();
  for (const el of host.querySelectorAll('.is-explained')) el.classList.remove('is-explained');
}
