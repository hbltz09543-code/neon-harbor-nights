// On-foot gunplay and everything that hurts. Jett carries a pistol: aim with the mouse, click or
// hold to fire (6 shots a second), 12 rounds to a magazine, R reloads (1.1 s). Shots are hitscan:
// the first building, car or pedestrian on the line takes it, with a brief tracer, a muzzle flash
// and sparks where it lands. Cars take damage from bullets as well as crashes; they smoke as they
// weaken, catch fire near the end and then explode (fireball, screen shake, damage to everything
// close by, and +2 stars if Jett did it). Jett is hurt by hard crashes at the wheel, by being run
// down and by blasts, and heals slowly while nobody is after him. The effects live in `fx` for
// render.js to draw.
import { BLAST, CAR, COLORS, HEALTH, PLAYER, WEAPON } from './config.js';
import { addSmoke } from './vehicles.js';
import { carContact, pushOutOfSolids } from './pedestrians.js';
import { shakeCamera } from './camera.js';

const solidScratch = [];
const MAX_SCORCHES = 30;
const MAX_PARTICLES = 260;

/** Where a ray from (ox, oy) along (dx, dy) first enters a circle, as a distance along the ray, or Infinity. */
function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : c < 0 ? 0 : Infinity;
}

/** The distance along a shot to the first building or container stack, or Infinity within `range`. */
function rayWall(city, ox, oy, dx, dy, range) {
  for (let t = 4; t <= range; t += 5) {
    const x = ox + dx * t;
    const y = oy + dy * t;
    const near = city.solidsNear(x, y, 1, solidScratch);
    for (let n = 0; n < near.length; n += 1) {
      const s = near[n];
      if (s.kind !== 'building' && s.kind !== 'container' && s.kind !== 'crane' && s.kind !== 'lamp') continue;
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return t;
    }
  }
  return Infinity;
}

export function createCombat(world, rng) {
  const fx = { tracers: [], flashes: [], sparks: [], fireballs: [], flames: [], scorches: [] };
  const weapon = { ammo: WEAPON.magazine, reloading: 0, cooldown: 0, dryClock: 0 };
  const combat = {
    fx,
    weapon,
    hurtFlash: 0, // 0..1, the red edge of the screen after a hit
    sinceHurt: 99,
    runOverClock: 0,
  };

  function pushParticle(list, particle) {
    if (list.length >= MAX_PARTICLES) list.shift();
    list.push(particle);
  }

  function sparks(x, y, count, speed, color) {
    for (let k = 0; k < count; k += 1) {
      const a = rng.range(0, Math.PI * 2);
      const v = rng.range(speed * 0.4, speed);
      pushParticle(fx.sparks, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rng.range(0.15, 0.35), color });
    }
  }

  /** Takes `amount` off Jett's health (a crash, a car, a blast). */
  combat.hurt = function hurt(amount) {
    if (amount <= 0 || world.stats.health <= 0 || world.mode !== 'play') return;
    world.stats.health = Math.max(0, world.stats.health - amount);
    combat.hurtFlash = Math.min(1, combat.hurtFlash + 0.25 + amount / 40);
    combat.sinceHurt = 0;
    world.events.push({ type: 'hurt', amount }); // at 0 the world notices and calls it WASTED
  };

  /** Back to a full magazine and no lingering effects (a new game, a respawn). */
  combat.reset = function reset() {
    weapon.ammo = WEAPON.magazine;
    weapon.reloading = 0;
    weapon.cooldown = 0;
    combat.hurtFlash = 0;
    combat.sinceHurt = 99;
    for (const list of Object.values(fx)) list.length = 0;
  };

  combat.startReload = function startReload() {
    if (weapon.reloading > 0 || weapon.ammo >= WEAPON.magazine) return;
    weapon.reloading = WEAPON.reload;
    world.events.push({ type: 'reload' });
  };

  /** Blows `car` up: a wreck, a fireball, a shove and damage to everything within the blast radius. */
  combat.explode = function explode(car) {
    if (car.wrecked) return;
    const player = world.player;
    const byPlayer = world.time - car.lastPlayerHit < 6;
    car.wrecked = true;
    car.burning = false;
    car.damage = CAR.maxDamage;
    car.color = COLORS.wreck;
    car.curbside = false;
    car.controls.throttle = 0;
    car.controls.handbrake = true;
    car.yaw += rng.range(-2, 2);
    car.asleep = false;
    if (car.driver === 'player') {
      // Thrown clear of the wreck, badly hurt.
      player.mode = 'foot';
      player.car = null;
      player.x = car.x - Math.sin(car.angle) * (car.spec.width / 2 + PLAYER.radius + 4);
      player.y = car.y + Math.cos(car.angle) * (car.spec.width / 2 + PLAYER.radius + 4);
      player.vx = 0;
      player.vy = 0;
      pushOutOfSolids(player, PLAYER.radius, world.city);
      combat.hurt(BLAST.playerDamage * 0.85);
    }
    car.driver = null;
    car.ai = null;

    pushParticle(fx.fireballs, { x: car.x, y: car.y, r: 70, life: 0, max: 0.75 });
    for (let k = 0; k < 10; k += 1) {
      const a = rng.range(0, Math.PI * 2);
      const v = rng.range(40, 140);
      pushParticle(fx.fireballs, { x: car.x, y: car.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: rng.range(16, 30), life: 0, max: rng.range(0.5, 0.9) });
    }
    sparks(car.x, car.y, 26, 420, '#ffd27a');
    for (let k = 0; k < 8; k += 1) addSmoke(world.traffic.effects, car.x + rng.range(-14, 14), car.y + rng.range(-14, 14), rng.range(-30, 30), rng.range(-30, 30), true, rng);
    if (fx.scorches.length >= MAX_SCORCHES) fx.scorches.shift();
    fx.scorches.push({ x: car.x, y: car.y, r: 46 });
    const camDist = Math.hypot(world.camera.x - car.x, world.camera.y - car.y);
    shakeCamera(world.camera, BLAST.shake * Math.max(0.2, 1 - camDist / 900));

    // Everything near the blast.
    for (const other of world.traffic.cars) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const d = Math.hypot(dx, dy);
      if (d >= BLAST.radius) continue;
      const falloff = 1 - d / BLAST.radius;
      other.damage = Math.min(CAR.maxDamage, other.damage + BLAST.carDamage * falloff);
      const push = (BLAST.push * falloff) / other.spec.mass;
      other.vx += (dx / (d || 1)) * push;
      other.vy += (dy / (d || 1)) * push;
      other.yaw += rng.range(-1.5, 1.5) * falloff;
      other.asleep = false;
      if (byPlayer) other.lastPlayerHit = world.time;
    }
    for (const ped of world.pedestrians.peds) {
      if (ped.mode === 'down') continue;
      const dx = ped.x - car.x;
      const dy = ped.y - car.y;
      const d = Math.hypot(dx, dy);
      if (d >= BLAST.radius) continue;
      world.pedestrians.knockDown(ped, (dx / (d || 1)) * 120, (dy / (d || 1)) * 120, d < BLAST.radius * 0.55);
      ped.reported = true; // the blast itself is the crime
    }
    world.pedestrians.scatter(car.x, car.y, 320);
    if (player.mode === 'foot') {
      const d = Math.hypot(player.x - car.x, player.y - car.y);
      if (d < BLAST.radius) combat.hurt(BLAST.playerDamage * (1 - d / BLAST.radius));
    } else if (player.car && player.car !== car) {
      const d = Math.hypot(player.car.x - car.x, player.car.y - car.y);
      if (d < BLAST.radius) combat.hurt(BLAST.playerDamage * 0.35 * (1 - d / BLAST.radius));
    }
    if (byPlayer) world.police.raise(2);
    world.events.push({ type: 'explosion', x: car.x, y: car.y, byPlayer });
  };

  /** Fires one round from Jett along `angle`: finds what it hits first and applies it. */
  combat.fire = function fire(angle) {
    const player = world.player;
    const city = world.city;
    const shot = angle + rng.range(-WEAPON.spread, WEAPON.spread);
    const dx = Math.cos(shot);
    const dy = Math.sin(shot);
    // The muzzle: in front of Jett, off his right shoulder where the pistol is drawn.
    const ox = player.x + Math.cos(player.angle) * WEAPON.muzzle - Math.sin(player.angle) * 3.7;
    const oy = player.y + Math.sin(player.angle) * WEAPON.muzzle + Math.cos(player.angle) * 3.7;
    let best = rayWall(city, ox, oy, dx, dy, WEAPON.range);
    let hitCar = null;
    let hitPed = null;
    for (const car of world.traffic.cars) {
      if (Math.abs(car.x - ox) > WEAPON.range + 30 || Math.abs(car.y - oy) > WEAPON.range + 30) continue;
      const radius = car.spec.width * 0.5 + 1;
      const offset = car.spec.length * 0.5 - radius;
      for (const end of [-1, 0, 1]) {
        const cx = car.x + Math.cos(car.angle) * offset * end;
        const cy = car.y + Math.sin(car.angle) * offset * end;
        const t = rayCircle(ox, oy, dx, dy, cx, cy, radius);
        if (t < best) {
          best = t;
          hitCar = car;
          hitPed = null;
        }
      }
    }
    for (const ped of world.pedestrians.peds) {
      if (ped.mode === 'down') continue;
      if (Math.abs(ped.x - ox) > WEAPON.range || Math.abs(ped.y - oy) > WEAPON.range) continue;
      const t = rayCircle(ox, oy, dx, dy, ped.x, ped.y, 6);
      if (t < best) {
        best = t;
        hitPed = ped;
        hitCar = null;
      }
    }
    const reach = Math.min(best, WEAPON.range);
    const hx = ox + dx * reach;
    const hy = oy + dy * reach;
    pushParticle(fx.tracers, { x1: ox, y1: oy, x2: hx, y2: hy, life: 0, max: 0.07 });
    pushParticle(fx.flashes, { x: ox, y: oy, angle: player.angle, life: 0, max: 0.05 });
    if (hitCar) {
      hitCar.damage = Math.min(CAR.maxDamage, hitCar.damage + WEAPON.carDamage);
      hitCar.lastPlayerHit = world.time;
      sparks(hx, hy, 7, 220, '#ffe08a');
      addSmoke(world.traffic.effects, hx, hy, -dx * 20, -dy * 20, false, rng);
      if (hitCar.ai) hitCar.ai.cruise = Math.min(hitCar.ai.cruise * 1.25, 260); // the driver floors it
      world.events.push({ type: 'hit', target: 'car', carId: hitCar.id });
    } else if (hitPed) {
      world.pedestrians.knockDown(hitPed, dx * 70, dy * 70, true);
      if (!hitPed.reported) {
        hitPed.reported = true;
        world.police.raise(2);
      }
      sparks(hx, hy, 4, 120, '#fff4dc');
      world.events.push({ type: 'hit', target: 'ped' });
    } else if (best < Infinity) {
      sparks(hx, hy, 6, 200, '#ffd27a');
    }
    // Everyone near the shooter runs; anyone close enough makes it a public shooting.
    world.pedestrians.scatter(player.x, player.y, 260);
    let witnessed = false;
    for (const ped of world.pedestrians.peds) {
      if (Math.abs(ped.x - player.x) < WEAPON.publicRange && Math.abs(ped.y - player.y) < WEAPON.publicRange) {
        witnessed = true;
        break;
      }
    }
    if (!witnessed) witnessed = world.police.cars.some((car) => Math.hypot(car.x - player.x, car.y - player.y) < WEAPON.publicRange * 1.5);
    world.police.reportGunfire(player.x, player.y, witnessed);
    world.events.push({ type: 'shot', x: ox, y: oy });
  };

  /** The pistol: reloading, the trigger, the empty click. `firing` is whether the button is held. */
  function stepWeapon(dt, firing, reloadPressed) {
    weapon.cooldown = Math.max(0, weapon.cooldown - dt);
    weapon.dryClock = Math.max(0, weapon.dryClock - dt);
    if (weapon.reloading > 0) {
      weapon.reloading -= dt;
      if (weapon.reloading <= 0) {
        weapon.reloading = 0;
        weapon.ammo = WEAPON.magazine;
        world.events.push({ type: 'reloaded' });
      }
      return;
    }
    if (reloadPressed) {
      combat.startReload();
      return;
    }
    if (!firing || weapon.cooldown > 1e-6) return;
    if (weapon.ammo <= 0) {
      if (weapon.dryClock <= 0) {
        weapon.dryClock = 0.4;
        world.events.push({ type: 'dryfire' });
      }
      combat.startReload();
      return;
    }
    weapon.ammo -= 1;
    weapon.cooldown = 1 / WEAPON.rate;
    combat.fire(world.player.angle);
  }

  /** Fires, smoke and explosions for every damaged car. */
  function stepCarDamage(dt) {
    const cars = world.traffic.cars;
    const cam = world.camera;
    for (let k = cars.length - 1; k >= 0; k -= 1) {
      const car = cars[k];
      if (car.wrecked) {
        // A burnt-out shell smoulders for a while.
        if (rng.chance(dt * 1.5) && Math.abs(car.x - cam.x) < 900 && Math.abs(car.y - cam.y) < 700) addSmoke(world.traffic.effects, car.x, car.y, rng.range(-8, 8), rng.range(-8, 8), true, rng);
        continue;
      }
      if (!car.burning && car.damage >= BLAST.fireAt) {
        car.burning = true;
        // Whoever is driving bails out and runs (Jett has to get out himself).
        if (car.driver === 'ai' || car.driver === 'police' || car.driver === 'mission') {
          const side = car.spec.width / 2 + 8;
          world.pedestrians.addFleeing(car.x + Math.sin(car.angle) * side, car.y - Math.cos(car.angle) * side, car.x, car.y);
          car.driver = null;
          car.ai = null;
          car.asleep = false;
        }
      }
      if (car.burning) {
        car.damage += BLAST.burnRate * dt;
        const ex = car.x + Math.cos(car.angle) * car.spec.length * 0.32;
        const ey = car.y + Math.sin(car.angle) * car.spec.length * 0.32;
        if (rng.chance(dt * 30)) pushParticle(fx.flames, { x: ex + rng.range(-5, 5), y: ey + rng.range(-5, 5), vx: rng.range(-10, 10) + 12, vy: rng.range(-10, 10) - 16, r: rng.range(4, 8), life: 0, max: rng.range(0.3, 0.6) });
        if (rng.chance(dt * 8)) addSmoke(world.traffic.effects, ex, ey, 14, -18, true, rng);
      } else if (car.damage > 40 && (car.asleep || car.damage <= CAR.maxDamage * 0.6) && rng.chance(dt * (car.damage / 25))) {
        // Wisps from under the hood as the car weakens (the physics adds heavier smoke past 60% on moving cars).
        if (Math.abs(car.x - cam.x) < 900 && Math.abs(car.y - cam.y) < 700) {
          addSmoke(world.traffic.effects, car.x + Math.cos(car.angle) * car.spec.length * 0.35, car.y + Math.sin(car.angle) * car.spec.length * 0.35, 6, -10, car.damage > 60, rng);
        }
      }
      if (car.damage >= CAR.maxDamage) combat.explode(car);
    }
  }

  /** Crashes at the wheel and being run down on foot. */
  function stepPlayerHarm(dt) {
    const player = world.player;
    combat.runOverClock = Math.max(0, combat.runOverClock - dt);
    if (player.mode === 'car') {
      for (const impact of world.traffic.effects.impacts) {
        if (impact.carId === player.car.id && impact.strength > HEALTH.crashThreshold) combat.hurt((impact.strength - HEALTH.crashThreshold) * HEALTH.crashScale);
      }
      return;
    }
    if (combat.runOverClock > 0) return;
    for (const car of world.traffic.cars) {
      if (car.wrecked || Math.abs(car.x - player.x) > 40 || Math.abs(car.y - player.y) > 40) continue;
      const speed = Math.hypot(car.vx, car.vy);
      if (speed < HEALTH.runOverSpeed) continue;
      const contact = carContact(car, player.x, player.y);
      if (contact.distance > contact.reach + PLAYER.radius + 2) continue;
      combat.hurt(speed * HEALTH.runOverScale);
      combat.runOverClock = 0.8;
      // Knocked aside along the car's path.
      player.x += contact.nx * 10 + (car.vx / speed) * 6;
      player.y += contact.ny * 10 + (car.vy / speed) * 6;
      pushOutOfSolids(player, PLAYER.radius, world.city);
      world.events.push({ type: 'impact', strength: speed });
      break;
    }
  }

  function stepEffects(dt) {
    const age = (list, move, drag) => {
      for (let k = list.length - 1; k >= 0; k -= 1) {
        const p = list[k];
        p.life += dt;
        if (p.life >= p.max) {
          list.splice(k, 1);
          continue;
        }
        if (move && p.vx !== undefined) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 1 - dt * drag;
          p.vy *= 1 - dt * drag;
        }
      }
    };
    age(fx.tracers, false, 0);
    age(fx.flashes, false, 0);
    age(fx.sparks, true, 4);
    age(fx.fireballs, true, 3);
    age(fx.flames, true, 1);
  }

  /**
   * One fixed step in play. `firing`: the fire button is held (and not over a HUD button);
   * `reloadPressed`: R was pressed this step.
   */
  combat.step = function step(dt, firing, reloadPressed) {
    const player = world.player;
    if (player.mode === 'foot') stepWeapon(dt, firing, reloadPressed);
    else weapon.cooldown = Math.max(0, weapon.cooldown - dt);
    stepCarDamage(dt);
    stepPlayerHarm(dt);
    stepEffects(dt);
    combat.hurtFlash = Math.max(0, combat.hurtFlash - dt * 1.6);
    combat.sinceHurt += dt;
    const stats = world.stats;
    if (world.police.level === 0 && combat.sinceHurt > HEALTH.regenDelay && stats.health > 0 && stats.health < HEALTH.max) {
      stats.health = Math.min(HEALTH.max, stats.health + HEALTH.regenRate * dt);
    }
  };

  /** Ages the effects only (the title screen and staged shots, where nobody holds the pistol). */
  combat.stepEffectsOnly = function stepEffectsOnly(dt) {
    stepCarDamage(dt);
    stepEffects(dt);
  };

  return combat;
}
