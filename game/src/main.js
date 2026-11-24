// Boot and the one loop. Input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there, with the
// HUD over it in play. Screens: TITLE (the live city behind an orbiting camera, logo, Continue /
// New Game, controls, story), PLAY, PAUSE, BUSTED, WASTED and ENDING. After every step main.js
// reads world.events: sounds, screen-reader announcements, toasts, saving, and the switch to
// BUSTED / WASTED / ENDING when the world asks for it.
//
// ?seed=N fixes the world. ?shot=NAME (with &seed=N) hands over to shots.js, which stages that
// scene instead of running the loop; it is painted twice and then window.__shotReady is set.

// The entry's dossier lists the sources in the order this page loads them (main.js's imports, depth
// first), so these come first to put the heart of the game up front: the city, the missions, the
// cars, the police, the renderer, the HUD and combat. Every module only declares things when it
// loads, so this order changes nothing at run time.
import './city.js';
import './missions.js';
import './vehicles.js';
import './police.js';
import './render.js';
import './hud.js';
import './combat.js';
import { COLORS, HEALTH, MAX_FRAME, POLICE, STEP } from './config.js';
import { createWorld } from './world.js';
import {
  ACTION_ACCEPT,
  ACTION_CLICK,
  ACTION_CONFIRM,
  ACTION_DISMISS,
  ACTION_DOWN,
  ACTION_INTERACT,
  ACTION_MUTE,
  ACTION_PAUSE,
  ACTION_RELOAD,
  ACTION_UP,
  createInput,
} from './input.js';
import { createRenderer } from './render.js';
import { drawBusted, drawEnding, drawPause, drawTitle, drawWasted, formatCash } from './screens.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { clearSave, hasSave, loadSave, writeSave } from './save.js';
import { stageShot } from './shots.js';

const SCREEN_TITLE = 'title';
const SCREEN_PLAY = 'play';
const SCREEN_PAUSE = 'pause';
const SCREEN_BUSTED = 'busted';
const SCREEN_WASTED = 'wasted';
const SCREEN_ENDING = 'ending';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
const renderer = createRenderer(canvas);
const hud = createHud();

/** Screen readers (and anyone reading the page's text) hear screen changes and game events. */
function announce(message) {
  status.textContent = message;
}

/**
 * Draws the overlay for `screen` (the HUD in play, plus the menu or verdict on top) and returns
 * its buttons. `state`: { selected, saveExists, muted, dt, verdict }.
 */
function drawOverlay(screen, state) {
  const ctx = renderer.ctx;
  const { width, height } = canvas;
  if (screen === SCREEN_TITLE) return drawTitle(ctx, width, height, world.time, state.selected, state.saveExists);
  const inGame = world.mode === 'play';
  const hudButtons = inGame ? hud.draw(ctx, width, height, world, { muted: state.muted, dt: screen === SCREEN_PLAY ? state.dt : 0, selected: screen === SCREEN_PLAY ? state.selected : -1 }) : [];
  if (screen === SCREEN_PAUSE) return drawPause(ctx, width, height, world.time, state.selected);
  if (screen === SCREEN_BUSTED) return drawBusted(ctx, width, height, world.time, state.verdict);
  if (screen === SCREEN_WASTED) return drawWasted(ctx, width, height, world.time, state.verdict);
  if (screen === SCREEN_ENDING) return drawEnding(ctx, width, height, world.time, world.stats);
  return hudButtons;
}

function runShot(name) {
  // Size the canvas (and so the camera's viewport) first: the scene fills traffic around what the camera sees.
  renderer.resize(world.camera);
  const scene = stageShot(name, world);
  renderer.warm(world);
  let painted = 0;
  function paint() {
    renderer.draw(world);
    drawOverlay(scene.screen, { selected: 0, saveExists: false, muted: false, dt: 0, verdict: { fine: 0, mission: null } });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  // For tests and the curious (browser console): the live world.
  window.__game = { world };
  const input = createInput(canvas);
  const audio = createAudio();
  input.onGesture(() => audio.unlock());
  let screen = SCREEN_TITLE;
  let selected = 0;
  let buttons = [];
  let accumulator = 0;
  let last = performance.now();
  let frameDt = 0;
  let interactQueued = false;
  let reloadQueued = false;
  let saveExists = hasSave();
  let verdict = { fine: 0, mission: null };

  function setScreen(next, message) {
    screen = next;
    selected = 0;
    accumulator = 0;
    if (message) announce(message);
  }

  function startGame(continuing) {
    const save = continuing ? loadSave() : null;
    if (!continuing) {
      clearSave();
      saveExists = false;
    }
    world.startPlay(save);
    setScreen(SCREEN_PLAY);
    audio.play('ui');
    announce(
      save
        ? `Welcome back to Port Azura. ${formatCash(save.cash)} in hand. Vera's next job is marked with a pink V on the minimap.`
        : 'Port Azura. You are Jett Marlowe, on foot outside Repaint & Repair. Vera Solano is texting you: step into the pink V by the garage door to start her first job.',
    );
  }

  function pause() {
    setScreen(SCREEN_PAUSE, 'Paused. Resume or go back to the title.');
  }

  function backToTitle() {
    world.showTitle();
    saveExists = hasSave();
    setScreen(SCREEN_TITLE, 'Neon Harbor Nights. Press Enter or click to start.');
  }

  /** After BUSTED / WASTED: pay up and respawn. */
  function respawn() {
    world.respawn(screen === SCREEN_BUSTED ? 'busted' : 'wasted');
    const where = screen === SCREEN_BUSTED ? 'outside the police station' : 'outside the hospital';
    setScreen(SCREEN_PLAY, `Back on your feet ${where}. ${formatCash(world.stats.cash)} left.`);
    audio.play('ui');
  }

  function runButton(action) {
    audio.play('ui');
    if (action === 'new') startGame(false);
    else if (action === 'continue' && screen === SCREEN_TITLE) startGame(true);
    else if (action === 'resume') setScreen(SCREEN_PLAY, 'Playing.');
    else if (action === 'title') backToTitle();
    else if (action === 'continue') respawn();
    else if (action === 'roam') {
      world.keepRoaming();
      setScreen(SCREEN_PLAY, 'Free roam. Courier jobs are marked with a green $.');
    } else if (action === 'retry') {
      world.missions.retry();
      selected = -1;
    } else if (action === 'dismiss') {
      world.missions.dismiss();
      selected = -1;
    }
  }

  function buttonUnderMouse() {
    const { x, y } = input.mouse;
    return buttons.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }

  function handleActions() {
    const actions = input.takeActions();
    const hovered = buttonUnderMouse();
    if (hovered >= 0 && input.mouse.moved) selected = hovered;
    if (actions & ACTION_MUTE) announce(audio.toggleMute() ? 'Sound off.' : 'Sound on.');
    const menu = screen !== SCREEN_PLAY;
    if (screen === SCREEN_PLAY) {
      if (hovered < 0 && !world.missions.failed) selected = -1;
      if (actions & ACTION_PAUSE) pause();
      else {
        if (actions & ACTION_INTERACT) interactQueued = true;
        if (actions & ACTION_RELOAD) reloadQueued = true;
        if (world.missions.failed) {
          if (actions & ACTION_ACCEPT) runButton('retry');
          else if (actions & ACTION_DISMISS) runButton('dismiss');
          else if (actions & ACTION_CLICK && hovered >= 0) runButton(buttons[hovered].action);
        }
      }
    } else if (menu) {
      if (screen === SCREEN_PAUSE && actions & ACTION_PAUSE) setScreen(SCREEN_PLAY, 'Playing.');
      else if (actions & ACTION_UP) selected = (selected + buttons.length - 1) % Math.max(1, buttons.length);
      else if (actions & ACTION_DOWN) selected = (selected + 1) % Math.max(1, buttons.length);
      else if (actions & ACTION_CONFIRM && buttons[selected]) runButton(buttons[selected].action);
      else if (actions & ACTION_CLICK && hovered >= 0) runButton(buttons[hovered].action);
    }
  }

  function describeEvent(event) {
    const player = world.player;
    if (event === 'enter') announce(`In the ${player.car.spec.name}. W to drive, S to brake and reverse, Space for the handbrake, E to get out.`);
    else if (event === 'steal') announce(`You took a parked ${player.car.spec.name}. If anyone saw, the police will want a word.`);
    else if (event === 'carjack') announce(`You pulled the driver out of a ${player.car.spec.name}. They run off.`);
    else if (event === 'exit') announce(`On foot in ${world.city.districtAt(player.x, player.y)}.`);
  }

  /** Sounds, toasts, announcements and saving for what happened during the last step. */
  function handleWorldEvents() {
    for (const event of world.events) {
      switch (event.type) {
        case 'shot':
          audio.play('shot');
          break;
        case 'reload':
          audio.play('reload');
          announce('Reloading.');
          break;
        case 'reloaded':
          audio.play('reloaded');
          break;
        case 'dryfire':
          audio.play('dryfire');
          break;
        case 'impact':
          audio.play('impact', event.strength);
          break;
        case 'explosion':
          audio.play('explosion');
          break;
        case 'pickup':
          audio.play('pickup');
          break;
        case 'message': {
          audio.play('message');
          const message = world.missions.message;
          if (message) announce(`${message.from}: ${message.text}${message.tag ? ` — ${message.tag}` : ''}`);
          break;
        }
        case 'mission-start':
          hud.notify(event.title.toUpperCase(), 'Vera Solano', COLORS.uiCyan);
          audio.play('pickup');
          break;
        case 'success':
          audio.play('success');
          if (event.title === 'Courier job') hud.notify('DELIVERED', `+${formatCash(event.pay)}`, COLORS.uiGreen);
          else hud.notify('MISSION PASSED', `${event.title}  ·  +${formatCash(event.pay)}`, COLORS.uiGold);
          announce(`${event.title} complete. Paid ${formatCash(event.pay)}. You have ${formatCash(world.stats.cash)}.`);
          break;
        case 'fail':
          audio.play('fail');
          if (event.title !== 'Courier job') announce(`Mission failed: ${event.title}. ${event.reason} Press Enter to retry or X to leave it for later.`);
          else announce(`Courier job failed. ${event.reason}`);
          break;
        case 'save':
          writeSave(world);
          saveExists = true;
          break;
        case 'wanted':
          announce(event.level === 0 ? 'You lost the police. Wanted level cleared.' : `Wanted level: ${event.level} star${event.level === 1 ? '' : 's'}.`);
          break;
        case 'respray':
          audio.play('respray');
          audio.play('success');
          hud.notify('FRESH PAINT', 'Repaired · wanted cleared', COLORS.uiCyan);
          announce('Repaint & Repair: the car is fixed and repainted, and the police have lost you.');
          break;
        case 'respray-broke':
          audio.play('ui');
          announce('Repaint & Repair costs $150. Come back with the cash.');
          break;
        default:
          break;
      }
    }
    // Hard knocks to Jett's car, and a startled crowd.
    for (const impact of world.traffic.effects.impacts) if (impact.player) audio.play('impact', impact.strength);
    if (world.pedestrians.events.fled > 0) audio.play('scream');
  }

  /** The world asked for BUSTED, WASTED or the ending: freeze play and show it. */
  function enterPendingScreen() {
    const pending = world.pending;
    const failed = world.missions.failed;
    if (pending === 'busted' || pending === 'wasted') {
      const fine = Math.min(world.stats.cash, pending === 'busted' ? POLICE.bustFine : HEALTH.wastedFine);
      verdict = { fine, mission: failed ? failed.title : null };
      audio.play('busted');
      setScreen(pending === 'busted' ? SCREEN_BUSTED : SCREEN_WASTED, pending === 'busted' ? `Busted. Fine ${formatCash(fine)}. Press Enter to continue.` : `Wasted. Hospital bill ${formatCash(fine)}. Press Enter to continue.`);
    } else if (pending === 'ending') {
      setScreen(SCREEN_ENDING, 'The debt is paid. You made the last ferry out. Press Enter to keep roaming.');
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    frameDt = Math.min((now - last) / 1000, MAX_FRAME);
    accumulator += frameDt;
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      const holdFire = screen === SCREEN_PLAY && buttonUnderMouse() >= 0;
      while (accumulator >= STEP) {
        const event = world.step(STEP, screen === SCREEN_PLAY ? input : null, interactQueued, { reload: reloadQueued, holdFire });
        interactQueued = false;
        reloadQueued = false;
        accumulator -= STEP;
        if (screen !== SCREEN_PLAY) continue;
        if (event) describeEvent(event);
        handleWorldEvents();
        if (world.pending) {
          enterPendingScreen();
          break;
        }
      }
    } else {
      accumulator = 0;
    }
    audio.update(world, frameDt, screen === SCREEN_PLAY);
    renderer.draw(world);
    buttons = drawOverlay(screen, { selected, saveExists, muted: audio.muted, dt: frameDt, verdict });
  }

  // Leaving the tab pauses a running game rather than letting it run on unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) pause();
  });

  announce('Neon Harbor Nights. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
