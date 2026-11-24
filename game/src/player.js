// Jett Marlowe, the player. On foot: walk or sprint with WASD / arrows (Shift), always facing the
// mouse, blocked by buildings and cars. E next to a car climbs in (pulling out whoever was driving);
// in a car, WASD / arrows drive it, Space is the handbrake, and E climbs out on the driver's side,
// leaving the car parked where it stopped.
import { PLAYER } from './config.js';
import { carContact, pushOutOfSolids } from './pedestrians.js';

export function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: spawn.angle ?? 0,
    mode: 'foot', // 'foot' or 'car'
    car: null,
    phase: 0,
    moving: 0,
  };
}

/** The car nearest the player that is close enough to climb into, or null. */
export function findEnterableCar(player, cars) {
  let best = null;
  let bestGap = PLAYER.enterRange;
  for (const car of cars) {
    if (car.wrecked) continue;
    if (Math.abs(car.x - player.x) > 80 || Math.abs(car.y - player.y) > 80) continue;
    const contact = carContact(car, player.x, player.y);
    const gap = contact.distance - contact.reach;
    if (gap < bestGap) {
      bestGap = gap;
      best = car;
    }
  }
  return best;
}

/** Puts the player behind the wheel of `car`; an AI driver is pulled out and runs. Returns the event name. */
function enterCar(player, car, world) {
  // Climbing into a car Jett has never driven is a theft (police.js decides whether anyone saw it).
  let event = car.owned ? 'enter' : 'steal';
  if (car.driver === 'ai' || car.driver === 'police' || car.driver === 'mission') {
    const cos = Math.cos(car.angle);
    const sin = Math.sin(car.angle);
    const side = car.spec.width / 2 + 8;
    world.pedestrians.addFleeing(car.x + sin * side, car.y - cos * side, player.x, player.y);
    event = 'carjack';
  }
  car.driver = 'player';
  car.owned = true;
  car.ai = null;
  car.curbside = false;
  car.asleep = false;
  car.controls.handbrake = false;
  player.mode = 'car';
  player.car = car;
  player.vx = 0;
  player.vy = 0;
  return event;
}

/** Climbs out on the driver's (left) side if there is room, else the other side, behind or in front. */
function exitCar(player, world) {
  const car = player.car;
  const cos = Math.cos(car.angle);
  const sin = Math.sin(car.angle);
  const side = car.spec.width / 2 + PLAYER.radius + 3;
  const end = car.spec.length / 2 + PLAYER.radius + 3;
  const spots = [
    { x: car.x + sin * side, y: car.y - cos * side },
    { x: car.x - sin * side, y: car.y + cos * side },
    { x: car.x - cos * end, y: car.y - sin * end },
    { x: car.x + cos * end, y: car.y + sin * end },
  ];
  for (const spot of spots) {
    if (world.city.isSolidAt(spot.x, spot.y)) continue;
    if (spot.x < 4 || spot.y < 4 || spot.x > world.city.width - 4 || spot.y > world.city.height - 4) continue;
    let blocked = false;
    for (const other of world.traffic.cars) {
      if (other === car || Math.abs(other.x - spot.x) > 60 || Math.abs(other.y - spot.y) > 60) continue;
      const contact = carContact(other, spot.x, spot.y);
      if (contact.distance < contact.reach + PLAYER.radius) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    car.driver = null;
    car.controls.throttle = 0;
    car.controls.steer = 0;
    car.controls.handbrake = true;
    player.mode = 'foot';
    player.car = null;
    player.x = spot.x;
    player.y = spot.y;
    player.vx = 0;
    player.vy = 0;
    return true;
  }
  return false; // boxed in: stay in the car and drive out
}

/**
 * One fixed step of the player. `input` is the live input, `aim` the mouse in world coordinates,
 * `interact` whether E was pressed this step. Returns 'enter', 'steal', 'carjack', 'exit' or null.
 */
export function stepPlayer(player, dt, input, aim, interact, world) {
  if (player.mode === 'car') {
    const car = player.car;
    const axes = input.moveAxes();
    car.controls.throttle = -axes.y;
    car.controls.steer = axes.x;
    car.controls.handbrake = input.isDown('Space');
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    if (interact && exitCar(player, world)) return 'exit';
    return null;
  }

  const axes = input.moveAxes();
  let mx = axes.x;
  let my = axes.y;
  const length = Math.hypot(mx, my);
  if (length > 0) {
    mx /= length;
    my /= length;
  }
  const speed = input.isDown('ShiftLeft', 'ShiftRight') ? PLAYER.sprint : PLAYER.walk;
  const step = PLAYER.accel * dt;
  const dvx = mx * speed - player.vx;
  const dvy = my * speed - player.vy;
  const dv = Math.hypot(dvx, dvy);
  if (dv <= step) {
    player.vx += dvx;
    player.vy += dvy;
  } else {
    player.vx += (dvx / dv) * step;
    player.vy += (dvy / dv) * step;
  }
  const beforeX = player.x;
  const beforeY = player.y;
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  // Cars are solid to someone on foot.
  for (const car of world.traffic.cars) {
    if (Math.abs(car.x - player.x) > 50 || Math.abs(car.y - player.y) > 50) continue;
    const contact = carContact(car, player.x, player.y);
    const overlap = contact.reach + PLAYER.radius - contact.distance;
    if (overlap > 0) {
      player.x += contact.nx * overlap;
      player.y += contact.ny * overlap;
    }
  }
  pushOutOfSolids(player, PLAYER.radius, world.city);
  const moved = Math.hypot(player.x - beforeX, player.y - beforeY);
  player.moving = moved / dt;
  player.phase += moved * 0.3;
  // Face the mouse; until the mouse has moved at all, face the way Jett walks.
  if (input.mouse.moved) player.angle = Math.atan2(aim.y - player.y, aim.x - player.x);
  else if (moved > 0.01) player.angle = Math.atan2(player.vy, player.vx);

  if (interact) {
    const car = findEnterableCar(player, world.traffic.cars);
    if (car) return enterCar(player, car, world);
  }
  return null;
}
