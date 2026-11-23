// src/ui/main.js - Wiring: DOM events to session actions, and the paint loop.
//
// Keyboard contract (also covered by e2e):
//   arrows        move focus
//   Enter/Space   reveal
//   F             cycle mark (flag -> question -> none)
//   C             chord
//   N             new game
//   H             hint
//   P             pause

import {
  createSession,
  sessionReveal,
  sessionMark,
  sessionChord,
  sessionHint,
  sessionApplyHint,
  sessionStats,
  postMortem,
} from './session.js';
import { buildBoard, paint, focusCell, moveBy, labelOf } from './render.js';
import {
  loadSettings,
  saveSettings,
  loadGame,
  saveGame,
  clearGame,
  recordWin,
  bestRecords,
} from './persistence.js';
import { PRESET_LIST } from '../core/presets.js';
import './styles.css';

const $ = (id) => document.getElementById(id);

const els = {
  board: $('board'),
  statMines: $('stat-mines'),
  statTime: $('stat-time'),
  statBv: $('stat-bv'),
  statEff: $('stat-eff'),
  hintBtn: $('hint-btn'),
  pauseBtn: $('pause-btn'),
  newBtn: $('new-game'),
  hintPanel: $('hint-panel'),
  hintTech: $('hint-tech'),
  hintLead: $('hint-lead'),
  hintBody: $('hint-body'),
  boardNote: $('board-note'),
  boardHint: $('board-hint'),
  recordsBody: $('records-body'),
  modeNote: $('mode-note'),
  offlineChip: $('offline-chip'),
  seedLine: $('seed-line'),
  seedValue: $('seed-value'),
};

/** @type {import('./session.js').Session|null} */
let session = null;
/** @type {HTMLButtonElement[]} */
let cells = [];
let focusIndex = 0;
let ticker = null;
let justRevealed = new Set();

const TECH_NAMES = {
  counting: 'conteo',
  subset: 'subconjunto',
  global: 'conteo global',
  enum: 'enumeracion',
};

const now = () => Date.now();

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function currentElapsed() {
  if (!session) return 0;
  if (session.completed) return session.elapsedMs;
  if (!session.startedAt || session.paused) return session.elapsedMs || 0;
  return now() - session.startedAt;
}

function updateStats() {
  if (!session) return;
  const g = session.game;
  els.statMines.textContent = String(Math.max(0, g.mineCount - countFlags(g)));
  els.statTime.textContent = formatTime(currentElapsed());
  els.statBv.textContent = g.minesPlaced ? String(statsCache().threeBV) : '-';
  // Efficiency is 3BV per click. It only means something once the game is over:
  // mid-game the denominator is still growing, and before the first click it is 1.
  const eff = g.status === 'won' ? sessionStats(session).efficiency : null;
  els.statEff.textContent = eff === null ? '-' : `${Math.round(eff)}%`;
}

function countFlags(g) {
  let n = 0;
  for (let i = 0; i < g.size; i++) if (g.marks[i] === 1) n++;
  return n;
}

let cachedStats = null;
let cacheKey = '';
function statsCache() {
  if (!session) return { threeBV: 0, efficiency: null };
  const key = `${session.game.clicks}:${session.game.minesPlaced}:${session.presetId}:${session.seed}:${session.game.status}`;
  if (cacheKey !== key || !cachedStats) {
    const s = sessionStats(session);
    cachedStats = { threeBV: s.threeBV, efficiency: s.efficiency };
    cacheKey = key;
  }
  return cachedStats;
}

function startTicker() {
  stopTicker();
  ticker = setInterval(() => {
    if (!session || session.completed || session.paused) return;
    els.statTime.textContent = formatTime(currentElapsed());
  }, 250);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function paintBoard() {
  if (!session) return;
  paint(cells, session.game, {
    justRevealed,
    exploded: session.exploded,
  });
  justRevealed = new Set();
  focusCell(cells, focusIndex, false);
}

function setBoardNote(text) {
  if (!text) {
    els.boardNote.hidden = true;
    els.boardNote.textContent = '';
    return;
  }
  els.boardNote.hidden = false;
  els.boardNote.textContent = text;
}

function refreshModeUi() {
  const mode = session?.mode ?? loadSettings().mode;
  for (const btn of document.querySelectorAll('[data-mode]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.preset === (session?.presetId ?? loadSettings().preset)));
  }
  els.modeNote.textContent =
    mode === 'noguess'
      ? 'Sin adivinar: cada tablero se genera para resolverse solo con logica. Tiene su propia tabla de records.'
      : 'Clasico: el tablero es aleatorio y puede obligar a adivinar. Sus records van aparte de los del modo sin adivinar.';
}

function setHintPanel(lead, body, tech) {
  if (!lead) {
    els.hintPanel.hidden = true;
    return;
  }
  els.hintPanel.hidden = false;
  els.hintLead.textContent = lead;
  els.hintBody.textContent = body;
  els.hintTech.textContent = tech ?? '';
  els.hintTech.hidden = !tech;
}

function clearHintPanel() {
  els.hintPanel.hidden = true;
}

function newGame(opts = {}) {
  const settings = loadSettings();
  const presetId = opts.presetId ?? settings.preset;
  const mode = opts.mode ?? settings.mode;
  try {
    session = createSession({
      presetId,
      mode,
      seed: opts.seed,
      deadlineMs: mode === 'noguess' ? 250 : undefined,
    });
  } catch (err) {
    els.boardHint.textContent = `No se pudo crear la partida: ${err.message}`;
    return;
  }
  clearGame();
  clearHintPanel();
  justRevealed = new Set();
  focusIndex = 0;
  cachedStats = null;
  cacheKey = '';
  cells = buildBoard(els.board, session.game);
  paintBoard();
  updateStats();
  refreshModeUi();
  startTicker();
  setBoardNote(
    session.fellBack
      ? 'No se consiguio un tablero que el solver pueda probar sin adivinar dentro del presupuesto. Se sirvio un tablero clasico; este no promete resolverse por logica.'
      : ''
  );
  els.boardHint.textContent =
    session.mode === 'noguess'
      ? 'Sin adivinar: cada celda se puede deducir. Flechas para mover, Enter para revelar, F para marcar, C para despejar alrededor.'
      : 'Clasico: puede obligar a adivinar. Flechas para mover, Enter para revelar, F para marcar, C para despejar alrededor.';
  if (session.mode === 'noguess' && !session.fellBack) {
    els.seedLine.hidden = false;
    els.seedValue.textContent = String(session.seed);
  } else {
    els.seedLine.hidden = true;
  }
  saveSettings({ preset: presetId, mode });
  persist();
}

function persist() {
  if (!session || session.completed) {
    clearGame();
    return;
  }
  saveGame({
    presetId: session.presetId,
    mode: session.mode,
    fellBack: session.fellBack,
    elapsedMs: currentElapsed(),
    game: session.game,
  });
}

function afterAction() {
  paintBoard();
  updateStats();
  persist();
  if (session && session.completed) {
    stopTicker();
    finish();
  }
}

function finish() {
  if (!session || !session.completed) return;
  clearGame();
  if (session.game.status === 'won') {
    const stats = sessionStats(session);
    recordWin({
      presetId: session.presetId,
      mode: sessionMode(),
      hintsUsed: stats.hintsUsed,
      timeMs: session.elapsedMs,
      threeBV: stats.threeBV,
      clicks: stats.clicks,
      efficiency: stats.efficiency ?? 0,
    });
    setHintPanel(
      'Ganaste.',
      `Tiempo ${formatTime(session.elapsedMs)}. 3BV ${stats.threeBV}. Eficiencia ${Math.round(stats.efficiency ?? 0)}%. Pistas usadas: ${stats.hintsUsed}.`,
      null
    );
  } else {
    const pm = postMortem(session);
    const parts = [];
    if (pm.wrongFlags.length) {
      parts.push(
        `Banderas mal puestas: ${pm.wrongFlags.map((i) => labelOf(session.game, i)).join(', ')}.`
      );
    }
    if (pm.provable && pm.missedSafe.length) {
      const sample = pm.missedSafe.slice(0, 3);
      parts.push(
        `Tenías ${pm.missedSafe.length} ${pm.missedSafe.length === 1 ? 'celda segura' : 'celdas seguras'} que podias probar: ` +
          sample.map((m) => `${labelOf(session.game, m.cell)} (${m.text})`).join(' | ') +
          (pm.missedSafe.length > sample.length ? ' ...' : '.')
      );
    } else if (pm.provable) {
      parts.push('No habia ninguna celda que el solver pudiera probar segura antes de tu clic: fue una apuesta real.');
    } else {
      parts.push('No hay informacion suficiente para reconstruir el estado previo a la perdida.');
    }
    setHintPanel('Perdiste.', parts.join(' '), null);
  }
  renderRecords();
}

function sessionMode() {
  return session ? session.mode : 'noguess';
}

function onReveal(i) {
  if (!session || session.completed) return;
  const before = new Set();
  const statusBefore = session.game.status;
  const revealedBefore = session.game.revealed;
  sessionReveal(session, i, now);
  for (let k = 0; k < session.game.size; k++) {
    if (revealedBefore[k] === 0 && session.game.revealed[k] === 1) before.add(k);
  }
  justRevealed = before;
  if (statusBefore === 'ready' && !session.startedAt) session.startedAt = now();
  afterAction();
}

function onMark(i) {
  if (!session || session.completed) return;
  sessionMark(session, i);
  afterAction();
}

function onChord(i) {
  if (!session || session.completed) return;
  sessionChord(session, i, now);
  afterAction();
}

function onHint() {
  if (!session || session.completed) return;
  const r = sessionHint(session);
  if (!r.deduction) {
    setHintPanel(
      'Sin pista disponible.',
      'El solver no encuentra ninguna deduccion probada en este tablero. Si queres seguir, tendrias que apostar, y el juego no va a presentar una apuesta como si fuera una prueba.',
      null
    );
    return;
  }
  setHintPanel('Pista', `${r.deduction.text} (tecnica: ${TECH_NAMES[r.deduction.technique] ?? r.deduction.technique})`, TECH_NAMES[r.deduction.technique]);
  // Highlight the cells the deduction is about.
  for (const c of r.deduction.cells) {
    cells[c]?.classList.add('was-just-revealed');
  }
  sessionApplyHint(session, r.deduction, now);
  afterAction();
}

function togglePause() {
  if (!session || session.completed) return;
  if (!session.paused) {
    session.elapsedMs = session.startedAt ? now() - session.startedAt : 0;
    session.paused = true;
    els.pauseBtn.textContent = 'Continuar';
    els.pauseBtn.setAttribute('aria-pressed', 'true');
    els.boardHint.textContent = 'Partida en pausa. El cronometro esta detenido y el tablero no responde.';
    setBoardNote('Pausado');
  } else {
    session.startedAt = now() - session.elapsedMs;
    session.paused = false;
    els.pauseBtn.textContent = 'Pausar';
    els.pauseBtn.setAttribute('aria-pressed', 'false');
    setBoardNote('');
    els.boardHint.textContent = 'Continuacion. Flechas para mover, Enter para revelar, F para marcar.';
  }
  updateStats();
}

function onKeyDown(e) {
  if (!session) return;
  const target = e.target.closest?.('.cell');
  if (!target) return;
  const i = Number(target.dataset.index);
  if (!Number.isInteger(i)) return;
  focusIndex = i;
  const g = session.game;

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      focusIndex = moveBy(g, i, -1, 0);
      focusCell(cells, focusIndex);
      break;
    case 'ArrowRight':
      e.preventDefault();
      focusIndex = moveBy(g, i, 1, 0);
      focusCell(cells, focusIndex);
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusIndex = moveBy(g, i, 0, -1);
      focusCell(cells, focusIndex);
      break;
    case 'ArrowDown':
      e.preventDefault();
      focusIndex = moveBy(g, i, 0, 1);
      focusCell(cells, focusIndex);
      break;
    case 'Home':
      e.preventDefault();
      focusIndex = moveBy(g, i, -g.width, 0);
      focusCell(cells, focusIndex);
      break;
    case 'End':
      e.preventDefault();
      focusIndex = moveBy(g, i, g.width, 0);
      focusCell(cells, focusIndex);
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      onReveal(i);
      focusCell(cells, i);
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      onMark(i);
      focusCell(cells, i);
      break;
    case 'c':
    case 'C':
      e.preventDefault();
      onChord(i);
      focusCell(cells, i);
      break;
    case 'n':
    case 'N':
      e.preventDefault();
      newGame();
      break;
    case 'h':
    case 'H':
      e.preventDefault();
      onHint();
      break;
    case 'p':
    case 'P':
      e.preventDefault();
      togglePause();
      break;
    default:
      break;
  }
}

function wireEvents() {
  els.board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !session) return;
    const i = Number(cell.dataset.index);
    if (!Number.isInteger(i)) return;
    focusIndex = i;
    if (session.game.revealed[i] === 1) onChord(i);
    else onReveal(i);
  });

  els.board.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !session) return;
    e.preventDefault();
    const i = Number(cell.dataset.index);
    if (!Number.isInteger(i)) return;
    focusIndex = i;
    onMark(i);
  });

  els.board.addEventListener('dblclick', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || !session) return;
    const i = Number(cell.dataset.index);
    if (!Number.isInteger(i)) return;
    onChord(i);
  });

  els.board.addEventListener('keydown', onKeyDown);

  els.hintBtn.addEventListener('click', onHint);
  els.pauseBtn.addEventListener('click', togglePause);
  els.newBtn.addEventListener('click', () => newGame());

  for (const btn of document.querySelectorAll('[data-mode]')) {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      saveSettings({ mode });
      newGame({ mode });
    });
  }
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => {
      const presetId = btn.dataset.preset;
      saveSettings({ preset: presetId });
      newGame({ presetId });
    });
  }

  window.addEventListener('beforeunload', () => {
    persist();
  });

  // Offline indicator: honest about the network, not decorative.
  const updateOnline = () => {
    const online = navigator.onLine;
    els.offlineChip.classList.toggle('chip--offline', !online);
    els.offlineChip.lastChild.textContent = online ? ' Campo local - sin conexion' : ' Sin red - jugando offline';
  };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // A failed service worker must not break the game.
    });
  }
}

function renderRecords() {
  const rows = [];
  for (const preset of PRESET_LIST) {
    for (const mode of ['noguess', 'classic']) {
      const rec = bestRecords(preset.id, mode);
      const clean = rec.clean ? `${formatTime(rec.clean.timeMs)} · 3BV ${rec.clean.threeBV}` : null;
      const hinted = rec.hinted
        ? `${formatTime(rec.hinted.timeMs)} · ${rec.hinted.hintsUsed} pista${rec.hinted.hintsUsed === 1 ? '' : 's'}`
        : null;
      rows.push({ preset: preset.label, mode: mode === 'noguess' ? 'Sin adivinar' : 'Clasico', clean, hinted });
    }
  }
  els.recordsBody.innerHTML = '';
  let any = false;
  for (const row of rows) {
    const tr = document.createElement('tr');
    const cell = (text, cls) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      return td;
    };
    tr.appendChild(cell(row.preset));
    tr.appendChild(cell(row.mode));
    tr.appendChild(row.clean ? cell(row.clean) : cell('Sin record', 'records__empty'));
    tr.appendChild(row.hinted ? cell(row.hinted) : cell('Sin record', 'records__empty'));
    els.recordsBody.appendChild(tr);
    if (row.clean || row.hinted) any = true;
  }
}

function restoreOrNew() {
  const snapshot = loadGame();
  if (snapshot) {
    try {
      session = {
        game: snapshot.game,
        presetId: snapshot.presetId,
        mode: snapshot.mode,
        fellBack: snapshot.fellBack,
        paused: true,
        startedAt: 0,
        elapsedMs: snapshot.elapsedMs || 0,
        seed: snapshot.game.seed,
        exploded: null,
        completed: snapshot.game.status === 'won' || snapshot.game.status === 'lost',
        preLoss: null,
      };
      cells = buildBoard(els.board, session.game);
      paintBoard();
      updateStats();
      refreshModeUi();
      if (!session.completed) {
        session.paused = true;
        els.pauseBtn.textContent = 'Continuar';
        els.pauseBtn.setAttribute('aria-pressed', 'true');
        setBoardNote('Partida recuperada. Pulsa Continuar para seguir jugando.');
      }
      return;
    } catch {
      clearGame();
    }
  }
  newGame();
}

// Boot.
wireEvents();
renderRecords();
restoreOrNew();
