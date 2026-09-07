const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = (ms, signal) => require('node:timers/promises').setTimeout(ms, undefined, { signal });
const ORIGIN = 'https://ollama.com';
const { accountConfig, inspectSubscriptionPage } = require('./subscription-accounts.cjs');

function ollamaCookie(cookie) {
  if (cookie.domain?.replace(/^\./, '') !== 'ollama.com' || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') return null;
  const cookiePath = cookie.path?.startsWith('/') ? cookie.path : '/';
  return { url: ORIGIN + cookiePath, name: cookie.name, value: cookie.value, path: cookiePath,
    ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : {}), secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly),
    ...(cookie.expires > 0 ? { expirationDate: cookie.expires } : {}),
    ...(cookie.sameSite ? { sameSite: { Strict: 'strict', Lax: 'lax', None: 'no_restriction' }[cookie.sameSite] } : {}) };
}
async function findBrowser() {
  const candidates = [
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  for (const candidate of candidates) { try { await fs.access(candidate); return candidate; } catch {} }
  throw new Error('Chrome ou Edge est nécessaire pour la connexion Google. Tu peux aussi utiliser la connexion par email.');
}
async function openAccountBrowser(dataDir, accountId = null, headless = false, { signal } = {}) {
  const config = accountId ? accountConfig(accountId) : null;
  const origin = config?.origin || ORIGIN;
  const url = (headless && config?.usageUrl) || config?.url || ORIGIN + '/settings';
  const executable = await findBrowser();
  const profilesRoot = path.resolve(dataDir, accountId ? 'account-browsers' : 'temporary-account-browsers');
  await fs.mkdir(profilesRoot, { recursive: true });
  const profile = accountId ? path.join(profilesRoot, accountId) : await fs.mkdtemp(path.join(profilesRoot, 'ollama-'));
  if (accountId) {
    await fs.mkdir(profile, { recursive: true });
    // A stale port from an earlier process must never select another browser.
    await fs.rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  }
  // This is a normal system browser with its own dedicated profile. No shared
  // browser profile, user-agent spoofing or disabled web security is used.
  const child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new'] : ['--new-window']), url], { windowsHide: true, stdio: 'ignore' });
  let launchFailed = false, launchExited = false;
  child.on('error', () => { launchFailed = true; });
  child.once('exit', () => { launchExited = true; });
  let socket, sequence = 0;
  const cancel = () => { socket?.close(); child.kill(); };
  signal?.addEventListener('abort', cancel, { once: true });
  const pending = new Map();
  async function cleanup() {
    if (accountId) return; // Browser-managed session is retained until disconnect.
    const resolved = await fs.realpath(profile).catch(() => null);
    const root = await fs.realpath(profilesRoot);
    // Recursive removal is restricted to the exact temporary profile we created.
    if (!resolved || path.dirname(resolved) !== root || !path.basename(resolved).startsWith('ollama-')) return;
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }).catch(() => {});
  }
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return reject(new Error('La fenêtre du navigateur est fermée. Rouvre la connexion au compte.'));
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Le navigateur ne répond pas.')); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    let endpoint;
    for (let attempt = 0; attempt < 80; attempt++) {
      signal?.throwIfAborted();
      if (launchFailed) throw new Error('Le navigateur ne peut pas être démarré.');
      try {
        const [port, suffix] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && /^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(suffix)) { endpoint = `ws://127.0.0.1:${port}${suffix}`; break; }
      } catch {}
      if (launchExited) throw new Error('Le navigateur dédié s’est arrêté avant la vérification. Ferme les autres fenêtres de ce compte puis réessaie.');
      await delay(250, signal);
    }
    if (!endpoint) throw new Error('Le navigateur dédié ne répond pas. Essaie la connexion par email.');
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connexion locale au navigateur impossible.')), 10000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Connexion locale au navigateur impossible.')); }, { once: true });
    });
    socket.addEventListener('message', event => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error('La lecture de la session a échoué.'));
      else request.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Le navigateur a été fermé.')); }
      pending.clear();
    });
  } catch (error) {
    signal?.removeEventListener('abort', cancel);
    socket?.close(); child.kill(); await delay(500); await cleanup(); throw error;
  }
  let closed = false;
  return {
    isOpen: () => !closed && socket.readyState === WebSocket.OPEN,
    async readSubscriptionPage() {
      if (!config) throw new Error('Compte non disponible.');
      const { targetInfos } = await command('Target.getTargets');
      const candidates = targetInfos.filter(t => { try { return t.type === 'page' && new URL(t.url).origin === origin; } catch { return false; } });
      // Prefer the actual usage page when sign-in has opened a second tab.
      const target = candidates.find(t => t.url.split(/[?#]/)[0] === (config.usageUrl || config.url)) || candidates.find(t => /analytics|usage|subscription/.test(new URL(t.url).pathname)) || candidates[0];
      if (!target) return { authenticated: false, windows: [] };
      const { sessionId } = await command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      try {
        const result = await command('Runtime.evaluate', { expression: `(${inspectSubscriptionPage.toString()})(${JSON.stringify(accountId)}, ${JSON.stringify(origin)})`, returnByValue: true }, sessionId);
        if (result.exceptionDetails || !result.result?.value) throw new Error('Les réglages d’utilisation ne sont pas encore lisibles.');
        return result.result.value;
      } finally { await command('Target.detachFromTarget', { sessionId }).catch(() => {}); }
    },
    async readOllamaCookies() {
      const { targetInfos } = await command('Target.getTargets');
      const target = targetInfos.find(t => { try { return t.type === 'page' && new URL(t.url).origin === ORIGIN && !new URL(t.url).pathname.startsWith('/auth/'); } catch { return false; } });
      if (!target) return [];
      const { sessionId } = await command('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      try {
        // Only cookies applicable to Ollama are requested. Google credentials,
        // Google cookies and page contents are never read.
        const { cookies } = await command('Network.getCookies', { urls: [ORIGIN + '/settings'] }, sessionId);
        return cookies.map(ollamaCookie).filter(Boolean);
      } finally { await command('Target.detachFromTarget', { sessionId }).catch(() => {}); }
    },
    async close() {
      if (closed) return;
      closed = true;
      signal?.removeEventListener('abort', cancel);
      await command('Browser.close').catch(() => {});
      socket.close();
      await delay(750);
      if (child.exitCode === null) child.kill();
      await cleanup();
    },
  };
}
async function deleteAccountProfile(dataDir, id) {
  accountConfig(id);
  const root = await fs.realpath(path.resolve(dataDir, 'account-browsers')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!root) return;
  const profile = await fs.realpath(path.join(root, id)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!profile) return;
  if (path.dirname(profile) !== root || path.basename(profile) !== id) throw new Error('Dossier de session hors du répertoire autorisé.');
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
// Google authentication takes place in an ordinary browser process, with no
// debugging port and no page/cookie inspection. Only after the user closes it
// may a separate read-only process use this provider's dedicated profile.
async function openNativeLogin(dataDir, id, dependencies = {}) {
  const config = accountConfig(id);
  const executable = await (dependencies.findBrowser || findBrowser)();
  const profile = path.resolve(dataDir, 'account-browsers', id);
  await fs.mkdir(profile, { recursive: true });
  const launch = dependencies.spawn || spawn;
  const child = launch(executable, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-mode', '--new-window', config.url], { windowsHide: true, stdio: 'ignore' });
  let exited = false, closed = false, reader = null;
  const ready = new Set();
  child.once('exit', () => { exited = true; for (const listener of ready) listener(); });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new Error('Chrome ou Edge ne peut pas être démarré.')));
  });
  return {
    // The connection attempt remains active while waiting for the browser to
    // close and then while reading the saved session.
    isOpen: () => !closed,
    phase: () => exited ? 'verifying' : 'login',
    onReady: listener => { ready.add(listener); if (exited) queueMicrotask(listener); },
    async readSubscriptionPage({ signal } = {}) {
      if (!exited) throw Object.assign(new Error(`Termine ta connexion sur ${config.name}, puis ferme cette fenêtre Chrome ou Edge. La vérification démarrera ensuite automatiquement.`), { code: 'ACCOUNT_LOGIN_PENDING' });
      if (closed) throw new Error('La connexion a été fermée. Rouvre le compte.');
      try {
        if (!reader) reader = await (dependencies.openReader || openAccountBrowser)(dataDir, id, true, { signal });
        let result;
        for (let attempt = 0; attempt < 10; attempt++) {
          signal?.throwIfAborted();
          result = await reader.readSubscriptionPage();
          if (result.authenticated && result.windows?.length) break;
          if (attempt < 9) await delay(500, signal);
        }
        return { ...result, loginCompleted: true };
      } finally {
        // A failed/empty read must never leave an invisible browser preventing
        // the user from reopening the interactive login window.
        closed = true;
        if (reader) { await reader.close(); reader = null; }
      }
    },
    async close() {
      closed = true;
      ready.clear();
      if (reader) { await reader.close(); reader = null; }
      // Only the process started for this isolated provider can be stopped.
      if (!exited) child.kill();
    },
  };
}
module.exports = { openOllamaBrowser: dataDir => openAccountBrowser(dataDir), openSubscriptionBrowser: (dataDir, id, headless = false, options = {}) => accountConfig(id).nativeLogin && !headless ? openNativeLogin(dataDir, id) : openAccountBrowser(dataDir, id, headless, options), openNativeLogin, deleteAccountProfile, ollamaCookie };
