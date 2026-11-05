(function () {
  var FX = window.FX, W = FX.W, H = FX.H, S = FX.subject;
  FX.effects.forEach(function (e) { if (e.t0 + e.dur >= FX.duration - 0.06) e.dur = FX.duration + 1 - e.t0; });
  var tl = gsap.timeline({ paused: true });
  var $ = function (id) { return document.getElementById(id); };
  var L = { under: $('under'), cam: $('cam'), camfx: $('camfx'), behind: $('behind'), front: $('front') };
  var TGG = '#ff3d2e', TGP = '#ffffff';
  var HX = S.head[0] * W, HY = S.head[1] * H, HW = Math.max(160, S.headW * W);
  var OX = FX.wide ? FX.wide.ox : 0;
  var TOP = S.box[1] * H, BCX = (S.box[0] + S.box[2] / 2) * W, BCY = (S.box[1] + S.box[3] / 2) * H;
  // A timeline set at exactly 0 is undone in HyperFrames export (hid scene 1's cut-out), so 0:00 sets are the start state; same-instant sets merge.
  var SETS = new Map();
  function set(t, vars, at) {
    if (Array.isArray(t)) return t.forEach(function (x) { set(x, vars, at); });
    if ((+at || 0) <= 0.0005) return gsap.set(t, vars);
    var k = (+at || 0).toFixed(3), m = SETS.get(t) || {}, prev = m[k];
    if (prev) { tl.remove(prev.tw); vars = Object.assign({}, prev.vars, vars); }
    SETS.set(t, m);
    m[k] = { vars: vars, tw: tl.set(t, vars, +at || 0) };
  }
  var CAM0 = { scale: 1, x: 0, y: 0, opacity: 1, filter: 'blur(0px) saturate(1)', clipPath: 'inset(0px 0px 0px 0px round 0px)', borderRadius: '0px' };

  function el(tag, cls, parent, css, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (css) d.setAttribute('style', css);
    if (html != null) d.innerHTML = html;
    if (parent) parent.appendChild(d);
    return d;
  }
  function box(layer, e) {
    var d = el('div', 'fxbox', L[layer]);
    d.dataset.fx = e.fx; d.dataset.k = e.k;
    if (e.params && (e.params.dx || e.params.dy)) d.style.translate = (+e.params.dx || 0) + 'px ' + (+e.params.dy || 0) + 'px';
    if (e.params && e.params.scale && +e.params.scale !== 1) d.style.scale = +e.params.scale;
    set(d, { opacity: 1 }, e.t0);
    set(d, { opacity: 0 }, e.t0 + e.dur);
    return d;
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function list(v, d) { return Array.isArray(v) && v.length ? v : d; }
  function text(v) { return typeof v === 'string' ? v : v && v.text != null ? v.text : ''; }
  function end(e) { return e.t0 + e.dur; }
  var seen = new Set(), CUR_END = Infinity;
  function to(t, from, dest, at, dur, ease) {
    if (t === L.cam && at + dur > CUR_END) dur = Math.max(0.01, CUR_END - 0.01 - at);
    if (t !== L.cam && !seen.has(t) && (from.opacity === 0 || 'strokeDashoffset' in from || 'clipPath' in from)) { seen.add(t); gsap.set(t, from); }
    return tl.fromTo(t, from, Object.assign({ duration: dur, ease: ease || 'power3.out', immediateRender: false }, dest), at);
  }
  function drive(e, fn, start, len) { var p = { v: 0 }; tl.fromTo(p, { v: 0 }, { v: 1, duration: len || e.dur, ease: 'none', immediateRender: false, onUpdate: function () { fn(p.v); } }, start == null ? e.t0 : start); fn(0); }
  function camReset(e, extra) { if (FX.effects.some(function (q) { return q !== e && ['split-top', 'split-screen', 'title-stack', 'face-bubble', 'full-picture'].indexOf(q.fx) >= 0 && Math.abs(q.t0 - end(e)) < 0.02; })) return; set(L.cam, Object.assign({}, CAM0, extra || {}), end(e)); }
  function origin(x, y) { return x + 'px ' + y + 'px'; }
  function flash(e, at, peak) {
    var f = el('div', 'abs', L.camfx, 'left:0;top:0;width:100%;height:100%;background:#fff;opacity:0');
    to(f, { opacity: peak || 0.35 }, { opacity: 0 }, at, 0.16, 'power1.out');
    set(f, { opacity: 0 }, Math.max(at + 0.17, end(e) - 0.01));
  }
  function mw(e, c) { return $('mw' + e.k + (c ? 'c' + c : '')); }
  function typing(parent, str, at, per, css) {
    var spans = [];
    for (var i = 0; i < str.length; i++) {
      var s = el('span', null, parent, 'opacity:0;' + (css || ''), esc(str[i]).replace(' ', '&nbsp;'));
      set(s, { opacity: 1 }, at + i * per);
      spans.push(s);
    }
    return at + str.length * per;
  }
  function stack(parent, values, times, css) {
    var wrap = el('span', null, parent, 'position:relative;display:inline-block;' + (css || ''));
    values.forEach(function (v, i) {
      var s = el('span', null, wrap, i ? 'position:absolute;left:0;top:0;opacity:0' : '', esc(v));
      if (i) { set(s, { opacity: 1 }, times[i]); set(wrap.children[i - 1], { opacity: 0 }, times[i]); }
    });
    return wrap;
  }

  var E = {};

  E['headline-wall'] = function (e, a, p) {
    var b = box('front', e);
    var items = list(p.items, ['Claude just edited this whole reel', 'No CapCut. No editor.', 'AI video editing is here', 'One prompt, finished video']).slice(0, 4);
    var cw = 390, gap = Math.max(20, HX - HW * 0.75 - cw);
    var hy = p.y != null ? +p.y : Math.max(110, TOP - 260);
    var spots = [[30, hy, -5], [W - cw - 30, hy + 30, 4], [Math.min(gap, 40), HY - 30, 3], [W - cw - 30, HY - 10, -3]];
    items.forEach(function (it, i) {
      var s = spots[i], c;
      var img = a.images && a.images[i];
      if (img) { c = el('div', 'card', b, 'left:' + s[0] + 'px;top:' + s[1] + 'px;width:' + cw + 'px;height:300px;padding:0;overflow:hidden'); el('img', 'cover', c).src = img; }
      else c = el('div', 'card', b, 'left:' + s[0] + 'px;top:' + s[1] + 'px;width:' + cw + 'px', '<small>' + esc(p.kicker || 'Today · 2 min read') + '</small><b>' + esc(text(it)) + '</b>');
      to(c, { opacity: 0, scale: 0.55, y: 50, rotation: s[2] * 3 }, { opacity: 1, scale: 1, y: 0, rotation: s[2] }, e.t0 + i * 0.16, 0.5, 'back.out(1.6)');
      to(c, { opacity: 1 }, { opacity: 0, y: -20 }, end(e) - 0.25, 0.22, 'power1.in');
    });
  };

  E.orbit = function (e, a) {
    var back = box('behind', e), front = box('front', e);
    var imgs = list(a.images, []), n = Math.max(5, Math.min(7, imgs.length || 6));
    var pairs = [];
    for (var i = 0; i < n; i++) {
      var css = 'left:0;top:0;width:230px;height:410px';
      var c1 = el('div', 'phone', back, css), c2 = el('div', 'phone', front, css);
      if (imgs.length) { el('img', null, c1).src = imgs[i % imgs.length]; el('img', null, c2).src = imgs[i % imgs.length]; }
      pairs.push([c1, c2]);
    }
    var rx = Math.max(HW * 1.4, W * 0.5), ry = HW * 0.55, cy = HY + HW * 0.35;
    drive(e, function (v) {
      var t = v * e.dur, grow = Math.min(1, t / 0.45), fade = Math.min(1, (e.dur - t) / 0.3);
      pairs.forEach(function (pr, i) {
        var th = (i / n) * Math.PI * 2 + t * 1.9;
        var depth = Math.sin(th), sc = (0.62 + 0.38 * (depth + 1) / 2) * grow;
        var x = HX + Math.cos(th) * rx * (0.6 + 0.4 * grow) - 115, y = cy + depth * ry - 205;
        var tf = 'translate(' + x + 'px,' + y + 'px) scale(' + sc + ') rotate(' + (Math.cos(th) * -8) + 'deg)';
        pr[0].style.transform = pr[1].style.transform = tf;
        pr[0].style.opacity = depth < 0 ? fade : 0;
        pr[1].style.opacity = depth >= 0 ? fade : 0;
      });
    });
  };

  E['digital-zoom'] = function (e, a, p) {
    var m = p && p.meBg && mw(e), zs = m ? [L.cam, m] : [L.cam];
    if (m) {
      var u = box('under', e), bv = /\.(mp4|webm|mov)(\?|$)/i.test(p.meBg), bg = el(bv ? 'video' : 'img', 'cover', u, 'filter:blur(' + (+p.meBlur || 0) + 'px);transform:scale(' + (+p.meBlur ? 1.08 : 1) + ')');
      bg.src = p.meBg; if (bv) { bg.muted = true; bg.loop = true; syncClip(bg, e); }
      set(L.cam, { opacity: 0 }, e.t0); set(L.cam, { opacity: 1 }, end(e)); set(m, { opacity: 1 }, e.t0); set(m, { opacity: 1, scale: 1 }, end(e));
      zs.push(bg);
    }
    zs.forEach(function (z) {
      set(z, { transformOrigin: origin(HX, HY) }, e.t0);
      to(z, { scale: 1 }, { scale: 1.3 }, e.t0, 0.07, 'power2.out');
      to(z, { scale: 1.3 }, { scale: 1.65 }, e.t0 + e.dur * 0.45, 0.07, 'power2.out');
      to(z, { scale: 1.65 }, { scale: 1 }, end(e) - 0.14, 0.13, 'power2.inOut');
    });
    flash(e, e.t0, 0.25); flash(e, e.t0 + e.dur * 0.45, 0.2);
    camReset(e);
  };

  E.spotlight = function (e) {
    var b = box('front', e);
    var rx = HW * 1.15, ry = HW * 1.75;
    var d = el('div', 'abs', b, 'left:0;top:0;width:100%;height:100%;background:radial-gradient(ellipse ' + rx + 'px ' + ry + 'px at ' + HX + 'px ' + (HY + HW * 0.45) + 'px, rgba(0,0,0,0) 0%, rgba(0,0,0,.1) 45%, rgba(0,0,0,.94) 100%)');
    to(d, { opacity: 0 }, { opacity: 1 }, e.t0, 0.09, 'none');
    to(d, { opacity: 1 }, { opacity: 0 }, end(e) - 0.3, 0.28, 'power1.in');
    set(L.cam, { transformOrigin: origin(HX, HY) }, e.t0);
    to(L.cam, { scale: 1 }, { scale: 1.06 }, e.t0, e.dur, 'none');
    camReset(e);
  };

  E.checklist = function (e, a, p) {
    var b = box('front', e);
    var items = list(p.items, ['Record your video', 'Drop the clips into Claude', 'Tell it to use the skill']).slice(0, 5);
    var n = items.length, card = el('div', 'glass', b, 'left:50px;top:' + (p.y != null ? +p.y : Math.max(200, TOP - 360)) + 'px;width:640px;padding:30px 32px');
    var times = items.map(function (it, i) { return it && it.t != null ? it.t : e.t0 + 0.55 + (i * (e.dur - 0.9)) / n; });
    var head = el('div', 'mono', card, 'display:flex;justify-content:space-between;font-size:22px;letter-spacing:.14em;color:rgba(255,255,255,.6);margin-bottom:22px');
    el('span', null, head, '', esc((p.title || 'Steps').toUpperCase()));
    var cnt = el('span', null, head);
    stack(cnt, items.map(function (_, i) { return i + ' of ' + n; }).concat([n + ' of ' + n]), [0].concat(times));
    items.forEach(function (it, i) {
      var r = el('div', 'row', card, 'margin-top:' + (i ? 20 : 0) + 'px;opacity:.5;font-size:38px');
      var tk = el('span', 'tick', r, '', '<i></i>');
      var tx = el('span', null, r, '', esc(text(it)));
      if (p.reveal) to(tx, { opacity: 0, x: -14 }, { opacity: 1, x: 0 }, times[i], 0.3, 'power2.out');
      to(tk.firstChild, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1 }, times[i], 0.28, 'back.out(2.4)');
      to(r, { opacity: 0.5 }, { opacity: 1 }, times[i], 0.2, 'none');
    });
    to(card, { opacity: 0, x: -60 }, { opacity: 1, x: 0 }, e.t0, 0.4);
    to(card, { opacity: 1 }, { opacity: 0, x: -40 }, end(e) - 0.25, 0.22, 'power1.in');
  };

  E['index-panel'] = function (e, a, p) {
    var b = box('front', e), items = list(p.items, ['One', 'Two', 'Three']).slice(0, 24), n = items.length, PW = 350, PL = W - 40 - PW, PT = p.y != null ? +p.y : 340;
    var rowH = Math.min(46, Math.floor(570 / n)), fs = Math.round(rowH * 0.58);
    var times = items.map(function (it, i) { return it && it.t != null ? it.t : e.t0 + 0.3 + (i * (e.dur - 0.6)) / n; });
    var card = el('div', null, b, 'position:absolute;left:' + PL + 'px;top:' + PT + 'px;width:' + PW + 'px;box-sizing:border-box;padding:24px 12px 22px;background:rgba(var(--t-bg-rgb),.93);border:2px solid rgba(var(--t-text-rgb),.2);border-radius:22px;box-shadow:0 18px 40px rgba(0,0,0,.4);color:var(--t-text);font-family:Inter,sans-serif');
    var head = el('div', null, card, 'position:relative;height:30px;margin:0 12px 8px;font:500 15px/30px "JetBrains Mono",ui-monospace,monospace;letter-spacing:.2em;color:rgba(var(--t-text-rgb),.62)');
    el('span', null, head, 'position:absolute;left:0;top:0', 'IN THIS VIDEO');
    el('i', null, head, 'position:absolute;left:0;right:0;bottom:-3px;height:4px;border-radius:2px;background:var(--t-grad)');
    var prev = el('span', null, head, 'position:absolute;right:0;top:0', '0 / ' + n);
    items.forEach(function (_, i) {
      var c = el('span', null, head, 'position:absolute;right:0;top:0;opacity:0', (i + 1) + ' / ' + n);
      set(c, { opacity: 1 }, times[i]); set(prev, { opacity: 0 }, times[i]); prev = c;
    });
    items.forEach(function (it, i) {
      var r = el('div', null, card, 'position:relative;height:' + rowH + 'px;display:flex;align-items:center;padding-left:12px;box-sizing:border-box');
      var pill = el('div', null, r, 'position:absolute;left:0;right:0;top:0;bottom:0;border-radius:11px;background:var(--t-accent);opacity:0');
      var num = el('span', null, r, 'position:relative;width:34px;flex:none;font:500 ' + Math.round(fs * 0.5) + 'px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.04em;color:rgba(var(--t-text-rgb),.55)', ('0' + (i + 1)).slice(-2));
      var name = el('span', null, r, 'position:relative;font:600 ' + fs + 'px/1 Inter,sans-serif;color:var(--t-text);white-space:nowrap', esc(text(it)));
      var on = times[i], off = times[i + 1] != null ? times[i + 1] : end(e);
      set(pill, { opacity: 1 }, on); set(pill, { opacity: 0 }, off);
      set(name, { color: 'var(--t-on-accent)' }, on); set(name, { color: 'var(--t-text)' }, off);
      set(num, { color: 'color-mix(in srgb, var(--t-on-accent) 60%, transparent)' }, on); set(num, { color: 'rgba(var(--t-text-rgb),.55)' }, off);
    });
    el('div', null, card, 'height:1.5px;margin:12px 12px 14px;background:rgba(var(--t-text-rgb),.2)');
    el('div', null, card, 'margin:0 12px;font:800 25px/1.2 Inter,sans-serif;color:var(--t-text)', esc(p.total || '40+ total effects'));
    to(card, { opacity: 0, x: 50 }, { opacity: 1, x: 0 }, e.t0, 0.4);
    to(card, { opacity: 1 }, { opacity: 0, x: 30 }, end(e) - 0.25, 0.22, 'power1.in');
  };

  E['freeze-label'] = function (e, a, p) {
    var still = el('img', 'cover', L.camfx, 'opacity:0');
    still.src = a.freeze;
    set(still, { opacity: 1, filter: 'saturate(.85) contrast(1.05)' }, e.t0);
    to(still, { scale: 1 }, { scale: 1.04 }, e.t0, e.dur, 'none');
    set(still, { opacity: 0 }, end(e));
    flash(e, e.t0, 0.5);
    var b = box('front', e);
    var labels = list(p.labels, [{ text: "can't edit", x: (HX - HW * 0.3) / W, y: (HY + HW * 0.35) / H }, { text: 'Claude did this', x: (HX + HW * 0.25) / W, y: (TOP + HW * 0.12) / H }]).slice(0, 4);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('style', 'position:absolute;left:0;top:0');
    b.appendChild(svg);
    labels.forEach(function (lb, i) {
      var tx = (lb.x != null ? lb.x : 0.5) * W, ty = (lb.y != null ? lb.y : 0.35) * H;
      var left = tx < W / 2, px = left ? Math.max(40, tx - 330) : Math.min(W - 360, tx + 90), py = ty + (i % 2 ? -150 : 120);
      var pill = el('div', 'pill', b, 'left:' + px + 'px;top:' + py + 'px', '<em>0' + (i + 1) + '</em>' + esc(text(lb)));
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      var lx = left ? px + 300 : px + 20, ly = py + 33;
      line.setAttribute('d', 'M' + lx + ' ' + ly + ' L' + tx + ' ' + ty);
      line.setAttribute('pathLength', '1');
      line.setAttribute('style', 'fill:none;stroke:#fff;stroke-width:4;stroke-dasharray:1;stroke-dashoffset:1');
      svg.appendChild(line);
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', tx); dot.setAttribute('cy', ty); dot.setAttribute('r', 11);
      dot.setAttribute('style', 'fill:' + TGP + ';stroke:#111;stroke-width:3;opacity:0');
      svg.appendChild(dot);
      var at = e.t0 + 0.2 + i * 0.35;
      to(dot, { opacity: 0 }, { opacity: 1 }, at, 0.1, 'none');
      to(line, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, at, 0.25, 'power2.out');
      to(pill, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, at + 0.18, 0.35, 'back.out(2)');
    });
  };

  E['before-after'] = function (e, a, p) {
    var wrap = $('bw' + e.k), b = box('front', e);
    if (wrap) wrap.style.filter = 'saturate(.45) contrast(.82) brightness(.97)';
    var line = el('div', 'abs', b, 'left:0;top:0;width:6px;height:100%;background:#fff;box-shadow:0 0 18px rgba(0,0,0,.4)');
    var knob = el('div', 'abs', b, 'top:' + (H * 0.58) + 'px;width:76px;height:76px;margin-left:-35px;border-radius:50%;background:#fff;color:#111;display:flex;align-items:center;justify-content:center;font:800 30px/1 Inter', '&lsaquo;&rsaquo;');
    var lb = el('div', 'tag', b, 'left:40px;top:' + (H * 0.68) + 'px', esc(p.before || 'before'));
    var la = el('div', 'tag on', b, 'right:40px;top:' + (H * 0.68) + 'px;opacity:0', esc(p.after || 'after'));
    var d = e.dur;
    drive(e, function (v) {
      var t = v * d, x;
      if (t < d * 0.2) x = W;
      else if (t < d * 0.45) x = W - (W * 0.5) * gsap.parseEase('power2.inOut')((t - d * 0.2) / (d * 0.25));
      else if (t < d * 0.65) x = W * 0.5;
      else x = W * 0.5 * (1 - gsap.parseEase('power2.inOut')(Math.min(1, (t - d * 0.65) / (d * 0.3))));
      if (wrap) wrap.style.clipPath = 'inset(0px ' + (W - x) + 'px 0px 0px)';
      line.style.transform = knob.style.transform = 'translateX(' + (x - 3) + 'px)';
      line.style.opacity = knob.style.opacity = x > 2 && x < W - 2 ? 1 : 0;
      lb.style.opacity = x > 200 ? 1 : 0;
      la.style.opacity = x < W - 200 ? 1 : 0;
    });
  };

  E['logo-float'] = function (e, a, p) {
    var b = box('behind', e), items = list(p.items, []).slice(0, 4);
    var spots = [[60, 330, 430, -8], [W - 470, 260, 430, 7], [80, 900, 300, 5], [W - 360, 860, 300, -6]];
    items.forEach(function (it, i) {
      var s = spots[i], t0 = it.t != null ? Math.max(e.t0, it.t) : e.t0 + i * 0.35;
      var d = el('div', 'abs', b, 'left:' + (it.x != null ? it.x : s[0]) + 'px;top:' + (it.y != null ? it.y : s[1]) + 'px;width:' + (it.size || s[2]) + 'px;height:' + (it.size || s[2]) + 'px;filter:drop-shadow(0 30px 60px rgba(0,0,0,.35))');
      el('img', null, d, 'width:100%;height:100%;object-fit:contain').src = it.src;
      var cut = p.still, in0 = cut ? 0 : 0.55, bob = { v: 0 };
      if (cut) d.style.rotate = s[3] + 'deg';
      else to(d, { opacity: 0, scale: 0.4, y: 80, rotation: s[3] * 3 }, { opacity: 1, scale: 1, y: 0, rotation: s[3] }, t0, 0.55, 'back.out(1.7)');
      tl.fromTo(bob, { v: 0 }, { v: 1, duration: Math.max(0.1, end(e) - t0 - in0), ease: 'none', immediateRender: false, onUpdate: function () { d.style.translate = '0px ' + (Math.sin(bob.v * Math.PI * 2 * (end(e) - t0) / 2.4 + i * 2) * 14).toFixed(1) + 'px'; } }, t0 + in0);
      if (!cut) to(d, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.7, y: -40 }, end(e) - 0.35, 0.3, 'power2.in');
    });
  };

  E['couch-wall'] = function (e, a) {
    var b = box('behind', e), imgs = list(a.images, []);
    var cols = 4, rows = 3, tw = 238, th = 360, gx = (W - cols * tw) / (cols + 1), y0 = Math.max(60, TOP - 380);
    var k = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x = gx + c * (tw + gx), y = y0 + r * (th + 26);
      var t = el('div', 'phone', b, 'left:' + x + 'px;top:' + y + 'px;width:' + tw + 'px;height:' + th + 'px;border-width:5px;border-radius:20px');
      if (imgs.length) el('img', null, t).src = imgs[k % imgs.length];
      var rot = ((k * 37) % 7) - 3, dist = Math.abs(c - 1.5) + Math.abs(r - 1);
      to(t, { opacity: 0, scale: 0.3, rotation: rot * 4 }, { opacity: 1, scale: 1, rotation: rot }, e.t0 + dist * 0.09, 0.45, 'back.out(1.5)');
      to(t, { opacity: 1 }, { opacity: 0, scale: 0.9 }, end(e) - 0.25 + dist * 0.02, 0.2, 'power1.in');
      k++;
    }
  };

  E['ui-world'] = function (e, a, p) {
    var u = box('under', e);
    el('div', 'abs', u, 'left:0;top:0;width:100%;height:100%;background:#f4f1ea');
    var s = 0.6, dy = 170;
    set(L.cam, { transformOrigin: '50% 50%' }, e.t0);
    to(L.cam, { scale: 1, y: 0, borderRadius: '0px' }, { scale: s, y: dy, borderRadius: '70px' }, e.t0, 0.5, 'power3.inOut');
    to(L.cam, { scale: s, y: dy, borderRadius: '70px' }, { scale: 1, y: 0, borderRadius: '0px' }, end(e) - 0.4, 0.38, 'power3.inOut');
    camReset(e);
    var b = box('front', e);
    var top = H / 2 - (H * s) / 2 + dy - 300;
    var c = el('div', 'composer', b, 'left:110px;top:' + top + 'px;width:860px;height:220px;padding:34px 38px');
    var line = el('div', null, c, 'font:500 40px/1.3 Inter;color:#222;height:110px');
    var str = p.prompt || 'Edit my reel in my style';
    var done = typing(line, str, e.t0 + 0.55, Math.min(0.07, (e.dur - 1.4) / Math.max(1, str.length)));
    var caret = el('span', null, line, 'display:inline-block;width:3px;height:44px;background:#222;vertical-align:-8px;margin-left:2px');
    el('div', 'abs', c, 'left:38px;bottom:26px;font:400 44px/1 Inter;color:#888', '+');
    var send = el('div', 'abs', c, 'right:30px;bottom:24px;width:62px;height:62px;border-radius:50%;background:#1d1d1f;color:#fff;display:flex;align-items:center;justify-content:center;font:700 32px/1 Inter', '&uarr;');
    to(send, { scale: 1 }, { scale: 0.82 }, done + 0.1, 0.1, 'power2.out');
    to(send, { scale: 0.82, backgroundColor: '#1d1d1f' }, { scale: 1, backgroundColor: '#d97757' }, done + 0.2, 0.2, 'back.out(3)');
    set(caret, { opacity: 0 }, done + 0.1);
    to(c, { opacity: 0, y: -40 }, { opacity: 1, y: 0 }, e.t0 + 0.2, 0.4);
    to(c, { opacity: 1, y: 0 }, { opacity: 0, y: -40 }, end(e) - 0.45, 0.25, 'power2.in');
  };

  E['frame-break'] = function (e) {
    var u = box('under', e);
    el('div', 'abs', u, 'left:0;top:0;width:100%;height:100%;background:radial-gradient(circle at 50% 40%, #2a2d34, #0b0c0f 70%)');
    var s = 0.74, ox = W / 2, oy = H * 0.56;
    var it = Math.max(80, TOP + HW * 0.55), side = 110, bot = 150;
    var clipTo = 'inset(' + it + 'px ' + side + 'px ' + bot + 'px ' + side + 'px round 80px)';
    var clip0 = 'inset(0px 0px 0px 0px round 0px)';
    [L.cam, mw(e)].forEach(function (t, i) {
      set(t, { transformOrigin: origin(ox, oy) }, e.t0);
      to(t, { scale: 1 }, { scale: s }, e.t0, 0.5, 'power3.inOut');
      to(t, { scale: s }, { scale: 1 }, end(e) - 0.4, 0.38, 'power3.inOut');
      if (!i) {
        to(t, { clipPath: clip0 }, { clipPath: clipTo }, e.t0, 0.5, 'power3.inOut');
        to(t, { clipPath: clipTo }, { clipPath: clip0 }, end(e) - 0.4, 0.38, 'power3.inOut');
      }
    });
    camReset(e);
    var b = box('behind', e);
    var x = ox + (side - ox) * s, y = oy + (it - oy) * s, w = (W - 2 * side) * s, h = (H - it - bot) * s;
    var bez = el('div', 'abs', b, 'left:' + (x - 16) + 'px;top:' + (y - 16) + 'px;width:' + (w + 32) + 'px;height:' + (h + 32) + 'px;border:16px solid #16171a;border-radius:' + (80 * s + 16) + 'px;box-shadow:0 0 0 2px #3a3c42, 0 40px 90px rgba(0,0,0,.6)');
    to(bez, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1 }, e.t0 + 0.15, 0.4);
    to(bez, { opacity: 1 }, { opacity: 0 }, end(e) - 0.4, 0.2, 'none');
  };

  E['phone-mockup'] = function (e, a, p) {
    var b = box('front', e);
    var ph = el('div', 'abs', b, 'left:' + (W - 500) + 'px;top:' + Math.max(380, HY - 120) + 'px;width:430px;height:880px;border-radius:64px;background:#0c0c0e;padding:16px;box-shadow:0 40px 90px rgba(0,0,0,.6), inset 0 0 0 3px #2c2c30');
    var scr = el('div', 'abs', ph, 'left:16px;top:16px;right:16px;bottom:16px;border-radius:50px;overflow:hidden;background:#111');
    if (p.lines && p.lines.length) {
      el('div', null, scr, 'padding:70px 34px 20px;font:800 40px/1.1 Inter;color:#fff', esc(p.title || 'Today'));
      p.lines.slice(0, 6).forEach(function (ln, i) {
        var r = el('div', null, scr, 'margin:14px 24px;padding:24px;border-radius:22px;background:#1f1f23;font:600 26px/1.25 Inter;color:#eee', esc(text(ln)));
        to(r, { opacity: 0, x: 40 }, { opacity: 1, x: 0 }, e.t0 + 0.5 + i * 0.15, 0.3);
      });
    } else if (a.images && a.images[0]) el('img', 'cover', scr).src = a.images[0];
    el('div', 'abs', scr, 'left:50%;top:18px;width:120px;height:34px;margin-left:-60px;border-radius:20px;background:#000');
    to(ph, { x: 560, rotation: 14 }, { x: 0, rotation: -6 }, e.t0, 0.55, 'power3.out');
    to(ph, { x: 0, rotation: -6 }, { x: 600, rotation: 10 }, end(e) - 0.35, 0.33, 'power3.in');
    set(L.cam, { transformOrigin: '50% 50%' }, e.t0);
    to(L.cam, { x: 0, scale: 1 }, { x: -100, scale: 1.2 }, e.t0, 0.55, 'power3.out');
    to(L.cam, { x: -100, scale: 1.2 }, { x: 0, scale: 1 }, end(e) - 0.35, 0.33, 'power3.in');
    camReset(e);
  };

  E['zoom-through'] = function (e) {
    var mid = e.t0 + Math.min(0.28, e.dur * 0.4);
    set(L.cam, { transformOrigin: origin(HX, HY) }, e.t0);
    to(L.cam, { scale: 1, filter: 'blur(0px) saturate(1)' }, { scale: 3, filter: 'blur(22px) saturate(1)' }, e.t0, mid - e.t0, 'power3.in');
    to(L.cam, { scale: 1.9, filter: 'blur(22px) saturate(1)' }, { scale: 1, filter: 'blur(0px) saturate(1)' }, mid, end(e) - mid - 0.02, 'power3.out');
    flash(e, mid - 0.05, 0.6);
    camReset(e);
  };

  E['chart-grow'] = function (e, a, p) {
    var b = box('front', e);
    var vals = list(p.values, [12, 14, 13, 18, 26, 44, 80]).map(Number);
    var cw = +p.w || 900, ch = +p.h || 460, x0 = (W - cw) / 2, y0 = p.y != null ? +p.y : Math.min(H - 900, HY + HW * 0.3);
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pts = vals.map(function (v, i) { return [i * cw / (vals.length - 1), ch - ((v - mn) / (mx - mn || 1)) * ch * 0.9 - ch * 0.05]; });
    var xs = list(p.xs, []);
    if (p.title || xs.length) {
      var pan = el('div', 'abs', b, 'left:' + (x0 - 70) + 'px;top:' + (y0 - (p.title ? 190 : 70)) + 'px;width:' + (cw + 140) + 'px;height:' + (ch + (p.title ? 190 : 70) + (xs.length ? 120 : 60)) + 'px;border-radius:36px;background:rgba(10,10,14,.62);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);border:2px solid rgba(255,255,255,.22)');
      if (p.title) el('div', 'abs', pan, 'left:50px;top:34px;color:#fff;font:800 54px/1 Inter,sans-serif;letter-spacing:-.02em', esc(p.title) + (p.sub ? '<div style="font:600 30px/1.3 Inter,sans-serif;color:rgba(255,255,255,.6);margin-top:10px;letter-spacing:0">' + esc(p.sub) + '</div>' : ''));
      xs.forEach(function (t, i) { var q = pts[i]; if (!q) return; var xl = el('div', 'abs', pan, 'left:' + (q[0] + 70 - 90) + 'px;top:' + ((p.title ? 190 : 70) + ch + 34) + 'px;width:180px;text-align:center;color:rgba(255,255,255,.75);font:700 28px/1.1 Inter,sans-serif;opacity:0', esc(t)); to(xl, { opacity: 0 }, { opacity: 1 }, e.t0 + 0.15 + (i / (pts.length - 1)) * Math.min(1.8, e.dur * 0.6), 0.12, 'none'); });
      to(pan, { opacity: 0, y: 30 }, { opacity: 1, y: 0 }, e.t0, 0.3, 'power2.out');
      to(pan, { opacity: 1 }, { opacity: 0 }, end(e) - 0.25, 0.22, 'power1.in');
    }
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', cw + 80); svg.setAttribute('height', ch + 80);
    svg.setAttribute('style', 'position:absolute;left:' + (x0 - 40) + 'px;top:' + (y0 - 40) + 'px;overflow:visible;filter:drop-shadow(0 0 14px rgba(255,61,46,.6))');
    var NSg = 'http://www.w3.org/2000/svg', defs = document.createElementNS(NSg, 'defs'), gid = 'tgline' + e.k;
    defs.innerHTML = '<linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + cw + '" y2="0"><stop offset="0" stop-color="#ff3d2e"/><stop offset=".2" stop-color="#ff3d2e"/><stop offset=".4" stop-color="#ff3d2e"/><stop offset=".55" stop-color="#ff3d2e"/><stop offset=".7" stop-color="#ff3d2e"/><stop offset="1" stop-color="#ff3d2e"/></linearGradient>';
    svg.appendChild(defs);
    b.appendChild(svg);
    var g = document.createElementNS(NS, 'g'); g.setAttribute('transform', 'translate(40,40)'); svg.appendChild(g);
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M' + pts.map(function (q) { return q[0] + ' ' + q[1]; }).join(' L'));
    path.setAttribute('pathLength', '1');
    path.setAttribute('style', 'fill:none;stroke:url(#' + gid + ');stroke-width:9;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1');
    g.appendChild(path);
    var drawT = Math.min(1.8, e.dur * 0.6), start = e.t0 + 0.15;
    to(path, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, start, drawT, 'power1.inOut');
    pts.forEach(function (q, i) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', q[0]); c.setAttribute('cy', q[1]); c.setAttribute('r', i === pts.length - 1 ? 16 : 10);
      c.setAttribute('style', 'fill:' + (i === pts.length - 1 ? '#ff3d2e' : '#fff') + ';opacity:0');
      g.appendChild(c);
      to(c, { opacity: 0 }, { opacity: 1 }, start + (i / (pts.length - 1)) * drawT, 0.08, 'none');
    });
    var last = pts[pts.length - 1];
    var ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', last[0]); ring.setAttribute('cy', last[1]); ring.setAttribute('r', 16);
    ring.setAttribute('style', 'fill:none;stroke:#ff3d2e;stroke-width:4;opacity:0;transform-box:fill-box;transform-origin:center');
    g.appendChild(ring);
    set(ring, { opacity: 1 }, start + drawT);
    to(ring, { opacity: 1, scale: 1 }, { opacity: 0, scale: 3.2 }, start + drawT, 0.7, 'power2.out');
    if (p.label !== '') {
      var lab = el('div', 'pill', b, 'left:' + Math.min(W - 260, x0 + last[0] - 120) + 'px;top:' + (y0 + last[1] - 110) + 'px;background:' + TGG + ';color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.35);font-size:40px', esc(p.label || '+340%'));
      to(lab, { opacity: 0, y: 20, scale: 0.7 }, { opacity: 1, y: 0, scale: 1 }, start + drawT, 0.35, 'back.out(2)');
    }
  };

  E['pull-back'] = function (e, a, p) {
    var u = box('under', e);
    el('div', 'abs', u, 'left:0;top:0;width:100%;height:100%;background:#efebe3');
    var s = 0.6, dy = 60;
    var x = W / 2 - (W * s) / 2 + 120, y = H / 2 - (H * s) / 2 + dy, w = W * s, h = H * s;
    set(L.cam, { transformOrigin: '50% 50%' }, e.t0);
    to(L.cam, { scale: 1, x: 0, y: 0, borderRadius: '0px' }, { scale: s, x: 120, y: dy, borderRadius: '30px' }, e.t0, 0.6, 'power3.inOut');
    to(L.cam, { scale: s, x: 120, y: dy, borderRadius: '30px' }, { scale: 1, x: 0, y: 0, borderRadius: '0px' }, end(e) - 0.45, 0.43, 'power3.inOut');
    camReset(e);
    var bh = box('under', e);
    var win = el('div', 'window', bh, 'left:' + (x - 16) + 'px;top:' + (y - 80) + 'px;width:' + (w + 32) + 'px;height:' + (h + 160) + 'px');
    el('div', 'dots', win, '', '<i></i><i></i><i></i>');
    el('div', 'abs mono', win, 'left:0;right:0;top:20px;text-align:center;font-size:22px;color:#888', esc(p.title || 'reel.mp4'));
    var bar = el('div', 'abs', win, 'left:24px;right:24px;bottom:28px;height:26px;border-radius:13px;background:#eee;overflow:hidden');
    var fill = el('div', 'abs', bar, 'left:0;top:0;bottom:0;width:100%;background:var(--t-fill);transform-origin:0 50%;transform:scaleX(0)');
    to(fill, { scaleX: 0 }, { scaleX: 1 }, e.t0 + 0.5, e.dur - 1.1, 'power1.inOut');
    to(win, { opacity: 0 }, { opacity: 1 }, e.t0 + 0.25, 0.35, 'none');
    to(win, { opacity: 1 }, { opacity: 0 }, end(e) - 0.45, 0.2, 'none');
    var f = box('front', e);
    var steps = list(p.steps, ['Transcribed the take', 'Cut every pause', 'Built every effect', 'Captions on every word', 'Graded and mixed']).slice(0, 6);
    var card = el('div', 'composer', f, 'left:30px;top:' + (y + h * 0.3) + 'px;width:450px;padding:26px 28px;border-radius:24px');
    el('div', 'mono', card, 'font-size:18px;letter-spacing:.14em;color:#999;margin-bottom:16px', 'WORKING ON');
    steps.forEach(function (st, i) {
      var r = el('div', 'row', card, 'font-size:28px;gap:14px;margin-top:12px;color:#bbb');
      var tk = el('span', 'tick', r, 'width:30px;height:30px;border-color:#ddd', '<i style="width:30px;height:30px;background:var(--t-accent)"></i>');
      tk.firstChild.style.cssText += ';left:-3px;top:-3px';
      el('span', null, r, '', esc(text(st)));
      var at = e.t0 + 0.7 + (i * (e.dur - 1.4)) / steps.length;
      to(tk.firstChild, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 0.8 }, at, 0.25, 'back.out(2.5)');
      to(r, { color: '#bbb' }, { color: '#1d1d1f' }, at, 0.2, 'none');
    });
    to(card, { opacity: 0, x: -50 }, { opacity: 1, x: 0 }, e.t0 + 0.45, 0.4);
    to(card, { opacity: 1 }, { opacity: 0 }, end(e) - 0.45, 0.2, 'none');
  };

  E['green-screen'] = function (e, a, p) {
    var u = box('under', e);
    if (a.images && a.images[0] && p.image) {
      var bg = el('img', 'cover', u); bg.src = a.images[0];
      to(bg, { scale: 1.12 }, { scale: 1 }, e.t0, e.dur, 'none');
    } else {
      el('div', 'abs', u, 'left:0;top:0;width:100%;height:100%;background:radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--t-accent) 45%, var(--t-bg)), var(--t-bg-deep) 75%)');
      if (a.images && a.images[0]) {
        var card = el('div', 'phone', u, 'left:' + (W / 2 - 210) + 'px;top:' + (p.text ? 370 : 200) + 'px;width:380px;height:600px;border-width:8px;border-radius:40px');
        el('img', null, card).src = a.images[0];
        to(card, { y: 80, opacity: 0, rotation: -4 }, { y: 0, opacity: 1, rotation: 2 }, e.t0 + 0.1, 0.5);
      }
    }
    if (p.text) {
      var big = el('div', 'abs', u, 'left:0;right:0;top:150px;text-align:center;font:900 170px/0.9 Inter;letter-spacing:-.04em;color:#fff;text-transform:uppercase', esc(p.text));
      to(big, { opacity: 0, y: 40 }, { opacity: 1, y: 0 }, e.t0 + 0.15, 0.4);
    }
    set(L.cam, { opacity: 0 }, e.t0);
    var m = mw(e), s = 0.6;
    set(m, { transformOrigin: origin(BCX, H) }, e.t0);
    to(m, { scale: 1 }, { scale: s }, e.t0, 0.45, 'power3.out');
    to(m, { scale: s }, { scale: 1 }, end(e) - 0.35, 0.33, 'power3.in');
    camReset(e);
  };

  E['paper-cut'] = function (e, a, p) {
    var u = box('under', e);
    el('div', 'abs', u, 'left:0;top:0;width:100%;height:100%;background:#ece5d8');
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('style', 'position:absolute;left:0;top:0');
    svg.innerHTML = '<rect width="100%" height="100%" filter="url(#paper)" opacity=".55"/>';
    u.appendChild(svg);
    var strip = el('div', 'abs', u, 'left:-60px;top:' + (H * 0.5) + 'px;width:' + (W + 120) + 'px;height:360px;background:#f3d34a;transform:rotate(-7deg);clip-path:polygon(0 8%,6% 0,13% 6%,21% 1%,30% 7%,38% 2%,47% 8%,55% 1%,64% 6%,72% 0,81% 7%,90% 2%,100% 6%,100% 94%,92% 100%,83% 93%,74% 99%,66% 94%,57% 100%,48% 93%,39% 99%,30% 94%,21% 100%,12% 93%,4% 99%,0 92%)');
    var scrib = el('div', 'abs', u, 'left:120px;top:' + (H * 0.18) + 'px;width:260px;height:260px;border-radius:50%;border:10px dashed #6f8ff0;opacity:.7;transform:rotate(12deg)');
    var letters = String(p.letters || 'AI').slice(0, 6).split('');
    letters.forEach(function (ch, i) {
      var dark = i % 2 === 0;
      var t = el('div', 'abs serif', u, 'left:' + (60 + i * 104) + 'px;top:' + (H * 0.08 + (i % 2) * 22) + 'px;width:92px;height:110px;display:flex;align-items:center;justify-content:center;font:700 86px/1 "Bodoni Moda",serif;background:' + (dark ? '#1a1a1a' : '#fff') + ';color:' + (dark ? '#fff' : '#1a1a1a') + ';transform:rotate(' + (i % 2 ? 6 : -5) + 'deg);box-shadow:0 6px 14px rgba(0,0,0,.25)', esc(ch));
      set(t, { opacity: 0 }, e.t0); set(t, { opacity: 1 }, e.t0 + 0.12 + i * 0.1);
    });
    set([strip, scrib], { opacity: 0 }, e.t0); set(strip, { opacity: 1 }, e.t0 + 0.1); set(scrib, { opacity: 0.7 }, e.t0 + 0.2);
    set(L.cam, { opacity: 0 }, e.t0);
    var m = mw(e);
    set(m, { transformOrigin: origin(BCX, BCY), filter: 'url(#sticker) drop-shadow(0 18px 24px rgba(0,0,0,.35))' }, e.t0);
    to(m, { scale: 0.7, rotation: -8 }, { scale: 0.86, rotation: -3 }, e.t0, 0.3, 'steps(3)');
    to(m, { scale: 0.86, rotation: -3 }, { scale: 1, rotation: 0 }, end(e) - 0.2, 0.18, 'steps(2)');
    set(m, { filter: 'none' }, end(e));
    camReset(e);
  };

  E['doodle-boil'] = function (e) {
    var copies = [mw(e), mw(e, 1), mw(e, 2)];
    copies.forEach(function (m, i) { if (m) { m.style.filter = 'url(#boil' + i + ')'; m.style.opacity = 0; } });
    var step = 0.11, nSteps = Math.floor(e.dur / step);
    for (var s = 0; s < nSteps; s++) copies.forEach(function (m, i) { if (m) set(m, { opacity: s % 3 === i ? 1 : 0 }, e.t0 + s * step); });
    var b = box('front', e), NS = 'http://www.w3.org/2000/svg';
    var star = document.createElementNS(NS, 'svg');
    star.setAttribute('width', 120); star.setAttribute('height', 120); star.setAttribute('viewBox', '-60 -60 120 120');
    star.setAttribute('style', 'position:absolute;left:' + (HX + HW * 0.8) + 'px;top:' + (TOP - 40) + 'px;overflow:visible');
    star.innerHTML = [0, 1, 2].map(function (k) { return '<path d="M0 -50 C6 -10 10 -6 50 0 C10 6 6 10 0 50 C-6 10 -10 6 -50 0 C-10 -6 -6 -10 0 -50Z" style="fill:none;stroke:#f6e36b;stroke-width:6;stroke-linejoin:round;opacity:0" transform="rotate(' + (k * 7 - 7) + ') scale(' + (1 + k * 0.06) + ')"/>'; }).join('');
    b.appendChild(star);
    var paths = star.querySelectorAll('path');
    for (var q = 0; q < nSteps; q++) paths.forEach(function (pp, i) { set(pp, { opacity: q % 3 === i ? 1 : 0 }, e.t0 + 0.2 + q * step); });
  };

  E.vertigo = function (e) {
    var s = 1.32, m = mw(e);
    var vg = el('div', 'abs', box('behind', e), 'left:0;top:0;width:100%;height:100%;background:radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,.55) 100%)');
    set([L.cam, m], { transformOrigin: origin(BCX, BCY) }, e.t0);
    to(L.cam, { scale: s }, { scale: 1 }, e.t0, e.dur - 0.05, 'power1.inOut');
    set(m, { scale: s }, e.t0);
    to(m, { scale: s }, { scale: 1 }, end(e) - 0.3, 0.28, 'power2.inOut');
    flash(e, e.t0, 0.15);
    camReset(e);
  };

  E['cover-story'] = function (e, a, p) {
    var bh = box('behind', e), f = box('front', e);
    var title = String(p.title || 'STUDIO').toUpperCase();
    var size = Math.min(260, Math.floor(1450 / Math.max(3, title.length)));
    var ty = Math.max(70, TOP - size * 0.62);
    var mast = el('div', 'abs serif', bh, 'left:0;right:0;top:' + ty + 'px;text-align:center;font-weight:500;font-size:' + size + 'px;line-height:1;letter-spacing:.02em;color:#fff;text-shadow:0 4px 30px rgba(0,0,0,.25)');
    title.split('').forEach(function (ch, i) {
      var sp = el('span', null, mast, 'display:inline-block', esc(ch));
      to(sp, { opacity: 0, y: -70 }, { opacity: 1, y: 0 }, e.t0 + i * 0.06, 0.45, 'power3.out');
    });
    el('div', 'abs', f, 'left:28px;top:28px;right:28px;bottom:28px;border:2px solid rgba(255,255,255,.75)');
    el('div', 'abs', f, 'left:60px;top:' + (ty + size + 10) + 'px;font:700 22px/1.3 Inter;letter-spacing:.22em;color:#fff', esc(p.kicker || 'THE AI ISSUE'));
    el('div', 'abs', f, 'right:60px;top:' + (ty + size + 10) + 'px;text-align:right;font:700 22px/1.3 Inter;letter-spacing:.22em;color:#fff', esc(p.side || 'NO EDITOR REQUIRED'));
    var lines = list(p.lines, ['Claude edited', 'this reel']);
    var foot = el('div', 'abs', f, 'left:60px;bottom:' + (H * 0.2) + 'px;width:700px');
    el('div', null, foot, 'font:700 22px/1 Inter;letter-spacing:.22em;margin-bottom:14px', 'HOW IT WAS MADE');
    lines.forEach(function (ln, i) {
      var d = el('div', 'serif', foot, 'font-style:italic;font-size:76px;line-height:1.02', esc(text(ln)));
      to(d, { opacity: 0, x: -30 }, { opacity: 1, x: 0 }, e.t0 + 0.4 + i * 0.15, 0.45);
    });
    to(f, { opacity: 0 }, { opacity: 1 }, e.t0, 0.3, 'none');
    set(L.cam, { filter: 'blur(0px) saturate(.9)' }, e.t0);
    camReset(e);
  };

  var SH = '0 18px 50px rgba(8,12,20,.35)', TS = ';text-shadow:0 2px 10px rgba(0,0,0,.35)';
  var GLASS = {
    slate: 'background:rgba(58,70,90,.78);backdrop-filter:blur(14px) saturate(.8);border:1px solid rgba(214,226,242,.22)',
    clear: 'background:rgba(255,255,255,.14);backdrop-filter:blur(22px) saturate(1.4);border:1.5px solid rgba(255,255,255,.45)' + TS,
    frosted: 'background:rgba(255,255,255,.74);backdrop-filter:blur(20px);border:1.5px solid rgba(255,255,255,.85);color:#111',
    smoke: 'background:rgba(12,12,14,.62);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.12)',
    liquid: 'background:rgba(255,255,255,.08);backdrop-filter:blur(8px) saturate(1.8);border:1.5px solid rgba(255,255,255,.55);box-shadow:inset 0 2px 0 rgba(255,255,255,.6),inset 0 -14px 36px rgba(255,255,255,.14),' + SH + TS,
    vibrant: 'background:rgba(0,0,0,.18);backdrop-filter:blur(30px) saturate(2.2) brightness(.72);border:1px solid rgba(255,255,255,.25)' + TS,
    blue: 'background:rgba(28,64,170,.64);backdrop-filter:blur(18px) saturate(1.3);border:1px solid rgba(160,190,255,.35)',
    ember: 'background:rgba(210,80,47,.74);backdrop-filter:blur(18px);border:1px solid rgba(255,190,160,.4)',
    violet: 'background:linear-gradient(135deg,rgba(110,60,230,.72),rgba(230,70,150,.66));backdrop-filter:blur(18px);border:1px solid rgba(255,200,240,.35)',
    emerald: 'background:rgba(16,120,90,.66);backdrop-filter:blur(18px) saturate(1.2);border:1px solid rgba(150,240,200,.3)',
    highlighter: 'background:#ff3d2e;backdrop-filter:none;border:0;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.45)',
    neon: 'background:rgba(8,8,12,.78);backdrop-filter:blur(14px);border:3px solid rgba(120,170,255,.85);box-shadow:0 0 28px rgba(120,170,255,.6),inset 0 0 18px rgba(120,170,255,.25)'
  };
  E['glass-type'] = function (e, a, p) {
    var b = box('front', e);
    var look = GLASS[p.style] || GLASS.slate, bf = (look.match(/backdrop-filter:([^;]+)/) || [])[1] || 'none';
    var str = p.text || 'Claude edited this';
    var wrap = el('div', 'abs', b, 'left:110px;width:800px;top:0;opacity:0');
    var g = el('div', null, wrap, 'position:relative;overflow:hidden;isolation:isolate;padding:30px 44px 34px;border-radius:26px;box-shadow:' + SH + ';text-align:center;font:800 70px/1.08 "Reddit Sans",Inter,sans-serif;letter-spacing:-.02em;color:#fff;' + look + ';-webkit-backdrop-filter:' + bf);
    var rows = p.rows && p.rows.length ? p.rows : String(str).split(/\s*(?:\n|\|)\s*/).map(function (t) { return { text: t }; }), n = 0;
    rows.forEach(function (row, ri) {
      var ln = el('div', null, g, 'white-space:nowrap'), t0 = row.t != null ? Math.max(e.t0, row.t) : e.t0 + 0.15 + n * 0.08;
      var marked = String(row.mark || '').toLowerCase().split(/\s+/).filter(Boolean), grp = null, gw = [];
      var isMark = function (w) { return marked.indexOf(w.toLowerCase().replace(/[^\w%$+-]/g, '')) >= 0; };
      var closeGrp = function () {
        if (!grp) return;
        // one marker block behind the whole phrase (spaces included), drawn left to right after its last word lands
        var bar = el('span', 'abs', grp, 'left:-.04em;right:-.04em;bottom:-.06em;height:.16em;z-index:0;border-radius:.08em;background:' + TGG + ';transform:scaleX(0);transform-origin:left center');
        var mt = gw[gw.length - 1].t + 0.3;
        to(bar, { scaleX: 0 }, { scaleX: 1 }, mt, 0.28 + 0.06 * gw.length, 'power2.out');
        grp = null; gw = [];
      };
      String(row.text || '').split(' ').forEach(function (w, wi) {
        var at = t0 + wi * 0.08, m = isMark(w);
        if (!m) closeGrp();
        if (m && !grp) grp = el('span', null, ln, 'display:inline-block;position:relative;margin:0 .14em;isolation:isolate');
        var sp = el('span', null, m ? grp : ln, 'display:inline-block;position:relative;z-index:1;margin:0 ' + (m ? '.07em' : '.14em'), esc(w));
        to(sp, { opacity: 0, y: 18 }, { opacity: 1, y: 0 }, at, 0.3, 'power2.out'); n++;
        if (m) gw.push({ el: sp, t: at });
      });
      closeGrp();
    });
    var longest = rows.reduce(function (m, r) { return Math.max(m, String(r.text || '').length); }, 1), fs = Math.max(34, Math.min(70, Math.floor(700 / (longest * 0.6))));
    var fit = function () {
      var f = fs; g.style.fontSize = f + 'px';
      for (; f > 34 && g.scrollWidth > g.clientWidth + 1; f -= 4) g.style.fontSize = f - 4 + 'px';
    };
    fit();
    if (document.fonts) document.fonts.load("800 70px 'Reddit Sans'").then(fit);
    var chin = S.chin != null ? S.chin * H : HY + HW * 0.55, hgt = wrap.offsetHeight || 240;
    wrap.style.top = (p.y != null ? +p.y : Math.max(260, Math.min(1180 - hgt, chin + 50))) + 'px';
    to(wrap, { opacity: 0, y: 24 }, { opacity: 1, y: 0 }, e.t0, 0.3, 'power3.out');
    to(wrap, { opacity: 1, y: 0 }, { opacity: 0, y: -12 }, end(e) - 0.25, 0.22, 'power1.in');
  };

  E['scribble-note'] = function (e, a, p) {
    var b = box('front', e), right = p.side === 'right', above = p.place === 'above', hairTop = HY - HW * 0.85, col = p.color || '#fff';
    var nw = above ? 680 : 360, nx = above ? Math.max(40, Math.min(W - 40 - nw, HX - nw / 2)) : right ? HX + HW * 0.9 : Math.max(40, HX - HW * 0.9 - 340), ny = above ? Math.max(240, hairTop - 250) : Math.max(150, TOP - 120);
    var note = el('div', 'abs hand', b, 'left:' + nx + 'px;top:' + ny + 'px;width:' + nw + 'px;font-size:' + (above ? 62 : 66) + 'px;line-height:1;color:' + col + ';text-align:' + (above ? 'center' : 'left') + ';transform:rotate(' + (above ? -3 : right ? 7 : -8) + 'deg);text-shadow:0 2px 10px rgba(0,0,0,.4)');
    var span = el('span', null, note, 'display:inline-block', esc(p.text || "can't edit"));
    to(note, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)' }, e.t0, 0.45, 'power1.inOut');
    var NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');
    b.appendChild(svg);
    var nh = note.offsetHeight || 130, tw = Math.min(nw, span.offsetWidth || nw * 0.8), tl = above ? nx + (nw - tw) / 2 : nx, tr = tl + tw, tb = ny + nh, mid = (tl + tr) / 2;
    var draw = function (d, at, dur) {
      var pth = document.createElementNS(NS, 'path');
      pth.setAttribute('d', d); pth.setAttribute('pathLength', '1');
      pth.setAttribute('style', 'fill:none;stroke:' + col + ';stroke-width:7;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1');
      svg.appendChild(pth);
      to(pth, { strokeDashoffset: 1 }, { strokeDashoffset: 0 }, e.t0 + at, dur, 'power1.inOut');
    };
    var tip = function (ex, ey, ang) { var hl = 30; return 'M' + (ex - hl * Math.cos(ang - 0.5)) + ' ' + (ey - hl * Math.sin(ang - 0.5)) + ' L' + ex + ' ' + ey + ' L' + (ex - hl * Math.cos(ang + 0.5)) + ' ' + (ey - hl * Math.sin(ang + 0.5)); };
    if (above) { svg.style.transformOrigin = mid + 'px ' + (ny + nh / 2) + 'px'; svg.style.transform = 'rotate(-3deg)'; }
    var mark = p.mark || 'head';
    if (mark === 'none') return;
    if (mark === 'underline') return draw('M' + (tl - 6) + ' ' + (tb + 10) + ' Q' + mid + ' ' + (tb + 26) + ' ' + (tr + 8) + ' ' + (tb + 6), 0.45, 0.3);
    if (mark === 'circle') {
      var ring = function () {
        var tr0 = note.style.transform, rg = document.createRange(); note.style.transform = 'none'; rg.selectNodeContents(span);
        var rr = rg.getBoundingClientRect(), nr = note.getBoundingClientRect(), sc = nr.width / (note.offsetWidth || nr.width) || 1; note.style.transform = tr0;
        var th = above ? 62 : 66, hw = rr.width / sc / 2, bb = rr.height / sc / 2, ryy = bb + 0.5 * th, rxx = Math.max(hw + 0.35 * th, hw / Math.sqrt(1 - Math.pow(bb / ryy, 2)) * 1.04), ccx = nx + (rr.left - nr.left) / sc + hw, ccy = ny + (rr.top - nr.top) / sc + bb, d = '';
        for (var n = 0; n <= 56; n++) { var ang = -1.75 + n / 56 * 6.55, k = 1 + 0.05 * n / 56; d += (n ? ' L' : 'M') + (ccx + rxx * k * Math.cos(ang)).toFixed(1) + ' ' + (ccy + ryy * k * Math.sin(ang)).toFixed(1); }
        return d;
      };
      svg.style.transformOrigin = (nx + nw / 2) + 'px ' + (ny + nh / 2) + 'px'; svg.style.transform = 'rotate(' + (above ? -3 : right ? 7 : -8) + 'deg)';
      draw(ring(), 0.4, 0.45);
      if (document.fonts) document.fonts.ready.then(function () { var q = svg.lastChild; if (q) q.setAttribute('d', ring()); });
      return;
    }
    if (mark === 'up') { var x0 = Math.min(W - 200, tr + 16), y0 = tb - 10, pts = [[x0, y0], [x0 + 40, y0 - 50], [x0 + 70, y0 - 25], [x0 + 130, y0 - 110]]; draw('M' + pts.map(function (q) { return q.join(' '); }).join(' L'), 0.45, 0.35); return draw(tip(pts[3][0], pts[3][1], Math.atan2(-85, 60)), 0.8, 0.15); }
    if (mark === 'down') { var dx = mid + tw * 0.25, dy0 = tb + 12, dy1 = dy0 + 110; draw('M' + dx + ' ' + dy0 + ' Q' + (dx + 30) + ' ' + ((dy0 + dy1) / 2) + ' ' + dx + ' ' + dy1, 0.45, 0.3); return draw(tip(dx, dy1, Math.PI / 2), 0.75, 0.15); }
    var sx = above ? nx + nw * 0.62 : right ? nx + 60 : nx + 260, sy = above ? tb + 14 : ny + 110, ex = above ? HX + HW * 0.12 : right ? HX + HW * 0.55 : HX - HW * 0.55, ey = above ? Math.max(sy + 50, hairTop + 10) : HY;
    var cx = (sx + ex) / 2 + (above ? 50 : right ? 60 : -60), cy = above ? (sy + ey) / 2 : sy + 40;
    draw('M' + sx + ' ' + sy + ' Q' + cx + ' ' + cy + ' ' + ex + ' ' + ey, 0.4, 0.32);
    draw(tip(ex, ey, Math.atan2(ey - cy, ex - cx)), 0.7, 0.15);
  };

  E['price-stack'] = function (e, a, p) {
    var b = box('front', e);
    var price = Number(p.price || 150), n = Math.max(2, Math.min(8, Number(p.count || 6))), total = Number(p.total || price * n);
    var led = el('div', 'led', b, 'left:50%;top:' + Math.max(110, TOP - 300) + 'px;transform:translateX(-50%)');
    var num = el('span', null, led, '', '$0');
    el('div', 'abs', b, 'left:0;right:0;top:' + (Math.max(110, TOP - 300) + 150) + 'px;text-align:center;font:800 24px/1 Inter;letter-spacing:.2em;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.6)', esc(p.under || 'EVERY SINGLE VIDEO'));
    var times = [];
    for (var i = 0; i < n; i++) {
      var left = i % 2 === 0, k = Math.floor(i / 2);
      var c = el('div', 'invoice', b, (left ? 'left:36px' : 'right:36px') + ';top:' + (HY - 60 + k * 46) + 'px;transform:rotate(' + (left ? -4 + k : 4 - k) + 'deg)',
        '<small>INVOICE</small><b>' + esc(p.label || 'Video editor') + '</b><span><i style="font-style:normal">1 video</i><i style="font-style:normal">$' + price + '</i></span>');
      var at = e.t0 + 0.2 + (i * (e.dur - 1)) / n;
      times.push(at);
      to(c, { opacity: 0, y: -260, rotation: left ? -20 : 20 }, { opacity: 1, y: 0, rotation: left ? -4 + k : 4 - k }, at, 0.35, 'back.out(1.4)');
    }
    var shown = { v: 0 };
    tl.fromTo(shown, { v: 0 }, { v: total, duration: e.dur - 0.8, ease: 'power1.in', immediateRender: false, onUpdate: function () { num.textContent = '$' + Math.round(shown.v / 10) * 10; } }, e.t0 + 0.3);
    num.textContent = '$0';
    to(led, { scale: 1 }, { scale: 1.12 }, end(e) - 0.5, 0.12, 'power2.out');
    to(led, { scale: 1.12 }, { scale: 1 }, end(e) - 0.38, 0.2, 'power2.in');
  };

  E['comment-cta'] = function (e, a, p) {
    var b = box('front', e), word = String(p.word || 'EDIT').toUpperCase(), y = p.y != null ? +p.y : Math.round(H * 0.6);
    var card = el('div', 'abs', b, 'left:90px;right:90px;top:' + y + 'px;padding:34px 44px 40px;border-radius:44px;background:var(--t-paper,#f4ecd6);color:var(--t-ink,#111);box-shadow:0 24px 60px rgba(0,0,0,.35);text-align:center');
    el('div', null, card, 'font:700 26px/1 "JetBrains Mono",monospace;letter-spacing:.18em;text-transform:uppercase;opacity:.6', 'Comment');
    var big = el('div', null, card, 'margin-top:14px;font:400 132px/1 "Instrument Serif",Georgia,serif;letter-spacing:-.01em;color:var(--t-accent,#ff2e88);font-style:italic;min-height:132px');
    if (p.anim === 'none') {
      big.textContent = word;
      if (p.reply) el('div', null, card, 'margin-top:22px;font:600 34px/1.2 Inter;opacity:.82', esc(p.reply));
      set(card, { opacity: 0 }, 0); set(card, { opacity: 1 }, e.t0); set(card, { opacity: 0 }, end(e));
      return;
    }
    var done = typing(big, word, e.t0 + 0.35, 0.11);
    to(card, { opacity: 0, y: 50, scale: 0.94 }, { opacity: 1, y: 0, scale: 1 }, e.t0, 0.4, 'back.out(1.6)');
    if (p.reply) {
      var reply = el('div', null, card, 'margin-top:22px;font:600 34px/1.2 Inter;opacity:.82', esc(p.reply));
      to(reply, { opacity: 0, y: 16 }, { opacity: 0.82, y: 0 }, done + 0.25, 0.35, 'power2.out');
    }
    to(card, { opacity: 1 }, { opacity: 0, y: -20 }, end(e) - 0.3, 0.25, 'power1.in');
  };

  E['follow-cta'] = function (e, a, p) {
    var b = box('front', e), y = p.y != null ? +p.y : 240;
    var card = el('div', 'abs', b, 'left:110px;right:110px;top:' + y + 'px;padding:26px 34px 30px;border-radius:36px;background:rgba(12,12,16,.62);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);border:2px solid rgba(255,255,255,.22);box-shadow:0 24px 60px rgba(0,0,0,.35);text-align:center;color:#fff');
    el('div', null, card, 'font:700 24px/1 "JetBrains Mono",monospace;letter-spacing:.2em;text-transform:uppercase;opacity:.7', esc(p.kicker || 'Follow for more'));
    var big = el('div', null, card, 'margin-top:12px;font:800 64px/1.05 Inter,sans-serif;letter-spacing:-.02em', esc(p.text || 'Tech & AI tips').replace(/\*([^*]+)\*/g, '<span style="background:' + TGG + ';-webkit-background-clip:text;background-clip:text;color:transparent">$1</span>'));
    var btn = el('div', null, card, 'position:relative;overflow:hidden;display:inline-block;margin-top:20px;padding:14px 40px;border-radius:999px;background:#fff;color:#111;font:800 34px/1 Inter,sans-serif');
    var lit = el('span', 'abs', btn, 'inset:0;background:' + TGG + ';opacity:0');
    el('span', null, btn, 'position:relative', esc(p.button || '+ Follow'));
    to(card, { opacity: 0, y: -40, scale: 0.94 }, { opacity: 1, y: 0, scale: 1 }, e.t0, 0.4, 'back.out(1.6)');
    to(big, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, e.t0 + 0.15, 0.35, 'power2.out');
    to(btn, { scale: 1 }, { scale: 0.88 }, e.t0 + 0.9, 0.12, 'power2.in');
    to(btn, { scale: 0.88 }, { scale: 1 }, e.t0 + 1.02, 0.3, 'back.out(3)');
    to(lit, { opacity: 0 }, { opacity: 1 }, e.t0 + 1.02, 0.2, 'none');
    set(btn, { color: '#fff' }, e.t0 + 1.02);
    to(card, { opacity: 1 }, { opacity: 0, y: -20 }, end(e) - 0.3, 0.25, 'power1.in');
  };

  E['voice-orb'] = function (e, a, p) {
    var b = box('front', e), size = 480, right = p.side !== 'left';
    var x = right ? W - size - 10 : 10, y = Math.max(260, HY - size / 2);
    el('div', 'abs', b, 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,.55) 0%,rgba(0,0,0,.25) 45%,rgba(0,0,0,0) 70%)');
    var cv = el('canvas', 'abs', b, 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size + 'px');
    cv.width = size * 2; cv.height = size * 2;
    var g = cv.getContext('2d'), n = 3600, ga = Math.PI * (3 - Math.sqrt(5)), P = new Float32Array(n * 3), seed = new Float32Array(n);
    for (var i = 0; i < n; i++) { var yy = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - yy * yy), th = ga * i; P[i * 3] = Math.cos(th) * r; P[i * 3 + 1] = yy; P[i * 3 + 2] = Math.sin(th) * r; seed[i] = (i * 9301 + 49297) % 233280 / 233280 * 1000; }
    var lv = p.levels || [], br = p.bright || [];
    to(cv, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, e.t0, 0.35, 'back.out(1.6)');
    to(cv, { opacity: 1 }, { opacity: 0, scale: 0.85 }, end(e) - 0.3, 0.3, 'power1.in');
    drive(e, function (v) {
      var f = Math.min(lv.length - 1, Math.max(0, Math.round(v * (lv.length - 1)))), L = lv[f] || 0, B = br[f] || 0, t = e.t0 + v * e.dur;
      var w = cv.width, h = cv.height, R = w * 0.4 * (1 + L * 0.12), rot = t * (0.25 + L * 0.6), ca = Math.cos(rot), sa = Math.sin(rot), ct = Math.cos(0.35), st = Math.sin(0.35);
      g.clearRect(0, 0, w, h);
      for (var i = 0; i < n; i++) {
        var px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
        var band = 0.5 + 0.5 * Math.sin(py * (4 + B * 10) + t * 3), en = L * band * (0.55 + 0.45 * Math.sin(Math.atan2(pz, px) * 3 + t * 2));
        var d = 1 + en * 0.6 + Math.sin(t * 1.5 + seed[i]) * 0.01;
        var X = (px * ca - pz * sa) * d, Z = (px * sa + pz * ca) * d, Y = py * d, Y2 = Y * ct - Z * st, Z2 = Y * st + Z * ct, ps = 1 / (1.9 - Z2 * 0.5);
        var sx = w / 2 + X * R * ps * 1.9, sy = h / 2 + Y2 * R * ps * 1.9, s = Math.max(4, w / 150) * ps * 1.9;
        g.fillStyle = en > 0.4 && Z2 > -0.2 ? 'rgba(255,150,80,1)' : Z2 > 0 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.28)';
        g.fillRect(sx, sy, s, s);
      }
    });
  };

  E['photo-grid'] = function (e, a, p) {
    var items = list(p.items, []).filter(function (it) { return it && (it.src || it.file); });
    if (!items.length) return;
    if (p.mode === 'single') {
      var sb = box('front', e), right = HX < W / 2, sw = p.size ? +p.size : Math.round(Math.max(320, Math.min(470, right ? W - 50 - (HX + HW * 0.55) : HX - HW * 0.55 - 50)));
      var sx = right ? W - 50 - sw : 50, sh = Math.round(sw * 1.2), sy = p.y != null ? +p.y : Math.round(Math.max(240, Math.min(1480 - sh, HY - sh * 0.55)));
      var JX = [0, -34, 14, -18, 8, -26], JY = [0, 70, -60, 120, -110, 40], JS = [1, 0.9, 1.08, 0.94, 1.03, 0.86];
      var cards = items.map(function (it, i) {
        var k = p.jitter === false ? 0 : i % 6, w = Math.round(sw * JS[k]), hh = Math.round(sh * JS[k]);
        var x = Math.min(W - 30 - w, sx + (sw - w) / 2 + JX[k] + (+it.dx || 0)), y = Math.max(230, Math.min(1480 - hh, sy + (sh - hh) / 2 + JY[k] + (+it.dy || 0)));
        var cd = el('div', 'abs', sb, 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + hh + 'px;overflow:hidden;opacity:0');
        el('img', null, cd, 'width:100%;height:100%;object-fit:cover;display:block').src = it.src || it.file;
        return cd;
      });
      items.forEach(function (it, i) {
        var t = Math.max(e.t0, it.t != null ? it.t : e.t0 + i * 0.5), nx = items[i + 1], t1 = nx ? Math.max(e.t0, nx.t != null ? nx.t : t + 0.5) : end(e);
        set(cards[i], { opacity: 1 }, t);
        set(cards[i], { opacity: 0 }, Math.min(t1, end(e)));
      });
      return;
    }
    var b = box('front', e), gap = 16, m = 36, top = p.y != null ? +p.y : 90, hairTop = HY - HW * 0.85, headR = HX + HW * 0.6;
    var c = p.size ? +p.size : Math.round(Math.min(250, Math.max(160, (hairTop - top - gap) / 2, (W - m - gap - headR) / 2)));
    var x0 = HX < W / 2 ? W - m - 2 * c - gap : m, ROT = [-4, 3, 2.5, -3];
    var shown = [], n = 0;
    var out = function (card, t) { to(card, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.8 }, t, 0.16, 'power1.in'); };
    items.forEach(function (it, i) {
      var t = Math.max(e.t0, it.t != null ? it.t : e.t0 + i * 0.5);
      if (it.clear || it.big) { shown.forEach(function (cd) { if (cd) out(cd, t - 0.02); }); shown = []; n = 0; }
      var slot = n++ % 4, s = it.big ? 2 * c + gap : c;
      var x = x0 + (it.big ? 0 : (slot % 2) * (c + gap)), y = top + (it.big ? 0 : Math.floor(slot / 2) * (c + gap));
      var card = el('div', 'abs', b, 'left:' + x + 'px;top:' + y + 'px;width:' + s + 'px;height:' + s + 'px;border-radius:26px;overflow:hidden;border:7px solid #fff;background:#fff;box-shadow:0 22px 50px -14px rgba(0,0,0,.55);opacity:0;transform:rotate(' + ROT[slot] + 'deg)');
      el('img', null, card, 'width:100%;height:100%;object-fit:cover;display:block').src = it.src || it.file;
      if (it.label) el('div', 'abs', card, 'left:0;right:0;bottom:0;padding:8px 6px 10px;background:linear-gradient(transparent,rgba(0,0,0,.72));color:#fff;font:800 ' + Math.round(s * (it.big ? 0.1 : 0.13)) + 'px/1 Inter;text-align:center;letter-spacing:-.01em', esc(it.label));
      to(card, { opacity: 0, scale: 0.35, rotate: ROT[slot] - 12 }, { opacity: 1, scale: 1, rotate: ROT[slot] }, t, 0.34, 'back.out(2.2)');
      if (shown[slot]) out(shown[slot], t - 0.02);
      shown[slot] = card;
      if (it.big) { n = 4; shown = [card]; }
    });
    shown.forEach(function (card, k) { if (card) to(card, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.7 }, end(e) - 0.3 + k * 0.04, 0.2, 'power1.in'); });
  };

  E['media-card'] = function (e, a, p) {
    if (!p.src && !p.file) return;
    var b = box('front', e), chin = S.chin != null ? S.chin * H : HY + HW * 0.55, vid = p.kind === 'video';
    var wrap = el('div', 'abs', b, (p.full ? 'left:0;width:100%' : p.w ? 'left:' + (W - p.w) / 2 + 'px;width:' + p.w + 'px' : 'left:120px;width:840px') + ';top:0;opacity:0');
    var card = el('div', null, wrap, (p.full || p.w ? '' : 'border-radius:36px;border:3px solid rgba(255,255,255,.85);box-shadow:0 30px 80px -20px rgba(0,0,0,.75);background:#000;') + 'overflow:hidden;line-height:0');
    var m = el(vid ? 'video' : 'img', null, card, 'width:100%;max-height:' + (p.full ? 640 : 820) + 'px;object-fit:cover;display:block');
    if (vid) m.muted = true;
    m.src = p.src || p.file || '';
    if (vid) syncClip(m, e);
    wrap.style.top = (p.y != null ? +p.y : Math.max(240, Math.min(700, chin + 40))) + 'px';
    if (p.place === 'above' && p.y == null) { var room = Math.max(220, HY - HW * 0.75 - 130); wrap.style.left = '180px'; wrap.style.width = '720px'; m.style.maxHeight = room + 'px'; wrap.style.top = '60px'; }
    if (p.x != null) wrap.style.left = p.x + 'px';
    if (p.w) card.style.borderRadius = '32px';
    if (p.look === 'card') { card.style.cssText = 'background:#fff;padding:' + (p.pad ?? 12) + 'px;border-radius:14px;box-shadow:0 18px 50px -12px rgba(0,0,0,.55);overflow:hidden;line-height:0;width:fit-content;max-width:100%;margin:0 auto'; m.style.cssText = 'max-width:100%;max-height:' + (+p.h || 470) + 'px;width:auto;height:auto;display:block;border-radius:' + ((p.pad ?? 12) ? 6 : 0) + 'px'; }
    if (p.out) { set(wrap, { opacity: 1 }, e.t0); to(wrap, { x: 0 }, { x: p.out === 'left' ? -1200 : 1200 }, end(e) - 0.3, 0.3, 'power3.in'); return; }
    if (p.anim === 'none') { set(wrap, { opacity: 1 }, e.t0); set(wrap, { opacity: 0 }, end(e)); return; }
    to(wrap, { opacity: 0, y: 30, scale: p.w ? 0.4 : 0.94 }, { opacity: 1, y: 0, scale: 1 }, e.t0, 0.35, 'back.out(' + (p.w ? 2.6 : 1.6) + ')');
    to(wrap, { opacity: 1, y: 0 }, { opacity: 0, y: -14 }, end(e) - 0.25, 0.22, 'power1.in');
  };

  E['concept-card'] = function (e, a, p) {
    if (!p.svg && !p.title) return;
    var b = box('front', e), chin = S.chin != null ? S.chin * H : HY + HW * 0.55;
    var wrap = el('div', 'abs', b, 'left:90px;width:900px;top:0;opacity:0');
    var g = el('div', null, wrap, 'padding:34px 40px 30px;border-radius:40px;background:linear-gradient(140deg,rgba(255,255,255,.18),rgba(14,14,20,.55));backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:2px solid rgba(255,255,255,.35);text-align:center;color:#fff');
    if (p.title) el('div', null, g, 'font:800 58px/1.05 Inter;letter-spacing:-.02em;margin-bottom:16px', esc(p.title));
    var pic = el('div', null, g, 'width:820px;height:472px;margin:0 auto', String(p.svg || '').replace(/<script[\s\S]*?<\/script>/gi, ''));
    var svg = pic.querySelector('svg'); if (svg) { svg.setAttribute('width', '820'); svg.setAttribute('height', '472'); }
    var hgt = wrap.offsetHeight || 620;
    wrap.style.top = (p.y != null ? +p.y : Math.max(240, Math.min(1260 - hgt, chin + 40))) + 'px';
    if (p.place === 'above' && p.y == null) { wrap.style.zoom = Math.min(1, Math.max(220, HY - HW * 0.75 - 130) / hgt).toFixed(3); wrap.style.top = (60 / +wrap.style.zoom).toFixed(0) + 'px'; wrap.style.left = ((W - 900 * +wrap.style.zoom) / 2 / +wrap.style.zoom).toFixed(0) + 'px'; }
    to(wrap, { opacity: 0, y: 30, scale: 0.96 }, { opacity: 1, y: 0, scale: 1 }, e.t0, 0.35, 'back.out(1.6)');
    [].slice.call(pic.querySelectorAll('svg > *')).forEach(function (n, i) { to(n, { opacity: 0 }, { opacity: 1 }, e.t0 + 0.2 + i * 0.12, 0.25, 'power1.out'); });
    to(wrap, { opacity: 1, y: 0 }, { opacity: 0, y: -14 }, end(e) - 0.25, 0.22, 'power1.in');
  };

  var GRN = 'var(--t-bg)', CRM = 'var(--t-paper)', INK = 'var(--t-ink)', TXT = 'var(--t-text)', ACC = 'var(--t-accent)', ZT = 110, ZB = Math.max(ZT + 320, TOP - 60), MONO = '"JetBrains Mono",ui-monospace,monospace', SERIF = '"Bodoni Moda",Didot,Georgia,serif';
  function gcard(parent, css, html) {
    var d = el('div', null, parent, 'position:absolute;background:' + GRN + ';border:3px solid ' + CRM + ';border-radius:22px;box-shadow:0 18px 40px rgba(0,0,0,.45);' + css, html);
    el('div', null, d, 'position:absolute;left:9px;top:9px;right:9px;bottom:9px;border:1.5px solid rgba(var(--t-text-rgb),.5);border-radius:14px;pointer-events:none');
    return d;
  }
  function fadeOut(t, e, y) { to(t, { opacity: 1 }, { opacity: 0, y: y == null ? -14 : y }, end(e) - 0.25, 0.22, 'power1.in'); }

  E['gravity-drop'] = function (e, a, p) {
    var b = box('front', e), items = list(p.items, ['16', '17', '18', '19']).slice(0, 5), ch = Math.min(250, (ZB - ZT) * 0.62), cw = ch * 0.8;
    var spots = [[-0.95, 0, -6], [0.05, 0, 4], [1, 0, -3], [-0.45, -0.5, 5], [0.5, -0.52, -7]];
    items.forEach(function (it, i) {
      var s = spots[i], str = text(it), big = str.length <= 3;
      var c = el('div', null, b, 'position:absolute;left:' + (HX - cw / 2 + s[0] * cw * 0.85) + 'px;top:' + (ZB - ch + s[1] * ch) + 'px;width:' + cw + 'px;height:' + ch + 'px;background:' + CRM + ';border-radius:16px;box-shadow:0 14px 34px rgba(0,0,0,.5);color:' + INK + ';text-align:center');
      el('div', null, c, 'position:absolute;left:8px;top:8px;right:8px;bottom:8px;border:1.5px solid rgba(var(--t-ink-rgb),.45);border-radius:10px');
      el('div', null, c, 'margin-top:20px;font:700 ' + ch * 0.085 + 'px/1 ' + MONO + ';letter-spacing:.22em', esc(p.month || 'OCT'));
      el('div', null, c, 'margin-top:' + ch * 0.1 + 'px;font:500 ' + (big ? ch * 0.46 : ch * 0.2) + 'px/1.05 ' + SERIF, esc(str));
      gsap.set(c, { y: -(ZB + ch + 60), rotation: s[2] * 5 });
      var t = e.t0 + 0.05 + i * 0.22;
      tl.fromTo(c, { y: -(ZB + ch + 60), rotation: s[2] * 5 }, { y: 0, rotation: s[2], duration: 0.8, ease: 'bounce.out', immediateRender: false }, t);
      fadeOut(c, e, 20);
    });
  };

  E['storyboard-deck'] = function (e, a, p) {
    var b = box('front', e), h = Math.min(380, ZB - ZT - 10), w = h * 0.5625, labels = list(p.labels, ['01 LOFI', '02 HI-FI', '03 SHOWCASE']);
    [0, 1, 2].forEach(function (i) {
      var c = gcard(b, 'left:' + (HX - w / 2) + 'px;top:' + (ZB - h) + 'px;width:' + w + 'px;height:' + h + 'px;border-radius:26px;overflow:hidden;opacity:0');
      var img = a.images && a.images[i];
      if (img) el('img', 'cover', c).src = img;
      else el('div', null, c, 'position:absolute;left:0;right:0;top:30%;text-align:center;font:500 ' + h * 0.3 + 'px/1 ' + SERIF + ';color:' + TXT, '0' + (i + 1));
      el('div', null, c, 'position:absolute;left:9px;top:9px;right:9px;bottom:9px;border:1.5px solid rgba(var(--t-text-rgb),.7);border-radius:17px');
      el('div', null, c, 'position:absolute;left:0;right:0;bottom:0;height:' + h * 0.11 + 'px;background:' + GRN + ';color:' + TXT + ';text-align:center;font:700 ' + h * 0.05 + 'px/' + h * 0.11 + 'px ' + MONO + ';letter-spacing:.14em', esc(text(labels[i] || '')));
      var fan = (i - 1) * 10, dx = (i - 1) * (w + 26);
      gsap.set(c, { opacity: 0, scale: 0.6, rotation: fan, x: 0 });
      tl.fromTo(c, { opacity: 0, scale: 0.6, rotation: fan, x: 0, y: 30 }, { opacity: 1, scale: 1, rotation: (i - 1) * 3, x: dx, y: 0, duration: 0.6, ease: 'back.out(1.5)', immediateRender: false }, e.t0 + 0.1 + i * 0.12);
      fadeOut(c, e, 14);
    });
  };

  E['file-drop'] = function (e, a, p) {
    var b = box('front', e), fw = 400, fh = 210, fl = Math.max(20, Math.min(W - fw - 20, HX - fw / 2)), bt = ZB - fh;
    var grp = el('div', 'abs', b, 'left:0;top:0;width:100%;height:100%');
    el('div', null, grp, 'position:absolute;left:' + fl + 'px;top:' + (bt - 36) + 'px;width:150px;height:56px;background:' + GRN + ';border:3px solid ' + CRM + ';border-radius:16px 16px 0 0');
    el('div', null, grp, 'position:absolute;left:' + fl + 'px;top:' + bt + 'px;width:' + fw + 'px;height:' + fh + 'px;background:var(--t-bg-deep);border:3px solid ' + CRM + ';border-radius:0 22px 22px 22px');
    var chip = el('div', null, grp, 'left:' + (fl + 45) + 'px;top:' + (bt + 8) + 'px;position:absolute;width:310px;height:104px;background:' + CRM + ';border-radius:16px;color:' + INK + ';padding:20px 24px 0 90px;box-shadow:0 10px 24px rgba(0,0,0,.4)');
    el('div', null, chip, 'position:absolute;left:24px;top:22px;width:46px;height:58px;border:4px solid ' + INK + ';border-radius:6px 16px 6px 6px');
    el('div', null, chip, 'font:700 30px/1.1 ' + MONO + ';white-space:nowrap', esc(p.file || 'raw-take.mp4'));
    el('div', null, chip, 'margin-top:8px;font:500 21px/1 ' + MONO + ';opacity:.6', esc(p.size || '148 MB'));
    var pane = gcard(grp, 'left:' + fl + 'px;top:' + (bt + 78) + 'px;width:' + fw + 'px;height:' + (fh - 78) + 'px;border-radius:6px 6px 22px 22px;box-shadow:none');
    el('div', null, pane, 'position:absolute;left:0;right:0;top:36%;text-align:center;font:700 22px/1 ' + MONO + ';color:' + TXT + ';letter-spacing:.2em', 'FOOTAGE');
    var lid = gcard(grp, 'left:' + fl + 'px;top:' + bt + 'px;width:' + fw + 'px;height:80px;border-radius:0 22px 6px 6px;transform-origin:50% 0;box-shadow:none');
    gsap.set(lid, { transformPerspective: 900, rotationX: -100 });
    gsap.set(chip, { y: -(bt + 140) });
    to(grp, { opacity: 0, scale: 0.85, y: 24 }, { opacity: 1, scale: 1, y: 0 }, e.t0, 0.3, 'back.out(1.6)');
    tl.fromTo(chip, { y: -(bt + 140) }, { y: 0, duration: 0.5, ease: 'power2.in', immediateRender: false }, e.t0 + 0.3);
    tl.fromTo(lid, { rotationX: -100 }, { rotationX: 0, duration: 0.3, ease: 'back.out(1.6)', immediateRender: false }, e.t0 + 1);
    tl.fromTo(grp, { scale: 1 }, { scale: 1.04, duration: 0.1, yoyo: true, repeat: 1, ease: 'power1.out', immediateRender: false, transformOrigin: origin(fl + fw / 2, bt + fh / 2) }, e.t0 + 1.2);
    fadeOut(grp, e, 20);
  };

  E['jiggle-delete'] = function (e, a, p) {
    var b = box('front', e), gap = 24, t = Math.min(150, (ZB - ZT - gap) / 2), gw = 3 * t + 2 * gap, gl = Math.max(20, Math.min(W - gw - 20, HX - gw / 2)), gt = ZB - (2 * t + gap);
    var labels = list(p.labels, ['Mail', 'Notes', 'Photos', 'Music', 'Maps', 'Clips']), gone = p.remove != null ? +p.remove : 1;
    var slot = function (i) { return { x: gl + (i % 3) * (t + gap), y: gt + Math.floor(i / 3) * (t + gap) }; };
    var tiles = labels.slice(0, 6).map(function (lb, i) {
      var s = slot(i), str = text(lb);
      var d = gcard(b, 'left:0;top:0;width:' + t + 'px;height:' + t + 'px;border-radius:' + t * 0.24 + 'px;opacity:0');
      el('div', null, d, 'text-align:center;color:' + TXT + ';font:500 ' + t * 0.42 + 'px/1 ' + SERIF + ';margin-top:' + t * 0.16 + 'px', esc(str.charAt(0)));
      el('div', null, d, 'position:absolute;left:0;right:0;bottom:' + t * 0.12 + 'px;text-align:center;color:' + TXT + ';font:700 ' + t * 0.1 + 'px/1 ' + MONO + ';letter-spacing:.1em', esc(str.toUpperCase()));
      gsap.set(d, { x: s.x, y: s.y, opacity: 0, scale: 0.5 });
      to(d, { opacity: 0, scale: 0.5, x: s.x, y: s.y }, { opacity: 1, scale: 1, x: s.x, y: s.y }, e.t0 + i * 0.05, 0.3, 'back.out(1.8)');
      return d;
    });
    var rest = tiles.filter(function (_, i) { return i !== gone; });
    var victim = tiles[gone], tDel = e.t0 + 1.05;
    var badge = el('div', null, victim, 'position:absolute;left:-16px;top:-16px;width:46px;height:46px;border-radius:50%;background:var(--t-accent);border:3px solid ' + CRM + ';color:var(--t-on-accent);font:800 28px/40px Inter;text-align:center;opacity:0', '&times;');
    to(badge, { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1 }, e.t0 + 0.7, 0.25, 'back.out(3)');
    to(victim, { scale: 1, opacity: 1 }, { scale: 0, opacity: 0 }, tDel, 0.28, 'power2.in');
    rest.forEach(function (d, k) { var o = slot(tiles.indexOf(d)), s = slot(k); to(d, { x: o.x, y: o.y }, { x: s.x, y: s.y }, tDel + 0.2, 0.45, 'back.out(1.3)'); });
    drive(e, function (v) {
      var tt = v * e.dur;
      tiles.forEach(function (d, i) { d.style.rotate = (i === gone && tt > tDel - e.t0 ? 0 : Math.sin(tt * 38 + i * 1.9) * 2.4) + 'deg'; });
    });
    rest.forEach(function (d) { to(d, { opacity: 1 }, { opacity: 0 }, end(e) - 0.25, 0.22, 'power1.in'); });
  };

  E['eyedropper-grade'] = function (e, a, p) {
    var k = Math.min(1, e.dur / 2.2), b = box('front', e), col = p.color || '#d98f3a', sx = W * 0.72, sy = ZT + 150, s = 1.25;
    var wash = el('div', 'abs', L.camfx, 'left:0;top:0;width:100%;height:100%;background:' + col + ';opacity:0');
    var ring = el('div', null, b, 'position:absolute;left:' + (sx - 26) + 'px;top:' + (sy - 26) + 'px;width:52px;height:52px;border-radius:50%;border:3px solid ' + ACC + ';opacity:0');
    var cur = el('div', null, b, 'position:absolute;left:' + (sx - 19 * s) + 'px;top:' + (sy - 81 * s) + 'px;width:' + 100 * s + 'px;height:' + 100 * s + 'px;opacity:0',
      '<svg viewBox="0 0 100 100" width="100%" height="100%"><g style="fill:' + GRN + ';stroke:' + CRM + '" stroke-width="4" stroke-linejoin="round" transform="rotate(45 50 50)"><rect x="40" y="4" width="20" height="28" rx="10"/><rect x="33" y="32" width="34" height="10" rx="3"/><rect x="42" y="42" width="16" height="30"/><path d="M42 72 H58 L50 94 Z"/></g></svg>');
    var card = gcard(b, 'left:' + (sx - 330) + 'px;top:' + (sy - 40) + 'px;width:250px;height:92px;border-radius:20px;opacity:0');
    var dot = el('div', null, card, 'position:absolute;left:18px;top:18px;width:52px;height:52px;border-radius:50%;background:' + col + ';border:3px solid ' + CRM);
    el('div', null, card, 'position:absolute;left:88px;top:0;line-height:86px;font:700 26px/86px ' + MONO + ';color:' + TXT + ';letter-spacing:.08em', esc(col.toUpperCase()));
    to(cur, { opacity: 0, x: 240, y: -110 }, { opacity: 1, x: 0, y: 0 }, e.t0, k * 0.7, 'power3.inOut');
    to(cur, { scale: 1 }, { scale: 0.9 }, e.t0 + k * 0.72, k * 0.08, 'power2.out');
    to(cur, { scale: 0.9 }, { scale: 1 }, e.t0 + k * 0.8, k * 0.15, 'back.out(3)');
    to(ring, { opacity: 0.9, scale: 0.3 }, { opacity: 0, scale: 2.2 }, e.t0 + k * 0.75, k * 0.5, 'power2.out');
    to(card, { opacity: 0, x: 30, scale: 0.8 }, { opacity: 1, x: 0, scale: 1 }, e.t0 + k * 0.8, k * 0.3, 'back.out(1.8)');
    to(dot, { scale: 0 }, { scale: 1 }, e.t0 + k * 0.9, k * 0.3, 'back.out(2)');
    var f0 = 'blur(0px) saturate(1) sepia(0) hue-rotate(0deg)';
    to(L.cam, { filter: f0 }, { filter: 'blur(0px) saturate(1.2) sepia(0.5) hue-rotate(-12deg)' }, e.t0 + k * 1, k * 0.6, 'power2.inOut');
    to(wash, { opacity: 0 }, { opacity: 0.2 }, e.t0 + k * 1, k * 0.6, 'power2.inOut');
    set(wash, { opacity: 0 }, end(e));
    camReset(e);
    [cur, card].forEach(function (t) { fadeOut(t, e, 0); });
  };

  E['film-look'] = function (e, a, p) {
    var b = box('front', e), bar = 96, n = Math.floor(e.dur * 12);
    var cv = el('canvas', 'abs', b, 'left:0;top:0;width:1080px;height:1920px;opacity:.16');
    cv.width = 270; cv.height = 480;
    var g = cv.getContext('2d'), img = g.createImageData(270, 480);
    el('div', 'abs', b, 'left:0;top:0;width:100%;height:100%;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 55%,rgba(20,12,4,.45) 100%)');
    el('div', 'abs', b, 'left:0;top:0;width:100%;height:100%;background:rgba(70,48,28,.14)');
    var top = el('div', 'abs', b, 'left:0;top:0;width:100%;height:' + bar + 'px;background:var(--t-bg-deep)');
    var bot = el('div', 'abs', b, 'left:0;top:' + (H - bar) + 'px;width:100%;height:' + bar + 'px;background:var(--t-bg-deep)');
    el('div', null, top, 'position:absolute;left:44px;top:0;line-height:' + bar + 'px;font:700 24px/' + bar + 'px ' + MONO + ';letter-spacing:.34em;color:' + TXT, esc(p.label || 'FILM'));
    to(top, { y: -bar }, { y: 0 }, e.t0, 0.35, 'power3.out');
    to(bot, { y: bar }, { y: 0 }, e.t0, 0.35, 'power3.out');
    to(top, { y: 0 }, { y: -bar }, end(e) - 0.3, 0.28, 'power2.in');
    to(bot, { y: 0 }, { y: bar }, end(e) - 0.3, 0.28, 'power2.in');
    set(L.cam, { transformOrigin: origin(W / 2, H / 2) }, e.t0);
    to(L.cam, { filter: 'blur(0px) saturate(1) sepia(0) contrast(1) brightness(1)' }, { filter: 'blur(0px) saturate(0.82) sepia(0.38) contrast(0.9) brightness(1.05)' }, e.t0, 0.35, 'power1.out');
    for (var i = 0; i < n; i++) {
      var r1 = Math.sin(i * 12.9898) * 43758.5453, r2 = Math.sin(i * 78.233) * 12345.6789;
      set(L.cam, { x: ((r1 - Math.floor(r1)) - 0.5) * 8, y: ((r2 - Math.floor(r2)) - 0.5) * 8, scale: 1.03, rotation: Math.sin(i * 2.3) * 0.25 }, e.t0 + i / 12);
    }
    to(L.cam, { filter: 'blur(0px) saturate(0.82) sepia(0.38) contrast(0.9) brightness(1.05)' }, { filter: 'blur(0px) saturate(1) sepia(0) contrast(1) brightness(1)' }, end(e) - 0.3, 0.28, 'power1.in');
    camReset(e);
    drive(e, function (v) {
      var f = Math.floor(v * e.dur * 24), d = img.data;
      for (var k = 0; k < d.length; k += 4) { var r = Math.sin(k * 0.0113 + f * 91.7) * 43758.5453, c = ((r - Math.floor(r)) * 255) | 0; d[k] = d[k + 1] = d[k + 2] = c; d[k + 3] = 255; }
      g.putImageData(img, 0, 0);
    });
  };

  // Layouts: the camera moves into a box (head at tx, ty, scale s) and a panel fills the rest. Clips are in the camera's own pixels.
  function syncClip(m, e) {
    m.muted = true; m.playsInline = true; m.preload = 'metadata';
    var last = -1;
    drive(e, function (v) {
      if (!m.duration) return;
      var want = Math.min(m.duration - 0.05, (+(e.params && e.params.from) || 0) + v * e.dur), smooth = want > last && want - last < 0.1; last = want;
      if (smooth) { if (m.paused) m.play().catch(function () {}); if (Math.abs(m.currentTime - want) > 0.3) m.currentTime = want; }
      else { m.pause(); m.currentTime = want; }
    });
    tl.call(function () { m.pause(); }, null, end(e));
  }
  function backdrop(u, p, e, base) {
    var mode = p.bgMode || 'dark', light = /light/.test(mode);
    el('div', 'abs', u, 'left:0;top:0;width:100%;height:100%;background:' + (p.bg || (light ? '#f2f0ec' : base)));
    if (!/blur/.test(mode) || !(p.src || p.file)) return;
    var m = el(p.kind === 'video' ? 'video' : 'img', 'cover', u, 'filter:blur(' + (+p.blur || 40) + 'px)');
    m.src = p.src || p.file;
    if (p.kind === 'video') syncClip(m, e);
    else to(m, { scale: 1.2, x: -30, y: 0 }, { scale: 1.34, x: 30, y: -20 }, e.t0, Math.max(0.5, e.dur), 'none');
    el('div', 'abs', u, 'left:0;top:0;width:100%;height:100%;background:' + (light ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)'));
  }
  function fill(parent, p, e, css) {
    var d = el('div', 'abs', parent, 'overflow:hidden;background:var(--t-bg);' + css);
    if (p.top === 'picture' && p.svg) {
      var pc = el('div', null, d, 'position:absolute;left:6%;right:6%;top:6%;bottom:6%;display:flex;align-items:center;justify-content:center', String(p.svg).replace(/<script[\s\S]*?<\/script>/gi, ''));
      var sv = pc.querySelector('svg'); if (sv) { sv.setAttribute('width', '100%'); sv.setAttribute('height', '100%'); }
      return d;
    }
    if (p.src || p.file) {
      var vid = p.kind === 'video', own = function (id, css) { var v = vid && $(id + e.k); if (!v) return null; d.appendChild(v); if (css) v.style.cssText += ';' + css; return v; };
      var BG = 'filter:blur(40px) brightness(.55);transform:scale(1.15);opacity:0';
      var bg = p.fit === 'cover' || p.plainBg ? null : own('clipb', BG) || el(vid ? 'video' : 'img', 'cover', d, BG);
      var m = own('clip') || el(vid ? 'video' : 'img', 'cover', d);
      if (!m.getAttribute('src')) m.src = p.src || p.file;
      if (p.plainBg) { d.style.background = '#0b0b0d'; m.style.objectFit = 'contain'; m.style.scale = +p.fill > 0 ? String(+p.fill) : '.94'; }
      if (bg && !bg.getAttribute('src')) bg.src = m.src;
      if (vid) { syncClip(m, e); if (bg) { bg.muted = true; syncClip(bg, e); } }
      var fit = function () {
        var mw0 = m.videoWidth || m.naturalWidth, mh0 = m.videoHeight || m.naturalHeight, bw0 = d.clientWidth || W, bh0 = d.clientHeight || H / 2;
        if (!bg || !mw0 || !mh0) return;
        var r = (mw0 / mh0) / (bw0 / bh0), cut = 1 - Math.min(r, 1 / r);
        // Cropping that loses over 15% of the picture shows it whole on a blurred copy instead.
        if (p.fit === 'contain' || cut > 0.15) { m.style.objectFit = 'contain'; m.style.scale = +p.fill > 0 ? String(+p.fill) : '.94'; bg.style.opacity = 1;
          if (e.fx === 'full-picture') { var ph = (r >= 1 ? W / (mw0 / mh0) : H) * (+p.fill > 0 ? +p.fill : 0.94), pb = H / 2 + Math.min(ph, H) / 2; (window.YCAP = window.YCAP || {})[e.k] = H - pb > 220 ? { t0: e.t0, t1: e.t0 + e.dur, y: Math.min((pb + H) / 2, pb + 130) } : null; } }
      };
      m.addEventListener(vid ? 'loadedmetadata' : 'load', fit); fit();
      if (p.source) { var st = el('div', 'abs', d, 'left:18px;bottom:16px;z-index:3;padding:7px 14px;border-radius:999px;background:rgba(10,12,18,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:rgba(255,255,255,.92);font:600 22px/1 Inter,sans-serif;letter-spacing:.01em', 'Source: ' + esc(p.source)); to(st, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, e.t0 + 0.4, 0.35, 'power2.out'); }
      // Ken Burns, opt-in (off by default): kb: 'on' pushes a still in toward kbx/kby (0-1) for the scene.
      if (!vid && p.kb === 'on') {
        var KB = [[0.3, 0.35], [0.7, 0.6], [0.65, 0.3], [0.35, 0.65]], kp = p.kbx != null ? [+p.kbx, +p.kby] : KB[Math.abs(parseInt(e.k, 10) || 0) % KB.length];
        set(m, { transformOrigin: (kp[0] * 100).toFixed(0) + '% ' + (kp[1] * 100).toFixed(0) + '%' }, e.t0);
        tl.fromTo(m, { scale: 1 }, { scale: 1.08, duration: Math.max(0.5, e.dur), ease: 'none', immediateRender: false }, e.t0);
      }
      return d;
    }
    var t = String(p.text || p.word || ''), w = String(p.word || ''), fs = t.length <= 12 ? 150 : t.length <= 26 ? 112 : t.length <= 44 ? 86 : 68, html = esc(t);
    if (w && t.indexOf(w) >= 0) html = html.replace(esc(w), '<span style="color:var(--t-accent)">' + esc(w) + '</span>');
    el('div', null, d, 'position:absolute;left:8%;right:8%;top:50%;transform:translateY(-50%);text-align:center;font:900 ' + fs + 'px/1.02 Inter;letter-spacing:-.03em;color:var(--t-text)', html);
    return d;
  }
  function animOut(e) { return (e.params || {}).out === 'animate'; }
  function cutIn(e) { return (e.params || {}).in !== 'animate'; }
  function slide(t, e, from) {
    if (cutIn(e)) set(t, { x: 0, y: 0, opacity: 1 }, e.t0);
    else to(t, from, { x: 0, y: 0, opacity: 1 }, e.t0 + 0.05, 0.5, 'power3.out');
    if (animOut(e)) to(t, { x: 0, y: 0, opacity: 1 }, from, end(e) - 0.45, 0.42, 'power3.in');
  }
  function frameOf(s, tx, ty) {
    var dx = tx - HX, dy = ty - HY;
    return { s: s, dx: dx, dy: dy, x: function (v) { return +(HX + (v - HX - dx) / s).toFixed(1); }, y: function (v) { return +(HY + (v - HY - dy) / s).toFixed(1); } };
  }
  function insetOf(F, b) { return 'inset(' + F.y(b[1]) + 'px ' + +(W - F.x(b[2])).toFixed(1) + 'px ' + +(H - F.y(b[3])).toFixed(1) + 'px ' + F.x(b[0]) + 'px round ' + +((b[4] || 0) / F.s).toFixed(1) + 'px)'; }
  function place(e, F, clipTo, clipFrom) {
    var A = { scale: F.s, x: F.dx, y: F.dy, clipPath: clipTo }, Z = { scale: 1, x: 0, y: 0, clipPath: clipFrom || CAM0.clipPath };
    set(L.cam, { transformOrigin: origin(HX, HY) }, e.t0);
    if (cutIn(e)) set(L.cam, A, e.t0);
    else to(L.cam, Z, A, e.t0, 0.5, 'power3.inOut');
    if (animOut(e)) to(L.cam, A, Z, end(e) - 0.45, 0.42, 'power3.inOut');
    camReset(e);
  }
  // Smallest scale at which the moved camera still fills box b edge to edge (no backdrop strip showing).
  function coverScale(s, tx, ty, b) { return Math.max(s, (tx - b[0]) / (HX + OX), (b[2] - tx) / (W - HX + OX), (ty - b[1]) / HY, (b[3] - ty) / (H - HY)); }
  function camScale(px, lo, hi) { return Math.max(lo, Math.min(hi, px / HW)); }
  function label(parent, txt, css) { if (txt) el('div', 'abs', parent, 'padding:10px 20px;border-radius:14px;background:rgba(0,0,0,.6);color:#fff;font:700 30px/1 Inter;' + css, esc(txt)); }

  E['split-top'] = function (e, a, p) {
    var u = box('under', e), half = +p.split || H / 2;
    backdrop(u, p, e, 'var(--t-bg-deep)');
    if (p.shape === 'boxed') {
      var k = +p.size || 0.86, bw = (W - 120) * k, bh = (H - half - 110) * k, bx = (W - bw) / 2, by = half + 20 + (H - half - 110 - bh) / 2;
      slide(fill(u, p, e, 'left:40px;top:80px;width:' + (W - 80) + 'px;height:' + (half - 120) + 'px;border-radius:40px'), e, { y: -half, opacity: 1 });
      var Fb = frameOf(camScale(270, 0.55, 1.1) * k * (+p.faceZoom || 1), W / 2 + (+p.faceX || 0), by + 0.45 * bh + (+p.faceY || 0));
      return place(e, Fb, insetOf(Fb, [bx, by, bx + bw, by + bh, 56 * k]));
    }
    var tp = +p.topPad || 0;
    slide(fill(u, p, e, 'left:0;top:' + tp + 'px;width:' + W + 'px;height:' + (half - tp) + 'px'), e, { y: -half, opacity: 1 });
    var tx = W / 2 + (+p.faceX || 0), ty = half + 0.45 * (H - half) + (+p.faceY || 0);
    var F = frameOf(coverScale(camScale(270, 0.55, 1.1) * (+p.faceZoom || 1), tx, ty, [0, half, W, H]), tx, ty);
    var m = p.cutout === 'on' && mw(e);
    if (!m) return place(e, F, insetOf(F, [0, half, W, H, 0]));
    place(e, F, 'inset(0px 0px 100% 0px)');
    set(m, { transformOrigin: origin(HX, HY), scale: F.s, x: F.dx, y: F.dy, clipPath: 'inset(' + +F.y(half).toFixed(1) + 'px ' + -OX + 'px 0px ' + -OX + 'px)', opacity: 1 }, e.t0);
    set(m, { opacity: 1, scale: 1, x: 0, y: 0, clipPath: 'none' }, end(e));
  };

  E['split-screen'] = function (e, a, p) {
    var u = box('under', e), bt = +p.split || 1150, k = +p.size || 1, bw = (W - 120) * k, bh = (H - 50 - bt) * k, bx = (W - bw) / 2, by = H - 50 - bh;
    backdrop(u, p, e, '#0b0b0d');
    slide(fill(u, p, e, 'left:40px;top:110px;width:' + (W - 80) + 'px;height:' + (bt - 160) + 'px;border-radius:40px'), e, { y: -140, opacity: 0 });
    var sw = p.stat && list(p.stat.words, null);
    if (sw) {
      var st = el('div', 'abs', box('front', e), 'left:40px;width:' + (W - 80) + 'px;top:' + (110 + (bt - 160) / 2 - 300) + 'px;height:600px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#fff;font-family:Inter,sans-serif;text-shadow:0 0 18px rgba(140,210,255,.95),0 0 54px rgba(70,150,255,.85),0 4px 24px rgba(0,0,0,.55)');
      var glow = el('div', 'abs', st, 'inset:0;background:radial-gradient(closest-side,rgba(4,10,24,.72),rgba(4,10,24,0))'), row = null, big = true;
      sw.forEach(function (w, i) {
        if (!row || w.br) { if (row) big = false; row = el('div', null, st, 'position:relative;display:flex;align-items:baseline;gap:18px;font:900 ' + (big ? '280px/.88' : '104px/1') + ' Inter,sans-serif;letter-spacing:' + (big ? '-.05em' : '.08em') + ';text-transform:uppercase'); }
        var t = w.t != null ? w.t : e.t0, d = el('span', null, row, i === 1 && big ? 'font-size:.62em' : '', esc(text(w)));
        to(d, { opacity: 0, scale: 1.5, filter: 'blur(14px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)' }, t, 0.3, 'back.out(1.7)');
        if (i === 0) to(glow, { opacity: 0 }, { opacity: 1 }, t, 0.25);
      });
    }
    var s = camScale(340, 0.6, 1.4) * k * (+p.faceZoom || 1), F = frameOf(s, W / 2 + (+p.faceX || 0), by - 110 * k + 0.62 * HW * s + (+p.faceY || 0));
    place(e, F, insetOf(F, [bx, by, bx + bw, by + bh, (p.radius != null ? +p.radius : 64) * k]));
    var swap = p.meBg || +p.meBlur > 0;
    if (p.meBg) {
      var mb = el('div', 'abs', u, 'left:' + bx + 'px;top:' + by + 'px;width:' + bw + 'px;height:' + bh + 'px;border-radius:' + (p.radius != null ? +p.radius : 64) * k + 'px;overflow:hidden'), bv = /\.(mp4|webm|mov)(\?|$)/i.test(p.meBg);
      var bg = el(bv ? 'video' : 'img', 'cover', mb, 'filter:blur(' + (+p.meBlur || 0) + 'px);transform:scale(' + (+p.meBlur ? 1.08 : 1) + ')');
      bg.src = p.meBg; if (bv) { bg.muted = true; bg.loop = true; syncClip(bg, e); }
      set(L.cam, { opacity: 0 }, e.t0); set(L.cam, { opacity: 1 }, end(e));
    } else if (+p.meBlur > 0) { set(L.cam, { filter: 'blur(' + +p.meBlur + 'px)' }, e.t0); set(L.cam, { filter: 'none' }, end(e)); }
    var m = mw(e);
    if (!m) return;
    set(m, { transformOrigin: origin(HX, HY), scale: s, x: F.dx, y: F.dy, clipPath: 'inset(0px ' + -OX + 'px ' + +(H - F.y(swap ? by + bh : by + 40)).toFixed(1) + 'px ' + -OX + 'px)', opacity: cutIn(e) ? 1 : 0 }, e.t0);
    // One set per instant: two opposite sets at 0:00 left the first cut-out hidden in HyperFrames export.
    if (!cutIn(e)) set(m, { opacity: 1 }, e.t0 + 0.5);
    if (animOut(e)) set(m, { opacity: 0 }, end(e) - 0.45);
    set(m, { opacity: 1, scale: 1, x: 0, y: 0, clipPath: 'none' }, end(e));
  };

  E['title-stack'] = function (e, a, p) {
    var u = box('under', e), b = box('behind', e), p1 = [40, 270, W - 40, 1000], p2 = [40, 1040, W - 40, 1840, 36];
    backdrop(u, p, e, '#0b0b0d');
    var ttl = el('div', 'abs', b, 'left:60px;right:60px;top:70px;height:180px;display:flex;align-items:center;justify-content:center;text-align:center;color:#fff;font:800 ' + (String(p.title || '').length > 30 ? 56 : 70) + 'px/1.05 Inter;letter-spacing:-.02em', esc(p.title || ''));
    slide(ttl, e, { y: -60, opacity: 0 });
    var pan = fill(u, Object.assign({}, p, { text: p.word || p.text }), e, 'left:' + p1[0] + 'px;top:' + p1[1] + 'px;width:' + (p1[2] - p1[0]) + 'px;height:' + (p1[3] - p1[1]) + 'px;border-radius:36px');
    label(pan, p.top, 'left:24px;bottom:24px');
    slide(pan, e, { x: W, opacity: 1 });
    var F = frameOf(camScale(300, 0.55, 1.2) * (+p.faceZoom || 1), W / 2 + (+p.faceX || 0), p2[1] + 0.42 * (p2[3] - p2[1]) + (+p.faceY || 0));
    place(e, F, insetOf(F, p2));
    if (p.bottom) { var lb = el('div', 'abs', b, 'left:0;top:0'); label(lb, p.bottom, 'left:' + (p2[0] + 24) + 'px;top:' + (p2[3] - 76) + 'px'); slide(lb, e, { y: 30, opacity: 0 }); }
  };

  E['face-bubble'] = function (e, a, p) {
    var u = box('under', e), b = box('behind', e), R = +p.bubble || 170, cx = p.side === 'right' ? W - 60 - R : 60 + R, cy = 160 + R;
    slide(fill(u, p, e, 'left:0;top:0;width:100%;height:100%'), e, { y: 0, opacity: 0 });
    var F = frameOf(camScale(R * 1.5, 0.3, 1.4) * (+p.faceZoom || 1), cx + (+p.faceX || 0), cy + (+p.faceY || 0));
    place(e, F, 'circle(' + +(R / F.s).toFixed(1) + 'px at ' + F.x(cx) + 'px ' + F.y(cy) + 'px)', 'circle(2400px at ' + HX.toFixed(1) + 'px ' + HY.toFixed(1) + 'px)');
    var ring = el('div', 'abs', b, 'left:' + (cx - R - 5) + 'px;top:' + (cy - R - 5) + 'px;width:' + (2 * R + 10) + 'px;height:' + (2 * R + 10) + 'px;border-radius:50%;border:6px solid #fff;box-shadow:0 18px 50px rgba(0,0,0,.45)');
    if (cutIn(e)) set(ring, { opacity: 1, scale: 1 }, e.t0);
    else to(ring, { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1 }, e.t0 + 0.4, 0.25, 'back.out(1.6)');
    if (animOut(e)) to(ring, { opacity: 1 }, { opacity: 0 }, end(e) - 0.45, 0.15, 'none');
  };

  // p.widget {i, n, label, title}: step counter + segmented bar in the band under a letterboxed clip; step i fills over the card.
  function stepWidget(e, w) {
    var b = box('front', e), n = +w.n || 1, i = +w.i || 1, top = w.y != null ? +w.y : 1530;
    var g = el('div', 'abs', b, 'left:150px;right:150px;top:' + top + 'px;color:#fff;font-family:Inter,sans-serif;text-align:center');
    el('div', null, g, 'font:700 26px/1 Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:.62;margin-bottom:12px', esc((w.title || '') + (n > 1 ? (w.title ? ' · ' : '') + i + ' / ' + n : '')));
    el('div', null, g, 'font:800 46px/1.1 Inter,sans-serif;letter-spacing:-.01em;margin-bottom:20px', esc(w.label || ''));
    if (w.peaks) {
      var wv = el('div', null, g, 'display:flex;align-items:center;gap:4px;height:96px'), bars = w.peaks.map(function (v) { return el('div', null, wv, 'flex:1;border-radius:3px;background:rgba(255,255,255,.22);height:' + Math.round(10 + 86 * v) + 'px'); });
      drive(e, function (v) { var on = v * bars.length; bars.forEach(function (bar, i) { var lit = i < on; bar.style.background = lit ? '#fff' : 'rgba(255,255,255,.22)'; bar.style.boxShadow = lit ? '0 0 10px rgba(255,255,255,.8)' : 'none'; }); });
      return to(g, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, e.t0 + 0.05, 0.3, 'power2.out');
    }
    var row = el('div', null, g, 'display:flex;gap:10px');
    for (var k = 1; k <= n; k++) {
      var seg = el('div', null, row, 'flex:1;height:10px;border-radius:5px;background:rgba(255,255,255,.14);overflow:visible');
      var f = el('div', null, seg, 'height:100%;width:' + (k < i ? 100 : 0) + '%;background:#fff;border-radius:5px;box-shadow:0 0 10px rgba(255,255,255,.9),0 0 22px rgba(255,255,255,.45)');
      if (k === i) (function (f) { drive(e, function (v) { f.style.width = (v * 100).toFixed(1) + '%'; }); })(f);
    }
    to(g, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, e.t0 + 0.05, 0.3, 'power2.out');
  }

  // p.topAid {kind, label}: small looping drawing in the empty band above a letterboxed clip; driven by time so export matches.
  // p.topAid {who, where, when}: who said it, where and when, for a quoted clip.
  var AIDS = {
    frame: function (mk, A) {
      var c = [[60, 40, 1, 1], [240, 40, -1, 1], [60, 160, 1, -1], [240, 160, -1, -1]].map(function (q) { return mk('path', { d: 'M' + q[0] + ' ' + (q[1] + 30 * q[3]) + 'V' + q[1] + 'H' + (q[0] + 30 * q[2]), fill: 'none', stroke: '#fff', 'stroke-width': 8, 'stroke-linecap': 'round' }); });
      var dot = mk('circle', { cx: 150, cy: 100, r: 16, fill: '#ff4d4d' });
      return function (t) { var k = 1 - 0.06 * (0.5 + 0.5 * Math.sin(t * 4)); c.forEach(function (n) { n.setAttribute('transform', 'translate(150 100) scale(' + k.toFixed(3) + ') translate(-150 -100)'); }); dot.setAttribute('opacity', (t % 1) < 0.55 ? 1 : 0.15); };
    },
    bounce: function (mk, A) {
      mk('line', { x1: 30, y1: 178, x2: 270, y2: 178, stroke: 'rgba(255,255,255,.5)', 'stroke-width': 5, 'stroke-linecap': 'round' });
      var ball = mk('ellipse', { cx: 150, cy: 150, rx: 22, ry: 22, fill: A });
      return function (t) { var ph = (t % 0.9) / 0.9, h = Math.abs(Math.sin(Math.PI * ph)), sq = h < 0.12 ? 1 + (0.12 - h) * 2.5 : 1; ball.setAttribute('cx', (60 + 180 * (0.5 + 0.5 * Math.sin(t * 1.3))).toFixed(1)); ball.setAttribute('cy', (178 - 22 / sq - 120 * h).toFixed(1)); ball.setAttribute('rx', (22 * sq).toFixed(1)); ball.setAttribute('ry', (22 / sq).toFixed(1)); };
    },
    steps: function (mk, A) {
      var rows = [0, 1, 2].map(function (k) { var y = 40 + k * 60; mk('rect', { x: 50, y: y - 18, width: 36, height: 36, rx: 9, fill: 'none', stroke: '#fff', 'stroke-width': 5 }); var ln = mk('rect', { x: 104, y: y - 7, width: 140 - k * 20, height: 14, rx: 7, fill: '#fff', opacity: 0.3 }); var ck = mk('path', { d: 'M57 ' + y + 'l9 9l17 -19', fill: 'none', stroke: A, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': 40, 'stroke-dashoffset': 40 }); return [ck, ln]; });
      return function (t) { rows.forEach(function (r, k) { var f = Math.max(0, Math.min(1, (t - 0.3 - k * 0.45) / 0.25)); r[0].setAttribute('stroke-dashoffset', (40 * (1 - f)).toFixed(1)); r[1].setAttribute('opacity', (0.3 + 0.7 * f).toFixed(2)); }); };
    },
    keys: function (mk, A) {
      var K = [['W', 125, 35], ['A', 60, 105], ['S', 125, 105], ['D', 190, 105]].map(function (q) { var r = mk('rect', { x: q[1], y: q[2], width: 56, height: 56, rx: 12, fill: 'none', stroke: '#fff', 'stroke-width': 5 }); var tx = mk('text', { x: q[1] + 28, y: q[2] + 39, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'Inter,sans-serif', 'font-weight': 800, 'font-size': 28 }); tx.textContent = q[0]; return [r, tx]; });
      var seq = [0, 0, 3, 1, 0, 2];
      return function (t) { var on = seq[Math.floor(t / 0.35) % seq.length]; K.forEach(function (k, i) { k[0].setAttribute('stroke', i === on ? A : '#fff'); k[0].setAttribute('fill', i === on ? 'rgba(255,196,107,.28)' : 'rgba(255,255,255,.06)'); k[1].setAttribute('fill', i === on ? A : '#fff'); }); };
    },
    human: function (mk, A) {
      mk('line', { x1: 60, y1: 182, x2: 240, y2: 182, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 4, 'stroke-linecap': 'round' });
      var st = { fill: 'none', stroke: A, 'stroke-width': 9, 'stroke-linecap': 'round' }, head = mk('circle', { cx: 150, cy: 42, r: 17, fill: A });
      var body = mk('line', Object.assign({ x1: 150, y1: 62, x2: 150, y2: 118 }, st)), L = [0, 1, 2, 3].map(function () { return mk('line', st); });
      return function (t) {
        var a = Math.sin(t * 6) * 0.55, x = 150 + 6 * Math.sin(t * 12), seg = function (n, x0, y0, ang, len) { n.setAttribute('x1', x0); n.setAttribute('y1', y0); n.setAttribute('x2', (x0 + Math.sin(ang) * len).toFixed(1)); n.setAttribute('y2', (y0 + Math.cos(ang) * len).toFixed(1)); };
        head.setAttribute('cx', x.toFixed(1)); body.setAttribute('x1', x.toFixed(1)); body.setAttribute('x2', x.toFixed(1));
        seg(L[0], x, 118, a, 64); seg(L[1], x, 118, -a, 64); seg(L[2], x, 72, -a * 0.9, 48); seg(L[3], x, 72, a * 0.9, 48);
      };
    },
    world: function (mk, A) {
      mk('rect', { x: 40, y: 28, width: 220, height: 150, rx: 18, fill: 'rgba(255,255,255,.05)', stroke: 'rgba(255,255,255,.5)', 'stroke-width': 4 });
      var P = ['M44 174L95 96L130 140L178 70L256 174Z', 'M44 174V120H72V92H100V130H124V70H156V112H184V84H212V128H256V174Z', 'M44 174L70 112L96 174ZM96 174L130 84L164 174ZM164 174L200 104L236 174ZM228 174L246 136L256 174Z'].map(function (d) { return mk('path', { d: d, fill: A, opacity: 0 }); });
      var spark = mk('path', { d: 'M222 40l5 13l13 5l-13 5l-5 13l-5 -13l-13 -5l13 -5z', fill: '#fff' });
      return function (t) { var ph = t / 1.1, i = Math.floor(ph) % 3, f = ph - Math.floor(ph), x = Math.min(1, f / 0.25); P.forEach(function (n, k) { n.setAttribute('opacity', k === i ? (0.9 * x).toFixed(2) : k === (i + 2) % 3 ? (0.9 * (1 - x)).toFixed(2) : 0); }); spark.setAttribute('transform', 'translate(222 58) scale(' + (0.6 + 0.6 * Math.max(0, 1 - f * 3)).toFixed(2) + ') translate(-222 -58)'); };
    },
    robot: function (mk, A) {
      var st = { fill: 'none', stroke: A, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': '14 10' };
      var parts = [mk('rect', Object.assign({ x: 105, y: 50, width: 90, height: 72, rx: 16 }, st)), mk('line', Object.assign({ x1: 150, y1: 50, x2: 150, y2: 26 }, st)), mk('rect', Object.assign({ x: 115, y: 130, width: 70, height: 50, rx: 10 }, st)), mk('line', Object.assign({ x1: 115, y1: 145, x2: 78, y2: 172 }, st)), mk('line', Object.assign({ x1: 185, y1: 145, x2: 222, y2: 172 }, st))];
      var eyes = [mk('circle', { cx: 132, cy: 84, r: 7, fill: '#fff' }), mk('circle', { cx: 168, cy: 84, r: 7, fill: '#fff' })];
      return function (t) { parts.forEach(function (n) { n.setAttribute('stroke-dashoffset', (-t * 40).toFixed(1)); }); var o = 0.35 + 0.65 * Math.abs(Math.sin(t * 3)); parts.forEach(function (n) { n.setAttribute('opacity', o.toFixed(2)); }); eyes.forEach(function (n) { n.setAttribute('opacity', (t % 1.4) < 1.3 ? 1 : 0); }); };
    },
    loop: function (mk, A) {
      var g = mk('g', {}), arc = document.createElementNS('http://www.w3.org/2000/svg', 'path'); arc.setAttribute('d', 'M150 30A70 70 0 1 1 82 118'); arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', A); arc.setAttribute('stroke-width', 9); arc.setAttribute('stroke-linecap', 'round'); g.appendChild(arc);
      var head = document.createElementNS('http://www.w3.org/2000/svg', 'path'); head.setAttribute('d', 'M70 104l12 16l16 -12'); head.setAttribute('fill', 'none'); head.setAttribute('stroke', A); head.setAttribute('stroke-width', 9); head.setAttribute('stroke-linecap', 'round'); head.setAttribute('stroke-linejoin', 'round'); g.appendChild(head);
      var n = mk('text', { x: 150, y: 114, 'text-anchor': 'middle', fill: '#fff', 'font-family': 'Inter,sans-serif', 'font-weight': 900, 'font-size': 34 });
      return function (t) { g.setAttribute('transform', 'rotate(' + (t * 240).toFixed(1) + ' 150 100)'); n.textContent = Math.floor(Math.pow(t + 0.4, 2.6) * 700).toLocaleString('en-US'); };
    },
    shield: function (mk, A) {
      mk('path', { d: 'M150 22l62 22v52c0 42 -28 70 -62 84c-34 -14 -62 -42 -62 -84v-52z', fill: 'rgba(255,196,107,.12)', stroke: A, 'stroke-width': 7, 'stroke-linejoin': 'round' });
      var ck = mk('path', { d: 'M120 102l22 22l40 -46', fill: 'none', stroke: '#fff', 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': 110, 'stroke-dashoffset': 110 });
      return function (t) { ck.setAttribute('stroke-dashoffset', (110 * (1 - Math.max(0, Math.min(1, (t - 0.4) / 0.5)))).toFixed(1)); };
    },
    chat: function (mk, A) {
      mk('path', { d: 'M60 40h180a20 20 0 0 1 20 20v70a20 20 0 0 1 -20 20h-120l-36 28v-28h-24a20 20 0 0 1 -20 -20v-70a20 20 0 0 1 20 -20z', fill: 'rgba(255,255,255,.06)', stroke: '#fff', 'stroke-width': 6, 'stroke-linejoin': 'round' });
      var d = [110, 150, 190].map(function (x) { return mk('circle', { cx: x, cy: 95, r: 12, fill: A }); });
      return function (t) { d.forEach(function (n, k) { n.setAttribute('cy', (95 - 12 * Math.max(0, Math.sin(t * 7 - k * 0.8))).toFixed(1)); }); };
    },
    uses: function (mk, A, label) {
      var NS = 'http://www.w3.org/2000/svg', sets = [], g = function () { var x = document.createElementNS(NS, 'g'); x.setAttribute('opacity', 0); sets.push(x); return x; }, add = function (grp, tag, at) { var n = document.createElementNS(NS, tag); for (var k in at) n.setAttribute(k, at[k]); grp.appendChild(n); return n; }, S = { fill: 'none', stroke: A, 'stroke-width': 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      var r = g(); add(r, 'rect', Object.assign({ x: 112, y: 50, width: 76, height: 62, rx: 14 }, S)); add(r, 'rect', Object.assign({ x: 120, y: 120, width: 60, height: 46, rx: 10 }, S)); add(r, 'path', { d: 'M196 80h44M218 58v44', stroke: '#fff', 'stroke-width': 9, 'stroke-linecap': 'round' });
      var gp = g(); add(gp, 'path', Object.assign({ d: 'M92 70h116a40 40 0 0 1 36 56l-10 22a18 18 0 0 1 -30 4l-18 -22h-72l-18 22a18 18 0 0 1 -30 -4l-10 -22a40 40 0 0 1 36 -56z' }, S)); add(gp, 'path', { d: 'M100 104h32M116 88v32', stroke: '#fff', 'stroke-width': 8, 'stroke-linecap': 'round' }); add(gp, 'circle', { cx: 186, cy: 98, r: 7, fill: '#fff' }); add(gp, 'circle', { cx: 204, cy: 114, r: 7, fill: '#fff' });
      var cl = g(); add(cl, 'rect', Object.assign({ x: 80, y: 82, width: 140, height: 92, rx: 10 }, S)); add(cl, 'path', Object.assign({ d: 'M80 82l14 -40l132 0l-6 40', transform: 'rotate(-10 80 82)' }, S)); add(cl, 'path', { d: 'M104 56l20 -14M144 56l20 -14M184 56l20 -14', stroke: '#fff', 'stroke-width': 7, 'stroke-linecap': 'round', transform: 'rotate(-10 80 82)' });
      var ph = g(); add(ph, 'rect', { x: 84, y: 36, width: 132, height: 132, rx: 8, fill: 'rgba(255,255,255,.08)', stroke: '#fff', 'stroke-width': 6, transform: 'rotate(-6 150 100)' }); add(ph, 'path', { d: 'M100 150l34 -40l26 28l18 -18l26 30z', fill: A, transform: 'rotate(-6 150 100)' }); add(ph, 'circle', { cx: 180, cy: 70, r: 12, fill: A });
      sets.forEach(function (x) { mk('g', {}).appendChild(x); });
      var at = this.at || [0, 1.7, 2.5, 3.7], names = this.names || ['Not just robots', 'Games', 'Film scenes', 'Old photos'];
      return function (t) { var i = 0; for (var k = 0; k < at.length; k++) if (t >= at[k]) i = k; sets.forEach(function (x, k) { x.setAttribute('opacity', k === i ? 1 : 0); }); label(names[i]); };
    },
    badge: function (mk, A) {
      var r = mk('rect', { x: 80, y: 62, width: 140, height: 76, rx: 38, fill: A }), t = mk('text', { x: 150, y: 114, 'text-anchor': 'middle', fill: '#1b1206', 'font-family': 'Inter,sans-serif', 'font-weight': 900, 'font-size': 44, 'letter-spacing': 2 }); t.textContent = 'NEW';
      var sp = [[62, 46, 1], [240, 52, 0.8], [232, 152, 0.7]].map(function (q) { return mk('path', { d: 'M' + q[0] + ' ' + (q[1] - 14) + 'l4 10l10 4l-10 4l-4 10l-4 -10l-10 -4l10 -4z', fill: '#fff' }); });
      return function (t2) { var k = 1 + 0.06 * Math.sin(t2 * 6); [r, t].forEach(function (n) { n.setAttribute('transform', 'translate(150 100) scale(' + k.toFixed(3) + ') translate(-150 -100)'); }); sp.forEach(function (n, i) { n.setAttribute('opacity', (0.2 + 0.8 * Math.max(0, Math.sin(t2 * 4 - i * 1.3))).toFixed(2)); }); };
    },
    comment: function (mk, A, label) {
      mk('path', { d: 'M40 30h160a18 18 0 0 1 18 18v52a18 18 0 0 1 -18 18h-110l-30 24v-24h-20a18 18 0 0 1 -18 -18v-52a18 18 0 0 1 18 -18z', fill: 'rgba(255,255,255,.08)', stroke: '#fff', 'stroke-width': 5, 'stroke-linejoin': 'round' });
      var tx = mk('text', { x: 120, y: 88, 'text-anchor': 'middle', fill: A, 'font-family': 'Inter,sans-serif', 'font-weight': 900, 'font-size': 40, 'letter-spacing': 3 });
      var pl = mk('path', { d: 'M0 0l44 -18l-14 44l-8 -16z M22 10l8 16', fill: '#fff', stroke: '#fff', 'stroke-width': 2, 'stroke-linejoin': 'round' });
      return function (t) { var n = Math.max(0, Math.min(5, Math.floor((t - 0.2) / 0.16) + 1)); tx.textContent = 'GENIE'.slice(0, n); var f = Math.max(0, Math.min(1, (t - 1.3) / 0.9)); pl.setAttribute('transform', 'translate(' + (226 + 60 * f).toFixed(1) + ' ' + (120 - 90 * f).toFixed(1) + ') rotate(' + (-10 * f).toFixed(1) + ')'); pl.setAttribute('opacity', (1 - Math.max(0, f - 0.7) / 0.3).toFixed(2)); };
    },
    question: function (mk, A) {
      var q = mk('text', { x: 150, y: 150, 'text-anchor': 'middle', fill: A, 'font-family': 'Inter,sans-serif', 'font-weight': 900, 'font-size': 150 }); q.textContent = '?';
      return function (t) { var k = 1 + 0.08 * Math.sin(t * 5); q.setAttribute('transform', 'translate(150 100) rotate(' + (8 * Math.sin(t * 2.5)).toFixed(1) + ') scale(' + k.toFixed(3) + ') translate(-150 -100)'); };
    },
    uplink: function (mk, A) {
      mk('path', { d: 'M-10 230Q150 150 310 230', fill: 'none', stroke: 'rgba(120,180,255,.55)', 'stroke-width': 5 });
      mk('rect', { x: 18, y: 118, width: 104, height: 62, rx: 10, fill: 'rgba(255,255,255,.08)', stroke: '#fff', 'stroke-width': 4 });
      var cur = mk('text', { x: 32, y: 158, fill: '#fff', 'font-family': 'JetBrains Mono,monospace', 'font-weight': 700, 'font-size': 26 }); cur.textContent = '>_';
      var path = 'M122 130C170 110 200 80 222 58';
      mk('path', { d: path, fill: 'none', stroke: 'rgba(255,255,255,.45)', 'stroke-width': 4, 'stroke-dasharray': '6 9', 'stroke-linecap': 'round' });
      mk('rect', { x: 222, y: 36, width: 30, height: 24, rx: 4, fill: '#fff' });
      mk('rect', { x: 186, y: 42, width: 32, height: 12, rx: 2, fill: A }); mk('rect', { x: 256, y: 42, width: 32, height: 12, rx: 2, fill: A });
      var dot = mk('circle', { r: 9, fill: A }), P = document.createElementNS('http://www.w3.org/2000/svg', 'path'); P.setAttribute('d', path); var len = P.getTotalLength ? 0 : 0;
      var pt = function (f) { var x0 = 122, y0 = 130, x1 = 170, y1 = 110, x2 = 200, y2 = 80, x3 = 222, y3 = 58, u = 1 - f; return [u * u * u * x0 + 3 * u * u * f * x1 + 3 * u * f * f * x2 + f * f * f * x3, u * u * u * y0 + 3 * u * u * f * y1 + 3 * u * f * f * y2 + f * f * f * y3]; };
      return function (t) { var f = (t % 1.2) / 1.2, p = pt(Math.min(1, f / 0.8)); dot.setAttribute('cx', p[0].toFixed(1)); dot.setAttribute('cy', p[1].toFixed(1)); dot.setAttribute('opacity', f < 0.85 ? 1 : 0); cur.setAttribute('opacity', (t % 0.6) < 0.4 ? 1 : 0.4); };
    },
    wave: function (mk, A) {
      mk('path', { d: 'M70 80h30l40 -34v108l-40 -34h-30z', fill: '#fff' });
      var arcs = [0, 1, 2].map(function (k) { var r = 34 + k * 26; return mk('path', { d: 'M' + (150 + r * 0.7) + ' ' + (100 - r * 0.7) + 'A' + r + ' ' + r + ' 0 0 1 ' + (150 + r * 0.7) + ' ' + (100 + r * 0.7), fill: 'none', stroke: A, 'stroke-width': 8, 'stroke-linecap': 'round' }); });
      return function (t) { arcs.forEach(function (n, k) { n.setAttribute('opacity', (0.15 + 0.85 * Math.max(0, Math.sin(t * 6 - k * 0.9))).toFixed(2)); }); };
    }
  };
  function contextCard(e, w) {
    var top = w.y != null ? +w.y + 'px' : ((H - W * 9 / 16) / 2 - 22) + 'px;transform:translateY(-100%)';
    var g = el('div', 'abs', box('front', e), 'left:44px;right:44px;top:' + top + ';display:flex;flex-direction:column;align-items:flex-start;gap:6px;color:#fff;text-shadow:0 1px 10px rgba(0,0,0,.6)');
    el('div', null, g, 'font:700 26px/1 Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;opacity:.95', esc(w.who));
    var src = [w.where, w.when].filter(Boolean).join(', ');
    if (src) el('div', null, g, 'font:italic 400 36px/1.1 "Instrument Serif",Georgia,serif;opacity:.78', esc(src));
  }
  function topAid(e, w) {
    if (w.who && !w.kind) return contextCard(e, w);
    if (w.who) contextCard(e, Object.assign({}, w, { y: w.footY }));
    var b = box('front', e), NS = 'http://www.w3.org/2000/svg', D = AIDS[w.kind];
    var g = el('div', 'abs', b, 'left:0;right:0;top:' + (w.y != null ? +w.y : 330) + 'px;display:flex;justify-content:center');
    var card = el('div', null, g, w.who ? 'display:flex;flex-direction:column;align-items:center;gap:4px;color:#fff;font-family:Inter,sans-serif' : 'display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 40px 22px;border-radius:30px;color:#fff;font-family:Inter,sans-serif;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.05));border:1.5px solid rgba(255,255,255,.28);box-shadow:0 22px 50px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.4),0 0 40px rgba(255,190,100,.12);backdrop-filter:blur(16px) saturate(1.3);-webkit-backdrop-filter:blur(16px) saturate(1.3)');
    var svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 300 200'); svg.setAttribute('width', w.who ? '390' : '270'); svg.setAttribute('height', w.who ? '260' : '180'); svg.style.filter = 'drop-shadow(0 0 10px rgba(255,190,100,.55))'; card.appendChild(svg);
    var lbl = el('div', null, card, (w.who ? 'font:600 34px/1.1 Inter,sans-serif;opacity:.85;' : 'font:800 42px/1.05 Inter,sans-serif;') + 'letter-spacing:-.01em;text-shadow:0 0 18px rgba(255,190,100,.35)', esc(w.label || ''));
    if (D) { var upd = D.call(w, function (tag, at) { var n = document.createElementNS(NS, tag); for (var k in at) n.setAttribute(k, at[k]); svg.appendChild(n); return n; }, '#ffc46b', function (txt) { if (lbl.textContent !== txt) lbl.textContent = txt; }); drive(e, function (v) { upd(v * e.dur); }); }
    to(g, { opacity: 0, y: -16 }, { opacity: 1, y: 0 }, e.t0 + 0.05, 0.35, 'power2.out');
  }

  E['full-picture'] = function (e, a, p) {
    if (p.topAid) topAid(e, p.topAid);
    if (p.widget) stepWidget(e, p.widget);
    var tp = +p.topPad || 0;
    slide(fill(box('under', e), p, e, 'left:0;top:' + tp + 'px;width:100%;height:' + (H - tp) + 'px'), e, { y: 0, opacity: 0 });
    place(e, frameOf(1, HX, HY), 'circle(0px at ' + HX.toFixed(1) + 'px ' + HY.toFixed(1) + 'px)', 'circle(2400px at ' + HX.toFixed(1) + 'px ' + HY.toFixed(1) + 'px)');
  };

  var PANELS = FX.effects.filter(function (x) { return x.fx === 'index-panel'; });
  var LEFT = ['gravity-drop', 'storyboard-deck', 'file-drop', 'jiggle-delete', 'eyedropper-grade', 'glass-type', 'scribble-note', 'price-stack', 'headline-wall', 'chart-grow'];
  FX.effects.forEach(function (e) {
    var fn = E[e.fx];
    CUR_END = end(e);
    if (fn) fn(e, e.assets || {}, e.params || {});
    CUR_END = Infinity;
    if (fn && LEFT.indexOf(e.fx) >= 0 && PANELS.some(function (q) { return e.t0 < q.t0 + q.dur && e.t0 + e.dur > q.t0; })) {
      [].forEach.call(document.querySelectorAll('.fxbox[data-k="' + e.k + '"]'), function (d) { d.style.transformOrigin = HX + 'px ' + ZB + 'px'; d.style.transform = 'translateX(' + (335 - HX) + 'px) scale(.88)'; });
    }
  });
  // HyperFrames draws videos inside the hidden #clips layer anyway: drop the ones no effect adopted.
  [].slice.call(document.querySelectorAll('#clips > video')).forEach(function (v) { v.remove(); });
  window.__timelines['fx'] = tl;
})();
