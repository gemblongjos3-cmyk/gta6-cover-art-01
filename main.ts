/**
 * Vice Coast Cover Studio — entrypoint.
 *
 * Copies the two things this entry hands in (app/ and screenshots/) beside this
 * file into MAKEFUN_OUTPUT_DIR, then writes dossier.json there: the manifest the
 * bounty's judge reads, built by the vendored buildDossier from exactly the
 * bytes that were just copied.
 *
 * Node 22.18+, standard library only, no flags: `node main.ts`.
 */

import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier, DossierError } from './vendor/makefun-app.ts';

/** The bounty's caps, as gate.json states them. */
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
} as const;

/** What gets copied out, in the order it is copied. */
const PARTS = ['app', 'screenshots'] as const;

const here = dirname(fileURLToPath(import.meta.url));

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/** Every file under a directory, as paths relative to it, sorted. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const child of await walk(full)) out.push(join(entry.name, child));
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

async function copyPart(name: string, target: string): Promise<number> {
  const source = join(here, name);
  const destination = join(target, name);
  await cp(source, destination, { recursive: true, force: true });
  const files = await walk(destination);
  let bytes = 0;
  for (const file of files) bytes += (await stat(join(destination, file))).size;
  console.log(`  ${name}/  ${String(files.length).padStart(3)} files  ${human(bytes)}`);
  return bytes;
}

async function main(): Promise<void> {
  const target = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  console.log(`Vice Coast Cover Studio → ${target}`);

  await mkdir(target, { recursive: true });

  let copied = 0;
  for (const part of PARTS) copied += await copyPart(part, target);

  let dossier: Uint8Array;
  try {
    dossier = buildDossier(target, CAPS);
  } catch (err) {
    if (err instanceof DossierError) {
      console.error(`dossier: ${err.message}${err.limit ? ` (cap: ${err.limit})` : ''}`);
      process.exit(1);
    }
    throw err;
  }

  const dossierPath = join(target, 'dossier.json');
  await writeFile(dossierPath, dossier);

  const manifest = JSON.parse(new TextDecoder().decode(dossier)) as {
    app?: { files?: unknown[]; totalBytes?: number };
    screenshots?: unknown[];
  };
  const listed = manifest.app?.files?.length ?? 0;
  const shots = manifest.screenshots?.length ?? 0;

  console.log(`  dossier.json  ${human(dossier.byteLength)} — ${listed} app files, ${shots} screenshots`);
  console.log(`wrote ${relative(process.cwd(), dossierPath) || dossierPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
