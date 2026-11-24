// Vera Solano's story chain and the repeatable courier work. Between story missions a pink "V"
// marks where the next one starts; walking or driving into it begins it. Each mission keeps an
// objective line (and maybe a timer) for the HUD banner, puts glowing markers in the world and on
// the minimap, and either pays out and advances the story or fails (out of time, busted, wasted,
// the target got away) with a fail panel that offers a retry. Courier jobs run whenever no story
// mission does: a "$" pickup somewhere in the city, a drop-off at least a few blocks away, a
// reward scaled by the distance. Vera's texts arrive on the phone panel one at a time.
//
// Pushes onto world.events: { type: 'success' | 'fail' | 'pickup' | 'save' | 'ending' | 'message' }.
import { COLORS, JOBS, PLACES, ROAD } from './config.js';
import { DIRS, rightOf, roadX, roadY } from './city.js';
import { createCar } from './vehicles.js';
import { driveToward } from './police.js';

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

const CHECKPOINT_RADIUS = 44;
const START_RADIUS = 30;
const STOP_SPEED = 28; // "stop inside the marker" means slower than this
const MESSAGE_TIME = 6.5; // seconds each phone message stays up
const FAIL_PANEL_TIME = 14;
const RIVAL_DISABLED = 70; // rival car damage at which it is out of the race
const RIVAL_CRUISE = 195;

const PASSENGER_LOOK = { skin: '#d9a07a', hair: '#1b1b1f', shirt: '#f4f1e8', pants: '#1f2937', bald: false };

/** Mission place helpers: the garage apron, the V spot by its door, and the named places in config. */
function garagePlaces(city) {
  const apron = city.garage.apron;
  return {
    apron,
    door: { x: apron.x + 22, y: apron.y + apron.h / 2, name: 'Repaint & Repair' },
    centre: { x: apron.x + apron.w / 2 - 10, y: apron.y + apron.h / 2, name: "Vera's garage" },
  };
}

/** A lane point through intersection (i, j) for a car arriving in direction dIn and leaving in dOut. */
function laneThrough(i, j, dIn, dOut) {
  const lane = ROAD.laneOffset;
  const rIn = rightOf(dIn);
  const rOut = rightOf(dOut);
  if (dIn === dOut) return { x: roadX(i) + rIn.x * lane, y: roadY(j) + rIn.y * lane, turn: false };
  if (DIRS[dIn].y === 0) return { x: roadX(i) + rOut.x * lane, y: roadY(j) + rIn.y * lane, turn: true };
  return { x: roadX(i) + rIn.x * lane, y: roadY(j) + rOut.y * lane, turn: true };
}

/** The travel direction from intersection a to its neighbour b. */
function dirBetween(a, b) {
  if (b.i > a.i) return 0;
  if (b.j > a.j) return 1;
  if (b.i < a.i) return 2;
  return 3;
}

/** Expands a list of corner intersections into every intersection along the way (straight runs between them). */
function expandPath(corners) {
  const path = [corners[0]];
  for (let k = 1; k < corners.length; k += 1) {
    let { i, j } = path[path.length - 1];
    const goal = corners[k];
    while (i !== goal.i || j !== goal.j) {
      if (i !== goal.i) i += Math.sign(goal.i - i);
      else j += Math.sign(goal.j - j);
      path.push({ i, j });
    }
  }
  return path;
}

// ---------------------------------------------------------------------------------------------
// The story. Each mission: title, pay, where its V sits, Vera's texts, and begin/step functions.
// step returns null (still going), 'done', or { fail: 'reason' }.

const STORY = [
  {
    title: 'First Run',
    pay: 300,
    start: (city) => garagePlaces(city).door,
    available: ['Got a job for you, Jett.', "Heard you're still running parcels for pocket change. Come by the garage and step into the V by the door."],
    briefing: ["A client's waiting at the Marina Café. Grab a car and get there in under 100 seconds. Show me you can drive."],
    done: "Not bad. That's $300 off what you owe.",
    begin(run) {
      run.timer = 100;
      run.stage = 'car';
    },
    step(run, ctx) {
      if (run.stage === 'car' && ctx.inCar) run.stage = 'drive';
      if (run.stage === 'car') {
        run.text = 'Get in a car';
        return null;
      }
      run.text = ctx.inCar ? `Drive to the ${PLACES.marinaCafe.name}` : 'Get back in a car';
      run.markers.push(ctx.checkpoint(PLACES.marinaCafe, PLACES.marinaCafe.name));
      if (ctx.inCar && ctx.within(PLACES.marinaCafe, CHECKPOINT_RADIUS)) return 'done';
      return null;
    },
  },
  {
    title: 'Fare Game',
    pay: 350,
    start: () => ({ x: PLACES.marinaCafe.x - 70, y: PLACES.marinaCafe.y - 20, name: PLACES.marinaCafe.name }),
    available: ['Next job starts right where you are. Step into the V when you are ready.'],
    briefing: ['A VIP needs a ride from the Palm Park plaza to the Beach Hotel. Stop in the marker so they can climb in. Do not keep them waiting.'],
    done: 'Fare paid. Wait... something about that guy was off.',
    begin(run, ctx) {
      run.stage = 'pickup';
      ctx.missions.passenger = { x: PLACES.plaza.x, y: PLACES.plaza.y + 44, angle: -Math.PI / 2, look: PASSENGER_LOOK };
    },
    step(run, ctx) {
      if (run.stage === 'pickup') {
        run.text = ctx.inCar ? `Pick up the fare at ${PLACES.plaza.name} (stop in the marker)` : 'Get in a car, then pick up the fare';
        run.markers.push(ctx.checkpoint(PLACES.plaza, 'Fare'));
        if (ctx.inCar && ctx.stoppedIn(PLACES.plaza, CHECKPOINT_RADIUS)) {
          ctx.missions.passenger = null;
          run.stage = 'deliver';
          run.timer = 60;
          ctx.event('pickup');
          ctx.message("They're in. Beach Hotel, quick and smooth.");
        }
        return null;
      }
      if (!ctx.inCar) return { fail: 'You left your fare behind.' };
      run.text = `Drop the fare at the ${PLACES.beachHotel.name} (stop in the marker)`;
      run.markers.push(ctx.checkpoint(PLACES.beachHotel, PLACES.beachHotel.name));
      if (ctx.stoppedIn(PLACES.beachHotel, CHECKPOINT_RADIUS)) return 'done';
      return null;
    },
    cleanup(run, ctx) {
      ctx.missions.passenger = null;
    },
  },
  {
    title: 'Heat Check',
    pay: 500,
    start: () => ({ x: PLACES.beachHotel.x - 60, y: PLACES.beachHotel.y, name: PLACES.beachHotel.name }),
    available: ['Jett, that fare was a setup. Come to the V by the hotel, I will talk you through it.'],
    briefing: ['The fare was an undercover cop. Every cruiser in Port Azura has your plate. Get to my garage and park inside. I will make the car disappear.'],
    done: 'Doors shut. You are a ghost again. Here is $500 for the trouble.',
    begin(run, ctx) {
      run.stage = 'hide';
      ctx.world.police.setLevel(3, true);
    },
    step(run, ctx) {
      const garage = garagePlaces(ctx.world.city);
      run.text = ctx.inCar ? "Lose the heat: park inside Vera's garage" : "Get a car and park it inside Vera's garage";
      run.markers.push(ctx.checkpoint(garage.centre, 'Hideout', 62));
      if (ctx.inCar && ctx.insideRect(garage.apron) && Math.abs(ctx.player.car.speed) < STOP_SPEED) {
        ctx.world.police.clear();
        return 'done';
      }
      return null;
    },
  },
  {
    title: 'Rival Colors',
    pay: 600,
    start: (city) => garagePlaces(city).door,
    available: ['Someone sold us out: the Magenta crew. Come to the garage when you are ready to pay them back.'],
    briefing: ['Their courier is running a magenta Marlin across town right now. Stop that car before it reaches the drop. Ram it, shoot it, whatever it takes.'],
    done: "That's their delivery off the board. $600, and now they know our names.",
    begin(run, ctx) {
      run.stage = 'chase';
      ctx.missions.spawnRival(run);
    },
    step(run, ctx) {
      const rival = run.rival;
      const disabled = rival.wrecked || rival.damage >= RIVAL_DISABLED || rival.driver !== 'mission';
      if (disabled) return 'done';
      const health = Math.round(100 * (1 - rival.damage / RIVAL_DISABLED));
      run.text = `Disable the magenta rival car before its drop-off  ·  rival ${clamp(health, 0, 100)}%`;
      run.markers.push({ x: rival.x, y: rival.y, radius: 30, color: COLORS.rival, kind: 'target', label: 'RIVAL' });
      run.markers.push({ x: run.dropoff.x, y: run.dropoff.y, radius: CHECKPOINT_RADIUS, color: COLORS.uiRed, kind: 'drop', label: 'Rival drop-off' });
      if (ctx.missions.stepRival(run, ctx.dt) === 'arrived') return { fail: 'The rival made the drop.' };
      if (Math.hypot(rival.x - ctx.player.x, rival.y - ctx.player.y) > 1900) return { fail: 'The rival got away.' };
      return null;
    },
    cleanup(run, ctx) {
      const rival = run.rival;
      if (rival && rival.driver === 'mission') ctx.world.traffic.removeCar(rival);
      else if (rival) {
        rival.curbside = false; // a disabled rival stays where it stopped until the city tidies it away
      }
      run.rival = null;
    },
  },
  {
    title: 'Night Freight',
    pay: 800,
    start: (city) => garagePlaces(city).door,
    available: ['One big job before the last one. Garage, the V. Bring a sturdy car.'],
    briefing: ['Three crates: one at the docks, one at the old warehouse, one downtown. Every pickup will draw heat. Bring them all to the marina.'],
    done: 'Crates are on the boat. $800. One more run and we are square.',
    begin(run) {
      run.timer = 240;
      run.stage = 'collect';
      run.crates = [PLACES.docks, PLACES.warehouse, PLACES.downtown].map((place) => ({ place, taken: false }));
    },
    step(run, ctx) {
      const left = run.crates.filter((crate) => !crate.taken);
      if (left.length) {
        run.text = ctx.inCar ? `Collect the crates — ${3 - left.length} of 3` : 'Get in a car to collect the crates';
        for (const crate of left) {
          run.markers.push(ctx.checkpoint(crate.place, 'Crate'));
          if (ctx.inCar && ctx.within(crate.place, CHECKPOINT_RADIUS)) {
            crate.taken = true;
            ctx.event('pickup');
            ctx.world.police.raise(1);
            if (left.length === 1) ctx.message('That is all three. Get them to the marina.');
          }
        }
        return null;
      }
      run.text = ctx.inCar ? `Deliver the crates to ${PLACES.marina.name}` : 'Get back in a car with the crates';
      run.markers.push(ctx.checkpoint(PLACES.marina, 'Marina'));
      if (ctx.inCar && ctx.within(PLACES.marina, CHECKPOINT_RADIUS + 6)) return 'done';
      return null;
    },
  },
  {
    title: 'Last Ferry Out',
    pay: 1200,
    start: (city) => garagePlaces(city).door,
    available: ['Last ride, Jett. Meet me at the garage.'],
    briefing: ['The ferry leaves in two minutes and the whole PD is coming. Get to the pier at the marina. Go!'],
    done: 'You made it. The debt is paid.',
    begin(run, ctx) {
      run.timer = 120;
      run.stage = 'run';
      ctx.world.police.setLevel(4, true);
    },
    step(run, ctx) {
      run.text = `Reach ${PLACES.ferryPier.name} before the ferry leaves`;
      run.markers.push(ctx.checkpoint(PLACES.ferryPier, 'Ferry'));
      if (ctx.within(PLACES.ferryPier, CHECKPOINT_RADIUS + 4)) return 'done';
      return null;
    },
  },
];

export const STORY_LENGTH = STORY.length;

export function createMissions(world, rng) {
  const player = world.player;
  const missions = {
    storyIndex: 0, // the next (or current) story mission; STORY_LENGTH once the story is over
    active: null, // the running story mission: { def, index, stage, timer, text, markers, ... }
    job: null, // the courier job in progress: { pickup, drop, reward, timer, district }
    offer: null, // the "$" pickup waiting in the city
    offerClock: 0,
    markers: [], // what render.js and the minimap draw: { x, y, radius, color, kind, label, glyph }
    passenger: null, // the waiting fare in mission 2
    objective: null, // the HUD banner: { title, text, timer }
    failed: null, // the fail panel: { index, title, reason, clock }
    inbox: [], // phone messages not yet shown
    message: null, // the one on screen: { from, text, age }
    startArmed: true, // the V only triggers after the player has been outside it
    endingSeen: false,
  };

  function event(type, extra) {
    world.events.push({ type, ...extra });
  }

  /** Queues a text from Vera (or `from`) for the phone panel; `tag` names the mission it is about ("M1 First Run"). */
  function message(text, from = 'Vera', tag = null) {
    missions.inbox.push({ from, text, tag });
  }

  function within(place, radius) {
    return Math.hypot(player.x - place.x, player.y - place.y) < radius;
  }

  function checkpoint(place, label, radius = CHECKPOINT_RADIUS) {
    return { x: place.x, y: place.y, radius, color: COLORS.beacon, kind: 'checkpoint', label };
  }

  /** The helpers a mission's step sees. */
  function context(dt) {
    const inCar = player.mode === 'car';
    return {
      world,
      missions,
      player,
      dt,
      inCar,
      within,
      checkpoint,
      event,
      message,
      stoppedIn: (place, radius) => inCar && within(place, radius) && Math.abs(player.car.speed) < STOP_SPEED,
      insideRect: (r) => player.x > r.x && player.x < r.x + r.w && player.y > r.y && player.y < r.y + r.h,
    };
  }

  /** Vera's "come and see me" texts for the next story mission. */
  function announceNext() {
    const def = STORY[missions.storyIndex];
    if (!def) return;
    const tag = `M${missions.storyIndex + 1} ${def.title}`;
    for (const text of def.available) message(text, 'Vera', tag);
    missions.startArmed = !within(def.start(world.city), START_RADIUS + 10);
  }

  // ---- The rival courier (mission 4)

  /** Puts the magenta rival on the road a couple of blocks from the player with a long route across town. */
  missions.spawnRival = function spawnRival(run) {
    const pi = clamp(Math.round((player.x - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.columns - 1);
    const pj = clamp(Math.round((player.y - ROAD.firstCenter) / ROAD.spacing), 0, ROAD.rows - 1);
    // Start two avenues east (or west, near the east edge) on the same street; finish at the far side of town.
    const si = pi + 2 <= ROAD.columns - 1 ? pi + 2 : pi - 2;
    const sj = pj;
    const east = si < ROAD.columns / 2;
    const farI = east ? ROAD.columns - 1 : 0;
    const farJ = sj < ROAD.rows / 2 ? ROAD.rows - 1 : 0;
    const midJ = clamp(sj + (farJ > sj ? 1 : -1) * 2, 0, ROAD.rows - 1);
    const midI = clamp(Math.round((si + farI) / 2), 0, ROAD.columns - 1);
    const corners = [{ i: si, j: sj }, { i: si, j: midJ }, { i: midI, j: midJ }, { i: midI, j: farJ }, { i: farI, j: farJ }];
    const path = expandPath(corners);
    const waypoints = [];
    for (let k = 1; k < path.length; k += 1) {
      const dIn = dirBetween(path[k - 1], path[k]);
      const dOut = k + 1 < path.length ? dirBetween(path[k], path[k + 1]) : dIn;
      waypoints.push(laneThrough(path[k].i, path[k].j, dIn, dOut));
    }
    // The drop-off: halfway down the last block, past the final intersection's lane point.
    const last = waypoints[waypoints.length - 1];
    const lastDir = dirBetween(path[path.length - 2], path[path.length - 1]);
    const back = DIRS[(lastDir + 2) % 4];
    run.dropoff = { x: last.x + back.x * 140, y: last.y + back.y * 140 };
    waypoints[waypoints.length - 1] = { x: run.dropoff.x, y: run.dropoff.y, turn: false };
    const d0 = dirBetween(path[0], path[1]);
    const right = rightOf(d0);
    const startX = roadX(si) + right.x * ROAD.laneOffset + DIRS[d0].x * 60;
    const startY = roadY(sj) + right.y * ROAD.laneOffset + DIRS[d0].y * 60;
    const angle = Math.atan2(DIRS[d0].y, DIRS[d0].x);
    const rival = createCar('sports', startX, startY, angle, COLORS.rival);
    rival.spec = { ...rival.spec, name: 'Magenta Marlin', fragility: 0.3 };
    rival.driver = 'mission';
    rival.asleep = false;
    rival.vx = Math.cos(angle) * 120;
    rival.vy = Math.sin(angle) * 120;
    rival.speed = 120;
    world.traffic.addCar(rival);
    run.rival = rival;
    run.waypoints = waypoints;
    run.waypoint = 0;
  };

  /** Drives the rival along its route; extra damage from the player's rams. Returns 'arrived' at the drop. */
  missions.stepRival = function stepRival(run, dt) {
    const rival = run.rival;
    for (const impact of world.traffic.effects.impacts) {
      if (impact.carId === rival.id && impact.byPlayer) rival.damage += Math.max(0, impact.strength - 60) * 0.12;
    }
    let target = run.waypoints[run.waypoint];
    if (Math.hypot(target.x - rival.x, target.y - rival.y) < 34) {
      if (run.waypoint === run.waypoints.length - 1) return 'arrived';
      run.waypoint += 1;
      target = run.waypoints[run.waypoint];
    }
    const toTarget = Math.hypot(target.x - rival.x, target.y - rival.y);
    const speed = target.turn && toTarget < 70 + rival.speed * 0.45 ? 115 : RIVAL_CRUISE;
    driveToward(rival, target.x, target.y, speed, dt, world.city, world.traffic.cars);
    return null;
  };

  // ---- Story flow

  /** Starts story mission `index` right where the player is. */
  function beginStory(index) {
    const def = STORY[index];
    missions.cancelJob(false);
    missions.offer = null;
    missions.failed = null;
    missions.active = { def, index, stage: '', timer: null, text: '', markers: [], startedAt: world.time };
    for (const text of def.briefing) message(text);
    def.begin(missions.active, context(0));
    event('mission-start', { title: def.title });
  }

  function endStory(run) {
    if (run.def.cleanup) run.def.cleanup(run, context(0));
    world.police.unlock();
    missions.active = null;
    missions.objective = null;
  }

  function completeStory(run) {
    const def = run.def;
    endStory(run);
    world.stats.cash += def.pay;
    world.stats.totalEarned += def.pay;
    missions.storyIndex = run.index + 1;
    message(def.done);
    event('success', { title: def.title, pay: def.pay });
    event('save');
    if (missions.storyIndex >= STORY.length) {
      missions.endingSeen = true;
      world.police.clear();
      event('ending');
      return;
    }
    announceNext();
  }

  /** Fails the running story mission (and any courier job) with `reason`, showing the fail panel. */
  missions.fail = function fail(reason) {
    if (missions.job) missions.cancelJob(true, reason);
    const run = missions.active;
    if (!run) return;
    endStory(run);
    missions.failed = { index: run.index, title: run.def.title, reason, clock: FAIL_PANEL_TIME };
    event('fail', { title: run.def.title, reason });
  };

  /** Fail panel: run the failed mission again from here. */
  missions.retry = function retry() {
    if (!missions.failed) return;
    const index = missions.failed.index;
    missions.failed = null;
    beginStory(index);
  };

  /** Fail panel: not now (the V comes back where it was). */
  missions.dismiss = function dismiss() {
    if (!missions.failed) return;
    missions.failed = null;
    missions.startArmed = false;
  };

  // ---- Courier jobs

  /** A random point in a road lane, or null if it lands somewhere unsuitable. */
  function randomRoadPoint() {
    const vertical = rng.chance(0.5);
    const i = rng.int(0, ROAD.columns - 1);
    const j = rng.int(0, ROAD.rows - 1);
    if (vertical && j === ROAD.rows - 1) return null;
    if (!vertical && i === ROAD.columns - 1) return null;
    const along = rng.range(90, ROAD.spacing - 90);
    const side = rng.chance(0.5) ? 1 : -1;
    return vertical ? { x: roadX(i) + side * ROAD.laneOffset, y: roadY(j) + along } : { x: roadX(i) + along, y: roadY(j) + side * ROAD.laneOffset };
  }

  function makeOffer() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pickup = randomRoadPoint();
      if (!pickup) continue;
      const d = Math.hypot(pickup.x - player.x, pickup.y - player.y);
      if (d < 350 || d > 1300) continue;
      for (let tries = 0; tries < 40; tries += 1) {
        const drop = randomRoadPoint();
        if (!drop) continue;
        const distance = Math.abs(drop.x - pickup.x) + Math.abs(drop.y - pickup.y);
        if (distance < JOBS.minDistance) continue;
        const reward = Math.round((JOBS.base + JOBS.perPixel * distance) / 5) * 5;
        missions.offer = { pickup, drop, reward, time: Math.round(distance / JOBS.pace + JOBS.slack), district: world.city.districtAt(drop.x, drop.y) };
        return;
      }
    }
  }

  /** Drops the courier job in progress; with `failed`, Vera's client complains. */
  missions.cancelJob = function cancelJob(failed, reason) {
    if (!missions.job) return;
    missions.job = null;
    missions.objective = null;
    missions.offerClock = 4;
    if (failed) {
      message(reason ? `${reason} The client cancelled the parcel.` : 'Too slow. The client cancelled the parcel.', 'Dispatch');
      event('fail', { title: 'Courier job', reason: reason ?? 'Out of time' });
    }
  };

  function stepJobs(dt, inCar) {
    if (missions.job) {
      const job = missions.job;
      job.timer -= dt;
      missions.markers.push({ x: job.drop.x, y: job.drop.y, radius: JOBS.radius, color: COLORS.uiGreen, kind: 'drop', label: `Drop-off $${job.reward}`, glyph: '$' });
      missions.objective = { title: 'Courier job', text: inCar ? `Deliver the parcel to ${job.district}` : 'Get back in a car and deliver the parcel', timer: job.timer };
      if (inCar && within(job.drop, JOBS.radius)) {
        world.stats.cash += job.reward;
        world.stats.totalEarned += job.reward;
        world.stats.jobsDone += 1;
        message(`Parcel delivered. $${job.reward} sent your way.`, 'Dispatch');
        event('success', { title: 'Courier job', pay: job.reward });
        event('save');
        missions.job = null;
        missions.objective = null;
        missions.offerClock = 3;
      } else if (job.timer <= 0) missions.cancelJob(true);
      return;
    }
    if (!missions.offer) {
      missions.offerClock -= dt;
      if (missions.offerClock <= 0) {
        makeOffer();
        missions.offerClock = 2;
      }
      return;
    }
    const offer = missions.offer;
    missions.markers.push({ x: offer.pickup.x, y: offer.pickup.y, radius: JOBS.radius, color: COLORS.uiGreen, kind: 'job', label: `Courier job $${offer.reward}`, glyph: '$' });
    // An offer left far behind is replaced by a nearer one.
    if (Math.hypot(offer.pickup.x - player.x, offer.pickup.y - player.y) > 2200) missions.offer = null;
    else if (inCar && within(offer.pickup, JOBS.radius)) {
      missions.job = { ...offer, timer: offer.time };
      missions.offer = null;
      message(`Parcel picked up. Get it to ${offer.district} in ${offer.time} seconds for $${offer.reward}.`, 'Dispatch');
      event('pickup');
    }
  }

  function stepPhone(dt) {
    if (missions.message) {
      missions.message.age += dt;
      if (missions.message.age >= MESSAGE_TIME && missions.inbox.length) missions.message = null;
      else if (missions.message.age >= MESSAGE_TIME + 2) missions.message = null;
    }
    if (!missions.message && missions.inbox.length) {
      const next = missions.inbox.shift();
      missions.message = { ...next, age: 0 };
      event('message');
    }
  }

  /** One fixed step in play. */
  missions.step = function step(dt) {
    missions.markers.length = 0;
    const inCar = player.mode === 'car';
    stepPhone(dt);
    if (missions.failed) {
      missions.failed.clock -= dt;
      if (missions.failed.clock <= 0) missions.dismiss();
    }

    const run = missions.active;
    if (run) {
      run.markers = missions.markers;
      if (run.timer !== null) run.timer -= dt;
      const result = run.def.step(run, context(dt));
      if (result === 'done') completeStory(run);
      else if (result && result.fail) missions.fail(result.fail);
      else if (run.timer !== null && run.timer <= 0) missions.fail('Out of time.');
      else missions.objective = { title: run.def.title, text: run.text, timer: run.timer };
      return;
    }

    // Free roam: Vera's V for the next story mission, and courier work.
    const def = STORY[missions.storyIndex];
    if (def && !missions.failed) {
      const spot = def.start(world.city);
      missions.markers.push({ x: spot.x, y: spot.y, radius: START_RADIUS, color: COLORS.uiPink, kind: 'start', label: def.title, glyph: 'V' });
      const inside = within(spot, START_RADIUS);
      if (inside && missions.startArmed) {
        beginStory(missions.storyIndex);
        return;
      }
      if (!inside) missions.startArmed = true;
    }
    stepJobs(dt, inCar);
  };

  /** Busted or wasted: the mission (or job) in progress fails. */
  missions.onCaught = function onCaught(reason) {
    if (missions.active) missions.fail(reason);
    else if (missions.job) missions.cancelJob(true, reason);
  };

  /** A fresh start (new game) or a loaded save: no mission running, Vera texts about the next one. */
  missions.reset = function reset(storyIndex = 0) {
    if (missions.active) endStory(missions.active);
    missions.storyIndex = clamp(storyIndex, 0, STORY.length);
    missions.job = null;
    missions.offer = null;
    missions.offerClock = 3;
    missions.markers.length = 0;
    missions.passenger = null;
    missions.objective = null;
    missions.failed = null;
    missions.inbox.length = 0;
    missions.message = null;
    missions.endingSeen = missions.storyIndex >= STORY.length;
    if (missions.storyIndex < STORY.length) announceNext();
    else message('Port Azura is yours. Dispatch still has parcels if you want the work.', 'Vera');
  };

  /** Leaves whatever was running without failing it (back to the title screen). */
  missions.abandon = function abandon() {
    if (missions.active) endStory(missions.active);
    missions.job = null;
    missions.offer = null;
    missions.failed = null;
    missions.passenger = null;
    missions.objective = null;
    missions.markers.length = 0;
  };

  /** Starts story mission `index` immediately (used by staged screenshots). */
  missions.forceStart = function forceStart(index) {
    missions.storyIndex = index;
    beginStory(index);
  };

  return missions;
}
