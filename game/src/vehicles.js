// Cars: the model, the arcade physics (throttle curve, braking, reverse, speed-scaled steering,
// handbrake drift), collisions (cars are two circles; they slide along walls and shove each other),
// tyre smoke and fading skid marks, and the traffic system: parked cars along the curbs plus AI
// drivers that spawn just out of view, keep to the right-hand lane, turn at intersections, slow
// behind whatever is ahead and vanish once they are far behind the camera.
import { CAR, CAR_MODELS, EFFECTS, ROAD, TRAFFIC } from './config.js';
import { DIRS, randomCarLook, rightOf, roadX, roadY } from './city.js';

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/** The signed difference a - b of two angles, wrapped into (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let nextCarId = 1;

/** A car of `model` (a CAR_MODELS key) at rest. `driver` is null (parked), 'ai' or 'player'. */
export function createCar(model, x, y, angle, color) {
  const spec = CAR_MODELS[model];
  return {
    id: nextCarId++,
    model,
    spec,
    color: color ?? spec.colors[0],
    x,
    y,
    angle,
    vx: 0,
    vy: 0,
    yaw: 0, // angular velocity, radians per second
    steer: 0, // the wheel's current position, -1..1
    speed: 0, // forward speed (negative in reverse)
    lateral: 0, // sideways slip speed
    damage: 0,
    driver: null,
    ai: null,
    asleep: true,
    curbside: false, // one of the city's parked cars (never despawned)
    controls: { throttle: 0, steer: 0, handbrake: true },
    skidLast: null, // rear-wheel positions last step, while skidding
    smokeClock: 0,
    impactClock: 0,
    burning: false, // engine on fire (combat.js): it keeps taking damage until it blows
    wrecked: false, // burnt-out shell after an explosion: solid, but nobody drives it again
    lastPlayerHit: -Infinity, // world time the player last shot or rammed it (who gets the blame for a blast)
    owned: false, // the player has driven it before, so climbing back in is not a theft
    siren: 0, // light-bar phase for police cruisers
  };
}

/** Skid marks, tyre smoke and the impact events of the last step (read by the camera, the police, combat and sound). */
export function createEffects() {
  return { skids: [], smoke: [], impacts: [], time: 0 };
}

/** World positions of the two rear wheels. */
function rearWheels(car) {
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  const back = -car.spec.length * 0.32;
  const side = car.spec.width * 0.38;
  return [
    { x: car.x + cos * back - sin * side, y: car.y + sin * back + cos * side },
    { x: car.x + cos * back + sin * side, y: car.y + sin * back - cos * side },
  ];
}

/** Adds one puff of tyre (light) or engine (dark) smoke. */
export function addSmoke(effects, x, y, vx, vy, dark, rng) {
  if (effects.smoke.length >= EFFECTS.maxSmoke) effects.smoke.shift();
  effects.smoke.push({ x, y, vx: vx + rng.range(-12, 12), vy: vy + rng.range(-12, 12), r: rng.range(3, 5), life: 0, max: rng.range(0.7, 1.2), dark });
}

/**
 * Advances one car by `dt` using its `controls` ({ throttle -1..1, steer -1..1, handbrake }).
 * Velocity lives in the world frame; grip bleeds off the sideways part, so a fast turn or a pulled
 * handbrake lets the tail step out.
 */
export function stepCarPhysics(car, dt, city, effects, rng) {
  const spec = car.spec;
  const controls = car.controls;
  const surface = city.surfaceAt(car.x, car.y);
  const offroad = surface === 'grass' || surface === 'sand';

  car.steer += (controls.steer - car.steer) * Math.min(1, dt * CAR.steerResponse);
  let cos = Math.cos(car.angle);
  let sin = Math.sin(car.angle);
  let forward = car.vx * cos + car.vy * sin;
  const speedFactor = clamp(Math.abs(forward) / 90, 0, 1);
  const highSpeedDamp = 1 - 0.45 * clamp(Math.abs(forward) / spec.top, 0, 1);
  const handbrakeBoost = controls.handbrake ? 1.45 : 1;
  const targetYaw = car.steer * spec.turn * speedFactor * highSpeedDamp * handbrakeBoost * Math.sign(forward);
  car.yaw += (targetYaw - car.yaw) * Math.min(1, dt * CAR.yawResponse);
  car.angle += car.yaw * dt;

  cos = Math.cos(car.angle);
  sin = Math.sin(car.angle);
  forward = car.vx * cos + car.vy * sin;
  let lateral = -car.vx * sin + car.vy * cos;
  const top = spec.top * (offroad ? 0.62 : 1) * (1 - (car.damage / CAR.maxDamage) * 0.35);
  const throttle = controls.throttle;

  // Engine and brakes: strong pull off the line that fades toward top speed.
  if (throttle > 0) {
    if (forward < -8) forward = Math.min(0, forward + spec.brake * throttle * dt);
    else forward += spec.accel * throttle * (1 - Math.pow(clamp(forward / top, 0, 1), 1.8)) * dt;
  } else if (throttle < 0) {
    if (forward > 8) forward = Math.max(0, forward - spec.brake * -throttle * dt);
    else forward -= spec.accel * 0.55 * -throttle * (1 - clamp(-forward / (top * 0.32), 0, 1)) * dt;
  }
  if (throttle === 0 || (throttle > 0 && forward > top)) {
    const coast = (CAR.roll + Math.abs(forward) * CAR.drag) * dt;
    forward -= Math.sign(forward) * Math.min(Math.abs(forward), coast);
  }
  if (offroad) forward -= forward * CAR.offroadDrag * dt;
  if (controls.handbrake) forward -= Math.sign(forward) * Math.min(Math.abs(forward), CAR.handbrakeDecel * dt);

  // Grip: the tyres kill sideways slip, handing some of it back as forward speed.
  const grip = (controls.handbrake ? spec.gripDrift : spec.grip) * (offroad ? CAR.offroadGrip : 1);
  const gripped = lateral * Math.exp(-grip * dt);
  forward += Math.sign(forward) * Math.abs(lateral - gripped) * CAR.gripConvert;
  lateral = gripped;

  car.vx = cos * forward - sin * lateral;
  car.vy = sin * forward + cos * lateral;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.speed = forward;
  car.lateral = lateral;

  // Skids and smoke.
  const skidding =
    Math.abs(lateral) > CAR.skidLateral ||
    (controls.handbrake && Math.abs(forward) > 90) ||
    (throttle < 0 && forward > 210) ||
    (throttle > 0 && forward > 10 && forward < 60 && spec.accel > 400);
  if (skidding && !offroad) {
    const wheels = rearWheels(car);
    if (car.skidLast) {
      const intensity = clamp((Math.abs(lateral) + Math.abs(forward) * 0.2) / 200, 0.35, 1);
      for (let k = 0; k < 2; k += 1) {
        effects.skids.push({ x1: car.skidLast[k].x, y1: car.skidLast[k].y, x2: wheels[k].x, y2: wheels[k].y, age: 0, alpha: intensity });
      }
      if (effects.skids.length > EFFECTS.maxSkids) effects.skids.splice(0, effects.skids.length - EFFECTS.maxSkids);
    }
    car.skidLast = wheels;
    car.smokeClock -= dt;
    if (car.smokeClock <= 0) {
      car.smokeClock = 0.05;
      for (const wheel of wheels) addSmoke(effects, wheel.x, wheel.y, car.vx * 0.15, car.vy * 0.15, false, rng);
    }
  } else {
    car.skidLast = null;
  }
  // A badly damaged car smokes from under the hood.
  if (car.damage > CAR.maxDamage * 0.6) {
    car.smokeClock -= dt * 0.5;
    if (car.smokeClock <= 0) {
      car.smokeClock = 0.12;
      addSmoke(effects, car.x + cos * spec.length * 0.35, car.y + sin * spec.length * 0.35, car.vx * 0.3, car.vy * 0.3, true, rng);
    }
  }

  if (!car.driver && Math.abs(car.vx) < 3 && Math.abs(car.vy) < 3 && Math.abs(car.yaw) < 0.05) {
    car.asleep = true;
    car.vx = 0;
    car.vy = 0;
    car.yaw = 0;
    car.speed = 0;
  }
}

/** The two circles a car is made of: centre offsets along its axis and their radius. */
function carCircles(car) {
  const radius = car.spec.width * 0.5 + 1;
  const offset = car.spec.length * 0.5 - radius;
  return { radius, offset };
}

/** Dents `car` for a hit of `strength`, and logs the impact (with the other car's id, if it was a car) once per quarter second. */
function recordImpact(effects, car, x, y, strength, other = null) {
  // The player's car shrugs off crashes a little better: dents now lead to fire and explosions, and arcade driving bumps a lot.
  const toughness = car.driver === 'player' ? CAR.playerCrashScale : 1;
  if (strength > CAR.impactDamage) car.damage = Math.min(CAR.maxDamage, car.damage + (strength - CAR.impactDamage) * car.spec.fragility * toughness);
  if (other && other.driver === 'player' && strength > 60) car.lastPlayerHit = effects.time;
  if (strength > 90 && car.impactClock <= 0) {
    car.impactClock = 0.25;
    effects.impacts.push({ x, y, strength, carId: car.id, otherId: other ? other.id : 0, player: car.driver === 'player', byPlayer: !!other && other.driver === 'player' });
  }
  if (car.ai && strength > 110) car.ai.dazed = 1.1;
}

const solidScratch = [];

/** Pushes a car out of buildings and other solids; it keeps the speed along the wall and loses the speed into it. */
export function collideCarWithSolids(car, city, effects) {
  const { radius, offset } = carCircles(car);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const end of [-1, 1]) {
      const cos = Math.cos(car.angle);
      const sin = Math.sin(car.angle);
      const lx = cos * offset * end;
      const ly = sin * offset * end;
      let cx = car.x + lx;
      let cy = car.y + ly;
      const near = city.solidsNear(cx, cy, radius + 4, solidScratch);
      for (let k = 0; k < near.length; k += 1) {
        const s = near[k];
        const px = clamp(cx, s.x, s.x + s.w);
        const py = clamp(cy, s.y, s.y + s.h);
        let dx = cx - px;
        let dy = cy - py;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        let nx;
        let ny;
        let push;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = dx / d;
          ny = dy / d;
          push = radius - d;
        } else {
          // Centre inside the rectangle: leave by the nearest side.
          const left = cx - s.x;
          const right = s.x + s.w - cx;
          const top = cy - s.y;
          const bottom = s.y + s.h - cy;
          const least = Math.min(left, right, top, bottom);
          if (least === left) [nx, ny] = [-1, 0];
          else if (least === right) [nx, ny] = [1, 0];
          else if (least === top) [nx, ny] = [0, -1];
          else [nx, ny] = [0, 1];
          push = least + radius;
        }
        car.x += nx * push;
        car.y += ny * push;
        cx += nx * push;
        cy += ny * push;
        const into = car.vx * nx + car.vy * ny;
        if (into < 0) {
          car.vx -= (1 + CAR.restitution) * into * nx;
          car.vy -= (1 + CAR.restitution) * into * ny;
          const tx = -ny;
          const ty = nx;
          const along = car.vx * tx + car.vy * ty;
          car.vx -= along * (1 - CAR.wallFriction) * tx;
          car.vy -= along * (1 - CAR.wallFriction) * ty;
          // A hit off the car's centre spins it a little.
          car.yaw += (lx * ny - ly * nx) * -into * 0.0005;
          recordImpact(effects, car, px, py, -into);
        }
      }
    }
  }
}

/** Separates two overlapping cars and trades momentum between them. */
function collideCarPair(a, b, effects) {
  const dxCentre = a.x - b.x;
  const dyCentre = a.y - b.y;
  if (Math.abs(dxCentre) > 60 || Math.abs(dyCentre) > 60) return;
  const ca = carCircles(a);
  const cb = carCircles(b);
  // Parked cars are heavier to shove (handbrake on, in gear).
  const massA = a.spec.mass * (a.driver ? 1 : 1.6);
  const massB = b.spec.mass * (b.driver ? 1 : 1.6);
  const invA = 1 / massA;
  const invB = 1 / massB;
  for (const ea of [-1, 1]) {
    for (const eb of [-1, 1]) {
      const ax = a.x + Math.cos(a.angle) * ca.offset * ea;
      const ay = a.y + Math.sin(a.angle) * ca.offset * ea;
      const bx = b.x + Math.cos(b.angle) * cb.offset * eb;
      const by = b.y + Math.sin(b.angle) * cb.offset * eb;
      let dx = ax - bx;
      let dy = ay - by;
      const reach = ca.radius + cb.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = d2 > 1e-6 ? dx / d : 1;
      const ny = d2 > 1e-6 ? dy / d : 0;
      const push = reach - d;
      a.x += nx * push * (invA / (invA + invB));
      a.y += ny * push * (invA / (invA + invB));
      b.x -= nx * push * (invB / (invA + invB));
      b.y -= ny * push * (invB / (invA + invB));
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing < 0) {
        const impulse = (-(1 + CAR.restitution) * closing) / (invA + invB);
        a.vx += impulse * invA * nx;
        a.vy += impulse * invA * ny;
        b.vx -= impulse * invB * nx;
        b.vy -= impulse * invB * ny;
        a.yaw += ea * impulse * invA * 0.004 * Math.sign(nx * Math.sin(a.angle) - ny * Math.cos(a.angle));
        b.yaw -= eb * impulse * invB * 0.004 * Math.sign(nx * Math.sin(b.angle) - ny * Math.cos(b.angle));
        const midX = (ax + bx) / 2;
        const midY = (ay + by) / 2;
        recordImpact(effects, a, midX, midY, -closing, b);
        recordImpact(effects, b, midX, midY, -closing, a);
      }
      a.asleep = false;
      b.asleep = false;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Traffic

const LANE = ROAD.laneOffset;

/** The travel directions that lead out of intersection (i, j) to another intersection. */
function exitsFrom(i, j) {
  const exits = [];
  if (i < ROAD.columns - 1) exits.push(0);
  if (j < ROAD.rows - 1) exits.push(1);
  if (i > 0) exits.push(2);
  if (j > 0) exits.push(3);
  return exits;
}

/** A point in the lane for direction `d` through intersection (i, j), `along` pixels past its centre. */
function lanePoint(i, j, d, along) {
  const right = rightOf(d);
  const v = DIRS[d];
  return { x: roadX(i) + right.x * LANE + v.x * along, y: roadY(j) + right.y * LANE + v.y * along };
}

/** Where the incoming lane (direction d) and the outgoing lane (direction nd) cross inside intersection (i, j). */
function laneCorner(i, j, d, nd) {
  const rd = rightOf(d);
  const rn = rightOf(nd);
  if (DIRS[d].y === 0) return { x: roadX(i) + rn.x * LANE, y: roadY(j) + rd.y * LANE };
  return { x: roadX(i) + rd.x * LANE, y: roadY(j) + rn.y * LANE };
}

/** True when (x, y) is inside `rect` grown by `margin` on every side. */
function insideRect(rect, x, y, margin) {
  return x > rect.x - margin && x < rect.x + rect.w + margin && y > rect.y - margin && y < rect.y + rect.h + margin;
}

/**
 * The traffic system: owns every car in the world (curbside, AI-driven and the player's) and the
 * effects they leave behind. step() is called once per fixed step by the world.
 */
export function createTraffic(city, rng) {
  const cars = [];
  const effects = createEffects();

  for (const spot of city.parkedSpots) {
    const car = createCar(spot.model, spot.x, spot.y, spot.angle, spot.color);
    car.curbside = true;
    cars.push(car);
  }

  /** Adds the next turn (and the approach to the intersection after it) to an AI car's route. */
  function planNextTurn(ai) {
    const { i, j, dir } = ai.next;
    const options = exitsFrom(i, j).filter((nd) => nd !== (dir + 2) % 4);
    let nd = (dir + 2) % 4;
    if (options.length) {
      let total = 0;
      for (const option of options) total += option === dir ? 2.2 : 1;
      let roll = rng.next() * total;
      for (const option of options) {
        roll -= option === dir ? 2.2 : 1;
        if (roll <= 0) {
          nd = option;
          break;
        }
      }
    }
    if (nd !== dir) {
      const corner = laneCorner(i, j, dir, nd);
      const v = DIRS[dir];
      const nv = DIRS[nd];
      const lead = nd === (dir + 1) % 4 ? 22 : 28; // right turns are tighter than left turns
      ai.queue.push({ x: corner.x - v.x * lead, y: corner.y - v.y * lead, slow: true });
      ai.queue.push({ x: corner.x + nv.x * lead, y: corner.y + nv.y * lead, slow: true });
    }
    const ni = i + DIRS[nd].x;
    const nj = j + DIRS[nd].y;
    ai.queue.push(lanePoint(ni, nj, nd, -60));
    ai.next = { i: ni, j: nj, dir: nd };
  }

  /** Re-joins the road network from wherever the car ended up (after a crash or a shove). */
  function reroute(car) {
    const ai = car.ai;
    const road = city.nearestRoadPoint(car.x, car.y);
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    let i;
    let j;
    let d;
    if (road.axis === 'v') {
      i = road.index;
      d = sin >= 0 ? 1 : 3;
      const t = (car.y - ROAD.firstCenter) / ROAD.spacing;
      j = d === 1 ? Math.ceil(t) : Math.floor(t);
      if (j > ROAD.rows - 1 || j < 0) {
        d = (d + 2) % 4;
        j = clamp(j, 0, ROAD.rows - 1);
      }
    } else {
      j = road.index;
      d = cos >= 0 ? 0 : 2;
      const t = (car.x - ROAD.firstCenter) / ROAD.spacing;
      i = d === 0 ? Math.ceil(t) : Math.floor(t);
      if (i > ROAD.columns - 1 || i < 0) {
        d = (d + 2) % 4;
        i = clamp(i, 0, ROAD.columns - 1);
      }
    }
    ai.queue.length = 0;
    if (road.distance > 50) ai.queue.push({ x: road.x, y: road.y, slow: true });
    ai.queue.push(lanePoint(i, j, d, -60));
    ai.next = { i, j, dir: d };
    ai.wait = 0;
    ai.stuck = 0;
  }

  /** The speed an AI car may drive at given what is in front of it (cars, people). */
  function clearSpeedAhead(car, context) {
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    let limit = Infinity;
    for (let k = 0; k < cars.length; k += 1) {
      const other = cars[k];
      if (other === car) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      if (dx > 140 || dx < -140 || dy > 140 || dy < -140) continue;
      const along = dx * cos + dy * sin;
      if (along <= 0 || along > 140) continue;
      const side = Math.abs(-dx * sin + dy * cos);
      // Only what is actually in this lane: cars parked at the curb sit just beside it.
      if (side > (car.spec.width + other.spec.width) / 2 - 3) continue;
      const gap = along - (car.spec.length + other.spec.length) / 2;
      limit = Math.min(limit, Math.max(0, (gap - 8) * 2.4));
    }
    for (const person of context.people) {
      const dx = person.x - car.x;
      const dy = person.y - car.y;
      if (dx > 100 || dx < -100 || dy > 100 || dy < -100) continue;
      const along = dx * cos + dy * sin;
      if (along <= 0 || along > 95) continue;
      if (Math.abs(-dx * sin + dy * cos) > car.spec.width / 2 + 9) continue;
      limit = Math.min(limit, Math.max(0, (along - car.spec.length / 2 - 12) * 2.2));
    }
    return limit;
  }

  /** Sets an AI car's controls: follow the route, slow for turns and obstacles, recover when stuck. */
  function driveAI(car, dt, context) {
    const ai = car.ai;
    const controls = car.controls;
    if (ai.dazed > 0) {
      ai.dazed -= dt;
      controls.throttle = car.speed > 5 ? -0.6 : 0;
      controls.steer = 0;
      controls.handbrake = false;
      if (ai.dazed <= 0) reroute(car);
      return;
    }
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      controls.throttle = -0.7;
      controls.steer = ai.reverseSteer;
      controls.handbrake = false;
      if (ai.reverse <= 0) reroute(car);
      return;
    }
    while (ai.queue.length < 4) planNextTurn(ai);
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    let target = ai.queue[0];
    let dx = target.x - car.x;
    let dy = target.y - car.y;
    let dist = Math.hypot(dx, dy);
    for (let guard = 0; guard < 4 && (dist < 20 || (dist < 70 && dx * cos + dy * sin < 0)); guard += 1) {
      ai.queue.shift();
      while (ai.queue.length < 4) planNextTurn(ai);
      target = ai.queue[0];
      dx = target.x - car.x;
      dy = target.y - car.y;
      dist = Math.hypot(dx, dy);
    }
    if (dist > 480) {
      reroute(car);
      return;
    }
    const heading = angleDiff(Math.atan2(dy, dx), car.angle);
    controls.steer = clamp(heading * 2.4, -1, 1);

    let wanted = ai.cruise;
    for (let k = 0; k < Math.min(3, ai.queue.length); k += 1) {
      const point = ai.queue[k];
      if (!point.slow) continue;
      const d = Math.hypot(point.x - car.x, point.y - car.y);
      wanted = Math.min(wanted, TRAFFIC.turnSpeed + Math.max(0, d - 30) * 1.1);
    }
    wanted *= clamp(1 - Math.abs(heading) * 0.55, 0.3, 1);
    if (ai.ignore > 0) ai.ignore -= dt;
    else {
      const ahead = clearSpeedAhead(car, context);
      if (ahead < wanted) wanted = ahead;
      if (ahead < 10) {
        ai.wait += dt;
        if (ai.wait > ai.patience) {
          ai.wait = 0;
          ai.ignore = 1.4; // nobody waits forever: nudge through
        }
      } else ai.wait = Math.max(0, ai.wait - dt);
    }

    const error = wanted - car.speed;
    if (wanted < 4) {
      controls.throttle = car.speed > 4 ? -1 : 0;
      controls.handbrake = car.speed <= 4;
    } else {
      controls.handbrake = false;
      controls.throttle = error > 0 ? clamp(error / 40 + 0.15, 0, 1) : error < -10 ? clamp(error / 80, -1, 0) : 0;
    }
    // Pressing on but not moving: back up, then find the road again.
    if (wanted > 30 && Math.abs(car.speed) < 8) {
      ai.stuck += dt;
      if (ai.stuck > 1.6) {
        ai.stuck = 0;
        ai.reverse = 0.9;
        ai.reverseSteer = -controls.steer || (rng.chance(0.5) ? 1 : -1);
      }
    } else ai.stuck = Math.max(0, ai.stuck - dt);
  }

  function makeAI(next, firstTarget, model) {
    return {
      next,
      queue: [firstTarget],
      cruise: TRAFFIC.cruise * rng.range(0.85, 1.15) * (model === 'sports' ? 1.15 : model === 'van' ? 0.9 : 1),
      wait: 0,
      ignore: 0,
      dazed: 0,
      stuck: 0,
      reverse: 0,
      reverseSteer: 0,
      patience: TRAFFIC.stuckPatience + rng.range(0, 2),
    };
  }

  /**
   * Tries once to put a new AI car in a lane: outside `view` (grown by spawnMargin) but inside it
   * grown by spawnBand. With `anywhere`, it may appear inside the view too (filling a fresh city),
   * just not near `avoid`.
   */
  function trySpawn(view, anywhere, avoid) {
    const i = rng.int(0, ROAD.columns - 1);
    const j = rng.int(0, ROAD.rows - 1);
    const d = rng.pick(exitsFrom(i, j));
    const along = rng.range(90, ROAD.spacing - 90);
    const p = lanePoint(i, j, d, along);
    if (!insideRect(view, p.x, p.y, TRAFFIC.spawnMargin + TRAFFIC.spawnBand)) return false;
    if (!anywhere && insideRect(view, p.x, p.y, TRAFFIC.spawnMargin)) return false;
    if (avoid && Math.hypot(p.x - avoid.x, p.y - avoid.y) < 220) return false;
    for (const other of cars) if (Math.abs(other.x - p.x) < 70 && Math.abs(other.y - p.y) < 70) return false;
    const look = randomCarLook(rng);
    const angle = Math.atan2(DIRS[d].y, DIRS[d].x);
    const car = createCar(look.model, p.x, p.y, angle, look.color);
    car.driver = 'ai';
    car.asleep = false;
    const ni = i + DIRS[d].x;
    const nj = j + DIRS[d].y;
    car.ai = makeAI({ i: ni, j: nj, dir: d }, lanePoint(ni, nj, d, -60), look.model);
    const start = car.ai.cruise * 0.7;
    car.vx = Math.cos(angle) * start;
    car.vy = Math.sin(angle) * start;
    car.speed = start;
    cars.push(car);
    return true;
  }

  /** Removes AI cars far outside the view and old abandoned cars; spawns new ones up to the target count. */
  function managePopulation(view, anywhere, avoid) {
    let aiCount = 0;
    let abandoned = 0;
    for (let k = cars.length - 1; k >= 0; k -= 1) {
      const car = cars[k];
      const far = !insideRect(view, car.x, car.y, TRAFFIC.despawnMargin);
      if (car.driver === 'ai') {
        if (far) cars.splice(k, 1);
        else aiCount += 1;
      } else if (!car.driver && !car.curbside) {
        abandoned += 1;
        if (abandoned > TRAFFIC.maxAbandoned && far) cars.splice(k, 1);
      }
    }
    const attempts = anywhere ? 400 : 3;
    for (let k = 0; k < attempts && aiCount < TRAFFIC.count; k += 1) {
      if (trySpawn(view, anywhere, avoid)) aiCount += 1;
    }
  }

  function stepEffects(dt) {
    const skids = effects.skids;
    for (let k = 0; k < skids.length; k += 1) skids[k].age += dt;
    let expired = 0;
    while (expired < skids.length && skids[expired].age > EFFECTS.skidLife) expired += 1;
    if (expired) skids.splice(0, expired);
    const smoke = effects.smoke;
    for (let k = smoke.length - 1; k >= 0; k -= 1) {
      const puff = smoke[k];
      puff.life += dt;
      if (puff.life >= puff.max) {
        smoke.splice(k, 1);
        continue;
      }
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.vx *= 1 - dt * 1.5;
      puff.vy *= 1 - dt * 1.5;
      puff.r += dt * 14;
    }
  }

  return {
    cars,
    effects,
    /**
     * One fixed step. `context`: { view (world rect the camera sees), people (pedestrians and the
     * player on foot, for braking), fill (spawn anywhere, for a fresh start), avoid (a point to keep
     * new cars away from) }.
     */
    step(dt, context) {
      effects.impacts.length = 0;
      effects.time += dt;
      managePopulation(context.view, context.fill, context.avoid);
      for (const car of cars) if (car.driver === 'ai') driveAI(car, dt, context);
      for (const car of cars) {
        if (car.impactClock > 0) car.impactClock -= dt;
        if (car.driver) car.asleep = false;
        else if (!car.asleep) {
          car.controls.throttle = 0;
          car.controls.steer = 0;
          car.controls.handbrake = true;
        }
        if (!car.asleep) stepCarPhysics(car, dt, city, effects, rng);
      }
      for (const car of cars) if (!car.asleep) collideCarWithSolids(car, city, effects);
      for (let a = 0; a < cars.length; a += 1) {
        const first = cars[a];
        for (let b = a + 1; b < cars.length; b += 1) {
          const second = cars[b];
          if (first.asleep && second.asleep) continue;
          collideCarPair(first, second, effects);
        }
      }
      stepEffects(dt);
    },
    /** Takes a car out of the world (used when it is replaced or lost). */
    removeCar(car) {
      const index = cars.indexOf(car);
      if (index >= 0) cars.splice(index, 1);
    },
    /** Adds a car (e.g. the player's own) to the world. */
    addCar(car) {
      cars.push(car);
      return car;
    },
    /** Drops every AI car (before refilling around a new camera position). */
    clearAI() {
      for (let k = cars.length - 1; k >= 0; k -= 1) if (cars[k].driver === 'ai') cars.splice(k, 1);
    },
  };
}
