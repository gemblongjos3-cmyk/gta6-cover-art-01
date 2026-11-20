#!/usr/bin/env node
// probe.mjs — open a URL in the sandbox Chrome and evaluate one expression in the page.
// Used to check app state (are the panels filled? did the fonts load?) without taking
// a picture. Same Chrome flags as tools/shot.mjs.
//
//   node tools/probe.mjs <url> "<expression>" [waitMs]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const POLICY = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const CHROME = '/opt/meta-chromium/chrome';
const PORT = 9334;

const [url, expression, waitArg] = process.argv.slice(2);
if (!url || !expression) {
  console.error('usage: node tools/probe.mjs <url> "<expression>" [waitMs]');
  process.exit(2);
}
const waitMs = Number(waitArg || 4000);

const policy = readFileSync(POLICY);
const policySha = createHash('sha256').update(policy).digest('hex');
const profile = mkdtempSync(join(tmpdir(), 'makefun-probe-'));

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
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + PORT,
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
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
      }
    };
  });
}

async function main() {
  const cdp = await connect(await target());
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  await sleep(waitMs);
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result.value ?? r.result, null, 2));
  cdp.close();
}

main()
  .catch((err) => {
    console.error(`probe failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sleep(150);
    chrome.kill('SIGKILL');
    await sleep(150);
  });
