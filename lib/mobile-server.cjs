const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { timingSafeEqual } = require('node:crypto');

const PORT = 4318;
function validateOrigin(value) {
  if (!value) return '';
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(u.hostname) || u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Utilise l’adresse HTTPS privée Tailscale, sans chemin ni paramètres.');
  return u.origin;
}
// Explicit projection: never expose accountSession, identity, notes, history or credentials.
function mobileState(state) {
  return { servedAt: new Date().toISOString(), providers: state.providers.map(p => ({
    id: p.id, name: p.name, type: p.type, favorite: Boolean(p.favorite), active: Boolean(p.active),
    connected: Boolean(p.connected), syncing: Boolean(p.syncing),
    error: p.error ? (p.id === 'antigravity' ? 'Ouvre Antigravity sur le PC pour actualiser ces quotas.' : 'Connexion à vérifier sur le PC. Dernier relevé conservé.') : null,
    snapshot: p.snapshot ? {
      updatedAt: p.snapshot.updatedAt, quotaRemaining: p.snapshot.quotaRemaining,
      quotaLabel: p.snapshot.quotaLabel, balanceLabel: p.snapshot.balanceLabel,
      balances: (p.snapshot.balances || []).map(b => ({ currency: b.currency, remaining: b.remaining })),
      quotaWindows: (p.snapshot.quotaWindows || []).map(w => ({ label: w.label, remaining: w.remaining, resetAt: w.resetAt })),
    } : null,
  })) };
}
function equal(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2048) throw new Error('Request too large'); }
  return JSON.parse(body);
}
async function startMobileServer({ root, token, origin = '', getState, sync, port = PORT }) {
  origin = validateOrigin(origin);
  let refresh = null, lastSync = -Infinity, attempts = [];
  const routes = new Map([
    ['/', ['mobile/index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['mobile/app.js', 'text/javascript; charset=utf-8']],
    ['/styles.css', ['mobile/styles.css', 'text/css; charset=utf-8']],
    ['/sw.js', ['mobile/sw.js', 'text/javascript; charset=utf-8']],
    ['/manifest.webmanifest', ['mobile/manifest.webmanifest', 'application/manifest+json']],
    ['/assets/icon.png', ['assets/icon.png', 'image/png']],
  ]);
  const sources = JSON.parse(await fs.readFile(path.join(root, 'assets/providers/sources.json'), 'utf8'));
  const extensions = { antigravity: 'ico', deepseek: 'ico', ollama: 'png', openrouter: 'png', orcarouter: 'png' };
  for (const id of Object.keys(sources)) {
    const ext = extensions[id] || 'svg', file = `assets/providers/${id}.${ext}`;
    routes.set('/' + file, [file, { svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon' }[ext]]);
  }
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const local = `127.0.0.1:${server.address().port}`;
      const host = req.headers.host;
      if (host !== local && (!origin || host !== new URL(origin).host)) return reply(403, { error: 'Hôte non autorisé.' });
      const expectedOrigin = host === local ? `http://${local}` : origin;
      const url = new URL(req.url, expectedOrigin);
      const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('pb_mobile='))?.slice(10);
      if (req.method === 'POST') {
        if (req.headers.origin !== expectedOrigin || req.headers['x-providersbar'] !== 'mobile' || !req.headers['content-type']?.startsWith('application/json')) return reply(403, { error: 'Origine refusée.' });
      }
      const cookieFlags = `Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${host === local ? '' : '; Secure'}`;
      if (url.pathname === '/api/login' && req.method === 'POST') {
        attempts = attempts.filter(t => Date.now() - t < 60000);
        if (attempts.length >= 10) return reply(429, { error: 'Trop de tentatives. Réessaie dans une minute.' });
        attempts.push(Date.now());
        const body = await readJson(req);
        if (typeof body.code !== 'string' || !equal(body.code.trim(), token)) return reply(401, { error: 'Code incorrect. Consulte les réglages sur le PC.' });
        res.setHeader('Set-Cookie', `pb_mobile=${token}; ${cookieFlags}`);
        return reply(200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (!equal(cookie, token)) return reply(401, { error: 'Associe cet appareil avec le code du PC.' });
        if (url.pathname === '/api/state' && req.method === 'GET') return reply(200, { ...mobileState(getState()), refreshing: Boolean(refresh) });
        if (url.pathname === '/api/sync' && req.method === 'POST') {
          if (refresh || Date.now() - lastSync < 60000) return reply(429, { error: 'Une actualisation est en cours ou vient d’être demandée. Réessaie dans une minute.' });
          lastSync = Date.now();
          refresh = Promise.resolve().then(sync).catch(() => {}).finally(() => { refresh = null; });
          return reply(202, { ok: true });
        }
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          res.setHeader('Set-Cookie', `pb_mobile=; ${cookieFlags.replace('Max-Age=2592000', 'Max-Age=0')}`);
          return reply(200, { ok: true });
        }
        return reply(404, { error: 'Action indisponible sur mobile.' });
      }
      const route = routes.get(url.pathname);
      if (req.method !== 'GET' || !route) return reply(404, { error: 'Page introuvable.' });
      const data = await fs.readFile(path.join(root, route[0]));
      res.writeHead(200, { 'Content-Type': route[1] }); res.end(data);
    } catch { if (!res.headersSent) reply(400, { error: 'Requête invalide.' }); else res.end(); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { port: server.address().port, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
module.exports = { PORT, validateOrigin, mobileState, startMobileServer };
