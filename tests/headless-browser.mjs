// Runs the real game (main.js and everything it imports) under a stubbed browser: a canvas whose
// 2D context accepts any drawing call, a WebAudio stub that rejects the values real WebAudio would
// throw on, an in-memory localStorage, and synthetic key / mouse events. It plays through every
// screen (title, play, pause, busted, wasted, ending, continue) and the ?shot= scenes, failing on
// any exception. Run with
//   node tests/headless-browser.mjs
import assert from 'node:assert/strict';

// ---- A stub browser ------------------------------------------------------------------------

function makeContext2d(canvas) {
  const state = { canvas };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text) => ({ width: String(text).length * 7 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') {
        return (...args) => {
          for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${String(key)} got ${a}`);
          return { addColorStop(offset, color) { if (!(offset >= 0 && offset <= 1)) throw new Error(`addColorStop offset ${offset}`); if (typeof color !== 'string') throw new Error('color'); } };
        };
      }
      if (key === 'arc' || key === 'ellipse') {
        return (...args) => {
          const r = key === 'arc' ? args[2] : Math.min(args[2], args[3]);
          if (!(r >= 0)) throw new Error(`${key} radius ${r}`); // the real canvas throws on a negative radius
        };
      }
      return () => {};
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

function makeCanvas() {
  const canvas = {
    width: 300,
    height: 150,
    listeners: {},
    addEventListener(type, fn) {
      (canvas.listeners[type] ??= []).push(fn);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
  };
  const ctx = makeContext2d(canvas);
  canvas.getContext = () => ctx;
  return canvas;
}

let audioTime = 0;
const audioCalls = { count: 0 };
function audioNode() {
  const checked = new Set(['setValueAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime']);
  const node = new Proxy(function stub() {}, {
    get(target, key) {
      if (key === 'currentTime') return audioTime;
      if (key === 'sampleRate') return 44100;
      if (key === 'state') return 'running';
      if (key === 'getChannelData') return () => new Float32Array(16);
      if (key === 'then') return undefined;
      if (checked.has(key)) {
        return (value, time, extra) => {
          audioCalls.count += 1;
          if (!Number.isFinite(value) || !Number.isFinite(time) || (extra !== undefined && !Number.isFinite(extra))) throw new Error(`${String(key)}(${value}, ${time})`);
          if (key === 'exponentialRampToValueAtTime' && value <= 0) throw new Error('exponential ramp to 0');
          return node;
        };
      }
      if (key === 'connect') return (destination) => destination ?? node;
      return node;
    },
    set: () => true,
    apply: () => node,
    construct: () => node,
  });
  return node;
}

const storage = new Map();
const windowListeners = {};
const docListeners = {};
const status = { textContent: '' };
let canvas = makeCanvas();
let rafQueue = [];
let now = 0;

globalThis.window = {
  location: { search: '' },
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener(type, fn) {
    (windowListeners[type] ??= []).push(fn);
  },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  AudioContext: audioNode(),
};
globalThis.document = {
  hidden: false,
  getElementById: (id) => (id === 'game' ? canvas : status),
  createElement: () => makeCanvas(),
  addEventListener(type, fn) {
    (docListeners[type] ??= []).push(fn);
  },
};
globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);

/** Runs `frames` animation frames of `ms` each. */
function pump(frames, ms = 1000 / 60) {
  for (let k = 0; k < frames; k += 1) {
    now += ms;
    audioTime += ms / 1000;
    const queue = rafQueue;
    rafQueue = [];
    for (const fn of queue) fn(now);
  }
}
const realNow = performance.now.bind(performance);
performance.now = () => now;

function key(code, type = 'keydown') {
  for (const fn of windowListeners[type] ?? []) fn({ code, repeat: false, preventDefault() {} });
}
function tap(code) {
  key(code, 'keydown');
  pump(1);
  key(code, 'keyup');
  pump(1);
}
function pointer(type, x, y) {
  const target = type === 'pointerup' ? windowListeners : canvas.listeners;
  for (const fn of target[type] ?? []) fn({ clientX: x, clientY: y, button: 0, preventDefault() {} });
}
/** Pumps until `predicate()` is true (or fails after `limit` frames). */
function until(predicate, limit, what) {
  for (let k = 0; k < limit; k += 1) {
    if (predicate()) return k;
    pump(1);
  }
  throw new Error(`timed out waiting for ${what}; status: "${status.textContent}"`);
}

// ---- The game ----------------------------------------------------------------------------

const results = [];
function step(name, fn) {
  try {
    fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}\n     ${error.stack.split('\n').slice(0, 5).join('\n     ')}`);
    process.exitCode = 1;
  }
}

window.location.search = '?seed=7';
await import('../game/src/main.js');
const game = () => window.__game;

step('title screen runs', () => {
  pump(60);
  assert.match(status.textContent, /Neon Harbor Nights/);
  assert.equal(game().world.mode, 'title');
});

step('Enter starts a new game; Vera texts; audio unlocked on the gesture', () => {
  tap('Enter');
  pump(30);
  assert.equal(game().world.mode, 'play');
  until(() => /Vera/.test(status.textContent), 600, 'a message from Vera');
  assert.ok(audioCalls.count > 0, 'audio scheduled');
});

step('walking and shooting on foot (mouse held) fires and reloads', () => {
  const world = game().world;
  pointer('pointermove', 900, 360);
  key('KeyD');
  pump(30);
  key('KeyD', 'keyup');
  pointer('pointerdown', 900, 360);
  pump(150);
  pointer('pointerup', 900, 360);
  assert.ok(world.combat.weapon.ammo < 12 || world.combat.weapon.reloading > 0, `ammo ${world.combat.weapon.ammo}`);
  tap('KeyR');
  pump(80);
  assert.equal(world.combat.weapon.ammo, 12);
});

step('E enters the car; driving draws the speedometer path', () => {
  const world = game().world;
  const car = world.playerCar;
  world.player.x = car.x;
  world.player.y = car.y - 20;
  pump(2);
  tap('KeyE');
  pump(5);
  assert.equal(world.player.mode, 'car');
  key('KeyW');
  pump(90);
  key('KeyW', 'keyup');
  assert.ok(Math.abs(car.speed) > 20 || car.damage > 0, `speed ${car.speed}`);
  tap('KeyE');
  pump(30);
});

step('M mutes and unmutes', () => {
  tap('KeyM');
  assert.match(status.textContent, /Sound off/);
  tap('KeyM');
  assert.match(status.textContent, /Sound on/);
});

step('pause and resume', () => {
  tap('Escape');
  assert.match(status.textContent, /Paused/);
  pump(10);
  tap('Escape');
  assert.match(status.textContent, /Playing/);
});

step('mission 1 via the V, then busted fails it and shows the fail panel; retry works', () => {
  const world = game().world;
  const start = world.missions.markers.find((m) => m.kind === 'start');
  world.player.mode === 'car' && tap('KeyE');
  world.player.x = start.x;
  world.player.y = start.y;
  pump(5);
  assert.equal(world.missions.active?.def.title, 'First Run');
  world.police.setLevel(1, true); // locked, so the lone cruiser cannot be outrun by laying low
  until(() => /Busted/.test(status.textContent), 60 * 60, 'BUSTED');
  pump(20);
  assert.equal(world.missions.failed?.title, 'First Run');
  tap('Enter'); // continue from BUSTED
  pump(10);
  assert.match(status.textContent, /police station/);
  tap('Enter'); // retry from the fail panel
  pump(5);
  assert.equal(world.missions.active?.def.title, 'First Run');
});

step('wasted: health to zero, hospital respawn', () => {
  const world = game().world;
  world.combat.hurt(1000);
  until(() => /Wasted/.test(status.textContent), 30, 'WASTED');
  pump(10);
  tap('Enter');
  pump(5);
  assert.equal(world.stats.health, 100);
  tap('KeyX'); // dismiss the fail panel
  pump(5);
  assert.equal(world.missions.failed, null);
});

step('explosion near the player: shake, sound, scorch', () => {
  const world = game().world;
  const car = world.traffic.cars.find((c) => c !== world.playerCar && !c.wrecked);
  car.x = world.player.x + 90;
  car.y = world.player.y;
  car.damage = 99.5;
  car.lastPlayerHit = world.time;
  car.asleep = false;
  pump(60);
  assert.ok(car.wrecked);
});

step('rival mission draws (target marker, magenta car)', () => {
  const world = game().world;
  world.missions.forceStart(3);
  pump(120);
  assert.ok(world.missions.markers.some((m) => m.kind === 'target'));
  world.missions.fail('Test.');
  pump(5);
  tap('KeyX');
});

step('ending: last ferry, ending screen, keep roaming, save written', () => {
  const world = game().world;
  world.missions.forceStart(5);
  if (world.player.mode === 'car') tap('KeyE');
  pump(5);
  world.player.x = 3605;
  world.player.y = 2448;
  until(() => /debt is paid/.test(status.textContent), 60, 'the ending');
  pump(20);
  tap('Enter');
  pump(10);
  assert.match(status.textContent, /Free roam/);
  assert.ok(storage.get('neon-harbor-nights-save-v1'), 'save written');
});

step('back to title shows Continue; Continue restores progress', () => {
  const world = game().world;
  const saved = JSON.parse(storage.get('neon-harbor-nights-save-v1'));
  tap('Escape');
  tap('ArrowDown');
  tap('Enter'); // BACK TO TITLE
  pump(20);
  assert.equal(world.mode, 'title');
  tap('Enter'); // CONTINUE is first
  pump(10);
  assert.equal(world.mode, 'play');
  assert.equal(world.stats.cash, saved.cash);
  assert.equal(world.missions.storyIndex, 6);
});

step('different window sizes draw the HUD and every screen', () => {
  for (const [w, h] of [[800, 600], [1920, 1080], [2560, 1440]]) {
    window.innerWidth = w;
    window.innerHeight = h;
    pump(5);
  }
});

// ---- ?shot= scenes (a fresh main.js instance per scene) ----------------------------------
for (const name of ['chase', 'street', 'mission', 'title', 'nonsense']) {
  window.__shotReady = false;
  canvas = makeCanvas();
  rafQueue = [];
  window.location.search = `?shot=${name}&seed=1`;
  await import(`../game/src/main.js?shot=${name}`);
  step(`?shot=${name} paints and sets __shotReady`, () => {
    pump(4);
    assert.equal(window.__shotReady, true);
  });
}
performance.now = realNow;
console.log(results.join('\n'));
