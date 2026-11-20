// shots.js — the ?shot= modes used for screenshots (and harmless elsewhere).
//   ?shot=editor        the real editor, sample photos already in the panels
//   ?shot=cover-square  finished cover, 1024 x 1024
//   ?shot=cover-tall    finished cover, 864 x 1080
//   ?shot=cover-wide    finished cover, 1280 x 720
// An optional &variant=b|c overrides the preset cover.

import { renderCover, waitForFonts, DEFAULT_PRESETS } from './cover.js';

export const COVER_SHOTS = ['cover-square', 'cover-tall', 'cover-wide'];

const COVER_SPECS = {
  'cover-square': { w: 1024, h: 1024, preset: 'A' },
  'cover-tall': { w: 864, h: 1080, preset: 'B' },
  'cover-wide': { w: 1280, h: 720, preset: 'C' },
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

// Returns true when this shot is a finished-cover render; the editor handles the rest.
export async function initShotMode(shot, params) {
  const spec = COVER_SPECS[shot];
  if (!spec) return false;
  await renderCoverShot(shot, spec, params);
  return true;
}

async function renderCoverShot(shot, spec, params) {
  const overlay = document.createElement('div');
  overlay.className = 'shot-stage';
  const canvas = document.createElement('canvas');
  canvas.width = spec.w;
  canvas.height = spec.h;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Exported cover art');
  overlay.appendChild(canvas);
  document.body.innerHTML = '';
  document.body.classList.add('shot-mode');
  document.body.appendChild(overlay);

  const presetName = (params.get('variant') || spec.preset).toUpperCase();
  const preset = DEFAULT_PRESETS[presetName] || DEFAULT_PRESETS.A;
  const state = {
    layout: preset.layout,
    grade: preset.grade,
    title: preset.title,
    subtitle: preset.subtitle,
    caption: { x: preset.captionX, y: preset.captionY, size: preset.captionSize, align: 'center' },
    panels: [],
  };

  const [first, second] = await Promise.all([
    loadImage('samples/boulevard.png').catch(() => null),
    loadImage('samples/pier.png').catch(() => null),
  ]);
  const pool = [first, second].filter(Boolean);
  const count = { triptych: 3, quad: 4, hero: 3 }[preset.layout] || 3;
  state.panels = Array.from({ length: count }, (_, i) => ({
    img: pool[i % Math.max(1, pool.length)] || null,
    zoom: preset.zooms ? preset.zooms[i % preset.zooms.length] : 1,
    ox: preset.offsets ? preset.offsets[i % preset.offsets.length][0] : 0,
    oy: preset.offsets ? preset.offsets[i % preset.offsets.length][1] : 0,
    fit: 'fill',
  }));

  await waitForFonts();
  const ctx = canvas.getContext('2d');
  renderCover(ctx, spec.w, spec.h, state);
  document.documentElement.dataset.shotReady = shot;
}
