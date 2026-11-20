/* Vice Coast Cover Studio — the ?shot= modes.
 *
 *   ?shot=editor         the normal editor with the sample photos already loaded
 *   ?shot=cover-square   the finished cover at 1024 × 1024
 *   ?shot=cover-tall     the finished cover at  864 × 1080
 *   ?shot=cover-wide     the finished cover at 1280 ×  720
 *
 * A cover shot draws through ViceCover.paint(), the same painter the editor
 * and the PNG export use, so it is the app's own output, not a mock-up.
 * Add &variant=A|B|C to pick one of the three built-in looks.
 *
 * With no ?shot= in the URL nothing here runs beyond reading the parameter.
 */
(function (root) {
  'use strict';

  var NS = (root.ViceCover = root.ViceCover || {});

  var SAMPLE_FILES = ['samples/boulevard.png', 'samples/pier.png'];

  var COVER_SPECS = {
    'cover-square': { w: 1024, h: 1024, preset: 'A' },
    'cover-tall': { w: 864, h: 1080, preset: 'B' },
    'cover-wide': { w: 1280, h: 720, preset: 'C' },
  };

  function loadPhoto(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function loadSamples() {
    return Promise.all(SAMPLE_FILES.map(loadPhoto));
  }

  // Build a scene from one of the built-in presets, spreading the photos we
  // managed to load across the layout's panels.
  function sceneFromPreset(name, photos) {
    var preset = NS.PRESETS[name] || NS.PRESETS.A;
    var layout = NS.layoutById(preset.layout);
    var pool = photos.filter(function (p) { return p && p.width; });
    var panels = [];
    for (var i = 0; i < layout.count; i++) {
      var look = preset.panels[i] || { zoom: 1, ox: 0, oy: 0 };
      panels.push({
        img: pool.length ? pool[i % pool.length] : null,
        zoom: look.zoom,
        ox: look.ox,
        oy: look.oy,
        mode: 'fill',
      });
    }
    return {
      layout: preset.layout,
      look: preset.look,
      title: preset.title,
      subtitle: preset.subtitle,
      caption: { x: preset.caption.x, y: preset.caption.y, size: preset.caption.size },
      panels: panels,
    };
  }

  function fillFrame(spec, scene) {
    document.body.classList.add('shot');
    document.body.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'shot-wrap';

    var canvas = document.createElement('canvas');
    canvas.width = spec.w;
    canvas.height = spec.h;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Cover art exported by Vice Coast Cover Studio');
    wrap.appendChild(canvas);
    document.body.appendChild(wrap);

    NS.paint(canvas.getContext('2d'), spec.w, spec.h, scene);
    document.documentElement.setAttribute('data-shot-ready', '1');
    document.title = 'Cover — Vice Coast Cover Studio';
  }

  /**
   * Handles a cover shot. Resolves to true when it rendered one, false when
   * the caller should carry on and build the editor (which owns ?shot=editor).
   */
  function runCoverShot(shot, params) {
    var spec = COVER_SPECS[shot];
    if (!spec) return Promise.resolve(false);

    var variant = (params.get('variant') || spec.preset).toUpperCase();

    return loadSamples()
      .then(function (photos) {
        return NS.fontsReady().then(function () { return photos; });
      })
      .then(function (photos) {
        fillFrame(spec, sceneFromPreset(variant, photos));
        return true;
      })
      .catch(function (err) {
        document.body.innerHTML = '<pre class="shot-error">Cover render failed: ' +
          String(err && err.message ? err.message : err) + '</pre>';
        return true;
      });
  }

  NS.shots = {
    SAMPLE_FILES: SAMPLE_FILES,
    COVER_SPECS: COVER_SPECS,
    loadSamples: loadSamples,
    loadPhoto: loadPhoto,
    runCoverShot: runCoverShot,
  };
})(window);
