(function () {
  var B = (window.YP || {}).board || window.YB, tl = window.__timelines.fx;
  if (!B || !window.Board) return;
  var fxRoot = document.getElementById('fx'), host = document.createElement('div');
  host.className = 'layer'; host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5';
  fxRoot.insertBefore(host, document.getElementById('front'));
  var guard = document.createElement('style');
  guard.textContent = '.board .pill, .board .cut, .board .row { position: relative; left: auto; top: auto; font-family: inherit; font-weight: inherit; line-height: inherit; box-shadow: none; white-space: pre; }';
  document.head.appendChild(guard);

  function bezier(c) {
    var ax = 3 * c[0] - 3 * c[2] + 1, bx = 3 * c[2] - 6 * c[0], cx = 3 * c[0], ay = 3 * c[1] - 3 * c[3] + 1, by = 3 * c[3] - 6 * c[1], cy = 3 * c[1];
    return function (u) {
      if (u <= 0) return 0; if (u >= 1) return 1;
      var lo = 0, hi = 1, s = u;
      for (var i = 0; i < 30; i++) { s = (lo + hi) / 2; if (((ax * s + bx) * s + cx) * s < u) lo = s; else hi = s; }
      return ((ay * s + by) * s + cy) * s;
    };
  }
  if (B.cam) {
    var cam = document.getElementById('cam'), m = B.cam.moves[B.cam.moves.length - 1], f = B.cam.fill || {};
    var under = document.getElementById('under'), H = window.FX.H, col = f.color || '#5f5d59';
    under.style.background = col;
    var solid = Math.max(f.shadeSolid || 0, m.to.y) * 100, end = solid + ((f.shadeHeight || 0.3) - (f.shadeSolid || 0.13)) * 100, stops = [];
    for (var q = 0; q <= 8; q++) { var u = q / 8; stops.push('rgba(' + [1, 3, 5].map(function (k) { return parseInt(col.substr(k, 2), 16); }).join(',') + ',' + ((f.shadeStrength == null ? 1 : f.shadeStrength) * (1 - u * u * (3 - 2 * u))).toFixed(3) + ') ' + (solid + (end - solid) * u).toFixed(2) + '%'); }
    var shade = document.createElement('div'), soft = document.createElement('div'), mask = 'linear-gradient(#000 ' + solid.toFixed(2) + '%, transparent ' + end.toFixed(2) + '%)';
    shade.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:none;background:linear-gradient(' + stops.join(',') + ')';
    soft.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:none;backdrop-filter:blur(18px);-webkit-mask-image:' + mask + ';mask-image:' + mask;
    fxRoot.insertBefore(soft, host); fxRoot.insertBefore(shade, host);
    gsap.set([shade, soft], { opacity: 0 });
    cam.style.transformOrigin = '50% 50%';
    var down = { y: m.to.y * window.FX.H, x: m.to.x * window.FX.W, scale: m.to.zoom }, rest = { y: 0, x: 0, scale: 1 };
    var layoutStarts = (window.FX.effects || []).filter(function (e) { return ['split-top', 'split-screen', 'title-stack', 'face-bubble'].indexOf(e.fx) >= 0; }).map(function (e) { return e.t0; });
    (B.cam.windows || [{ t0: m.at, t1: Infinity }]).forEach(function (w) {
      var a = Math.max(0, w.t0 - 0.15), d = w.d || Math.min(m.dur, Math.max(0.35, (w.t1 - w.t0) / 3));
      tl.fromTo([shade, soft], { opacity: 0 }, { opacity: 1, duration: d, ease: 'power1.out', immediateRender: false }, a);
      tl.fromTo(cam, rest, Object.assign({ duration: d, ease: bezier(m.ease), immediateRender: false }, down), a);
      if (w.t1 === Infinity) return tl.set(cam, down, a + d + 0.01);
      // A layout places the camera on its first frame; the way back must be done before then or it overwrites it.
      var back = layoutStarts.reduce(function (b, t0) { return t0 >= w.t1 - 0.01 && t0 < w.t1 + b ? Math.max(0, t0 - w.t1 - 0.02) : b; }, 0.5);
      tl.to([shade, soft], { opacity: 0, duration: Math.max(0.01, back), ease: 'power1.in', immediateRender: false }, w.t1);
      if (back < 0.05) tl.set(cam, rest, w.t1);
      else tl.to(cam, Object.assign({ duration: back, ease: 'power2.inOut', immediateRender: false }, rest), w.t1);
    });
    gsap.set(cam, rest);
  }
  var font = B.theme.font;
  new FontFace(font.family, 'url(' + font.file + ')', { weight: '100 900' }).load().then(function (ff) { document.fonts.add(ff); }).catch(function () {}).then(function () {
    var btl = Board.build(host, { fitted: B.fitted, theme: B.theme, assets: B.assets });
    btl.paused(false);
    tl.add(btl, 0);
    tl.seek(tl.time(), false);
    if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
  });
})();
