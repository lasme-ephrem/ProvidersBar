const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

async function findCodex() {
  const candidates = (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'codex.exe'));
  const installed = path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin');
  const versions = await fs.readdir(installed, { withFileTypes: true }).catch(() => []);
  for (const dir of versions.filter(d => d.isDirectory()).reverse()) candidates.push(path.join(installed, dir.name, 'codex.exe'));
  for (const candidate of candidates) { try { await fs.access(candidate); return candidate; } catch {} }
  throw new Error('Codex est nécessaire pour connecter OpenAI. Installe Codex et connecte ton compte ChatGPT, puis réessaie.');
}

async function openCodexRpc() {
  const child = spawn(await findCodex(), ['app-server', '--stdio'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, buffer = '', closed = false;
  const pending = new Map();
  const listeners = new Set();
  const stop = () => {
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('La connexion à Codex a été fermée.')); }
    pending.clear();
  };
  child.on('error', stop); child.on('exit', stop); child.stderr.resume(); child.stdin.on('error', stop);
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error('Codex ne peut pas lire le compte ou ses limites. Vérifie la connexion ChatGPT dans Codex.'));
        else request.resolve(message.result);
      } else if (message.method === 'account/login/completed') {
        for (const listener of listeners) listener(message.params);
      }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('La connexion à Codex a été fermée.'));
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex ne répond pas. Réessaie la connexion.')); }, 12000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + '\n');
  });
  const close = () => { stop(); child.kill(); };
  try {
    await request('initialize', { clientInfo: { name: 'providersbar', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return { request, close, onLogin: fn => listeners.add(fn) };
  } catch (error) { close(); throw error; }
}

function parseOpenAiLimits(body, now = new Date()) {
  const groups = body?.rateLimitsByLimitId ? Object.entries(body.rateLimitsByLimitId) : [['codex', body?.rateLimits]];
  const windows = [];
  for (const [id, group] of groups) {
    if (!group) continue;
    for (const window of [group.primary, group.secondary]) {
      if (!window) continue;
      const { usedPercent, windowDurationMins, resetsAt } = window;
      if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100 || !Number.isFinite(windowDurationMins) || windowDurationMins <= 0) throw new Error('Quota OpenAI invalide.');
      if (resetsAt != null && (!Number.isFinite(resetsAt) || resetsAt <= 0)) throw new Error('Date de reset OpenAI invalide.');
      const period = windowDurationMins === 10080 ? 'Semaine' : windowDurationMins === 300 ? '5 heures' : `${windowDurationMins} min`;
      windows.push({ label: `${id === 'codex' ? 'Codex et Work' : group.limitName || id} · ${period}`, remaining: Math.round((100 - usedPercent) * 100) / 100, resetAt: resetsAt == null ? null : new Date(resetsAt * 1000).toISOString() });
    }
  }
  if (!windows.length) throw new Error('Le compte est connecté à Codex mais ses quotas ne sont pas disponibles.');
  const main = windows.filter(w => w.label.startsWith('Codex et Work'));
  const tightest = (main.length ? main : windows).reduce((a, b) => a.remaining <= b.remaining ? a : b);
  return { source: 'api', connectorVersion: 'openai-codex-rpc-v1', updatedAt: now.toISOString(), balances: [], quotaRemaining: tightest.remaining, resetAt: tightest.resetAt, quotaWindows: windows, quotaLabel: tightest.label };
}

function createOpenAiAccount({ onChange, onResult, openExternal, rpcFactory = openCodexRpc }) {
  let connection = { status: 'idle', message: '' }, work, loginRpc;
  const update = (status, message) => { connection = { status, message }; onChange(); };
  async function collect(rpc, expectedIdentity) {
    const { account } = await rpc.request('account/read', { refreshToken: false });
    if (account?.type !== 'chatgpt') throw Object.assign(new Error('Connecte ton compte ChatGPT dans Codex pour lire les quotas OpenAI.'), { code: 'OPENAI_SIGNIN' });
    const identity = account.email ? createHash('sha256').update(account.email.toLowerCase()).digest('hex') : null;
    if (expectedIdentity && expectedIdentity !== identity) throw new Error('Le compte connecté dans Codex a changé. Reconnecte OpenAI dans ProvidersBar pour le sélectionner.');
    const snapshot = parseOpenAiLimits(await rpc.request('account/rateLimits/read'));
    await onResult(snapshot, identity);
    update('connected', 'OpenAI connecté via Codex. Les limites réelles sont à jour.');
    return snapshot;
  }
  async function read(expectedIdentity) {
    if (work) return work;
    const job = (async () => {
      update('verifying', 'Lecture des limites OpenAI via Codex…');
      const rpc = await rpcFactory();
      try { return await collect(rpc, expectedIdentity); } finally { rpc.close(); }
    })();
    work = job;
    try { return await job; } catch (error) { update('error', error.message); throw error; } finally { work = null; }
  }
  async function open() {
    if (loginRpc) return true;
    try { await read(); return true; }
    catch (error) { if (error.code !== 'OPENAI_SIGNIN') throw error; }
    const rpc = await rpcFactory(); loginRpc = rpc;
    rpc.onLogin(async result => {
      if (loginRpc !== rpc) return;
      try {
        if (!result.success) throw new Error('La connexion ChatGPT a été annulée ou refusée.');
        await collect(rpc);
      } catch (error) { update('error', error.message); }
      finally { rpc.close(); if (loginRpc === rpc) loginRpc = null; }
    });
    try {
      const result = await rpc.request('account/login/start', { type: 'chatgpt' });
      const url = new URL(result.authUrl);
      if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname)) throw new Error('Adresse de connexion OpenAI inattendue.');
      update('waiting', 'Connecte-toi dans le navigateur. La confirmation reviendra automatiquement dans ProvidersBar, sans fermer la fenêtre.');
      await openExternal(url.href);
      return true;
    } catch (error) { rpc.close(); loginRpc = null; update('error', error.message); throw error; }
  }
  async function close() { if (loginRpc) { loginRpc.close(); loginRpc = null; } await work?.catch(() => {}); }
  return { info: () => connection, read, open, close, disconnect: async () => { await close(); update('idle', ''); } };
}
module.exports = { findCodex, openCodexRpc, parseOpenAiLimits, createOpenAiAccount };
