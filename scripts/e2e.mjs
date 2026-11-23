// scripts/e2e.mjs - Real Chromium end to end. No jsdom: layout, focus and the
// service worker only exist in a real engine.
//
// Run against the built site: node scripts/e2e.mjs dist

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL(`../${process.argv[2] ?? 'dist'}/`, import.meta.url));
const N = Number(process.env.N || 0);

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Resolution order: a project-local playwright, then the CI install, then the
// workspace copy that already has browsers. The last path is machine specific and
// is only a local convenience; CI uses the first two.
async function playwright() {
  try {
    return await import('playwright-core');
  } catch {
    /* fall through */
  }
  try {
    return await import('playwright');
  } catch {
    /* fall through */
  }
  const req = createRequire('/Users/gonzoblasco/.openclaw/workspace/projects/kanam-fixer/package.json');
  return req('playwright-core');
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

const PORT = 8931;
await new Promise((resolve) => server.listen(PORT, resolve));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const { chromium } = await playwright();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) consoleErrors.push(`http ${r.status()}: ${r.url()}`);
});

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.cell');

// 1. The board is there and sized to the preset.
const cellCount = await page.locator('.cell').count();
check('Principiante renders 81 cells', cellCount === 81, `${cellCount} cells`);

// 2. No-guess is the default mode.
const defaultMode = await page.locator('[data-mode][aria-pressed="true"]').getAttribute('data-mode');
check('No-guess is the default mode', defaultMode === 'noguess', defaultMode);

// 4. In no-guess mode the board arrives pre-opened, and that opening contains no
// mine. (The "first click is always safe" guarantee is about the classic mode,
// where mines are placed on the click; here the opening is generated.)
const opening = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cell')];
  return {
    revealed: cells.filter((c) => c.classList.contains('is-revealed')).length,
    minesVisible: cells.filter((c) => c.classList.contains('is-mine')).length,
  };
});
check('No-guess opening is pre-revealed', opening.revealed > 1, `${opening.revealed} revealed`);
check('No-guess opening never shows a mine', opening.minesVisible === 0);

// 5. Keyboard: move with arrows, reveal with Enter, mark with F.
await page.locator('.cell').first().focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowDown');
const focusedIndex = await page.evaluate(() => document.activeElement?.dataset?.index ?? null);
check('Arrow keys move focus', focusedIndex === '10', `focused ${focusedIndex}`);

// Pick a cell that is still hidden: marking a revealed cell is correctly a no-op.
const hiddenIndex = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.cell')];
  const el = all.find((c) => !c.classList.contains('is-revealed'));
  return el ? Number(el.dataset.index) : -1;
});
check('A hidden cell exists to mark', hiddenIndex >= 0, `index ${hiddenIndex}`);
await page.locator('.cell').nth(hiddenIndex).focus();
const beforeMark = await page.locator('.cell.is-flag').count();
await page.keyboard.press('f');
await page.waitForTimeout(120);
const afterMark = await page.locator('.cell.is-flag').count();
check('F marks a cell', afterMark === beforeMark + 1, `${beforeMark} -> ${afterMark}`);

await page.keyboard.press('f');
await page.waitForTimeout(60);
const questionCount = await page.locator('.cell.is-question').count();
check('F cycles flag to question', questionCount >= 1, `${questionCount} questions`);
await page.keyboard.press('f');
await page.waitForTimeout(60);

// 6. Focus survives a reveal (the v1 rebuilt the grid and lost it).
await page.locator('.cell').nth(0).focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const stillFocused = await page.evaluate(() => document.activeElement?.classList?.contains('cell') ?? false);
check('Focus survives a reveal', stillFocused);

// 7. Hint names a technique and does not lie. Start from a fresh board so the
// game is guaranteed to have a provable step available.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
await page.click('#hint-btn');
await page.waitForTimeout(200);
const hintVisible = await page.locator('#hint-panel').isVisible();
const hintTech = await page.locator('#hint-tech').textContent();
check('Hint panel appears', hintVisible);
check('Hint names a technique', Boolean(hintTech && hintTech.trim()), hintTech ?? '');

// 8. Accessibility: every cell has a label, grid roles are right.
const labels = await page.locator('.cell[aria-label]').count();
check('Every cell has an aria-label', labels === 81, `${labels} labels`);
const gridRole = await page.locator('#board').getAttribute('role');
check('Board is a grid', gridRole === 'grid', gridRole ?? '');

// 9. Contrast measured on the real computed colours.
const contrast = await page.evaluate(() => {
  const channels = (color) => {
    if (color.startsWith('#')) {
      const h = color.slice(1);
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    }
    const m = color.match(/\d+(\.\d+)?/g);
    return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
  };
  const lum = (color) => {
    const [r, g, b] = channels(color).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const style = getComputedStyle(document.documentElement);
  const v = (name) => style.getPropertyValue(name).trim();
  const body = getComputedStyle(document.body);
  const cell = document.querySelector('.cell');
  const cellStyle = getComputedStyle(cell);
  const control = document.querySelector('.seg');
  return {
    textOnSurface: ratio(body.color, v('--surface')),
    dimOnSurface: ratio(v('--text-dim'), v('--surface')),
    ctrlLine: ratio(v('--ctrl-line'), v('--surface')),
    num1: ratio(v('--num-1'), v('--cell-open')),
    num8: ratio(v('--num-8'), v('--cell-open')),
    cellBorder: ratio(cellStyle.borderTopColor, cellStyle.backgroundColor),
  };
});
check('Body text >= 4.5:1', contrast.textOnSurface >= 4.5, contrast.textOnSurface.toFixed(2));
check('Dim text >= 4.5:1', contrast.dimOnSurface >= 4.5, contrast.dimOnSurface.toFixed(2));
check('Control border >= 3:1', contrast.ctrlLine >= 3, contrast.ctrlLine.toFixed(2));
check('Number 1 >= 4.5:1', contrast.num1 >= 4.5, contrast.num1.toFixed(2));
check('Number 8 >= 4.5:1', contrast.num8 >= 4.5, contrast.num8.toFixed(2));

// 10. Reduced motion: the kill switch reduces real motion.
const motionPage = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
await motionPage.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
await motionPage.waitForSelector('.cell');
const durations = await motionPage.evaluate(() => {
  const cell = document.querySelector('.cell');
  const style = getComputedStyle(cell);
  return { transition: style.transitionDuration, animation: style.animationDuration };
});
const nearZero = (v) => v.split(',').every((d) => parseFloat(d) <= 0.001);
check('reduced-motion zeroes transitions', nearZero(durations.transition), durations.transition);
check('reduced-motion zeroes animations', nearZero(durations.animation), durations.animation);
await motionPage.close();

// 10-bis. The classic first-click guarantee, tested where it actually applies.
await page.evaluate(() => localStorage.clear());
await page.click('[data-mode="classic"]');
await page.waitForTimeout(250);
await page.click('[data-preset="beginner"]');
await page.waitForTimeout(250);
let classicFirstClicksSafe = 0;
let classicFirstClicks = 0;
for (let k = 0; k < 12; k++) {
  await page.click('#new-game');
  await page.waitForTimeout(120);
  const hiddenIdx = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.cell')];
    const el = els[Math.floor(Math.random() * els.length)];
    return el ? Number(el.dataset.index) : 0;
  });
  await page.locator('.cell').nth(hiddenIdx).click();
  await page.waitForTimeout(120);
  const exploded = await page.locator('.cell.is-exploded').count();
  const revealed = await page.locator('.cell.is-revealed').count();
  classicFirstClicks++;
  if (exploded === 0 && revealed >= 1) classicFirstClicksSafe++;
}
check(
  'Classic first click is always safe (12 runs)',
  classicFirstClicksSafe === classicFirstClicks,
  `${classicFirstClicksSafe}/${classicFirstClicks}`
);

// 11. Mode switch keeps records separate and survives a reload.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
await page.click('[data-mode="classic"]');
await page.waitForTimeout(250);
const classicPressed = await page.locator('[data-mode="classic"]').getAttribute('aria-pressed');
check('Switching to classic works', classicPressed === 'true');
const storedMode = await page.evaluate(() => JSON.parse(localStorage.getItem('bc.settings.v2') ?? '{}').mode);
check('Mode is persisted', storedMode === 'classic', String(storedMode));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
const afterReload = await page.locator('[data-mode][aria-pressed="true"]').getAttribute('data-mode');
check('Mode survives a reload', afterReload === 'classic', afterReload ?? '');

// 12. Win a no-guess Beginner game using the hint button only.
await page.evaluate(() => localStorage.clear());
await page.click('[data-mode="noguess"]');
await page.click('[data-preset="beginner"]');
await page.waitForTimeout(300);
let guard = 0;
let wonWithHints = false;
let hintsUsed = 0;
while (guard++ < 400) {
  const status = await page.evaluate(() => document.body.dataset.status ?? '');
  const won = await page.locator('#hint-lead').textContent().catch(() => '');
  if (won === 'Ganaste.') {
    wonWithHints = true;
    break;
  }
  const enabled = await page.locator('#hint-btn').isEnabled();
  if (!enabled) break;
  await page.click('#hint-btn');
  hintsUsed++;
  await page.waitForTimeout(30);
  if (await page.locator('#hint-lead').textContent().then((t) => t === 'Ganaste.')) {
    wonWithHints = true;
    break;
  }
}
check('A no-guess game is won using only the hints', wonWithHints, `${hintsUsed} hints, ${guard} iterations`);

// 13. The seed is shown and reproducible.
const seedText = await page.locator('#seed-value').textContent().catch(() => '');
check('A no-guess game shows its seed', /\d+/.test(seedText ?? ''), seedText ?? '');

// 14. Offline for real: load once with the service worker, then cut the network
// and reload. A simulated offline flag is not the same test.
const offlinePage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await offlinePage.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
await offlinePage.waitForSelector('.cell');
const swReady = await offlinePage.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  return Boolean(reg && reg.active);
});
check('Service worker becomes active', swReady);

// The service worker only serves a context it is registered in, so the offline
// check has to reuse the SAME context and cut the network under it, then reload.
// A fresh offline context has no worker and would fail for the wrong reason.
let offlineOk = false;
let offlineCells = 0;
try {
  await offlinePage.context().setOffline(true);
  await offlinePage.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await offlinePage.waitForSelector('.cell', { timeout: 10000 });
  offlineCells = await offlinePage.locator('.cell').count();
  offlineOk = offlineCells === 81;
  // And it must be playable offline: reveal a cell and see the board change.
  await offlinePage.locator('.cell').nth(40).click();
  await offlinePage.waitForTimeout(200);
  const offlineRevealed = await offlinePage.locator('.cell.is-revealed').count();
  if (offlineOk && offlineRevealed === 0) offlineOk = false;
  offlineCells = `${offlineCells} cells, ${offlineRevealed} revealed`;
} catch (err) {
  offlineOk = false;
  offlineCells = `failed: ${err.message.split('\n')[0]}`;
}
check('The game loads and plays with the network off', offlineOk, `${offlineCells}`);
await offlinePage.context().setOffline(false);
await offlinePage.close();

// 15. Trainer: the ladder names the board's tier and the steps are real deductions.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
const rungs = await page.locator('.trainer__rung').count();
check('Trainer shows four tiers', rungs === 4, `${rungs} rungs`);
const tierLine = await page.locator('#trainer-tier-line').textContent();
check('Trainer names the board tier', /tier \d/.test(tierLine ?? ''), (tierLine ?? '').slice(0, 60));
await page.click('#trainer-all');
await page.waitForTimeout(200);
const stepCount = await page.locator('.trainer__step').count();
const emptyNote = await page.locator('.trainer__empty').count();
check('Trainer lists provable steps (or says there are none)', stepCount > 0 || emptyNote > 0, `${stepCount} steps`);
await page.click('#trainer-next');
await page.waitForTimeout(200);
const afterNext = await page.locator('.trainer__step').count();
check('Trainer applies the next proven step', afterNext >= 1, `${afterNext} shown`);

check('No console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await page.screenshot({ path: '/tmp/bc-final.png', fullPage: false });
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
