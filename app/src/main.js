// main.js — the editor: state, controls, preview, drag/keyboard interaction, PNG export.
// Photos never leave the machine: they arrive through FileReader as data URLs.

import {
  LAYOUTS,
  LAYOUT_ORDER,
  GRADES,
  GRADE_ORDER,
  layoutCount,
  defaultCaption,
  renderCover,
  renderToCanvas,
  waitForFonts,
} from './cover.js';
import { initShotMode } from './shots.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');

const EXPORT_SIZES = {
  '1080x1080': { w: 1080, h: 1080, label: 'Square', note: '1080 × 1080' },
  '1080x1350': { w: 1080, h: 1350, label: 'Tall', note: '1080 × 1350' },
  '1920x1080': { w: 1920, h: 1080, label: 'Wide', note: '1920 × 1080' },
};

const SAMPLE_FILES = [
  { key: 'boulevard', src: 'samples/boulevard.png', label: 'Sunset boulevard' },
  { key: 'pier', src: 'samples/pier.png', label: 'Neon pier' },
];

const PREVIEW_LONG = 560;

const state = {
  layout: 'triptych',
  grade: 'sunset',
  size: '1080x1080',
  title: 'VICE COAST',
  subtitle: 'SIX NIGHTS ON THE STRIP',
  caption: defaultCaption('triptych'),
  panels: [],
  activePanel: 0,
  photos: [],
};

const el = {};
let previewCanvas;
let previewCtx;
let previewW = 0;
let previewH = 0;
let drag = null;
const sampleCache = {};

// ---------------------------------------------------------------- boot

export function boot() {
  if (SHOT) {
    // The cover shots own the whole page; the editor shot is the editor with samples preloaded.
    initShotMode(SHOT, params)
      .then((handled) => {
        if (!handled) startEditor({ samples: true });
      })
      .catch((err) => {
        console.error('shot mode failed', err);
        startEditor({ samples: true });
      });
    return;
  }
  startEditor();
}

function startEditor(opts) {
  const withSamples = Boolean(opts && opts.samples);
  previewCanvas = document.getElementById('preview');
  previewCtx = previewCanvas.getContext('2d');

  el.status = document.getElementById('status');
  el.photoInput = document.getElementById('photoInput');
  el.sampleBtn = document.getElementById('sampleBtn');
  el.clearPhotosBtn = document.getElementById('clearPhotosBtn');
  el.photoList = document.getElementById('photoList');
  el.layoutPicker = document.getElementById('layoutPicker');
  el.layoutBlurb = document.getElementById('layoutBlurb');
  el.gradePicker = document.getElementById('gradePicker');
  el.gradeBlurb = document.getElementById('gradeBlurb');
  el.titleInput = document.getElementById('titleInput');
  el.subtitleInput = document.getElementById('subtitleInput');
  el.captionSize = document.getElementById('captionSize');
  el.captionCenterBtn = document.getElementById('captionCenterBtn');
  el.panelLabel = document.getElementById('panelLabel');
  el.zoomRange = document.getElementById('zoomRange');
  el.fitBtn = document.getElementById('fitBtn');
  el.fillBtn = document.getElementById('fillBtn');
  el.resetPanelBtn = document.getElementById('resetPanelBtn');
  el.panelPrev = document.getElementById('panelPrev');
  el.panelNext = document.getElementById('panelNext');
  el.sizePicker = document.getElementById('sizePicker');
  el.exportBtn = document.getElementById('exportBtn');
  el.exportBtn2 = document.getElementById('exportBtn2');
  el.stageSize = document.getElementById('stageSize');

  buildLayoutPicker();
  buildGradePicker();
  buildSizePicker();
  syncPanelArray();
  bindControls();
  bindCanvas();

  resizePreview();
  render();
  wireWindow();

  waitForFonts().then(render);

  // a first cover is nicer than empty frames; the user can clear it in one click
  loadSamples().catch(() => {
    setStatus('Add a photo to start');
  });
}

function setStatus(text) {
  if (el.status) el.status.textContent = text;
}

// ---------------------------------------------------------------- pickers

function makeSegment(parent, id, label, note, onPick, checked) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'radio');
  btn.setAttribute('aria-checked', checked ? 'true' : 'false');
  btn.dataset.value = id;
  btn.innerHTML = `<span class="seg-label"></span><small></small>`;
  btn.querySelector('.seg-label').textContent = label;
  btn.querySelector('small').textContent = note || '';
  btn.addEventListener('click', () => onPick(id));
  parent.appendChild(btn);
  return btn;
}

function selectSegment(parent, id) {
  [...parent.querySelectorAll('[role="radio"]')].forEach((b) => {
    b.setAttribute('aria-checked', b.dataset.value === id ? 'true' : 'false');
    b.tabIndex = b.dataset.value === id ? 0 : -1;
  });
}

function buildLayoutPicker() {
  LAYOUT_ORDER.forEach((key) => {
    const l = LAYOUTS[key];
    makeSegment(
      el.layoutPicker,
      key,
      l.label,
      `${l.count} panel${l.count > 1 ? 's' : ''}`,
      (id) => setLayout(id),
      key === state.layout,
    );
  });
  el.layoutBlurb.textContent = LAYOUTS[state.layout].blurb + '.';
}

function buildGradePicker() {
  GRADE_ORDER.forEach((key) => {
    makeSegment(el.gradePicker, key, GRADES[key].label, '', (id) => setGrade(id), key === state.grade);
  });
  el.gradeBlurb.textContent = GRADES[state.grade].blurb + '.';
}

function buildSizePicker() {
  Object.entries(EXPORT_SIZES).forEach(([key, s]) => {
    makeSegment(el.sizePicker, key, s.label, s.note, (id) => setSize(id), key === state.size);
  });
}

function setLayout(key) {
  if (!LAYOUTS[key] || key === state.layout) return;
  state.layout = key;
  const home = LAYOUTS[key].captionHome;
  state.caption.x = home.x;
  state.caption.y = home.y;
  syncPanelArray();
  selectSegment(el.layoutPicker, key);
  el.layoutBlurb.textContent = LAYOUTS[key].blurb + '.';
  clampActivePanel();
  refreshPanels();
  resizePreview();
  render();
}

function setGrade(key) {
  if (!GRADES[key] || key === state.grade) return;
  state.grade = key;
  selectSegment(el.gradePicker, key);
  el.gradeBlurb.textContent = GRADES[key].blurb + '.';
  render();
}

function setSize(key) {
  if (!EXPORT_SIZES[key]) return;
  state.size = key;
  selectSegment(el.sizePicker, key);
  resizePreview();
  render();
}

// ---------------------------------------------------------------- panels

function syncPanelArray() {
  const n = layoutCount(state.layout);
  while (state.panels.length < n) {
    state.panels.push({ img: null, name: '', zoom: 1, ox: 0, oy: 0, fit: 'fill' });
  }
  state.panels.length = n;
  if (state.activePanel >= n) state.activePanel = n - 1;
}

function activePanel() {
  return state.panels[state.activePanel];
}

function refreshPanels() {
  const p = activePanel();
  if (!p) return;
  el.panelLabel.textContent = `Panel ${state.activePanel + 1} of ${state.panels.length}` +
    (p.name ? ` · ${p.name}` : ' · empty');
  el.zoomRange.value = String(p.zoom);
  el.fitBtn.setAttribute('aria-pressed', p.fit === 'fit' ? 'true' : 'false');
  el.fillBtn.setAttribute('aria-pressed', p.fit === 'fit' ? 'false' : 'true');
  [...el.photoList.querySelectorAll('li')].forEach((li) => {
    li.querySelector('.assign').style.borderColor =
      li.dataset.name === p.name ? 'var(--pink)' : 'transparent';
  });
}

function assignActive(img, name) {
  const p = activePanel();
  p.img = img;
  p.name = name;
  p.zoom = 1;
  p.ox = 0;
  p.oy = 0;
  refreshPanels();
  render();
}

function panelRects(W, H) {
  return (LAYOUTS[state.layout] || LAYOUTS.triptych).rects(W, H);
}

// keep the panned photo covering its panel when in fill mode
function clampPanelOffsets(p, rect) {
  if (!p.img) return;
  const fill = p.fit !== 'fit';
  const base = fill
    ? Math.max(rect.w / p.img.width, rect.h / p.img.height)
    : Math.min(rect.w / p.img.width, rect.h / p.img.height);
  const scale = base * p.zoom;
  const dw = p.img.width * scale;
  const dh = p.img.height * scale;
  if (fill && dw > rect.w) {
    const max = (dw - rect.w) / (2 * rect.w);
    p.ox = Math.max(-max, Math.min(max, p.ox));
  }
  if (fill && dh > rect.h) {
    const max = (dh - rect.h) / (2 * rect.h);
    p.oy = Math.max(-max, Math.min(max, p.oy));
  }
}

function clampActivePanel() {
  const p = activePanel();
  if (!p || !previewW) return;
  const rects = panelRects(previewW, previewH);
  const rect = rects[state.activePanel];
  if (rect) clampPanelOffsets(p, rect);
}

// ---------------------------------------------------------------- photos

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

async function loadSamples() {
  const loaded = [];
  for (const s of SAMPLE_FILES) {
    if (!sampleCache[s.key]) {
      sampleCache[s.key] = await loadImage(s.src);
    }
    loaded.push({ key: s.key, name: s.label, img: sampleCache[s.key] });
  }
  loaded.forEach((p) => {
    if (!state.photos.some((q) => q.key === p.key)) state.photos.push(p);
  });
  state.panels.forEach((panel, i) => {
    const pick = loaded[i % loaded.length];
    if (!panel.img) {
      panel.img = pick.img;
      panel.name = pick.name;
    }
  });
  renderPhotoList();
  refreshPanels();
  setStatus('Sample photos loaded');
  render();
}

function readFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) {
    setStatus('No images in that selection');
    return;
  }
  setStatus(`Reading ${list.length} photo${list.length > 1 ? 's' : ''}…`);

  list.forEach((file, idx) => {
    const reader = new FileReader();
    reader.onload = () => {
      loadImage(String(reader.result))
        .then((img) => {
          const entry = { key: `local-${Date.now()}-${idx}`, name: file.name.replace(/\.[^.]+$/, ''), img };
          state.photos.push(entry);
          renderPhotoList();
          if (idx === 0) assignActive(img, entry.name);
          else if (!activePanel().img) assignActive(img, entry.name);
          setStatus(`${list.length} photo${list.length > 1 ? 's' : ''} ready`);
          render();
        })
        .catch(() => setStatus('Unsupported image file'));
    };
    reader.onerror = () => setStatus('Could not read that file');
    reader.readAsDataURL(file);
  });
}

function renderPhotoList() {
  el.photoList.innerHTML = '';
  state.photos.forEach((p) => {
    const li = document.createElement('li');
    li.dataset.name = p.name;
    const img = document.createElement('img');
    img.src = p.img.src;
    img.alt = p.name;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'assign';
    btn.textContent = 'FILL PANEL';
    btn.title = `Put ${p.name} in panel ${state.activePanel + 1}`;
    btn.addEventListener('click', () => {
      assignActive(p.img, p.name);
      setStatus(`${p.name} → panel ${state.activePanel + 1}`);
    });
    li.append(img, btn);
    el.photoList.appendChild(li);
  });
}

// ---------------------------------------------------------------- preview

function previewDims() {
  const s = EXPORT_SIZES[state.size];
  const k = PREVIEW_LONG / Math.max(s.w, s.h);
  return { w: Math.round(s.w * k), h: Math.round(s.h * k) };
}

function resizePreview() {
  const { w, h } = previewDims();
  if (w === previewW && h === previewH) return;
  previewW = w;
  previewH = h;
  previewCanvas.width = w;
  previewCanvas.height = h;
  const s = EXPORT_SIZES[state.size];
  el.stageSize.textContent = `Preview ${w} × ${h} · exports ${s.note}`;
}

function render() {
  if (!previewCtx) return;
  renderCover(previewCtx, previewW, previewH, state);
}

function pointFromEvent(e) {
  const r = previewCanvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * previewW,
    y: ((e.clientY - r.top) / r.height) * previewH,
  };
}

function captionBox() {
  const b = state.caption.bbox;
  if (!b) return { x: 0.1, y: 0.78, w: 0.8, h: 0.14 };
  return b;
}

function panelAt(x, y) {
  const rects = panelRects(previewW, previewH);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

function bindCanvas() {
  previewCanvas.addEventListener('pointerdown', (e) => {
    const pt = pointFromEvent(e);
    const box = captionBox();
    const inCaption =
      pt.x / previewW >= box.x && pt.x / previewW <= box.x + box.w &&
      pt.y / previewH >= box.y && pt.y / previewH <= box.y + box.h;

    if (e.shiftKey || (inCaption && e.altKey)) {
      drag = { kind: 'caption', dx: pt.x / previewW - state.caption.x, dy: pt.y / previewH - state.caption.y };
      previewCanvas.setPointerCapture(e.pointerId);
      return;
    }

    const idx = panelAt(pt.x, pt.y);
    if (idx >= 0) {
      state.activePanel = idx;
      refreshPanels();
      const p = state.panels[idx];
      drag = { kind: 'panel', idx, sx: pt.x, sy: pt.y, ox: p.ox, oy: p.oy };
      previewCanvas.setPointerCapture(e.pointerId);
      render();
      return;
    }
    if (inCaption) {
      drag = { kind: 'caption', dx: pt.x / previewW - state.caption.x, dy: pt.y / previewH - state.caption.y };
      previewCanvas.setPointerCapture(e.pointerId);
    }
  });

  previewCanvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const pt = pointFromEvent(e);
    if (drag.kind === 'caption') {
      state.caption.x = Math.max(0.05, Math.min(0.95, pt.x / previewW - drag.dx));
      state.caption.y = Math.max(0.06, Math.min(0.94, pt.y / previewH - drag.dy));
    } else {
      const p = state.panels[drag.idx];
      const rects = panelRects(previewW, previewH);
      p.ox = drag.ox + (pt.x - drag.sx) / rects[drag.idx].w;
      p.oy = drag.oy + (pt.y - drag.sy) / rects[drag.idx].h;
      clampPanelOffsets(p, rects[drag.idx]);
    }
    render();
  });

  const endDrag = () => {
    drag = null;
  };
  previewCanvas.addEventListener('pointerup', endDrag);
  previewCanvas.addEventListener('pointercancel', endDrag);

  previewCanvas.addEventListener('dblclick', (e) => {
    const pt = pointFromEvent(e);
    const idx = panelAt(pt.x, pt.y);
    if (idx >= 0) {
      const p = state.panels[idx];
      p.zoom = 1;
      p.ox = 0;
      p.oy = 0;
      state.activePanel = idx;
      refreshPanels();
      render();
    }
  });

  previewCanvas.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.05 : 0.012;
    const p = activePanel();
    if (!p) return;
    let used = true;
    const rects = panelRects(previewW, previewH);
    switch (e.key) {
      case 'ArrowLeft': p.ox -= step; break;
      case 'ArrowRight': p.ox += step; break;
      case 'ArrowUp': p.oy -= step; break;
      case 'ArrowDown': p.oy += step; break;
      default: used = false;
    }
    if (!used) return;
    e.preventDefault();
    clampPanelOffsets(p, rects[state.activePanel]);
    render();
  });
}

// ---------------------------------------------------------------- controls

function bindControls() {
  el.photoInput.addEventListener('change', (e) => {
    readFiles(e.target.files);
    e.target.value = '';
  });

  const fileLabel = document.querySelector('.btn-file');
  if (fileLabel) {
    fileLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.photoInput.click();
      }
    });
  }

  el.sampleBtn.addEventListener('click', () => {
    loadSamples().catch(() => setStatus('Sample photos could not be read'));
  });

  el.clearPhotosBtn.addEventListener('click', () => {
    state.photos = [];
    state.panels.forEach((p) => {
      p.img = null;
      p.name = '';
      p.zoom = 1;
      p.ox = 0;
      p.oy = 0;
    });
    renderPhotoList();
    refreshPanels();
    setStatus('Photos cleared');
    render();
  });

  el.titleInput.addEventListener('input', (e) => {
    state.title = e.target.value;
    render();
  });

  el.subtitleInput.addEventListener('input', (e) => {
    state.subtitle = e.target.value;
    render();
  });

  el.captionSize.addEventListener('input', (e) => {
    state.caption.size = Number(e.target.value);
    render();
  });

  el.captionCenterBtn.addEventListener('click', () => {
    const home = LAYOUTS[state.layout].captionHome;
    state.caption.x = home.x;
    state.caption.y = home.y;
    render();
  });

  el.zoomRange.addEventListener('input', (e) => {
    const p = activePanel();
    if (!p) return;
    p.zoom = Number(e.target.value);
    clampActivePanel();
    render();
  });

  el.fitBtn.addEventListener('click', () => {
    const p = activePanel();
    if (!p) return;
    p.fit = 'fit';
    refreshPanels();
    render();
  });

  el.fillBtn.addEventListener('click', () => {
    const p = activePanel();
    if (!p) return;
    p.fit = 'fill';
    clampActivePanel();
    refreshPanels();
    render();
  });

  el.resetPanelBtn.addEventListener('click', () => {
    const p = activePanel();
    if (!p) return;
    p.zoom = 1;
    p.ox = 0;
    p.oy = 0;
    refreshPanels();
    render();
  });

  el.panelPrev.addEventListener('click', () => stepPanel(-1));
  el.panelNext.addEventListener('click', () => stepPanel(1));

  el.exportBtn.addEventListener('click', exportPng);
  el.exportBtn2.addEventListener('click', exportPng);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      exportPng();
    }
  });
}

function stepPanel(delta) {
  const n = state.panels.length;
  state.activePanel = (state.activePanel + delta + n) % n;
  refreshPanels();
  render();
}

// ---------------------------------------------------------------- export

async function exportPng() {
  const s = EXPORT_SIZES[state.size];
  setStatus('Rendering…');
  try {
    const canvas = renderToCanvas(s.w, s.h, state);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vice-coast-cover-${s.w}x${s.h}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setStatus(`Exported ${s.note}`);
  } catch (err) {
    setStatus('Export failed');
  }
}

// ---------------------------------------------------------------- window

function wireWindow() {
  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      resizePreview();
      render();
    }, 80);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
}

boot();
