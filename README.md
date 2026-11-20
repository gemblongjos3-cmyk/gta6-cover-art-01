# Vice Coast Cover Studio

[![Make GTA 6 Cover Art — make.fun](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![Rank](https://make.fun/badge/gta6-cover-art-01/gemblongjos3-cmyk/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![Reward pool](https://make.fun/badge/gta6-cover-art-01/gemblongjos3-cmyk/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01)

Entry for the **Make GTA 6 Cover Art** competition: <https://make.fun/bounty/gta6-cover-art-01>

## What it does

Vice Coast Cover Studio turns your own photos into multi-panel, neon-dusk cover
art in the key of a city-set crime-game poster, then exports it as a PNG in one
click. Everything is a static page: the app renders on a canvas in the browser,
reads local files through `URL.createObjectURL`, and never touches the network.

Three layouts, each with its own crop logic and colour grade:

| Variant | Layout | Grade | Default lettering |
| --- | --- | --- | --- |
| **A** — Triptych + Sunset | Three tall panels side by side, caption band across the bottom ~22% of the sheet | Warm orange–pink wash, sunset radial glow, sun disc on each horizon | `VICE COAST` / `SIX NIGHTS ON THE STRIP` |
| **B** — Quad Grid + Neon Night | 2×2 grid, caption plate over the centre seam | Purple/blue shift, scan lines, cyan rim light, magenta bloom | `NEON PIER` / `AFTER MIDNIGHT` |
| **C** — Hero + Strip + Vice Fade | One large hero on top, strip of three below | Restrained teal–orange split with a cinematic fade into ink | `COAST LINE` / `THE LONG WAY HOME` |

The title sits on a plate of its own in A, over the seam in B, and on the hero's
upper third in C, so the lettering always has both a light fill and dark backing.

Also included:

- photo upload by file picker **and** drag-and-drop, up to eight photos;
- two built-in sample photos (`app/samples/boulevard.png`, `app/samples/pier.png`);
- live preview that re-renders on every keystroke and variant switch;
- editable title and subtitle, clamped to the panel width with auto-fit type;
- one-click PNG export at **1024×1024**, **864×1080** and **1280×720**;
- a "copy caption" button for the title/subtitle pair.

No Rockstar logos, artwork or fonts are used or referenced. The only font is
**Anton**, bundled as `app/fonts/Anton-Regular.ttf` under the SIL Open Font
License (see `app/fonts/OFL.txt`).

## Run it

Open `app/index.html` directly in a browser — the app is a plain ES-module page
with no build step and no dependencies:

```sh
open app/index.html            # macOS
xdg-open app/index.html        # Linux
```

Because it is all local, `file://` works: the modules are same-directory, the
font is a relative `@font-face`, and the samples load as `<img>` sources rather
than pixel reads, so the canvas is never tainted and `toBlob` works.

Shot mode for screenshots — a fixed-size render with no editor chrome, which
sets `data-shot-ready` on `<html>` when the frame is painted:

```
app/index.html?shot=cover-square&variant=A     # 1024x1024
app/index.html?shot=cover-tall&variant=C       # 864x1080
app/index.html?shot=cover-wide&variant=B       # 1280x720
```

Optional `&title=` and `&subtitle=` override the lettering.

## Build

`main.ts` (node22, no dependencies) assembles the entry dossier: it clears
`out/`, copies `app/` and `screenshots/` into it, probes each image's real
pixel dimensions from its header, and writes `out/dossier.json` with the
`images`, `cover` and `text` fields, then summarises what it wrote.

```sh
node --experimental-strip-types main.ts    # or: npx tsx main.ts
```

Screenshots are captured with `tools/shot.mjs`, which drives headful Chromium
over the DevTools protocol under a fresh Xvfb display and a fresh debugging
port per attempt, waiting for `data-shot-ready`:

```sh
node tools/shot.mjs --page "file://$PWD/app/index.html?shot=cover-square&variant=A" \
  --out /tmp/1-cover.png --width 1024 --height 1024
```

`CHROME=/path/to/chrome` overrides the browser binary.

## Layout

```
app/index.html          editor page
app/style.css           editor styling
app/src/shots.js        shot sizes, variant defaults, query parsing
app/src/cover.js        canvas cover renderer (three layouts + grades)
app/src/main.js         editor wiring, export, shot mode
app/fonts/              Anton-Regular.ttf + OFL.txt
app/samples/            two sample photos
tools/shot.mjs          CDP screenshot tool
main.ts                 dossier entrypoint
screenshots/            entry captures
```

## Licence

Code: MIT (see `LICENSE`). Font: SIL OFL 1.1 (`app/fonts/OFL.txt`).
Sample photos are synthetic gradients generated for this entry.
