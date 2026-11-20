#!/usr/bin/env node
// Screenshot tool: headful Chromium under Xvfb, driven over the DevTools
// protocol. Fresh display + fresh CDP port per attempt so no state is reused.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = process.env.CHROME || '/opt/meta-chromium/chrome';

function parseArgs(argv) {
  const out = { page: null, out: null, width: 1024, height: 1024, wait: 25000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--page' || a === '--url') out.page = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--width') out.width = Number(argv[++i]);
    else if (a === '--height') out.height = Number(argv[++i]);
    else if (a === '--wait') out.wait = Number(argv[++i]);
  }
  if (!out.page || !out.out) {
    console.error('usage: tools/shot.mjs --page <file-or-url> --out <file.png> [--width N --height N]');
    process.exit(2);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolveP, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolveP(port));
    });
  });
}

async function waitJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = `status ${res.status}`;
    } catch (err) {
      last = err && err.message;
    }
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${url} (${last})`);
}

function connect(wsUrl) {
  return new Promise((resolveP, reject) => {
    const socket = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message));
        else ok(msg.result);
      }
    });
    socket.addEventListener('error', () => reject(new Error('cdp socket error')));
    socket.addEventListener('open', () => {
      resolveP({
        send(method, params = {}) {
          id += 1;
          const mine = id;
          return new Promise((ok, fail) => {
            pending.set(mine, { ok, fail });
            socket.send(JSON.stringify({ id: mine, method, params }));
          });
        },
        close() {
          try {
            socket.close();
          } catch (err) {
            /* already gone */
          }
        }
      });
    });
  });
}

// Some Chromium builds (HATCH's Feather VM payload, for one) refuse to boot
// without a signed "WebGL allowed domains" policy. The app is pure canvas 2D,
// so an empty, correctly-formed policy is all we need. Builds that do not know
// these switches ignore them.
async function writePolicy(dir) {
  const file = join(dir, 'webgl-domains.txt');
  const text = 'hatch-webgl-allowed-domains-v1\n';
  await writeFile(file, text, 'utf8');
  const sha = createHash('sha256').update(text).digest('hex');
  return [`--hatch-webgl-allowed-domains-file=${file}`, `--hatch-webgl-allowed-domains-sha256=${sha}`];
}

async function capture(opts, attempt) {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), `vcss-${attempt}-`));
  const policyFlags = await writePolicy(profile);

  // Headful Chromium on a private Xvfb screen; xvfb-run picks a free display
  // number and tears it down with the process, so nothing carries over.
  const chrome = spawn(
    'xvfb-run',
    [
      '-a',
      '-s',
      `-screen 0 ${opts.width + 40}x${opts.height + 80}x24`,
      CHROME,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      `--window-size=${opts.width},${opts.height}`,
      ...policyFlags,
      'about:blank'
    ],
    {
      env: { ...process.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  let stderr = '';
  chrome.stderr.on('data', (d) => {
    stderr += String(d);
  });

  let client = null;
  try {
    const version = await waitJson(`http://127.0.0.1:${port}/json/version`, 15000);
    const page = await waitJson(`http://127.0.0.1:${port}/json/list`, 8000).then((list) =>
      list.find((t) => t.type === 'page')
    );
    client = await connect((page && page.webSocketDebuggerUrl) || version.webSocketDebuggerUrl);

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false
    });

    await client.send('Page.navigate', { url: opts.page });

    const deadline = Date.now() + opts.wait;
    let ready = null;
    while (Date.now() < deadline) {
      const res = await client.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.documentElement;
          return JSON.stringify({
            ready: el.getAttribute('data-shot-ready'),
            error: el.getAttribute('data-shot-error'),
            app: el.getAttribute('data-app-ready')
          });
        })()`,
        returnByValue: true
      });
      const value = res.result && res.result.value;
      if (value) {
        const state = JSON.parse(value);
        if (state.error) throw new Error(`page reported: ${state.error}`);
        if (state.ready) {
          ready = state.ready;
          break;
        }
      }
      await sleep(150);
    }
    if (!ready) throw new Error('data-shot-ready never appeared');

    // let the final paint settle
    await sleep(350);

    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true
    });
    const bytes = Buffer.from(shot.data, 'base64');
    if (bytes.length < 8000) throw new Error(`suspiciously small png (${bytes.length} B)`);
    await writeFile(opts.out, bytes);
    return { ready, bytes: bytes.length };
  } finally {
    if (client) client.close();
    // xvfb-run started a whole process group; kill it as one so nothing lingers.
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch (err) {
      try {
        chrome.kill('SIGKILL');
      } catch (err2) {
        /* already gone */
      }
    }
    await sleep(120);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(resolve(opts.out, '..'), { recursive: true });
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await capture(opts, attempt);
      console.log(`ok ${opts.out} — ${res.bytes} B (${res.ready})`);
      // the CDP socket and the browser group are gone; exit rather than wait
      // on any stray handle the child left behind.
      process.exit(0);
    } catch (err) {
      lastErr = err;
      console.error(`attempt ${attempt + 1} failed: ${err.message}`);
      await sleep(500);
    }
  }
  throw lastErr;
}

main().catch((err) => {
  console.error('shot failed:', err && err.message ? err.message : err);
  process.exit(1);
});
