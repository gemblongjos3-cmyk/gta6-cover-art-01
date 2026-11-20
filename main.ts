#!/usr/bin/env -S npx tsx
// Entrypoint: run the dossier for the kit.
// Copies app/ and screenshots/ into the output dir, then writes the make.fun
// dossier file and prints a summary read back from that dossier's own schema.

import { cp, mkdir, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
const APP = join(HERE, 'app');
const SHOTS = join(HERE, 'screenshots');

type Owner = { wallet?: string };
type DossierText = { title?: string; subtitle?: string; blurb?: string };
type DossierImage = { file: string; width: number; height: number; bytes: number };

type Dossier = {
  slug: string;
  name: string;
  tagline: string;
  wallet: string;
  app: string;
  cover: string;
  images: DossierImage[];
  text: DossierText;
  builtAt: string;
};

// Minimal PNG/JPEG header probe — enough to report real pixel dimensions
// without pulling an image library into the runtime.
function dimensions(buf: Buffer, file: string): { width: number; height: number } {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  throw new Error(`cannot read dimensions of ${file}`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'app'), { recursive: true });
  await mkdir(join(OUT, 'screenshots'), { recursive: true });

  await cp(APP, join(OUT, 'app'), { recursive: true });
  await cp(SHOTS, join(OUT, 'screenshots'), { recursive: true });
  // the licence and the entry notes travel with the bundle, so the output dir
  // is self-describing once app/ and screenshots/ are copied out of it
  for (const file of ['LICENSE', 'README.md']) {
    await cp(join(HERE, file), join(OUT, file));
  }

  const owner: Owner = JSON.parse(await readFile(join(HERE, '.makefun/owner.json'), 'utf8'));
  const wallet = owner.wallet || '';

  const shotFiles = (await readdir(join(OUT, 'screenshots')))
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();

  const images: DossierImage[] = [];
  for (const file of shotFiles) {
    const path = join(OUT, 'screenshots', file);
    const buf = await readFile(path);
    const info = await stat(path);
    images.push({ file: `screenshots/${file}`, ...dimensions(buf, file), bytes: info.size });
  }

  const cover = images.find((i) => /^screenshots\/1-cover\./.test(i.file));
  if (!cover) throw new Error('screenshots/1-cover.jpg is missing');

  const dossier: Dossier = {
    slug: 'gta6-cover-art-01',
    name: 'Vice Coast Cover Studio',
    tagline: 'Your photos, cut into neon-dusk cover art — three layouts, one-click PNG.',
    wallet,
    app: 'out/app/index.html',
    cover: cover.file,
    images,
    text: {
      title: 'Vice Coast Cover Studio',
      subtitle: 'Three cover layouts, three sizes, zero uploads',
      blurb:
        'A static, fully offline studio that turns your own photos into multi-panel ' +
        'neon-dusk cover art. Three layouts — triptych with a sunset band, a quad grid ' +
        'under neon scan lines, and a hero shot with a film strip — each with its own ' +
        'grade. Live preview, editable title and subtitle, and a one-click PNG export ' +
        'at 1024x1024, 864x1080 or 1280x720. Everything renders on a canvas in the ' +
        'browser; no upload, no server, no third-party artwork.'
    },
    builtAt: new Date().toISOString()
  };

  const outFile = join(OUT, 'dossier.json');
  await writeFile(outFile, JSON.stringify(dossier, null, 2) + '\n', 'utf8');

  // Read the dossier back and summarise it from its real fields.
  const written: Dossier = JSON.parse(await readFile(outFile, 'utf8'));
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KiB`;

  console.log('Vice Coast Cover Studio — dossier');
  console.log(`  slug    : ${written.slug}`);
  console.log(`  name    : ${written.name}`);
  console.log(`  wallet  : ${written.wallet}`);
  console.log(`  app     : ${written.app}`);
  console.log(`  cover   : ${written.cover}`);
  console.log(`  images  : ${written.images.length}`);
  for (const img of written.images) {
    console.log(`            ${img.file} — ${img.width}x${img.height}, ${kb(img.bytes)}`);
  }
  console.log(`  text    : title="${written.text.title}"`);
  console.log(`            subtitle="${written.text.subtitle}"`);
  console.log(`            blurb=${written.text.blurb.length} chars`);
  const outFiles = (await readdir(OUT)).sort();
  console.log(`  out     : ${outFiles.length} top-level entries (${outFiles.join(', ')})`);
  console.log(`  written : ${outFile}`);
}

main().catch((err) => {
  console.error('dossier failed:', err && err.message ? err.message : err);
  process.exit(1);
});
