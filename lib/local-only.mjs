// Blocks other websites from driving the local server: wrong Host (DNS rebinding) or a cross-site write.
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?$/i;
const localOrigin = (o) => { try { return LOCAL.test(new URL(o).host); } catch { return false; } };

export function refuseForeign(req, res) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const bad = !LOCAL.test(req.headers.host || '')
    || (write && req.headers.origin && !localOrigin(req.headers.origin))
    || (write && req.headers['sec-fetch-site'] === 'cross-site');
  if (bad) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('local requests only'); }
  return bad;
}
