// Builds Port Azura from a seed: the road grid, the city blocks and their buildings, Palm Park, the
// beach and the bay along the east edge, the Harbor Docks along the south edge, and the Repaint &
// Repair garage in the west. The result is plain data (rectangles, props, signs) plus a few
// queries the simulation needs: what is solid near a point, is this point on a road, where is the
// nearest road, and which district a point is in. Nothing here draws; render.js does that.
import { CAR_MODELS, COLORS, DISTRICT_NAMES, GARAGE_BLOCK, LIGHT, MODEL_WEIGHTS, NEON_WORDS, PARK_BLOCKS, ROAD, SHORE, TRAFFIC, WORLD } from './config.js';
import { createRandom } from './random.js';

const HALF_ROAD = ROAD.width / 2;

/** Travel directions, indexed 0..3: east, south, west, north (screen y grows downward). */
export const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
export const DIR_EAST = 0;
export const DIR_SOUTH = 1;
export const DIR_WEST = 2;
export const DIR_NORTH = 3;

/** The right-hand side of travel direction `d` (where its lane and its parked cars are). */
export function rightOf(d) {
  const v = DIRS[d];
  return { x: -v.y, y: v.x };
}

export function roadX(i) {
  return ROAD.firstCenter + ROAD.spacing * i;
}
export function roadY(j) {
  return ROAD.firstCenter + ROAD.spacing * j;
}

/** The rectangle the road grid covers (outer edges of the outermost roads). */
export const ROAD_BOUNDS = {
  minX: roadX(0) - HALF_ROAD,
  maxX: roadX(ROAD.columns - 1) + HALF_ROAD,
  minY: roadY(0) - HALF_ROAD,
  maxY: roadY(ROAD.rows - 1) + HALF_ROAD,
};

/** Horizontal extent of block column `c` (-1 is the west edge strip, columns-1 the beach promenade). */
function columnSpan(c) {
  if (c === -1) return [0, ROAD_BOUNDS.minX];
  if (c === ROAD.columns - 1) return [ROAD_BOUNDS.maxX, SHORE.sandX];
  return [roadX(c) + HALF_ROAD, roadX(c + 1) - HALF_ROAD];
}
/** Vertical extent of block row `r` (-1 is the north edge strip). */
function rowSpan(r) {
  if (r === -1) return [0, ROAD_BOUNDS.minY];
  return [roadY(r) + HALF_ROAD, roadY(r + 1) - HALF_ROAD];
}

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/** The district key (see DISTRICT_NAMES) for a world point. */
function districtKeyAt(x, y) {
  if (x >= SHORE.waterX || y >= SHORE.quayY) return 'bay';
  if (x >= SHORE.sandX) return 'beach';
  if (y >= SHORE.docksY) return 'docks';
  const parkLeft = columnSpan(PARK_BLOCKS[0].col)[0];
  const parkRight = columnSpan(PARK_BLOCKS[PARK_BLOCKS.length - 1].col)[1];
  const [parkTop, parkBottom] = rowSpan(PARK_BLOCKS[0].row);
  if (x >= parkLeft && x <= parkRight && y >= parkTop && y <= parkBottom) return 'park';
  if (x < 1248) return 'west';
  if (x > 2496) return 'heights';
  if (y < 1040) return 'midtown';
  return 'downtown';
}

/** Floors a building gets in each district: [min, max]. */
const FLOORS = {
  west: [1, 4],
  midtown: [3, 8],
  downtown: [5, 14],
  heights: [2, 6],
  park: [1, 1],
  beach: [1, 2],
  docks: [1, 2],
  bay: [1, 1],
};

function pickWeightedModel(rng) {
  let total = 0;
  for (const [, weight] of MODEL_WEIGHTS) total += weight;
  let roll = rng.next() * total;
  for (const [key, weight] of MODEL_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return MODEL_WEIGHTS[0][0];
}

/** A random curb-car description: model, colour. */
export function randomCarLook(rng) {
  const model = pickWeightedModel(rng);
  return { model, color: rng.pick(CAR_MODELS[model].colors) };
}

/** Splits a lot rectangle into smaller lots with alleys between them. */
function splitLots(rect, rng, out, depth = 0) {
  const canSplitX = rect.w > 130;
  const canSplitY = rect.h > 130;
  if ((canSplitX || canSplitY) && depth < 4 && (depth === 0 || rng.chance(0.68))) {
    const alongX = canSplitX && (!canSplitY || (rect.w >= rect.h ? rng.chance(0.75) : rng.chance(0.25)));
    const gap = rng.chance(0.4) ? 10 : 4;
    if (alongX) {
      const cut = Math.round(rect.w * rng.range(0.38, 0.62));
      splitLots({ x: rect.x, y: rect.y, w: cut - gap / 2, h: rect.h }, rng, out, depth + 1);
      splitLots({ x: rect.x + cut + gap / 2, y: rect.y, w: rect.w - cut - gap / 2, h: rect.h }, rng, out, depth + 1);
    } else {
      const cut = Math.round(rect.h * rng.range(0.38, 0.62));
      splitLots({ x: rect.x, y: rect.y, w: rect.w, h: cut - gap / 2 }, rng, out, depth + 1);
      splitLots({ x: rect.x, y: rect.y + cut + gap / 2, w: rect.w, h: rect.h - cut - gap / 2 }, rng, out, depth + 1);
    }
    return;
  }
  out.push(rect);
}

/** Places a w×h rectangle somewhere free inside `area`, avoiding `taken`; null when no room. */
function placeFree(area, w, h, taken, rng, tries = 12) {
  if (area.w < w || area.h < h) return null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const x = area.x + rng.next() * (area.w - w);
    const y = area.y + rng.next() * (area.h - h);
    let clear = true;
    for (const other of taken) {
      if (x < other.x + other.w + 3 && x + w + 3 > other.x && y < other.y + other.h + 3 && y + h + 3 > other.y) {
        clear = false;
        break;
      }
    }
    if (clear) {
      const rect = { x: Math.round(x), y: Math.round(y), w, h };
      taken.push(rect);
      return rect;
    }
  }
  return null;
}

/** Rooftop clutter for one building: AC units, stair housings, skylights, water towers, pools, gardens, helipads. */
function makeRoofDetails(b, district, rng) {
  const details = [];
  const taken = [];
  const area = { x: b.x + 6, y: b.y + 6, w: b.w - 12, h: b.h - 12 };
  if (b.floors >= 12 && b.w >= 70 && b.h >= 70) {
    const r = Math.min(b.w, b.h) * 0.3;
    const pad = { x: b.x + b.w / 2 - r, y: b.y + b.h / 2 - r, w: r * 2, h: r * 2 };
    taken.push(pad);
    details.push({ type: 'helipad', x: b.x + b.w / 2, y: b.y + b.h / 2, r });
  }
  if ((district === 'heights' || district === 'beach') && b.w > 56 && b.h > 46 && rng.chance(0.35)) {
    const pool = placeFree(area, Math.round(b.w * 0.45), Math.round(b.h * 0.32), taken, rng);
    if (pool) details.push({ type: 'pool', ...pool });
  }
  if (b.floors >= 6 && b.w >= 46 && b.h >= 46 && rng.chance(0.6)) {
    const r = rng.int(6, 9);
    const spot = placeFree(area, r * 2, r * 2, taken, rng);
    if (spot) details.push({ type: 'tower', x: spot.x + r, y: spot.y + r, r });
  }
  if (b.floors <= 5 && b.w > 50 && b.h > 40 && rng.chance(0.18)) {
    const garden = placeFree(area, Math.round(b.w * 0.4), Math.round(b.h * 0.35), taken, rng);
    if (garden) details.push({ type: 'garden', ...garden });
  }
  if (rng.chance(0.65)) {
    const stair = placeFree(area, rng.int(12, 18), rng.int(10, 14), taken, rng);
    if (stair) details.push({ type: 'stair', ...stair });
  }
  if (rng.chance(0.35)) {
    const count = rng.int(2, 4);
    const w = rng.int(6, 9);
    const h = rng.int(8, 12);
    const run = placeFree(area, count * (w + 3), h, taken, rng);
    if (run) for (let k = 0; k < count; k += 1) details.push({ type: 'skylight', x: run.x + k * (w + 3), y: run.y, w, h });
  }
  const acCount = Math.min(5, Math.floor((b.w * b.h) / 1800) + rng.int(0, 1));
  for (let k = 0; k < acCount; k += 1) {
    const ac = placeFree(area, rng.int(8, 12), rng.int(6, 9), taken, rng, 6);
    if (ac) details.push({ type: 'ac', ...ac });
  }
  return details;
}

/** A neon sign along the building edge nearest the street, or null. */
function makeSign(b, block, rng, word) {
  const edges = [
    { side: 'top', dist: b.y - block.y },
    { side: 'bottom', dist: block.y + block.h - (b.y + b.h) },
    { side: 'left', dist: b.x - block.x },
    { side: 'right', dist: block.x + block.w - (b.x + b.w) },
  ].sort((a, c) => a.dist - c.dist);
  const edge = edges[0];
  const vertical = edge.side === 'left' || edge.side === 'right';
  const room = (vertical ? b.h : b.w) - 10;
  const len = Math.min(room, 14 + word.length * 9);
  if (len < 24) return null;
  const thickness = 12;
  let x;
  let y;
  if (edge.side === 'top') {
    x = b.x + b.w / 2;
    y = b.y + thickness / 2 + 2;
  } else if (edge.side === 'bottom') {
    x = b.x + b.w / 2;
    y = b.y + b.h - thickness / 2 - 2;
  } else if (edge.side === 'left') {
    x = b.x + thickness / 2 + 2;
    y = b.y + b.h / 2;
  } else {
    x = b.x + b.w - thickness / 2 - 2;
    y = b.y + b.h / 2;
  }
  return { x, y, len, thickness, vertical, text: word, color: rng.pick(COLORS.neon), phase: rng.range(0, 100), flickery: rng.chance(0.25) };
}

/**
 * Generates the whole city for `seed`. Returns the data the renderer and the simulation share,
 * with query helpers attached.
 */
export function createCity(seed) {
  const rng = createRandom(seed).fork(1);
  const buildings = [];
  const lots = []; // parking lots and plazas (ground-level, not solid)
  const props = []; // palms, lamps, benches, umbrellas, containers, cranes...
  const signs = [];
  const solids = []; // axis-aligned rectangles cars and people cannot enter
  const parkedSpots = []; // { x, y, angle, model, color }
  const walkBlocks = []; // blocks pedestrians walk around
  const blockGrid = new Map(); // "c,r" -> walk block
  const driveways = []; // stretches of curb kept clear (no lamps, no parked cars)
  const parks = [];

  function addSolid(rect, kind) {
    const solid = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, kind, stamp: 0 };
    solids.push(solid);
    return solid;
  }

  function addBuilding(rect, district, block, options = {}) {
    const [minFloors, maxFloors] = FLOORS[district] ?? [1, 3];
    const floors = options.floors ?? rng.int(minFloors, maxFloors);
    const b = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.w),
      h: Math.round(rect.h),
      floors,
      shadow: floors * LIGHT.shadowPerFloor,
      color: options.color ?? rng.pick(COLORS.roofs),
      style: options.style ?? 'flat',
      label: options.label ?? null,
      details: [],
      sign: null,
    };
    b.details = options.details ?? makeRoofDetails(b, district, rng);
    const signChance = district === 'downtown' || district === 'midtown' ? 0.3 : district === 'docks' ? 0.05 : 0.18;
    if (block && !options.noSign && rng.chance(signChance)) {
      b.sign = makeSign(b, block, rng, rng.pick(NEON_WORDS));
      if (b.sign) signs.push(b.sign);
    }
    buildings.push(b);
    addSolid(b, 'building');
    return b;
  }

  function addPalm(x, y, size = rng.range(18, 26)) {
    props.push({ type: 'palm', x, y, size, rot: rng.range(0, Math.PI * 2), fronds: rng.int(6, 8), sway: rng.range(0, 10) });
    addSolid({ x: x - 3, y: y - 3, w: 6, h: 6 }, 'palm');
  }

  /** Fills a lot rectangle with a building, a parking lot or a little plaza. */
  function fillLot(lot, district, block) {
    if (lot.w < 34 || lot.h < 34) return;
    const roll = rng.next();
    if (roll < 0.09 && lot.w >= 70 && lot.h >= 56) {
      makeParkingLot(lot);
      return;
    }
    if (roll < 0.14) {
      lots.push({ type: 'plaza', ...lot });
      if (lot.w > 40 && lot.h > 40) addPalm(lot.x + lot.w / 2, lot.y + lot.h / 2);
      return;
    }
    const inset = () => rng.int(2, 7);
    const left = inset();
    const top = inset();
    const right = inset();
    const bottom = inset();
    addBuilding({ x: lot.x + left, y: lot.y + top, w: lot.w - left - right, h: lot.h - top - bottom }, district, block);
  }

  function makeParkingLot(lot) {
    const parking = { type: 'parking', ...lot, stalls: [] };
    lots.push(parking);
    const stallW = 24;
    const stallD = 44;
    const rowsOfStalls = lot.h >= 100 ? 2 : 1;
    const count = Math.floor((lot.w - 8) / stallW);
    const startX = lot.x + (lot.w - count * stallW) / 2;
    for (let row = 0; row < rowsOfStalls; row += 1) {
      const y = row === 0 ? lot.y + 4 : lot.y + lot.h - 4 - stallD;
      for (let k = 0; k < count; k += 1) {
        const stall = { x: startX + k * stallW, y, w: stallW, h: stallD };
        parking.stalls.push(stall);
        if (rng.chance(0.45)) {
          const look = randomCarLook(rng);
          if (CAR_MODELS[look.model].length <= stallD - 2) {
            parkedSpots.push({ x: stall.x + stallW / 2, y: stall.y + stallD / 2, angle: row === 0 ? -Math.PI / 2 : Math.PI / 2, ...look });
          }
        }
      }
    }
  }

  /** Lamps along the curb on every side of `block` that faces a road. */
  function addStreetLamps(block, sides) {
    for (const side of sides) {
      const horizontal = side === 'top' || side === 'bottom';
      const length = horizontal ? block.w : block.h;
      const count = Math.max(1, Math.round((length - 80) / 130) + 1);
      for (let k = 0; k < count; k += 1) {
        const t = count === 1 ? 0.5 : (40 + (k * (length - 80)) / (count - 1)) / length;
        let x;
        let y;
        let nx = 0;
        let ny = 0;
        if (side === 'top') [x, y, ny] = [block.x + t * block.w, block.y + 4, -1];
        else if (side === 'bottom') [x, y, ny] = [block.x + t * block.w, block.y + block.h - 4, 1];
        else if (side === 'left') [x, y, nx] = [block.x + 4, block.y + t * block.h, -1];
        else [x, y, nx] = [block.x + block.w - 4, block.y + t * block.h, 1];
        if (driveways.some((d) => x > d.x - 12 && x < d.x + d.w + 12 && y > d.y - 12 && y < d.y + d.h + 12)) continue;
        props.push({ type: 'lamp', x, y, nx, ny });
        addSolid({ x: x - 2, y: y - 2, w: 4, h: 4 }, 'lamp');
      }
    }
  }

  // ---- The garage block reserves its middle for Repaint & Repair before anything else is placed.
  const garageSpanX = columnSpan(GARAGE_BLOCK.col);
  const garageSpanY = rowSpan(GARAGE_BLOCK.row);
  const garageInner = {
    x: garageSpanX[0] + ROAD.sidewalk,
    y: garageSpanY[0] + ROAD.sidewalk,
    w: garageSpanX[1] - garageSpanX[0] - 2 * ROAD.sidewalk,
    h: garageSpanY[1] - garageSpanY[0] - 2 * ROAD.sidewalk,
  };
  const garageTop = garageInner.y + 68;
  const garageBottom = garageInner.y + garageInner.h - 68;
  const apron = { x: garageInner.x + 170, y: garageTop, w: garageInner.w - 170, h: garageBottom - garageTop };
  // The apron opens onto the avenue east of the block: keep that curb clear.
  driveways.push({ x: garageSpanX[1] - 4, y: apron.y + 8, w: 60, h: apron.h - 16 });

  // ---- City blocks: the grid between the roads, plus the north and west edge strips.
  for (let r = -1; r < ROAD.rows - 1; r += 1) {
    for (let c = -1; c < ROAD.columns - 1; c += 1) {
      const [x0, x1] = columnSpan(c);
      const [y0, y1] = rowSpan(r);
      const block = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, col: c, row: r, kind: 'city' };
      const inner = { x: x0 + ROAD.sidewalk, y: y0 + ROAD.sidewalk, w: block.w - 2 * ROAD.sidewalk, h: block.h - 2 * ROAD.sidewalk };
      const district = districtKeyAt(x0 + block.w / 2, y0 + block.h / 2);
      const isPark = PARK_BLOCKS.some((p) => p.col === c && p.row === r);
      const isGarage = c === GARAGE_BLOCK.col && r === GARAGE_BLOCK.row;
      if (isPark) {
        block.kind = 'park';
        buildPark(block, inner, parks.length);
      } else if (isGarage) {
        block.kind = 'garage';
        const lotsHere = [];
        splitLots({ x: inner.x, y: inner.y, w: inner.w, h: garageTop - inner.y - 6 }, rng, lotsHere, 1);
        splitLots({ x: inner.x, y: garageBottom + 6, w: inner.w, h: inner.y + inner.h - garageBottom - 6 }, rng, lotsHere, 1);
        for (const lot of lotsHere) fillLot(lot, district, block);
      } else {
        const lotsHere = [];
        splitLots(inner, rng, lotsHere);
        for (const lot of lotsHere) fillLot(lot, district, block);
      }
      walkBlocks.push(block);
      blockGrid.set(`${c},${r}`, block);
      const sides = [];
      if (r >= 0) sides.push('top');
      sides.push('bottom');
      if (c >= 0) sides.push('left');
      sides.push('right');
      addStreetLamps(block, sides);
    }
  }

  // ---- Repaint & Repair: a two-storey workshop with a paved apron and a painted roof.
  const garageBuilding = addBuilding(
    { x: garageInner.x + 10, y: garageTop + 8, w: 156, h: apron.h - 16 },
    'west',
    null,
    { floors: 2, color: '#e9c46a', style: 'garage', label: 'REPAINT & REPAIR', details: [], noSign: true },
  );
  const garage = {
    name: 'Repaint & Repair',
    building: garageBuilding,
    apron,
    door: { x: garageBuilding.x + garageBuilding.w, y: garageBuilding.y + 18, w: 6, h: garageBuilding.h - 36 },
    bay: { x: apron.x + 50, y: apron.y + apron.h / 2 },
  };
  lots.push({ type: 'apron', ...apron });

  // ---- The beach promenade: a boardwalk strip between the last avenue and the sand.
  const promenade = { x: ROAD_BOUNDS.maxX, y: 0, w: SHORE.sandX - ROAD_BOUNDS.maxX, h: SHORE.docksY, col: ROAD.columns - 1, row: -1, kind: 'promenade' };
  walkBlocks.push(promenade);
  for (let y = 70; y < promenade.y + promenade.h - 40; y += rng.int(96, 124)) addPalm(promenade.x + 108 + rng.range(-6, 6), y);
  for (let y = 180; y < promenade.h - 120; y += rng.int(380, 520)) {
    const kiosk = addBuilding({ x: promenade.x + 42, y, w: 40, h: 34 }, 'beach', null, { floors: 1, style: 'kiosk', details: [], noSign: true });
    const word = rng.pick(['SURF', 'ICE', 'JUICE', 'SHADES']);
    kiosk.sign = { x: kiosk.x + kiosk.w / 2, y: kiosk.y + kiosk.h - 7, len: 36, thickness: 10, vertical: false, text: word, color: rng.pick(COLORS.neon), phase: rng.range(0, 100), flickery: false };
    signs.push(kiosk.sign);
  }
  addStreetLamps(promenade, ['left']);
  for (let y = 120; y < promenade.h; y += 260) props.push({ type: 'bench', x: promenade.x + 70, y, vertical: true });

  // ---- The beach: umbrellas, towels, lifeguard towers and a volleyball net on the sand.
  for (let k = 0; k < 46; k += 1) {
    const x = rng.range(SHORE.sandX + 40, SHORE.waterX - 40);
    const y = rng.range(40, SHORE.quayY - 40);
    if (rng.chance(0.5)) props.push({ type: 'umbrella', x, y, r: rng.range(13, 18), color: rng.pick(['#ff6f61', '#ffd166', '#06d6a0', '#ef476f', '#118ab2', '#f78c6b']), stripes: rng.int(6, 8) });
    props.push({ type: 'towel', x: x + rng.range(-16, 16), y: y + rng.range(8, 20), angle: rng.range(-0.4, 0.4), color: rng.pick(COLORS.shirts) });
  }
  for (const y of [360, 1200, 2000]) {
    props.push({ type: 'lifeguard', x: SHORE.waterX - 90, y });
    addSolid({ x: SHORE.waterX - 101, y: y - 11, w: 22, h: 22 }, 'lifeguard');
  }
  props.push({ type: 'volleyball', x: 3480, y: 760 });
  for (let k = 0; k < 14; k += 1) addPalm(rng.range(SHORE.sandX + 14, SHORE.sandX + 70), rng.range(40, SHORE.quayY - 60));

  // ---- Harbor Docks: warehouses, container stacks, gantry cranes, a moored freighter.
  const docks = { x: 0, y: SHORE.docksY, w: SHORE.sandX, h: SHORE.quayY - SHORE.docksY };
  const warehouseSpans = [
    [90, 560],
    [1180, 1560],
    [2380, 2860],
  ];
  for (const [a, b] of warehouseSpans) {
    addBuilding({ x: a, y: SHORE.docksY + 18, w: b - a, h: 82 }, 'docks', null, { floors: 2, color: rng.pick(COLORS.warehouse), style: 'warehouse', details: [], noSign: true });
  }
  const containerZones = [
    [600, 1120],
    [1620, 2320],
    [2900, 3140],
  ];
  for (const [a, b] of containerZones) {
    for (let x = a; x + 46 <= b; x += 46 + (rng.chance(0.25) ? 26 : 6)) {
      if (rng.chance(0.15)) continue;
      const stack = rng.int(2, 5);
      const top = SHORE.docksY + 20 + rng.int(0, 1) * 8;
      const cells = [];
      for (let k = 0; k < stack; k += 1) cells.push({ color: rng.pick(COLORS.containers), tall: rng.chance(0.3) });
      props.push({ type: 'containers', x, y: top, w: 46, cellH: 16, cells });
      addSolid({ x, y: top, w: 46, h: stack * 16 }, 'container');
    }
  }
  for (const x of [880, 1700, 2240, 3000]) {
    props.push({ type: 'crane', x, y: SHORE.quayY - 52, w: 70 });
    for (const lx of [x, x + 64]) for (const ly of [SHORE.quayY - 52, SHORE.quayY - 12]) addSolid({ x: lx, y: ly, w: 6, h: 6 }, 'crane');
  }
  for (let x = 30; x < SHORE.sandX; x += 90) props.push({ type: 'bollard', x, y: SHORE.quayY - 5 });
  props.push({ type: 'ship', x: 1260, y: SHORE.quayY + 10, w: 760, h: 64, color: '#2f5d7c', cargo: Array.from({ length: 22 }, () => rng.pick(COLORS.containers)) });

  // ---- The water and the world's edges are solid.
  addSolid({ x: SHORE.waterX, y: -100, w: WORLD.width - SHORE.waterX + 100, h: WORLD.height + 200 }, 'water');
  addSolid({ x: -100, y: SHORE.quayY, w: SHORE.waterX + 100, h: WORLD.height - SHORE.quayY + 100 }, 'water');
  addSolid({ x: -100, y: -100, w: 100, h: WORLD.height + 200 }, 'edge');
  addSolid({ x: -100, y: -100, w: WORLD.width + 200, h: 100 }, 'edge');

  // ---- Cars parked along the curbs of every road segment (facing the way that lane flows).
  for (let j = 0; j < ROAD.rows; j += 1) {
    for (let i = 0; i < ROAD.columns; i += 1) {
      if (i < ROAD.columns - 1) addCurbCars(roadX(i), roadY(j), DIR_EAST);
      if (j < ROAD.rows - 1) addCurbCars(roadX(i), roadY(j), DIR_SOUTH);
    }
  }
  function addCurbCars(nodeX, nodeY, d) {
    const along = DIRS[d];
    for (const side of [1, -1]) {
      // side 1: the right-hand curb for travel direction d; side -1: the other curb, facing the other way.
      const flow = side === 1 ? d : (d + 2) % 4;
      const right = rightOf(d);
      for (let s = 72; s <= ROAD.spacing - 72; s += 54) {
        if (!rng.chance(TRAFFIC.parkedChance)) continue;
        const x = nodeX + along.x * s + right.x * ROAD.parkOffset * side;
        const y = nodeY + along.y * s + right.y * ROAD.parkOffset * side;
        if (driveways.some((dw) => x > dw.x - 30 && x < dw.x + dw.w + 30 && y > dw.y - 30 && y < dw.y + dw.h + 30)) continue;
        parkedSpots.push({ x, y, angle: Math.atan2(DIRS[flow].y, DIRS[flow].x), ...randomCarLook(rng) });
      }
    }
  }

  /** Palm Park: lawns, a ring path and diagonals, a fountain or a bandstand, palms and benches. */
  function buildPark(block, inner, index) {
    const cx = block.x + block.w / 2;
    const cy = block.y + block.h / 2;
    const feature = index === 0 ? 'fountain' : 'bandstand';
    parks.push({ ...block, inner, cx, cy, ring: 92, feature });
    if (feature === 'fountain') addSolid({ x: cx - 26, y: cy - 26, w: 52, h: 52 }, 'fountain');
    else addBuilding({ x: cx - 28, y: cy - 28, w: 56, h: 56 }, 'park', null, { floors: 1, color: '#f6e7c8', style: 'bandstand', details: [], noSign: true });
    let placed = 0;
    for (let attempt = 0; attempt < 200 && placed < 14; attempt += 1) {
      const x = rng.range(inner.x + 14, inner.x + inner.w - 14);
      const y = rng.range(inner.y + 14, inner.y + inner.h - 14);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 48 || Math.abs(dist - 92) < 16) continue; // keep the centre and the ring path clear
      if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 18) continue; // keep the diagonal paths clear
      if (Math.abs(dx) < 14 || Math.abs(dy) < 14) continue; // and the cross paths
      if (props.some((p) => p.type === 'palm' && Math.hypot(p.x - x, p.y - y) < 30)) continue;
      addPalm(x, y);
      placed += 1;
    }
    for (let k = 0; k < 4; k += 1) {
      const angle = Math.PI / 4 + (k * Math.PI) / 2 + 0.38;
      props.push({ type: 'bench', x: cx + Math.cos(angle) * 108, y: cy + Math.sin(angle) * 108, angle: angle + Math.PI / 2 });
    }
  }

  // ---- Spatial index over the solids so collision checks only look at nearby rectangles.
  const CELL = 128;
  const gridCols = Math.ceil((WORLD.width + 200) / CELL);
  const gridRows = Math.ceil((WORLD.height + 200) / CELL);
  const cells = Array.from({ length: gridCols * gridRows }, () => []);
  const cellIndex = (cx, cy) => cy * gridCols + cx;
  for (const solid of solids) {
    const c0 = clamp(Math.floor((solid.x + 100) / CELL), 0, gridCols - 1);
    const c1 = clamp(Math.floor((solid.x + solid.w + 100) / CELL), 0, gridCols - 1);
    const r0 = clamp(Math.floor((solid.y + 100) / CELL), 0, gridRows - 1);
    const r1 = clamp(Math.floor((solid.y + solid.h + 100) / CELL), 0, gridRows - 1);
    for (let cy = r0; cy <= r1; cy += 1) for (let cx = c0; cx <= c1; cx += 1) cells[cellIndex(cx, cy)].push(solid);
  }
  let stamp = 0;

  /** Fills `out` with every solid rectangle whose cell lies within `radius` of (x, y); returns `out`. */
  function solidsNear(x, y, radius, out = []) {
    out.length = 0;
    stamp += 1;
    const c0 = clamp(Math.floor((x - radius + 100) / CELL), 0, gridCols - 1);
    const c1 = clamp(Math.floor((x + radius + 100) / CELL), 0, gridCols - 1);
    const r0 = clamp(Math.floor((y - radius + 100) / CELL), 0, gridRows - 1);
    const r1 = clamp(Math.floor((y + radius + 100) / CELL), 0, gridRows - 1);
    for (let cy = r0; cy <= r1; cy += 1) {
      for (let cx = c0; cx <= c1; cx += 1) {
        const list = cells[cellIndex(cx, cy)];
        for (let k = 0; k < list.length; k += 1) {
          const solid = list[k];
          if (solid.stamp !== stamp) {
            solid.stamp = stamp;
            out.push(solid);
          }
        }
      }
    }
    return out;
  }

  /** True when (x, y) is inside a solid rectangle. */
  function isSolidAt(x, y) {
    const near = solidsNear(x, y, 1, scratch);
    for (const s of near) if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
    return false;
  }
  const scratch = [];

  /** True when (x, y) lies on the asphalt of a road (not a sidewalk or a lot). */
  function isOnRoad(x, y) {
    if (x < ROAD_BOUNDS.minX || x > ROAD_BOUNDS.maxX || y < ROAD_BOUNDS.minY || y > ROAD_BOUNDS.maxY) return false;
    const i = clamp(Math.round((x - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.columns - 1);
    if (Math.abs(x - roadX(i)) <= HALF_ROAD) return true;
    const j = clamp(Math.round((y - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.rows - 1);
    return Math.abs(y - roadY(j)) <= HALF_ROAD;
  }

  /**
   * The nearest point on a road centre line: { x, y, axis: 'v'|'h', index, distance }. For a
   * vertical road `index` is its column i; for a horizontal road, its row j.
   */
  function nearestRoadPoint(x, y) {
    const i = clamp(Math.round((x - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.columns - 1);
    const j = clamp(Math.round((y - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.rows - 1);
    const vx = roadX(i);
    const vy = clamp(y, roadY(0), roadY(ROAD.rows - 1));
    const hx = clamp(x, roadX(0), roadX(ROAD.columns - 1));
    const hy = roadY(j);
    const dv = Math.hypot(x - vx, y - vy);
    const dh = Math.hypot(x - hx, y - hy);
    return dv <= dh ? { x: vx, y: vy, axis: 'v', index: i, distance: dv } : { x: hx, y: hy, axis: 'h', index: j, distance: dh };
  }

  /** What the ground is at (x, y): road, sand, grass, yard, water or lot (sidewalks, plazas, aprons). */
  function surfaceAt(x, y) {
    if (x >= SHORE.waterX || y >= SHORE.quayY) return 'water';
    if (x >= SHORE.sandX) return 'sand';
    if (y >= SHORE.docksY) return 'yard';
    if (isOnRoad(x, y)) return 'road';
    for (const park of parks) {
      if (x > park.inner.x && x < park.inner.x + park.inner.w && y > park.inner.y && y < park.inner.y + park.inner.h) return 'grass';
    }
    return 'lot';
  }

  const spawn = {
    player: { x: apron.x + 64, y: apron.y + 34, angle: 0 },
    playerCar: { x: apron.x + 56, y: apron.y + apron.h - 34, angle: 0, model: 'compact', color: '#7fc8c2' },
  };

  return {
    seed,
    width: WORLD.width,
    height: WORLD.height,
    buildings,
    lots,
    props,
    signs,
    solids,
    parkedSpots,
    walkBlocks,
    blockGrid,
    parks,
    garage,
    promenade,
    docks,
    spawn,
    solidsNear,
    isSolidAt,
    isOnRoad,
    nearestRoadPoint,
    surfaceAt,
    /** The display name of the district at (x, y). */
    districtAt(x, y) {
      return DISTRICT_NAMES[districtKeyAt(x, y)];
    },
  };
}
