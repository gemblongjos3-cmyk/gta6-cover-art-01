[![make.fun · gta6-cover-art-01](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)
[![rank](https://make.fun/badge/gta6-cover-art-01/gemblongjos3-cmyk/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)
[![reward](https://make.fun/badge/gta6-cover-art-01/gemblongjos3-cmyk/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-cover-art-01)

# Vice Coast Cover Studio

Turn your own photos into multi-panel, neon-dusk cover art — the kind of poster a
city-set crime game puts on a shelf — and export it as a PNG in one click.

Three layouts (Triptych, Quad Grid, Hero + Strip), three colour grades (Sunset,
Neon Night, Vice Fade), per-panel crop, zoom and pan, big condensed lettering you
can drag anywhere on the sheet, and three export sizes. Everything is drawn by
one canvas painter, so the live preview, the exported PNG and the screenshots in
`screenshots/` are the same code path.

Photos never leave the machine. The page makes no network request of any kind:
the photos come from the file picker or from `app/samples/`, the display font is
the bundled `app/fonts/Anton-Regular.ttf`, and every gradient, grain tile and
halftone dot is generated in JavaScript.

## What's in here

```
app/                 the whole app — plain static files, open index.html directly
  index.html         editor: photos, layout, grade, caption, export
  style.css          the UI's dark, neon-trimmed theme
  src/cover.js       the renderer: layouts, grades, band, caption, effects
  src/main.js        editor state and wiring
  src/shots.js       the ?shot= modes used to capture the screenshots
  samples/           two bundled photos (generated for this project)
  fonts/             Anton (SIL Open Font License, see OFL.txt)
screenshots/         the four captures submitted with the entry
main.ts              copies app/ and screenshots/ to the output dir, writes dossier.json
vendor/              the bounty's buildDossier helper (unchanged)
```

## Run it

No build step, no dependencies. Open `app/index.html` in desktop Chrome, or serve
the folder from any static server:

```sh
python3 -m http.server 8000 --directory app
# then open http://localhost:8000/
```

Click **Use samples**, or **Choose photos…** to load your own. Pick a layout, a
grade and an export size, drag the lettering or a panel where you want it, then
hit **Export PNG** (or press <kbd>E</kbd>).

## Build the submission

`main.ts` copies `app/` and `screenshots/` beside itself into the output
directory and writes `dossier.json` from exactly those bytes. Node 22.18+, no
flags:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

It prints each part's file count and size, then the dossier line. Anything over
the bounty's caps (app ≤ 1 MiB index, screenshots ≤ 256 KiB each, dossier text
≤ 160 KiB) fails the run with a non-zero exit.

## The screenshot modes

`index.html?shot=cover-square|cover-tall|cover-wide` renders a finished cover at
that size through the same painter the editor uses, and
`index.html?shot=editor` loads both samples into the editor. Each mode sets
`data-shot-ready` on `<html>` once it is painted, which is what
`tools/shot.mjs` waits for before capturing:

```sh
node tools/shot.mjs "file://$PWD/app/index.html?shot=cover-square" out.png 1024 1024
```

## Licence

MIT for the code (see `LICENSE`); Anton is under the SIL Open Font License
(`app/fonts/OFL.txt`). No Rockstar logo, artwork or font is used anywhere — every
mark in this project is drawn by this project.

---

Entered on [make.fun](https://make.fun/bounty/gta6-cover-art-01).
