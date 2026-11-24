// Pedestrians: people who stroll the sidewalk ring of a block from corner to corner, now and then
// stop for a moment or cross at a crosswalk to the next block, and who scatter from fast cars and
// crashes (or get knocked over by a car that does not stop). They spawn just out of view and
// vanish once far away, like traffic.
import { COLORS, PEDS } from './config.js';

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
const BASE_INSET = 8; // walking line: this far inside a block's edge, mid-sidewalk

/** The walking point at corner k (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) of a block. */
function cornerPoint(block, k, inset) {
  return {
    x: k === 0 || k === 3 ? block.x + inset : block.x + block.w - inset,
    y: k < 2 ? block.y + inset : block.y + block.h - inset,
  };
}

/** Crosswalks leaving corner k: [dc, dr, arrival corner] for each street that corner touches. */
const CROSSINGS = [
  [
    [0, -1, 3],
    [-1, 0, 1],
  ],
  [
    [0, -1, 2],
    [1, 0, 0],
  ],
  [
    [0, 1, 1],
    [1, 0, 3],
  ],
  [
    [0, 1, 0],
    [-1, 0, 2],
  ],
];

function insideRect(rect, x, y, margin) {
  return x > rect.x - margin && x < rect.x + rect.w + margin && y > rect.y - margin && y < rect.y + rect.h + margin;
}

/** Distance from (x, y) to a rectangle (0 inside). */
function distanceToRect(rect, x, y) {
  const dx = Math.max(rect.x - x, 0, x - rect.x - rect.w);
  const dy = Math.max(rect.y - y, 0, y - rect.y - rect.h);
  return Math.hypot(dx, dy);
}

/** A random look: skin, hair, shirt, trousers. */
export function randomLook(rng) {
  return { skin: rng.pick(COLORS.skin), hair: rng.pick(COLORS.hair), shirt: rng.pick(COLORS.shirts), pants: rng.pick(COLORS.pants), bald: rng.chance(0.08) };
}

const solidScratch = [];

/** Pushes a circle (a person) out of the city's solid rectangles. Shared with the player on foot. */
export function pushOutOfSolids(body, radius, city) {
  const near = city.solidsNear(body.x, body.y, radius + 2, solidScratch);
  for (let k = 0; k < near.length; k += 1) {
    const s = near[k];
    const px = clamp(body.x, s.x, s.x + s.w);
    const py = clamp(body.y, s.y, s.y + s.h);
    const dx = body.x - px;
    const dy = body.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      body.x += (dx / d) * (radius - d);
      body.y += (dy / d) * (radius - d);
    } else {
      const left = body.x - s.x;
      const right = s.x + s.w - body.x;
      const top = body.y - s.y;
      const bottom = s.y + s.h - body.y;
      const least = Math.min(left, right, top, bottom);
      if (least === left) body.x = s.x - radius;
      else if (least === right) body.x = s.x + s.w + radius;
      else if (least === top) body.y = s.y - radius;
      else body.y = s.y + s.h + radius;
    }
  }
}

/**
 * Distance from (x, y) to a car's centre line, and the unit vector pointing away from it.
 * Used to keep people out of cars and to tell when a car hits someone.
 */
export function carContact(car, x, y) {
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  const half = car.spec.length / 2 - car.spec.width / 2;
  const t = clamp((x - car.x) * cos + (y - car.y) * sin, -half, half);
  const dx = x - (car.x + cos * t);
  const dy = y - (car.y + sin * t);
  const d = Math.hypot(dx, dy) || 0.001;
  return { distance: d, nx: dx / d, ny: dy / d, reach: car.spec.width / 2 };
}

export function createPedestrians(city, rng) {
  const peds = [];
  // What happened to the crowd during the last step, for the police and the sound: who was knocked
  // over by which car, and how many people started running.
  const events = { struck: [], fled: 0 };

  /** Sets a pedestrian walking from wherever they stand: to the nearest point of the nearest block's ring, then onward. */
  function rejoinSidewalk(ped) {
    let best = null;
    let bestDistance = Infinity;
    for (const block of city.walkBlocks) {
      const d = distanceToRect(block, ped.x, ped.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = block;
      }
    }
    const inset = BASE_INSET + ped.lane;
    const left = best.x + inset;
    const right = best.x + best.w - inset;
    const top = best.y + inset;
    const bottom = best.y + best.h - inset;
    const x = clamp(ped.x, left, right);
    const y = clamp(ped.y, top, bottom);
    // Snap to the nearest edge of the ring and walk toward the next corner along it.
    const toEdge = [y - top, right - x, bottom - y, x - left];
    const edge = toEdge.indexOf(Math.min(...toEdge));
    const point = edge === 0 ? { x, y: top } : edge === 1 ? { x: right, y } : edge === 2 ? { x, y: bottom } : { x: left, y };
    ped.block = best;
    // Edge e runs from corner e to corner e+1 going clockwise.
    ped.corner = ped.cw === 1 ? (edge + 1) % 4 : edge;
    ped.mode = 'rejoin';
    ped.target = point;
    ped.stuck = 0;
  }

  function walkToCorner(ped) {
    ped.mode = 'walk';
    ped.target = cornerPoint(ped.block, ped.corner, BASE_INSET + ped.lane);
  }

  /** At a corner: carry on round the block, turn back, wait a moment or cross the street. */
  function chooseNextLeg(ped) {
    const roll = rng.next();
    if (roll < 0.1) {
      ped.mode = 'wait';
      ped.timer = rng.range(0.8, 2.6);
      return;
    }
    if (roll < 0.34) {
      const options = [];
      for (const [dc, dr, arrival] of CROSSINGS[ped.corner]) {
        const next = city.blockGrid.get(`${ped.block.col + dc},${ped.block.row + dr}`);
        if (next) options.push({ block: next, corner: arrival });
      }
      if (options.length) {
        const choice = rng.pick(options);
        ped.block = choice.block;
        ped.corner = choice.corner;
        ped.mode = 'cross';
        ped.target = cornerPoint(choice.block, choice.corner, BASE_INSET + ped.lane);
        return;
      }
    }
    if (roll > 0.92) ped.cw = -ped.cw;
    ped.corner = (ped.corner + ped.cw + 4) % 4;
    walkToCorner(ped);
  }

  function makePed(x, y, look) {
    return {
      x,
      y,
      vx: 0,
      vy: 0,
      angle: rng.range(0, Math.PI * 2),
      speed: rng.range(PEDS.walkMin, PEDS.walkMax),
      phase: rng.range(0, Math.PI * 2),
      lane: rng.range(-3, 4),
      cw: rng.chance(0.5) ? 1 : -1,
      look: look ?? randomLook(rng),
      mode: 'walk',
      target: { x, y },
      block: null,
      corner: 0,
      timer: 0,
      stuck: 0,
      moving: 0,
    };
  }

  /** Tries once to place a pedestrian on a sidewalk ring outside the view (or anywhere when filling). */
  function trySpawn(view, anywhere, avoid) {
    // Filling a fresh scene keeps the crowd close, so the street Jett stands in is busy from the first frame.
    const band = anywhere ? PEDS.spawnBand / 3 : PEDS.spawnBand;
    const block = rng.pick(city.walkBlocks);
    if (!insideRect(view, block.x + block.w / 2, block.y + block.h / 2, band + Math.max(block.w, block.h) / 2)) return false;
    const ped = makePed(0, 0);
    const inset = BASE_INSET + ped.lane;
    const edge = rng.int(0, 3);
    const t = rng.next();
    const left = block.x + inset;
    const right = block.x + block.w - inset;
    const top = block.y + inset;
    const bottom = block.y + block.h - inset;
    ped.x = edge === 1 ? right : edge === 3 ? left : left + (right - left) * t;
    ped.y = edge === 0 ? top : edge === 2 ? bottom : top + (bottom - top) * t;
    if (!insideRect(view, ped.x, ped.y, PEDS.spawnMargin + band)) return false;
    if (!anywhere && insideRect(view, ped.x, ped.y, PEDS.spawnMargin)) return false;
    if (avoid && Math.hypot(ped.x - avoid.x, ped.y - avoid.y) < 60) return false;
    if (city.isSolidAt(ped.x, ped.y)) return false;
    ped.block = block;
    ped.corner = ped.cw === 1 ? (edge + 1) % 4 : edge;
    walkToCorner(ped);
    peds.push(ped);
    return true;
  }

  /** Starts a pedestrian running away from (fromX, fromY). */
  function startFleeing(ped, fromX, fromY, sideways) {
    let ax = ped.x - fromX;
    let ay = ped.y - fromY;
    const len = Math.hypot(ax, ay) || 1;
    ax /= len;
    ay /= len;
    if (sideways) {
      ax = ax * 0.5 + sideways.x;
      ay = ay * 0.5 + sideways.y;
      const l2 = Math.hypot(ax, ay) || 1;
      ax /= l2;
      ay /= l2;
    }
    if (ped.mode !== 'flee') events.fled += 1;
    ped.mode = 'flee';
    ped.timer = PEDS.fleeTime * rng.range(0.8, 1.2);
    ped.fleeX = ax;
    ped.fleeY = ay;
  }

  /** Reacts to fast cars heading this way, to crashes nearby, and to being hit. */
  function senseDanger(ped, cars, impacts) {
    if (ped.mode === 'down') return;
    for (const car of cars) {
      if (car.wrecked) continue;
      const dx = ped.x - car.x;
      const dy = ped.y - car.y;
      if (dx > 140 || dx < -140 || dy > 140 || dy < -140) continue;
      const speed = Math.hypot(car.vx, car.vy);
      const contact = carContact(car, ped.x, ped.y);
      if (contact.distance < contact.reach + PEDS.radius) {
        if (speed > 70) {
          // Knocked over: slides with the car's momentum, lies still a moment, then runs.
          ped.mode = 'down';
          ped.timer = 2.4;
          ped.vx = car.vx * 0.7 + contact.nx * 60;
          ped.vy = car.vy * 0.7 + contact.ny * 60;
          events.struck.push({ ped, car });
          return;
        }
        // A slow car just nudges people aside.
        ped.x += contact.nx * (contact.reach + PEDS.radius - contact.distance);
        ped.y += contact.ny * (contact.reach + PEDS.radius - contact.distance);
      }
      if (ped.mode === 'flee' || speed < PEDS.dangerSpeed) continue;
      const d = Math.hypot(dx, dy);
      if (d > PEDS.dangerRadius) continue;
      // Only if the car is coming this way.
      if (dx * car.vx + dy * car.vy <= 0) continue;
      const side = (car.vx * dy - car.vy * dx) >= 0 ? 1 : -1;
      startFleeing(ped, car.x, car.y, { x: (-car.vy / speed) * side, y: (car.vx / speed) * side });
    }
    if (ped.mode !== 'flee') {
      for (const impact of impacts) {
        if (Math.hypot(ped.x - impact.x, ped.y - impact.y) < 170) {
          startFleeing(ped, impact.x, impact.y, null);
          break;
        }
      }
    }
  }

  function stepPed(ped, dt) {
    let wantX = 0;
    let wantY = 0;
    let speed = ped.speed;
    if (ped.mode === 'down') {
      ped.timer -= dt;
      ped.x += ped.vx * dt;
      ped.y += ped.vy * dt;
      ped.vx *= Math.exp(-dt * 5);
      ped.vy *= Math.exp(-dt * 5);
      pushOutOfSolids(ped, PEDS.radius, city);
      ped.moving = 0;
      if (ped.timer <= 0) startFleeing(ped, ped.x - ped.vx, ped.y - ped.vy, null);
      return;
    }
    if (ped.mode === 'wait') {
      ped.timer -= dt;
      ped.moving = 0;
      if (ped.timer <= 0) chooseNextLeg(ped);
      return;
    }
    if (ped.mode === 'flee') {
      ped.timer -= dt;
      wantX = ped.fleeX;
      wantY = ped.fleeY;
      speed = PEDS.flee;
      if (ped.timer <= 0) rejoinSidewalk(ped);
    } else {
      const dx = ped.target.x - ped.x;
      const dy = ped.target.y - ped.y;
      const d = Math.hypot(dx, dy);
      if (d < 2.5) {
        if (ped.mode === 'rejoin') walkToCorner(ped);
        else chooseNextLeg(ped);
        return;
      }
      wantX = dx / d;
      wantY = dy / d;
      if (ped.mode === 'cross') speed *= 1.25;
      if (ped.mode === 'rejoin') speed *= 1.4;
    }
    const beforeX = ped.x;
    const beforeY = ped.y;
    ped.x += wantX * speed * dt;
    ped.y += wantY * speed * dt;
    pushOutOfSolids(ped, PEDS.radius, city);
    const moved = Math.hypot(ped.x - beforeX, ped.y - beforeY);
    ped.moving = moved / dt;
    ped.phase += moved * 0.32;
    if (wantX || wantY) ped.angle = Math.atan2(wantY, wantX);
    // Walking into a wall for a while (a flee that ended badly): find the sidewalk again.
    if (moved < speed * dt * 0.3) {
      ped.stuck += dt;
      if (ped.stuck > 1.2) {
        if (ped.mode === 'rejoin' || ped.mode === 'walk') {
          // Already heading for the sidewalk and still blocked: go round the other way.
          ped.cw = -ped.cw;
          ped.corner = (ped.corner + ped.cw + 4) % 4;
          walkToCorner(ped);
        } else rejoinSidewalk(ped);
        ped.stuck = 0;
      }
    } else ped.stuck = 0;
  }

  return {
    peds,
    events,
    /** One fixed step: keep the crowd sized around the view, sense danger, walk. */
    step(dt, context) {
      const { view, cars, impacts, fill, avoid } = context;
      events.struck.length = 0;
      events.fled = 0;
      for (let k = peds.length - 1; k >= 0; k -= 1) {
        if (!insideRect(view, peds[k].x, peds[k].y, PEDS.despawnMargin)) peds.splice(k, 1);
      }
      const attempts = fill ? 600 : 3;
      for (let k = 0; k < attempts && peds.length < PEDS.count; k += 1) trySpawn(view, fill, avoid);
      for (const ped of peds) {
        senseDanger(ped, cars, impacts);
        stepPed(ped, dt);
      }
    },
    /** A driver pulled from their car: they run from (fromX, fromY). */
    addFleeing(x, y, fromX, fromY) {
      const ped = makePed(x, y);
      peds.push(ped);
      startFleeing(ped, fromX, fromY, null);
      return ped;
    },
    clear() {
      peds.length = 0;
    },
    /**
     * Knocks `ped` over, sliding along (vx, vy). With `stayDown` (shot, or caught in a blast) they
     * do not get up again; they lie there until the crowd forgets them out of view.
     */
    knockDown(ped, vx, vy, stayDown) {
      ped.mode = 'down';
      ped.timer = stayDown ? Infinity : 2.4;
      ped.vx = vx;
      ped.vy = vy;
    },
    /** Everyone within `radius` of (x, y) who is still on their feet runs from it. */
    scatter(x, y, radius) {
      for (const ped of peds) {
        if (ped.mode === 'down' || ped.mode === 'flee') continue;
        if (Math.abs(ped.x - x) < radius && Math.abs(ped.y - y) < radius && Math.hypot(ped.x - x, ped.y - y) < radius) startFleeing(ped, x, y, null);
      }
    },
  };
}
