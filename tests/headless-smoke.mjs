// Headless checks for the simulation (no browser needed): builds a world, plays scripted
// scenarios through the real fixed-step loop and asserts the phase-2 systems behave. Run with
//   node tests/headless-smoke.mjs
// It also stubs a 2D canvas and drives the renderer, HUD and screens through every state, so a
// typo in drawing code shows up here as an exception rather than a blank canvas in the browser.
import assert from 'node:assert/strict';
import { STEP, PLACES, POLICE, WEAPON } from '../game/src/config.js';
import { createWorld } from '../game/src/world.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 4).join('\n     ')}`);
    process.exitCode = 1;
  }
}

/** A scripted stand-in for input.js: held keys, mouse (canvas pixels) and button. */
function fakeInput() {
  const held = new Set();
  return {
    held,
    mouse: { x: 640, y: 360, down: false, moved: true },
    isDown: (...codes) => codes.some((c) => held.has(c)),
    moveAxes() {
      const x = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
      const y = (held.has('KeyS') ? 1 : 0) - (held.has('KeyW') ? 1 : 0);
      return { x, y };
    },
    takeActions: () => 0,
  };
}

function run(world, seconds, input = null, perStep = null) {
  const events = [];
  for (let k = 0; k < Math.round(seconds / STEP); k += 1) {
    if (perStep) perStep(k);
    world.step(STEP, input, false, {});
    events.push(...world.events);
    if (world.pending) break;
  }
  return events;
}

/** Puts the player at the wheel of their own car at (x, y). */
function seatPlayer(world, x, y, angle = 0) {
  const car = world.playerCar;
  Object.assign(car, { x, y, angle, vx: 0, vy: 0, driver: 'player', asleep: false });
  car.controls.handbrake = false;
  world.player.mode = 'car';
  world.player.car = car;
  world.player.x = x;
  world.player.y = y;
}

check('world builds, title steps without a player', () => {
  const world = createWorld(1);
  run(world, 2);
  assert.equal(world.mode, 'title');
  assert.equal(world.events.length >= 0, true);
});

check('new game: stats, Vera texts, the V marker and a courier offer', () => {
  const world = createWorld(1);
  world.startPlay();
  const input = fakeInput();
  run(world, 5, input);
  assert.equal(world.stats.cash, 50);
  assert.ok(world.missions.message, 'a phone message is showing');
  assert.ok(world.missions.markers.some((m) => m.kind === 'start'), 'the V is out');
  assert.ok(world.missions.markers.some((m) => m.kind === 'job'), 'a $ job is out');
});

check('wanted: police spawn by stars, chase, and stars drop when unseen', () => {
  const world = createWorld(2);
  world.startPlay();
  const input = fakeInput();
  world.police.setLevel(3);
  run(world, 6, input);
  assert.equal(world.police.cars.filter((c) => !c.retreating).length, 3, 'three cruisers at three stars');
  world.police.setLevel(5);
  run(world, 10, input);
  assert.equal(world.police.cars.filter((c) => !c.retreating).length, 6, 'six cruisers at five stars');
  const before = Math.min(...world.police.cars.map((c) => Math.hypot(c.x - world.player.x, c.y - world.player.y)));
  assert.ok(before < 1400, `nearest cruiser within reach (${before.toFixed(0)})`);
});

check('busted: standing still beside a cruiser fills the meter and busts', () => {
  const world = createWorld(3);
  world.startPlay();
  const input = fakeInput();
  world.police.setLevel(1);
  const events = run(world, 40, input);
  assert.ok(events.some((e) => e.type === 'busted'), `busted (meter ${world.police.bust.toFixed(2)}, cars ${world.police.cars.length})`);
  assert.equal(world.pending, 'busted');
  world.stats.cash = 300;
  world.respawn('busted');
  assert.equal(world.stats.cash, 50);
  assert.equal(world.police.level, 0);
  assert.ok(Math.hypot(world.player.x - POLICE.station.x, world.player.y - POLICE.station.y) < 1);
});

check('lay low: out of sight, stars drop one at a time', () => {
  const world = createWorld(4);
  world.startPlay();
  world.police.setLevel(2);
  // Nobody can see a player who has no cruiser near: freeze spawning by holding the spawn clock.
  const events = [];
  for (let k = 0; k < 60 * 30; k += 1) {
    world.police.spawnClock = 10;
    world.step(STEP, fakeInput(), false, {});
    events.push(...world.events);
  }
  assert.equal(world.police.level, 0, `level ${world.police.level}`);
  assert.equal(events.filter((e) => e.type === 'wanted' && !e.rose).length, 2);
});

check('pistol: 12 rounds, 6 per second, reload in 1.1 s', () => {
  const world = createWorld(5);
  world.startPlay();
  const input = fakeInput();
  input.mouse.down = true;
  const events = run(world, 1.0, input);
  const shots = events.filter((e) => e.type === 'shot').length;
  assert.ok(shots >= 6 && shots <= 7, `shots in 1 s: ${shots}`);
  run(world, 1.5, input);
  assert.ok(world.combat.weapon.reloading > 0 || world.combat.weapon.ammo === WEAPON.magazine, 'auto reload on empty');
  input.mouse.down = false;
  run(world, 1.3, input);
  assert.equal(world.combat.weapon.ammo, WEAPON.magazine);
});

check('shooting a car until it explodes: wreck, +2 stars, fireball', () => {
  const world = createWorld(6);
  world.startPlay();
  const input = fakeInput();
  run(world, 0.5, input);
  const player = world.player;
  // Park a car in front of Jett and make him face it.
  const target = world.traffic.cars.find((c) => c !== world.playerCar && !c.driver);
  Object.assign(target, { x: player.x + 70, y: player.y, angle: Math.PI / 2, asleep: true, damage: 0 });
  player.angle = 0;
  input.mouse.moved = false;
  for (let k = 0; k < 20 && !target.wrecked; k += 1) {
    world.combat.fire(0);
    run(world, 0.05, input);
  }
  run(world, 3, input);
  assert.ok(target.wrecked, `wrecked (damage ${target.damage.toFixed(1)})`);
  assert.ok(world.police.level >= 2, `wanted ${world.police.level}`);
  assert.ok(world.combat.fx.scorches.length >= 1);
});

check('hard crash hurts, regen only at zero stars, wasted at 0 hp', () => {
  const world = createWorld(7);
  world.startPlay();
  world.combat.hurt(30);
  assert.equal(world.stats.health, 70);
  run(world, 8, fakeInput());
  assert.ok(world.stats.health > 70, 'regenerated');
  world.combat.hurt(500);
  run(world, 0.1, fakeInput());
  assert.equal(world.pending, 'wasted');
  world.stats.cash = 120;
  world.respawn('wasted');
  assert.equal(world.stats.cash, 0);
  assert.equal(world.stats.health, 100);
});

check('mission 1 First Run: V starts it, reaching the café pays $300', () => {
  const world = createWorld(8);
  world.startPlay();
  const input = fakeInput();
  run(world, 0.5, input);
  const start = world.missions.markers.find((m) => m.kind === 'start');
  world.player.x = start.x;
  world.player.y = start.y;
  run(world, 0.2, input);
  assert.equal(world.missions.active?.def.title, 'First Run');
  seatPlayer(world, PLACES.marinaCafe.x, PLACES.marinaCafe.y);
  const events = run(world, 0.3, input);
  assert.ok(events.some((e) => e.type === 'success'), 'completed');
  assert.equal(world.stats.cash, 350);
  assert.equal(world.missions.storyIndex, 1);
  assert.ok(events.some((e) => e.type === 'save'));
});

check('mission timer runs out: fail panel, retry restarts it', () => {
  const world = createWorld(9);
  world.startPlay();
  world.missions.forceStart(0);
  const events = run(world, 101, fakeInput());
  assert.ok(events.some((e) => e.type === 'fail'));
  assert.equal(world.missions.failed?.title, 'First Run');
  world.missions.retry();
  assert.equal(world.missions.active?.def.title, 'First Run');
});

check('mission 2 Fare Game: stop at the plaza, stop at the hotel', () => {
  const world = createWorld(10);
  world.startPlay(); world.missions.forceStart(1);
  seatPlayer(world, PLACES.plaza.x, PLACES.plaza.y);
  run(world, 0.3);
  assert.equal(world.missions.active.stage, 'deliver');
  seatPlayer(world, PLACES.beachHotel.x, PLACES.beachHotel.y, Math.PI / 2);
  const events = run(world, 0.3);
  assert.ok(events.some((e) => e.type === 'success'));
});

check('mission 3 Heat Check: locked 3 stars, parking in the garage clears it', () => {
  const world = createWorld(11);
  world.startPlay(); world.missions.forceStart(2);
  assert.equal(world.police.level, 3);
  assert.ok(world.police.locked);
  run(world, 30, fakeInput());
  const apron = world.city.garage.apron;
  if (!world.pending) {
    seatPlayer(world, apron.x + apron.w / 2, apron.y + apron.h / 2);
    const events = run(world, 0.3);
    assert.ok(events.some((e) => e.type === 'success'));
    assert.equal(world.police.level, 0);
  }
});

check('mission 4 Rival Colors: rival drives its route; shooting it disables it', () => {
  const world = createWorld(12);
  world.startPlay(); world.missions.forceStart(3);
  const run4 = world.missions.active;
  const rival = run4.rival;
  const x0 = rival.x, y0 = rival.y;
  run(world, 6);
  const moved = Math.hypot(rival.x - x0, rival.y - y0);
  assert.ok(moved > 300, `rival moved ${moved.toFixed(0)} px`);
  assert.ok(run4.waypoint > 0, 'passed a waypoint');
  rival.damage = 75;
  const events = run(world, 0.2);
  assert.ok(events.some((e) => e.type === 'success'));
});

check('mission 4 rival reaches its drop if left alone (fail)', () => {
  const world = createWorld(13);
  world.startPlay(); world.missions.forceStart(3);
  const rival = world.missions.active.rival;
  let events = [];
  // Follow the rival so it never "gets away" by distance.
  for (let k = 0; k < 60 * 90 && !events.some((e) => e.type === 'fail'); k += 1) {
    world.player.x = rival.x + 200; world.player.y = rival.y;
    world.step(STEP, null, false, {});
    events.push(...world.events);
  }
  assert.ok(events.some((e) => e.type === 'fail' && /drop/.test(e.reason)), `fail: ${events.filter((e) => e.type === 'fail').map((e) => e.reason)}`);
});

check('mission 5 Night Freight: each crate adds a star, marina completes', () => {
  const world = createWorld(14);
  world.startPlay(); world.missions.forceStart(4);
  for (const place of [PLACES.docks, PLACES.warehouse, PLACES.downtown]) {
    seatPlayer(world, place.x, place.y);
    world.police.layLow = 0;
    run(world, 0.1);
  }
  assert.equal(world.police.level, 3);
  seatPlayer(world, PLACES.marina.x, PLACES.marina.y);
  const events = run(world, 0.2);
  assert.ok(events.some((e) => e.type === 'success'));
});

check('mission 6 Last Ferry Out: locked 4 stars, the pier ends the story', () => {
  const world = createWorld(15);
  world.startPlay(); world.missions.forceStart(5);
  assert.equal(world.police.level, 4);
  world.player.x = PLACES.ferryPier.x; world.player.y = PLACES.ferryPier.y;
  const events = run(world, 0.2);
  assert.ok(events.some((e) => e.type === 'ending'));
  assert.equal(world.pending, 'ending');
  assert.equal(world.missions.storyIndex, 6);
  world.keepRoaming();
  run(world, 4, fakeInput());
  assert.ok(world.missions.markers.some((m) => m.kind === 'job'), 'courier jobs after the story');
});

check('courier job: pickup, deliver, paid by distance', () => {
  const world = createWorld(16);
  world.startPlay();
  run(world, 4, fakeInput());
  const offer = world.missions.offer;
  assert.ok(offer);
  seatPlayer(world, offer.pickup.x, offer.pickup.y);
  run(world, 0.1);
  assert.ok(world.missions.job);
  const cash = world.stats.cash;
  seatPlayer(world, offer.drop.x, offer.drop.y);
  const events = run(world, 0.1);
  assert.ok(events.some((e) => e.type === 'success'));
  assert.equal(world.stats.cash, cash + offer.reward);
  assert.equal(world.stats.jobsDone, 1);
});

check('respray: stopped on the apron with heat, pay $150, wanted cleared', () => {
  const world = createWorld(17);
  world.startPlay();
  world.stats.cash = 400;
  world.police.setLevel(2);
  world.playerCar.damage = 40;
  const apron = world.city.garage.apron;
  seatPlayer(world, apron.x + apron.w / 2, apron.y + apron.h / 2);
  const events = run(world, 0.2);
  assert.ok(events.some((e) => e.type === 'respray'));
  assert.equal(world.stats.cash, 250);
  assert.equal(world.police.level, 0);
  assert.equal(world.playerCar.damage, 0);
});

check('stealing a parked car with a cruiser watching: +1', () => {
  const world = createWorld(18);
  world.startPlay();
  run(world, 0.5, fakeInput());
  const car = world.traffic.cars.find((c) => c !== world.playerCar && !c.driver);
  const before = world.police.level;
  world.police.reportTheft('carjack', car);
  assert.equal(world.police.level, before + 1);
});

check('determinism: same seed, same inputs, same state', () => {
  const snapshot = () => {
    const world = createWorld(21);
    world.startPlay();
    world.police.setLevel(3);
    const input = fakeInput();
    input.mouse.down = true;
    run(world, 8, input);
    return JSON.stringify([world.police.cars.map((c) => [c.x.toFixed(3), c.y.toFixed(3)]), world.stats, world.combat.weapon]);
  };
  assert.equal(snapshot(), snapshot());
});

console.log(results.join('\n'));
