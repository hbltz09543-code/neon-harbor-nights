// The screens drawn over the live city: the title (logo, Continue / New Game, controls, story), the
// pause menu, BUSTED, WASTED and the ending. Each draw function returns the clickable buttons it
// drew, in canvas pixels, so main.js can hit-test the mouse against them.
import { COLORS } from './config.js';

export const CONTROLS = [
  ['W A S D / Arrows', 'walk · drive'],
  ['Shift', 'sprint'],
  ['Mouse · click / hold', 'aim · fire (on foot)'],
  ['R', 'reload'],
  ['E', 'enter / leave a car'],
  ['Space', 'handbrake (drift)'],
  ['M', 'sound on / off'],
  ['P / Esc', 'pause'],
];

const STORY =
  'Port Azura, golden hour. Jett Marlowe runs parcels across a city that glows from the beach to the docks, and owes money on every block of it. ' +
  'Vera Solano, a fixer who works out of the Repaint & Repair garage, has driving jobs for anyone fast and quiet. Pay it back one fare at a time.';

const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Splits `text` into lines no wider than `width` in the current font. */
function wrapText(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const attempt = line ? `${line} ${word}` : word;
    if (ctx.measureText(attempt).width > width && line) {
      lines.push(line);
      line = word;
    } else line = attempt;
  }
  if (line) lines.push(line);
  return lines;
}

function neonText(ctx, text, x, y, size, color, glow, flicker = 1) {
  ctx.font = `italic 900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = flicker;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.strokeStyle = color;
  ctx.strokeText(text, x, y);
  ctx.shadowBlur = glow * 0.5;
  ctx.fillStyle = 'rgba(255,250,240,0.95)';
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawButton(ctx, x, y, w, h, label, selected, u, time) {
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = selected ? 'rgba(255,79,163,0.9)' : 'rgba(30,16,32,0.75)';
  if (selected) {
    ctx.shadowColor = COLORS.uiPink;
    ctx.shadowBlur = 18 * u + Math.sin(time * 4) * 6 * u;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = selected ? '#fff4dc' : 'rgba(255,244,220,0.45)';
  ctx.stroke();
  ctx.fillStyle = COLORS.ui;
  ctx.font = `800 ${Math.round(h * 0.42)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
  return { x, y, w, h };
}

function drawPanel(ctx, x, y, w, h, u) {
  roundRect(ctx, x, y, w, h, 14 * u);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,63,0.35)';
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
}

function drawControls(ctx, x, y, w, u) {
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(15 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.uiGold;
  ctx.textAlign = 'left';
  ctx.fillText('CONTROLS', x, y);
  const row = 22 * u;
  CONTROLS.forEach(([keys, what], index) => {
    const ry = y + row * (index + 1.15);
    ctx.font = `700 ${Math.round(14 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.ui;
    ctx.textAlign = 'left';
    ctx.fillText(keys, x, ry);
    ctx.fillStyle = COLORS.uiDim;
    ctx.textAlign = 'right';
    ctx.fillText(what, x + w, ry);
  });
}

/** Formats seconds as m:ss (or h:mm:ss past an hour). */
export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Formats a cash amount: $1,250. */
export function formatCash(amount) {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

/**
 * The title screen over the orbiting city: logo, Continue (when there is a save) and New Game,
 * the controls and the story. Returns [{ x, y, w, h, action }].
 */
export function drawTitle(ctx, width, height, time, selected, hasSave = false) {
  const u = Math.min(height / 900, width / 1400);
  ctx.save();
  // A dusky band behind the logo so it reads over any part of the city.
  const band = ctx.createLinearGradient(0, 0, 0, height * 0.55);
  band.addColorStop(0, 'rgba(40,14,40,0.78)');
  band.addColorStop(1, 'rgba(40,14,40,0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, width, height * 0.55);
  const foot = ctx.createLinearGradient(0, height * 0.6, 0, height);
  foot.addColorStop(0, 'rgba(30,12,30,0)');
  foot.addColorStop(1, 'rgba(30,12,30,0.7)');
  ctx.fillStyle = foot;
  ctx.fillRect(0, height * 0.6, width, height * 0.4);

  // Setting sun disc behind the logo, sliced like an old postcard.
  const cx = width / 2;
  const sunY = 200 * u;
  const sun = ctx.createLinearGradient(0, sunY - 120 * u, 0, sunY + 120 * u);
  sun.addColorStop(0, '#ffd23f');
  sun.addColorStop(0.55, '#ff7b3f');
  sun.addColorStop(1, '#ff4fa3');
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, sunY, 120 * u, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = sun;
  ctx.fillRect(cx - 120 * u, sunY - 120 * u, 240 * u, 240 * u);
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 6; k += 1) {
    const sy = sunY + 10 * u + k * 19 * u;
    ctx.fillRect(cx - 130 * u, sy, 260 * u, (3 + k * 1.6) * u);
  }
  ctx.restore();

  const flicker = Math.sin(time * 9.3) > 0.97 ? 0.55 : 1;
  neonText(ctx, 'NEON HARBOR', cx, 165 * u, Math.round(92 * u), COLORS.uiPink, 26 * u, flicker);
  neonText(ctx, 'NIGHTS', cx, 255 * u, Math.round(86 * u), COLORS.uiCyan, 26 * u);
  ctx.font = `700 ${Math.round(17 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.uiGold;
  ctx.textAlign = 'center';
  ctx.fillText('·  A  PORT  AZURA  STORY  ·', cx, 322 * u);

  const buttons = [];
  const bw = 270 * u;
  const bh = 54 * u;
  const labels = hasSave ? [['CONTINUE', 'continue'], ['NEW GAME', 'new']] : [['NEW GAME', 'new']];
  labels.forEach(([label, action], index) => {
    const button = drawButton(ctx, cx - bw / 2, 362 * u + index * (bh + 12 * u), bw, bh, label, selected === index, u, time);
    buttons.push({ ...button, action });
  });
  ctx.font = `600 ${Math.round(14 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.uiDim;
  ctx.textAlign = 'center';
  const hint = hasSave ? 'Arrows to choose · Enter or click to start · New Game wipes the save' : 'Press Enter or click to start';
  ctx.fillText(hint, cx, 362 * u + labels.length * (bh + 12 * u) + 14 * u);

  // Controls (left) and story (right) panels along the bottom.
  const panelW = 380 * u;
  const panelH = 228 * u;
  const panelY = height - panelH - 34 * u;
  const leftX = Math.max(24 * u, cx - panelW - 30 * u);
  const rightX = Math.min(width - panelW - 24 * u, cx + 30 * u);
  drawPanel(ctx, leftX, panelY, panelW, panelH, u);
  drawControls(ctx, leftX + 24 * u, panelY + 28 * u, panelW - 48 * u, u);
  drawPanel(ctx, rightX, panelY, panelW, panelH, u);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(15 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.uiGold;
  ctx.fillText('THE STORY', rightX + 24 * u, panelY + 28 * u);
  ctx.font = `500 ${Math.round(14 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.ui;
  wrapText(ctx, STORY, panelW - 48 * u).forEach((line, index) => {
    ctx.fillText(line, rightX + 24 * u, panelY + 58 * u + index * 21 * u);
  });
  ctx.restore();
  return buttons;
}

/** The pause menu: Resume and Back to title. Returns [{ x, y, w, h, action }]. */
export function drawPause(ctx, width, height, time, selected) {
  const u = Math.min(height / 900, width / 1400);
  ctx.save();
  ctx.fillStyle = 'rgba(30,12,30,0.55)';
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  neonText(ctx, 'PAUSED', cx, height / 2 - 190 * u, Math.round(70 * u), COLORS.uiCyan, 22 * u);
  const bw = 270 * u;
  const bh = 54 * u;
  const buttons = [];
  ['RESUME', 'BACK TO TITLE'].forEach((label, index) => {
    const b = drawButton(ctx, cx - bw / 2, height / 2 - 120 * u + index * (bh + 16 * u), bw, bh, label, selected === index, u, time);
    buttons.push({ ...b, action: index === 0 ? 'resume' : 'title' });
  });
  const panelW = 380 * u;
  const panelH = 228 * u;
  drawPanel(ctx, cx - panelW / 2, height / 2 + 30 * u, panelW, panelH, u);
  drawControls(ctx, cx - panelW / 2 + 24 * u, height / 2 + 58 * u, panelW - 48 * u, u);
  ctx.restore();
  return buttons;
}

/** A full-screen verdict (BUSTED, WASTED): tinted backdrop, neon word, a few lines of detail, one button. */
function drawVerdict(ctx, width, height, time, word, color, tint, lines, buttonLabel) {
  const u = Math.min(height / 900, width / 1400);
  ctx.save();
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const flicker = Math.sin(time * 11) > 0.96 ? 0.6 : 1;
  neonText(ctx, word, cx, height / 2 - 120 * u, Math.round(110 * u), color, 30 * u, flicker);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.font = `${index === 0 ? 800 : 600} ${Math.round((index === 0 ? 20 : 16) * u)}px ${FONT}`;
    ctx.fillStyle = index === 0 ? COLORS.ui : COLORS.uiDim;
    ctx.fillText(line, cx, height / 2 - 20 * u + index * 30 * u);
  });
  const bw = 270 * u;
  const bh = 54 * u;
  const button = drawButton(ctx, cx - bw / 2, height / 2 + 90 * u, bw, bh, buttonLabel, true, u, time);
  ctx.font = `600 ${Math.round(13 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.uiDim;
  ctx.fillText('Press Enter or click', cx, height / 2 + 165 * u);
  ctx.restore();
  return [{ ...button, action: 'continue' }];
}

/** BUSTED: the fine, the cleared wanted level, the respawn at the station. `info`: { fine, mission }. */
export function drawBusted(ctx, width, height, time, info) {
  const lines = [`Fine paid: ${formatCash(info.fine)}  ·  wanted level cleared`, 'You walk out of the Azura PD station on the Midtown corner.'];
  if (info.mission) lines.push(`Mission failed: ${info.mission}`);
  return drawVerdict(ctx, width, height, time, 'BUSTED', '#3f9bff', 'rgba(16,24,58,0.62)', lines, 'CONTINUE');
}

/** WASTED: the hospital bill and the respawn. `info`: { fine, mission }. */
export function drawWasted(ctx, width, height, time, info) {
  const lines = [`Hospital bill: ${formatCash(info.fine)}  ·  wanted level cleared`, 'You come round at Port Azura General, patched up.'];
  if (info.mission) lines.push(`Mission failed: ${info.mission}`);
  return drawVerdict(ctx, width, height, time, 'WASTED', '#ff4a5a', 'rgba(58,14,20,0.66)', lines, 'CONTINUE');
}

const EPILOGUE =
  'The ferry pulls away from the marina with Vera at the rail and the sirens shrinking behind you. Every dollar Jett owed is paid. ' +
  'Port Azura glows on, and Dispatch still has parcels for anyone fast and quiet.';

/** The ending: "The debt is paid", the epilogue, play stats and Keep roaming. `stats`: world.stats. */
export function drawEnding(ctx, width, height, time, stats) {
  const u = Math.min(height / 900, width / 1400);
  ctx.save();
  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, 'rgba(60,16,56,0.85)');
  wash.addColorStop(1, 'rgba(255,120,80,0.55)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  neonText(ctx, 'THE DEBT IS PAID', cx, 150 * u, Math.round(78 * u), COLORS.uiPink, 26 * u);
  ctx.font = `700 ${Math.round(17 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.uiGold;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('·  LAST FERRY OUT  ·', cx, 220 * u);
  const panelW = 560 * u;
  const panelH = 300 * u;
  const px = cx - panelW / 2;
  const py = 260 * u;
  drawPanel(ctx, px, py, panelW, panelH, u);
  ctx.textAlign = 'left';
  ctx.font = `500 ${Math.round(15 * u)}px ${FONT}`;
  ctx.fillStyle = COLORS.ui;
  const lines = wrapText(ctx, EPILOGUE, panelW - 60 * u);
  lines.forEach((line, index) => ctx.fillText(line, px + 30 * u, py + 40 * u + index * 23 * u));
  const rows = [
    ['Time played', formatTime(stats.playTime)],
    ['Cash earned', formatCash(stats.totalEarned)],
    ['Courier jobs done', String(stats.jobsDone)],
    ['Cash in hand', formatCash(stats.cash)],
  ];
  const top = py + 60 * u + lines.length * 23 * u;
  rows.forEach(([label, value], index) => {
    const ry = top + index * 30 * u;
    ctx.font = `700 ${Math.round(16 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.uiDim;
    ctx.textAlign = 'left';
    ctx.fillText(label, px + 30 * u, ry);
    ctx.fillStyle = COLORS.uiGold;
    ctx.textAlign = 'right';
    ctx.fillText(value, px + panelW - 30 * u, ry);
  });
  const bw = 270 * u;
  const bh = 54 * u;
  const button = drawButton(ctx, cx - bw / 2, py + panelH + 34 * u, bw, bh, 'KEEP ROAMING', true, u, time);
  ctx.restore();
  return [{ ...button, action: 'roam' }];
}
