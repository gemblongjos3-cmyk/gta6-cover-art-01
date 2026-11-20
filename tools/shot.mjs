#!/usr/bin/env node
// shot.mjs — capture a screenshot of the running app with the sandbox's Chrome.
//
// This image's Chrome (157, "Muse Browser") refuses to start without the measured
// WebGL-domain policy, and its --headless --screenshot path writes nothing here, so
// the tool drives a headful Chrome under Xvfb over the DevTools protocol instead:
// it opens the URL, waits for the page to settle, and asks for Page.captureScreenshot.
//
//   node tools/shot.mjs <url> <out.png> <width> <height> [waitMs]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POLICY = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const CHROME = '/opt/meta-chromium/chrome';
const PORT = 9333;

const [url, out, wArg, hArg, waitArg] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node tools/shot.mjs <url> <out.png> <width> <height> [waitMs]');
  process.exit(2);
}
const width = Number(wArg || 1280);
const height = Number(hArg || 800);
const waitMs = Number(waitArg || 4000);

const policy = readFileSync(POLICY);
const policySha = createHash('sha256').update(policy).digest('hex');
const profile = mkdtempSync(join(tmpdir(), 'makefun-chrome-'));

const chrome = spawn(
  'xvfb-run',
  [
    '-a',
    CHROME,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests',
    '--disable-web-security',
    '--allow-file-access-from-files',
    '--allow-file-access',
    `--hatch-webgl-allowed-domains-file=${POLICY}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (err) {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('chrome did not expose a page target');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const msgId = ++id;
          return new Promise((res, rej) => {
            pending.set(msgId, { res, rej });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close() {
          ws.close();
        },
      });
    ws.onerror = (e) => reject(new Error(`websocket error: ${e.message || 'unknown'}`));
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        console.error(`[page exception] ${d.text} ${(d.exception && d.exception.description) || ''}`);
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        console.error(`[page console] ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      }
    };
  });
}

async function main() {
  const wsUrl = await findTarget();
  const cdp = await connect(wsUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loaded = new Promise((resolve) => {
    const started = Date.now();
    const tick = async () => {
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: 'document.readyState === "complete"',
          returnByValue: true,
        });
        if (r.result && r.result.value === true) return resolve(true);
      } catch (err) {
        // page still swapping documents
      }
      if (Date.now() - started > 15000) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });

  await cdp.send('Page.navigate', { url });
  await loaded;
  await sleep(waitMs);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  const check = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({w: innerWidth, h: innerHeight, ready: document.documentElement.dataset.shotReady || ""})',
    returnByValue: true,
  });
  console.log(`wrote ${out} ${width}x${height} ${JSON.stringify(check.result && check.result.value)}`);

  cdp.close();
}

main()
  .catch((err) => {
    console.error(`shot failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(150);
    chrome.kill('SIGKILL');
    await sleep(150);
  });
