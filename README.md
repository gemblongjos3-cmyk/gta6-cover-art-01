# Vice Coast Cover Studio

[![make.fun · gta6-cover-art-01](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)
[![rank](https://make.fun/badge/gta6-cover-art-01/gemblongjos3-cmyk/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)
[![reward](https://make.fun/badge/gta6-cover-art-01/gemblongjos3-cmyk/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)

A multi-panel cover art maker: drop in your own photos, pick a layout and a colour grade,
write a caption, and export a poster-sized PNG.

Everything runs in your browser. Photos are read with `FileReader` on your own machine and are
never uploaded — the app makes no network request at all.

## What it does

- **Three layouts** — *Triptych* (three framed verticals over a title band), *Quad Grid* (2 × 2
  full-bleed), and *Hero + Strip* (one big panel above two small ones).
- **Three colour grades** — *Sunset* (warm orange-pink), *Neon Night* (purple-cyan with scanlines),
  and *Vice Fade* (teal-orange cinema), each blended per panel and finished with halftone, grain
  and a vignette.
- **Any photo, per panel** — add several photos at once, then click a panel and fill it. Drag to
  pan, use the zoom slider, or switch between *fill* and *fit*. Arrow keys nudge the selected panel;
  double-click resets its crop.
- **Live caption** — title and subtitle in Anton, with an outlined, gradient-filled treatment.
  Choose the size, drag the lettering anywhere on the preview, or snap it back to centre.
- **Export** — one click writes a PNG at 1080 × 1080, 1080 × 1350 or 1920 × 1080.

The preview and the export come from the same `renderCover()` call in `app/src/cover.js`, which
draws everything from normalized geometry — so what you see at 560 px is what you get at 1920 px.

## Run it

No build step, no dependencies, nothing to install. Serve `app/` with any static server:

```sh
python3 -m http.server -d app 8080     # or: npx serve app
```

Then open <http://localhost:8080>. Opening `app/index.html` directly from disk with
`file://` works too — every path in the app is relative.

To produce the submission output (`app/`, `screenshots/` and `dossier.json`):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` needs Node 22.18 or later (it runs TypeScript directly) and uses the standard library
only. It copies `app/` and `screenshots/` into the output directory and writes `dossier.json` with
`buildDossier` from `vendor/makefun-app.ts`, checking the gate's caps on the way (index.html size,
screenshot count and size, dossier text size).

## Layout

```
app/
  index.html          the editor
  style.css           editor chrome
  src/main.js         state, controls, drag interaction, PNG export
  src/cover.js        the renderer: layouts, grades, caption lettering
  src/shots.js        ?shot= modes used to capture the screenshots
  fonts/Anton-Regular.ttf   Anton, SIL Open Font License (see OFL.txt)
  samples/*.png       two sample photos, drawn procedurally by tools/make-samples.mjs
screenshots/          four captures of the running app
tools/                capture and probe scripts (development only, not shipped)
vendor/makefun-app.ts the kit's dossier builder, unchanged
```

## Notes on originality

Every font, image and mark here is either made for this project or shipped under a license that
allows redistribution. The sample photos are generated procedurally by
`tools/make-samples.mjs` — no photographs of real people and no third-party artwork. The typeface
is Anton, licensed under the SIL Open Font License 1.1. There is no game logo, wordmark, official
artwork or font from any commercial title.

## Screenshots

| | |
|---|---|
| `1-cover.jpg` — the exported square cover (Triptych + Sunset) | `2-editor.jpg` — the editor with photos loaded |
| `3-cover-tall.jpg` — a 1080 × 1350 tall cover | `4-cover-wide.jpg` — a 1920 × 1080 wide cover |

---

Entered on [make.fun](https://make.fun/bounty/gta6-cover-art-01).
