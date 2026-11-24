// The wanted level and the Azura PD. Crimes raise the level (0–5 stars): stealing a car where a
// pedestrian or an officer can see it (+1), knocking someone over (+2), ramming a cruiser (+1),
// shooting in public (+1, at most every few seconds) and blowing up a car (+2); mission scripts
// can also set the level and lock it. Cruisers spawn on the road just out of view (1, 2, 3, 4, 6
// of them by stars), route along the road grid toward the player, drive straight at them once
// they are close with a clear line, and slow beside someone on foot. A cruiser next to a player
// who is standing (or in a stopped car) fills the BUSTED meter; moving drains it. Out of every
// cruiser's sight (distance, and no building in the way) a lay-low timer runs and the stars drop
// one at a time. The Repaint & Repair respray (drive onto the apron, stop, pay $150) fixes the car,
// gives it a new colour and clears the wanted level on the spot.
import { CAR_MODELS, POLICE, RESPRAY, ROAD } from './config.js';
import { DIRS, rightOf, roadX, roadY } from './city.js';
import { angleDiff, createCar } from './vehicles.js';
import { viewRect } from './camera.js';

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

const solidScratch = [];

/** True when no building or container stack stands on the straight line from (ax, ay) to (bx, by). */
export function lineOfSight(city, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  const steps = Math.ceil(length / 18);
  for (let k = 1; k < steps; k += 1) {
    const x = ax + (dx * k) / steps;
    const y = ay + (dy * k) / steps;
    const near = city.solidsNear(x, y, 1, solidScratch);
    for (let n = 0; n < near.length; n += 1) {
      const s = near[n];
      if (s.kind !== 'building' && s.kind !== 'container') continue;
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return false;
    }
  }
  return true;
}

/** True when a building, container or the water is at (x, y) (what a driver steers around). */
function blockedAt(city, x, y) {
  const near = city.solidsNear(x, y, 1, solidScratch);
  for (let n = 0; n < near.length; n += 1) {
    const s = near[n];
    if (s.kind === 'lamp' || s.kind === 'palm') continue;
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
  }
  return false;
}

/**
 * How far to bend the heading (radians) to pass the nearest car in the way ahead, or 0. `ignore` is
 * a car not to dodge (the one being chased, so a cruiser still rams it).
 */
function dodgeCars(car, cars, ignore) {
  if (!cars) return 0;
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  const reach = 50 + Math.max(0, car.speed) * 0.3;
  let best = Infinity;
  let bend = 0;
  for (let k = 0; k < cars.length; k += 1) {
    const other = cars[k];
    if (other === car || other === ignore) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    if (dx > reach + 30 || dx < -reach - 30 || dy > reach + 30 || dy < -reach - 30) continue;
    const along = dx * cos + dy * sin;
    if (along <= 0 || along > reach || along >= best) continue;
    const side = -dx * sin + dy * cos;
    const clearance = (car.spec.width + other.spec.width) / 2 + 5;
    if (Math.abs(side) > clearance) continue;
    best = along;
    // Pass on the side the other car leaves more room on, more sharply the closer it is.
    bend = (side >= 0 ? -1 : 1) * (0.35 + 0.5 * (1 - along / reach));
  }
  return bend;
}

/**
 * Sets `car.controls` to drive toward (tx, ty) at about `desiredSpeed`: steers at the point, swerves
 * round cars in the way (`cars`, except `ignore`), feels ahead for walls and leans away from them,
 * brakes for sharp turns, and backs out (turning toward the target) when it has been pushing against
 * something without moving. Shared by the cruisers and the mission rival.
 */
export function driveToward(car, tx, ty, desiredSpeed, dt, city, cars = null, ignore = null) {
  const nav = car.nav ?? (car.nav = { stuck: 0, reverse: 0, reverseSteer: 1 });
  const controls = car.controls;
  controls.handbrake = false;
  if (nav.reverse > 0) {
    nav.reverse -= dt;
    controls.throttle = -0.8;
    controls.steer = nav.reverseSteer;
    return;
  }
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  const aim = angleDiff(Math.atan2(ty - car.y, tx - car.x), car.angle);
  let heading = aim + dodgeCars(car, cars, ignore);
  // Feel ahead: if the nose is about to meet a wall, turn toward whichever side is open.
  const probe = 34 + Math.max(0, car.speed) * 0.18;
  if (blockedAt(city, car.x + cos * probe, car.y + sin * probe)) {
    const leftOpen = !blockedAt(city, car.x + Math.cos(car.angle - 0.7) * probe, car.y + Math.sin(car.angle - 0.7) * probe);
    const rightOpen = !blockedAt(city, car.x + Math.cos(car.angle + 0.7) * probe, car.y + Math.sin(car.angle + 0.7) * probe);
    if (leftOpen && !rightOpen) heading = Math.min(heading, -0.9);
    else if (rightOpen && !leftOpen) heading = Math.max(heading, 0.9);
  }
  controls.steer = clamp(heading * 2.4, -1, 1);
  let wanted = desiredSpeed * clamp(1 - Math.abs(heading) * 0.6, 0.25, 1);
  if (Math.abs(heading) > 1.9 && car.speed < 60) wanted = Math.min(wanted, 90); // turn round slowly
  const error = wanted - car.speed;
  if (error > 0) controls.throttle = clamp(error / 40 + 0.25, 0, 1);
  else controls.throttle = error < -15 ? clamp(error / 70, -1, 0) : 0;
  // A tight turn at speed: pull the handbrake to swing the tail round.
  if (Math.abs(heading) > 1 && car.speed > 190) controls.handbrake = true;
  if (wanted > 40 && Math.abs(car.speed) < 12) {
    nav.stuck += dt;
    if (nav.stuck > 0.8) {
      // Reverse with the wheel turned so the nose swings toward the target as the car backs off.
      nav.stuck = 0;
      nav.reverse = 1;
      nav.reverseSteer = aim >= 0 ? -1 : 1;
    }
  } else nav.stuck = Math.max(0, nav.stuck - dt * 2);
}

/** The road-grid column and row nearest (x, y). */
function nearestIntersection(x, y) {
  return {
    i: clamp(Math.round((x - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.columns - 1),
    j: clamp(Math.round((y - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.rows - 1),
  };
}

/**
 * The wanted system. Lives in the world; `step` runs once per fixed step in play. Pushes
 * { type: 'wanted', level, rose } and { type: 'busted' } onto world.events.
 */
export function createPolice(world, rng) {
  const city = world.city;
  const traffic = world.traffic;
  const police = {
    level: 0,
    locked: false, // a mission holds the level where it is
    cars: [],
    bust: 0, // seconds the BUSTED meter has filled (out of POLICE.bustTime)
    seen: false, // some cruiser can see the player right now
    layLow: 0, // seconds unseen
    flash: 0, // seconds left of the "stars just changed" blink
    nearest: Infinity, // distance to the nearest chasing cruiser (for the siren)
    spawnClock: 0,
    gunfireClock: 0,
    ramClock: 0,
    sprayArmed: true, // the respray only charges again after the car has left the apron
  };

  function announce(rose) {
    police.flash = 1.6;
    world.events.push({ type: 'wanted', level: police.level, rose });
  }

  /** Adds `stars` to the wanted level for a crime (ignored while a mission holds the level). */
  police.raise = function raise(stars) {
    if (police.locked || stars <= 0) return;
    const before = police.level;
    police.level = Math.min(POLICE.maxStars, police.level + stars);
    police.layLow = 0;
    if (police.level !== before) announce(true);
  };

  /** Sets the level outright (a mission script); with `lock`, it stays there until unlocked. */
  police.setLevel = function setLevel(level, lock = false) {
    const before = police.level;
    police.level = clamp(level, 0, POLICE.maxStars);
    police.locked = lock;
    police.layLow = 0;
    if (police.level !== before) announce(police.level > before);
  };

  police.unlock = function unlock() {
    police.locked = false;
  };

  /** Clears the wanted level; cruisers in view peel away, the rest vanish. */
  police.clear = function clearWanted() {
    police.level = 0;
    police.locked = false;
    police.bust = 0;
    police.layLow = 0;
  };

  /** Takes every cruiser out of the world (a respawn or a new game). */
  police.reset = function reset() {
    police.clear();
    for (const car of police.cars) traffic.removeCar(car);
    police.cars.length = 0;
    police.flash = 0;
    police.nearest = Infinity;
  };

  function carSpec() {
    const base = CAR_MODELS.police;
    return { ...base };
  }

  /** Puts a cruiser on a road lane outside the view, pointed toward the player. */
  function trySpawn(view) {
    const player = world.player;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const vertical = rng.chance(0.5);
      let x;
      let y;
      let d;
      if (vertical) {
        x = roadX(rng.int(0, ROAD.columns - 1));
        y = rng.range(roadY(0), roadY(ROAD.rows - 1));
        d = player.y > y ? 1 : 3;
      } else {
        y = roadY(rng.int(0, ROAD.rows - 1));
        x = rng.range(roadX(0), roadX(ROAD.columns - 1));
        d = player.x > x ? 0 : 2;
      }
      const right = rightOf(d);
      x += right.x * ROAD.laneOffset;
      y += right.y * ROAD.laneOffset;
      const outside = x < view.x - POLICE.spawnMin || x > view.x + view.w + POLICE.spawnMin || y < view.y - POLICE.spawnMin || y > view.y + view.h + POLICE.spawnMin;
      const withinBand = x > view.x - POLICE.spawnMax && x < view.x + view.w + POLICE.spawnMax && y > view.y - POLICE.spawnMax && y < view.y + view.h + POLICE.spawnMax;
      if (!outside || !withinBand) continue;
      if (traffic.cars.some((other) => Math.abs(other.x - x) < 60 && Math.abs(other.y - y) < 60)) continue;
      const angle = Math.atan2(DIRS[d].y, DIRS[d].x);
      const car = createCar('police', x, y, angle, CAR_MODELS.police.colors[0]);
      car.spec = carSpec();
      car.driver = 'police';
      car.asleep = false;
      car.retreating = false;
      car.vx = Math.cos(angle) * 160;
      car.vy = Math.sin(angle) * 160;
      car.speed = 160;
      traffic.addCar(car);
      police.cars.push(car);
      return true;
    }
    return false;
  }

  /**
   * Where a chasing cruiser should head. With a clear line and close: straight at the player.
   * Otherwise it drives the road grid (one turn at a time, L-shaped) to the road point nearest the
   * player, and from there goes straight in once it can see them.
   */
  function chaseTarget(car, target, dist, visible) {
    if (visible && dist < POLICE.ramRange) return { x: target.x, y: target.y, direct: true };
    const road = city.nearestRoadPoint(car.x, car.y);
    const goal = city.nearestRoadPoint(target.x, target.y);
    if (road.distance > 70) {
      // Off the grid (a lot, the beach, the docks): head for the player if seen, else back to the road.
      return visible && dist < 700 ? { x: target.x, y: target.y, direct: true } : { x: road.x, y: road.y, direct: false };
    }
    if (Math.hypot(goal.x - car.x, goal.y - car.y) < 70) {
      return visible ? { x: target.x, y: target.y, direct: true } : { x: goal.x, y: goal.y, direct: false };
    }
    const near = 46;
    if (road.axis === 'v') {
      const i = road.index;
      if (goal.axis === 'v' && goal.index === i) return { x: roadX(i), y: goal.y, direct: false };
      // Pick the street to turn onto: the goal's own street, or the one nearest the goal point.
      const j = goal.axis === 'h' ? goal.index : nearestIntersection(goal.x, goal.y).j;
      if (Math.abs(car.y - roadY(j)) < near) return { x: goal.axis === 'h' ? goal.x : roadX(goal.index), y: roadY(j), direct: false };
      return { x: roadX(i), y: roadY(j), direct: false, turn: true };
    }
    const j = road.index;
    if (goal.axis === 'h' && goal.index === j) return { x: goal.x, y: roadY(j), direct: false };
    const i = goal.axis === 'v' ? goal.index : nearestIntersection(goal.x, goal.y).i;
    if (Math.abs(car.x - roadX(i)) < near) return { x: roadX(i), y: goal.axis === 'v' ? goal.y : roadY(goal.index), direct: false };
    return { x: roadX(i), y: roadY(j), direct: false, turn: true };
  }

  function stepCruiser(car, dt, target, targetVX, targetVY, onFoot) {
    const dx = target.x - car.x;
    const dy = target.y - car.y;
    const dist = Math.hypot(dx, dy);
    const sight = POLICE.sight + police.level * POLICE.sightPerStar;
    const visible = dist < sight && lineOfSight(city, car.x, car.y, target.x, target.y);
    if (visible) police.seen = true;
    police.nearest = Math.min(police.nearest, dist);
    car.siren += dt;

    // Faster with each star, a little more at five, and a touch of catch-up when far behind.
    const boost = 1 + police.level * POLICE.topBoost + (police.level >= 5 ? POLICE.fiveStarBoost : 0);
    const base = CAR_MODELS.police;
    car.spec.top = base.top * boost * (dist > 700 ? 1.1 : 1);
    car.spec.accel = base.accel * boost;

    const goal = chaseTarget(car, target, dist, visible);
    let tx = goal.x;
    let ty = goal.y;
    let speed = car.spec.top;
    if (goal.direct) {
      // Lead a moving target a little; slow to a stop beside someone on foot or in a stopped car.
      const lead = Math.min(0.55, dist / 450);
      tx += targetVX * lead;
      ty += targetVY * lead;
      const targetSpeed = Math.hypot(targetVX, targetVY);
      if (onFoot || targetSpeed < POLICE.bustStillSpeed) speed = clamp((dist - 34) * 2.2, 0, speed);
    } else if (goal.turn) {
      // Ease off before a corner so the turn does not end in a wall.
      const toCorner = Math.hypot(tx - car.x, ty - car.y);
      if (toCorner < 80 + car.speed * 0.65) speed = Math.min(speed, 125);
    }
    driveToward(car, tx, ty, speed, dt, city, traffic.cars, goal.direct ? target : null);
    if (goal.direct && speed < 5 && dist < 60) {
      car.controls.throttle = car.speed > 3 ? -1 : 0;
      car.controls.handbrake = car.speed <= 3;
    }
  }

  /** A cruiser that has been called off drives away and is removed once out of view. */
  function stepRetreat(car, dt, view) {
    car.siren = 0;
    const player = world.player;
    const ax = car.x - player.x;
    const ay = car.y - player.y;
    const len = Math.hypot(ax, ay) || 1;
    driveToward(car, car.x + (ax / len) * 400, car.y + (ay / len) * 400, 140, dt, city, traffic.cars);
    const out = car.x < view.x - 80 || car.x > view.x + view.w + 80 || car.y < view.y - 80 || car.y > view.y + view.h + 80;
    return out;
  }

  /** Crimes the world reported this step: people knocked over by the player's car, cruisers rammed. */
  function readCrimes(dt) {
    for (const hit of world.pedestrians.events.struck) {
      if (hit.car.driver === 'player' && !hit.ped.reported) {
        hit.ped.reported = true;
        police.raise(2);
      }
    }
    police.ramClock -= dt;
    if (police.ramClock <= 0) {
      for (const impact of traffic.effects.impacts) {
        if (!impact.byPlayer) continue;
        if (!police.cars.some((car) => car.id === impact.carId)) continue;
        police.raise(1);
        police.ramClock = 3;
        break;
      }
    }
    police.gunfireClock -= dt;
  }

  /** A theft (`event` 'steal' or 'carjack' from the player) is a crime if someone sees it. */
  police.reportTheft = function reportTheft(event, car) {
    if (event === 'carjack') {
      police.raise(1); // the driver dragged out of the seat saw it all
      return;
    }
    for (const cop of police.cars) {
      if (Math.hypot(cop.x - car.x, cop.y - car.y) < POLICE.policeWitnessRange && lineOfSight(city, cop.x, cop.y, car.x, car.y)) {
        police.raise(1);
        return;
      }
    }
    for (const ped of world.pedestrians.peds) {
      if (ped.mode === 'down') continue;
      if (Math.abs(ped.x - car.x) > POLICE.witnessRange || Math.abs(ped.y - car.y) > POLICE.witnessRange) continue;
      if (Math.hypot(ped.x - car.x, ped.y - car.y) < POLICE.witnessRange && lineOfSight(city, ped.x, ped.y, car.x, car.y)) {
        police.raise(1);
        return;
      }
    }
  };

  /** A shot fired: +1 if anyone is near enough to hear it as a crime (at most every gunfireThrottle seconds). */
  police.reportGunfire = function reportGunfire(x, y, witnessed) {
    if (!witnessed || police.gunfireClock > 0) return;
    police.gunfireClock = POLICE.gunfireThrottle;
    police.raise(1);
  };

  /** One fixed step in play. */
  police.step = function step(dt) {
    readCrimes(dt);
    police.flash = Math.max(0, police.flash - dt);
    const view = viewRect(world.camera);
    const player = world.player;
    const inCar = player.mode === 'car';
    const target = inCar ? player.car : player;
    const targetVX = inCar ? player.car.vx : player.vx;
    const targetVY = inCar ? player.car.vy : player.vy;

    // Drop cruisers that were stolen, wrecked or cleared away by someone else.
    for (let k = police.cars.length - 1; k >= 0; k -= 1) {
      const car = police.cars[k];
      if (car.driver !== 'police' || car.wrecked || !traffic.cars.includes(car)) {
        if (car.driver === 'police') car.driver = null;
        car.siren = 0;
        police.cars.splice(k, 1);
      }
    }
    const desired = POLICE.carsByStars[police.level];
    let chasing = 0;
    for (const car of police.cars) {
      if (!car.retreating && chasing < desired) chasing += 1;
      else car.retreating = true;
    }
    if (chasing < desired) {
      police.spawnClock -= dt;
      if (police.spawnClock <= 0 && trySpawn(view)) police.spawnClock = POLICE.spawnEvery * (chasing === 0 ? 0.4 : 1);
    } else police.spawnClock = Math.min(police.spawnClock, 0.6);

    police.seen = false;
    police.nearest = Infinity;
    for (let k = police.cars.length - 1; k >= 0; k -= 1) {
      const car = police.cars[k];
      if (car.retreating) {
        if (stepRetreat(car, dt, view)) {
          traffic.removeCar(car);
          police.cars.splice(k, 1);
        }
      } else stepCruiser(car, dt, target, targetVX, targetVY, !inCar);
    }

    if (police.level === 0) {
      police.bust = 0;
      police.layLow = 0;
      return;
    }

    // Lay low: out of sight long enough and a star drops.
    if (police.seen || police.locked) police.layLow = 0;
    else {
      police.layLow += dt;
      if (police.layLow >= police.layLowNeeded()) {
        police.layLow = 0;
        police.level -= 1;
        announce(false);
      }
    }

    // BUSTED: a cruiser right beside a player who is standing still or sitting in a stopped car.
    const still = inCar ? Math.abs(player.car.speed) < POLICE.bustStillSpeed : player.moving < 60;
    let close = false;
    if (still) {
      for (const car of police.cars) {
        if (car.retreating || Math.abs(car.speed) > 120) continue;
        if (Math.hypot(car.x - target.x, car.y - target.y) < POLICE.bustRange + (inCar ? 18 : 0)) {
          close = true;
          break;
        }
      }
    }
    if (close) police.bust += dt;
    else police.bust = Math.max(0, police.bust - dt * POLICE.bustDrain);
    if (police.bust >= POLICE.bustTime) {
      police.bust = 0;
      world.events.push({ type: 'busted' });
    }
  };

  /** Repaint & Repair: a stopped car on the apron with heat or damage gets fixed for RESPRAY.cost. */
  police.stepRespray = function stepRespray() {
    const player = world.player;
    const apron = city.garage.apron;
    const car = player.mode === 'car' ? player.car : null;
    const onApron = car && car.x > apron.x && car.x < apron.x + apron.w && car.y > apron.y && car.y < apron.y + apron.h;
    if (!onApron) {
      police.sprayArmed = true;
      return;
    }
    if (!police.sprayArmed || police.locked || Math.abs(car.speed) > RESPRAY.stopSpeed) return;
    if (police.level === 0 && car.damage < 5) return;
    police.sprayArmed = false;
    if (world.stats.cash < RESPRAY.cost) {
      world.events.push({ type: 'respray-broke' });
      return;
    }
    world.stats.cash -= RESPRAY.cost;
    car.damage = 0;
    car.burning = false;
    const colors = car.spec.colors ?? CAR_MODELS[car.model].colors;
    const palette = colors.length > 1 ? colors.filter((c) => c !== car.color) : ['#e2434b', '#2fb5a8', '#9d7fd0', '#e8b04a'];
    car.color = rng.pick(palette);
    police.clear();
    world.events.push({ type: 'respray' });
  };

  /** Seconds unseen it takes to lose the current star. */
  police.layLowNeeded = function layLowNeeded() {
    return POLICE.layLow + police.level * POLICE.layLowPerStar;
  };

  return police;
}
