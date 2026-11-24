// The camera: where the view is centred, how far it is zoomed, and the conversions between screen
// pixels and world pixels. It follows a target smoothly with a lead (toward the car's velocity, or
// toward the mouse on foot), pulls back at speed, and shakes a little on hard impacts.
import { CAMERA, VIEW, WORLD } from './config.js';

export function createCamera() {
  return {
    x: WORLD.width / 2,
    y: WORLD.height / 2,
    zoom: 1,
    viewportW: 1280, // canvas pixels; the renderer keeps these current
    viewportH: 720,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
  };
}

/** Canvas pixels per world pixel. */
export function cameraScale(camera) {
  return (camera.viewportH / VIEW.worldHeight) * camera.zoom;
}

/** The world rectangle the camera sees. */
export function viewRect(camera) {
  const scale = cameraScale(camera);
  const w = camera.viewportW / scale;
  const h = camera.viewportH / scale;
  return { x: camera.x - w / 2, y: camera.y - h / 2, w, h };
}

/** A canvas pixel position in world coordinates. */
export function screenToWorld(camera, sx, sy) {
  const scale = cameraScale(camera);
  return { x: camera.x + (sx - camera.viewportW / 2) / scale, y: camera.y + (sy - camera.viewportH / 2) / scale };
}

/** Keeps the view inside the world where the world is big enough. */
function clampToWorld(camera) {
  const view = viewRect(camera);
  if (view.w < WORLD.width) camera.x = Math.min(Math.max(camera.x, view.w / 2), WORLD.width - view.w / 2);
  if (view.h < WORLD.height) camera.y = Math.min(Math.max(camera.y, view.h / 2), WORLD.height - view.h / 2);
}

/** Eases the camera toward (targetX, targetY) and `zoomTarget`; `time` drives the shake pattern. */
export function followCamera(camera, dt, targetX, targetY, zoomTarget, time) {
  const t = 1 - Math.exp(-CAMERA.follow * dt);
  camera.x += (targetX - camera.x) * t;
  camera.y += (targetY - camera.y) * t;
  camera.zoom += (zoomTarget - camera.zoom) * (1 - Math.exp(-CAMERA.zoomRate * dt));
  clampToWorld(camera);
  camera.shake = Math.max(0, camera.shake - dt * 18);
  camera.shakeX = Math.sin(time * 67.3) * camera.shake;
  camera.shakeY = Math.cos(time * 53.9) * camera.shake;
}

/** Jumps straight to a position (a new game, a staged screenshot). */
export function snapCamera(camera, x, y, zoom) {
  camera.x = x;
  camera.y = y;
  camera.zoom = zoom;
  camera.shake = 0;
  clampToWorld(camera);
}

/** Adds a jolt of `amount` world pixels (capped). */
export function shakeCamera(camera, amount) {
  camera.shake = Math.min(10, Math.max(camera.shake, amount));
}
