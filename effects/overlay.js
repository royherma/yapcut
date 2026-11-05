// Hook title, subtitle and captions for a HyperFrames export, laid out like preview/player.js and driven by the fx timeline.
(function () {
  var D = window.YO, tl = window.__timelines.fx, $ = function (id) { return document.getElementById(id); };
  var fx = $('fx'), ttl = $('ttl'), sub = $('sub'), cw = $('cw'), capFrame = null;
  fx.appendChild($('caps'));
  var caps = D.captions.filter(function (c) { return c.kind === 'cap'; });
  var title = D.captions.find(function (c) { return c.kind === 'title'; }), subt = D.captions.find(function (c) { return c.kind === 'sub'; });
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  if (title) {
    ttl.innerHTML = esc(title.text.replace(/-/g, '‑')).replace(/^(.{12,}?)\s/, '$1<br>'); ttl.style.top = title.y + 'px';
    ttl.style.opacity = 1; for (var fs = 104; fs > 56 && (ttl.scrollWidth > ttl.clientWidth + 2 || ttl.offsetHeight > fs * 1.08 * 2 + 8); fs -= 4) ttl.style.fontSize = fs - 4 + 'px'; ttl.style.opacity = 0;
    ttl.style.translate = sub.style.translate = (title.x - 540 || 0) + 'px 0px';
    if (title.s && title.s !== 1) ttl.style.scale = sub.style.scale = title.s;
  }
  if (subt) { sub.textContent = subt.text; sub.style.top = (title ? title.y + ttl.offsetHeight / 2 + 40 : subt.y) + 'px'; }
  var TS = window.TitleStyle && TitleStyle.make({ ttl: ttl, sub: sub, title: title, subt: subt, faces: D.faces, style: title && title.ts });
  if (caps[0]) { cw.style.top = caps[0].y + 'px'; if (caps[0].s && caps[0].s !== 1) cw.style.scale = caps[0].s; }
  if (D.captionStyle === 'none') cw.style.display = 'none';
  else if (D.captionStyle && D.captionStyle !== 'yapcut') {
    capFrame = document.createElement('iframe');
    capFrame.id = 'capframe'; capFrame.src = 'captions.html';
    capFrame.setAttribute('style', 'position:absolute;left:0;top:0;width:1080px;height:1920px;border:0;background:transparent;z-index:6;pointer-events:none');
    if (caps[0]) { capFrame.style.transformOrigin = '540px ' + (caps[0].y + 16) + 'px'; if (caps[0].s && caps[0].s !== 1) capFrame.style.scale = caps[0].s; }
    fx.appendChild(capFrame); cw.style.display = 'none';
  }
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
  var cur = -1, capOY = caps[0] ? caps[0].y + 16 : 960;
  function draw(t) {
    rideCam(t, $('caps'), capFrame, capOY);
    if (TS) TS.draw(t);
    else {
      ttl.style.opacity = title && t < title.t1 ? 1 : 0;
      sub.style.opacity = subt && t < subt.t1 ? 1 : 0;
    }
    try { var api = capFrame && capFrame.contentWindow.CL_API; if (api) api.seek(t); } catch (e) {}
    var ci = -1;
    for (var i = 0; i < caps.length; i++) { if (caps[i].t0 > t) break; if (t < caps[i].t1) ci = i; }
    if (ci === cur) return;
    cur = ci;
    if (ci < 0) { cw.style.opacity = 0; return; }
    cw.textContent = caps[ci].text;
    cw.className = 'cap word' + (caps[ci].hi ? (caps[ci].text.length <= 11 ? ' hi' : ' hi long') : '');
    cw.style.opacity = 1;
  }
  var p = { v: 0 };
  tl.fromTo(p, { v: 0 }, { v: 1, duration: D.total, ease: 'none', immediateRender: false, onUpdate: function () { draw(p.v * D.total); } }, 0);
  draw(0);
})();
