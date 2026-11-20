// Editor wiring: uploads, samples, variant switching, live preview, export.

import { renderCover, loadImage, loadSamples, SAMPLE_PHOTOS } from './cover.js';
import { VARIANTS, VARIANT_IDS, readShot } from './shots.js';

const EXPORTS = [
  { id: 'square', label: 'Square', width: 1024, height: 1024 },
  { id: 'tall', label: 'Tall', width: 864, height: 1080 },
  { id: 'wide', label: 'Wide', width: 1280, height: 720 }
];

const state = {
  variant: 'A',
  title: VARIANTS.A.title,
  subtitle: VARIANTS.A.subtitle,
  photos: [],
  exportId: 'square',
  busy: false
};

const el = {};

function pick(id) {
  return document.getElementById(id);
}

/* ---------- photo list ---------- */

function addPhoto(name, img) {
  state.photos.push({ name, img });
  if (state.photos.length > 8) state.photos.shift();
  renderPhotoList();
  drawPreview();
}

function removePhoto(index) {
  state.photos.splice(index, 1);
  renderPhotoList();
  drawPreview();
}

function renderPhotoList() {
  el.thumbs.innerHTML = '';
  if (!state.photos.length) {
    const empty = document.createElement('p');
    empty.className = 'thumbs-empty';
    empty.textContent = 'No photos yet — drop files above or open a sample.';
    el.thumbs.append(empty);
  }
  state.photos.forEach((photo, index) => {
    const card = document.createElement('div');
    card.className = 'thumb';
    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 72;
    const c = canvas.getContext('2d');
    const iw = photo.img.naturalWidth;
    const ih = photo.img.naturalHeight;
    const s = Math.max(72 / iw, 72 / ih);
    c.drawImage(photo.img, (72 - iw * s) / 2, (72 - ih * s) / 2, iw * s, ih * s);
    const name = document.createElement('span');
    name.textContent = photo.name;
    const kill = document.createElement('button');
    kill.type = 'button';
    kill.className = 'thumb-x';
    kill.textContent = '×';
    kill.title = 'Remove ' + photo.name;
    kill.addEventListener('click', () => removePhoto(index));
    card.append(canvas, name, kill);
    el.thumbs.append(card);
  });
  el.count.textContent = String(state.photos.length);
}

/* ---------- preview ---------- */

function drawPreview() {
  renderCover(el.preview, {
    variant: state.variant,
    photos: state.photos.map((p) => p.img),
    title: state.title,
    subtitle: state.subtitle
  });
  el.preview.dataset.variant = state.variant;
}

function syncVariantButtons() {
  for (const id of VARIANT_IDS) {
    const button = el.variants.querySelector(`[data-variant="${id}"]`);
    if (button) button.classList.toggle('is-active', id === state.variant);
  }
  el.variantName.textContent = VARIANTS[state.variant].name;
}

/* ---------- events ---------- */

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  for (const file of files) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      addPhoto(file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 22), img);
    } catch (err) {
      // unreadable file: skip quietly, the strip just does not grow
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
}

function wire() {
  el.input.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  const drop = el.drop;
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
    });
  }
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });
  drop.addEventListener('click', () => el.input.click());

  el.samples.addEventListener('click', async () => {
    const samples = await loadSamples();
    for (const s of samples) addPhoto(s.label, s.img);
  });

  el.variants.addEventListener('click', (e) => {
    const button = e.target.closest('[data-variant]');
    if (!button) return;
    const id = button.dataset.variant;
    state.variant = id;
    state.title = VARIANTS[id].title;
    state.subtitle = VARIANTS[id].subtitle;
    el.title.value = state.title;
    el.subtitle.value = state.subtitle;
    syncVariantButtons();
    drawPreview();
  });

  el.title.addEventListener('input', () => {
    state.title = el.title.value.trim() || VARIANTS[state.variant].title;
    drawPreview();
  });
  el.subtitle.addEventListener('input', () => {
    state.subtitle = el.subtitle.value.trim() || VARIANTS[state.variant].subtitle;
    drawPreview();
  });

  el.sizes.addEventListener('click', (e) => {
    const button = e.target.closest('[data-export]');
    if (!button) return;
    state.exportId = button.dataset.export;
    for (const b of el.sizes.querySelectorAll('[data-export]')) {
      b.classList.toggle('is-active', b === button);
    }
  });

  el.export.addEventListener('click', doExport);

  el.shared.addEventListener('click', async () => {
    const text = `${state.title} — ${state.subtitle}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Caption copied');
    } catch (err) {
      toast(text);
    }
  });
}

function toast(message) {
  el.status.textContent = message;
  el.status.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.status.classList.remove('is-on'), 1800);
}

/* ---------- export ---------- */

async function doExport() {
  if (!state.photos.length) {
    toast('Add a photo first');
    return;
  }
  if (state.busy) return;
  state.busy = true;
  el.export.disabled = true;
  const size = EXPORTS.find((e) => e.id === state.exportId) || EXPORTS[0];
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    renderCover(canvas, {
      variant: state.variant,
      photos: state.photos.map((p) => p.img),
      title: state.title,
      subtitle: state.subtitle
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('encode failed');
    const slug = state.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = `${slug || 'cover'}-${size.width}x${size.height}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    el.last.textContent = `${name} · ${(blob.size / 1024).toFixed(0)} KiB`;
    toast('Exported ' + name);
  } catch (err) {
    toast('Export failed');
  } finally {
    state.busy = false;
    el.export.disabled = false;
  }
}

/* ---------- shot mode ---------- */

async function runShot(shot) {
  document.body.classList.add('shot-mode');
  const holder = document.createElement('div');
  holder.className = 'shot-holder';
  const canvas = document.createElement('canvas');
  canvas.width = shot.width;
  canvas.height = shot.height;
  canvas.id = 'shot-canvas';
  holder.append(canvas);
  document.body.append(holder);

  const samples = await loadSamples();
  // Repeat the two samples so every layout gets a full set of panels.
  const pool = [];
  const needed = Math.max(4, VARIANTS[shot.variant].photos);
  for (let i = 0; i < needed; i += 1) pool.push(samples[i % samples.length].img);

  renderCover(canvas, {
    variant: shot.variant,
    photos: pool,
    title: shot.title,
    subtitle: shot.subtitle
  });

  // Two frames plus a zero-delay task: fonts settled, paint flushed.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 120));
  document.documentElement.setAttribute(
    'data-shot-ready',
    `${shot.shot}|${shot.variant}|${shot.width}x${shot.height}`
  );
}

/* ---------- boot ---------- */

function boot() {
  const shot = readShot(window.location.search);
  if (shot) {
    document.title = `Vice Coast Cover Studio — ${shot.shot} ${shot.variant}`;
    runShot(shot).catch((err) => {
      document.documentElement.setAttribute('data-shot-error', String(err && err.message));
    });
    return;
  }

  el.preview = pick('preview');
  el.thumbs = pick('thumbs');
  el.count = pick('count');
  el.drop = pick('drop');
  el.input = pick('file');
  el.samples = pick('samples');
  el.variants = pick('variants');
  el.variantName = pick('variant-name');
  el.title = pick('title');
  el.subtitle = pick('subtitle');
  el.sizes = pick('sizes');
  el.export = pick('export');
  el.last = pick('last');
  el.status = pick('status');
  el.shared = pick('share-text');

  el.preview.width = 768;
  el.preview.height = 768;
  el.title.value = state.title;
  el.subtitle.value = state.subtitle;

  wire();
  syncVariantButtons();
  renderPhotoList();
  drawPreview();
  document.documentElement.setAttribute('data-app-ready', 'editor');

  // ?samples=1 fills the editor with both built-in photos and then signals
  // readiness, so the editor capture has real content without a click.
  const wantsSamples = new URLSearchParams(window.location.search).get('samples');
  if (wantsSamples === '1' || wantsSamples === 'true') {
    loadSamples().then((samples) => {
      for (const s of samples) addPhoto(s.label, s.img);
      document.documentElement.setAttribute('data-shot-ready', 'editor');
    });
  }
}

boot();
