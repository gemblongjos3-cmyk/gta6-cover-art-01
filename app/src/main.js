/* Vice Coast Cover Studio — editor wiring.
 *
 * State lives in one plain object; every change calls redraw(), which paints
 * the live preview with ViceCover.paint(). Nothing here touches the network:
 * photos arrive through FileReader, samples are files under samples/, and the
 * font is the local Anton file.
 */
(function () {
  'use strict';

  var NS = window.ViceCover;
  if (!NS) throw new Error('cover.js must load before main.js');

  var params = new URLSearchParams(window.location.search);
  var shot = params.get('shot') || '';

  /* ----------------------------------------------------------------- state */

  var state = {
    layout: 'triptych',
    look: 'sunset',
    title: 'VICE COAST',
    subtitle: 'SIX NIGHTS ON THE STRIP',
    caption: { x: 0.5, y: 0.876, size: 1 },
    sizeId: '1080x1080',
    photos: [],          // { id, name, img }
    panels: [],          // { photoId, zoom, ox, oy, mode }
    selected: 0,
  };

  var els = {};
  var captionBox = null;   // last painted caption bounds, 0..1 units
  var drag = null;
  var nextPhotoId = 1;

  /* --------------------------------------------------------------- helpers */

  function el(id) { return document.getElementById(id); }

  function say(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.className = 'status' + (kind ? ' is-' + kind : '');
  }

  function currentLayout() { return NS.layoutById(state.layout); }
  function currentSize() { return NS.exportSizeById(state.sizeId); }

  function photoById(id) {
    for (var i = 0; i < state.photos.length; i++) if (state.photos[i].id === id) return state.photos[i];
    return null;
  }

  function sceneSnapshot() {
    var panels = state.panels.map(function (p) {
      var photo = photoById(p.photoId);
      return {
        img: photo ? photo.img : null,
        zoom: p.zoom,
        ox: p.ox,
        oy: p.oy,
        mode: p.mode,
      };
    });
    return {
      layout: state.layout,
      look: state.look,
      title: state.title,
      subtitle: state.subtitle,
      caption: { x: state.caption.x, y: state.caption.y, size: state.caption.size },
      panels: panels,
    };
  }

  // Panels follow the layout's count: grow with the first photo, trim on switch.
  function syncPanels() {
    var want = currentLayout().count;
    while (state.panels.length < want) {
      var first = state.photos[0];
      state.panels.push({
        photoId: first ? first.id : null,
        zoom: 1,
        ox: 0,
        oy: 0,
        mode: 'fill',
      });
    }
    if (state.panels.length > want) state.panels.length = want;
    if (state.selected >= want) state.selected = want - 1;
    if (state.selected < 0) state.selected = 0;
  }

  /* ---------------------------------------------------------------- canvas */

  function previewPixelSize() {
    var size = currentSize();
    var longSide = 720;
    var ratio = size.w / size.h;
    if (ratio >= 1) return { w: longSide, h: Math.round(longSide / ratio) };
    return { w: Math.round(longSide * ratio), h: longSide };
  }

  function redraw() {
    var canvas = els.preview;
    if (!canvas) return;
    var px = previewPixelSize();
    if (canvas.width !== px.w || canvas.height !== px.h) {
      canvas.width = px.w;
      canvas.height = px.h;
    }
    captionBox = NS.paint(canvas.getContext('2d'), canvas.width, canvas.height, sceneSnapshot());
    if (els.stageInfo) {
      els.stageInfo.textContent =
        currentLayout().label + ' · ' + NS.lookById(state.look).label + ' · ' +
        currentSize().w + ' × ' + currentSize().h;
    }
  }

  /* --------------------------------------------------------------- pickers */

  // Builds a radiogroup of buttons and wires both clicking and arrow-key
  // movement to the same handler.
  function buildSegmented(container, items, pick) {
    container.innerHTML = '';
    items.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn';
      b.setAttribute('role', 'radio');
      b.setAttribute('data-id', item.id);
      b.textContent = item.label;
      b.addEventListener('click', function () { pick(item.id); });
      container.appendChild(b);
    });

    container.addEventListener('keydown', function (ev) {
      var keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (keys.indexOf(ev.key) < 0) return;
      var kids = [].slice.call(container.querySelectorAll('.seg-btn'));
      if (!kids.length) return;
      var at = kids.indexOf(document.activeElement);
      if (at < 0) at = 0;
      var forward = ev.key === 'ArrowRight' || ev.key === 'ArrowDown';
      var next;
      if (ev.key === 'Home') next = kids[0];
      else if (ev.key === 'End') next = kids[kids.length - 1];
      else next = kids[(at + (forward ? 1 : -1) + kids.length) % kids.length];
      next.focus();
      pick(next.getAttribute('data-id'));
      ev.preventDefault();
    });
  }

  function markSegmented(container, activeId) {
    var kids = container.querySelectorAll('.seg-btn');
    for (var i = 0; i < kids.length; i++) {
      var on = kids[i].getAttribute('data-id') === activeId;
      kids[i].setAttribute('aria-checked', on ? 'true' : 'false');
      kids[i].tabIndex = on ? 0 : -1;
    }
  }

  /* ---------------------------------------------------------------- photos */

  function addPhoto(name, img) {
    var photo = { id: 'p' + (nextPhotoId++), name: name, img: img };
    state.photos.push(photo);
    return photo;
  }

  function loadFromFile(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () { resolve({ name: file.name || 'photo', img: img }); };
        img.onerror = function () { resolve(null); };
        img.src = String(reader.result);
      };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(file);
    });
  }

  function handleFiles(fileList) {
    var files = [].slice.call(fileList || []).filter(function (f) {
      return /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
    });
    if (!files.length) {
      say('Those files are not images.', 'bad');
      return;
    }
    say('Reading ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '…', 'busy');
    Promise.all(files.map(loadFromFile)).then(function (loaded) {
      var good = loaded.filter(Boolean);
      var added = good.map(function (g) { return addPhoto(g.name, g.img); });
      if (!added.length) {
        say('Could not read those images.', 'bad');
        return;
      }
      // fill the empty panels with the new photos, in order
      var slot = state.photos.length - added.length;
      for (var i = 0; i < state.panels.length; i++) {
        if (!state.panels[i].photoId) {
          var pick = added[slot % added.length];
          state.panels[i].photoId = pick.id;
          slot++;
        }
      }
      if (!state.panels[state.selected].photoId) state.panels[state.selected].photoId = added[0].id;
      refreshPhotos();
      redraw();
      say('Added ' + added.length + ' photo' + (added.length === 1 ? '' : 's') + '.', 'good');
    });
  }

  function loadSamples() {
    say('Loading samples…', 'busy');
    return NS.shots.loadSamples().then(function (imgs) {
      var names = ['boulevard', 'pier'];
      var added = [];
      imgs.forEach(function (img, i) {
        if (img && img.width) added.push(addPhoto(names[i], img));
      });
      if (!added.length) {
        say('Samples could not be loaded.', 'bad');
        return;
      }
      for (var i = 0; i < state.panels.length; i++) {
        var pick = added[i % added.length];
        state.panels[i].photoId = pick.id;
        // a different crop per panel so a single photo does not look repeated
        state.panels[i].zoom = [1.05, 1.18, 1.02, 1.12][i % 4];
        state.panels[i].oy = [0.04, -0.03, 0.05, 0][i % 4];
      }
      refreshPhotos();
      redraw();
      say('Samples loaded — edit anything.', 'good');
    });
  }

  function refreshPhotos() {
    var list = els.photoList;
    if (!list) return;
    list.innerHTML = '';
    state.photos.forEach(function (photo) {
      var li = document.createElement('li');
      li.className = 'chip';

      var thumb = document.createElement('img');
      thumb.alt = '';
      thumb.src = photo.img.currentSrc || photo.img.src;
      li.appendChild(thumb);

      var name = document.createElement('span');
      name.className = 'chip-name';
      name.textContent = photo.name;
      li.appendChild(name);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'chip-x';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove ' + photo.name);
      remove.addEventListener('click', function () { removePhoto(photo.id); });
      li.appendChild(remove);

      list.appendChild(li);
    });
    refreshPanelSelect();
    if (els.clearBtn) els.clearBtn.disabled = state.photos.length === 0;
  }

  function removePhoto(id) {
    state.photos = state.photos.filter(function (p) { return p.id !== id; });
    var fallback = state.photos.length ? state.photos[0].id : null;
    state.panels.forEach(function (p) { if (p.photoId === id) p.photoId = fallback; });
    refreshPhotos();
    redraw();
  }

  function clearPhotos() {
    state.photos = [];
    state.panels.forEach(function (p) { p.photoId = null; });
    refreshPhotos();
    redraw();
    say('Photos removed.', null);
  }

  function refreshPanelSelect() {
    var sel = els.panelPhoto;
    if (!sel) return;
    sel.innerHTML = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = state.photos.length ? '— empty panel —' : '— no photos yet —';
    sel.appendChild(none);
    state.photos.forEach(function (photo, i) {
      var o = document.createElement('option');
      o.value = photo.id;
      o.textContent = (i + 1) + '. ' + photo.name;
      sel.appendChild(o);
    });
    var cur = state.panels[state.selected];
    sel.value = cur && cur.photoId ? cur.photoId : '';
  }

  /* ----------------------------------------------------------- panel fields */

  function refreshPanelFields() {
    var panel = state.panels[state.selected];
    if (!panel) return;
    if (els.panelName) {
      els.panelName.textContent = 'Panel ' + (state.selected + 1) + ' of ' + state.panels.length;
    }
    if (els.zoomIn) els.zoomIn.value = panel.zoom;
    if (els.fillBtn) els.fillBtn.setAttribute('aria-pressed', panel.mode !== 'fit' ? 'true' : 'false');
    if (els.fitBtn) els.fitBtn.setAttribute('aria-pressed', panel.mode === 'fit' ? 'true' : 'false');
    refreshPanelSelect();
  }

  function selectPanel(i) {
    var n = state.panels.length;
    state.selected = ((i % n) + n) % n;
    refreshPanelFields();
    redraw();
  }

  /* --------------------------------------------------------- pointer drag */

  function pointerPos(ev, canvas) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) / r.width,
      y: (ev.clientY - r.top) / r.height,
    };
  }

  function hitCaption(p) {
    if (!captionBox) return false;
    return p.x >= captionBox.x && p.x <= captionBox.x + captionBox.w &&
           p.y >= captionBox.y && p.y <= captionBox.y + captionBox.h;
  }

  // Which panel rectangle contains the point? Used to select on click.
  function hitPanel(p) {
    var canvas = els.preview;
    var slots = NS.layoutSlots(state.layout, canvas.width, canvas.height);
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      var nx = s.x / canvas.width;
      var ny = s.y / canvas.height;
      var nw = s.w / canvas.width;
      var nh = s.h / canvas.height;
      if (p.x >= nx && p.x <= nx + nw && p.y >= ny && p.y <= ny + nh) return i;
    }
    return -1;
  }

  function wireCanvas() {
    var canvas = els.preview;

    canvas.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      canvas.focus();
      var p = pointerPos(ev, canvas);
      var onText = hitCaption(p);
      var panelAt = hitPanel(p);
      if (onText) {
        drag = { kind: 'caption', startX: p.x, startY: p.y, from: { x: state.caption.x, y: state.caption.y } };
      } else {
        if (panelAt >= 0 && panelAt !== state.selected) {
          state.selected = panelAt;
          refreshPanelFields();
        }
        var panel = state.panels[state.selected];
        var size = currentSize();
        drag = {
          kind: 'panel',
          startX: p.x,
          startY: p.y,
          from: { ox: panel.ox, oy: panel.oy },
          ratio: size.w / size.h,
        };
      }
      canvas.setPointerCapture(ev.pointerId);
      canvas.classList.add('is-panning');
      ev.preventDefault();
    });

    canvas.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var p = pointerPos(ev, canvas);
      if (drag.kind === 'caption') {
        state.caption.x = clamp(drag.from.x + (p.x - drag.startX), 0.05, 0.95);
        state.caption.y = clamp(drag.from.y + (p.y - drag.startY), 0.05, 0.95);
      } else {
        var dx = p.x - drag.startX;
        var dy = p.y - drag.startY;
        var panel = state.panels[state.selected];
        // pan in panel space; a vertical percent of the canvas is worth more
        // horizontal movement when the sheet is taller than it is wide
        panel.ox = clamp(drag.from.ox + dx, -1.5, 1.5);
        panel.oy = clamp(drag.from.oy + dy * drag.ratio, -1.5, 1.5);
      }
      redraw();
      ev.preventDefault();
    });

    function endDrag(ev) {
      if (!drag) return;
      drag = null;
      canvas.classList.remove('is-panning');
      if (ev && ev.pointerId !== undefined && canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId);
      }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('dblclick', function (ev) {
      var p = pointerPos(ev, canvas);
      if (hitCaption(p)) {
        resetCaption();
        return;
      }
      var panel = state.panels[state.selected];
      panel.ox = 0;
      panel.oy = 0;
      panel.zoom = 1;
      refreshPanelFields();
      redraw();
    });

    canvas.addEventListener('keydown', function (ev) {
      var step = ev.shiftKey ? 0.03 : 0.008;
      var used = true;
      if (ev.shiftKey) {
        if (ev.key === 'ArrowLeft') state.caption.x = clamp(state.caption.x - step, 0.05, 0.95);
        else if (ev.key === 'ArrowRight') state.caption.x = clamp(state.caption.x + step, 0.05, 0.95);
        else if (ev.key === 'ArrowUp') state.caption.y = clamp(state.caption.y - step, 0.05, 0.95);
        else if (ev.key === 'ArrowDown') state.caption.y = clamp(state.caption.y + step, 0.05, 0.95);
        else used = false;
      } else {
        var panel = state.panels[state.selected];
        var ratio = currentSize().w / currentSize().h;
        if (ev.key === 'ArrowLeft') panel.ox = clamp(panel.ox - step, -1.5, 1.5);
        else if (ev.key === 'ArrowRight') panel.ox = clamp(panel.ox + step, -1.5, 1.5);
        else if (ev.key === 'ArrowUp') panel.oy = clamp(panel.oy - step * ratio, -1.5, 1.5);
        else if (ev.key === 'ArrowDown') panel.oy = clamp(panel.oy + step * ratio, -1.5, 1.5);
        else used = false;
      }
      if (used) {
        ev.preventDefault();
        redraw();
      }
    });
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function resetCaption() {
    var home = NS.captionHome(state.layout);
    state.caption.x = home.x;
    state.caption.y = home.y;
    state.caption.size = 1;
    if (els.sizeIn) els.sizeIn.value = 1;
    redraw();
  }

  /* ---------------------------------------------------------------- export */

  function exportPng() {
    var size = currentSize();
    say('Rendering ' + size.w + ' × ' + size.h + '…', 'busy');
    // let the status paint before a synchronous canvas render
    requestAnimationFrame(function () {
      var canvas = NS.renderToCanvas(size.w, size.h, sceneSnapshot());
      canvas.toBlob(function (blob) {
        if (!blob) {
          say('Export failed in this browser.', 'bad');
          return;
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vice-coast-cover-' + size.w + 'x' + size.h + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        say('Saved ' + a.download + ' (' + Math.round(blob.size / 1024) + ' KB).', 'good');
        document.documentElement.setAttribute('data-exported', a.download);
      }, 'image/png');
    });
  }

  /* --------------------------------------------------------------- wiring */

  function buildUi() {
    buildSegmented(els.layoutRow, NS.LAYOUTS, function (id) {
      state.layout = id;
      markSegmented(els.layoutRow, id);
      var home = NS.captionHome(id);
      state.caption.x = home.x;
      state.caption.y = home.y;
      syncPanels();
      els.layoutHint.textContent = NS.layoutById(id).blurb;
      refreshPanelFields();
      redraw();
    });
    markSegmented(els.layoutRow, state.layout);
    els.layoutHint.textContent = NS.layoutById(state.layout).blurb;

    buildSegmented(els.lookRow, NS.LOOKS, function (id) {
      state.look = id;
      markSegmented(els.lookRow, id);
      els.lookHint.textContent = NS.lookById(id).blurb;
      redraw();
    });
    markSegmented(els.lookRow, state.look);
    els.lookHint.textContent = NS.lookById(state.look).blurb;

    buildSegmented(els.sizeRow, NS.EXPORT_SIZES.map(function (s) {
      return { id: s.id, label: s.label };
    }), function (id) {
      state.sizeId = id;
      markSegmented(els.sizeRow, id);
      els.exportHint.textContent = currentSize().w + ' × ' + currentSize().h + ' PNG';
      redraw();
    });
    markSegmented(els.sizeRow, state.sizeId);
    els.exportHint.textContent = currentSize().w + ' × ' + currentSize().h + ' PNG';
  }

  function wireControls() {
    els.fileInput.addEventListener('change', function (ev) {
      handleFiles(ev.target.files);
      ev.target.value = '';
    });
    els.sampleBtn.addEventListener('click', loadSamples);
    els.clearBtn.addEventListener('click', clearPhotos);

    // drop photos anywhere on the editor too
    ['dragover', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (ev) {
        ev.preventDefault();
        if (type === 'drop' && ev.dataTransfer && ev.dataTransfer.files.length) {
          handleFiles(ev.dataTransfer.files);
        }
      });
    });

    els.titleIn.addEventListener('input', function () {
      state.title = els.titleIn.value;
      redraw();
    });
    els.subIn.addEventListener('input', function () {
      state.subtitle = els.subIn.value;
      redraw();
    });
    els.sizeIn.addEventListener('input', function () {
      state.caption.size = Number(els.sizeIn.value) || 1;
      redraw();
    });
    els.centerBtn.addEventListener('click', resetCaption);

    els.zoomIn.addEventListener('input', function () {
      var panel = state.panels[state.selected];
      panel.zoom = Number(els.zoomIn.value) || 1;
      redraw();
    });
    els.fillBtn.addEventListener('click', function () { setPanelMode('fill'); });
    els.fitBtn.addEventListener('click', function () { setPanelMode('fit'); });
    els.resetPanel.addEventListener('click', function () {
      var panel = state.panels[state.selected];
      panel.zoom = 1;
      panel.ox = 0;
      panel.oy = 0;
      refreshPanelFields();
      redraw();
    });
    els.prevPanel.addEventListener('click', function () { selectPanel(state.selected - 1); });
    els.nextPanel.addEventListener('click', function () { selectPanel(state.selected + 1); });

    els.panelPhoto.addEventListener('change', function () {
      var panel = state.panels[state.selected];
      panel.photoId = els.panelPhoto.value || null;
      redraw();
    });

    els.fillAllBtn.addEventListener('click', function () {
      var panel = state.panels[state.selected];
      if (!panel.photoId) {
        say('Pick a photo for this panel first.', 'bad');
        return;
      }
      state.panels.forEach(function (p) { p.photoId = panel.photoId; });
      redraw();
      say('Every panel now uses that photo.', 'good');
    });

    els.exportBtn.addEventListener('click', exportPng);
    els.exportTop.addEventListener('click', exportPng);

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'e' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        var tag = (ev.target && ev.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        exportPng();
      }
    });
  }

  function setPanelMode(mode) {
    var panel = state.panels[state.selected];
    panel.mode = mode;
    refreshPanelFields();
    redraw();
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    var ids = ['status', 'preview', 'fileInput', 'sampleBtn', 'clearBtn', 'photoList',
      'layoutRow', 'layoutHint', 'lookRow', 'lookHint', 'titleIn', 'subIn', 'sizeIn',
      'centerBtn', 'zoomIn', 'fillBtn', 'fitBtn', 'resetPanel', 'prevPanel', 'nextPanel',
      'panelPhoto', 'fillAllBtn', 'sizeRow', 'exportBtn', 'exportTop', 'exportHint',
      'panelName', 'stageInfo', 'barNote'];
    ids.forEach(function (id) { els[id] = el(id); });

    buildUi();
    wireControls();
    wireCanvas();
    syncPanels();
    refreshPhotos();
    refreshPanelFields();
    redraw();

    NS.fontsReady().then(redraw);

    if (shot === 'editor') {
      loadSamples().then(function () {
        document.documentElement.setAttribute('data-shot-ready', '1');
      });
      if (els.barNote) els.barNote.textContent = 'Screenshot mode — samples loaded.';
    } else {
      say('Add a photo to begin.', null);
    }
  }

  function start() {
    var cover = NS.shots.COVER_SPECS[shot];
    if (cover) {
      NS.shots.runCoverShot(shot, params);
      return;
    }
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
