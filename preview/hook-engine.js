// mount(host, spec, {base}) - base prefixes image layer paths.
(function () {
  var EASE = {
    linear: function (p) { return p; },
    out: function (p) { return 1 - Math.pow(1 - p, 3); },
    expo: function (p) { return p >= 1 ? 1 : 1 - Math.pow(2, -10 * p); },
    inout: function (p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; },
    back: function (p) { var c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    in: function (p) { return p * p * p; }
  };
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var loadedFonts = {}, mounts = 0;

  function loadFonts(list) {
    (list || []).forEach(function (f) {
      if (loadedFonts[f]) return; loadedFonts[f] = 1;
      var l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + '&display=block';
      document.head.appendChild(l);
    });
  }

  function styleText(el, s) {
    if (s.font) el.style.fontFamily = '"' + s.font + '", sans-serif';
    if (s.weight) el.style.fontWeight = s.weight;
    if (s.italic != null) el.style.fontStyle = s.italic ? 'italic' : 'normal';
    if (s.size) el.style.fontSize = s.size + 'px';
    if (s.tracking != null) el.style.letterSpacing = s.tracking + 'em';
    if (s.caps) el.style.textTransform = 'uppercase';
    if (s.color) el.style.color = s.color;
    if (s.gradient) { el.style.backgroundImage = s.gradient; el.style.webkitBackgroundClip = 'text'; el.style.backgroundClip = 'text'; el.style.color = 'transparent'; }
    if (s.stroke) { el.style.webkitTextStroke = s.stroke; el.style.paintOrder = 'stroke fill'; }
    if (s.shadow) el.style.textShadow = s.shadow;
    if (s.box) { el.style.background = s.box.bg; el.style.padding = (s.box.padY || 0) + 'px ' + (s.box.padX || 0) + 'px'; el.style.borderRadius = (s.box.radius || 0) + 'px'; el.style.boxDecorationBreak = el.style.webkitBoxDecorationBreak = 'clone'; }
    if (s.dy) el.style.verticalAlign = s.dy + 'px';
    if (s.css) el.style.cssText += ';' + s.css;
  }

  // Splits a run into the units that animate on their own (whole run, words or letters).
  function units(text, reveal) {
    if (reveal === 'letters') return Array.from(text);
    if (reveal === 'words') return text.split(/(\n|[^\S\n]+)/).filter(function (w) { return w.length; });
    return [text];
  }

  function mount(host, spec, opts) {
    opts = opts || {};
    loadFonts(spec.fonts);
    var uid = 'rpn' + (mounts++), streaks = {};
    host.innerHTML = '';
    var stage = document.createElement('div');
    stage.className = 'rpn-stage';
    stage.style.cssText = 'position:absolute;left:0;top:0;width:1080px;height:1920px;transform-origin:0 0;overflow:hidden;pointer-events:none';
    host.appendChild(stage);
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
    stage.appendChild(defs);
    // Sideways-only motion blur; filters are pooled per 2 px step.
    function streak(px) {
      var q = Math.round(px / 2) * 2; if (q <= 0) return '';
      if (!streaks[q]) {
        var f = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        f.id = uid + 'sx' + q; f.setAttribute('x', '-50%'); f.setAttribute('width', '200%');
        f.innerHTML = '<feGaussianBlur stdDeviation="' + q + ' 0"/>';
        defs.appendChild(f); streaks[q] = 'url(#' + f.id + ')';
      }
      return streaks[q];
    }
    var fit = function () { stage.style.transform = 'scale(' + host.clientWidth / 1080 + ')'; };
    fit(); new ResizeObserver(fit).observe(host);

    var pidx = 0;
    var layers = (spec.layers || []).map(function (L) {
      var el = document.createElement('div');
      el.style.cssText = 'position:absolute;white-space:pre;will-change:transform,opacity,filter';
      if (L.texture) {
        var ts = L.textureSize || 8;
        el.style.webkitMaskImage = el.style.maskImage = L.texture === 'scan' ? 'repeating-linear-gradient(#000 0 ' + ts / 2 + 'px, transparent ' + ts / 2 + 'px ' + ts + 'px)' : 'radial-gradient(circle, #000 52%, transparent 58%)';
        el.style.webkitMaskSize = el.style.maskSize = ts + 'px ' + ts + 'px';
      }
      el.style.lineHeight = L.lineHeight || 1;
      el.style.textAlign = L.align || 'center';
      styleText(el, L);
      if (L.box && !L.runs) el.style.display = 'inline-block';
      var parts = [];
      if (L.image) {
        var im = document.createElement('img');
        im.src = (opts.base || '') + L.image; im.style.width = (L.w || 300) + 'px'; im.style.display = 'block';
        el.appendChild(im); stage.appendChild(el);
        parts.push({ el: im, t: L.t0, i: pidx++ });
        return { L: L, el: el, parts: parts };
      }
      var runs = L.runs || [{ text: L.text || '' }];
      var step = L.step || 0.05, k = 0;
      runs.forEach(function (r) {
        var rs = document.createElement('span');
        styleText(rs, r);
        if (r.t != null) k = 0;
        units(r.text, L.reveal).forEach(function (u) {
          if (L.reveal && /\n/.test(u)) { rs.appendChild(document.createElement('br')); return; }
          var sp = document.createElement('span');
          sp.textContent = u;
          sp.style.display = 'inline-block';
          sp.style.whiteSpace = 'pre';
          var start = (r.t != null ? r.t : L.t0) + k * step;
          if (!/^\s+$/.test(u) && L.reveal) k++;
          parts.push({ el: sp, t: start, i: /^\s+$/.test(u) ? pidx : pidx++ });
          rs.appendChild(sp);
        });
        el.appendChild(rs);
        if (r.br) el.appendChild(document.createElement('br'));
      });
      stage.appendChild(el);
      return { L: L, el: el, parts: parts };
    });

    function place(o) {
      var L = o.L, w = o.el.offsetWidth, h = o.el.offsetHeight;
      o.el.style.left = (L.x != null ? L.x : 540) - w / 2 + 'px';
      o.el.style.top = (L.y != null ? L.y : 960) - h / 2 + 'px';
    }

    function enter(spec, p, el, i) {
      var e = EASE[spec.ease || 'out'](p), tr = '', op = spec.fade === false ? 1 : clamp(p * 2.5), fl = '';
      var d = spec.dist != null ? spec.dist : 200, dir = spec.from === 'cycle' ? ['left', 'right', 'up', 'down'][(i || 0) % 4] : spec.from || 'down';
      var dx = dir === 'left' ? -d : dir === 'right' ? d : 0, dy = dir === 'up' ? -d : dir === 'down' ? d : 0;
      switch (spec.type) {
        case 'slide': case 'drop': tr = 'translate(' + dx * (1 - e) + 'px,' + dy * (1 - e) + 'px)'; break;
        case 'pop': tr = 'scale(' + ((spec.s0 != null ? spec.s0 : .6) + (1 - (spec.s0 != null ? spec.s0 : .6)) * e) + ')'; break;
        case 'zoom': tr = 'scale(' + ((spec.s0 != null ? spec.s0 : 1.6) + (1 - (spec.s0 != null ? spec.s0 : 1.6)) * e) + ')'; break;
        case 'wipe': el.style.clipPath = wipe(dir, e); op = 1; break;
        case 'type': op = p > 0 ? 1 : 0; break;
        case 'none': op = p > 0 ? 1 : 0; break;
      }
      if (spec.blur) fl = 'blur(' + spec.blur * (1 - e) + 'px)';
      if (spec.blurX) fl += ' ' + streak(spec.blurX * (1 - e));
      return { tr: tr, op: op, fl: fl };
    }
    function wipe(dir, e) {
      var r = (1 - e) * 100;
      return dir === 'left' ? 'inset(0 ' + r + '% 0 0)' : dir === 'right' ? 'inset(0 0 0 ' + r + '%)' : dir === 'up' ? 'inset(0 0 ' + r + '% 0)' : 'inset(' + r + '% 0 0 0)';
    }
    function leave(spec, p) {
      var e = EASE[spec.ease || 'in'](p), d = spec.dist != null ? spec.dist : 200, dir = spec.to || 'up';
      var dx = dir === 'left' ? -d : dir === 'right' ? d : 0, dy = dir === 'up' ? -d : dir === 'down' ? d : 0;
      var r = { tr: '', op: spec.fade === false && spec.type !== 'cut' ? 1 : 1 - e, fl: (spec.blur ? 'blur(' + spec.blur * e + 'px)' : '') + (spec.blurX ? ' ' + streak(spec.blurX * e) : '') };
      if (spec.type === 'slide') r.tr = 'translate(' + dx * e + 'px,' + dy * e + 'px)';
      if (spec.type === 'zoom') r.tr = 'scale(' + (1 + ((spec.s1 || 1.4) - 1) * e) + ')';
      if (spec.type === 'cut') r.op = p > 0 ? 0 : 1;
      return r;
    }

    // keys: [{t, s, x, y, o, ease?, hold?}] - linear between keys unless the earlier key says hold.
    function keyAt(keys, t) {
      if (t <= keys[0].t) return keys[0];
      for (var i = 0; i < keys.length - 1; i++) {
        var a = keys[i], b = keys[i + 1];
        if (t < b.t) {
          if (a.hold) return a;
          var p = EASE[a.ease || 'linear']((t - a.t) / (b.t - a.t)), m = function (k, d) { var x = a[k] == null ? d : a[k], y = b[k] == null ? d : b[k]; return x + (y - x) * p; };
          return { s: m('s', 1), x: m('x', 0), y: m('y', 0), o: m('o', 1), bx: m('bx', 0) };
        }
      }
      return keys[keys.length - 1];
    }

    function render(t) {
      layers.forEach(function (o) {
        var L = o.L, on = t >= L.t0 && t < L.t1;
        o.el.style.display = on ? '' : 'none';
        if (!on) return;
        place(o);
        var IN = L.in || { type: 'none' }, dur = IN.dur || 0.001;
        o.parts.forEach(function (pt) {
          // A wipe on a whole layer clips the layer itself, so its box is swept in too.
          var a = enter(IN, clamp((t - pt.t) / dur), IN.type === 'wipe' && !L.reveal ? o.el : pt.el, pt.i);
          pt.el.style.opacity = t < pt.t ? 0 : a.op;
          pt.el.style.transform = a.tr;
          pt.el.style.filter = a.fl.trim() || 'none';
        });
        var tr = '', op = 1, fl = '';
        if (L.move) {
          var m = clamp((t - L.t0) / Math.max(L.t1 - L.t0, .001));
          if (L.move.scale) tr += ' scale(' + (L.move.scale[0] + (L.move.scale[1] - L.move.scale[0]) * m) + ')';
          if (L.move.x) tr += ' translateX(' + (L.move.x[0] + (L.move.x[1] - L.move.x[0]) * m) + 'px)';
          if (L.move.y) tr += ' translateY(' + (L.move.y[0] + (L.move.y[1] - L.move.y[0]) * m) + 'px)';
        }
        if (L.out && L.out.type) {
          var od = L.out.dur || 0.2, lv = leave(L.out, clamp((t - (L.t1 - od)) / od));
          tr += ' ' + lv.tr; op = lv.op; fl = lv.fl;
        }
        if (L.keys) {
          var k = keyAt(L.keys, t);
          o.el.style.transformOrigin = L.origin ? (L.origin[0] - parseFloat(o.el.style.left)) + 'px ' + (L.origin[1] - parseFloat(o.el.style.top)) + 'px' : '50% 50%';
          tr = 'translate(' + (k.x || 0) + 'px,' + (k.y || 0) + 'px) scale(' + (k.s == null ? 1 : k.s) + ') ' + tr;
          if (k.o != null) op *= k.o;
          if (k.bx) fl += ' ' + streak(k.bx);
        }
        if (L.rotate) tr += ' rotate(' + L.rotate + 'deg)';
        if (L.stretch) tr += ' scaleX(' + L.stretch + ')';
        o.el.style.transform = tr;
        o.el.style.opacity = op;
        o.el.style.filter = fl.trim() || 'none';
      });
    }
    // Resolves once every font the spec names has actually loaded (fonts.ready alone can fire before the stylesheet arrives).
    var faces = [];
    (spec.layers || []).forEach(function (L) { [L].concat(L.runs || []).forEach(function (r) { if (r.font || L.font) faces.push((r.italic || (r.italic == null && L.italic) ? 'italic ' : '') + (r.weight || L.weight || 400) + ' 40px "' + (r.font || L.font) + '"'); }); });
    var ready = new Promise(function (ok) { setTimeout(ok, 50); }).then(function () {
      return Promise.all(Array.from(document.querySelectorAll('link[href*="fonts.googleapis"]')).map(function (l) { return l.sheet ? 0 : new Promise(function (r) { l.addEventListener('load', r); l.addEventListener('error', r); }); }));
    }).then(function () { return Promise.all(faces.filter(function (f, i) { return faces.indexOf(f) === i; }).map(function (f) { return document.fonts.load(f).catch(function () {}); })); }).then(function () { return document.fonts.ready; });
    return { render: render, ready: ready };
  }
  window.RpnHook = { mount: mount };
})();
