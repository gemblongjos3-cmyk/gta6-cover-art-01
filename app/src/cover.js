// Cover renderer. Pure canvas 2D — no pixel reads, so it works from file://
// without tainting, and every grade is a filter plus a composite fill.

import { VARIANTS, normaliseVariant } from './shots.js';

export const SAMPLE_PHOTOS = [
  { src: 'samples/boulevard.png', label: 'Boulevard' },
  { src: 'samples/pier.png', label: 'Pier' }
];

const INK = '#f4ece0';
const PLATE = 'rgba(9,6,10,0.88)';

/* ---------- small helpers ---------- */

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

// Deterministic PRNG so a cover renders identically every time.
function rng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Draw an image so it covers the rect, cropping the overflow.
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  for (const [at, colour] of stops) g.addColorStop(at, colour);
  return g;
}

// Fine film grain: thousands of 1px specks, no getImageData involved.
function grain(ctx, x, y, w, h, strength, seed) {
  const rand = rng(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const count = Math.floor((w * h) / 220);
  for (let i = 0; i < count; i += 1) {
    const px = x + rand() * w;
    const py = y + rand() * h;
    const light = rand() > 0.5;
    ctx.fillStyle = light
      ? `rgba(255,246,232,${0.02 + rand() * strength})`
      : `rgba(0,0,0,${0.02 + rand() * strength})`;
    const s = rand() > 0.85 ? 2 : 1;
    ctx.fillRect(px, py, s, s);
  }
  ctx.restore();
}

function vignette(ctx, w, h, strength) {
  ctx.save();
  ctx.fillStyle = radial(ctx, w / 2, h * 0.5, Math.min(w, h) * 0.25, Math.max(w, h) * 0.78, [
    [0, 'rgba(0,0,0,0)'],
    [0.65, `rgba(0,0,0,${strength * 0.35})`],
    [1, `rgba(0,0,0,${strength})`]
  ]);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function fitFont(ctx, text, family, weight, maxWidth, startSize) {
  let size = startSize;
  for (let i = 0; i < 60; i += 1) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size *= 0.94;
    if (size < 8) break;
  }
  return size;
}

// Heavy condensed display type with an optional offset colour plate behind it.
function display(ctx, text, x, y, opts) {
  const {
    family = 'Anton, Impact, sans-serif',
    maxWidth,
    size,
    align = 'left',
    colour = INK,
    shadow = null,
    spacing = 0
  } = opts;
  let used = size;
  if (maxWidth) used = fitFont(ctx, text, family, '400', maxWidth, size);
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${used}px ${family}`;
  if (spacing) ctx.letterSpacing = `${spacing}px`;
  if (shadow) {
    ctx.fillStyle = shadow;
    ctx.fillText(text, x + used * 0.013, y + used * 0.013);
  }
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
  ctx.restore();
  return used;
}

function spaced(ctx, text, x, y, opts) {
  const { size, colour, align = 'left', spacing, family = 'Helvetica Neue, Arial, sans-serif' } = opts;
  ctx.save();
  ctx.font = `500 ${size}px ${family}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
  ctx.restore();
}

/* ---------- variant A: triptych + sunset ---------- */

function renderTriptych(ctx, w, h, photos, copy) {
  const pad = Math.round(w * 0.034);
  const gap = Math.round(w * 0.014);
  const bandY = Math.round(h * 0.775);
  const panelH = bandY - pad;
  const panelW = Math.floor((w - pad * 2 - gap * 2) / 3);

  ctx.fillStyle = '#120a0e';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 3; i += 1) {
    const x = pad + i * (panelW + gap);
    const img = photos[i % photos.length];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, pad, panelW, panelH);
    ctx.clip();
    ctx.filter = 'saturate(1.28) contrast(1.1) sepia(0.16) brightness(1.02)';
    drawCover(ctx, img, x, pad, panelW, panelH);
    ctx.filter = 'none';
    // warm dusk wash over the lower half of every panel
    ctx.fillStyle = linear(ctx, 0, pad, 0, pad + panelH, [
      [0, 'rgba(255,142,70,0.20)'],
      [0.45, 'rgba(255,96,104,0.16)'],
      [1, 'rgba(120,20,60,0.42)']
    ]);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillRect(x, pad, panelW, panelH);
    ctx.globalCompositeOperation = 'source-over';
    // sunset glow behind the panel base
    ctx.fillStyle = radial(ctx, x + panelW / 2, pad + panelH * 0.92, 0, panelW * 1.05, [
      [0, 'rgba(255,168,72,0.55)'],
      [0.55, 'rgba(255,92,110,0.18)'],
      [1, 'rgba(255,92,110,0)']
    ]);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillRect(x, pad, panelW, panelH);
    ctx.globalCompositeOperation = 'source-over';
    // sun disc sitting on the horizon of each panel
    const sunY = pad + panelH * 0.80;
    ctx.fillStyle = 'rgba(255,196,120,0.55)';
    ctx.beginPath();
    ctx.arc(x + panelW / 2, sunY, panelW * 0.11, 0, Math.PI * 2);
    ctx.fill();
    grain(ctx, x, pad, panelW, panelH, 0.05, hash(copy.title + i));
    ctx.restore();
  }

  // caption band with its own plate
  ctx.fillStyle = '#0c0709';
  ctx.fillRect(0, bandY, w, h - bandY);
  ctx.fillStyle = 'rgba(255,150,90,0.55)';
  ctx.fillRect(0, bandY, w, Math.max(1, Math.round(h * 0.0022)));
  ctx.fillStyle = linear(ctx, 0, bandY, 0, h, [
    [0, 'rgba(255,120,80,0.10)'],
    [1, 'rgba(255,60,120,0.02)']
  ]);
  ctx.fillRect(0, bandY, w, h - bandY);

  const plateW = w * 0.80;
  const plateH = (h - bandY) * 0.62;
  const plateX = (w - plateW) / 2;
  const plateY = bandY + (h - bandY) * 0.17;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(plateX, plateY, plateW, plateH);
  ctx.fillStyle = 'rgba(255,236,208,0.16)';
  ctx.fillRect(plateX, plateY, plateW, Math.max(1, h * 0.0018));

  const size = Math.round(plateH * 0.94);
  display(ctx, copy.title, w / 2, plateY + plateH * 1.02, {
    maxWidth: plateW * 0.92,
    size,
    align: 'center',
    colour: INK,
    shadow: 'rgba(255,84,132,0.55)',
    spacing: Math.round(w * 0.004)
  });
  spaced(ctx, copy.subtitle, w / 2, bandY + (h - bandY) * 0.94, {
    size: Math.round(h * 0.0165),
    colour: 'rgba(255,206,176,0.80)',
    align: 'center',
    spacing: Math.round(h * 0.007)
  });

  vignette(ctx, w, h, 0.55);
}

/* ---------- variant B: quad grid + neon night ---------- */

function renderQuad(ctx, w, h, photos, copy) {
  const pad = Math.round(w * 0.03);
  const gap = Math.round(w * 0.012);
  const cellW = Math.floor((w - pad * 2 - gap) / 2);
  const cellH = Math.floor((h - pad * 2 - gap) / 2);

  ctx.fillStyle = '#07060f';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 4; i += 1) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = pad + col * (cellW + gap);
    const y = pad + row * (cellH + gap);
    const img = photos[i % photos.length];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, cellH);
    ctx.clip();
    ctx.filter = 'grayscale(0.35) contrast(1.22) brightness(0.95) saturate(1.15)';
    drawCover(ctx, img, x, y, cellW, cellH);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = linear(ctx, x, y, x + cellW, y + cellH, [
      [0, 'rgba(96,64,255,0.75)'],
      [0.55, 'rgba(180,40,220,0.45)'],
      [1, 'rgba(30,40,180,0.65)']
    ]);
    ctx.fillRect(x, y, cellW, cellH);
    // cyan rim light along the seam-facing edge
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = radial(ctx, x + (col ? 0 : cellW), y + (row ? 0 : cellH), 0, cellW * 0.85, [
      [0, 'rgba(90,240,255,0.35)'],
      [1, 'rgba(90,240,255,0)']
    ]);
    ctx.fillRect(x, y, cellW, cellH);
    // magenta bloom
    ctx.fillStyle = radial(ctx, x + cellW * 0.5, y + cellH * 0.72, 0, cellW * 0.7, [
      [0, 'rgba(255,60,180,0.30)'],
      [1, 'rgba(255,60,180,0)']
    ]);
    ctx.fillRect(x, y, cellW, cellH);
    ctx.globalCompositeOperation = 'source-over';
    // scan lines
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    const step = Math.max(3, Math.round(h * 0.004));
    for (let sy = y; sy < y + cellH; sy += step) ctx.fillRect(x, sy, cellW, 1);
    grain(ctx, x, y, cellW, cellH, 0.05, hash(copy.title + 'b' + i));
    ctx.restore();
  }

  // neon seam cross
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const seamX = w / 2;
  const seamY = h / 2;
  ctx.fillStyle = linear(ctx, seamX, 0, seamX, h, [
    [0, 'rgba(255,70,200,0)'],
    [0.5, 'rgba(255,120,220,0.55)'],
    [1, 'rgba(255,70,200,0)']
  ]);
  ctx.fillRect(seamX - Math.max(1, w * 0.0015), 0, Math.max(2, w * 0.003), h);
  ctx.fillStyle = radial(ctx, seamX, seamY, 0, w * 0.30, [
    [0, 'rgba(255,120,220,0.30)'],
    [1, 'rgba(255,120,220,0)']
  ]);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // caption plate over the centre seam
  const capW = w * 0.62;
  const capH = h * 0.19;
  const capX = (w - capW) / 2;
  const capY = seamY - capH / 2;
  ctx.fillStyle = PLATE;
  ctx.fillRect(capX, capY, capW, capH);
  ctx.fillStyle = 'rgba(120,240,255,0.75)';
  ctx.fillRect(capX, capY, capW, Math.max(1, h * 0.0018));
  ctx.fillStyle = 'rgba(255,70,200,0.75)';
  ctx.fillRect(capX, capY + capH - Math.max(1, h * 0.0018), capW, Math.max(1, h * 0.0018));

  display(ctx, copy.title, w / 2, capY + capH * 0.68, {
    maxWidth: capW * 0.86,
    size: Math.round(capH * 0.52),
    align: 'center',
    colour: '#f6f1ff',
    shadow: 'rgba(255,60,200,0.85)',
    spacing: Math.round(w * 0.006)
  });
  spaced(ctx, copy.subtitle, w / 2, capY + capH * 0.90, {
    size: Math.round(h * 0.0145),
    colour: 'rgba(160,240,255,0.92)',
    align: 'center',
    spacing: Math.round(h * 0.008)
  });

  vignette(ctx, w, h, 0.62);
}

/* ---------- variant C: hero + strip + vice fade ---------- */

function renderHero(ctx, w, h, photos, copy) {
  const pad = Math.round(w * 0.032);
  const gap = Math.round(w * 0.012);
  const heroH = Math.round((h - pad * 2) * 0.725);
  const stripY = pad + heroH + gap;
  const stripH = h - pad - stripY;
  const stripW = Math.floor((w - pad * 2 - gap * 2) / 3);

  ctx.fillStyle = '#08110f';
  ctx.fillRect(0, 0, w, h);

  // hero
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, w - pad * 2, heroH);
  ctx.clip();
  ctx.filter = 'saturate(1.05) contrast(1.12) brightness(0.98)';
  drawCover(ctx, photos[0], pad, pad, w - pad * 2, heroH);
  ctx.filter = 'none';
  // teal shadows
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = linear(ctx, pad, pad, pad, pad + heroH, [
    [0, 'rgba(0,190,190,0.55)'],
    [0.5, 'rgba(200,140,90,0.18)'],
    [1, 'rgba(0,120,170,0.55)']
  ]);
  ctx.fillRect(pad, pad, w - pad * 2, heroH);
  // orange highs
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = radial(ctx, w * 0.72, pad + heroH * 0.22, 0, w * 0.55, [
    [0, 'rgba(255,150,70,0.30)'],
    [1, 'rgba(255,150,70,0)']
  ]);
  ctx.fillRect(pad, pad, w - pad * 2, heroH);
  // cinematic fade to ink at the hero base
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = linear(ctx, 0, pad + heroH * 0.55, 0, pad + heroH, [
    [0, 'rgba(6,12,14,0)'],
    [1, 'rgba(6,12,14,0.92)']
  ]);
  ctx.fillRect(pad, pad, w - pad * 2, heroH);
  ctx.restore();

  // strip
  for (let i = 0; i < 3; i += 1) {
    const x = pad + i * (stripW + gap);
    const img = photos[(i + 1) % photos.length];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, stripY, stripW, stripH);
    ctx.clip();
    ctx.filter = 'saturate(0.9) contrast(1.08) brightness(0.9)';
    drawCover(ctx, img, x, stripY, stripW, stripH);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = linear(ctx, x, stripY, x, stripY + stripH, [
      [0, 'rgba(0,150,170,0.45)'],
      [1, 'rgba(255,140,70,0.35)']
    ]);
    ctx.fillRect(x, stripY, stripW, stripH);
    ctx.globalCompositeOperation = 'source-over';
    grain(ctx, x, stripY, stripW, stripH, 0.04, hash(copy.title + 's' + i));
    ctx.restore();
  }

  // scrim behind the upper third so the light lettering always has dark
  // backing, whatever the hero photo's sky happens to be
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, w - pad * 2, heroH);
  ctx.clip();
  ctx.fillStyle = linear(ctx, 0, pad, 0, pad + heroH * 0.50, [
    [0, 'rgba(5,10,13,0.93)'],
    [0.62, 'rgba(5,10,13,0.86)'],
    [0.86, 'rgba(5,10,13,0.55)'],
    [1, 'rgba(5,10,13,0)']
  ]);
  ctx.fillRect(pad, pad, w - pad * 2, heroH * 0.50);
  // grain last, so the scrim's darkest corner still carries film texture
  grain(ctx, pad, pad, w - pad * 2, heroH, 0.045, hash(copy.title + 'c'));
  ctx.restore();

  // title on the hero's upper third
  const size = Math.round(w * 0.145);
  display(ctx, copy.title, pad + w * 0.03, Math.round(h * 0.315), {
    maxWidth: w - pad * 2 - w * 0.06,
    size,
    colour: INK,
    shadow: 'rgba(0,40,60,0.75)',
    spacing: Math.round(w * 0.004)
  });
  const ruleY = Math.round(h * 0.338);
  ctx.fillStyle = 'rgba(255,182,120,0.9)';
  ctx.fillRect(pad + w * 0.03, ruleY, w * 0.16, Math.max(1, h * 0.0022));
  spaced(ctx, copy.subtitle, pad + w * 0.03, ruleY + h * 0.045, {
    size: Math.round(h * 0.0165),
    colour: 'rgba(246,245,235,0.85)',
    spacing: Math.round(h * 0.007)
  });

  vignette(ctx, w, h, 0.5);
}

/* ---------- public entry ---------- */

const RENDERERS = { A: renderTriptych, B: renderQuad, C: renderHero };

export function renderCover(canvas, opts) {
  const variant = normaliseVariant(opts && opts.variant);
  const photos = (opts && opts.photos) || [];
  const defaults = VARIANTS[variant];
  const title = ((opts && opts.title) || defaults.title).toUpperCase();
  const subtitle = ((opts && opts.subtitle) || defaults.subtitle).toUpperCase();
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (!photos.length) {
    ctx.fillStyle = '#150c14';
    ctx.fillRect(0, 0, w, h);
    spaced(ctx, 'ADD PHOTOS TO RENDER', w / 2, h / 2, {
      size: Math.round(h * 0.022),
      colour: 'rgba(255,220,200,0.55)',
      align: 'center',
      spacing: Math.round(h * 0.008)
    });
    ctx.restore();
    return;
  }
  RENDERERS[variant](ctx, w, h, photos, { title, subtitle });
  ctx.restore();
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load ' + src));
    img.src = src;
  });
}

export async function loadSamples() {
  return Promise.all(
    SAMPLE_PHOTOS.map(async (s) => ({ ...s, img: await loadImage(s.src) }))
  );
}
