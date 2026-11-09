// One version, live: two <video>s of the same take swap at each cut, the effects timeline and captions follow the clock.
(function () {
  var D = window.YP, P = D.pieces, total = D.total, tl = window.__timelines.fx;
  var $ = function (id) { return document.getElementById(id); };
  var AB = new AbortController(), dead = false;
  var winOn = function (t, f) { addEventListener(t, f, { signal: AB.signal }); }, docOn = function (t, f) { document.addEventListener(t, f, { signal: AB.signal }); };
  var fx = $('fx'), zoom = $('zoom'), va = $('va'), vb = $('vb'), ttl = $('ttl'), sub = $('sub'), cw = $('cw');
  fx.appendChild($('caps'));
  var capFrame = null;
  if (D.captionStyle === 'none') $('cw').style.display = 'none';
  else if (D.captionStyle && D.captionStyle !== 'yapcut') {
    capFrame = document.createElement('iframe');
    capFrame.id = 'capframe'; capFrame.src = '/captions/' + D.run + '?style=' + encodeURIComponent(D.captionStyle) + ((/[?&](cand=[\w-]+)/.exec(location.search) || [])[1] ? '&' + /[?&](cand=[\w-]+)/.exec(location.search)[1] : '') + '&theme=' + ((/[?&]theme=([\w-]+)/.exec(location.search) || [])[1] || D.theme);
    capFrame.setAttribute('style', 'position:absolute;left:0;top:0;width:1080px;height:1920px;border:0;background:transparent;z-index:6;pointer-events:none');
    capFrame.setAttribute('allowtransparency', 'true');
    fx.appendChild(capFrame);
    $('cw').style.display = 'none';
  }
  function capSeek(t) { try { var api = capFrame && capFrame.contentWindow.CL_API; if (api) api.seek(t); } catch (e) {} }
  var act = va, idle = vb, k = 0, playing = false, muted = true, last = 0, scanning = false, loop = false, rate = 1, ended = false;
  if (va.getAttribute('src') !== D.video) va.src = D.video;
  if (vb.getAttribute('src') !== D.video) vb.src = D.video;
  va.style.opacity = 1;
  va.muted = vb.muted = true;
  vb.style.opacity = 0;
  var caps = D.captions.filter(function (c) { return c.kind === 'cap'; });
  var title = D.captions.find(function (c) { return c.kind === 'title'; }), subt = D.captions.find(function (c) { return c.kind === 'sub'; });
  if (title && !title.text && /[?&]sample=1/.test(location.search)) title.text = 'Your hook goes here';
  if (title) { ttl.innerHTML = esc(title.text.replace(/-/g, '\u2011')).replace(/^(.{12,}?)\s/, '$1<br>'); ttl.style.top = title.y + 'px'; fitTitle(); }
  if (subt) { sub.textContent = subt.text; sub.style.top = (title ? title.y + ttl.offsetHeight / 2 + 40 : subt.y) + 'px'; }
  if (title) { ttl.style.translate = sub.style.translate = (title.x - 540 || 0) + 'px 0px'; if (title.s && title.s !== 1) ttl.style.scale = sub.style.scale = title.s; }
  var TS = window.TitleStyle && TitleStyle.make({ ttl: ttl, sub: sub, title: title, subt: subt, faces: D.faces, style: (/[?&]titleStyle=([\w-]+)/.exec(location.search) || [])[1] || (title && title.ts) });
  if (caps[0]) { cw.style.top = caps[0].y + 'px'; if (caps[0].s && caps[0].s !== 1) cw.style.scale = caps[0].s; }
  if (capFrame && caps[0]) { capFrame.style.transformOrigin = '540px ' + (caps[0].y + 16) + 'px'; if (caps[0].s && caps[0].s !== 1) capFrame.style.scale = caps[0].s; }
  function fitTitle() { ttl.style.opacity = 1; for (var fs = 104; fs > 56 && (ttl.scrollWidth > ttl.clientWidth + 2 || ttl.offsetHeight > fs * 1.08 * 2 + 8); fs -= 4) ttl.style.fontSize = fs - 4 + 'px'; ttl.style.opacity = 0; }
  var sounds = D.sfx.map(function (x) { var a = new Audio(x.url); a.preload = 'auto'; a.volume = Math.min(1, 0.2 * Math.pow(10, (x.db || 0) / 20)); return { at: Math.max(0.01, x.at), a: a, len: x.len, url: x.url, vol: a.volume }; });
  // Sounds are scheduled LOOK s ahead on the Web Audio clock so they land on the word, not one frame + an <audio> start late.
  var AC = window.AudioContext || window.webkitAudioContext, ac = AC ? new AC() : null, bufs = {}, live = [], sched = 0, LOOK = 0.25;
  if (ac) sounds.forEach(function (s) { if (bufs[s.url]) return; bufs[s.url] = fetch(s.url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return ac.decodeAudioData(b); }).then(function (d) { bufs[s.url] = d; return d; }).catch(function () { bufs[s.url] = null; }); });
  function stopLive() { live.forEach(function (n) { try { n.stop(); } catch (e) {} }); live = []; sounds.forEach(function (s) { clearTimeout(s.stop); s.a.pause(); }); }
  function fire(s, t, off) {
    var d = ac && bufs[s.url];
    if (!d || !d.duration) { s.a.currentTime = 0; s.a.muted = muted; s.a.play().catch(function () {}); if (s.len) { clearTimeout(s.stop); s.stop = setTimeout(function () { s.a.pause(); }, s.len * 1000 / rate); } return; }
    if (muted) return;
    var src = ac.createBufferSource(), g = ac.createGain(), at = ac.currentTime + Math.max(0, (s.at - t) / rate);
    src.buffer = d; g.gain.value = s.vol; src.connect(g); g.connect(ac.destination); src.start(at, off || 0); if (s.len) src.stop(at + s.len / rate);
    live.push(src); src.onended = function () { live = live.filter(function (n) { return n !== src; }); };
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function fit() { var s = Math.min(innerWidth / 1080, innerHeight / 1920); fx.style.transform = 'translate(' + (innerWidth - 1080 * s) / 2 + 'px,0) scale(' + s + ')'; }
  winOn('resize', fit); fit();
  function frame(z, p, pan) {
    var cl = function (v, lo) { return Math.min(0, Math.max(lo, v)); };
    return p[5] != null ? [cl(540 - z * (p[5] + pan) * 1080, 1080 * (1 - z)), cl(640 - z * p[6] * 1920, 1920 * (1 - z))] : pan ? [cl(540 - z * (0.5 + pan) * 1080, 1080 * (1 - z)), 960 * (1 - z)] : [540 * (1 - z), 960 * (1 - z)];
  }
  function flowAt(t) {
    var S = D.path; if (!S || !S.length) return [1, 0];
    var s = S[S.length - 1]; for (var i = 0; i < S.length; i++) if (t < S[i][1]) { s = S[i]; break; }
    var u = Math.min(1, Math.max(0, (t - s[0]) / (s[1] - s[0])));
    return [s[2] + u * (s[3] + u * (s[4] + u * s[5])), s[6] + u * (s[7] + u * (s[8] + u * s[9]))];
  }
  function pieceAt(t) { for (var i = 0; i < P.length; i++) if (t < P[i][0] + (P[i][2] - P[i][1])) return i; return P.length - 1; }
  function contiguous(i) { return i + 1 < P.length && Math.abs(P[i + 1][1] - P[i][2]) < 0.02; }
  function nextJump(i) { var j = i; while (contiguous(j)) j++; return j + 1 < P.length ? j + 1 : null; }
  function prep() { var j = nextJump(k); if (j != null) idle.currentTime = P[j][1]; }
  // Captions ride the camera while an effect shrinks it (same numbers as the effect in runtime.js).
  var SHRINK = { 'ui-world': [0.6, 170] }, CAPY = { 'split-top': 960, 'split-screen': 1125, 'title-stack': 1025 };
  function capYOf(e) { var q = e.params || {}, bt = +q.split || 1150, k = +q.size || 1; if (q.capY) return +q.capY; return e.fx === 'split-screen' ? (bt - 50 + 1870 - (1870 - bt) * k) / 2 : e.fx === 'split-top' ? (q.shape === 'boxed' ? (+q.split || 960) - 10 + ((1810 - (+q.split || 960)) - (1810 - (+q.split || 960)) * (+q.size || 0.86)) / 4 : +q.split || 960) : CAPY[e.fx]; }
  function ez(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function shrinkAt(t) {
    var L = D.fx || [], YC = window.YCAP || {}, HT = (D.captions || []).find(function (c) { return c.kind === 'title'; });
    if (HT && HT.capY != null && t < HT.t1) return [HT.capS || 1, HT.capY - capOY];
    for (var yk in YC) if (YC[yk] && t >= YC[yk].t0 && t < YC[yk].t1) return [1, YC[yk].y - capOY];
    for (var i = 0; i < L.length; i++) {
      var e = L[i], q = SHRINK[e.fx] || ((CAPY[e.fx] != null || (e.params || {}).capY != null) && [1, capYOf(e) - capOY]), a = e.t0, b = e.t0 + e.dur; if (!q || t < a || t >= b) continue;
      var f = (e.params || {}).out !== 'animate' ? 1 : t > b - 0.4 ? 1 - ez(Math.min(1, (t - (b - 0.4)) / 0.38)) : ez(Math.min(1, (t - a) / 0.5));
      return [1 - (1 - q[0]) * f, q[1] * f];
    }
    return null;
  }
  function rideCam(t, layer, frame, oy) {
    var k = shrinkAt(t);
    layer.style.transformOrigin = '540px 960px'; layer.style.transform = k ? 'translateY(' + k[1] + 'px) scale(' + k[0] + ')' : '';
    if (frame) frame.style.transform = k ? 'translateY(' + ((960 - oy) * (1 - k[0]) + k[1]) + 'px) scale(' + k[0] + ')' : '';
    var HT = (D.captions || []).find(function (c) { return c.kind === 'title'; }), nx = HT && HT.capY != null && (D.captions || []).find(function (c) { return c.kind === 'cap' && c.t0 >= HT.t1 - 0.01; });
    var hide = !!(nx && t >= HT.t1 && t < nx.t0);
    [frame, layer.querySelector && layer.querySelector('#cw')].forEach(function (el) { if (el) el.style.visibility = hide ? 'hidden' : ''; });
  }
  var curCap = -1, capsLayer = document.getElementById('caps') || cw.parentNode, capOY = caps[0] ? caps[0].y + 16 : 960;
  // Cut-outs for effects that need one: the server makes them for this edit, they land a few seconds after the page opens.
  var mats = [], cand = (/[?&]cand=([\w-]+)/.exec(location.search) || [])[1];
  (D.fx || []).filter(function (e) { return e.matte; }).forEach(function (e) {
    var ask = function () {
      if (dead) return;
      fetch('/api/pmatte/' + D.run + '?k=' + e.k + (cand ? '&cand=' + cand : '')).then(function (r) { return r.json(); }).then(function (j) {
        if (j.state === 'run') return setTimeout(ask, 1500);
        if (!j.url) return;
        if (j.engine === 'apple' && j.better) setTimeout(ask, 20000);
        [].forEach.call(document.querySelectorAll('.mw'), function (w) {
          if (!new RegExp('^mw' + e.k + '(c\\d+)?$').test(w.id)) return;
          var old = w.querySelector('video');
          if (old) { if (old.getAttribute('src') !== j.url) { old.src = j.url; old.load(); } if (!mats.some(function (m) { return m.v === old; })) mats.push({ v: old, s: j.start, d: j.dur }); return; }
          var v = document.createElement('video'); v.src = j.url; v.muted = true; v.playsInline = true; v.preload = 'auto';
          v.style.visibility = 'hidden';
          w.appendChild(v); mats.push({ v: v, s: j.start, d: j.dur });
          v.addEventListener('loadeddata', function () { draw(last); });
        });
      }).catch(function () { setTimeout(ask, 4000); });
    };
    ask();
  });
  function syncMats(t) {
    mats.forEach(function (m) {
      var want = t - m.s;
      m.v.style.visibility = want < 0 || want >= m.d ? 'hidden' : '';
      if (want < 0 || want >= m.d) { if (!m.v.paused) m.v.pause(); return; }
      if (playing) { m.v.playbackRate = rate; if (m.v.paused) { m.v.currentTime = want; m.v.play().catch(function () {}); } else if (Math.abs(m.v.currentTime - want) > 0.1) m.v.currentTime = want; }
      else { if (!m.v.paused) m.v.pause(); if (Math.abs(m.v.currentTime - want) > 0.01) m.v.currentTime = want; }
    });
  }
  function draw(t) {
    tl.seek(Math.min(t, total - 0.001), false);
    syncMats(t);
    capSeek(t);
    rideCam(t, capsLayer, capFrame, capOY);
    var p = P[k], f = Math.min(1, Math.max(0, (t - p[0]) / (p[2] - p[1])));
    var fl = flowAt(t), z = (p[3] + (p[4] - p[3]) * f) * fl[0], fr = frame(z, p, fl[1]);
    zoom.style.transform = 'translate(' + fr[0] + 'px,' + fr[1] + 'px) scale(' + z + ')';
    if (TS) TS.draw(t);
    else {
      ttl.style.opacity = title && t < title.t1 ? 1 : 0;
      sub.style.opacity = subt && t < subt.t1 ? 1 : 0;
    }
    var ci = -1;
    for (var i = 0; i < caps.length; i++) { if (caps[i].t0 > t) break; if (t < caps[i].t1) ci = i; }
    if (ci !== curCap) {
      curCap = ci;
      if (ci < 0) cw.style.opacity = 0;
      else {
        var c = caps[ci];
        cw.textContent = c.text;
        cw.className = 'cap word' + (c.hi ? (c.text.length <= 11 ? ' hi' : ' hi long') : '');
        cw.style.opacity = 1;
        cw.style.animation = 'none'; void cw.offsetWidth; cw.style.animation = '';
      }
    }
  }
  function clock() { return P[k][0] + (act.currentTime - P[k][1]); }
  function seek(t) {
    t = Math.max(0, Math.min(total - 0.01, t));
    k = pieceAt(t);
    act.currentTime = P[k][1] + (t - P[k][0]);
    act.muted = muted || !!P[k][7];
    stopLive(); sched = t; prep(); last = t; draw(t); post();
  }
  function play() { if (playing) return; unshow(); if (ended || last >= total - 0.05) { ended = false; seek(0); } playing = true; if (ac && ac.state !== 'running') ac.resume(); sched = last; act.muted = muted || !!P[k][7]; sounds.forEach(function (s) { var d = ac && bufs[s.url]; if (d && d.duration > 2 && !s.len && last > s.at && last < s.at + d.duration) fire(s, last, last - s.at); }); act.playbackRate = rate; act.play().catch(function () {}); }
  function pause() { playing = false; act.pause(); [].forEach.call(document.querySelectorAll('video'), function (v) { if (!v.paused) v.pause(); }); stopLive(); sched = last; post(); }
  function tick() {
    if (dead) return;
    if (playing && !scanning) {
      if (act.currentTime >= P[k][2] - 0.01 - (contiguous(k) ? 0 : 0.03 * rate)) {
        if (contiguous(k)) k++;
        else {
          var j = nextJump(k);
          if (j == null) { pause(); if (loop) { seek(0); play(); } else { ended = true; last = total; draw(total - 0.01); post(); } requestAnimationFrame(tick); return; }
          idle.muted = muted || !!P[j][7]; idle.playbackRate = rate; idle.style.opacity = 1; idle.play().catch(function () {});
          act.muted = true; act.pause(); act.style.opacity = 0;
          var x = act; act = idle; idle = x; k = j; prep();
        }
      }
      var t = clock();
      var ahead = ac && ac.state === 'running' ? t + LOOK : t;
      sounds.forEach(function (s) { if (s.at > sched && s.at <= ahead) fire(s, t); });
      sched = Math.max(sched, ahead);
      last = t; draw(t);
    }
    requestAnimationFrame(tick);
  }
  var lastPost = 0;
  function post() { var now = performance.now(); if (now - lastPost < 90 && playing) return; lastPost = now; parent.postMessage({ run: D.run, t: playing ? clock() : last, total: total, playing: playing }, '*'); }
  var postIv = setInterval(post, 120);
  winOn('message', function (m) {
    var d = m.data || {};
    if (d.muted != null) { muted = d.muted; act.muted = muted || !!P[k][7]; }
    if (d.cmd === 'play') play(); else if (d.cmd === 'pause') pause(); else if (d.cmd === 'toggle') playing ? pause() : play();
    else if (d.cmd === 'seek') { ended = false; seek(d.t); }
    else if (d.cmd === 'step') { pause(); ended = false; seek(last + d.dt); }
    else if (d.cmd === 'speed') { rate = d.rate; act.playbackRate = idle.playbackRate = rate; }
    else if (d.cmd === 'loop') loop = !!d.on;
    else if (d.cmd === 'hook' && title) {
      if (d.y != null) ttl.style.top = d.y + 'px';
      if (d.dx != null) ttl.style.translate = d.dx + 'px 0px';
      if (d.scale != null) ttl.style.scale = d.scale;
      if (d.color != null) [].forEach.call(ttl.querySelectorAll('.rpn-stage > div'), function (el) { el.style.color = d.color || ''; });
      if (!playing) seek(last);
    }
    else if (d.cmd === 'scan') scan();
    else if (d.cmd === 'show') show(d.issue);
    else if (d.cmd === 'clear') unshow();
    else if (d.cmd === 'grade') { var gs = $('cgsvg'), gc = $('cgcss'); if (gs && gc) { gs.innerHTML = d.svg; gc.textContent = d.css; } }
  });
  docOn('click', function () { if (dragged) { dragged = false; return; } parent.postMessage({ run: D.run, click: true }, '*'); });

  // Click selects the hook title, the captions or an effect card; drag moves it, a corner scales it. The page saves each change (undo works).
  var dragBox = document.createElement('div'), drag = null, dragged = false, sel = null, lastEv = null;
  dragBox.id = 'dragbox'; fx.appendChild(dragBox);
  function local(r) { var b = fx.getBoundingClientRect(), s = b.width / 1080; return { x: (r.left - b.left) / s, y: (r.top - b.top) / s, w: r.width / s, h: r.height / s }; }
  function unite(l) { l = l.filter(function (r) { return r.w >= 8 && r.h >= 8; }); if (!l.length) return null; var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; l.forEach(function (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
  function shown(el, stop, win) { for (var n = el; n && n !== stop && n.nodeType === 1; n = n.parentElement) { var cs = win.getComputedStyle(n); if (+cs.opacity < 0.3 || cs.visibility === 'hidden' || cs.display === 'none') return false; } return true; }
  function rangeRect(el, doc) { var rg = doc.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); }
  function off(el) { var m = (el.style.translate || '').match(/-?[\d.]+/g) || []; return [+m[0] || 0, +m[1] || 0]; }
  function scl(el) { return +el.style.scale || 1; }
  function same(a, b) { return !!a && !!b && a.what === b.what && (a.what !== 'fx' || a.k === b.k); }
  function targets() {
    var out = [];
    document.querySelectorAll('.fxbox').forEach(function (bx) {
      if (!shown(bx, fx, window)) return;
      var r = unite([].slice.call(bx.querySelectorAll('*')).filter(function (el) { return !(el.closest('svg') && el.tagName.toLowerCase() !== 'svg') && shown(el, fx, window); }).map(function (el) { return local(el.getBoundingClientRect()); }).filter(function (r) { return !(r.w > 1000 && r.h > 1700); }));
      if (r) out.push({ what: 'fx', k: +bx.dataset.k, label: (bx.dataset.fx || 'effect') + ' card', els: [bx], r: r });
    });
    var hs = [ttl, sub].filter(function (el) { return el.textContent.trim() && +getComputedStyle(el).opacity > 0.3; });
    var hr = unite(hs.map(function (el) { return local(rangeRect(el, document)); }));
    if (hr) out.push({ what: 'title', label: 'hook title', els: [ttl, sub], r: hr });
    var cd = null; try { cd = capFrame && capFrame.contentDocument; } catch (e) {}
    if (cd) {
      var fb = capFrame.getBoundingClientRect(), fs = fb.width / 1080, cr = unite([].slice.call(cd.querySelectorAll('[data-cl-cue], [data-cl-cue] *')).filter(function (el) { return el.textContent.trim() && shown(el, cd.body, capFrame.contentWindow); }).map(function (el) { var b = rangeRect(el, cd); return local({ left: fb.left + b.left * fs, top: fb.top + b.top * fs, width: b.width * fs, height: b.height * fs }); }));
      if (cr) out.push({ what: 'captions', label: 'captions', els: [capFrame], r: cr });
    } else if (+getComputedStyle(cw).opacity > 0.3) out.push({ what: 'captions', label: 'captions', els: [cw], r: local(rangeRect(cw, document)) });
    return out;
  }
  window.__ySnap = function (t) {
    pause(); ended = false; seek(t);
    return new Promise(function (ok) {
      var go = function () { if (act.seeking || act.readyState < 2) return setTimeout(go, 15); requestAnimationFrame(function () { requestAnimationFrame(function () { ok(targets().map(function (x) { return { what: x.what, k: x.k, label: x.label, r: x.r }; })); }); }); };
      go();
    });
  };
  function pt(e) { return local({ left: e.clientX, top: e.clientY, width: 0, height: 0 }); }
  function hit(e) { var p = pt(e), pad = 24; return targets().find(function (x) { return p.x >= x.r.x - pad && p.x <= x.r.x + x.r.w + pad && p.y >= x.r.y - pad && p.y <= x.r.y + x.r.h + pad; }) || null; }
  function corner(e, x) { if (!e || !x) return false; var p = pt(e), c = 46; return [[x.r.x, x.r.y], [x.r.x + x.r.w, x.r.y], [x.r.x, x.r.y + x.r.h], [x.r.x + x.r.w, x.r.y + x.r.h]].some(function (q) { return Math.abs(p.x - q[0]) < c && Math.abs(p.y - q[1]) < c; }); }
  function outline(x, note, on) {
    if (!x) { dragBox.className = ''; return; }
    dragBox.className = 'on' + (on ? ' sel' : '');
    dragBox.style.cssText = 'left:' + (x.r.x - 14) + 'px;top:' + (x.r.y - 14) + 'px;width:' + (x.r.w + 28) + 'px;height:' + (x.r.h + 28) + 'px';
    dragBox.innerHTML = '<span>' + esc(note) + '</span>' + (on ? '<i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>' : '');
  }
  function hover(e) {
    var cur = sel && targets().find(function (x) { return same(x, sel); }), h = e ? hit(e) : null, cn = corner(e, cur);
    document.body.classList.toggle('grab', !!h && !cn); document.body.classList.toggle('nwse', !!cn);
    if (cur && (!h || same(h, cur))) { sel = cur; return outline(cur, cn ? 'Drag to resize' : cur.label + ' · drag, corners resize', true); }
    outline(h, h && 'Drag to move ' + h.label + ', click to select' + (h.what === 'title' ? ', double-click to edit text' : ''));
  }
  function pick(x) { sel = x; parent.postMessage({ run: D.run, picked: x ? { what: x.what, k: x.k, label: x.label } : null }, '*'); hover(lastEv); }
  docOn('pointermove', function (e) {
    lastEv = e;
    if (scanning) return;
    if (!drag) return hover(e);
    var s = fx.getBoundingClientRect().width / 1080, dx = (e.clientX - drag.x) / s, dy = (e.clientY - drag.y) / s, h = drag.h;
    if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    if (!drag.on) { drag.on = true; pause(); document.body.classList.add('grabbing'); }
    if (drag.mode === 'scale') {
      var p = pt(e), c = drag.c, k2 = Math.max(0.3 / drag.s0, Math.min(3 / drag.s0, Math.hypot(p.x - c.x, p.y - c.y) / Math.max(10, Math.hypot(drag.p0.x - c.x, drag.p0.y - c.y)))), sN = drag.s0 * k2;
      drag.sN = sN;
      h.els.forEach(function (el, i) {
        el.style.scale = sN;
        if (h.what === 'fx') { var T0 = drag.base[i]; drag.T = [c.x - 540 - k2 * (c.x - T0[0] - 540), c.y - 960 - k2 * (c.y - T0[1] - 960)]; el.style.translate = drag.T[0] + 'px ' + drag.T[1] + 'px'; }
      });
      var r0 = drag.r0, r = { x: c.x - (r0.w * k2) / 2, y: c.y - (r0.h * k2) / 2, w: r0.w * k2, h: r0.h * k2 };
      h.r = r; return outline(h, Math.round(sN * 100) + '%', true);
    }
    if (h.what === 'captions') dx = 0;
    drag.dx = dx; drag.dy = dy;
    h.els.forEach(function (el, i) { el.style.translate = (drag.base[i][0] + dx) + 'px ' + (drag.base[i][1] + dy) + 'px'; });
    var r1 = drag.r0; h.r = { x: r1.x + dx, y: r1.y + dy, w: r1.w, h: r1.h };
    outline(h, Math.round(Math.abs(dy)) + ' px ' + (dy < 0 ? 'up' : 'down') + (h.what === 'captions' ? '' : ', ' + Math.round(Math.abs(dx)) + ' px ' + (dx < 0 ? 'left' : 'right')), true);
  });
  docOn('pointerdown', function (e) {
    lastEv = e;
    if (e.button || scanning) return;
    var cur = sel && targets().find(function (x) { return same(x, sel); }), h = cur && corner(e, cur) ? cur : hit(e);
    if (!h) { if (sel) pick(null); return; }
    drag = { h: h, mode: cur && same(h, cur) && corner(e, cur) ? 'scale' : 'move', x: e.clientX, y: e.clientY, p0: pt(e), dx: 0, dy: 0, on: false, base: h.els.map(off), s0: scl(h.els[0]), r0: h.r, c: { x: h.r.x + h.r.w / 2, y: h.r.y + h.r.h / 2 } };
    try { document.documentElement.setPointerCapture(e.pointerId); } catch (er) {}
  });
  docOn('pointerup', function () {
    var d = drag; drag = null; document.body.classList.remove('grabbing');
    if (!d) return;
    dragged = d.on;
    if (!d.on) return pick(d.h);
    sel = d.h; outline(d.h, 'Saving...', true);
    var mv = { what: d.h.what, k: d.h.k, label: d.h.label };
    if (d.mode === 'scale') { mv.set = { scale: +d.sN.toFixed(3) }; if (d.T) { mv.set.dx = Math.round(d.T[0]); mv.set.dy = Math.round(d.T[1]); } }
    else { mv.dx = Math.round(d.dx); mv.dy = Math.round(d.dy); }
    parent.postMessage({ run: D.run, moved: mv }, '*');
  });
  docOn('dblclick', function (e) { var h = hit(e); if (h && h.what === 'title') parent.postMessage({ run: D.run, editHook: true }, '*'); });
  docOn('pointerleave', function () { if (!drag) { lastEv = null; hover(null); } });
  docOn('keydown', function (e) {
    var k = e.key, meta = e.metaKey || e.ctrlKey;
    if (!(k === 'Delete' || k === 'Backspace' || k === 'Escape' || k === ' ' || (meta && (k === 'z' || k === 'Z')))) return;
    e.preventDefault();
    if (k === 'Escape' && sel) return pick(null);
    parent.postMessage({ run: D.run, key: k, meta: meta, shift: e.shiftKey }, '*');
  });
  winOn('message', function (m) {
    var d = m.data || {};
    if (d.cmd !== 'select') return;
    sel = d.what ? { what: d.what, k: d.k } : null;
    if (sel && d.t != null) seek(d.t);
    hover(lastEv);
  });

  // Geometry rules on the boxes the browser really draws, every 0.1 s: tracked face, captions, title, effects, Instagram UI.
  function scan() {
    scanning = true; pause();
    var S = D.safe, FA = D.faces || [], found = {}, issues = [], held = {}, st = { frames: 0, boxes: 0, faceGap: null, capGap: null, blur: 0, capW: 0 };
    var capDoc = null; try { capDoc = capFrame && capFrame.contentDocument; } catch (e) {}
    function faceAt(t, z) {
      var best = null; for (var i = 0; i < FA.length; i++) { if (Math.abs(FA[i][0] - t) < 0.3 && (!best || Math.abs(FA[i][0] - t) < Math.abs(best[0] - t))) best = FA[i]; if (FA[i][0] > t + 0.3) break; }
      if (!best) return D.face;
      var fr = frame(z, P[k], flowAt(t)[1]), Z = function (v, o) { return Math.round(o + v * z); };
      return { x0: Z(best[1], fr[0]), y0: Z(best[2], fr[1]), x1: Z(best[3], fr[0]), y1: Z(best[4], fr[1]) };
    }
    function R(b, base, sc) { return { x: (b.left - base.left) / sc, y: (b.top - base.top) / sc, w: b.width / sc, h: b.height / sc }; }
    function ov(a, b) { return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); }
    function gap(a, b) { var dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)); return Math.round(Math.sqrt(dx * dx + dy * dy)); }
    function union(l) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; l.forEach(function (r) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
    function rb(r) { return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }; }
    function look(el, stop, win) { var o = 1, bl = 0; for (var n = el; n && n !== stop && n.nodeType === 1; n = n.parentElement) { var cs = win.getComputedStyle(n); o *= +cs.opacity; if (cs.visibility === 'hidden' || cs.display === 'none') o = 0; var m = /blur\(([\d.]+)px\)/.exec(cs.filter); if (m) bl += +m[1]; } return { o: o, blur: bl }; }
    function ownText(el) { return Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); }); }
    function textRect(el, doc) { var rg = doc.createRange(); rg.selectNodeContents(el); return rg.getBoundingClientRect(); }
    function add(key, rule, sev, t, box, msg) { if (found[key]) { found[key].frames++; return; } found[key] = { frames: 1 }; issues.push({ rule: rule, sev: sev, t: +t.toFixed(2), box: rb(box), msg: msg }); }
    var qs = new URLSearchParams(location.search), from = +(qs.get('from') || 0), to = qs.get('to') ? +qs.get('to') : total;
    for (var t = Math.max(0.05, from); t < Math.min(total, to); t += 0.1) {
      k = pieceAt(t); draw(t); st.frames++;
      var p = P[k], z = (p[3] + (p[4] - p[3]) * Math.min(1, Math.max(0, (t - p[0]) / (p[2] - p[1])))) * flowAt(t)[0], F = faceAt(t, z), Fr = { x: F.x0, y: F.y0, w: F.x1 - F.x0, h: F.y1 - F.y0 };
      var base = fx.getBoundingClientRect(), sc = base.width / 1080, caps = [], heads = [], effs = [], heldNow = {};
      if (capDoc) capDoc.querySelectorAll('[data-cl-cue]').forEach(function (cue) {
        var cw2 = capFrame.contentWindow, words = [];
        if (look(cue, capDoc.body, cw2).o < 0.3) return;
        [cue].concat([].slice.call(cue.querySelectorAll('*'))).forEach(function (el) {
          if (!ownText(el) || look(el, capDoc.body, cw2).o < 0.3) return;
          var b = textRect(el, capDoc); if (b.width >= 4 && b.height >= 8) words.push({ r: { x: b.left, y: b.top, w: b.width, h: b.height }, text: el.textContent.trim() });
        });
        if (words.length) caps.push({ r: union(words.map(function (w) { return w.r; })), what: 'caption "' + words.map(function (w) { return w.text; }).join(' ').slice(0, 30) + '"' });
      });
      else if (+getComputedStyle(cw).opacity > 0.3) { var bc = textRect(cw, document); caps.push({ r: R(bc, base, sc), what: 'caption "' + cw.textContent + '"' }); }
      [[ttl, 'hook title'], [sub, 'subtitle']].forEach(function (x) { if (x[0].textContent.trim() && +getComputedStyle(x[0]).opacity > 0.3) heads.push({ r: R(textRect(x[0], document), base, sc), what: x[1] }); });
      document.querySelectorAll('.fxbox').forEach(function (bx) {
        if (+getComputedStyle(bx).opacity < 0.5) return;
        var parts = [];
        bx.querySelectorAll('*').forEach(function (el) {
          if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return;
          var cs = getComputedStyle(el), lk = null, txt = ownText(el);
          var panel = el.tagName === 'IMG' || el.tagName === 'VIDEO' || cs.backdropFilter !== 'none' || cs.backgroundImage !== 'none' || (/rgba?\(/.test(cs.backgroundColor) && !/,\s*0\)$/.test(cs.backgroundColor) && cs.backgroundColor !== 'transparent');
          if (!txt && !panel) return;
          lk = look(el, fx, window); if (lk.o < 0.5) return;
          var r = R(txt && !panel ? textRect(el, document) : el.getBoundingClientRect(), base, sc);
          if (r.w < 8 || r.h < 8 || (r.w > 1000 && r.h > 1700)) return;
          parts.push(r); st.boxes++;
          if (txt && lk.blur > 2 && lk.o > 0.6) { var hk = bx.dataset.fx + ':' + el.textContent.trim().slice(0, 20); heldNow[hk] = { blur: lk.blur, r: r, text: el.textContent.trim() }; }
        });
        if (parts.length) effs.push({ r: union(parts), fx: bx.dataset.fx || fxName(t) || 'effect' });
      });
      Object.keys(heldNow).forEach(function (hk) {
        held[hk] = (held[hk] || 0) + 1; st.blur = Math.max(st.blur, held[hk] >= 2 ? Math.round(heldNow[hk].blur) : 0);
        if (held[hk] === 2) add('blur' + hk, 'Blurred text', 'bad', t - 0.1, heldNow[hk].r, 'effect ' + hk.split(':')[0] + ' text "' + heldNow[hk].text.slice(0, 24) + '" stays blurred (' + Math.round(heldNow[hk].blur) + ' px) for 0.2 s+');
      });
      Object.keys(held).forEach(function (hk) { if (!heldNow[hk]) held[hk] = 0; });
      var texts = caps.concat(heads, effs.map(function (e) { return { r: e.r, what: 'effect ' + e.fx, fx: e.fx }; }));
      texts.forEach(function (x) {
        var g = gap(x.r, Fr); if (st.faceGap == null || g < st.faceGap) st.faceGap = g;
        var key = x.what.replace(/".*$/, '');
        if (ov(x.r, Fr) > 0.06 * Fr.w * Fr.h) add('face' + key, 'Text on the face', 'bad', t, x.r, x.what + ' covers the face');
        else if (x.r.y < S.top || x.r.y + x.r.h > S.bottom || (x.r.x + x.r.w > S.right && x.r.y + x.r.h > 960)) add('ui' + key, 'Under Instagram UI', 'warn', t, x.r, x.what + ' sits where Instagram draws its buttons');
      });
      effs.forEach(function (e) {
        caps.concat(heads).forEach(function (c) {
          var g = gap(e.r, c.r); if (st.capGap == null || g < st.capGap) st.capGap = g;
          if (g < 24) add('hit' + e.fx + c.what.replace(/".*$/, ''), 'Text collides', 'bad', t, union([e.r, c.r]), 'effect ' + e.fx + (g ? ' sits ' + g + ' px from ' : ' overlaps ') + c.what);
        });
      });
      if (z > 1.05 && FA.length) { var off = Math.round(Math.abs((F.x0 + F.x1) / 2 - 540)); st.zoomOff = Math.max(st.zoomOff || 0, off); if (off > 150) add('off' + k, 'Face off-center', 'warn', t, Fr, 'zoomed ' + z.toFixed(2) + 'x but the face sits ' + off + ' px from the middle'); }
      heads.forEach(function (hd) { caps.forEach(function (c) { var g = gap(hd.r, c.r); if (g < 40) add('stack' + hd.what, 'Text collides', 'bad', t, union([hd.r, c.r]), hd.what + (g ? ' sits ' + g + ' px from ' : ' overlaps ') + 'the captions'); }); });
      caps.forEach(function (c) { st.capW = Math.max(st.capW, Math.round(c.r.w)); if (c.r.w > 960) add('wide' + c.what, 'Caption too wide', 'warn', t, c.r, c.what + ' runs off the safe width'); });
    }
    seek(0); scanning = false;
    var cand = (/[?&]cand=([\w-]+)/.exec(location.search) || [])[1];
    fetch('/api/geom/' + D.run + (cand ? '?cand=' + cand : ''), { method: 'POST', body: JSON.stringify({ at: new Date().toISOString(), face: D.face, stats: st, issues: issues }) })
      .then(function () { parent.postMessage({ run: D.run, scanned: issues.length }, '*'); document.title = 'scanned ' + issues.length; });
  }
  var mark = null;
  function show(i) {
    if (!mark) { mark = document.createElement('div'); mark.id = 'mark'; fx.appendChild(mark); }
    if (i.t != null) { pause(); seek(i.t); }
    var b = i.box || (i.face ? null : null);
    mark.className = 'on ' + i.sev;
    mark.innerHTML = '<span>' + esc(i.rule) + '</span>';
    if (b) { mark.style.cssText = 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px'; }
    else { mark.style.cssText = 'left:40px;top:250px;width:1000px;height:120px'; mark.classList.add('banner'); mark.innerHTML = '<span>' + esc(i.rule) + ' - ' + esc(i.msg) + '</span>'; }
    if (i.zone) { var z = document.getElementById('zone') || fx.appendChild(Object.assign(document.createElement('div'), { id: 'zone' })); z.style.cssText = 'left:' + i.zone.x0 + 'px;top:' + i.zone.y0 + 'px;width:' + (i.zone.x1 - i.zone.x0) + 'px;height:' + (i.zone.y1 - i.zone.y0) + 'px'; z.className = 'on'; }
    clearTimeout(show.t); show.t = setTimeout(unshow, 8000);
  }
  function unshow() { clearTimeout(show.t); if (mark) mark.className = ''; var z = document.getElementById('zone'); if (z) z.className = ''; }
  function fxName(t) { var e = (window.FX.effects || []).find(function (e) { return t >= e.t0 && t <= e.t0 + e.dur; }); return e && e.fx; }

  if (va.readyState >= 1) setTimeout(function () { parent.postMessage({ run: D.run, ready: true }, '*'); }, 0);
  else va.addEventListener('loadeddata', function () { parent.postMessage({ run: D.run, ready: true }, '*'); }, { once: true });
  window.__ykill = function () { dead = true; AB.abort(); clearInterval(postIv); playing = false; va.pause(); vb.pause(); stopLive(); sounds.forEach(function (s) { s.a.src = ''; }); if (ac) ac.close().catch(function () {}); if (tl) tl.kill(); };
  va.addEventListener('error', function () { parent.postMessage({ run: D.run, error: 'video failed to load (' + (va.error && va.error.code) + ')' }, '*'); });
  seek(+(/[?&]t=([\d.]+)/.exec(location.search) || [])[1] || 0); requestAnimationFrame(tick);
  function ready() { var w = null; try { w = capFrame && capFrame.contentWindow; } catch (e) {} return va.readyState >= 2 && (!capFrame || (w && w.CL_READY)); }
  if (/[?&]scan=1/.test(location.search)) document.fonts.ready.then(function wait() { if (ready()) setTimeout(scan, 100); else setTimeout(wait, 100); });
})();

// Hot update: an edit swaps in the new effects, captions and look without reloading the page; loaded videos are reused.
(function () {
  if (window.__yhot) return;
  window.__yhot = 1;
  var RERUN = /\/(fx\/runtime|preview\/boardlayer|preview\/player)\.js(\?|$)/, gen = 0;
  var get = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ' HTTP ' + r.status); return r.text(); }); };
  var reuse = function (o, n) { o.className = n.className; if (n.hasAttribute('style')) o.setAttribute('style', n.getAttribute('style')); else o.removeAttribute('style'); o.pause(); n.replaceWith(o); };
  addEventListener('message', function (m) {
    var d = m.data || {}; if (d.cmd !== 'hot') return;
    var my = ++gen, run = (window.YP || {}).run, doc, queue;
    (d.html ? Promise.resolve(d.html) : get(d.url)).then(function (html) {
      if (my !== gen) return;
      doc = new DOMParser().parseFromString(html, 'text/html');
      var have = {}; [].forEach.call(document.scripts, function (s) { if (s.src) have[s.getAttribute('src')] = 1; });
      queue = [].filter.call(doc.querySelectorAll('script'), function (s) { return !s.src || RERUN.test(s.src) || !have[s.getAttribute('src')]; });
      return Promise.all(queue.map(function (s) { var u = s.getAttribute('src'); return !u ? s.textContent : d.files && d.files[u] != null ? d.files[u] : get(u); }));
    }).then(function (code) {
      if (!code || my !== gen) return;
      var va = document.getElementById('va'), vb = document.getElementById('vb');
      var yp = [].filter.call(doc.scripts, function (s) { return /^window\.YP=/.test(s.textContent); })[0], take = yp && JSON.parse(yp.textContent.replace(/^window\.YP=/, '').replace(/;\s*$/, '')).video;
      if (!va || !vb || !take || take !== va.getAttribute('src')) throw new Error('take changed');
      if (window.__ykill) window.__ykill();
      var vids = {}, mats = {};
      [].forEach.call(document.querySelectorAll('video[id]'), function (v) { if (v !== va && v !== vb) vids[v.id] = v; });
      [].forEach.call(document.querySelectorAll('.mw[id] > video:not([id])'), function (v) { mats[v.parentNode.id] = v; });
      [].forEach.call(document.head.querySelectorAll('style'), function (s) { s.remove(); });
      [].forEach.call(doc.head.querySelectorAll('style'), function (s) { document.head.appendChild(document.importNode(s, true)); });
      [].slice.call(document.body.childNodes).forEach(function (n) { if (n.nodeName !== 'SCRIPT' || !n.src || RERUN.test(n.src)) n.remove(); });
      [].forEach.call(doc.body.childNodes, function (n) { if (n.nodeName !== 'SCRIPT') document.body.appendChild(document.importNode(n, true)); });
      document.getElementById('va').replaceWith(va); document.getElementById('vb').replaceWith(vb);
      [].forEach.call(document.querySelectorAll('video[id]'), function (n) { var o = vids[n.id]; if (o && n !== va && n !== vb && o.getAttribute('src') === n.getAttribute('src')) reuse(o, n); });
      [].forEach.call(document.querySelectorAll('.mw[id]'), function (w) { var o = mats[w.id]; if (o && !w.firstElementChild) { o.style.visibility = 'hidden'; o.pause(); w.appendChild(o); } });
      queue.forEach(function (s, n) { var x = document.createElement('script'); x.textContent = code[n] + (s.src ? '\n//# sourceURL=' + s.src : ''); document.body.appendChild(x); });
    }).catch(function (e) { if (my === gen) parent.postMessage({ run: run, hotFail: String(e && e.message || e) }, '*'); });
  });
})();
