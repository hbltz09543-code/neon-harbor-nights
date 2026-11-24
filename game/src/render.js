// Draws Port Azura through the camera. Everything that never moves (ground, roads and markings,
// sidewalks, the park, building shadows and rooftops, lamps, containers) is painted once into
// square chunks and reused; each frame then adds the animated water, skid marks, the people and
// cars with their shadows, tyre smoke, palm canopies, umbrellas and cranes (which stand above the
// traffic), the neon signs, and a warm golden-hour vignette. On top of the city it draws what the
// phase-2 systems put in the world: mission beacons and the ferry pier on the ground; muzzle
// flashes, tracers, sparks, car fires and fireballs in the air. (The HUD is hud.js, in screen space.)
import { CHUNK, CHUNK_CACHE, COLORS, LIGHT, ROAD, SHORE, VIEW, WORLD } from './config.js';
import { DIRS, ROAD_BOUNDS, roadX, roadY } from './city.js';
import { cameraScale, viewRect } from './camera.js';

const HALF_ROAD = ROAD.width / 2;
const SHADOW_DX = LIGHT.shadowX;
const SHADOW_DY = LIGHT.shadowY;

/** A repeatable pseudo-random number in [0, 1) for integer inputs (texture decoration). */
function hash(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function overlaps(rect, x, y, w, h, margin = 0) {
  return x < rect.x + rect.w + margin && x + w > rect.x - margin && y < rect.y + rect.h + margin && y + h > rect.y - margin;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Mixes a #rrggbb colour toward white (amount > 0) or black (amount < 0). */
export function shade(hex, amount) {
  const n = Number.parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  r = Math.round(r + (target - r) * t);
  g = Math.round(g + (target - g) * t);
  b = Math.round(b + (target - b) * t);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------------------------
// Static layer (baked into chunks)

/** Adds a building's long south-east shadow (the hull of its footprint and the footprint moved by the shadow vector). */
function addShadowHull(ctx, x, y, w, h, length) {
  const dx = SHADOW_DX * length;
  const dy = SHADOW_DY * length;
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w + dx, y + dy);
  ctx.lineTo(x + w + dx, y + h + dy);
  ctx.lineTo(x + dx, y + h + dy);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

function drawGround(ctx, r) {
  ctx.fillStyle = COLORS.lot;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  // Docks yard and quay.
  if (overlaps(r, 0, SHORE.docksY, SHORE.sandX, SHORE.quayY - SHORE.docksY)) {
    ctx.fillStyle = COLORS.yard;
    ctx.fillRect(0, SHORE.docksY, SHORE.sandX, SHORE.quayY - SHORE.docksY);
    ctx.fillStyle = COLORS.quay;
    ctx.fillRect(0, SHORE.quayY - 10, SHORE.sandX, 10);
    ctx.fillStyle = 'rgba(255,214,90,0.8)';
    for (let x = 10; x < SHORE.sandX; x += 28) ctx.fillRect(x, SHORE.quayY - 13, 14, 3);
    // Painted lane lines across the yard.
    ctx.strokeStyle = COLORS.yardLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([18, 14]);
    ctx.beginPath();
    ctx.moveTo(0, SHORE.docksY + 118);
    ctx.lineTo(SHORE.sandX, SHORE.docksY + 118);
    ctx.stroke();
    ctx.setLineDash([]);
    // Oil stains.
    for (let k = 0; k < 60; k += 1) {
      const x = hash(k, 7) * SHORE.sandX;
      const y = SHORE.docksY + 10 + hash(k, 8) * 120;
      ctx.fillStyle = 'rgba(60,50,45,0.12)';
      ctx.beginPath();
      ctx.ellipse(x, y, 6 + hash(k, 9) * 10, 4 + hash(k, 10) * 6, hash(k, 11) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Beach sand, wet sand at the waterline, then the bay.
  if (r.x + r.w > SHORE.sandX) {
    ctx.fillStyle = COLORS.sand;
    ctx.fillRect(SHORE.sandX, 0, SHORE.waterX - SHORE.sandX, SHORE.quayY);
    const wet = ctx.createLinearGradient(SHORE.waterX - 40, 0, SHORE.waterX, 0);
    wet.addColorStop(0, 'rgba(217,196,143,0)');
    wet.addColorStop(1, COLORS.sandWet);
    ctx.fillStyle = wet;
    ctx.fillRect(SHORE.waterX - 40, 0, 40, SHORE.quayY);
    // Ripples blown into the sand.
    ctx.strokeStyle = 'rgba(190,160,110,0.22)';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 180; k += 1) {
      const x = SHORE.sandX + 20 + hash(k, 3) * (SHORE.waterX - SHORE.sandX - 60);
      const y = hash(k, 4) * SHORE.quayY;
      if (!overlaps(r, x - 10, y - 4, 20, 8)) continue;
      ctx.beginPath();
      ctx.moveTo(x - 9, y);
      ctx.quadraticCurveTo(x, y - 4, x + 9, y);
      ctx.stroke();
    }
  }
  if (r.x + r.w > SHORE.waterX || r.y + r.h > SHORE.quayY) {
    const east = ctx.createLinearGradient(SHORE.waterX, 0, WORLD.width, 0);
    east.addColorStop(0, COLORS.water);
    east.addColorStop(1, COLORS.waterDeep);
    ctx.fillStyle = east;
    ctx.fillRect(SHORE.waterX, 0, WORLD.width - SHORE.waterX, WORLD.height);
    const south = ctx.createLinearGradient(0, SHORE.quayY, 0, WORLD.height);
    south.addColorStop(0, COLORS.waterDeep);
    south.addColorStop(1, '#23798a');
    ctx.fillStyle = south;
    ctx.fillRect(0, SHORE.quayY, SHORE.waterX, WORLD.height - SHORE.quayY);
  }
}

function drawRoads(ctx, r) {
  ctx.fillStyle = COLORS.asphalt;
  const spanY = ROAD_BOUNDS.maxY - ROAD_BOUNDS.minY;
  const spanX = ROAD_BOUNDS.maxX - ROAD_BOUNDS.minX;
  for (let i = 0; i < ROAD.columns; i += 1) ctx.fillRect(roadX(i) - HALF_ROAD, ROAD_BOUNDS.minY, ROAD.width, spanY);
  for (let j = 0; j < ROAD.rows; j += 1) ctx.fillRect(ROAD_BOUNDS.minX, roadY(j) - HALF_ROAD, spanX, ROAD.width);

  // Patches, cracks and manholes, fixed in world space so chunk edges line up.
  for (let i = 0; i < ROAD.columns; i += 1) {
    for (let j = 0; j < ROAD.rows; j += 1) {
      for (let k = 0; k < 7; k += 1) {
        const vertical = hash(i, j, k * 3) < 0.5;
        if (vertical && j === ROAD.rows - 1) continue;
        if (!vertical && i === ROAD.columns - 1) continue;
        const along = 60 + hash(i, j, k * 3 + 1) * (ROAD.spacing - 120);
        const across = (hash(i, j, k * 3 + 2) - 0.5) * 70;
        const x = vertical ? roadX(i) + across : roadX(i) + along;
        const y = vertical ? roadY(j) + along : roadY(j) + across;
        if (!overlaps(r, x - 20, y - 20, 40, 40)) continue;
        if (k === 0) {
          ctx.fillStyle = '#4c4542';
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (k < 4) {
          ctx.fillStyle = k % 2 ? COLORS.asphaltPatch : COLORS.asphaltDark;
          ctx.fillRect(x - 8 - k * 2, y - 6 - k, 16 + k * 4, 12 + k * 2);
        } else {
          ctx.strokeStyle = 'rgba(40,32,30,0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - 10, y - 4);
          ctx.lineTo(x - 2, y + 2);
          ctx.lineTo(x + 3, y - 1);
          ctx.lineTo(x + 11, y + 5);
          ctx.stroke();
        }
      }
    }
  }
  // Oil drips down the middle of each lane.
  ctx.fillStyle = 'rgba(40,32,30,0.14)';
  for (let i = 0; i < ROAD.columns; i += 1) {
    if (roadX(i) + 30 < r.x || roadX(i) - 30 > r.x + r.w) continue;
    for (const side of [-1, 1]) {
      ctx.fillRect(roadX(i) + side * ROAD.laneOffset - 3, Math.max(ROAD_BOUNDS.minY, r.y), 6, Math.min(r.h, ROAD_BOUNDS.maxY - r.y));
    }
  }
  for (let j = 0; j < ROAD.rows; j += 1) {
    if (roadY(j) + 30 < r.y || roadY(j) - 30 > r.y + r.h) continue;
    for (const side of [-1, 1]) {
      ctx.fillRect(Math.max(ROAD_BOUNDS.minX, r.x), roadY(j) + side * ROAD.laneOffset - 3, Math.min(r.w, ROAD_BOUNDS.maxX - r.x), 6);
    }
  }
  // Clean asphalt in the intersections (no drips across them).
  ctx.fillStyle = COLORS.asphalt;
  for (let i = 0; i < ROAD.columns; i += 1) {
    for (let j = 0; j < ROAD.rows; j += 1) {
      const x = roadX(i);
      const y = roadY(j);
      if (overlaps(r, x - HALF_ROAD, y - HALF_ROAD, ROAD.width, ROAD.width)) ctx.fillRect(x - HALF_ROAD + 6, y - HALF_ROAD + 6, ROAD.width - 12, ROAD.width - 12);
    }
  }
}

/** Lane markings on one road segment from intersection (i, j) in direction d (east or south). */
function drawSegmentMarkings(ctx, i, j, d) {
  const v = DIRS[d];
  const startX = roadX(i);
  const startY = roadY(j);
  const from = HALF_ROAD + ROAD.crosswalk + 10;
  const to = ROAD.spacing - from;
  const along = (s, across) => (v.x ? [startX + s, startY + across] : [startX + across, startY + s]);
  // Double centre line.
  ctx.strokeStyle = COLORS.centerLine;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const off of [-2, 2]) {
    const [x1, y1] = along(from, off);
    const [x2, y2] = along(to, off);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  // Dashed lines marking the parking strips.
  ctx.strokeStyle = 'rgba(244,231,198,0.55)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([10, 12]);
  ctx.beginPath();
  for (const off of [-29, 29]) {
    const [x1, y1] = along(from, off);
    const [x2, y2] = along(to, off);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Stop lines across the incoming lane at both ends.
  ctx.fillStyle = COLORS.marking;
  const stopNear = HALF_ROAD + ROAD.crosswalk + 4;
  const [ax, ay] = along(stopNear, 0);
  const [bx, by] = along(ROAD.spacing - stopNear, 0);
  if (v.x) {
    ctx.fillRect(ax - 2, ay - 28, 4, 26); // westbound traffic stops here (north half)
    ctx.fillRect(bx - 2, by + 2, 4, 26); // eastbound (south half)
  } else {
    ctx.fillRect(ax + 2, ay - 2, 26, 4); // northbound (east half)
    ctx.fillRect(bx - 28, by - 2, 26, 4); // southbound (west half)
  }
}

function drawCrosswalks(ctx, r) {
  ctx.fillStyle = 'rgba(244,231,198,0.88)';
  for (let i = 0; i < ROAD.columns; i += 1) {
    for (let j = 0; j < ROAD.rows; j += 1) {
      const x = roadX(i);
      const y = roadY(j);
      if (!overlaps(r, x - 80, y - 80, 160, 160)) continue;
      const near = HALF_ROAD;
      const far = HALF_ROAD + ROAD.crosswalk;
      // Stripes across the vertical road (north and south arms).
      for (const sy of [-1, 1]) {
        if ((sy < 0 && j === 0) || (sy > 0 && j === ROAD.rows - 1)) continue;
        const y0 = sy < 0 ? y - far : y + near;
        for (let k = -HALF_ROAD + 4; k < HALF_ROAD - 4; k += 10) ctx.fillRect(x + k, y0 + 2, 6, ROAD.crosswalk - 4);
      }
      // Stripes across the horizontal road (west and east arms).
      for (const sx of [-1, 1]) {
        if ((sx < 0 && i === 0) || (sx > 0 && i === ROAD.columns - 1)) continue;
        const x0 = sx < 0 ? x - far : x + near;
        for (let k = -HALF_ROAD + 4; k < HALF_ROAD - 4; k += 10) ctx.fillRect(x0 + 2, y + k, ROAD.crosswalk - 4, 6);
      }
    }
  }
}

function drawMarkings(ctx, r) {
  for (let i = 0; i < ROAD.columns; i += 1) {
    for (let j = 0; j < ROAD.rows; j += 1) {
      if (i < ROAD.columns - 1 && overlaps(r, roadX(i), roadY(j) - HALF_ROAD, ROAD.spacing, ROAD.width)) drawSegmentMarkings(ctx, i, j, 0);
      if (j < ROAD.rows - 1 && overlaps(r, roadX(i) - HALF_ROAD, roadY(j), ROAD.width, ROAD.spacing)) drawSegmentMarkings(ctx, i, j, 1);
    }
  }
  drawCrosswalks(ctx, r);
}

function drawBlocks(ctx, city, r) {
  for (const block of city.walkBlocks) {
    if (!overlaps(r, block.x, block.y, block.w, block.h, 2)) continue;
    // Sidewalk, with paving joints and a bright curb.
    ctx.fillStyle = COLORS.sidewalk;
    ctx.fillRect(block.x, block.y, block.w, block.h);
    ctx.strokeStyle = COLORS.sidewalkJoint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = block.x + 16; x < block.x + block.w; x += 16) {
      ctx.moveTo(x, block.y);
      ctx.lineTo(x, block.y + ROAD.sidewalk);
      ctx.moveTo(x, block.y + block.h - ROAD.sidewalk);
      ctx.lineTo(x, block.y + block.h);
    }
    for (let y = block.y + 16; y < block.y + block.h; y += 16) {
      ctx.moveTo(block.x, y);
      ctx.lineTo(block.x + ROAD.sidewalk, y);
      ctx.moveTo(block.x + block.w - ROAD.sidewalk, y);
      ctx.lineTo(block.x + block.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = COLORS.curb;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(block.x + 1.25, block.y + 1.25, block.w - 2.5, block.h - 2.5);
    const inner = { x: block.x + ROAD.sidewalk, y: block.y + ROAD.sidewalk, w: block.w - 2 * ROAD.sidewalk, h: block.h - 2 * ROAD.sidewalk };
    if (block.kind === 'promenade') {
      ctx.fillStyle = COLORS.boardwalk;
      ctx.fillRect(inner.x, block.y, block.w - ROAD.sidewalk, block.h);
      ctx.strokeStyle = COLORS.boardwalkLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = Math.max(block.y, Math.floor(r.y / 8) * 8); y < Math.min(block.y + block.h, r.y + r.h); y += 8) {
        ctx.moveTo(inner.x, y);
        ctx.lineTo(block.x + block.w, y);
      }
      ctx.stroke();
    } else if (block.kind === 'park') {
      drawPark(ctx, city.parks.find((p) => p.col === block.col && p.row === block.row));
    } else {
      ctx.fillStyle = COLORS.lot;
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      // Alleys between lots read slightly darker.
      ctx.fillStyle = COLORS.alley;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(inner.x + 2, inner.y + 2, inner.w - 4, inner.h - 4);
      ctx.globalAlpha = 1;
    }
  }
}

function drawPark(ctx, park) {
  const { inner, cx, cy, ring } = park;
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  // Mowing stripes.
  ctx.fillStyle = COLORS.grassDark;
  for (let x = inner.x; x < inner.x + inner.w; x += 24) ctx.fillRect(x, inner.y, 12, inner.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(inner.x, inner.y, inner.w, inner.h);
  ctx.clip();
  ctx.strokeStyle = COLORS.path;
  ctx.lineCap = 'round';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  ctx.lineTo(inner.x + inner.w, inner.y + inner.h);
  ctx.moveTo(inner.x + inner.w, inner.y);
  ctx.lineTo(inner.x, inner.y + inner.h);
  ctx.moveTo(cx, inner.y);
  ctx.lineTo(cx, inner.y + inner.h);
  ctx.moveTo(inner.x, cy);
  ctx.lineTo(inner.x + inner.w, cy);
  ctx.stroke();
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, ring, 0, Math.PI * 2);
  ctx.stroke();
  // Flower beds inside the ring.
  for (let k = 0; k < 4; k += 1) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const fx = cx + Math.cos(a) * 58;
    const fy = cy + Math.sin(a) * 58;
    ctx.fillStyle = '#7da653';
    ctx.beginPath();
    ctx.arc(fx, fy, 15, 0, Math.PI * 2);
    ctx.fill();
    for (let f = 0; f < 9; f += 1) {
      ctx.fillStyle = ['#ff6f91', '#ffd166', '#f9f1e7', '#ff9671'][f % 4];
      ctx.beginPath();
      ctx.arc(fx + Math.cos(f * 2.4) * (4 + (f % 3) * 3.5), fy + Math.sin(f * 2.4) * (4 + (f % 3) * 3.5), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = COLORS.path;
  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (park.feature === 'fountain') {
    ctx.fillStyle = '#d9cdb5';
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.water;
    ctx.beginPath();
    ctx.arc(cx, cy, 25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d9cdb5';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLots(ctx, city, r) {
  for (const lot of city.lots) {
    if (!overlaps(r, lot.x, lot.y, lot.w, lot.h, 2)) continue;
    if (lot.type === 'parking') {
      ctx.fillStyle = COLORS.parking;
      ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
      ctx.strokeStyle = 'rgba(244,231,198,0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const stall of lot.stalls) {
        ctx.moveTo(stall.x, stall.y);
        ctx.lineTo(stall.x, stall.y + stall.h);
        ctx.moveTo(stall.x + stall.w, stall.y);
        ctx.lineTo(stall.x + stall.w, stall.y + stall.h);
      }
      ctx.stroke();
    } else if (lot.type === 'plaza') {
      ctx.fillStyle = '#e6d6b8';
      ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
      ctx.fillStyle = 'rgba(200,120,90,0.18)';
      for (let x = lot.x; x < lot.x + lot.w; x += 12) {
        for (let y = lot.y; y < lot.y + lot.h; y += 12) if (((x - lot.x) / 12 + (y - lot.y) / 12) % 2 === 0) ctx.fillRect(x, y, 12, 12);
      }
    } else if (lot.type === 'apron') {
      ctx.fillStyle = '#c9c1b2';
      ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 2;
      ctx.strokeRect(lot.x + 8, lot.y + 8, lot.w - 30, lot.h - 16);
      ctx.beginPath();
      ctx.moveTo(lot.x + 8, lot.y + lot.h / 2);
      ctx.lineTo(lot.x + lot.w - 22, lot.y + lot.h / 2);
      ctx.stroke();
      // Hazard stripes in front of the workshop door, and paint stains.
      for (let y = lot.y + 18; y < lot.y + lot.h - 22; y += 10) {
        ctx.fillStyle = (y / 10) % 2 < 1 ? '#f2c230' : '#2b2b2b';
        ctx.fillRect(lot.x, y, 6, 10);
      }
      for (const [dx, dy, c] of [
        [40, 30, 'rgba(255,79,163,0.35)'],
        [70, 110, 'rgba(63,240,255,0.3)'],
        [30, 120, 'rgba(255,210,63,0.35)'],
      ]) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.ellipse(lot.x + dx, lot.y + dy, 9, 6, 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Every static shadow in one path, filled once, so overlapping shadows do not double up. */
function drawStaticShadows(ctx, city, r) {
  const reach = 110;
  ctx.fillStyle = COLORS.shadow;
  ctx.beginPath();
  for (const b of city.buildings) {
    if (!overlaps(r, b.x, b.y, b.w + b.shadow, b.h + b.shadow, reach)) continue;
    addShadowHull(ctx, b.x, b.y, b.w, b.h, b.shadow);
  }
  for (const p of city.props) {
    if (!overlaps(r, p.x - 40, p.y - 40, 140, 140)) continue;
    if (p.type === 'palm') {
      // Trunk and canopy: the canopy floats high, so its shadow lands well away.
      const h = p.size * 1.7;
      ctx.moveTo(p.x - 2, p.y);
      ctx.lineTo(p.x + 2, p.y);
      ctx.lineTo(p.x + SHADOW_DX * h + 2, p.y + SHADOW_DY * h);
      ctx.lineTo(p.x + SHADOW_DX * h - 2, p.y + SHADOW_DY * h);
      ctx.closePath();
      ctx.moveTo(p.x + SHADOW_DX * h + p.size, p.y + SHADOW_DY * h);
      ctx.arc(p.x + SHADOW_DX * h, p.y + SHADOW_DY * h, p.size, 0, Math.PI * 2);
    } else if (p.type === 'lamp') {
      const h = 26;
      ctx.moveTo(p.x - 1, p.y);
      ctx.lineTo(p.x + 1, p.y);
      ctx.lineTo(p.x + SHADOW_DX * h + 1, p.y + SHADOW_DY * h);
      ctx.lineTo(p.x + SHADOW_DX * h - 1, p.y + SHADOW_DY * h);
      ctx.closePath();
    } else if (p.type === 'umbrella') {
      ctx.moveTo(p.x + 8 + p.r, p.y + 5);
      ctx.arc(p.x + 8, p.y + 5, p.r, 0, Math.PI * 2);
    } else if (p.type === 'containers') {
      addShadowHull(ctx, p.x, p.y, p.w, p.cells.length * p.cellH, 14);
    } else if (p.type === 'lifeguard') {
      addShadowHull(ctx, p.x - 11, p.y - 11, 22, 22, 26);
    } else if (p.type === 'crane') {
      // The boom's shadow is cast from high up.
      const h = 60;
      addShadowHull(ctx, p.x + 26 + SHADOW_DX * h, p.y - 60 + SHADOW_DY * h, 14, 200, 10);
      addShadowHull(ctx, p.x, p.y + SHADOW_DY * 40, p.w, 8, 40);
    } else if (p.type === 'ship') {
      addShadowHull(ctx, p.x, p.y, p.w, p.h, 16);
    }
  }
  ctx.fill();
}

function drawRoofDetail(ctx, d, base) {
  switch (d.type) {
    case 'ac':
      ctx.fillStyle = 'rgba(70,40,80,0.25)';
      ctx.fillRect(d.x + 2, d.y + 1.5, d.w, d.h);
      ctx.fillStyle = '#d7d9d6';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.strokeStyle = '#9ea3a3';
      ctx.lineWidth = 1;
      ctx.strokeRect(d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1);
      ctx.beginPath();
      ctx.arc(d.x + d.w / 2, d.y + d.h / 2, Math.min(d.w, d.h) * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'stair':
      ctx.fillStyle = 'rgba(70,40,80,0.28)';
      ctx.fillRect(d.x + 4, d.y + 2.5, d.w, d.h);
      ctx.fillStyle = shade(base, -0.12);
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = shade(base, 0.18);
      ctx.fillRect(d.x, d.y, d.w, 2);
      break;
    case 'skylight':
      ctx.fillStyle = '#7fb8c9';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(d.x + 1, d.y + 1, 2, d.h - 2);
      break;
    case 'tower':
      ctx.fillStyle = 'rgba(70,40,80,0.3)';
      ctx.beginPath();
      ctx.ellipse(d.x + 9, d.y + 6, d.r, d.r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a4030';
      for (const [lx, ly] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        ctx.fillRect(d.x + lx * d.r * 0.7 - 1, d.y + ly * d.r * 0.7 - 1, 2, 2);
      ctx.fillStyle = '#a8764e';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a5236';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#c99a6a';
      ctx.beginPath();
      ctx.arc(d.x - d.r * 0.25, d.y - d.r * 0.25, d.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'pool':
      ctx.fillStyle = '#f4f1e8';
      roundRectPath(ctx, d.x - 2, d.y - 2, d.w + 4, d.h + 4, 4);
      ctx.fill();
      ctx.fillStyle = '#4cc7cf';
      roundRectPath(ctx, d.x, d.y, d.w, d.h, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k < 3; k += 1) {
        ctx.moveTo(d.x + 3, d.y + (d.h * k) / 3);
        ctx.quadraticCurveTo(d.x + d.w / 2, d.y + (d.h * k) / 3 - 3, d.x + d.w - 3, d.y + (d.h * k) / 3);
      }
      ctx.stroke();
      break;
    case 'garden':
      ctx.fillStyle = '#86b062';
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.fillStyle = '#5f8f48';
      for (let k = 0; k < 6; k += 1) {
        ctx.beginPath();
        ctx.arc(d.x + 4 + hash(d.x, d.y, k) * (d.w - 8), d.y + 4 + hash(d.y, d.x, k) * (d.h - 8), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'helipad':
      ctx.fillStyle = '#4b4d55';
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f2c230';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f4f1e8';
      ctx.font = `bold ${Math.round(d.r)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', d.x, d.y + 1);
      break;
    default:
      break;
  }
}

function drawBuilding(ctx, b) {
  const gradient = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
  gradient.addColorStop(0, shade(b.color, 0.12));
  gradient.addColorStop(1, shade(b.color, -0.08));
  ctx.fillStyle = gradient;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  // Sunlit north-west edges, shaded south-east edges, and the parapet line.
  ctx.fillStyle = COLORS.roofTrim;
  ctx.fillRect(b.x, b.y, b.w, 2);
  ctx.fillRect(b.x, b.y, 2, b.h);
  ctx.fillStyle = COLORS.roofEdge;
  ctx.fillRect(b.x, b.y + b.h - 2, b.w, 2);
  ctx.fillRect(b.x + b.w - 2, b.y, 2, b.h);
  ctx.strokeStyle = 'rgba(90,60,70,0.16)';
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 3.5, b.y + 3.5, b.w - 7, b.h - 7);

  if (b.style === 'warehouse') {
    ctx.strokeStyle = 'rgba(80,80,90,0.25)';
    ctx.beginPath();
    for (let x = b.x + 6; x < b.x + b.w - 3; x += 6) {
      ctx.moveTo(x, b.y + 3);
      ctx.lineTo(x, b.y + b.h - 3);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(b.x + 3, b.y + b.h / 2 - 1, b.w - 6, 2);
    ctx.fillStyle = 'rgba(140,190,210,0.6)';
    for (let x = b.x + 30; x < b.x + b.w - 40; x += 80) ctx.fillRect(x, b.y + 14, 24, 10);
    return;
  }
  if (b.floors >= 8 && b.w >= 50 && b.h >= 50) {
    // An upper setback tier with its own little shadow reads as height.
    const inset = 10;
    ctx.fillStyle = 'rgba(70,40,80,0.22)';
    ctx.fillRect(b.x + inset + 4, b.y + inset + 3, b.w - inset * 2, b.h - inset * 2);
    ctx.fillStyle = shade(b.color, 0.16);
    ctx.fillRect(b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2);
    ctx.fillStyle = COLORS.roofTrim;
    ctx.fillRect(b.x + inset, b.y + inset, b.w - inset * 2, 1.5);
  }
  for (const detail of b.details) drawRoofDetail(ctx, detail, b.color);
  if (b.style === 'garage') {
    // Roll-up door on the east wall, hazard trim and a painted roof sign.
    ctx.fillStyle = '#3d3a3f';
    ctx.fillRect(b.x + b.w - 6, b.y + 18, 6, b.h - 36);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let y = b.y + 20; y < b.y + b.h - 18; y += 5) ctx.fillRect(b.x + b.w - 6, y, 6, 1);
    ctx.fillStyle = '#2c2430';
    roundRectPath(ctx, b.x + 12, b.y + b.h / 2 - 22, b.w - 28, 44, 6);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('REPAINT', b.x + b.w / 2 - 6, b.y + b.h / 2 - 8);
    ctx.fillStyle = '#3ff0ff';
    ctx.fillText('& REPAIR', b.x + b.w / 2 - 6, b.y + b.h / 2 + 10);
    // Spray-can icons.
    for (const [dx, color] of [
      [22, '#ff4fa3'],
      [b.w - 40, '#3ff0ff'],
    ]) {
      ctx.fillStyle = color;
      roundRectPath(ctx, b.x + dx, b.y + 14, 9, 18, 3);
      ctx.fill();
      ctx.fillStyle = '#f4f1e8';
      ctx.fillRect(b.x + dx + 3, b.y + 10, 3, 4);
    }
  } else if (b.style === 'kiosk') {
    for (let k = 0; k < b.w; k += 6) {
      ctx.fillStyle = (k / 6) % 2 ? '#f4f1e8' : '#ef476f';
      ctx.fillRect(b.x + k, b.y + b.h - 4, Math.min(6, b.w - k), 6);
    }
  } else if (b.style === 'bandstand') {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.fillStyle = '#f6e7c8';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#e07a5f';
    ctx.beginPath();
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      ctx.lineTo(cx + Math.cos(a) * 27, cy + Math.sin(a) * 27);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * 27, cy + Math.sin(a) * 27);
    }
    ctx.stroke();
  }
  if (b.sign) {
    // The sign's frame is part of the roof; its light is drawn live (drawNeonSigns).
    const s = b.sign;
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.vertical) ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#2a1a2e';
    roundRectPath(ctx, -s.len / 2 - 2, -s.thickness / 2 - 2, s.len + 4, s.thickness + 4, 3);
    ctx.fill();
    ctx.restore();
  }
}

function drawStaticProps(ctx, city, r) {
  for (const p of city.props) {
    if (!overlaps(r, p.x - 50, p.y - 50, 100, 100)) continue;
    switch (p.type) {
      case 'lamp': {
        ctx.fillStyle = COLORS.lamp;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = COLORS.lamp;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.nx * 12, p.y + p.ny * 12);
        ctx.stroke();
        ctx.fillStyle = '#fff1c9';
        ctx.fillRect(p.x + p.nx * 12 - 2.5, p.y + p.ny * 12 - 2.5, 5, 5);
        break;
      }
      case 'bench': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.vertical ? Math.PI / 2 : p.angle ?? 0);
        ctx.fillStyle = 'rgba(70,40,80,0.25)';
        ctx.fillRect(-9, -2, 20, 7);
        ctx.fillStyle = '#9c6b45';
        ctx.fillRect(-10, -4, 20, 7);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(-10, -1, 20, 1);
        ctx.restore();
        break;
      }
      case 'towel': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-6, -11, 12, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-6, -5, 12, 2);
        ctx.fillRect(-6, 3, 12, 2);
        ctx.restore();
        break;
      }
      case 'lifeguard': {
        ctx.fillStyle = '#e9e2d0';
        ctx.fillRect(p.x - 11, p.y - 11, 22, 22);
        ctx.fillStyle = '#e2434b';
        ctx.beginPath();
        ctx.moveTo(p.x - 13, p.y - 13);
        ctx.lineTo(p.x + 13, p.y - 13);
        ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.moveTo(p.x - 13, p.y + 13);
        ctx.lineTo(p.x + 13, p.y + 13);
        ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f4f1e8';
        ctx.beginPath();
        ctx.moveTo(p.x - 13, p.y - 13);
        ctx.lineTo(p.x - 13, p.y + 13);
        ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.moveTo(p.x + 13, p.y - 13);
        ctx.lineTo(p.x + 13, p.y + 13);
        ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'volleyball': {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 40, p.y - 22, 80, 44);
        ctx.strokeStyle = '#3b3a3f';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - 26);
        ctx.lineTo(p.x, p.y + 26);
        ctx.stroke();
        ctx.fillStyle = '#3b3a3f';
        ctx.fillRect(p.x - 2, p.y - 28, 4, 4);
        ctx.fillRect(p.x - 2, p.y + 24, 4, 4);
        break;
      }
      case 'bollard':
        ctx.fillStyle = '#3b3a3f';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'containers':
        for (let k = 0; k < p.cells.length; k += 1) {
          const cell = p.cells[k];
          const y = p.y + k * p.cellH;
          ctx.fillStyle = cell.color;
          ctx.fillRect(p.x, y, p.w, p.cellH - 1);
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          for (let x = p.x + 3; x < p.x + p.w - 2; x += 4) ctx.fillRect(x, y + 1, 1, p.cellH - 3);
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.fillRect(p.x, y, p.w, 1.5);
        }
        break;
      case 'crane':
        // Rails along the quay under the gantry (the crane itself is drawn above traffic).
        ctx.fillStyle = '#6d665d';
        ctx.fillRect(p.x - 30, p.y + 2, p.w + 60, 2);
        ctx.fillRect(p.x - 30, p.y + 42, p.w + 60, 2);
        break;
      case 'ship':
        drawShip(ctx, p);
        break;
      default:
        break;
    }
  }
}

function drawShip(ctx, p) {
  const { x, y, w, h } = p;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(x + 10, y);
  ctx.lineTo(x + w - 60, y);
  ctx.quadraticCurveTo(x + w, y + h / 2, x + w - 60, y + h);
  ctx.lineTo(x + 10, y + h);
  ctx.quadraticCurveTo(x - 4, y + h / 2, x + 10, y);
  ctx.fill();
  ctx.fillStyle = '#b8483e';
  ctx.fillRect(x + 12, y + 4, w - 80, h - 8);
  ctx.fillStyle = '#6f6a63';
  ctx.fillRect(x + 16, y + 7, w - 88, h - 14);
  // Container rows on deck.
  const cols = 11;
  const cellW = (w - 220) / cols;
  for (let k = 0; k < p.cargo.length; k += 1) {
    const col = k % cols;
    const row = Math.floor(k / cols);
    ctx.fillStyle = p.cargo[k];
    ctx.fillRect(x + 150 + col * cellW, y + 10 + row * ((h - 20) / 2), cellW - 2, (h - 20) / 2 - 2);
  }
  // Bridge at the stern.
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(x + 30, y + 12, 70, h - 24);
  ctx.fillStyle = '#7fb8c9';
  ctx.fillRect(x + 92, y + 16, 5, h - 32);
  ctx.fillStyle = '#e2434b';
  ctx.fillRect(x + 50, y + h / 2 - 7, 14, 14);
}

/** Paints everything static inside world rectangle `r` (the caller has set the transform). */
function drawStaticLayer(ctx, city, r) {
  drawGround(ctx, r);
  drawRoads(ctx, r);
  drawMarkings(ctx, r);
  drawBlocks(ctx, city, r);
  drawLots(ctx, city, r);
  drawStaticShadows(ctx, city, r);
  for (const b of city.buildings) if (overlaps(r, b.x, b.y, b.w, b.h, 2)) drawBuilding(ctx, b);
  drawStaticProps(ctx, city, r);
}

// ---------------------------------------------------------------------------------------------
// Live layer

function drawWater(ctx, view, time) {
  // Shimmering highlights on a fixed grid, each with its own phase.
  ctx.strokeStyle = 'rgba(255,248,220,0.5)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const spacing = 40;
  const x0 = Math.floor(view.x / spacing) * spacing;
  const y0 = Math.floor(view.y / spacing) * spacing;
  for (let x = x0; x < view.x + view.w + spacing; x += spacing) {
    for (let y = y0; y < view.y + view.h + spacing; y += spacing) {
      if (x < SHORE.waterX + 10 && y < SHORE.quayY + 10) continue;
      const gx = Math.round(x / spacing);
      const gy = Math.round(y / spacing);
      const phase = hash(gx, gy) * Math.PI * 2;
      const pulse = Math.sin(time * 1.6 + phase);
      if (pulse < 0.2) continue;
      const px = x + hash(gx, gy, 1) * 30 + Math.sin(time * 0.7 + phase) * 4;
      const py = y + hash(gx, gy, 2) * 30;
      const len = 4 + pulse * 7;
      ctx.moveTo(px - len, py);
      ctx.quadraticCurveTo(px, py - 2.5, px + len, py);
    }
  }
  ctx.stroke();
  // Foam where the waves run up the beach.
  if (view.x + view.w > SHORE.waterX - 20 && view.y < SHORE.quayY) {
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.strokeStyle = layer === 0 ? COLORS.foam : 'rgba(255,250,235,0.4)';
      ctx.lineWidth = layer === 0 ? 3 : 2;
      ctx.beginPath();
      const run = Math.sin(time * 0.9 + layer * 2) * 5 + layer * 10;
      for (let y = Math.max(0, Math.floor(view.y / 8) * 8); y <= Math.min(SHORE.quayY, view.y + view.h); y += 8) {
        const x = SHORE.waterX - 2 + run + Math.sin(y * 0.045 + time * 1.3 + layer) * 3 + Math.sin(y * 0.013) * 4;
        if (y === Math.max(0, Math.floor(view.y / 8) * 8)) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  // Water lapping at the quay.
  if (view.y + view.h > SHORE.quayY) {
    ctx.strokeStyle = 'rgba(255,250,235,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = Math.floor(view.x / 10) * 10; x <= Math.min(SHORE.waterX, view.x + view.w); x += 10) {
      const y = SHORE.quayY + 3 + Math.sin(x * 0.06 + time * 2) * 1.5;
      if (x === Math.floor(view.x / 10) * 10) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawSkids(ctx, skids, view) {
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (const s of skids) {
    if (s.x1 < view.x - 10 || s.x1 > view.x + view.w + 10 || s.y1 < view.y - 10 || s.y1 > view.y + view.h + 10) continue;
    const fade = 1 - s.age / 14;
    ctx.strokeStyle = `rgba(32,24,24,${(0.5 * s.alpha * fade).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawCarShadow(ctx, car) {
  ctx.save();
  ctx.translate(car.x + 5, car.y + 3.5);
  ctx.rotate(car.angle);
  ctx.fillStyle = COLORS.entityShadow;
  roundRectPath(ctx, -car.spec.length / 2, -car.spec.width / 2, car.spec.length, car.spec.width, 6);
  ctx.fill();
  ctx.restore();
}

/** Draws one car (body, glass, lights, model trim, dents) centred on its position. */
export function drawCar(ctx, car) {
  const L = car.spec.length;
  const W = car.spec.width;
  const model = car.model;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  // Tyres peek out at the corners.
  ctx.fillStyle = '#1f1b1d';
  for (const fx of [-L * 0.3, L * 0.3]) for (const fy of [-W / 2, W / 2]) ctx.fillRect(fx - 4, fy - 1.5, 8, 3);
  // Body.
  ctx.fillStyle = car.color;
  roundRectPath(ctx, -L / 2, -W / 2, L, W, model === 'van' ? 3 : 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,30,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Light catches the left flank (the sun is west), the right flank is darker.
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(-L / 2 + 4, -W / 2 + 1, L - 8, 2);
  ctx.fillStyle = 'rgba(40,20,40,0.18)';
  ctx.fillRect(-L / 2 + 4, W / 2 - 3, L - 8, 2);

  const glass = '#26313b';
  if (model === 'van') {
    ctx.fillStyle = glass;
    ctx.fillRect(L * 0.22, -W / 2 + 2.5, L * 0.12, W - 5);
    ctx.fillStyle = shade(car.color, 0.1);
    ctx.fillRect(-L / 2 + 3, -W / 2 + 2.5, L * 0.68, W - 5);
    ctx.strokeStyle = 'rgba(40,30,30,0.25)';
    ctx.beginPath();
    for (let x = -L / 2 + 8; x < L * 0.15; x += 6) {
      ctx.moveTo(x, -W / 2 + 3);
      ctx.lineTo(x, W / 2 - 3);
    }
    ctx.stroke();
  } else {
    const roofBack = model === 'sports' ? -L * 0.16 : -L * 0.22;
    const roofFront = model === 'sports' ? L * 0.06 : L * 0.08;
    // Windscreen and rear window.
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(roofFront, -W / 2 + 3);
    ctx.lineTo(roofFront + L * 0.16, -W / 2 + 4);
    ctx.lineTo(roofFront + L * 0.16, W / 2 - 4);
    ctx.lineTo(roofFront, W / 2 - 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(roofBack - L * 0.1, -W / 2 + 4, L * 0.1, W - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(roofFront + 2, -W / 2 + 4, 2, W * 0.35);
    // Roof.
    ctx.fillStyle = shade(car.color, model === 'sports' ? -0.08 : 0.12);
    roundRectPath(ctx, roofBack, -W / 2 + 3, roofFront - roofBack, W - 6, 3);
    ctx.fill();
    if (model === 'sports') {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-L / 2 + 2, -2.5, L - 4, 1.6);
      ctx.fillRect(-L / 2 + 2, 1, L - 4, 1.6);
      ctx.fillStyle = shade(car.color, -0.35);
      ctx.fillRect(-L / 2 + 1, -W / 2 + 1, 3, W - 2);
    }
    if (model === 'taxi') {
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(-L / 2 + 6, -W / 2 + 0.5, L - 12, 1.5);
      ctx.fillRect(-L / 2 + 6, W / 2 - 2, L - 12, 1.5);
      ctx.fillStyle = '#fff4dc';
      ctx.fillRect(-4, -4, 8, 8);
      ctx.fillStyle = '#e2434b';
      ctx.fillRect(-4, -1, 8, 2);
    }
  }
  if (model === 'police') drawPoliceLivery(ctx, car, L, W);
  if (car.wrecked) {
    // Burnt out: ash streaks over the roof, no lights.
    ctx.fillStyle = 'rgba(20,14,14,0.55)';
    ctx.fillRect(-L * 0.3, -W / 2 + 2, L * 0.55, W - 4);
    ctx.restore();
    return;
  }
  // Lights: headlights cream, taillights red (bright while braking).
  ctx.fillStyle = '#fff6d6';
  ctx.fillRect(L / 2 - 3, -W / 2 + 2, 3, 4);
  ctx.fillRect(L / 2 - 3, W / 2 - 6, 3, 4);
  const braking = car.controls.throttle < 0 && car.speed > 5;
  ctx.fillStyle = braking ? '#ff3b3b' : '#a3262c';
  ctx.fillRect(-L / 2, -W / 2 + 2, 2.5, 4);
  ctx.fillRect(-L / 2, W / 2 - 6, 2.5, 4);
  if (braking) {
    ctx.fillStyle = 'rgba(255,60,60,0.25)';
    ctx.fillRect(-L / 2 - 6, -W / 2, 6, W);
  }
  // Mirrors.
  ctx.fillStyle = shade(car.color, -0.2);
  ctx.fillRect(L * 0.12, -W / 2 - 1.5, 3, 1.5);
  ctx.fillRect(L * 0.12, W / 2, 3, 1.5);
  // Dents and scorch as damage builds.
  if (car.damage > 8) {
    const amount = car.damage / 100;
    ctx.fillStyle = `rgba(40,30,30,${(0.12 + amount * 0.35).toFixed(3)})`;
    for (let k = 0; k < 2 + Math.floor(amount * 5); k += 1) {
      const dx = (hash(car.id, k) - 0.5) * L * 0.9;
      const dy = (hash(car.id, k, 1) - 0.5) * W * 0.8;
      ctx.beginPath();
      ctx.ellipse(dx, dy, 3 + amount * 3, 2 + amount * 2, hash(car.id, k, 2) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Black-and-white cruiser: dark hood and boot, a door stripe, and the light bar (flashing while it chases). */
function drawPoliceLivery(ctx, car, L, W) {
  ctx.fillStyle = COLORS.policeDark;
  ctx.fillRect(L * 0.3, -W / 2 + 1, L * 0.2 - 1, W - 2);
  ctx.fillRect(-L / 2 + 1, -W / 2 + 1, L * 0.14, W - 2);
  ctx.fillStyle = COLORS.policeDark;
  ctx.fillRect(-L * 0.08, -W / 2, L * 0.14, 1.4);
  ctx.fillRect(-L * 0.08, W / 2 - 1.4, L * 0.14, 1.4);
  const on = car.siren > 0;
  const flip = Math.sin(car.siren * 14) > 0;
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(-3, -W / 2 + 2.5, 6, W - 5);
  ctx.fillStyle = on && flip ? COLORS.sirenRed : '#7a2228';
  ctx.fillRect(-2.5, -W / 2 + 3, 5, W / 2 - 3);
  ctx.fillStyle = on && !flip ? COLORS.sirenBlue : '#22407a';
  ctx.fillRect(-2.5, 0, 5, W / 2 - 3);
  if (on) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = flip ? 'rgba(255,45,61,0.35)' : 'rgba(45,123,255,0.35)';
    ctx.beginPath();
    ctx.arc(0, flip ? -W / 4 : W / 4, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Draws a person seen from above: legs that stride, swinging arms, shoulders, head and hair. */
export function drawPerson(ctx, x, y, angle, phase, look, moving, down, isPlayer) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (down) {
    ctx.fillStyle = look.pants;
    ctx.fillRect(-11, -3, 7, 6);
    ctx.fillStyle = look.shirt;
    roundRectPath(ctx, -5, -4.5, 10, 9, 3);
    ctx.fill();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(8, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const swing = moving > 4 ? Math.sin(phase) * Math.min(4.5, 2 + moving * 0.02) : 0;
  ctx.fillStyle = look.pants;
  roundRectPath(ctx, -1.6 + swing, -3.6, 4.2, 2.8, 1.2);
  ctx.fill();
  roundRectPath(ctx, -1.6 - swing, 0.8, 4.2, 2.8, 1.2);
  ctx.fill();
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(-swing * 0.8, -5.4, 1.6, 0, Math.PI * 2);
  ctx.arc(swing * 0.8, 5.4, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = look.shirt;
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.4, 5.4, 0, 0, Math.PI * 2);
  ctx.fill();
  if (isPlayer) {
    // Courier bag strap across the jacket.
    ctx.strokeStyle = '#3b2a20';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-2.5, -4);
    ctx.lineTo(2.5, 4);
    ctx.stroke();
  }
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(0.6, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  if (isPlayer) {
    ctx.fillStyle = COLORS.playerCap;
    ctx.beginPath();
    ctx.arc(0.2, 0, 3.1, Math.PI * 0.5, Math.PI * 1.5);
    ctx.fill();
    ctx.fillRect(0.2, -3.1, 1.6, 6.2);
    ctx.fillRect(1.8, -2, 2.4, 4);
  } else if (!look.bald) {
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.arc(0.1, 0, 3.1, Math.PI * 0.55, Math.PI * 1.45);
    ctx.fill();
  }
  ctx.restore();
}

/** Jett's pistol, held out in the right hand toward the aim. */
function drawPistol(ctx, player) {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);
  ctx.fillStyle = '#1d1a1e';
  ctx.fillRect(4, 2.6, 7, 2.2);
  ctx.fillStyle = '#3a3438';
  ctx.fillRect(4, 2.2, 2.5, 3);
  ctx.restore();
}

function drawPersonShadow(ctx, x, y, down) {
  ctx.fillStyle = COLORS.entityShadow;
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 2, down ? 9 : 5.5, down ? 6 : 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSmoke(ctx, smoke, view) {
  for (const puff of smoke) {
    if (puff.x < view.x - 20 || puff.x > view.x + view.w + 20 || puff.y < view.y - 20 || puff.y > view.y + view.h + 20) continue;
    const alpha = (1 - puff.life / puff.max) * (puff.dark ? 0.45 : 0.32);
    ctx.fillStyle = puff.dark ? `rgba(70,62,62,${alpha.toFixed(3)})` : `rgba(242,236,228,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPalmCanopy(ctx, p, time) {
  const sway = Math.sin(time * 0.8 + p.sway) * 1.5;
  const cx = p.x + sway;
  const cy = p.y - 2;
  for (let layer = 0; layer < 2; layer += 1) {
    ctx.fillStyle = layer === 0 ? COLORS.palmLeaf : COLORS.palmLeafLight;
    const reach = layer === 0 ? p.size : p.size * 0.72;
    for (let k = 0; k < p.fronds; k += 1) {
      const a = p.rot + (k * Math.PI * 2) / p.fronds + layer * 0.4 + Math.sin(time * 1.1 + k + p.sway) * 0.04;
      const tipX = cx + Math.cos(a) * reach;
      const tipY = cy + Math.sin(a) * reach;
      const sideX = Math.cos(a + Math.PI / 2) * reach * 0.22;
      const sideY = Math.sin(a + Math.PI / 2) * reach * 0.22;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + Math.cos(a) * reach * 0.5 + sideX, cy + Math.sin(a) * reach * 0.5 + sideY, tipX, tipY);
      ctx.quadraticCurveTo(cx + Math.cos(a) * reach * 0.5 - sideX, cy + Math.sin(a) * reach * 0.5 - sideY, cx, cy);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#7a5a36';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawUmbrella(ctx, p) {
  for (let k = 0; k < p.stripes; k += 1) {
    const a0 = (k * Math.PI * 2) / p.stripes;
    const a1 = ((k + 1) * Math.PI * 2) / p.stripes;
    ctx.fillStyle = k % 2 ? '#fff6e6' : p.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, p.r, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawCrane(ctx, p) {
  const { x, y, w } = p;
  // Gantry legs and the cross beam.
  ctx.fillStyle = COLORS.craneDark;
  for (const lx of [x, x + w - 6]) {
    ctx.fillRect(lx, y, 6, 46);
  }
  ctx.fillStyle = COLORS.crane;
  ctx.fillRect(x - 2, y + 14, w + 4, 10);
  // The boom reaches out over the water, the counter-jib back over the yard.
  const bx = x + w / 2 - 7;
  ctx.fillStyle = COLORS.crane;
  ctx.fillRect(bx, y - 60, 14, 200);
  ctx.strokeStyle = COLORS.craneDark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let yy = y - 60; yy < y + 140; yy += 14) {
    ctx.moveTo(bx, yy);
    ctx.lineTo(bx + 14, yy + 14);
    ctx.moveTo(bx + 14, yy);
    ctx.lineTo(bx, yy + 14);
  }
  ctx.stroke();
  ctx.strokeRect(bx + 0.5, y - 59.5, 13, 199);
  // Machine house and counterweight.
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(bx - 4, y + 4, 22, 22);
  ctx.fillStyle = '#5c564f';
  ctx.fillRect(bx - 2, y - 58, 18, 16);
  // Trolley and spreader hanging over the ship.
  ctx.fillStyle = '#3b3a3f';
  ctx.fillRect(bx + 1, y + 92, 12, 10);
}

function drawNeonSigns(ctx, signs, view, time, scale) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of signs) {
    if (s.x < view.x - 60 || s.x > view.x + view.w + 60 || s.y < view.y - 60 || s.y > view.y + view.h + 60) continue;
    let alpha = 0.85 + Math.sin(time * 2.2 + s.phase) * 0.15;
    if (s.flickery && Math.sin(time * 13 + s.phase * 3) > 0.94) alpha = 0.25;
    ctx.save();
    ctx.translate(s.x, s.y);
    if (s.vertical) ctx.rotate(-Math.PI / 2);
    const size = Math.round(s.thickness * 0.9);
    ctx.font = `bold ${size}px "Trebuchet MS", sans-serif`;
    const measured = ctx.measureText(s.text).width;
    const squeeze = Math.min(1, (s.len - 4) / measured);
    ctx.scale(squeeze, 1);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 9 * scale;
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, 0, 0.5);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillText(s.text, 0, 0.5);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** Draws a soft ring around the car the player can enter (a gentle hint, not a HUD). */
function drawEnterHint(ctx, car, time) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.strokeStyle = `rgba(255,244,220,${(0.45 + Math.sin(time * 5) * 0.2).toFixed(3)})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  roundRectPath(ctx, -car.spec.length / 2 - 4, -car.spec.width / 2 - 4, car.spec.length + 8, car.spec.width + 8, 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Phase-2 world layers: beacons, the pier, gunfire, fire and explosions

/** The ferry pier at the marina: planks out over the water and a little ferry tied up at its end. */
function drawPier(ctx, view, time) {
  const x = SHORE.waterX - 6;
  const y = 2422;
  if (x > view.x + view.w + 40 || x + 220 < view.x || y - 60 > view.y + view.h || y + 120 < view.y) return;
  ctx.fillStyle = COLORS.entityShadow;
  ctx.fillRect(x + 6, y + 6, 150, 34);
  ctx.fillStyle = COLORS.boardwalk;
  ctx.fillRect(x, y, 150, 34);
  ctx.strokeStyle = COLORS.boardwalkLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let px = x + 6; px < x + 150; px += 6) {
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + 34);
  }
  ctx.stroke();
  ctx.fillStyle = '#6b4a2c';
  for (let px = x + 10; px < x + 150; px += 34) {
    ctx.fillRect(px, y - 2, 4, 4);
    ctx.fillRect(px, y + 32, 4, 4);
  }
  // The ferry, bobbing gently.
  const bob = Math.sin(time * 1.4) * 1.5;
  ctx.save();
  ctx.translate(x + 200, y + 17 + bob);
  ctx.fillStyle = COLORS.entityShadow;
  ctx.beginPath();
  ctx.ellipse(6, 5, 52, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4f1e8';
  ctx.beginPath();
  ctx.moveTo(-48, -15);
  ctx.lineTo(34, -15);
  ctx.quadraticCurveTo(58, 0, 34, 15);
  ctx.lineTo(-48, 15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2f5d7c';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#2f5d7c';
  ctx.fillRect(-30, -9, 44, 18);
  ctx.fillStyle = '#a9cfe6';
  for (let k = 0; k < 5; k += 1) ctx.fillRect(-27 + k * 8.5, -7, 5, 4);
  ctx.fillStyle = COLORS.uiPink;
  ctx.fillRect(-4, -3, 10, 6);
  ctx.restore();
}

/** Ground rings under each mission marker, and burn scars from explosions. */
function drawGroundMarks(ctx, world, view, time) {
  const fx = world.combat?.fx;
  if (fx) {
    for (const scorch of fx.scorches) {
      if (scorch.x < view.x - 60 || scorch.x > view.x + view.w + 60 || scorch.y < view.y - 60 || scorch.y > view.y + view.h + 60) continue;
      const g = ctx.createRadialGradient(scorch.x, scorch.y, 0, scorch.x, scorch.y, scorch.r);
      g.addColorStop(0, 'rgba(25,18,18,0.55)');
      g.addColorStop(1, 'rgba(25,18,18,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(scorch.x, scorch.y, scorch.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const m of world.missions?.markers ?? []) {
    if (m.x < view.x - 80 || m.x > view.x + view.w + 80 || m.y < view.y - 80 || m.y > view.y + view.h + 80) continue;
    if (m.kind === 'target') continue;
    const pulse = 0.5 + Math.sin(time * 4 + m.x * 0.01) * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.28 + pulse * 0.12;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.lineDashOffset = -time * 20;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/** The waiting fare (mission 2): a person in a sharp suit with a suitcase, waving. */
function drawPassenger(ctx, world, time) {
  const p = world.missions?.passenger;
  if (!p) return;
  drawPersonShadow(ctx, p.x, p.y, false);
  ctx.fillStyle = '#8a5a3a';
  ctx.fillRect(p.x + 5, p.y - 2, 6, 8);
  drawPerson(ctx, p.x, p.y, p.angle + Math.sin(time * 6) * 0.25, 0, p.look, 0, false, false);
}

/** A glowing column of light over each marker (seen from above as a bright disc with a halo) and its label. */
function drawBeacons(ctx, world, view, time, scale) {
  for (const m of world.missions?.markers ?? []) {
    if (m.x < view.x - 120 || m.x > view.x + view.w + 120 || m.y < view.y - 120 || m.y > view.y + view.h + 120) continue;
    const pulse = 0.5 + Math.sin(time * 4 + m.x * 0.01) * 0.5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.radius * 1.5);
    halo.addColorStop(0, m.color);
    halo.addColorStop(0.25, `rgba(255,240,200,${(0.25 + pulse * 0.15).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.globalAlpha = m.kind === 'target' ? 0.45 : 0.55;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // A floating chevron (or the job's "$" / Vera's "V") bobbing over the marker.
    const bob = Math.sin(time * 3) * 4;
    const y = m.y - m.radius - 18 + bob;
    ctx.save();
    ctx.shadowColor = m.color;
    ctx.shadowBlur = 10 * scale;
    ctx.fillStyle = m.color;
    if (m.glyph) {
      ctx.beginPath();
      ctx.arc(m.x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#2a1626';
      ctx.font = 'bold 14px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.glyph, m.x, y + 1);
    } else {
      ctx.beginPath();
      ctx.moveTo(m.x - 10, y - 6);
      ctx.lineTo(m.x + 10, y - 6);
      ctx.lineTo(m.x, y + 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    if (m.label) {
      ctx.save();
      ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(m.label).width + 10;
      ctx.fillStyle = 'rgba(30,16,32,0.75)';
      ctx.fillRect(m.x - w / 2, y - 30, w, 15);
      ctx.fillStyle = COLORS.ui;
      ctx.fillText(m.label, m.x, y - 22);
      ctx.restore();
    }
  }
}

/** Muzzle flashes, tracers, sparks, engine flames and fireballs. */
function drawCombatEffects(ctx, world, view) {
  const fx = world.combat?.fx;
  if (!fx) return;
  const near = (x, y, pad) => x > view.x - pad && x < view.x + view.w + pad && y > view.y - pad && y < view.y + view.h + pad;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of fx.flames) {
    if (!near(f.x, f.y, 30)) continue;
    const t = f.life / f.max;
    ctx.fillStyle = `rgba(255,${Math.round(200 - t * 140)},${Math.round(70 - t * 60)},${(0.75 * (1 - t)).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * (1 - t * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of fx.fireballs) {
    if (!near(b.x, b.y, 80)) continue;
    const t = b.life / b.max;
    const r = b.r * (0.5 + t * 0.9);
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    g.addColorStop(0, `rgba(255,250,210,${(1 - t).toFixed(3)})`);
    g.addColorStop(0.4, `rgba(255,170,60,${(0.85 * (1 - t)).toFixed(3)})`);
    g.addColorStop(1, 'rgba(200,40,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const s of fx.sparks) {
    if (!near(s.x, s.y, 10)) continue;
    const t = s.life / s.max;
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x - s.vx * 0.025, s.y - s.vy * 0.025);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const tr of fx.tracers) {
    const t = tr.life / tr.max;
    const g = ctx.createLinearGradient(tr.x1, tr.y1, tr.x2, tr.y2);
    g.addColorStop(0, 'rgba(255,240,180,0)');
    g.addColorStop(1, `rgba(255,236,170,${(0.9 * (1 - t)).toFixed(3)})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tr.x1, tr.y1);
    ctx.lineTo(tr.x2, tr.y2);
    ctx.stroke();
  }
  for (const f of fx.flashes) {
    const t = f.life / f.max;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    ctx.fillStyle = `rgba(255,230,140,${(1 - t).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(11, 0);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(1, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const chunks = new Map(); // "cx,cy" -> canvas, most recently used last
  let bakeScale = 1;
  let vignette = null;
  let city = null;

  /** Matches the canvas to the window (capped device pixel ratio) and rebuilds size-dependent caches. */
  function resize(camera) {
    const dpr = Math.min(window.devicePixelRatio || 1, VIEW.maxDpr);
    const width = Math.max(320, Math.round(window.innerWidth * dpr));
    const height = Math.max(240, Math.round(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height || !vignette) {
      canvas.width = width;
      canvas.height = height;
      vignette = buildVignette(width, height);
      const maxScale = (height / VIEW.worldHeight) * VIEW.footZoom;
      const wanted = Math.min(2, Math.max(1, Math.ceil(maxScale * 2) / 2));
      if (wanted !== bakeScale) {
        bakeScale = wanted;
        chunks.clear();
      }
    }
    camera.viewportW = canvas.width;
    camera.viewportH = canvas.height;
  }

  function buildVignette(width, height) {
    const layer = document.createElement('canvas');
    layer.width = width;
    layer.height = height;
    const g = layer.getContext('2d');
    const radius = Math.hypot(width, height) / 2;
    const gradient = g.createRadialGradient(width * 0.42, height * 0.4, radius * 0.35, width / 2, height / 2, radius * 1.05);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, COLORS.vignette);
    g.fillStyle = COLORS.warmGlaze;
    g.fillRect(0, 0, width, height);
    g.fillStyle = gradient;
    g.fillRect(0, 0, width, height);
    // Low sun glare from the upper left.
    const glare = g.createRadialGradient(0, 0, 0, 0, 0, radius * 0.9);
    glare.addColorStop(0, 'rgba(255,200,120,0.22)');
    glare.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = glare;
    g.fillRect(0, 0, width, height);
    return layer;
  }

  function bakeChunk(cx, cy) {
    const layer = document.createElement('canvas');
    const size = CHUNK + 2;
    layer.width = Math.ceil(size * bakeScale);
    layer.height = Math.ceil(size * bakeScale);
    const g = layer.getContext('2d');
    g.scale(bakeScale, bakeScale);
    g.translate(-cx * CHUNK + 1, -cy * CHUNK + 1);
    drawStaticLayer(g, city, { x: cx * CHUNK - 1, y: cy * CHUNK - 1, w: size, h: size });
    return layer;
  }

  function chunkAt(cx, cy) {
    const key = `${cx},${cy}`;
    let layer = chunks.get(key);
    if (layer) {
      chunks.delete(key);
    } else {
      layer = bakeChunk(cx, cy);
      if (chunks.size >= CHUNK_CACHE) chunks.delete(chunks.keys().next().value);
    }
    chunks.set(key, layer);
    return layer;
  }

  /** Bakes one not-yet-cached chunk next to the view, so driving into it later does not stall. */
  function prefetch(view) {
    const c0 = Math.floor((view.x - CHUNK / 2) / CHUNK);
    const c1 = Math.floor((view.x + view.w + CHUNK / 2) / CHUNK);
    const r0 = Math.floor((view.y - CHUNK / 2) / CHUNK);
    const r1 = Math.floor((view.y + view.h + CHUNK / 2) / CHUNK);
    for (let cy = r0; cy <= r1; cy += 1) {
      for (let cx = c0; cx <= c1; cx += 1) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= WORLD.width || cy * CHUNK >= WORLD.height) continue;
        if (!chunks.has(`${cx},${cy}`) && chunks.size < CHUNK_CACHE - 4) {
          chunks.set(`${cx},${cy}`, bakeChunk(cx, cy));
          return;
        }
      }
    }
  }

  /** Paints one frame of the world as `world.camera` sees it. */
  function draw(world) {
    city = world.city;
    const camera = world.camera;
    resize(camera);
    const time = world.time;
    const scale = cameraScale(camera);
    const view = viewRect(camera);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, canvas.width / 2 - (camera.x + camera.shakeX) * scale, canvas.height / 2 - (camera.y + camera.shakeY) * scale);
    ctx.imageSmoothingEnabled = true;

    // Static chunks.
    const c0 = Math.max(0, Math.floor(view.x / CHUNK));
    const c1 = Math.min(Math.ceil(WORLD.width / CHUNK) - 1, Math.floor((view.x + view.w) / CHUNK));
    const r0 = Math.max(0, Math.floor(view.y / CHUNK));
    const r1 = Math.min(Math.ceil(WORLD.height / CHUNK) - 1, Math.floor((view.y + view.h) / CHUNK));
    for (let cy = r0; cy <= r1; cy += 1) {
      for (let cx = c0; cx <= c1; cx += 1) {
        ctx.drawImage(chunkAt(cx, cy), cx * CHUNK - 1, cy * CHUNK - 1, CHUNK + 2, CHUNK + 2);
      }
    }

    drawWater(ctx, view, time);
    drawPier(ctx, view, time);
    drawSkids(ctx, world.traffic.effects.skids, view);
    drawGroundMarks(ctx, world, view, time);

    // Entities: every shadow first, then every body, so no shadow falls across a neighbour.
    const cars = world.traffic.cars.filter((car) => car.x > view.x - 40 && car.x < view.x + view.w + 40 && car.y > view.y - 40 && car.y < view.y + view.h + 40);
    const peds = world.pedestrians.peds.filter((p) => p.x > view.x - 20 && p.x < view.x + view.w + 20 && p.y > view.y - 20 && p.y < view.y + view.h + 20);
    const player = world.player;
    const showPlayer = world.mode === 'play' && player.mode === 'foot';
    for (const p of peds) drawPersonShadow(ctx, p.x, p.y, p.mode === 'down');
    if (showPlayer) drawPersonShadow(ctx, player.x, player.y, false);
    for (const car of cars) drawCarShadow(ctx, car);
    for (const p of peds) if (p.mode === 'down') drawPerson(ctx, p.x, p.y, p.angle, p.phase, p.look, 0, true, false);
    for (const p of peds) if (p.mode !== 'down') drawPerson(ctx, p.x, p.y, p.angle, p.phase, p.look, p.moving, false, false);
    for (const car of cars) drawCar(ctx, car);
    if (showPlayer) {
      if (world.enterableCar) drawEnterHint(ctx, world.enterableCar, time);
      drawPerson(ctx, player.x, player.y, player.angle, player.phase, world.playerLook, player.moving, false, true);
      drawPistol(ctx, player);
    }
    drawPassenger(ctx, world, time);
    drawSmoke(ctx, world.traffic.effects.smoke, view);
    drawCombatEffects(ctx, world, view);

    // Things that stand above the traffic.
    for (const p of city.props) {
      if (p.x < view.x - 220 || p.x > view.x + view.w + 60 || p.y < view.y - 220 || p.y > view.y + view.h + 220) continue;
      if (p.type === 'palm') drawPalmCanopy(ctx, p, time);
      else if (p.type === 'umbrella') drawUmbrella(ctx, p);
      else if (p.type === 'crane') drawCrane(ctx, p);
    }
    drawNeonSigns(ctx, city.signs, view, time, scale);
    drawBeacons(ctx, world, view, time, scale);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(vignette, 0, 0);
    prefetch(view);
  }

  return {
    canvas,
    ctx,
    draw,
    resize,
    /** Bakes every chunk the view needs right now (used before a screenshot). */
    warm(world) {
      city = world.city;
      resize(world.camera);
      const view = viewRect(world.camera);
      for (let cy = Math.max(0, Math.floor(view.y / CHUNK)); cy <= Math.floor((view.y + view.h) / CHUNK); cy += 1) {
        for (let cx = Math.max(0, Math.floor(view.x / CHUNK)); cx <= Math.floor((view.x + view.w) / CHUNK); cx += 1) chunkAt(cx, cy);
      }
    },
  };
}
