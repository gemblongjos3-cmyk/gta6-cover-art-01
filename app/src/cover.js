// cover.js — the cover renderer: layouts, colour grades, caption lettering and export.
// Everything is drawn with the Canvas 2D API from normalized geometry, so the same
// code renders a 540 px live preview and a 1920 px export.

export const DISPLAY_FONT = 'Anton, "Arial Black", "Helvetica Neue", sans-serif';

export const LAYOUT_ORDER = ['triptych', 'quad', 'hero'];
export const GRADE_ORDER = ['sunset', 'neon', 'vice'];

export const GRADES = {
  sunset: {
    label: 'Sunset',
    blurb: 'warm orange-pink wash',
    filter: 'saturate(1.35) contrast(1.07) brightness(1.03)',
  },
  neon: {
    label: 'Neon Night',
    blurb: 'purple-cyan glow',
    filter: 'saturate(1.55) contrast(1.16) brightness(0.92) hue-rotate(-10deg)',
  },
  vice: {
    label: 'Vice Fade',
    blurb: 'teal-orange cinema',
    filter: 'saturate(1.12) contrast(1.14) sepia(0.16) brightness(0.98)',
  },
};

// Each layout returns panel rectangles in pixels plus the caption's home position.
export const LAYOUTS = {
  triptych: {
    label: 'Triptych',
    blurb: 'three vertical panels + title band',
    count: 3,
    band: true,
    rects(W, H) {
      const m = W * 0.028;
      const gap = W * 0.013;
      const bandH = H * 0.245;
      const top = H * 0.022;
      const bottom = H - bandH - H * 0.03;
      const pw = (W - 2 * m - 2 * gap) / 3;
      const ph = bottom - top;
      return [0, 1, 2].map((i) => ({
        x: m + i * (pw + gap),
        y: top,
        w: pw,
        h: ph,
      }));
    },
    captionHome: { x: 0.5, y: 0.878 },
  },
  quad: {
    label: 'Quad Grid',
    blurb: '2 × 2 full-bleed panels',
    count: 4,
    band: false,
    rects(W, H) {
      const m = W * 0.022;
      const gap = W * 0.013;
      const pw = (W - 2 * m - gap) / 2;
      const ph = (H - 2 * m - gap) / 2;
      return [0, 1, 2, 3].map((i) => ({
        x: m + (i % 2) * (pw + gap),
        y: m + Math.floor(i / 2) * (ph + gap),
        w: pw,
        h: ph,
      }));
    },
    captionHome: { x: 0.5, y: 0.855 },
  },
  hero: {
    label: 'Hero + Strip',
    blurb: 'one big panel + two small ones',
    count: 3,
    band: false,
    rects(W, H) {
      const m = W * 0.022;
      const gap = W * 0.013;
      const heroH = H * 0.645;
      const stripY = m + heroH + gap;
      const stripH = H - stripY - m;
      const pw = (W - 2 * m - gap) / 2;
      return [
        { x: m, y: m, w: W - 2 * m, h: heroH },
        { x: m, y: stripY, w: pw, h: stripH },
        { x: m + pw + gap, y: stripY, w: pw, h: stripH },
      ];
    },
    captionHome: { x: 0.34, y: 0.56 },
  },
};

// Three finished looks: A Triptych+Sunset, B Quad Grid+Neon Night, C Hero+Strip+Vice Fade.
// The ?shot= cover modes use these; the editor starts from a plain default.
export const DEFAULT_PRESETS = {
  A: {
    layout: 'triptych',
    grade: 'sunset',
    title: 'VICE COAST',
    subtitle: 'SIX NIGHTS ON THE STRIP',
    captionX: 0.5,
    captionY: 0.878,
    captionSize: 1,
    zooms: [1.08, 1.2, 1.05],
    offsets: [[0, 0.04], [0, -0.02], [0, 0.03]],
  },
  B: {
    layout: 'quad',
    grade: 'neon',
    title: 'NEON PIER',
    subtitle: 'AFTER MIDNIGHT',
    captionX: 0.5,
    captionY: 0.862,
    captionSize: 0.95,
    zooms: [1.12, 1, 1.06, 1.15],
    offsets: [[0, 0.03], [0.02, 0], [-0.02, 0.02], [0, -0.03]],
  },
  C: {
    layout: 'hero',
    grade: 'vice',
    title: 'COAST LINE',
    subtitle: 'THE LONG WAY HOME',
    captionX: 0.33,
    captionY: 0.5,
    captionSize: 0.92,
    zooms: [1.1, 1.02, 1.08],
    offsets: [[0, 0.08], [0, 0], [0.03, 0]],
  },
};

export function layoutCount(layout) {
  return (LAYOUTS[layout] || LAYOUTS.triptych).count;
}

export function defaultCaption(layout) {
  const home = (LAYOUTS[layout] || LAYOUTS.triptych).captionHome;
  return { x: home.x, y: home.y, size: 1, align: 'center' };
}

function fontString(size) {
  return `400 ${size}px ${DISPLAY_FONT}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// ---------------------------------------------------------------- textures

let grainCanvas = null;
let halftoneCanvas = null;

function grainPattern(ctx) {
  if (!grainCanvas) {
    grainCanvas = document.createElement('canvas');
    grainCanvas.width = 160;
    grainCanvas.height = 160;
    const g = grainCanvas.getContext('2d');
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 90 + Math.floor(Math.random() * 130);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  return ctx.createPattern(grainCanvas, 'repeat');
}

function halftonePattern(ctx) {
  if (!halftoneCanvas) {
    halftoneCanvas = document.createElement('canvas');
    halftoneCanvas.width = 14;
    halftoneCanvas.height = 14;
    const g = halftoneCanvas.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(3.5, 3.5, 2.4, 0, Math.PI * 2);
    g.arc(10.5, 10.5, 2.4, 0, Math.PI * 2);
    g.fill();
  }
  return ctx.createPattern(halftoneCanvas, 'repeat');
}

// ---------------------------------------------------------------- grades

function gradeFilter(grade) {
  return (GRADES[grade] || GRADES.sunset).filter;
}

function gradeOverlay(ctx, rect, grade, W) {
  const { x, y, w, h } = rect;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (grade === 'neon') {
    const lg = ctx.createLinearGradient(x, y, x, y + h);
    lg.addColorStop(0, 'rgba(38, 8, 86, 0.72)');
    lg.addColorStop(0.48, 'rgba(120, 16, 128, 0.30)');
    lg.addColorStop(1, 'rgba(0, 176, 200, 0.55)');
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = lg;
    ctx.fillRect(x, y, w, h);

    const glow = ctx.createRadialGradient(x + w * 0.72, y + h * 0.24, 0, x + w * 0.72, y + h * 0.24, w * 0.75);
    glow.addColorStop(0, 'rgba(255, 40, 190, 0.55)');
    glow.addColorStop(0.45, 'rgba(120, 40, 255, 0.16)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);

    const cyan = ctx.createLinearGradient(x, y + h * 0.5, x + w, y + h);
    cyan.addColorStop(0, 'rgba(0, 0, 0, 0)');
    cyan.addColorStop(1, 'rgba(0, 240, 255, 0.28)');
    ctx.fillStyle = cyan;
    ctx.fillRect(x, y, w, h);

    // scanlines
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(8, 4, 24, 0.20)';
    const step = Math.max(3, Math.round(h / 190));
    for (let sy = y; sy < y + h; sy += step * 2) ctx.fillRect(x, sy, w, step * 0.7);
  } else if (grade === 'vice') {
    const cool = ctx.createLinearGradient(x, y, x, y + h);
    cool.addColorStop(0, 'rgba(255, 130, 60, 0.20)');
    cool.addColorStop(0.45, 'rgba(40, 120, 120, 0.10)');
    cool.addColorStop(1, 'rgba(0, 92, 110, 0.62)');
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = cool;
    ctx.fillRect(x, y, w, h);

    const warm = ctx.createRadialGradient(x + w * 0.25, y + h * 0.1, 0, x + w * 0.25, y + h * 0.1, w * 0.9);
    warm.addColorStop(0, 'rgba(255, 150, 70, 0.42)');
    warm.addColorStop(1, 'rgba(255, 150, 70, 0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = warm;
    ctx.fillRect(x, y, w, h);

    const teal = ctx.createLinearGradient(x, y + h * 0.45, x, y + h);
    teal.addColorStop(0, 'rgba(0, 0, 0, 0)');
    teal.addColorStop(1, 'rgba(0, 210, 190, 0.22)');
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = teal;
    ctx.fillRect(x, y, w, h);
  } else {
    const warm = ctx.createLinearGradient(x, y, x, y + h);
    warm.addColorStop(0, 'rgba(255, 108, 64, 0.55)');
    warm.addColorStop(0.45, 'rgba(255, 62, 130, 0.38)');
    warm.addColorStop(1, 'rgba(66, 12, 96, 0.72)');
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = warm;
    ctx.fillRect(x, y, w, h);

    const sun = ctx.createRadialGradient(x + w * 0.78, y + h * 0.18, 0, x + w * 0.78, y + h * 0.18, w * 0.85);
    sun.addColorStop(0, 'rgba(255, 214, 130, 0.55)');
    sun.addColorStop(0.4, 'rgba(255, 120, 90, 0.22)');
    sun.addColorStop(1, 'rgba(255, 80, 120, 0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = sun;
    ctx.fillRect(x, y, w, h);
  }

  // floor shadow keeps the lettering legible
  const floor = ctx.createLinearGradient(x, y + h * 0.55, x, y + h);
  floor.addColorStop(0, 'rgba(10, 0, 25, 0)');
  floor.addColorStop(1, 'rgba(10, 0, 25, 0.55)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = floor;
  ctx.fillRect(x, y, w, h);

  ctx.restore();
}

// ---------------------------------------------------------------- panels

function drawPlaceholder(ctx, rect, index, W) {
  const { x, y, w, h } = rect;
  const lg = ctx.createLinearGradient(x, y, x + w, y + h);
  lg.addColorStop(0, '#241040');
  lg.addColorStop(0.55, '#3c1450');
  lg.addColorStop(1, '#101a3a');
  ctx.fillStyle = lg;
  ctx.fillRect(x, y, w, h);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#ff5fa8';
  ctx.lineWidth = Math.max(1, W * 0.004);
  for (let i = -h; i < w; i += Math.max(10, W * 0.035)) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = fontString(Math.max(11, w * 0.10));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`PANEL ${index + 1}`, x + w / 2, y + h / 2 - w * 0.045);
  ctx.font = fontString(Math.max(8, w * 0.052));
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('ADD A PHOTO', x + w / 2, y + h / 2 + w * 0.06);
  ctx.restore();
}

function drawPanel(ctx, rect, panel, index, grade, W) {
  const { x, y, w, h } = rect;
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.018);
  ctx.clip();

  const img = panel && panel.img;
  if (!img || !img.width) {
    drawPlaceholder(ctx, rect, index, W);
  } else {
    const zoom = panel.zoom || 1;
    const fill = panel.fit !== 'fit';
    const base = fill
      ? Math.max(w / img.width, h / img.height)
      : Math.min(w / img.width, h / img.height);
    const scale = base * zoom;
    const dw = img.width * scale;
    const dh = img.height * scale;
    const cx = x + w / 2 + (panel.ox || 0) * w;
    const cy = y + h / 2 + (panel.oy || 0) * h;

    ctx.filter = gradeFilter(grade);
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.filter = 'none';

    if (!fill) {
      ctx.fillStyle = 'rgba(10, 4, 22, 0.92)';
      ctx.fillRect(x, y, w, h);
      ctx.filter = gradeFilter(grade);
      ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.filter = 'none';
    }

    gradeOverlay(ctx, rect, grade, W);
  }
  ctx.restore();

  // panel frame
  ctx.save();
  roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.018);
  ctx.strokeStyle = 'rgba(255, 245, 250, 0.9)';
  ctx.lineWidth = Math.max(1.2, W * 0.0028);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- effects

function drawHalftone(ctx, W, H, panels, strength) {
  ctx.save();
  const pattern = halftonePattern(ctx);
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = strength;
  ctx.fillStyle = pattern;
  for (const r of panels) ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

function drawGrain(ctx, W, H, strength) {
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = strength;
  ctx.fillStyle = grainPattern(ctx);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.22, W / 2, H * 0.5, Math.max(W, H) * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.62, 'rgba(6,0,18,0.10)');
  g.addColorStop(1, 'rgba(6,0,18,0.62)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawBand(ctx, W, H, layout) {
  if (!layout.band) return;
  const m = W * 0.028;
  const bandH = H * 0.245;
  const y = H - bandH - H * 0.012;
  const x = m;
  const w = W - 2 * m;

  ctx.save();
  roundRect(ctx, x, y, w, bandH, W * 0.012);
  ctx.clip();

  const lg = ctx.createLinearGradient(x, y, x + w, y + bandH);
  lg.addColorStop(0, '#2a0838');
  lg.addColorStop(0.45, '#571052');
  lg.addColorStop(1, '#1a0838');
  ctx.fillStyle = lg;
  ctx.fillRect(x, y, w, bandH);

  // diagonal speed stripes
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ff3d8a';
  for (let i = -bandH; i < w + bandH; i += Math.max(16, W * 0.05)) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + bandH);
    ctx.lineTo(x + i + bandH * 0.55, y + bandH);
    ctx.lineTo(x + i + bandH * 0.55 + bandH, y);
    ctx.lineTo(x + i + bandH, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // thin rules top and bottom
  ctx.fillStyle = 'rgba(255, 214, 140, 0.9)';
  ctx.fillRect(x, y, w, Math.max(1, H * 0.003));
  ctx.fillRect(x, y + bandH - Math.max(1, H * 0.003), w, Math.max(1, H * 0.003));
  ctx.restore();
}

// ---------------------------------------------------------------- caption

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
}

function drawCaption(ctx, W, H, state) {
  const cap = state.caption || defaultCaption(state.layout);
  const scale = cap.size || 1;
  const title = (state.title || '').trim();
  const subtitle = (state.subtitle || '').trim();
  const maxW = W * 0.9;
  const cx = cap.x * W;
  const cy = cap.y * H;

  let titleSize = Math.min(W * 0.145, H * 0.18) * scale;
  if (title) {
    ctx.save();
    ctx.font = fontString(titleSize);
    setSpacing(ctx, titleSize * 0.01);
    const tw = ctx.measureText(title.toUpperCase()).width;
    if (tw > maxW) titleSize *= maxW / tw;
    ctx.restore();
  }
  const subSize = Math.max(W * 0.018, titleSize * 0.235);
  const blockH = (title ? titleSize * 0.95 : 0) + (subtitle ? subSize * 1.6 : 0);
  const top = cy - blockH / 2;

  const warm = state.grade === 'sunset';
  const fillTop = warm ? '#fff6e6' : '#f4f9ff';
  const fillBottom = warm ? '#ffd9a8' : '#bfe9ff';

  if (title) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = fontString(titleSize);
    setSpacing(ctx, titleSize * 0.01);
    const text = title.toUpperCase();
    const baseY = top + titleSize * 0.82;

    // deep drop shadow
    ctx.fillStyle = 'rgba(20, 0, 40, 0.55)';
    ctx.fillText(text, cx + titleSize * 0.055, baseY + titleSize * 0.075);

    // neon echo
    ctx.fillStyle = state.grade === 'neon' ? 'rgba(0, 240, 255, 0.85)' : 'rgba(255, 45, 140, 0.9)';
    ctx.fillText(text, cx + titleSize * 0.03, baseY + titleSize * 0.04);

    // outline
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = '#12031f';
    ctx.lineWidth = Math.max(2, titleSize * 0.115);
    ctx.strokeText(text, cx, baseY);

    const g = ctx.createLinearGradient(0, baseY - titleSize * 0.8, 0, baseY);
    g.addColorStop(0, fillTop);
    g.addColorStop(0.55, fillTop);
    g.addColorStop(1, fillBottom);
    ctx.fillStyle = g;
    ctx.fillText(text, cx, baseY);
    ctx.restore();
  }

  if (subtitle) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fontString(subSize);
    setSpacing(ctx, subSize * 0.16);
    const subY = top + (title ? titleSize * 0.95 : 0) + subSize * 0.8;
    const text = subtitle.toUpperCase();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(12, 2, 24, 0.85)';
    ctx.lineWidth = Math.max(1.5, subSize * 0.16);
    ctx.strokeText(text, cx, subY);
    ctx.fillStyle = '#ffe9c9';
    ctx.fillText(text, cx, subY);
    ctx.restore();
  }

  cap.bbox = {
    x: (cx - maxW / 2) / W,
    y: (top - blockH * 0.1) / H,
    w: maxW / W,
    h: (blockH * 1.2) / H,
  };
}

// ---------------------------------------------------------------- main render

export function renderCover(ctx, W, H, state) {
  const layout = LAYOUTS[state.layout] || LAYOUTS.triptych;
  const panels = layout.rects(W, H);
  const grade = GRADES[state.grade] ? state.grade : 'sunset';

  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c0518';
  ctx.fillRect(0, 0, W, H);

  panels.forEach((rect, i) => {
    drawPanel(ctx, rect, (state.panels || [])[i], i, grade, W);
  });

  // a soft global wash ties the panels together
  const wash = ctx.createLinearGradient(0, 0, W, H);
  if (grade === 'neon') {
    wash.addColorStop(0, 'rgba(120, 20, 190, 0.18)');
    wash.addColorStop(1, 'rgba(0, 190, 220, 0.12)');
  } else if (grade === 'vice') {
    wash.addColorStop(0, 'rgba(255, 130, 60, 0.10)');
    wash.addColorStop(1, 'rgba(0, 120, 140, 0.16)');
  } else {
    wash.addColorStop(0, 'rgba(255, 120, 60, 0.14)');
    wash.addColorStop(1, 'rgba(110, 20, 150, 0.16)');
  }
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  drawHalftone(ctx, W, H, panels, 0.085);
  drawBand(ctx, W, H, layout);
  drawVignette(ctx, W, H);
  drawGrain(ctx, W, H, 0.07);
  drawCaption(ctx, W, H, state);

  // bottom-right maker's mark, original mark only
  ctx.save();
  ctx.font = fontString(Math.max(8, W * 0.013));
  setSpacing(ctx, W * 0.003);
  ctx.fillStyle = 'rgba(255, 236, 214, 0.55)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('VICE COAST STUDIO', W - W * 0.03, H - H * 0.012);
  ctx.restore();

  ctx.restore();
}

// Convenience for exports and shot modes: render to a fresh canvas at an exact size.
export function renderToCanvas(W, H, state) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  renderCover(ctx, W, H, state);
  return canvas;
}

export async function waitForFonts() {
  if (document.fonts && document.fonts.ready) {
    try {
      await document.fonts.load(`400 64px Anton`);
      await document.fonts.ready;
    } catch (err) {
      // font loading is best effort; the fallback stack still renders
    }
  }
}
