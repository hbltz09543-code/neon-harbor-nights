// Keyboard and mouse input. Held keys are read as state (is W down?), one-shot presses (enter a
// car, pause, confirm) are queued as bit flags and taken once by whoever handles them, so a tap
// between two frames is never lost and never counted twice. The mouse position is kept in canvas
// pixels; the camera turns it into world coordinates. `onGesture` listeners run on the first key
// or click (browsers only let WebAudio start from a user gesture).

export const ACTION_CONFIRM = 1; // Enter / Space on menus
export const ACTION_PAUSE = 2; // P / Escape
export const ACTION_INTERACT = 4; // E: enter or leave a car
export const ACTION_CLICK = 8; // left mouse button pressed
export const ACTION_UP = 16; // menu navigation
export const ACTION_DOWN = 32;
export const ACTION_RELOAD = 64; // R: reload the pistol
export const ACTION_MUTE = 128; // M: sound on / off
export const ACTION_ACCEPT = 256; // Enter only (Space is the handbrake in play): retry a failed mission
export const ACTION_DISMISS = 512; // X: wave the fail panel away

const ACTION_KEYS = {
  Enter: ACTION_CONFIRM | ACTION_ACCEPT,
  Space: ACTION_CONFIRM,
  KeyP: ACTION_PAUSE,
  Escape: ACTION_PAUSE,
  KeyE: ACTION_INTERACT,
  ArrowUp: ACTION_UP,
  KeyW: ACTION_UP,
  ArrowDown: ACTION_DOWN,
  KeyS: ACTION_DOWN,
  KeyR: ACTION_RELOAD,
  KeyM: ACTION_MUTE,
  KeyX: ACTION_DISMISS,
};

/** Keys whose default browser behaviour (scrolling, quick find) the game swallows. */
const SWALLOWED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash', 'Quote']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  const mouse = { x: 0, y: 0, down: false, moved: false };
  const gestureListeners = [];
  function gesture() {
    for (const listener of gestureListeners) listener();
  }

  window.addEventListener('keydown', (event) => {
    held.add(event.code);
    gesture();
    const action = ACTION_KEYS[event.code];
    if (action && !event.repeat) actions |= action;
    if (action || SWALLOWED.has(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    held.clear();
    mouse.down = false;
  });

  function trackPointer(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    mouse.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    mouse.moved = true;
  }
  canvas.addEventListener('pointermove', trackPointer);
  canvas.addEventListener('pointerdown', (event) => {
    trackPointer(event);
    gesture();
    if (event.button === 0) {
      mouse.down = true;
      actions |= ACTION_CLICK;
    }
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) mouse.down = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  /** True while any of the given key codes is held. */
  function isDown(...codes) {
    for (const code of codes) if (held.has(code)) return true;
    return false;
  }

  return {
    mouse,
    isDown,
    /** Calls `listener` on every key press and click (it decides itself whether to act only once). */
    onGesture(listener) {
      gestureListeners.push(listener);
    },
    /** -1..1 on each axis from WASD / arrows (x: left/right, y: up/down). */
    moveAxes() {
      const x = (isDown('KeyD', 'ArrowRight') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft') ? 1 : 0);
      const y = (isDown('KeyS', 'ArrowDown') ? 1 : 0) - (isDown('KeyW', 'ArrowUp') ? 1 : 0);
      return { x, y };
    },
    /** Takes (and clears) the queued one-shot presses among `mask`, leaving the others queued. */
    takeActions(mask = 0xffff) {
      const taken = actions & mask;
      actions &= ~mask;
      return taken;
    },
  };
}
