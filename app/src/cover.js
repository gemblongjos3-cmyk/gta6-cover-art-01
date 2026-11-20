/* Vice Coast Cover Studio — cover renderer.
 *
 * One painter draws every surface: the live preview, the exported PNG and the
 * screenshot modes all call paint() with the same scene object, so what you
 * see in the editor is what lands in the file. Geometry is expressed in
 * fractions of the canvas, so a 540 px preview and a 1920 px export share it.
 *
 * Loaded as a classic script (no modules) so the app also runs from file://.
 */
(function (root) {
  'use strict';

  var NS = (root.ViceCover = root.ViceCover || {});

  var DISPLAY_FONT = 'Anton, "Arial Black", Impact, sans-serif';

  /* ------------------------------------------------------------ catalogue */

  var LAYOUTS = [
    {
      id: 'triptych',
      label: 'Triptych',
      blurb: 'Three tall panels over a title band.',
      count: 3,
    },
    {
      id: 'grid4',
      label: 'Quad Grid',
      blurb: 'Four equal panels, two by two.',
      count: 4,
    },
    {
      id: 'hero',
      label: 'Hero + Strip',
      blurb: 'One wide hero above a two-panel strip.',
      count: 3,
    },
  ];

  var LOOKS = [
    {
      id: 'sunset',
      label: 'Sunset',
      blurb: 'Warm orange-pink wash, hot highlights.',
      filter: 'saturate(1.32) contrast(1.06) brightness(1.04)',
    },
    {
      id: 'neon',
      label: 'Neon Night',
      blurb: 'Purple shadows, cyan rim, glowing midtones.',
      filter: 'saturate(1.5) contrast(1.14) brightness(0.94) hue-rotate(-8deg)',
    },
    {
      id: 'fade',
      label: 'Vice Fade',
      blurb: 'Cinematic teal shadows with orange skin tones.',
      filter: 'saturate(1.14) contrast(1.12) sepia(0.14) brightness(0.99)',
    },
  ];

  var EXPORT_SIZES = [
    { id: '1080x1080', label: 'Square 1080', w: 1080, h: 1080 },
    { id: '1080x1350', label: 'Portrait 1080 × 1350', w: 1080, h: 1350 },
    { id: '1920x1080', label: 'Landscape 1920 × 1080', w: 1920, h: 1080 },
  ];

  function layoutById(id) {
    for (var i = 0; i < LAYOUTS.length; i++) if (LAYOUTS[i].id === id) return LAYOUTS[i];
    return LAYOUTS[0];
  }
  function lookById(id) {
    for (var i = 0; i < LOOKS.length; i++) if (LOOKS[i].id === id) return LOOKS[i];
    return LOOKS[0];
  }
  function exportSizeById(id) {
    for (var i = 0; i < EXPORT_SIZES.length; i++) if (EXPORT_SIZES[i].id === id) return EXPORT_SIZES[i];
    return EXPORT_SIZES[0];
  }

  /* -------------------------------------------------------------- geometry */

  // Panel rectangles, in pixels, for a canvas of W × H.
  function layoutSlots(id, W, H) {
    var m = W * 0.03;          // outer margin
    var g = W * 0.012;         // gutter between panels
    var i, pw, ph;

    if (id === 'grid4') {
      pw = (W - 2 * m - g) / 2;
      ph = (H - 2 * m - g) / 2;
      var quad = [];
      for (i = 0; i < 4; i++) {
        quad.push({
          x: m + (i % 2) * (pw + g),
          y: m + Math.floor(i / 2) * (ph + g),
          w: pw,
          h: ph,
        });
      }
      return quad;
    }

    if (id === 'hero') {
      var heroH = H * 0.6;
      var stripY = m + heroH + g;
      var stripH = H - stripY - m;
      pw = (W - 2 * m - g) / 2;
      return [
        { x: m, y: m, w: W - 2 * m, h: heroH },
        { x: m, y: stripY, w: pw, h: stripH },
        { x: m + pw + g, y: stripY, w: pw, h: stripH },
      ];
    }

    // triptych: three columns, title band across the foot
    var bandH = H * 0.215;
    var top = m;
    var foot = H - bandH - m * 1.35;
    pw = (W - 2 * m - 2 * g) / 3;
    var cols = [];
    for (i = 0; i < 3; i++) {
      cols.push({ x: m + i * (pw + g), y: top, w: pw, h: foot - top });
    }
    return cols;
  }

  function bandRect(W, H) {
    var bandH = H * 0.215;
    var m = W * 0.03;
    return { x: m, y: H - bandH - m * 0.4, w: W - 2 * m, h: bandH };
  }

  // Where the lettering sits when the layout changes.
  function captionHome(id) {
    if (id === 'hero') return { x: 0.5, y: 0.36 };
    if (id === 'grid4') return { x: 0.5, y: 0.845 };
    return { x: 0.5, y: 0.876 };
  }

  /* ---------------------------------------------------------------- helpers */

  function rr(ctx, x, y, w, h, r) {
    var rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  // Deterministic noise: the same seed paints the same grain twice, so an
  // export matches its preview and screenshots are reproducible.
  function seeded(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  var tiles = {};

  function grainTile(ctx) {
    if (!tiles.grain) {
      var c = document.createElement('canvas');
      c.width = 140;
      c.height = 140;
      var g = c.getContext('2d');
      var img = g.createImageData(140, 140);
      var rand = seeded(20261120);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = 96 + Math.floor(rand() * 128);
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      tiles.grain = c;
    }
    return ctx.createPattern(tiles.grain, 'repeat');
  }

  function dotTile(ctx) {
    if (!tiles.dots) {
      var c = document.createElement('canvas');
      c.width = 12;
      c.height = 12;
      var g = c.getContext('2d');
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.arc(3, 3, 2.1, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(9, 9, 2.1, 0, Math.PI * 2);
      g.fill();
      tiles.dots = c;
    }
    return ctx.createPattern(tiles.dots, 'repeat');
  }

  function spaced(ctx, px) {
    try {
      ctx.letterSpacing = px + 'px';
    } catch (err) {
      /* older canvas implementations ignore this */
    }
  }

  /* ------------------------------------------------------------------ look */

  // The per-panel colour treatment. Each look layers gradients the app draws
  // itself over the photo, so no external filter file or image is needed.
  function paintLook(ctx, r, lookId, W) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();

    var g, glow, band;

    if (lookId === 'neon') {
      g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      g.addColorStop(0, 'rgba(46, 10, 96, 0.70)');
      g.addColorStop(0.5, 'rgba(126, 22, 132, 0.28)');
      g.addColorStop(1, 'rgba(0, 178, 205, 0.52)');
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      glow = ctx.createRadialGradient(
        r.x + r.w * 0.7, r.y + r.h * 0.22, 0,
        r.x + r.w * 0.7, r.y + r.h * 0.22, r.w * 0.8
      );
      glow.addColorStop(0, 'rgba(255, 46, 190, 0.52)');
      glow.addColorStop(0.45, 'rgba(120, 44, 255, 0.15)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glow;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      band = ctx.createLinearGradient(r.x, r.y + r.h * 0.55, r.x + r.w, r.y + r.h);
      band.addColorStop(0, 'rgba(0, 0, 0, 0)');
      band.addColorStop(1, 'rgba(0, 242, 255, 0.26)');
      ctx.fillStyle = band;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      // soft scan lines, the video-signal texture of a night shot
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(10, 4, 26, 0.18)';
      var step = Math.max(3, Math.round(r.h / 170));
      for (var sy = r.y; sy < r.y + r.h; sy += step * 2) {
        ctx.fillRect(r.x, sy, r.w, step * 0.65);
      }
    } else if (lookId === 'fade') {
      g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      g.addColorStop(0, 'rgba(255, 138, 64, 0.22)');
      g.addColorStop(0.42, 'rgba(60, 118, 118, 0.10)');
      g.addColorStop(1, 'rgba(0, 88, 108, 0.60)');
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      glow = ctx.createRadialGradient(
        r.x + r.w * 0.28, r.y + r.h * 0.08, 0,
        r.x + r.w * 0.28, r.y + r.h * 0.08, r.w * 0.95
      );
      glow.addColorStop(0, 'rgba(255, 152, 72, 0.40)');
      glow.addColorStop(1, 'rgba(255, 152, 72, 0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glow;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      band = ctx.createLinearGradient(r.x, r.y + r.h * 0.42, r.x, r.y + r.h);
      band.addColorStop(0, 'rgba(0, 0, 0, 0)');
      band.addColorStop(1, 'rgba(0, 206, 188, 0.24)');
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = band;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else {
      // sunset: the default Vice City dusk
      g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      g.addColorStop(0, 'rgba(255, 112, 60, 0.52)');
      g.addColorStop(0.44, 'rgba(255, 58, 128, 0.36)');
      g.addColorStop(1, 'rgba(72, 12, 100, 0.72)');
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);

      glow = ctx.createRadialGradient(
        r.x + r.w * 0.76, r.y + r.h * 0.16, 0,
        r.x + r.w * 0.76, r.y + r.h * 0.16, r.w * 0.88
      );
      glow.addColorStop(0, 'rgba(255, 216, 132, 0.52)');
      glow.addColorStop(0.4, 'rgba(255, 122, 92, 0.20)');
      glow.addColorStop(1, 'rgba(255, 82, 122, 0)');
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = glow;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // a dark foot under every panel keeps lettering readable on top
    var foot = ctx.createLinearGradient(r.x, r.y + r.h * 0.58, r.x, r.y + r.h);
    foot.addColorStop(0, 'rgba(12, 0, 28, 0)');
    foot.addColorStop(1, 'rgba(12, 0, 28, 0.52)');
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = foot;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.restore();
  }

  /* ----------------------------------------------------------------- panels */

  function paintPlaceholder(ctx, r, index, W) {
    var g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    g.addColorStop(0, '#221040');
    g.addColorStop(0.55, '#3a1550');
    g.addColorStop(1, '#0f1a3c');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#ff5fa8';
    ctx.lineWidth = Math.max(1, W * 0.0035);
    var stride = Math.max(11, W * 0.032);
    for (var i = -r.h; i < r.w; i += stride) {
      ctx.beginPath();
      ctx.moveTo(r.x + i, r.y + r.h);
      ctx.lineTo(r.x + i + r.h, r.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.74)';
    ctx.font = '400 ' + Math.max(12, r.w * 0.095) + 'px ' + DISPLAY_FONT;
    ctx.fillText('PANEL ' + (index + 1), r.x + r.w / 2, r.y + r.h / 2 - r.w * 0.05);
    ctx.fillStyle = 'rgba(255,255,255,0.44)';
    ctx.font = '400 ' + Math.max(9, r.w * 0.05) + 'px ' + DISPLAY_FONT;
    spaced(ctx, r.w * 0.008);
    ctx.fillText('ADD A PHOTO', r.x + r.w / 2, r.y + r.h / 2 + r.w * 0.06);
    spaced(ctx, 0);
    ctx.restore();
  }

  function paintPanel(ctx, r, panel, index, look, W) {
    var radius = Math.min(r.w, r.h) * 0.02;

    ctx.save();
    rr(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.clip();

    var img = panel && panel.img;
    if (!img || !img.width) {
      paintPlaceholder(ctx, r, index, W);
    } else {
      var zoom = panel.zoom > 0 ? panel.zoom : 1;
      var cover = panel.mode !== 'fit';
      var base = cover
        ? Math.max(r.w / img.width, r.h / img.height)
        : Math.min(r.w / img.width, r.h / img.height);
      var scale = base * zoom;
      var dw = img.width * scale;
      var dh = img.height * scale;
      var cx = r.x + r.w / 2 + (panel.ox || 0) * r.w;
      var cy = r.y + r.h / 2 + (panel.oy || 0) * r.h;
      var dx = cx - dw / 2;
      var dy = cy - dh / 2;

      if (!cover) {
        // letterboxed: a deep matte behind the whole photo
        ctx.fillStyle = 'rgba(10, 4, 22, 0.94)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }

      ctx.filter = look.filter;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.filter = 'none';

      paintLook(ctx, r, look.id, W);
    }

    ctx.restore();

    // hairline frame
    ctx.save();
    rr(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.strokeStyle = 'rgba(255, 246, 250, 0.88)';
    ctx.lineWidth = Math.max(1.2, W * 0.0026);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ band */

  function paintBand(ctx, W, H, lookId) {
    var r = bandRect(W, H);
    var radius = W * 0.012;

    ctx.save();
    rr(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.clip();

    var g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    if (lookId === 'neon') {
      g.addColorStop(0, '#170436');
      g.addColorStop(0.5, '#4a0b62');
      g.addColorStop(1, '#0a2a4a');
    } else if (lookId === 'fade') {
      g.addColorStop(0, '#2a1408');
      g.addColorStop(0.5, '#5b2410');
      g.addColorStop(1, '#0d2a2c');
    } else {
      g.addColorStop(0, '#2c0838');
      g.addColorStop(0.45, '#5a1050');
      g.addColorStop(1, '#1b0838');
    }
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // speed stripes
    ctx.save();
    ctx.globalAlpha = 0.17;
    ctx.fillStyle = lookId === 'neon' ? '#22e6ff' : '#ff3d8a';
    var stride = Math.max(18, W * 0.046);
    for (var i = -r.h; i < r.w + r.h; i += stride) {
      ctx.beginPath();
      ctx.moveTo(r.x + i, r.y + r.h);
      ctx.lineTo(r.x + i + r.h * 0.55, r.y + r.h);
      ctx.lineTo(r.x + i + r.h * 1.35, r.y);
      ctx.lineTo(r.x + i + r.h * 0.8, r.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    var hair = Math.max(1, H * 0.0028);
    ctx.fillStyle = 'rgba(255, 214, 140, 0.9)';
    ctx.fillRect(r.x, r.y, r.w, hair);
    ctx.fillRect(r.x, r.y + r.h - hair, r.w, hair);
    ctx.restore();
  }

  /* --------------------------------------------------------------- effects */

  function paintHalftone(ctx, W, H, slots, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = dotTile(ctx);
    for (var i = 0; i < slots.length; i++) {
      ctx.fillRect(slots[i].x, slots[i].y, slots[i].w, slots[i].h);
    }
    ctx.restore();
  }

  function paintGrain(ctx, W, H, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grainTile(ctx);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function paintVignette(ctx, W, H) {
    var g = ctx.createRadialGradient(
      W / 2, H * 0.45, Math.min(W, H) * 0.24,
      W / 2, H * 0.5, Math.max(W, H) * 0.8
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(8,0,20,0.10)');
    g.addColorStop(1, 'rgba(8,0,20,0.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function paintLeak(ctx, W, H, lookId) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.16;
    ctx.translate(W * 0.86, -H * 0.1);
    ctx.rotate(0.62);
    var g = ctx.createLinearGradient(0, 0, 0, H * 0.9);
    g.addColorStop(0, lookId === 'neon' ? 'rgba(255, 60, 210, 0.9)' : 'rgba(255, 170, 80, 0.95)');
    g.addColorStop(0.55, lookId === 'fade' ? 'rgba(255, 120, 60, 0.35)' : 'rgba(255, 120, 160, 0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-W * 0.25, 0, W * 0.5, H * 0.9);
    ctx.restore();
  }

  function paintFrame(ctx, W, H) {
    var inset = W * 0.013;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 238, 226, 0.82)';
    ctx.lineWidth = Math.max(1.5, W * 0.0035);
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    ctx.strokeStyle = 'rgba(255, 238, 226, 0.28)';
    ctx.lineWidth = Math.max(1, W * 0.0014);
    ctx.strokeRect(inset * 1.9, inset * 1.9, W - inset * 3.8, H - inset * 3.8);
    ctx.restore();
  }

  /* --------------------------------------------------------------- caption */

  function captionPalette(lookId) {
    if (lookId === 'neon') {
      return { top: '#f2fbff', bottom: '#a9e8ff', echo: 'rgba(0, 236, 255, 0.88)', sub: '#d6f6ff' };
    }
    if (lookId === 'fade') {
      return { top: '#fff8ee', bottom: '#ffd39a', echo: 'rgba(255, 168, 86, 0.9)', sub: '#ffe9cd' };
    }
    return { top: '#fff7e8', bottom: '#ffd6a2', echo: 'rgba(255, 44, 138, 0.92)', sub: '#ffe9c9' };
  }

  function paintCaption(ctx, W, H, scene) {
    var cap = scene.caption || { x: 0.5, y: 0.876, size: 1 };
    var pal = captionPalette(scene.look);
    var title = (scene.title || '').trim();
    var subtitle = (scene.subtitle || '').trim();
    var scale = cap.size > 0 ? cap.size : 1;
    var cx = cap.x * W;
    var cy = cap.y * H;
    var maxW = W * 0.88;

    var titleSize = Math.min(W * 0.14, H * 0.17) * scale;
    if (title) {
      ctx.save();
      ctx.font = '400 ' + titleSize + 'px ' + DISPLAY_FONT;
      var probe = ctx.measureText(title.toUpperCase()).width;
      ctx.restore();
      if (probe > maxW) titleSize *= maxW / probe;
    }
    var subSize = Math.max(W * 0.016, titleSize * 0.235);
    var blockH = (title ? titleSize * 0.94 : 0) + (subtitle ? subSize * 1.7 : 0);
    var top = cy - blockH / 2;

    var widest = 0;

    if (title) {
      var text = title.toUpperCase();
      var baseY = top + titleSize * 0.8;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '400 ' + titleSize + 'px ' + DISPLAY_FONT;
      spaced(ctx, titleSize * 0.012);
      widest = Math.max(widest, ctx.measureText(text).width);

      ctx.fillStyle = 'rgba(16, 0, 34, 0.55)';
      ctx.fillText(text, cx + titleSize * 0.055, baseY + titleSize * 0.075);

      ctx.fillStyle = pal.echo;
      ctx.fillText(text, cx + titleSize * 0.028, baseY + titleSize * 0.038);

      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = '#100320';
      ctx.lineWidth = Math.max(2, titleSize * 0.12);
      ctx.strokeText(text, cx, baseY);

      var g = ctx.createLinearGradient(0, baseY - titleSize * 0.78, 0, baseY);
      g.addColorStop(0, pal.top);
      g.addColorStop(0.58, pal.top);
      g.addColorStop(1, pal.bottom);
      ctx.fillStyle = g;
      ctx.fillText(text, cx, baseY);
      ctx.restore();
    }

    if (subtitle) {
      var sub = subtitle.toUpperCase();
      var subY = top + (title ? titleSize * 0.94 : 0) + subSize * 0.85;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '400 ' + subSize + 'px ' + DISPLAY_FONT;
      spaced(ctx, subSize * 0.17);
      widest = Math.max(widest, ctx.measureText(sub).width);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(10, 2, 22, 0.86)';
      ctx.lineWidth = Math.max(1.5, subSize * 0.17);
      ctx.strokeText(sub, cx, subY);
      ctx.fillStyle = pal.sub;
      ctx.fillText(sub, cx, subY);
      ctx.restore();
    }

    // what the editor uses to hit-test a drag on the lettering
    var boxW = Math.max(widest, W * 0.2) + titleSize * 0.24;
    return {
      x: (cx - boxW / 2) / W,
      y: (top - blockH * 0.12) / H,
      w: boxW / W,
      h: (blockH * 1.24) / H,
    };
  }

  /* ----------------------------------------------------------------- paint */

  /**
   * Draw a whole cover.
   * scene = { layout, look, title, subtitle, caption:{x,y,size}, panels:[{img,zoom,ox,oy,mode}] }
   * Returns the caption's bounding box in 0..1 canvas units.
   */
  function paint(ctx, W, H, scene) {
    var layout = layoutById(scene.layout);
    var look = lookById(scene.look);
    var slots = layoutSlots(layout.id, W, H);
    var panels = scene.panels || [];

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b0418';
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < slots.length; i++) {
      paintPanel(ctx, slots[i], panels[i], i, look, W);
    }

    // a soft wash across the whole sheet ties the panels into one image
    var wash = ctx.createLinearGradient(0, 0, W, H);
    if (look.id === 'neon') {
      wash.addColorStop(0, 'rgba(126, 22, 190, 0.16)');
      wash.addColorStop(1, 'rgba(0, 190, 220, 0.11)');
    } else if (look.id === 'fade') {
      wash.addColorStop(0, 'rgba(255, 132, 62, 0.09)');
      wash.addColorStop(1, 'rgba(0, 120, 140, 0.15)');
    } else {
      wash.addColorStop(0, 'rgba(255, 120, 60, 0.13)');
      wash.addColorStop(1, 'rgba(112, 20, 150, 0.15)');
    }
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    if (layout.id === 'triptych') paintBand(ctx, W, H, look.id);

    paintHalftone(ctx, W, H, slots, 0.075);
    paintVignette(ctx, W, H);
    paintGrain(ctx, W, H, 0.07);
    paintLeak(ctx, W, H, look.id);

    var box = paintCaption(ctx, W, H, scene);

    paintFrame(ctx, W, H);

    // maker's mark: this app's own name, not a borrowed logo
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = '400 ' + Math.max(8, W * 0.0125) + 'px ' + DISPLAY_FONT;
    spaced(ctx, W * 0.0028);
    ctx.fillStyle = 'rgba(255, 236, 214, 0.5)';
    ctx.fillText('VICE COAST STUDIO', W - W * 0.035, H - H * 0.014);
    ctx.restore();

    ctx.restore();
    return box;
  }

  function renderToCanvas(W, H, scene) {
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    paint(canvas.getContext('2d'), W, H, scene);
    return canvas;
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('400 64px Anton').catch(function () {}),
      document.fonts.ready.catch(function () {}),
    ]).then(function () {});
  }

  /* --------------------------------------------------------- scene presets */

  // Three finished looks, used by the ?shot= cover modes and offered in the
  // editor's "Start from a look" row.
  var PRESETS = {
    A: {
      layout: 'triptych',
      look: 'sunset',
      title: 'VICE COAST',
      subtitle: 'SIX NIGHTS ON THE STRIP',
      caption: { x: 0.5, y: 0.876, size: 1 },
      panels: [
        { zoom: 1.08, ox: 0, oy: 0.05 },
        { zoom: 1.22, ox: 0, oy: -0.03 },
        { zoom: 1.04, ox: 0, oy: 0.04 },
      ],
    },
    B: {
      layout: 'grid4',
      look: 'neon',
      title: 'NEON PIER',
      subtitle: 'AFTER MIDNIGHT',
      caption: { x: 0.5, y: 0.5, size: 0.92 },
      panels: [
        { zoom: 1.12, ox: 0, oy: 0.03 },
        { zoom: 1.0, ox: 0.02, oy: 0 },
        { zoom: 1.06, ox: -0.02, oy: 0.02 },
        { zoom: 1.16, ox: 0, oy: -0.03 },
      ],
    },
    C: {
      layout: 'hero',
      look: 'fade',
      title: 'COAST LINE',
      subtitle: 'THE LONG WAY HOME',
      caption: { x: 0.36, y: 0.36, size: 0.95 },
      panels: [
        { zoom: 1.12, ox: 0, oy: 0.08 },
        { zoom: 1.02, ox: 0, oy: 0 },
        { zoom: 1.08, ox: 0.03, oy: 0 },
      ],
    },
  };

  NS.DISPLAY_FONT = DISPLAY_FONT;
  NS.LAYOUTS = LAYOUTS;
  NS.LOOKS = LOOKS;
  NS.EXPORT_SIZES = EXPORT_SIZES;
  NS.PRESETS = PRESETS;
  NS.layoutById = layoutById;
  NS.lookById = lookById;
  NS.exportSizeById = exportSizeById;
  NS.layoutSlots = layoutSlots;
  NS.captionHome = captionHome;
  NS.paint = paint;
  NS.renderToCanvas = renderToCanvas;
  NS.fontsReady = fontsReady;
})(window);
