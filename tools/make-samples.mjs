#!/usr/bin/env node
// make-samples.mjs — generates the two sample photos shipped with the app:
//   app/samples/boulevard.png  a sunset boulevard
//   app/samples/pier.png       a neon pier at night
// Both are drawn procedurally (no third-party images) with a tiny software
// rasteriser and written with a minimal PNG encoder built on node:zlib.
//
//   node tools/make-samples.mjs [outDir]

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] || join(HERE, '..', 'app', 'samples'));
const SS = 2; // supersampling factor

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ canvas

function createCanvas(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

function blend(cv, x, y, r, g, b, a = 1) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h || a <= 0) return;
  const i = (y * cv.w + x) * 4;
  const d = cv.data;
  if (a >= 1) {
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    return;
  }
  d[i] = d[i] + (r - d[i]) * a;
  d[i + 1] = d[i + 1] + (g - d[i + 1]) * a;
  d[i + 2] = d[i + 2] + (b - d[i + 2]) * a;
  d[i + 3] = 255;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// vertical multi-stop gradient
function vGradient(cv, stops) {
  for (let y = 0; y < cv.h; y++) {
    const t = y / (cv.h - 1);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].at && t <= stops[i + 1].at) {
        a = stops[i];
        b = stops[i + 1];
        break;
      }
    }
    const k = b.at === a.at ? 0 : (t - a.at) / (b.at - a.at);
    const c = mixColor(a.c, b.c, clamp(k, 0, 1));
    for (let x = 0; x < cv.w; x++) blend(cv, x, y, c[0], c[1], c[2], 1);
  }
}

function fillRect(cv, x0, y0, w, h, c, a = 1) {
  const x1 = Math.round(x0 + w);
  const y1 = Math.round(y0 + h);
  for (let y = Math.round(y0); y < y1; y++) {
    for (let x = Math.round(x0); x < x1; x++) blend(cv, x, y, c[0], c[1], c[2], a);
  }
}

function radialGlow(cv, cx, cy, radius, c, strength, falloff = 2) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(cv.w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(cv.h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d > 1) continue;
      const a = Math.pow(1 - d, falloff) * strength;
      blend(cv, x, y, c[0], c[1], c[2], a);
    }
  }
}

// disc with its own two-stop colour ramp
function disc(cv, cx, cy, radius, inner, outer) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(cv.w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(cv.h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius;
      if (d > 1) continue;
      const c = mixColor(inner, outer, Math.pow(d, 0.8));
      blend(cv, x, y, c[0], c[1], c[2], 1);
    }
  }
}

function polygon(cv, pts, c, a = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(cv.h - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      if ((p1[1] <= y && p2[1] > y) || (p2[1] <= y && p1[1] > y)) {
        xs.push(p1[0] + ((y - p1[1]) / (p2[1] - p1[1])) * (p2[0] - p1[0]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.round(xs[i]));
      const xb = Math.min(cv.w - 1, Math.round(xs[i + 1]));
      for (let x = xa; x <= xb; x++) blend(cv, x, y, c[0], c[1], c[2], a);
    }
  }
}

// tapered stroke along a quadratic bezier — palms, cables, railing
function stroke(cv, p0, p1, p2, width0, width1, c, a = 1) {
  const steps = Math.ceil(Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) * 1.6) + 8;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const mt = 1 - t;
    const x = mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0];
    const y = mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1];
    const r = lerp(width0, width1, t) / 2;
    const x0 = Math.floor(x - r);
    const x1 = Math.ceil(x + r);
    const y0 = Math.floor(y - r);
    const y1 = Math.ceil(y + r);
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        if (Math.hypot(xx - x, yy - y) <= r) blend(cv, xx, yy, c[0], c[1], c[2], a);
      }
    }
  }
}

// box downsample from the supersampled canvas
function downsample(src, factor) {
  const w = src.w / factor;
  const h = src.h / factor;
  const out = new Uint8Array(w * h * 4);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * src.w + (x * factor + dx)) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2];
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { w, h, data: out };
}

// deterministic pseudo-random so reruns match
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------ boulevard

function drawBoulevard(W, H) {
  const cv = createCanvas(W * SS, H * SS);
  const S = SS;
  const horizon = H * 0.545 * S;
  const rand = rng(20261120);

  vGradient(cv, [
    { at: 0, c: [18, 8, 46] },
    { at: 0.24, c: [64, 20, 92] },
    { at: 0.42, c: [168, 44, 110] },
    { at: 0.52, c: [255, 106, 74] },
    { at: 0.6, c: [255, 176, 96] },
    { at: 1, c: [120, 46, 74] },
  ]);

  // the sun, low over the road
  const sunX = W * 0.63 * S;
  const sunY = horizon - H * 0.055 * S;
  const sunR = H * 0.19 * S;
  radialGlow(cv, sunX, sunY, sunR * 2.6, [255, 170, 110], 0.5, 2.4);
  disc(cv, sunX, sunY, sunR, [255, 246, 196], [255, 128, 74]);
  // retro bands across the lower half of the sun
  for (let i = 0; i < 7; i++) {
    const y = sunY + sunR * (0.08 + i * 0.135);
    const gap = 2.2 * S + i * 1.1 * S;
    const halfW = Math.sqrt(Math.max(0, sunR * sunR - Math.pow(y - sunY, 2)));
    fillRect(cv, sunX - halfW, y, halfW * 2, gap, [190, 60, 96], 0.85);
  }

  // haze band at the horizon
  for (let y = horizon - H * 0.07 * S; y < horizon + H * 0.01 * S; y++) {
    const t = clamp((y - (horizon - H * 0.07 * S)) / (H * 0.08 * S), 0, 1);
    for (let x = 0; x < cv.w; x++) blend(cv, x, y, 255, 168, 120, t * 0.28);
  }

  // distant ridge line
  const ridge = [];
  for (let x = 0; x <= cv.w; x += 6 * S) {
    const y = horizon - (26 + Math.sin(x / (90 * S)) * 16 + Math.sin(x / (37 * S) + 1.4) * 9) * S;
    ridge.push([x, y]);
  }
  polygon(cv, [[0, cv.h], ...ridge, [cv.w, cv.h]], [78, 26, 74], 0.9);

  // sidewalk band below the buildings
  fillRect(cv, 0, horizon, cv.w, cv.h - horizon, [56, 26, 60], 1);

  // road: perspective trapezoid running to the vanishing point
  const vpX = W * 0.56 * S;
  const roadTopHalf = W * 0.035 * S;
  const roadBotHalf = W * 0.44 * S;
  polygon(
    cv,
    [
      [vpX - roadTopHalf, horizon],
      [vpX + roadTopHalf, horizon],
      [vpX + roadBotHalf, cv.h],
      [vpX - roadBotHalf, cv.h],
    ],
    [38, 20, 44],
  );
  // kerbs: a narrow bright lip either side
  polygon(
    cv,
    [
      [vpX - roadTopHalf - W * 0.008 * S, horizon],
      [vpX - roadTopHalf, horizon],
      [vpX - roadBotHalf, cv.h],
      [vpX - roadBotHalf - W * 0.028 * S, cv.h],
    ],
    [104, 56, 90],
  );
  polygon(
    cv,
    [
      [vpX + roadTopHalf, horizon],
      [vpX + roadTopHalf + W * 0.008 * S, horizon],
      [vpX + roadBotHalf + W * 0.028 * S, cv.h],
      [vpX + roadBotHalf, cv.h],
    ],
    [104, 56, 90],
  );

  // lane dashes receding toward the vanishing point
  for (let i = 0; i < 9; i++) {
    const t0 = Math.pow(i / 9, 1.9);
    const t1 = Math.pow((i + 0.45) / 9, 1.9);
    const y0 = lerp(horizon, cv.h, t0);
    const y1 = lerp(horizon, cv.h, t1);
    const hw0 = lerp(roadTopHalf * 0.1, W * 0.012 * S, t0);
    const hw1 = lerp(roadTopHalf * 0.1, W * 0.012 * S, t1);
    polygon(
      cv,
      [
        [vpX - hw0, y0],
        [vpX + hw0, y0],
        [vpX + hw1, y1],
        [vpX - hw1, y1],
      ],
      [255, 214, 150],
      0.85,
    );
  }
  // wet sheen down the middle
  for (let y = horizon; y < cv.h; y += 2) {
    const t = (y - horizon) / (cv.h - horizon);
    const halfW = lerp(roadTopHalf, roadBotHalf, t) * 0.22;
    blend(cv, Math.round(vpX), y, 255, 150, 120, 0.05 + t * 0.05);
    for (let x = Math.round(vpX - halfW); x <= vpX + halfW; x++) {
      blend(cv, x, y, 255, 170, 140, 0.04 + t * 0.05);
    }
  }

  // buildings: a far, hazy layer and a near, darker wall of blocks with real gaps
  const windowGrid = (x, w, top, base, tone, litChance, depth) => {
    // face
    polygon(
      cv,
      [
        [x, base],
        [x + w * 0.04, top],
        [x + w, top - w * 0.03],
        [x + w, base],
      ],
      tone,
    );
    // side face, slightly darker, sells the depth
    polygon(
      cv,
      [
        [x + w, base],
        [x + w, top - w * 0.03],
        [x + w + w * 0.1, top - w * 0.06],
        [x + w + w * 0.1, base],
      ],
      [tone[0] * 0.72, tone[1] * 0.72, tone[2] * 0.8],
    );
    const cols = Math.max(2, Math.floor(w / (18 * S)));
    const rows = Math.max(3, Math.floor((base - top) / (24 * S)));
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rand() > litChance) continue;
        const fx = 0.08 + (0.84 * (c + 0.5)) / cols;
        const wx = x + w * fx;
        const wy = top + (base - top) * (0.1 + (0.82 * (r + 0.5)) / rows) - w * 0.03 * fx;
        const warm = rand() > 0.28;
        fillRect(
          cv,
          wx,
          wy,
          Math.max(1.1 * S, w * 0.032),
          Math.max(1.4 * S, (base - top) * 0.016),
          warm ? [255, 196, 122] : [128, 220, 232],
          (0.35 + rand() * 0.5) * depth,
        );
      }
    }
  };

  // far layer: pale, hazy towers just above the ridge
  for (let i = 0; i < 16; i++) {
    const w = W * (0.05 + rand() * 0.05) * S;
    const x = rand() * cv.w;
    const hgt = H * (0.05 + rand() * 0.11) * S;
    windowGrid(x, w, horizon - hgt, horizon + H * 0.01 * S, [72, 30, 86], 0.3, 0.55);
  }

  // near wall, left side
  let x = -W * 0.04 * S;
  for (let i = 0; i < 6; i++) {
    const w = W * (0.15 + rand() * 0.07) * S;
    const hgt = H * (0.1 + rand() * 0.13) * S;
    windowGrid(x, w, horizon - hgt, horizon + H * 0.1 * S, [44, 19, 54], 0.5, 1);
    x += w + W * (0.012 + rand() * 0.03) * S;
  }
  // near wall, right side
  x = cv.w + W * 0.03 * S;
  for (let i = 0; i < 6; i++) {
    const w = W * (0.16 + rand() * 0.07) * S;
    const hgt = H * (0.09 + rand() * 0.14) * S;
    x -= w;
    windowGrid(x, w, horizon - hgt, horizon + H * 0.11 * S, [40, 17, 50], 0.5, 1);
    x -= W * (0.012 + rand() * 0.03) * S;
  }

  // palms: silhouettes at the edges
  const INK = [26, 9, 32];
  const palm = (bx, by, height, lean, seed) => {
    const r2 = rng(seed);
    const tipX = bx + lean;
    const tipY = by - height;
    // trunk: curved, with a slight flare at the base
    stroke(cv, [bx, by], [bx + lean * 0.2, by - height * 0.5], [tipX, tipY], 22 * S, 7 * S, INK);
    stroke(cv, [bx + 12 * S, by], [bx + lean * 0.2 + 9 * S, by - height * 0.5], [tipX + 3 * S, tipY], 8 * S, 2 * S, INK);

    const fronds = 12;
    for (let i = 0; i < fronds; i++) {
      const t = i / (fronds - 1);
      // sweep from left-up, over the top, to right-down
      const ang = -Math.PI * 1.02 + t * Math.PI * 2.04 + (r2() - 0.5) * 0.12;
      const len = height * (0.30 + r2() * 0.17);
      // a frond is an arc that starts up then droops: control point above the chord
      const endX = tipX + Math.cos(ang) * len;
      const endY = tipY + Math.sin(ang) * len * 0.72 + len * 0.22;
      const midX = tipX + Math.cos(ang) * len * 0.52;
      const midY = tipY + Math.sin(ang) * len * 0.52 - len * 0.30;
      stroke(cv, [tipX, tipY], [midX, midY], [endX, endY], 9 * S, 1.6 * S, INK);

      // leaflets hanging off the spine, short and heavy so the crown reads as foliage
      const leafN = 11;
      for (let k = 1; k <= leafN; k++) {
        const u = k / (leafN + 1);
        const mu = 1 - u;
        const px = mu * mu * tipX + 2 * mu * u * midX + u * u * endX;
        const py = mu * mu * tipY + 2 * mu * u * midY + u * u * endY;
        const leafLen = len * (0.17 - 0.09 * u) * (0.75 + r2() * 0.5);
        const side = k % 2 ? 1 : -1;
        const la = ang + (side * Math.PI) / 2.05;
        const lx = px + Math.cos(la) * leafLen;
        const ly = py + Math.sin(la) * leafLen * 0.55 + leafLen * 0.9;
        stroke(cv, [px, py], [lerp(px, lx, 0.65), lerp(py, ly, 0.35) + leafLen * 0.25], [lx, ly], 6.5 * S, 1.6 * S, INK);
      }
    }
    // coconut cluster
    for (let i = 0; i < 3; i++) {
      disc(cv, tipX + (r2() - 0.5) * 16 * S, tipY + (6 + r2() * 8) * S, 5 * S, INK, INK);
    }
  };
  palm(W * 0.075 * S, cv.h * 1.04, H * 0.88 * S, -W * 0.015 * S, 11);
  palm(W * 0.19 * S, cv.h * 1.06, H * 0.62 * S, W * 0.025 * S, 22);
  palm(W * 0.955 * S, cv.h * 1.05, H * 0.95 * S, W * 0.012 * S, 33);

  // a couple of distant cars with headlight glows
  const car = (cx, cy, s, colour) => {
    polygon(
      cv,
      [
        [cx - 34 * s, cy],
        [cx - 30 * s, cy - 15 * s],
        [cx - 12 * s, cy - 24 * s],
        [cx + 14 * s, cy - 24 * s],
        [cx + 30 * s, cy - 14 * s],
        [cx + 34 * s, cy],
      ],
      colour,
    );
    radialGlow(cv, cx + 32 * s, cy - 6 * s, 22 * s, [255, 226, 170], 0.55, 1.6);
    radialGlow(cv, cx - 32 * s, cy - 6 * s, 16 * s, [255, 90, 120], 0.4, 1.6);
  };
  car(W * 0.44 * S, horizon + H * 0.30 * S, 1.5 * S, [32, 12, 36]);
  car(W * 0.68 * S, horizon + H * 0.12 * S, 0.85 * S, [34, 12, 38]);
  car(W * 0.30 * S, horizon + H * 0.10 * S, 0.6 * S, [34, 14, 40]);

  // film grain
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const n = (rand() - 0.5) * 9;
      const i = (y * cv.w + x) * 4;
      cv.data[i] = clamp(cv.data[i] + n, 0, 255);
      cv.data[i + 1] = clamp(cv.data[i + 1] + n, 0, 255);
      cv.data[i + 2] = clamp(cv.data[i + 2] + n, 0, 255);
    }
  }

  // warm corner vignette
  const w = cv.w;
  const h = cv.h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - w / 2) / (w * 0.62), (y - h / 2) / (h * 0.62));
      if (d > 0.72) blend(cv, x, y, 28, 6, 30, (d - 0.72) * 0.85);
    }
  }
  return cv;
}

// ------------------------------------------------------------------ pier

function drawPier(W, H) {
  const cv = createCanvas(W * SS, H * SS);
  const S = SS;
  const rand = rng(70707);
  const horizon = H * 0.56 * S;

  vGradient(cv, [
    { at: 0, c: [4, 2, 16] },
    { at: 0.22, c: [18, 8, 46] },
    { at: 0.44, c: [58, 16, 92] },
    { at: 0.56, c: [122, 34, 120] },
    { at: 0.63, c: [66, 22, 90] },
    { at: 1, c: [10, 6, 28] },
  ]);

  // stars
  for (let i = 0; i < 260; i++) {
    const x = rand() * cv.w;
    const y = rand() * horizon * 0.85;
    const a = 0.12 + rand() * 0.7 * (1 - y / (horizon * 0.9));
    const r = rand() > 0.94 ? 2 * S : 1 * S;
    disc(cv, x, y, r, [255, 250, 235], [220, 220, 255]);
    blend(cv, Math.round(x), Math.round(y), 255, 255, 255, a);
  }

  // moon with a soft halo
  const moonX = W * 0.79 * S;
  const moonY = H * 0.17 * S;
  radialGlow(cv, moonX, moonY, H * 0.2 * S, [180, 190, 255], 0.3, 2.6);
  disc(cv, moonX, moonY, H * 0.045 * S, [255, 252, 236], [220, 226, 250]);

  // far shore: a low skyline across the horizon
  const shore = [];
  for (let x = 0; x <= cv.w; x += 4 * S) {
    const n = Math.sin(x / (70 * S)) * 0.5 + Math.sin(x / (23 * S) + 2) * 0.5;
    shore.push([x, horizon - (10 + n * 8) * S]);
  }
  polygon(cv, [[0, cv.h], ...shore, [cv.w, cv.h]], [26, 12, 48], 1);
  for (let i = 0; i < 90; i++) {
    const x = rand() * cv.w;
    const y = horizon - rand() * 22 * S;
    fillRect(cv, x, y, 2 * S, 2 * S, rand() > 0.4 ? [255, 200, 140] : [120, 230, 240], 0.5 + rand() * 0.5);
  }

  // water
  for (let y = horizon; y < cv.h; y++) {
    const t = (y - horizon) / (cv.h - horizon);
    const base = mixColor([70, 24, 96], [12, 6, 32], Math.pow(t, 0.6));
    for (let x = 0; x < cv.w; x++) blend(cv, x, y, base[0], base[1], base[2], 1);
  }
  // moon path + neon reflections as broken horizontal strokes
  const reflect = (cx, colour, spread, strength) => {
    for (let i = 0; i < 90; i++) {
      const t = Math.pow(rand(), 0.7);
      const y = horizon + t * (cv.h - horizon) * 0.7;
      const wobble = Math.sin(y / (9 * S) + cx) * spread * (0.3 + t);
      const x = cx + (rand() - 0.5) * spread * (0.4 + t * 2.2) + wobble;
      const len = (4 + rand() * 34) * S * (0.4 + t);
      fillRect(cv, x - len / 2, y, len, Math.max(1, 1.6 * S), colour, strength * (1 - t * 0.55));
    }
  };
  reflect(moonX, [235, 240, 255], W * 0.05 * S, 0.5);
  reflect(W * 0.28 * S, [255, 80, 170], W * 0.09 * S, 0.35);
  reflect(W * 0.68 * S, [60, 240, 230], W * 0.08 * S, 0.32);

  // pier deck in perspective
  const deckTop = H * 0.72 * S;
  polygon(
    cv,
    [
      [W * 0.22 * S, deckTop],
      [W * 0.78 * S, deckTop],
      [cv.w, cv.h],
      [0, cv.h],
    ],
    [44, 26, 40],
  );
  // planks
  for (let i = 0; i < 22; i++) {
    const t0 = Math.pow(i / 22, 1.7);
    const t1 = Math.pow((i + 0.82) / 22, 1.7);
    const y0 = lerp(deckTop, cv.h, t0);
    const y1 = lerp(deckTop, cv.h, t1);
    const inset0 = lerp(W * 0.22 * S, 0, t0);
    const inset1 = lerp(W * 0.22 * S, 0, t1);
    polygon(
      cv,
      [
        [inset0, y0],
        [cv.w - inset0, y0],
        [cv.w - inset1, y1],
        [inset1, y1],
      ],
      i % 2 ? [58, 34, 52] : [48, 28, 46],
      0.55,
    );
  }
  // a strip of wet light down the deck
  for (let y = deckTop; y < cv.h; y += 2) {
    const t = (y - deckTop) / (cv.h - deckTop);
    for (let x = Math.round(W * (0.46 - t * 0.1) * S); x < W * (0.54 + t * 0.1) * S; x++) {
      blend(cv, x, y, 255, 150, 190, 0.05 + t * 0.06);
    }
  }

  // railings with string lights, receding to the deck's far edge
  const rail = (side) => {
    const sign = side === 'L' ? -1 : 1;
    const farX = W * (0.5 + sign * 0.28) * S;
    const nearX = W * (0.5 + sign * 0.92) * S;
    const farY = deckTop;
    const nearY = cv.h * 0.99;
    // top rail
    stroke(cv, [farX, farY - 6 * S], [lerp(farX, nearX, 0.5), lerp(farY, nearY, 0.5) - 40 * S], [nearX, nearY - 210 * S], 2 * S, 7 * S, [30, 16, 34]);
    for (let i = 0; i <= 9; i++) {
      const t = i / 9;
      const px = lerp(farX, nearX, Math.pow(t, 0.85));
      const py = lerp(farY, nearY - 210 * S, Math.pow(t, 0.85));
      const postH = lerp(26, 210, Math.pow(t, 0.85)) * S;
      stroke(cv, [px, py], [px, py + postH * 0.5], [px, py + postH], 1.6 * S, 6 * S, [30, 16, 34]);
      // lamp on each post
      const lampY = py - 4 * S;
      const lampR = lerp(2.5, 9, Math.pow(t, 0.85)) * S;
      radialGlow(cv, px, lampY, lampR * 6, side === 'L' ? [255, 190, 120] : [150, 240, 255], 0.5, 2);
      disc(cv, px, lampY, lampR, [255, 255, 240], side === 'L' ? [255, 190, 120] : [140, 240, 255]);
      // reflection on the water below
      if (i > 1) reflect(px, side === 'L' ? [255, 170, 120] : [120, 230, 255], W * 0.02 * S, 0.18);
    }
  };
  rail('L');
  rail('R');

  // neon sign: a glowing vertical tube and a ring, no lettering
  const sx = W * 0.135 * S;
  const sy = H * 0.5 * S;
  radialGlow(cv, sx, sy, W * 0.14 * S, [255, 60, 170], 0.42, 2.2);
  stroke(cv, [sx, sy + 90 * S], [sx, sy], [sx, sy - 90 * S], 7 * S, 7 * S, [255, 90, 200], 0.95);
  stroke(cv, [sx, sy + 90 * S], [sx, sy], [sx, sy - 90 * S], 3 * S, 3 * S, [255, 226, 246], 0.9);
  radialGlow(cv, W * 0.87 * S, H * 0.46 * S, W * 0.1 * S, [80, 230, 255], 0.38, 2.2);
  for (let a = 0; a < 360; a += 1) {
    const r = 62 * S;
    const x = W * 0.87 * S + Math.cos((a * Math.PI) / 180) * r;
    const y = H * 0.46 * S + Math.sin((a * Math.PI) / 180) * r;
    blend(cv, Math.round(x), Math.round(y), 130, 250, 255, 0.95);
    blend(cv, Math.round(x + 1), Math.round(y), 130, 250, 255, 0.6);
  }

  // a ferris wheel silhouette on the far shore
  const fx = W * 0.3 * S;
  const fy = horizon - H * 0.13 * S;
  const fr = H * 0.12 * S;
  for (let a = 0; a < 360; a += 30) {
    const x = fx + Math.cos((a * Math.PI) / 180) * fr;
    const y = fy + Math.sin((a * Math.PI) / 180) * fr;
    stroke(cv, [fx, fy], [(fx + x) / 2, (fy + y) / 2], [x, y], 1.4 * S, 1.4 * S, [40, 20, 52]);
  }
  for (let a = 0; a < 360; a += 2) {
    const x = fx + Math.cos((a * Math.PI) / 180) * fr;
    const y = fy + Math.sin((a * Math.PI) / 180) * fr;
    blend(cv, Math.round(x), Math.round(y), 60, 30, 80, 0.9);
  }
  for (let a = 0; a < 360; a += 30) {
    const x = fx + Math.cos((a * Math.PI) / 180) * fr;
    const y = fy + Math.sin((a * Math.PI) / 180) * fr;
    radialGlow(cv, x, y, 7 * S, [255, 180, 220], 0.5, 2);
    disc(cv, x, y, 1.6 * S, [255, 230, 245], [255, 140, 200]);
  }
  stroke(cv, [fx - fr * 0.4, horizon], [fx, fy], [fx + fr * 0.4, horizon], 3 * S, 3 * S, [36, 18, 48]);

  // grain + vignette
  for (let y = 0; y < cv.h; y++) {
    for (let x = 0; x < cv.w; x++) {
      const n = (rand() - 0.5) * 11;
      const i = (y * cv.w + x) * 4;
      cv.data[i] = clamp(cv.data[i] + n, 0, 255);
      cv.data[i + 1] = clamp(cv.data[i + 1] + n, 0, 255);
      cv.data[i + 2] = clamp(cv.data[i + 2] + n, 0, 255);
    }
  }
  const w = cv.w;
  const h = cv.h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - w / 2) / (w * 0.6), (y - h / 2) / (h * 0.6));
      if (d > 0.7) blend(cv, x, y, 6, 2, 22, (d - 0.7) * 1.0);
    }
  }
  return cv;
}

// ------------------------------------------------------------------ main

function main() {
  const W = 1400;
  const H = 1000;
  mkdirSync(OUT, { recursive: true });

  const jobs = [
    ['boulevard.png', drawBoulevard],
    ['pier.png', drawPier],
  ];

  for (const [name, draw] of jobs) {
    const hi = draw(W, H);
    const final = downsample(hi, SS);
    const png = encodePNG(final.w, final.h, final.data);
    writeFileSync(join(OUT, name), png);
    console.log(`${name}  ${final.w}x${final.h}  ${(png.length / 1024).toFixed(0)} KiB`);
  }
}

main();
