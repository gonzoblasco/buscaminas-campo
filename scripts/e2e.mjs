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
  // Last resort: a local checkout that happens to have browsers. This path is
  // machine specific by design, and CI never reaches it because the workflow
  // installs `playwright` into the project. If that changes, fail loudly here
  // rather than silently resolving a path that cannot exist on the runner.
  const local = '/Users/gonzoblasco/.openclaw/workspace/projects/kanam-fixer/package.json';
  try {
    const req = createRequire(local);
    return req('playwright-core');
  } catch {
    throw new Error(
      'No Playwright available. In CI run "npm i --no-save playwright && npx playwright install chromium"; locally, install playwright-core in any checkout.'
    );
  }
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

// 16. The two settings must change behaviour, not just be stored (they were dead).
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
// The opening size is not monotonic in the area: a larger guaranteed-safe zone can
// land on a different board whose zero-region happens to be smaller. Asserting
// "5x5 opens more" would encode a false claim about the world.
//
// What this level can prove is that the control is real, wired and persisted. That
// the setting actually changes the safe zone is proven in test/safearea.test.js,
// where the seed is held constant and the zone size is measured directly (1, 9 and
// 25 cells for a centre cell, plus 900 reveal cases per area).
for (const area of ['1x1', '3x3', '5x5']) {
  await page.click(`[data-area="${area}"]`);
  await page.waitForTimeout(80);
  const pressed = await page.locator(`[data-area="${area}"]`).getAttribute('aria-pressed');
  check(`The ${area} area control is selectable`, pressed === 'true', String(pressed));
}
await page.click('[data-area="5x5"]');
await page.waitForTimeout(80);
const areaStored = await page.evaluate(() => JSON.parse(localStorage.getItem('bc.settings.v2') ?? '{}').firstClickArea);
check('The area setting persists', areaStored === '5x5', String(areaStored));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
const areaAfterReload = await page.locator('[data-area="5x5"]').getAttribute('aria-pressed');
check('The area setting survives a reload', areaAfterReload === 'true', String(areaAfterReload));

// 17. "Show the why" draws the reasoning when the hint fires.
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
await page.check('#show-why');
await page.waitForTimeout(120);
await page.click('#hint-btn');
await page.waitForTimeout(350);
const whyLayers = await page.locator('.why-layer').count();
const whyPaths = await page.locator('.why-layer path').count();
const explained = await page.locator('.cell.is-explained').count();
check('"Show the why" draws an overlay', whyLayers === 1, `${whyLayers} layers`);
check('The overlay has lines to the resolved cells', whyPaths >= 1, `${whyPaths} paths`);
check('The resolved cells are ringed', explained >= 1, `${explained} ringed`);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.cell');
await page.click('#hint-btn');
await page.waitForTimeout(250);
check('With the setting off, no overlay is drawn', (await page.locator('.why-layer').count()) === 0);

// 18. Mark mode: a touch screen has no right click, so tapping must flag.
// A restored game comes back PAUSED on purpose, and `beforeunload` re-persists it,
// so a cleared storage followed by a reload does not start a fresh game. Resume
// before interacting, which is also what a player would do.
const pauseLabel = (await page.locator('#pause-btn').textContent())?.trim();
if (pauseLabel === 'Continuar') {
  await page.click('#pause-btn');
  await page.waitForTimeout(150);
}
check('A restored game is paused until resumed', pauseLabel === 'Continuar', String(pauseLabel));
await page.click('#mark-btn');
await page.waitForTimeout(120);
const markPressed = await page.locator('#mark-btn').getAttribute('aria-pressed');
check('The mark button toggles a mode', markPressed === 'true');
// Cells must be hidden AND unmarked. Clicking a cell that already carries a flag
// cycles it to a question mark, which is correct behaviour but would make this
// check measure the previous test's leftovers instead of this one's.
const markTargets = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.cell')];
  return els
    .map((c, i) => ({
      i,
      free: !c.classList.contains('is-revealed') && !c.classList.contains('is-flag') && !c.classList.contains('is-question'),
    }))
    .filter((x) => x.free)
    .slice(0, 3)
    .map((x) => x.i);
});
const flagsBefore = await page.locator('.cell.is-flag').count();
const revealedBefore = await page.locator('.cell.is-revealed').count();
const markLog = [];
for (const i of markTargets) {
  // Select by data-index, not by position: nth() would silently address a different
  // cell if the DOM order ever stopped matching the index.
  const loc = page.locator(`.cell[data-index="${i}"]`);
  const vis = await loc.isVisible();
  const covered = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === el || el.contains(top) ? null : (top?.className ?? 'unknown');
  }).catch((e) => `eval-failed: ${e.message}`);
  await loc.click({ timeout: 3000 }).catch((e) => (markLog.push(`cell ${i}: click failed ${e.message.split('\n')[0]}`)));
  await page.waitForTimeout(140);
  const state = await page.evaluate((idx) => {
    const el = document.querySelector(`.cell[data-index="${idx}"]`);
    return el?.className ?? 'missing';
  }, i);
  markLog.push(`cell ${i}: visible=${vis} blocker=${covered ?? 'none'} state=${state}`);
}
if (process.env.DEBUG_MARK) console.log(markLog.join('\n'));
// One tap per distinct cell puts a flag on each. A second tap on the same cell
// would cycle it to a question mark, which is correct behaviour but not what this
// check is about, so the cells are distinct by construction.
const flagsInMarkMode = await page.locator('.cell.is-flag').count();
const revealedAfter = await page.locator('.cell.is-revealed').count();
// Relative, not absolute: a restored game can already carry flags, and this check
// is about the three taps it just made.
check(
  'Mark mode flags instead of revealing',
  flagsInMarkMode === flagsBefore + markTargets.length,
  `${flagsBefore} + ${markTargets.length} -> ${flagsInMarkMode} flags`
);
check('Mark mode opens nothing', revealedAfter === revealedBefore, `${revealedBefore} -> ${revealedAfter}`);

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
