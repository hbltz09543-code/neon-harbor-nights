// The HUD over the world, in canvas pixels: cash and health (top left), wanted stars with the
// lay-low meter (top right), the mission banner with its timer (top centre), the minimap of the
// whole of Port Azura (bottom right) with Vera's phone messages sliding in above it, the pistol and
// ammo or the speedometer and car health (bottom left), the context prompt (bottom centre), the
// BUSTED meter, the mission-failed panel, short "mission passed" toasts and the red flash when
// Jett is hurt. drawHud returns the clickable buttons it drew (the fail panel's), like screens.js.
import { BLAST, CAR, COLORS, HEALTH, POLICE, RESPRAY, ROAD, SHORE, WEAPON, WORLD } from './config.js';
import { ROAD_BOUNDS, roadX, roadY } from './city.js';
import { formatCash, formatTime } from './screens.js';
import { viewRect } from './camera.js';

const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
const MAP_W = 224;
const MAP_H = 150;
const TOAST_TIME = 3.4;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Text with a dark outline so it reads over any part of the city. */
function outlined(ctx, text, x, y, size, color, weight = 800, align = 'left') {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.strokeStyle = 'rgba(30,12,30,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function panel(ctx, x, y, w, h, u, border = 'rgba(255,210,63,0.35)') {
  roundRect(ctx, x, y, w, h, 10 * u);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5 * u;
  ctx.stroke();
}

function bar(ctx, x, y, w, h, fraction, color, u) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(30,12,30,0.75)';
  ctx.fill();
  const f = Math.max(0, Math.min(1, fraction));
  if (f > 0) {
    roundRect(ctx, x + 2 * u, y + 2 * u, Math.max(h - 4 * u, (w - 4 * u) * f), h - 4 * u, (h - 4 * u) / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function star(ctx, cx, cy, r, filled, color) {
  ctx.beginPath();
  for (let k = 0; k < 10; k += 1) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 === 0 ? r : r * 0.45;
    if (k === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.strokeStyle = 'rgba(30,12,30,0.9)';
  ctx.stroke();
  ctx.fillStyle = filled ? color : 'rgba(255,244,220,0.18)';
  ctx.fill();
}

/** Paints the static minimap (whole city) into a canvas of w×h pixels. */
function bakeMinimap(city, w, h) {
  const layer = document.createElement('canvas');
  layer.width = Math.ceil(w);
  layer.height = Math.ceil(h);
  const g = layer.getContext('2d');
  g.scale(w / WORLD.width, h / WORLD.height);
  g.fillStyle = COLORS.minimapBlock;
  g.fillRect(0, 0, WORLD.width, WORLD.height);
  g.fillStyle = COLORS.minimapYard;
  g.fillRect(0, SHORE.docksY, SHORE.sandX, SHORE.quayY - SHORE.docksY);
  g.fillStyle = COLORS.minimapSand;
  g.fillRect(SHORE.sandX, 0, SHORE.waterX - SHORE.sandX, SHORE.quayY);
  g.fillStyle = COLORS.minimapPark;
  for (const park of city.parks) g.fillRect(park.inner.x, park.inner.y, park.inner.w, park.inner.h);
  g.fillStyle = COLORS.minimapBuilding;
  for (const b of city.buildings) g.fillRect(b.x, b.y, b.w, b.h);
  g.fillStyle = COLORS.minimapRoad;
  const half = ROAD.width / 2;
  for (let i = 0; i < ROAD.columns; i += 1) g.fillRect(roadX(i) - half, ROAD_BOUNDS.minY, ROAD.width, ROAD_BOUNDS.maxY - ROAD_BOUNDS.minY);
  for (let j = 0; j < ROAD.rows; j += 1) g.fillRect(ROAD_BOUNDS.minX, roadY(j) - half, ROAD_BOUNDS.maxX - ROAD_BOUNDS.minX, ROAD.width);
  g.fillStyle = COLORS.minimapWater;
  g.fillRect(SHORE.waterX, 0, WORLD.width - SHORE.waterX, WORLD.height);
  g.fillRect(0, SHORE.quayY, WORLD.width, WORLD.height - SHORE.quayY);
  // Vera's garage apron, so home is easy to find.
  const apron = city.garage.apron;
  g.fillStyle = 'rgba(255,79,163,0.75)';
  g.fillRect(apron.x, apron.y, apron.w, apron.h);
  return layer;
}

export function createHud() {
  let minimap = null;
  let minimapKey = '';
  const toasts = []; // { title, sub, color, age }

  function drawMinimap(ctx, world, x, y, w, h, u) {
    const key = `${world.city.seed}:${Math.round(w)}x${Math.round(h)}`;
    if (key !== minimapKey) {
      minimap = bakeMinimap(world.city, w, h);
      minimapKey = key;
    }
    const time = world.time;
    ctx.save();
    // Frame and caption.
    roundRect(ctx, x - 5 * u, y - 5 * u, w + 10 * u, h + 26 * u, 9 * u);
    ctx.fillStyle = 'rgba(30,16,32,0.82)';
    ctx.fill();
    ctx.strokeStyle = COLORS.uiCyan;
    ctx.lineWidth = 1.5 * u;
    ctx.shadowColor = COLORS.uiCyan;
    ctx.shadowBlur = 8 * u;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.drawImage(minimap, x, y, w, h);
    ctx.font = `800 ${Math.round(11 * u)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.uiGold;
    ctx.fillText('P O R T   A Z U R A', x + w / 2, y + h + 11 * u);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const sx = w / WORLD.width;
    const sy = h / WORLD.height;
    // The camera's view as a faint frame.
    const view = viewRect(world.camera);
    ctx.strokeStyle = 'rgba(255,244,220,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + view.x * sx, y + view.y * sy, view.w * sx, view.h * sy);
    // Mission markers.
    for (const m of world.missions.markers) {
      const mx = x + m.x * sx;
      const my = y + m.y * sy;
      const pulse = 0.5 + Math.sin(time * 5) * 0.5;
      ctx.fillStyle = m.color;
      ctx.strokeStyle = 'rgba(30,12,30,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, (m.kind === 'target' ? 4.5 : 4) * u + pulse * 1.2 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (m.glyph) {
        ctx.fillStyle = '#2a1626';
        ctx.font = `900 ${Math.round(7 * u)}px ${FONT}`;
        ctx.fillText(m.glyph, mx, my + 0.5);
      }
    }
    // Police: blinking red and blue.
    for (const car of world.police.cars) {
      const blink = Math.floor(time * 6 + car.id) % 2 === 0;
      ctx.fillStyle = blink ? COLORS.sirenRed : COLORS.sirenBlue;
      ctx.beginPath();
      ctx.arc(x + car.x * sx, y + car.y * sy, 3 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player: an arrow pointing the way they face.
    const player = world.player;
    ctx.translate(x + player.x * sx, y + player.y * sy);
    ctx.rotate(player.angle);
    ctx.beginPath();
    ctx.moveTo(7 * u, 0);
    ctx.lineTo(-4.5 * u, -4.5 * u);
    ctx.lineTo(-2 * u, 0);
    ctx.lineTo(-4.5 * u, 4.5 * u);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = COLORS.uiPink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawCashAndHealth(ctx, world, u) {
    const stats = world.stats;
    const x = 26 * u;
    outlined(ctx, formatCash(stats.cash), x, 34 * u, 30 * u, COLORS.uiGold, 900);
    const fraction = stats.health / HEALTH.max;
    const low = fraction < 0.3;
    const color = low ? (Math.sin(world.time * 8) > 0 ? COLORS.uiRed : '#ff8a8a') : fraction < 0.6 ? '#ffb347' : COLORS.uiGreen;
    bar(ctx, x, 56 * u, 190 * u, 13 * u, fraction, color, u);
    ctx.font = `800 ${Math.round(10 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.ui;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HEALTH', x + 198 * u, 63 * u);
  }

  function drawWanted(ctx, world, width, u, muted) {
    const police = world.police;
    const size = 15 * u;
    const gap = 34 * u;
    const right = width - 30 * u;
    const blinkOff = (police.flash > 0 && Math.floor(police.flash * 8) % 2 === 0) || (police.level > 0 && !police.seen && !police.locked && Math.floor(world.time * 2.5) % 2 === 0);
    for (let k = 0; k < POLICE.maxStars; k += 1) {
      const filled = k < police.level;
      star(ctx, right - (POLICE.maxStars - 1 - k) * gap, 34 * u, size, filled && !blinkOff, COLORS.uiGold);
    }
    let y = 64 * u;
    if (police.level > 0) {
      const left = right - (POLICE.maxStars - 1) * gap - size;
      if (police.locked) {
        outlined(ctx, 'WANTED · LOCKED BY MISSION', right + size, y, 11 * u, COLORS.uiRed, 800, 'right');
      } else if (!police.seen) {
        outlined(ctx, 'LAY LOW', left, y, 11 * u, COLORS.uiCyan, 800, 'left');
        bar(ctx, left + 58 * u, y - 5 * u, right + size - left - 58 * u, 10 * u, police.layLow / police.layLowNeeded(), COLORS.uiCyan, u);
      } else {
        outlined(ctx, 'SPOTTED', right + size, y, 11 * u, COLORS.uiRed, 800, 'right');
      }
      y += 20 * u;
    }
    if (muted) outlined(ctx, 'SOUND OFF  (M)', right + size, y, 11 * u, COLORS.uiDim, 700, 'right');
  }

  function drawObjective(ctx, world, width, u) {
    const objective = world.missions.objective;
    if (!objective) return;
    const w = Math.min(width - 520 * u, 600 * u);
    const x = width / 2 - w / 2;
    const y = 16 * u;
    const h = 58 * u;
    panel(ctx, x, y, w, h, u, 'rgba(255,79,163,0.5)');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `900 ${Math.round(12 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.uiPink;
    ctx.fillText(objective.title.toUpperCase(), x + 18 * u, y + 17 * u);
    ctx.font = `700 ${Math.round(15 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.ui;
    let text = objective.text;
    const room = w - (objective.timer !== null && objective.timer !== undefined ? 110 * u : 36 * u);
    while (ctx.measureText(text).width > room && text.length > 8) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, x + 18 * u, y + 39 * u);
    if (objective.timer !== null && objective.timer !== undefined) {
      const urgent = objective.timer < 10;
      const flash = urgent && Math.floor(world.time * 4) % 2 === 0;
      outlined(ctx, formatTime(Math.ceil(objective.timer)), x + w - 18 * u, y + h / 2, 26 * u, flash ? COLORS.uiRed : urgent ? '#ff9a9a' : COLORS.uiGold, 900, 'right');
    }
  }

  function drawPhone(ctx, world, width, height, u, mapTop) {
    const message = world.missions.message;
    if (!message) return;
    const w = 300 * u;
    ctx.font = `600 ${Math.round(13 * u)}px ${FONT}`;
    const lines = [];
    let line = '';
    for (const word of message.text.split(' ')) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width > w - 70 * u && line) {
        lines.push(line);
        line = word;
      } else line = attempt;
    }
    if (line) lines.push(line);
    const h = 40 * u + lines.length * 18 * u;
    const slide = Math.min(1, message.age / 0.35);
    const ease = 1 - Math.pow(1 - slide, 3);
    const fade = message.age > 8 ? Math.max(0, 1 - (message.age - 8) / 0.5) : 1;
    const x = width - 24 * u - w + (1 - ease) * (w + 40 * u);
    const y = mapTop - h - 14 * u;
    ctx.save();
    ctx.globalAlpha = fade;
    roundRect(ctx, x, y, w, h, 14 * u);
    ctx.fillStyle = 'rgba(22,14,28,0.92)';
    ctx.fill();
    ctx.strokeStyle = COLORS.uiPink;
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    // Avatar bubble with the sender's initial.
    ctx.fillStyle = message.from === 'Vera' ? COLORS.uiPink : COLORS.uiGreen;
    ctx.beginPath();
    ctx.arc(x + 26 * u, y + 24 * u, 13 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a1626';
    ctx.font = `900 ${Math.round(14 * u)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message.from[0], x + 26 * u, y + 25 * u);
    ctx.textAlign = 'left';
    ctx.font = `900 ${Math.round(11 * u)}px ${FONT}`;
    ctx.fillStyle = message.from === 'Vera' ? COLORS.uiPink : COLORS.uiGreen;
    ctx.fillText(message.from === 'Vera' ? 'VERA SOLANO' : message.from.toUpperCase(), x + 50 * u, y + 18 * u);
    if (message.tag) {
      // Which story mission the text is about, on the header line's right.
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.uiGold;
      ctx.fillText(`— ${message.tag}`, x + w - 16 * u, y + 18 * u);
      ctx.textAlign = 'left';
    }
    ctx.font = `600 ${Math.round(13 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.ui;
    lines.forEach((text, index) => ctx.fillText(text, x + 50 * u, y + 38 * u + index * 18 * u));
    ctx.restore();
  }

  function drawPistolIcon(ctx, x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = COLORS.ui;
    ctx.strokeStyle = 'rgba(30,12,30,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(34, 0);
    ctx.lineTo(34, 8);
    ctx.lineTo(14, 8);
    ctx.lineTo(16, 12);
    ctx.lineTo(12, 22);
    ctx.lineTo(4, 22);
    ctx.lineTo(7, 9);
    ctx.lineTo(0, 8);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  function drawWeaponOrCar(ctx, world, height, u) {
    const player = world.player;
    const x = 26 * u;
    const bottom = height - 26 * u;
    if (player.mode === 'foot') {
      const weapon = world.combat.weapon;
      panel(ctx, x, bottom - 62 * u, 200 * u, 62 * u, u);
      drawPistolIcon(ctx, x + 16 * u, bottom - 44 * u, 1.3 * u);
      if (weapon.reloading > 0) {
        outlined(ctx, 'RELOADING', x + 80 * u, bottom - 40 * u, 13 * u, COLORS.uiCyan, 800);
        bar(ctx, x + 80 * u, bottom - 26 * u, 104 * u, 9 * u, 1 - weapon.reloading / WEAPON.reload, COLORS.uiCyan, u);
      } else {
        outlined(ctx, String(weapon.ammo), x + 80 * u, bottom - 31 * u, 30 * u, weapon.ammo === 0 ? COLORS.uiRed : COLORS.ui, 900);
        outlined(ctx, `/ ${WEAPON.magazine}`, x + 80 * u + (weapon.ammo >= 10 ? 38 : 22) * u, bottom - 26 * u, 14 * u, COLORS.uiDim, 700);
      }
      return;
    }
    const car = player.car;
    const r = 52 * u;
    const cx = x + r + 8 * u;
    const cy = bottom - r - 22 * u;
    panel(ctx, x, cy - r - 14 * u, 2 * r + 120 * u, 2 * r + 50 * u, u);
    const start = Math.PI * 0.8;
    const sweep = Math.PI * 1.4;
    const fraction = Math.min(1, Math.abs(car.speed) / (car.spec.top * 1.05));
    ctx.lineCap = 'round';
    ctx.lineWidth = 7 * u;
    ctx.strokeStyle = 'rgba(255,244,220,0.15)';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6 * u, start, start + sweep);
    ctx.stroke();
    const arc = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    arc.addColorStop(0, COLORS.uiCyan);
    arc.addColorStop(1, COLORS.uiPink);
    ctx.strokeStyle = arc;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 6 * u, start, start + sweep * fraction);
    ctx.stroke();
    ctx.lineCap = 'butt';
    const needle = start + sweep * fraction;
    ctx.strokeStyle = COLORS.ui;
    ctx.lineWidth = 2.5 * u;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(needle) * (r - 14 * u), cy + Math.sin(needle) * (r - 14 * u));
    ctx.stroke();
    outlined(ctx, String(Math.round(Math.abs(car.speed) * 0.36)), cx, cy + 18 * u, 22 * u, COLORS.ui, 900, 'center');
    outlined(ctx, 'MPH', cx, cy + 36 * u, 10 * u, COLORS.uiDim, 800, 'center');
    const hx = cx + r + 12 * u;
    outlined(ctx, car.spec.name.toUpperCase(), hx, cy - 22 * u, 12 * u, COLORS.uiGold, 800);
    outlined(ctx, 'CAR', hx, cy + 2 * u, 10 * u, COLORS.uiDim, 800);
    const health = 1 - car.damage / CAR.maxDamage;
    const color = car.burning ? (Math.floor(world.time * 6) % 2 ? COLORS.uiRed : '#ffb347') : health < 0.35 ? COLORS.uiRed : health < 0.65 ? '#ffb347' : COLORS.uiGreen;
    bar(ctx, hx, cy + 12 * u, 96 * u, 11 * u, health, color, u);
    if (car.burning) outlined(ctx, 'ON FIRE!', hx, cy + 38 * u, 12 * u, COLORS.uiRed, 900);
    else if (car.damage >= BLAST.fireAt - 20) outlined(ctx, 'SMOKING', hx, cy + 38 * u, 11 * u, '#ffb347', 800);
  }

  /** The prompt for whatever the player can do right here. */
  function contextPrompt(world) {
    const player = world.player;
    if (player.mode === 'foot') {
      if (world.enterableCar) return world.enterableCar.owned ? 'E — Enter car' : world.enterableCar.driver ? 'E — Carjack' : 'E — Enter car (steal)';
      const weapon = world.combat.weapon;
      if (weapon.reloading <= 0 && weapon.ammo < WEAPON.magazine && weapon.ammo <= 3) return 'R — Reload';
      return null;
    }
    const apron = world.city.garage.apron;
    const car = player.car;
    if (car.x > apron.x && car.x < apron.x + apron.w && car.y > apron.y && car.y < apron.y + apron.h && (world.police.level > 0 || car.damage >= 5) && !world.police.locked) {
      return world.stats.cash >= RESPRAY.cost ? `Stop here: Repaint & Repair, ${formatCash(RESPRAY.cost)}` : `Repaint & Repair costs ${formatCash(RESPRAY.cost)}`;
    }
    if (car.burning) return 'E — Bail out!';
    return null;
  }

  function drawPrompt(ctx, world, width, height, u) {
    const text = contextPrompt(world);
    if (!text) return;
    ctx.font = `800 ${Math.round(16 * u)}px ${FONT}`;
    const w = ctx.measureText(text).width + 36 * u;
    const h = 34 * u;
    const x = width / 2 - w / 2;
    const y = height - 92 * u;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(30,16,32,0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,244,220,0.5)';
    ctx.lineWidth = 1.5 * u;
    ctx.stroke();
    ctx.fillStyle = COLORS.ui;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, y + h / 2 + 1);
  }

  function drawBustMeter(ctx, world, width, height, u) {
    const bust = world.police.bust;
    if (bust <= 0) return;
    const w = 260 * u;
    const x = width / 2 - w / 2;
    const y = height * 0.62;
    outlined(ctx, 'BUSTED', width / 2, y - 16 * u, 22 * u, Math.floor(world.time * 6) % 2 ? '#3f9bff' : COLORS.uiRed, 900, 'center');
    bar(ctx, x, y, w, 16 * u, bust / POLICE.bustTime, '#3f9bff', u);
    ctx.font = `700 ${Math.round(11 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.uiDim;
    ctx.textAlign = 'center';
    ctx.fillText('Keep moving!', width / 2, y + 30 * u);
  }

  function drawFailPanel(ctx, world, width, height, u, selected) {
    const failed = world.missions.failed;
    if (!failed) return [];
    const w = 420 * u;
    const h = 150 * u;
    const x = width / 2 - w / 2;
    const y = height * 0.24;
    panel(ctx, x, y, w, h, u, 'rgba(255,74,90,0.7)');
    outlined(ctx, 'MISSION FAILED', width / 2, y + 28 * u, 24 * u, COLORS.uiRed, 900, 'center');
    ctx.font = `700 ${Math.round(14 * u)}px ${FONT}`;
    ctx.fillStyle = COLORS.ui;
    ctx.textAlign = 'center';
    ctx.fillText(`${failed.title}: ${failed.reason}`, width / 2, y + 58 * u);
    const buttons = [];
    const bw = 170 * u;
    const bh = 38 * u;
    [
      ['RETRY  (Enter)', 'retry'],
      ['LATER  (X)', 'dismiss'],
    ].forEach(([label, action], index) => {
      const bx = width / 2 - bw - 8 * u + index * (bw + 16 * u);
      const by = y + h - bh - 18 * u;
      const hot = selected === index;
      roundRect(ctx, bx, by, bw, bh, bh / 2);
      ctx.fillStyle = hot ? 'rgba(255,79,163,0.9)' : 'rgba(30,16,32,0.85)';
      ctx.fill();
      ctx.strokeStyle = hot ? COLORS.ui : 'rgba(255,244,220,0.45)';
      ctx.lineWidth = 1.5 * u;
      ctx.stroke();
      ctx.fillStyle = COLORS.ui;
      ctx.font = `800 ${Math.round(14 * u)}px ${FONT}`;
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
      buttons.push({ x: bx, y: by, w: bw, h: bh, action });
    });
    return buttons;
  }

  function drawToasts(ctx, width, height, u, dt) {
    for (let k = toasts.length - 1; k >= 0; k -= 1) {
      toasts[k].age += dt;
      if (toasts[k].age > TOAST_TIME) toasts.splice(k, 1);
    }
    const toast = toasts[0];
    if (!toast) return;
    const t = toast.age;
    const alpha = Math.min(1, t / 0.2, (TOAST_TIME - t) / 0.4);
    const scale = 1 + Math.max(0, 0.25 - t) * 1.2;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(width / 2, height * 0.36);
    ctx.scale(scale, scale);
    ctx.shadowColor = toast.color;
    ctx.shadowBlur = 18 * u;
    outlined(ctx, toast.title, 0, 0, 40 * u, toast.color, 900, 'center');
    ctx.shadowBlur = 0;
    if (toast.sub) outlined(ctx, toast.sub, 0, 38 * u, 22 * u, COLORS.uiGold, 800, 'center');
    ctx.restore();
  }

  function drawHurt(ctx, world, width, height) {
    const flash = world.combat.hurtFlash;
    const low = world.stats.health < HEALTH.max * 0.3 ? 0.25 + Math.sin(world.time * 5) * 0.1 : 0;
    const amount = Math.max(flash * 0.6, low);
    if (amount <= 0.01) return;
    const radius = Math.hypot(width, height) / 2;
    const g = ctx.createRadialGradient(width / 2, height / 2, radius * 0.45, width / 2, height / 2, radius);
    g.addColorStop(0, 'rgba(255,30,50,0)');
    g.addColorStop(1, `rgba(200,10,30,${amount.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  return {
    /** Shows a big centred message for a few seconds ("MISSION PASSED", "+$300"). */
    notify(title, sub = '', color = COLORS.uiPink) {
      toasts.length = 0;
      toasts.push({ title, sub, color, age: 0 });
    },
    /**
     * Draws the HUD for `world` over the frame. `options`: { muted, dt (real seconds since the last
     * frame, for the toasts), selected (highlighted fail-panel button) }. Returns the buttons drawn.
     */
    draw(ctx, width, height, world, options = {}) {
      const u = Math.min(height / 900, width / 1400) * 1.1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawHurt(ctx, world, width, height);
      drawCashAndHealth(ctx, world, u);
      drawWanted(ctx, world, width, u, options.muted);
      drawObjective(ctx, world, width, u);
      const mapW = MAP_W * u;
      const mapH = MAP_H * u;
      const mapX = width - mapW - 26 * u;
      const mapY = height - mapH - 40 * u;
      drawMinimap(ctx, world, mapX, mapY, mapW, mapH, u);
      drawPhone(ctx, world, width, height, u, mapY - 5 * u);
      drawWeaponOrCar(ctx, world, height, u);
      drawPrompt(ctx, world, width, height, u);
      drawBustMeter(ctx, world, width, height, u);
      drawToasts(ctx, width, height, u, options.dt ?? 0);
      const buttons = drawFailPanel(ctx, world, width, height, u, options.selected ?? -1);
      ctx.restore();
      return buttons;
    },
  };
}
