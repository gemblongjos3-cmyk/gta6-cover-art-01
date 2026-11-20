#!/usr/bin/env node
/**
 * tools/shot.mjs — capture one page as a PNG.
 *
 *   node tools/shot.mjs <url> <out.png> <width> <height> [waitMs]
 *
 * Why not `chrome --headless --screenshot`: that path writes nothing in this
 * sandbox. This runs a headful Chrome under Xvfb and drives it over the
 * DevTools protocol instead: launch, attach, set the viewport, navigate, wait
 * for the page to signal it is ready (data-shot-ready) or for waitMs, then
 * Page.captureScreenshot.
 *
 * Node 22+, standard library only (global WebSocket).
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const CHROME = '/opt/meta-chromium/chrome';

// This image's Chrome refuses to start unless it is handed the measured
// WebGL-domain policy it was built to expect: the shipped allow-list file plus
// the sha256 of its bytes.
const POLICY_FILE =
  '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';

const CHROME_FLAGS = [
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  '--password-store=basic',
  '--use-mock-keychain',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

if (!existsSync(POLICY_FILE)) {
  console.error(`shot.mjs: missing Chrome WebGL policy file ${POLICY_FILE}`);
  process.exit(2);
}
const policySha = createHash('sha256').update(readFileSync(POLICY_FILE)).digest('hex');

function usage(msg) {
  if (msg) console.error(`shot.mjs: ${msg}`);
  console.error('usage: node tools/shot.mjs <url> <out.png> <width> <height> [waitMs]');
  process.exit(2);
}

const [url, outArg, wArg, hArg, waitArg] = process.argv.slice(2);
if (!url || !outArg || !wArg || !hArg) usage();
const width = Number(wArg);
const height = Number(hArg);
const waitMs = Number(waitArg ?? 2500);
if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
  usage('width and height must be whole numbers');
}
if (!Number.isFinite(waitMs) || waitMs < 0) usage('waitMs must be a number of milliseconds');

const outPath = resolve(outArg);
mkdirSync(dirname(outPath), { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'vc-shot-'));

// Each attempt gets its own display number and debugging port: the sandbox
// leaves stale Xvfb servers behind, so a fixed number can already be taken.
function attemptNumber() {
  return Math.floor(Math.random() * 900);
}

function launch(display, port) {
  const child = spawn(
    'xvfb-run',
    [
      '-n', String(display),
      '--server-args=-screen 0 1920x1600x24',
      CHROME,
      ...CHROME_FLAGS,
      `--hatch-webgl-allowed-domains-file=${POLICY_FILE}`,
      `--hatch-webgl-allowed-domains-sha256=${policySha}`,
      `--user-data-dir=${profile}-${display}`,
      `--remote-debugging-port=${port}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const log = [];
  child.stderr.on('data', (b) => log.push(b.toString()));
  child.stdout.on('data', () => {});
  return { child, log };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (err) {
      lastErr = String(err && err.message ? err.message : err);
    }
    await sleep(200);
  }
  throw new Error(`no debuggable page after ${timeoutMs} ms (${lastErr})`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject: bad } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) bad(new Error(`${msg.error.message}${msg.error.data ? ': ' + msg.error.data : ''}`));
        else ok(msg.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('devtools socket closed'));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((ok, bad) => {
      this.pending.set(id, { resolve: ok, reject: bad });
      this.socket.send(payload);
      setTimeout(() => {
        if (this.pending.delete(id)) bad(new Error(`${method} timed out`));
      }, 45000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return r && r.result ? r.result.value : undefined;
  }
}

async function connect(wsUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const socket = new WebSocket(wsUrl);
      await new Promise((ok, bad) => {
        socket.addEventListener('open', ok, { once: true });
        socket.addEventListener('error', () => bad(new Error('ws error')), { once: true });
      });
      return new Cdp(socket);
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`could not open devtools socket ${wsUrl}`);
}

/** One capture attempt: launch, attach, navigate, wait, screenshot. */
async function captureOnce() {
  const display = attemptNumber();
  const port = 9300 + attemptNumber();
  const { child, log } = launch(display, port);

  try {
    let target;
    try {
      target = await findTarget(port, 18000);
    } catch (err) {
      const tail = log.join('').split('\n').filter(Boolean).slice(-4).join(' | ');
      throw new Error(`${err.message}${tail ? ` [${tail}]` : ''}`);
    }
    const cdp = await connect(target.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });

    await cdp.send('Page.navigate', { url });

    // Wait for the page to say it is ready. Cover shots set the flag once the
    // cover is painted; the editor sets it after the samples load. A page that
    // never sets it still gets captured, after the same generous deadline.
    const deadline = Date.now() + Math.max(waitMs, 15000);
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = (await cdp.eval("document.documentElement.getAttribute('data-shot-ready') === '1'")) === true;
      } catch {
        ready = false;
      }
      if (ready) break;
      await sleep(150);
    }
    await sleep(700);

    const probe = await cdp.eval(
      "JSON.stringify({title: document.title, w: innerWidth, h: innerHeight," +
      " ready: document.documentElement.getAttribute('data-shot-ready')," +
      " canvases: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height)," +
      " status: (document.getElementById('status') || {}).textContent || ''," +
      " chips: document.querySelectorAll('#photoList .chip').length," +
      " imgs: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length})",
    );
    console.log(`page: ${probe}`);

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    if (!shot || !shot.data) throw new Error('captureScreenshot returned no data');

    const bytes = Buffer.from(shot.data, 'base64');
    writeFileSync(outPath, bytes);
    console.log(`${outPath}  ${width}x${height}  ${bytes.length} bytes  ready=${ready}`);
    return ready;
  } finally {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

const ATTEMPTS = 3;
let ready = false;
let lastError = null;
for (let i = 1; i <= ATTEMPTS; i++) {
  try {
    ready = await captureOnce();
    lastError = null;
    if (ready) break;
  } catch (err) {
    lastError = err;
    console.error(`shot.mjs: attempt ${i}/${ATTEMPTS} failed: ${err instanceof Error ? err.message : String(err)}`);
    // a stale Xvfb name or port is worth retrying on fresh numbers
  }
  await sleep(500);
}

if (lastError) {
  console.error(`shot.mjs: gave up: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  process.exit(1);
}
if (!ready) console.error('shot.mjs: warning — page never signalled data-shot-ready');
process.exit(existsSync(outPath) ? 0 : 1);
