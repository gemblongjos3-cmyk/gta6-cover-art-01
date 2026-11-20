// main.ts — the entrypoint: copies app/ and screenshots/ into the output directory
// and writes dossier.json there with buildDossier from vendor/makefun-app.ts.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts      (default: /output)

import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-app.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

const OUT_DIR = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

function log(message: string): void {
  console.log(`[makefun] ${message}`);
}

function fail(message: string): never {
  console.error(`[makefun] error: ${message}`);
  process.exit(1);
}

async function countEntries(dir: string): Promise<number> {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    n += 1;
    if (entry.isDirectory()) n += await countEntries(join(dir, entry.name));
  }
  return n;
}

async function main(): Promise<void> {
  const appDir = join(HERE, 'app');
  const shotsDir = join(HERE, 'screenshots');

  if (!existsSync(join(appDir, 'index.html'))) {
    fail(`no app/index.html beside ${HERE}`);
  }
  if (!existsSync(shotsDir)) {
    fail(`no screenshots/ beside ${HERE}`);
  }

  const indexStat = await stat(join(appDir, 'index.html'));
  if (indexStat.size > 1024 * 1024) {
    fail(`app/index.html is ${indexStat.size} bytes, over the 1 MiB limit`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  // a stale copy of app/ would end up in the dossier, so start clean
  await rm(join(OUT_DIR, 'app'), { recursive: true, force: true });
  await rm(join(OUT_DIR, 'screenshots'), { recursive: true, force: true });

  await cp(appDir, join(OUT_DIR, 'app'), { recursive: true });
  await cp(shotsDir, join(OUT_DIR, 'screenshots'), { recursive: true });

  const appEntries = await countEntries(join(OUT_DIR, 'app'));
  const shots = (await readdir(join(OUT_DIR, 'screenshots'))).filter((n) => !n.startsWith('.'));
  if (shots.length < 3) {
    fail(`screenshots/ holds ${shots.length} image(s); the gate wants 3 or 4`);
  }

  const dossier = buildDossier(OUT_DIR, CAPS);
  await writeFile(join(OUT_DIR, 'dossier.json'), dossier);

  log(`copied app/ (${appEntries} entries) and screenshots/ (${shots.length} images) to ${OUT_DIR}`);
  log(`wrote dossier.json (${dossier.length} bytes)`);
}

await main();
