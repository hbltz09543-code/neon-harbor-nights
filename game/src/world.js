// The live world: the city, the traffic, the crowd, the player and the camera, advanced together
// one fixed step at a time, plus the systems layered on top: the wanted level and police, combat
// and health, and Vera's missions and courier jobs. Two modes: 'title' (no player, the camera
// orbits the city while life goes on) and 'play' (the player is in control and the camera follows
// them). Systems report what happened during a step on `world.events` ({ type, ... }), which
// main.js reads after every step for sound, screen-reader text, saving and screen changes; a
// BUSTED, WASTED or ending moment also sets `world.pending` to that screen's name.
import { CAMERA, CAR_MODELS, COLORS, HEALTH, POLICE, VIEW } from './config.js';
import { createCity } from './city.js';
import { createRandom } from './random.js';
import { createCar, createTraffic } from './vehicles.js';
import { createPedestrians } from './pedestrians.js';
import { createPlayer, findEnterableCar, stepPlayer } from './player.js';
import { createCamera, followCamera, screenToWorld, shakeCamera, snapCamera, viewRect } from './camera.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions } from './missions.js';

const STARTING_CASH = 50;

const PLAYER_LOOK = { skin: '#c98d62', hair: '#2b1d16', shirt: COLORS.playerJacket, pants: '#2e3a59', bald: false };

/** Builds the whole world for `seed` (the same seed always gives the same city and traffic). */
export function createWorld(seed) {
  const city = createCity(seed);
  const rng = createRandom(seed);
  const traffic = createTraffic(city, rng.fork(2));
  const pedestrians = createPedestrians(city, rng.fork(3));
  const camera = createCamera();
  const people = []; // pedestrians plus the player on foot, for drivers to brake for

  const ownCar = city.spawn.playerCar;
  const playerCar = traffic.addCar(createCar(ownCar.model, ownCar.x, ownCar.y, ownCar.angle, ownCar.color));
  playerCar.curbside = true; // Jett's own car never gets cleared away

  const world = {
    seed,
    city,
    traffic,
    pedestrians,
    camera,
    player: createPlayer(city.spawn.player),
    playerLook: PLAYER_LOOK,
    playerCar,
    mode: 'title',
    time: 0,
    orbit: 0,
    fill: true, // the next step populates the view from scratch
    enterableCar: null,
    lastEvent: null,
    events: [], // what happened during the last step (see the header)
    pending: null, // 'busted', 'wasted' or 'ending' when play should stop for that screen
    stats: { cash: STARTING_CASH, health: HEALTH.max, totalEarned: 0, jobsDone: 0, playTime: 0 },
  };
  world.police = createPolice(world, rng.fork(4));
  world.combat = createCombat(world, rng.fork(5));
  world.missions = createMissions(world, rng.fork(6));

  function orbitTarget() {
    return {
      x: CAMERA.orbitCenter.x + Math.cos(world.orbit) * CAMERA.orbitRadius,
      y: CAMERA.orbitCenter.y + Math.sin(world.orbit) * CAMERA.orbitRadius * 0.7,
    };
  }

  /** Back to the title screen's orbiting camera. */
  world.showTitle = function showTitle() {
    world.mode = 'title';
    const target = orbitTarget();
    snapCamera(camera, target.x, target.y, VIEW.titleZoom);
    world.missions.abandon();
    world.police.reset();
    world.combat.reset();
    world.pending = null;
    traffic.clearAI();
    pedestrians.clear();
    world.fill = true;
  };

  /**
   * A new game (or a continued one, from `save`: { cash, storyIndex, totalEarned, jobsDone }):
   * Jett on foot outside Repaint & Repair, the car on the apron, a fresh crowd around them.
   */
  world.startPlay = function startPlay(save = null) {
    world.mode = 'play';
    const spawn = city.spawn;
    Object.assign(world.player, createPlayer(spawn.player));
    if (!traffic.cars.includes(playerCar)) traffic.addCar(playerCar);
    Object.assign(playerCar, {
      x: spawn.playerCar.x,
      y: spawn.playerCar.y,
      angle: spawn.playerCar.angle,
      vx: 0,
      vy: 0,
      yaw: 0,
      speed: 0,
      damage: 0,
      driver: null,
      asleep: true,
      wrecked: false,
      burning: false,
      color: spawn.playerCar.color,
      owned: true,
      curbside: true,
    });
    Object.assign(world.stats, {
      cash: save ? save.cash : STARTING_CASH,
      health: HEALTH.max,
      totalEarned: save ? save.totalEarned : 0,
      jobsDone: save ? save.jobsDone : 0,
      playTime: 0,
    });
    world.pending = null;
    world.police.reset();
    world.combat.reset();
    world.missions.reset(save ? save.storyIndex : 0);
    snapCamera(camera, spawn.player.x, spawn.player.y, VIEW.footZoom);
    traffic.clearAI();
    pedestrians.clear();
    world.fill = true;
  };

  /**
   * After the BUSTED or WASTED screen: pay the fine (or all the cash there is), lose the heat, and
   * start again on foot at the police station corner or the hospital with full health.
   */
  world.respawn = function respawn(kind) {
    const busted = kind === 'busted';
    const fine = busted ? POLICE.bustFine : HEALTH.wastedFine;
    const at = busted ? POLICE.station : HEALTH.hospital;
    const player = world.player;
    if (player.car) {
      player.car.driver = null;
      player.car.controls.throttle = 0;
      player.car.controls.handbrake = true;
    }
    Object.assign(player, createPlayer({ x: at.x, y: at.y, angle: Math.PI / 4 }));
    world.stats.cash = Math.max(0, world.stats.cash - fine);
    world.stats.health = HEALTH.max;
    world.pending = null;
    world.police.reset();
    world.combat.reset();
    snapCamera(camera, at.x, at.y, VIEW.footZoom);
    traffic.clearAI();
    pedestrians.clear();
    world.fill = true;
  };

  /** After the ending screen's "Keep roaming": back to free play where Jett stands, wanted cleared. */
  world.keepRoaming = function keepRoaming() {
    world.pending = null;
    world.police.clear();
  };

  /** Reads the step's events (and Jett's health) for the moments that stop play: busted, wasted, the ending. */
  function checkPending() {
    if (world.stats.health <= 0 && world.pending !== 'wasted') {
      world.pending = 'wasted';
      world.events.push({ type: 'wasted' });
      world.missions.onCaught('Wasted.');
    }
    for (const event of world.events) {
      if (event.type === 'busted' && !world.pending) {
        world.pending = 'busted';
        world.missions.onCaught('Busted.');
      } else if (event.type === 'ending' && !world.pending) world.pending = 'ending';
    }
  }

  /**
   * One fixed step. `input` is the live input (null on the title screen and in staged shots, where
   * nobody is at the controls); `interact` is true on the step E was pressed. `commands`:
   * { reload: R was pressed, holdFire: the mouse is over a HUD button, so a click is not a shot }.
   */
  world.step = function step(dt, input, interact, commands = {}) {
    world.time += dt;
    world.lastEvent = null;
    world.events.length = 0;
    const player = world.player;
    const playing = world.mode === 'play';

    if (playing && input) {
      const aim = screenToWorld(camera, input.mouse.x, input.mouse.y);
      world.lastEvent = stepPlayer(player, dt, input, aim, interact, world);
      if (world.lastEvent === 'steal' || world.lastEvent === 'carjack') world.police.reportTheft(world.lastEvent, player.car);
    } else if (playing && player.mode === 'car') {
      player.x = player.car.x;
      player.y = player.car.y;
    }

    people.length = 0;
    for (const ped of pedestrians.peds) people.push(ped);
    if (playing && player.mode === 'foot') people.push(player);
    const view = viewRect(camera);
    const avoid = playing ? player : null;
    traffic.step(dt, { view, people, fill: world.fill, avoid });
    if (playing) {
      const firing = !!input && input.mouse.down && !commands.holdFire;
      world.combat.step(dt, firing, !!commands.reload);
    } else world.combat.stepEffectsOnly(dt);
    pedestrians.step(dt, { view, cars: traffic.cars, impacts: traffic.effects.impacts, fill: world.fill, avoid });
    world.fill = false;
    if (playing) {
      world.police.step(dt);
      world.police.stepRespray();
      world.missions.step(dt);
      world.stats.playTime += dt;
      checkPending();
    }

    if (playing) {
      if (player.mode === 'car') {
        player.x = player.car.x;
        player.y = player.car.y;
        player.angle = player.car.angle;
      }
      for (const impact of traffic.effects.impacts) if (impact.player) shakeCamera(camera, impact.strength / 60);
      world.enterableCar = player.mode === 'foot' ? findEnterableCar(player, traffic.cars) : null;
      followPlayer(dt, input);
    } else {
      world.orbit += CAMERA.orbitSpeed * dt;
      const target = orbitTarget();
      followCamera(camera, dt, target.x, target.y, VIEW.titleZoom, world.time);
    }
    return world.lastEvent;
  };

  /** The camera leads the car along its velocity (and pulls back at speed), or leans toward the mouse on foot. */
  function followPlayer(dt, input) {
    const player = world.player;
    let leadX = 0;
    let leadY = 0;
    let zoom = VIEW.footZoom;
    if (player.mode === 'car') {
      const car = player.car;
      leadX = car.vx * CAMERA.lookDrive;
      leadY = car.vy * CAMERA.lookDrive;
      const lead = Math.hypot(leadX, leadY);
      if (lead > CAMERA.lookMax) {
        leadX *= CAMERA.lookMax / lead;
        leadY *= CAMERA.lookMax / lead;
      }
      const fraction = Math.min(1, Math.abs(car.speed) / CAR_MODELS[car.model].top);
      zoom = VIEW.driveZoom + (VIEW.fastZoom - VIEW.driveZoom) * fraction;
    } else if (input && input.mouse.moved) {
      const aim = screenToWorld(camera, input.mouse.x, input.mouse.y);
      leadX = (aim.x - camera.x) * CAMERA.lookMouse;
      leadY = (aim.y - camera.y) * CAMERA.lookMouse;
    }
    followCamera(camera, dt, player.x + leadX, player.y + leadY, zoom, world.time);
  }

  world.showTitle();
  return world;
}
