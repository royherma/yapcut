// Hook title looks for the preview player and the HyperFrames export. Same #ttl / #sub elements, so face checks and drag boxes keep working.
(function () {
  var STYLES = [
    { id: 'serif', title: 'Serif (current)' }, { id: 'kinetic', title: 'Kinetic caps' }, { id: 'pill', title: 'Pill boxes' },
    { id: 'bold', title: 'Bold outline' }, { id: 'stamp', title: 'Stamp' },
    { id: 'ali', title: 'Camera drop' }, { id: 'tiktok', title: 'TikTok outline' }, { id: 'snap', title: 'Snapchat bar' }, { id: 'strip', title: 'White strip on top' }, { id: 'post', title: 'Post card' }, { id: 'fly', title: 'Fly in' }
  ];
  if (window.RpnLooks) STYLES = STYLES.concat(RpnLooks.list.map(function (l) { return { id: l.id, title: l.title }; }));
  STYLES = STYLES.concat(STYLES.filter(function (s) { return s.id !== 'serif'; }).map(function (s) { return { id: s.id + '-static', title: s.title }; }));
  var FULL = { snap: 1, strip: 1 };
  var CREAM = 'var(--t-over, var(--t-text, #f4ecd6))', GREEN = 'var(--t-kw, #1f3d2b)';
  var css = [
    '.cap.title.ts, .cap.sub.ts { text-shadow: none; }',
    '.ts .ln { display: block; white-space: nowrap; width: fit-content; margin-left: auto; margin-right: auto; }',
    '.cap.title.ts-kinetic { font-family: "Instrument Serif", "Bodoni Moda", Georgia, serif; font-weight: 400; color: ' + CREAM + '; line-height: .84; text-transform: uppercase; -webkit-text-stroke: 3px ' + CREAM + '; text-shadow: 0 4px 22px rgba(0,0,0,.35); }',
    '.ts-kinetic .w { display: inline-block; margin: 0 .12em; will-change: transform; }',
    '.cap.sub.ts-kinetic { font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-size: 58px; color: ' + CREAM + '; text-shadow: 0 2px 14px rgba(0,0,0,.5); }',
    '.cap.title.ts-pill { font-family: "Inter Tight", Inter, sans-serif; font-weight: 800; color: var(--t-ink, #0b0b0b); letter-spacing: -.03em; line-height: 1; }',
    '.ts-pill .ln { width: fit-content; margin: 0 auto -8px; background: var(--t-paper, #fff); border-radius: 24px; padding: 6px 30px 12px; }',
    '.ts-pill .kw { color: ' + GREEN + '; background: var(--t-kw-bg, transparent); border-radius: 10px; padding: 0 .12em; }',
    '.cap.sub.ts-pill { font-family: "Inter Tight", Inter, sans-serif; font-weight: 700; font-size: 44px; color: var(--t-ink, #0b0b0b); background: var(--t-paper, #fff); width: fit-content; left: 50%; right: auto; margin-left: 0; border-radius: 18px; padding: 8px 26px 12px; white-space: nowrap; }',
    '.cap.title.ts-bold { font-family: "Archivo Black", Impact, sans-serif; color: var(--t-over, var(--t-text, #fff)); text-transform: uppercase; line-height: 1.02; letter-spacing: .5px; paint-order: stroke fill; -webkit-text-stroke: 16px #000; }',
    '.ts-bold .hl { color: var(--t-hlc, var(--t-accent, #fff)); background: var(--t-hl, none); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: var(--t-hl-fill, currentColor); text-shadow: var(--t-hl-ts, 0 6px 0 rgba(0,0,0,.55), 0 10px 40px rgba(0,0,0,.45)); filter: var(--t-hl-fx, none); }',
    '.cap.sub.ts-bold { font-family: "Archivo Black", Impact, sans-serif; font-size: 42px; color: var(--t-over, var(--t-text, #fff)); text-transform: uppercase; paint-order: stroke fill; -webkit-text-stroke: 10px #000; letter-spacing: .5px; }',
    '.cap.title.ts-stamp { font-family: "Inter Tight", Inter, sans-serif; font-weight: 800; color: ' + CREAM + '; text-transform: uppercase; letter-spacing: .16em; line-height: 1.16; }',
    '.cap.title.ts-stamp { color: #fff; }',
    '.ts-stamp .box { display: inline-block; padding: 26px 44px 26px calc(44px + .16em); border: 4px solid #fff; border-radius: 6px; background: rgba(12,12,14,.8); box-shadow: inset 0 0 0 9px rgba(0,0,0,0), inset 0 0 0 11px rgba(255,255,255,.85); }',
    '.cap.sub.ts-stamp { font-family: "Inter Tight", Inter, sans-serif; font-weight: 700; font-size: 34px; letter-spacing: .22em; text-transform: uppercase; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.8), 0 0 3px rgba(0,0,0,.9); }',
    '.cap.title.ts-ali, .cap.sub.ts-ali { font-family: Fraunces, "Instrument Serif", Georgia, serif; font-weight: 800; color: #fff; line-height: 1.12; text-shadow: 0 2px 14px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.25); }',
    '.ts-ali .w { display: inline-block; margin: 0 .11em; transition: none; }',
    '.ts-ali .w.gold { color: #f7c95c; } .ts-ali .w.blue { color: #b4cdf3; }',
    '.ts-ali .spk { display: inline-block; width: 1em; height: 1em; vertical-align: -.08em; }',
    '.cap.sub.ts-ali { font-weight: 600; font-style: italic; font-size: 44px; }',
    '.cap.title.ts-tiktok, .cap.sub.ts-tiktok { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 800; color: #fff; line-height: 1.16; paint-order: stroke fill; -webkit-text-stroke: 11px #000; text-shadow: none; }',
    '.cap.sub.ts-tiktok { font-size: 46px; -webkit-text-stroke: 8px #000; }',
    '.cap.title.ts-snap, .cap.title.ts-strip { left: 0; right: 0; }',
    '.cap.title.ts-snap { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 500; color: #fff; line-height: 1.22; }',
    '.ts-snap .bar { background: rgba(0,0,0,.6); padding: 16px 70px 18px; }',
    '.cap.sub.ts-snap { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 40px; color: #fff; text-shadow: 0 1px 8px rgba(0,0,0,.8); }',
    '.cap.title.ts-strip { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 800; color: #0b0b0b; line-height: 1.12; letter-spacing: -.01em; }',
    '.ts-strip .bar { position: relative; background: #fff; padding: 0 70px 34px; }',
    '.ts-strip .bar::before { content: ""; position: absolute; left: 0; right: 0; bottom: 100%; height: 2400px; background: #fff; }',
    '.cap.sub.ts-strip { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 600; font-size: 40px; color: #fff; text-shadow: 0 1px 8px rgba(0,0,0,.8); }',
    '.cap.title.ts-post { left: 70px; right: 70px; text-align: left; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 400; color: #0f1419; line-height: 1.24; }',
    '.ts-post .card { background: #fff; border-radius: 34px; padding: 38px 44px 42px; box-shadow: 0 18px 50px rgba(0,0,0,.35); }',
    '.ts-post .hd { display: flex; align-items: center; gap: 22px; margin-bottom: 26px; font-size: 38px; line-height: 1.15; }',
    '.ts-post .av { flex: none; width: 86px; height: 86px; border-radius: 50%; background: #161616; color: #fff; font-weight: 800; font-size: 34px; display: grid; place-items: center; }',
    '.ts-post .nm { font-weight: 800; display: flex; align-items: center; gap: 8px; } .ts-post .nm svg { width: 38px; height: 38px; }',
    '.ts-post .hn { color: #6b7380; font-size: 34px; }',
    '.ts-post .bd { font-size: 1em; } .ts-post .sb { color: #536471; font-size: .62em; margin-top: 18px; }',
    '.cap.title.ts-fly { font-family: "Archivo Black", Impact, sans-serif; color: #fff; text-transform: uppercase; line-height: .92; letter-spacing: -.01em; text-shadow: 0 6px 0 rgba(0,0,0,.55), 0 10px 40px rgba(0,0,0,.45); }',
    '.ts-fly .ln { will-change: transform; } .ts-fly .hl { color: var(--t-hlc, var(--t-accent, #fff)); background: var(--t-hl, none); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: var(--t-hl-fill, currentColor); text-shadow: var(--t-hl-ts, 0 6px 0 rgba(0,0,0,.55), 0 10px 40px rgba(0,0,0,.45)); filter: var(--t-hl-fx, none); }',
    '.cap.sub.ts-fly { font-family: "Archivo Black", Impact, sans-serif; font-size: 44px; color: #fff; text-transform: uppercase; text-shadow: 0 3px 0 rgba(0,0,0,.55); }'
  ].join('\n');
  var SPARK = '<svg class="spk" viewBox="0 0 24 24"><path fill="#f7c95c" d="M9 1c.6 5.2 2.8 7.4 8 8-5.2.6-7.4 2.8-8 8-.6-5.2-2.8-7.4-8-8 5.2-.6 7.4-2.8 8-8z"/><path fill="#f7c95c" d="M19.5 13c.3 2.6 1.4 3.7 4 4-2.6.3-3.7 1.4-4 4-.3-2.6-1.4-3.7-4-4 2.6-.3 3.7-1.4 4-4z"/></svg>';
  var TICK = '<svg viewBox="0 0 24 24"><path fill="#1d9bf0" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34z"/><path fill="#fff" d="M10.6 16.2l-3.7-3.7 1.4-1.4 2.3 2.3 5-5 1.4 1.4z"/></svg>';
  var injected = false;
  function inject() {
    if (injected) return; injected = true;
    var l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter+Tight:wght@700;800&family=Instrument+Serif:ital@0;1&family=Fraunces:ital,wght@0,800;1,600&display=swap';
    document.head.appendChild(l);
    var s = document.createElement('style'); s.setAttribute('data-keep', ''); s.textContent = css; document.head.appendChild(s);
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function ease(p) { return 1 - Math.pow(1 - p, 3); }
  function lines(tokens, maxChars) {
    var total = tokens.join(' ').length, n = Math.max(1, Math.ceil(total / maxChars)), target = total / n, out = [], cur = [], len = 0;
    tokens.forEach(function (w) {
      if (cur.length && len + w.length / 2 > target && out.length < n - 1) { out.push(cur); cur = []; len = 0; }
      cur.push(w); len += w.length + 1;
    });
    if (cur.length) out.push(cur);
    return out;
  }
  function make(o) {
    var still = /-static$/.test(o.style || ''), style = (o.style || '').replace(/-static$/, ''), title = o.title;
    if (!title || !STYLES.some(function (s) { return s.id === style; }) || style === 'serif') return null;
    if (window.RpnLooks && RpnLooks.is(style)) return rpnMake(o, style, still);
    inject();
    var ttl = o.ttl, sub = o.sub, subt = o.subt, text = String(title.text || '').trim(), tokens = text.split(/\s+/).filter(Boolean);
    var pop = null, wEls = [], times = [], built = false, now = 0;

    function wordTimes() {
      var n = tokens.length, wt = title.wt;
      if (wt && wt.length === n) return wt.slice();
      var span = Math.min(1.6, 0.34 * n);
      return tokens.map(function (_, i) { return n > 1 ? (i * span) / (n - 1) : 0; });
    }
    function fit(widthOK, fs, min) { ttl.style.fontSize = fs + 'px'; while (fs > min && !widthOK()) { fs -= 4; ttl.style.fontSize = fs + 'px'; } }
    function widest() { var m = 0; [].forEach.call(ttl.querySelectorAll('.ln, .w'), function (e) { m = Math.max(m, e.offsetWidth); }); return m; }

    function build() {
      ttl.className = 'cap title ts ts-' + style; ttl.style.fontSize = ''; ttl.style.top = title.y + 'px';
      ttl.style.color = title.color || '';
      sub.className = 'cap sub ts ts-' + style;
      var h = '';
      if (style === 'kinetic') {
        h = tokens.map(function (w, i) { return '<span class="w" data-i="' + i + '">' + esc(w.replace(/-/g, '‑')) + '</span>'; }).join('');
        ttl.innerHTML = h;
        var fs = 300; ttl.style.fontSize = fs + 'px';
        while (fs > 70 && (ttl.scrollWidth > ttl.clientWidth + 2 || ttl.offsetHeight > fs * 0.84 * 3 + 6 || widest() > 940)) { fs -= 6; ttl.style.fontSize = fs + 'px'; }
        wEls = [].slice.call(ttl.querySelectorAll('.w'));
        pop = null;
      } else if (style === 'pill') {
        var ks = tokens.findIndex(function (w) { return /\d/.test(w); });
        if (ks < 0) ks = tokens.reduce(function (b, w, i) { return w.replace(/\W/g, '').length > tokens[b].replace(/\W/g, '').length ? i : b; }, 0);
        var idx = 0;
        h = lines(tokens, 17).map(function (ln) { return '<span class="ln">' + ln.map(function (w) { var s = esc(w); return idx++ === ks ? '<span class="kw">' + s + '</span>' : s; }).join(' ') + '</span>'; }).join('');
        ttl.innerHTML = '<div class="pop">' + h + '</div>'; pop = ttl.firstChild;
        fit(function () { return widest() <= 900; }, 92, 44);
      } else if (style === 'bold') {
        var li = lines(tokens, 12), last = li.length - 1;
        h = li.map(function (ln, k) { return '<span class="ln">' + ln.map(function (w, j) { var s = esc(w); return k === last && j === ln.length - 1 ? '<span class="hl">' + s + '</span>' : s; }).join(' ') + '</span>'; }).join('');
        ttl.innerHTML = '<div class="pop">' + h + '</div>'; pop = ttl.firstChild;
        fit(function () { return widest() <= 900; }, 170, 48);
      } else if (style === 'ali') {
        var al = lines(tokens, 22), gold = tokens.findIndex(function (w) { return /\d|\$/.test(w); }), n0 = al[0].length, k0 = 0;
        if (gold < 0) gold = al[0].reduce(function (b, w, i) { return w.replace(/\W/g, '').length >= al[0][b].replace(/\W/g, '').length ? i : b; }, 0);
        var lastL = al[al.length - 1], off = tokens.length - lastL.length, blue = al.length > 1 ? off + lastL.reduce(function (b, w, i) { return w.replace(/\W/g, '').length > lastL[b].replace(/\W/g, '').length ? i : b; }, 0) : -1;
        h = al.map(function (ln, li) {
          var ws = ln.map(function (w, j) {
            var i = k0 + j, c = i === gold ? ' gold' : i === blue ? ' blue' : '', m = (n0 - 1) / 2, arc = li ? '' : ' style="transform:translateY(' + ((j - m) * (j - m) * 7).toFixed(1) + 'px) rotate(' + ((j - m) * 4.5).toFixed(1) + 'deg)"';
            return '<span class="w' + c + '" data-i="' + i + '"' + arc + '>' + esc(w) + '</span>';
          }).join('');
          k0 += ln.length;
          return '<span class="ln">' + (li ? ws : SPARK + ws + SPARK) + '</span>';
        }).join('');
        ttl.innerHTML = h;
        fit(function () { return widest() <= 920; }, 84, 44);
        wEls = [].slice.call(ttl.querySelectorAll('.w'));
        pop = null;
      } else if (style === 'tiktok') {
        h = lines(tokens, 20).map(function (ln) { return '<span class="ln">' + esc(ln.join(' ')) + '</span>'; }).join('');
        ttl.innerHTML = '<div class="pop">' + h + '</div>'; pop = ttl.firstChild;
        fit(function () { return widest() <= 930; }, 92, 44);
      } else if (style === 'snap' || style === 'strip') {
        h = lines(tokens, style === 'snap' ? 30 : 22).map(function (ln) { return '<span class="ln">' + esc(ln.join(' ')) + '</span>'; }).join('');
        ttl.innerHTML = '<div class="pop"><div class="bar">' + h + '</div></div>'; pop = ttl.firstChild;
        fit(function () { return widest() <= 940; }, style === 'snap' ? 58 : 72, 34);
      } else if (style === 'fly') {
        var fl = lines(tokens, 9), fz = fl.length - 1;
        ttl.innerHTML = fl.map(function (ln, k) { return '<span class="ln">' + ln.map(function (w, j) { var s = esc(w); return k === fz && j === ln.length - 1 ? '<span class="hl">' + s + '</span>' : s; }).join(' ') + '</span>'; }).join('');
        fit(function () { return widest() <= 960; }, 190, 60);
        wEls = [].slice.call(ttl.querySelectorAll('.ln'));
        pop = null;
      } else if (style === 'post') {
        ttl.innerHTML = '<div class="pop"><div class="card"><div class="hd"><span class="av">YN</span><span><span class="nm">Your Name' + TICK + '</span><span class="hn">@yourname</span></span></div><div class="bd">' + esc(text) + '</div>' + (subt ? '<div class="sb">' + esc(subt.text) + '</div>' : '') + '</div></div>';
        pop = ttl.firstChild;
        fit(function () { return ttl.querySelector('.card').offsetHeight <= 520; }, 60, 36);
      } else {
        h = lines(tokens, 16).map(function (ln) { return '<span class="ln">' + esc(ln.join(' ')) + '</span>'; }).join('');
        ttl.innerHTML = '<div class="pop"><div class="box">' + h + '</div></div>'; pop = ttl.firstChild;
        fit(function () { return ttl.querySelector('.box').offsetWidth <= 940; }, 60, 30);
      }
      if (style === 'kinetic' && !title.moved) {
        var top = Infinity; (o.faces || []).forEach(function (f) { if (f[0] < 3.3 && f[2] < top) top = f[2]; });
        var hh = ttl.offsetHeight, ceil = (isFinite(top) ? top : 600) - 120 - hh / 2;
        title.y = Math.round(Math.max(hh / 2 + 120, ceil)); ttl.style.top = title.y + 'px';
      }
      if (style === 'strip' && !title.moved) { title.y = Math.round(ttl.offsetHeight / 2 + 150); ttl.style.top = title.y + 'px'; }
      if (subt && style !== 'post') {
        sub.textContent = subt.text;
        sub.style.top = Math.round(title.y + ttl.offsetHeight / 2 + sub.offsetHeight / 2 + 18) + 'px';
        if (style === 'pill') sub.style.translate = '-50% 0px';
        if (title.x - 540 && !FULL[style]) { ttl.style.translate = (title.x - 540) + 'px 0px'; sub.style.translate = (style === 'pill' ? 'calc(-50% + ' + (title.x - 540) + 'px) 0px' : (title.x - 540) + 'px 0px'); }
      }
      times = wordTimes(); built = true;
      if (api.draw) api.draw(now);
    }
    var api = {};
    build();
    if (document.fonts && document.fonts.load) {
      Promise.all(['400 100px "Instrument Serif"', '800 100px "Inter Tight"', '700 100px "Inter Tight"', '400 100px "Archivo Black"', '800 100px Fraunces', 'italic 600 100px Fraunces'].map(function (f) { return document.fonts.load(f, 'ABC'); }))
        .then(function () { build(); }, function () {});
    }

    api.draw = function (t) {
        now = t;
        var on = t < title.t1;
        if (still) t = 99;
        ttl.style.opacity = on ? 1 : 0;
        sub.style.opacity = subt && on && style !== 'post' ? Math.min(1, Math.max(0, (t - 0.3) / 0.2)) : 0;
        if (!built || !on) return;
        if (style === 'ali') {
          wEls.forEach(function (e, i) { var a = t - times[i]; e.style.opacity = a < 0 ? 0.42 : 0.42 + 0.58 * Math.min(1, a / 0.12); });
        } else if (style === 'fly') {
          wEls.forEach(function (e, i) {
            var p = ease(Math.min(1, Math.max(0, (t - i * 0.16) / 0.28))), d = 1 - p, side = i % 4;
            e.style.opacity = p > 0 ? 1 : 0;
            e.style.transform = 'translate(' + (side === 0 ? -1100 * d : side === 1 ? 1100 * d : 0) + 'px,' + (side === 2 ? -700 * d : side === 3 ? 700 * d : 0) + 'px)';
          });
        } else if (FULL[style]) {
          pop.style.opacity = Math.min(1, t / 0.12);
        } else if (style === 'kinetic') {
          wEls.forEach(function (e, i) {
            var a = t - times[i], p = Math.min(1, Math.max(0, a / 0.18));
            e.style.opacity = a < 0 ? 0 : Math.min(1, a / 0.05);
            e.style.transform = 'scale(' + (1 + 0.6 * (1 - ease(p))) + ')';
          });
        } else if (pop) {
          var q = Math.min(1, Math.max(0, t / (style === 'stamp' ? 0.2 : 0.22))), e2 = ease(q);
          if (style === 'stamp') pop.style.transform = 'scale(' + (1.45 - 0.45 * e2) + ') rotate(' + (-8 + 6 * e2) + 'deg)';
          else if (style === 'bold') pop.style.transform = 'scale(' + (0.55 + 0.45 * e2 + 0.1 * Math.sin(Math.PI * q)) + ')';
          else pop.style.transform = 'scale(' + (0.88 + 0.12 * e2) + ')';
          pop.style.opacity = Math.min(1, q * 2.5);
        }
    };
    return api;
  }
  // Entrance picked in Hook properties (plan.titleAnim), replacing the look's own on its main text layers.
  var ANIMS = {
    pop: { title: 'Pop', in: { type: 'pop', s0: 0.3, dur: 0.28, ease: 'back' } },
    rise: { title: 'Rise up', in: { type: 'slide', from: 'down', dist: 180, dur: 0.32, blur: 10 } },
    drop: { title: 'Drop in', in: { type: 'slide', from: 'up', dist: 260, dur: 0.3, ease: 'back' } },
    sides: { title: 'Words from all sides', in: { type: 'slide', from: 'cycle', dist: 1000, dur: 0.34, blurX: 30, ease: 'expo' } },
    zoom: { title: 'Zoom in', in: { type: 'zoom', s0: 2.2, dur: 0.3, blur: 14 } },
    blur: { title: 'Blur in', in: { type: 'pop', s0: 1.08, dur: 0.4, blur: 28 } },
    type: { title: 'Type on', in: { type: 'type' }, letters: true },
    wipe: { title: 'Wipe', in: { type: 'wipe', from: 'left', dur: 0.35 } }
  };
  function entrance(sp, id, n) {
    var A = ANIMS[id];
    sp.layers.forEach(function (L) {
      if (/label|subtitle|tag|^line$/.test(L.name) || L.image) return;
      L.in = JSON.parse(JSON.stringify(A.in));
      if (A.letters) { L.reveal = 'letters'; L.step = 0.035; }
      else if (!L.reveal && !/^word /.test(L.name)) { L.reveal = 'words'; L.step = Math.min(0.22, 1.4 / Math.max(1, n)); }
    });
  }
  // Engine looks draw with hook-engine.js inside #ttl, so the face/overlap checks still read the hook's text.
  function rpnMake(o, style, still) {
    var ttl = o.ttl, sub = o.sub, title = o.title, subt = o.subt, tokens = String(title.text || '').trim().split(/\s+/).filter(Boolean);
    var host = document.createElement('div'), m = null, now = 0, settle = 1.0, api = {};
    function wordTimes() {
      var n = tokens.length, wt = title.wt;
      if (wt && wt.length === n) return wt.slice();
      var span = Math.min(1.6, 0.34 * n);
      return tokens.map(function (_, i) { return n > 1 ? (i * span) / (n - 1) : 0; });
    }
    function build() {
      ttl.className = 'cap title ts ts-rpn'; ttl.style.fontSize = ''; ttl.style.top = title.y + 'px'; ttl.innerHTML = '';
      sub.className = 'cap sub ts'; sub.textContent = '';
      host.style.cssText = 'position:absolute;left:-60px;top:' + (-title.y) + 'px;width:1080px;height:1920px;pointer-events:none;text-align:left;line-height:normal';
      ttl.appendChild(host);
      var sp = RpnLooks.spec(style, { tokens: tokens, y: title.y, x: 540, sub: subt && subt.text, wt: wordTimes(), t1: Math.max(title.t1 || 3, 1.6) });
      if (title.color) sp.layers.forEach(function (L) { if (!/label|subtitle|tag|^line$/.test(L.name)) { L.color = title.color; delete L.gradient; } });
      if (title.anim && ANIMS[title.anim]) entrance(sp, title.anim, tokens.length);
      m = RpnHook.mount(host, sp);
      api.draw(now);
      return m;
    }
    api.draw = function (t) {
      now = t;
      var on = t < title.t1;
      ttl.style.opacity = on ? 1 : 0; sub.style.opacity = 0;
      if (m && on) m.render(still ? settle : t);
    };
    build().ready.then(function () { build(); });
    return api;
  }
  window.TitleStyle = { make: make, styles: STYLES, anims: Object.keys(ANIMS).map(function (k) { return [k, ANIMS[k].title]; }) };
})();
