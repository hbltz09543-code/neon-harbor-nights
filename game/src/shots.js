// The screenshot scenes behind ?shot=NAME (with &seed=N). Each one starts from a fresh world and
// drives the real systems (world.startPlay, the missions, the police, the player's own stepPlayer
// through a scripted stand-in for the keyboard) forward a few simulated seconds, so the same seed
// always gives the same frame. Scenes: 'chase' (the cover), 'street', 'mission' and 'title' (any
// unknown name falls back to the title).
import { ROAD, STEP } from './config.js';
import { roadX, roadY } from './city.js';
import { createCar } from './vehicles.js';
import { snapCamera } from './camera.js';

const STREET_ZOOM = 1.45; // a little closer than play's on-foot view, so the crowd reads

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/**
 * A stand-in for input.js that holds the movement keys `drive(world)` asks for each step: it
 * returns { x, y } like input.moveAxes() (x right, y down; in a car y -1 is the throttle).
 */
function autopilot(drive, world) {
  let axes = { x: 0, y: 0 };
  return {
    mouse: { x: 0, y: 0, down: false, moved: false },
    moveAxes: () => axes,
    isDown: () => false,
    update() {
      axes = drive(world);
    },
  };
}

/** Steers a car toward heading `angle` while staying on the line `lane` (y for east-west, x for north-south). */
function laneKeeper(car, angle, lane, throttle) {
  const across = Math.abs(Math.cos(angle)) > 0.5 ? (lane - car.y) * Math.sign(Math.cos(angle)) : (car.x - lane) * Math.sign(Math.sin(angle));
  let error = angle - car.angle + clamp(across * 0.012, -0.35, 0.35);
  error = Math.atan2(Math.sin(error), Math.cos(error));
  return { x: clamp(error * 3, -1, 1), y: -throttle };
}

/** Advances the world `seconds`, the autopilot (if any) choosing the keys before every step. */
function run(world, seconds, pilot = null) {
  for (let k = 0; k < Math.round(seconds / STEP); k += 1) {
    if (pilot) pilot.update();
    world.step(STEP, pilot, false);
  }
}

/** Puts Jett behind the wheel of a new `model` car at (x, y) heading `angle` at `speed`. */
function seatInNewCar(world, model, color, x, y, angle, speed) {
  const car = world.traffic.addCar(createCar(model, x, y, angle, color));
  Object.assign(car, { driver: 'player', owned: true, asleep: false, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, speed });
  car.controls.handbrake = false;
  Object.assign(world.player, { mode: 'car', car, x, y, angle });
  return car;
}

/** A police cruiser chasing at `speed`, with its light bar already going. */
function addCruiser(world, x, y, angle, speed) {
  const car = createCar('police', x, y, angle);
  car.spec = { ...car.spec };
  Object.assign(car, { driver: 'police', asleep: false, retreating: false, siren: 0.4, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, speed });
  car.controls.handbrake = false;
  world.traffic.addCar(car);
  world.police.cars.push(car);
  return car;
}

/** Empties the phone so the scene shows only what it means to. */
function quietPhone(world) {
  world.missions.inbox.length = 0;
  world.missions.message = null;
}

/** The title screen's orbiting golden-hour camera, a few seconds in. */
function stageTitle(world) {
  world.showTitle();
  run(world, 6);
  return { screen: 'title' };
}

/**
 * The cover: Night Freight under way with two crates aboard, three stars, Jett in a Marlin GT
 * tearing east along a Downtown street with two cruisers on his bumper and the last crate's
 * beacon ahead.
 */
function stageChase(world) {
  world.startPlay();
  const lane = roadY(3) + ROAD.laneOffset; // the eastbound lane of the Downtown street
  const car = seatInNewCar(world, 'sports', '#e2434b', roadX(2) + 40, lane, 0, 330);
  const missions = world.missions;
  missions.forceStart(4);
  const freight = missions.active;
  freight.crates[0].taken = true; // the docks
  freight.crates[1].taken = true; // the old warehouse
  freight.timer = 168;
  world.police.setLevel(3);
  quietPhone(world);
  addCruiser(world, car.x - 105, lane + 4, 0, 320);
  addCruiser(world, car.x - 190, lane - 30, 0, 315);
  snapCamera(world.camera, car.x + 150, car.y, 0.86);
  world.fill = true;
  run(world, 1.3, autopilot(() => laneKeeper(car, 0, lane, 1), world));
  quietPhone(world);
  world.police.flash = 0; // the stars rose a while ago: show them steady, not mid-blink
  return { screen: 'play' };
}

/**
 * On foot on the neon plaza across the avenue from Repaint & Repair, a minute into a new game:
 * Vera's first text on the phone and her pink V glowing by the garage door down the street.
 */
function stageStreet(world) {
  world.startPlay();
  const player = world.player;
  Object.assign(player, { x: 930, y: 1262, angle: Math.PI });
  snapCamera(world.camera, 720, 1236, STREET_ZOOM);
  world.fill = true;
  // A slow stroll west across the plaza toward the avenue (and the V beyond it); the camera stays close.
  const stroll = autopilot(() => ({ x: player.x > 790 ? -0.6 : 0, y: 0 }), world);
  for (let k = 0; k < Math.round(2.4 / STEP); k += 1) {
    stroll.update();
    world.step(STEP, stroll, false);
    snapCamera(world.camera, 720, 1236, STREET_ZOOM);
  }
  return { screen: 'play' };
}

/**
 * First Run, against the clock: Jett heading south on the beachfront avenue toward the Marina
 * Café beacon with about 47 seconds left, the sand and the bay to the east.
 */
function stageMission(world) {
  world.startPlay();
  const lane = roadX(ROAD.columns - 1) - ROAD.laneOffset; // the southbound lane of the beachfront avenue
  const car = seatInNewCar(world, 'sedan', '#3e6e9e', lane, roadY(4) - 200, Math.PI / 2, 300);
  const missions = world.missions;
  missions.forceStart(0);
  const seconds = 1.6;
  run(world, STEP); // the mission sees Jett already in a car and moves on to the drive
  missions.active.timer = 47 + seconds - 0.2;
  quietPhone(world);
  snapCamera(world.camera, car.x - 60, car.y + 200, 0.84);
  world.fill = true;
  run(world, seconds, autopilot(() => laneKeeper(car, Math.PI / 2, lane, 0.75), world));
  return { screen: 'play' };
}

/** Sets `world` to the named scene and returns { screen } ('title' or 'play') to draw over it. */
export function stageShot(name, world) {
  if (name === 'chase') return stageChase(world);
  if (name === 'street') return stageStreet(world);
  if (name === 'mission') return stageMission(world);
  return stageTitle(world);
}
