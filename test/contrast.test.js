import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This test reads the REAL stylesheet, not a copy and not a document. A colour
// chosen "by value" is not a verified colour: the v1 shipped a token that measured
// 1.40:1 while the design doc claimed otherwise, because nothing read the CSS.

const CSS = readFileSync(fileURLToPath(new URL('../src/ui/styles.css', import.meta.url)), 'utf8');

/** @param {string} name @returns {string|null} */
function token(name) {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  return m ? m[1] : null;
}

const ch = (v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** @param {string} hex @returns {number} */
const lum = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

/** @param {string} a @param {string} b @returns {number} */
const ratio = (a, b) => {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

const needed = ['bg', 'surface', 'surface-2', 'line', 'ctrl-line', 'text', 'text-dim', 'accent', 'cell-hidden', 'cell-open', 'cell-mine'];

test('every documented token exists in the stylesheet', () => {
  for (const name of needed) {
    assert.ok(token(name), `missing token --${name}`);
  }
});

test('body text meets 4.5:1 on both surfaces', () => {
  const text = token('text');
  for (const surface of ['surface', 'surface-2', 'bg']) {
    const r = ratio(text, token(surface));
    assert.ok(r >= 4.5, `text on --${surface} is ${r.toFixed(2)}:1`);
  }
});

test('dim text meets 4.5:1 on both surfaces', () => {
  const dim = token('text-dim');
  for (const surface of ['surface', 'surface-2', 'bg']) {
    const r = ratio(dim, token(surface));
    assert.ok(r >= 4.5, `dim text on --${surface} is ${r.toFixed(2)}:1`);
  }
});

test('control borders meet 3:1 (the v1 shipped 1.34:1 here)', () => {
  const ctrl = token('ctrl-line');
  for (const surface of ['surface', 'surface-2', 'bg']) {
    const r = ratio(ctrl, token(surface));
    assert.ok(r >= 3, `control border on --${surface} is ${r.toFixed(2)}:1`);
  }
});

test('--line is decorative only and is NOT used on a control', () => {
  // The real rule is not a count: it is that no CONTROL boundary may use the
  // decorative colour. Section separators inside a layout may legitimately use it.
  const controlSelectors = ['.cell', '.btn', '.seg', '.stat', '.hint', '.chip', '.segmented', '.board-area__note'];
  const blocks = CSS.split('}');
  for (const block of blocks) {
    const usesLine = /border[^;]*var\(--line\)/.test(block);
    if (!usesLine) continue;
    const selector = block.split('{')[0]?.trim() ?? '';
    for (const control of controlSelectors) {
      assert.ok(
        !selector.includes(control),
        `${control} uses the decorative --line as a border: "${selector.replace(/\s+/g, ' ').slice(0, 80)}"`
      );
    }
  }
  const ctrlUses = (CSS.match(/border[^;]*var\(--ctrl-line\)/g) ?? []).length;
  assert.ok(ctrlUses >= 3, `expected --ctrl-line to define control borders, found ${ctrlUses}`);
});

test('every state boundary meets 3:1, including a revealed cell edge', () => {
  const open = token('cell-open');
  for (const name of ['cell-line', 'cell-line-open']) {
    const c = token(name);
    assert.ok(c, `missing token --${name}`);
    const r = ratio(c, open);
    assert.ok(r >= 3, `--${name} against --cell-open is ${r.toFixed(2)}:1`);
    const r2 = ratio(c, token('surface'));
    assert.ok(r2 >= 3, `--${name} against --surface is ${r2.toFixed(2)}:1`);
  }
});

test('all 8 numbers meet 4.5:1 on the open cell', () => {
  const open = token('cell-open');
  for (let i = 1; i <= 8; i++) {
    const c = token(`num-${i}`);
    assert.ok(c, `missing --num-${i}`);
    const r = ratio(c, open);
    assert.ok(r >= 4.5, `number ${i} on the open cell is ${r.toFixed(2)}:1`);
  }
});

test('numbers are distinguishable without colour (weight ramp 500..900)', () => {
  // Hue must never be the only signal. Each count rule must set a font-weight, and
  // the eight weights must not all be identical.
  const weights = [];
  for (let i = 1; i <= 8; i++) {
    const rule = CSS.match(new RegExp(`\\.cell\\[data-count="${i}"\\]\\s*\\{[^}]*font-weight:\\s*(\\d+)`));
    assert.ok(rule, `count ${i} has no font-weight rule`);
    weights.push(Number(rule[1]));
  }
  assert.ok(new Set(weights).size >= 4, `only ${new Set(weights).size} distinct weights across 8 numbers`);
  assert.ok(Math.min(...weights) >= 500 && Math.max(...weights) <= 900, `weights outside 500..900: ${weights}`);
});

test('the accent is legible on the page background', () => {
  const r = ratio(token('accent'), token('bg'));
  assert.ok(r >= 3, `accent on background is ${r.toFixed(2)}:1`);
});

test('the accent ink is legible on the accent (button text)', () => {
  const r = ratio(token('accent-ink'), token('accent'));
  assert.ok(r >= 4.5, `accent ink on accent is ${r.toFixed(2)}:1`);
});

test('the reduced-motion block actually zeroes durations', () => {
  const block = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/);
  assert.ok(block, 'missing prefers-reduced-motion block');
  assert.match(block[0], /animation-duration:\s*0\.001ms\s*!important/);
  assert.match(block[0], /transition-duration:\s*0\.001ms\s*!important/);
  assert.match(block[0], /transform:\s*none\s*!important/);
});

test('motion tokens exist and are real durations', () => {
  for (const name of ['ease-out', 'dur-fast', 'dur', 'dur-slow']) {
    assert.ok(CSS.includes(`--${name}:`), `missing motion token --${name}`);
  }
  assert.match(CSS, /--dur-fast:\s*\d+ms/);
  assert.match(CSS, /--dur-slow:\s*\d+ms/);
});

test('background overlays sit on the page, never above the board', () => {
  // body::before and body::after are the grid and the grain. They must be z-index 0
  // and pointer-events none; the shell sits at z-index 1.
  const before = CSS.match(/body::before\s*\{[^}]*\}/);
  const after = CSS.match(/body::after\s*\{[^}]*\}/);
  for (const [name, block] of [['body::before', before], ['body::after', after]]) {
    assert.ok(block, `missing ${name}`);
    assert.match(block[0], /z-index:\s*0/, `${name} must sit at z-index 0`);
    assert.match(block[0], /pointer-events:\s*none/, `${name} must not capture clicks`);
  }
  const shell = CSS.match(/\.app-shell\s*\{[^}]*\}/);
  assert.ok(shell);
  assert.match(shell[0], /z-index:\s*1/, 'the shell must sit above the overlays');
});
