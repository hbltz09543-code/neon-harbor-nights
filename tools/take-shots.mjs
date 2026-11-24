// Renders the entry's screenshots (plain Node 22+, no npm dependencies; not part of the game).
// It starts `node serve.ts --port 8901`, launches headless Chrome with remote debugging, and for
// each entry of shots.json loads http://localhost:8901/<query>, waits for the scene to set
// window.__shotReady, and saves a 1280×800 JPEG into screenshots/<name> through the DevTools
// protocol (spoken over Node's built-in WebSocket). A file over 256 KiB is retaken at a lower
// quality. Page console errors and uncaught exceptions are printed, and make the run fail.
//   node tools/take-shots.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/home/hatch/workspace/dev/tools/cft/chrome-linux64/chrome';
const SERVE_PORT = 8901;
const DEBUG_PORT = 9333;
const WIDTH = 1280;
const HEIGHT = 800;
const MAX_BYTES = 262144;
const QUALITIES = [82, 72, 64];
const READY_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `probe` (async, truthy when done) every `every` ms until `timeout` ms have passed. */
async function waitFor(what, probe, timeout = 15000, every = 100) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // not up yet
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(bytes) {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) throw new Error('not a JPEG marker');
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  throw new Error('no JPEG frame header');
}

/** A minimal DevTools protocol client over one WebSocket. */
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot open ${url}`)), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (!waiter) return;
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
    } else for (const listener of listeners) listener(message.method, message.params);
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
    },
    on(listener) {
      listeners.push(listener);
    },
    close() {
      socket.close();
    },
  };
}

function describeConsole(method, params) {
  if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails;
    return `exception: ${d.exception?.description ?? d.text} (${d.url ?? ''}:${d.lineNumber ?? ''})`;
  }
  if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
    return `console.${params.type}: ${params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`;
  }
  if (method === 'Log.entryAdded' && params.entry.level === 'error') return `log: ${params.entry.text} ${params.entry.url ?? ''}`;
  return null;
}

const shots = JSON.parse(readFileSync(join(ROOT, 'shots.json'), 'utf8'));
mkdirSync(join(ROOT, 'screenshots'), { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'take-shots-'));
const children = [];
let failed = false;

function cleanup() {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(profile, { recursive: true, force: true });
}
process.on('exit', cleanup);

try {
  const server = spawn(process.execPath, ['serve.ts', '--port', String(SERVE_PORT)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(server);
  await waitFor('the game server', async () => (await fetch(`http://localhost:${SERVE_PORT}/`)).ok);

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox', // this container runs as root, where Chrome's sandbox refuses to start
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  children.push(chrome);
  let chromeLog = '';
  chrome.stderr.on('data', (chunk) => {
    chromeLog = (chromeLog + chunk).slice(-4000);
  });
  const page = await waitFor('Chrome', async () => {
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    return targets.find((t) => t.type === 'page');
  }).catch((error) => {
    throw new Error(`${error.message}\n${chromeLog}`);
  });

  const cdp = await connect(page.webSocketDebuggerUrl);
  const errors = [];
  cdp.on((method, params) => {
    const line = describeConsole(method, params);
    if (line) errors.push(line);
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

  for (const shot of shots) {
    errors.length = 0;
    const url = `http://localhost:${SERVE_PORT}/${shot.query}`;
    await cdp.send('Page.navigate', { url });
    await waitFor(
      `${shot.query} to set __shotReady`,
      async () => (await cdp.send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true })).result.value === true,
      READY_TIMEOUT_MS,
    );
    await sleep(300);
    let bytes = null;
    let quality = 0;
    for (quality of QUALITIES) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } });
      bytes = Buffer.from(data, 'base64');
      if (bytes.length <= MAX_BYTES) break;
    }
    const size = jpegSize(bytes);
    writeFileSync(join(ROOT, 'screenshots', shot.name), bytes);
    const ok = bytes.length <= MAX_BYTES && size.width === WIDTH && size.height === HEIGHT;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} screenshots/${shot.name}  ${bytes.length} bytes  ${size.width}x${size.height}  quality ${quality}`);
    for (const line of errors) {
      failed = true;
      console.log(`     page error: ${line}`);
    }
  }
  cdp.close();
} catch (error) {
  failed = true;
  console.error(error);
}
cleanup();
process.exit(failed ? 1 : 0);
