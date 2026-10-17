const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, safeStorage, dialog, Notification, session, powerMonitor } = require('electron');
const usageStrategy = require('./lib/usage-strategy.js');
const quotaResets = require('./lib/quota-resets.js');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSeed } = require('./lib/seed.cjs');
const { removeUnusedProviders, removeInvalidOrcaBalances, removeImportMetadata, addAntigravity, addClaude, normalizeProviderPresentation } = require('./lib/migrations.cjs');
const antigravityTransport = require('./lib/antigravity-account.cjs');
const { validatePatch, manualSnapshot, summary, daysUntil, isTracked, expireSubscriptions, asOllamaFreeSnapshot } = require('./lib/domain.cjs');
const { fetchUsage } = require('./lib/connectors.cjs');
const { createCredentialStore } = require('./lib/credential-store.cjs');
const { connectors, connectionInfo } = require('./lib/provider-catalog.cjs');
const { ORCA_ORIGIN, fetchWallet, validateAccountRef } = require('./lib/orca-account.cjs');
const { OLLAMA_ORIGIN, SETTINGS_URL, fetchOllamaCredits, lastKnownUsageCredits } = require('./lib/ollama-account.cjs');
const { openOllamaBrowser, deleteAccountProfile, deleteOllamaAccountProfile } = require('./lib/account-browser.cjs');
const accountBrowser = require('./lib/account-browser.cjs');
const { createOpenAiAccount } = require('./lib/openai-account.cjs');
const openAiTransport = require('./lib/openai-account.cjs');
const { createSubscriptionController } = require('./lib/subscription-controller.cjs');
const claudeDesktop = require('./lib/claude-desktop-usage.cjs');
const claudeLive = require('./lib/claude-live-usage.cjs');
const { CREDENTIAL_PATH } = require('./lib/claude-connection.cjs');
const { watchFile, unwatchFile } = require('node:fs');

app.setName('ProvidersBar');
const dataDir = process.env.PROVIDERSBAR_DATA_DIR || (app.isPackaged ? path.join(path.dirname(process.execPath), 'data') : path.join(__dirname, '.local'));
app.setPath('userData', dataDir);
let mainWindow, quickWindow, tray, state, quitting = false;
const credentials = createCredentialStore({ write: document => atomicWrite('credentials.json', document) });
const disconnecting = new Set();
// Electron uses Windows' network/proxy configuration for API connections too.
const apiFetch = (...args) => session.defaultSession.fetch(...args);
let quickDesiredHeight = 700;
let orcaLoginWindow;
let orcaDetectionTimer, orcaVerification;
let orcaConnection = { status: 'idle', message: '' };
const orcaSession = () => session.fromPartition('persist:orcarouter-account');
const ollamaSession = () => session.fromPartition('persist:ollama-account');
let ollamaLoginWindow, ollamaDetectionTimer, ollamaVerification;
let ollamaBrowser, ollamaBrowserOpening;
let ollamaConnection = { status: 'idle', message: '' };
let antigravityWork;
let antigravityConnection = { status: 'idle', message: '' };
let claudeConnection = { status: 'idle', message: '' };
let claudeWork;
let stopClaudeWatcher;
let claudeTimer;
function syncClaudeWhenDue() {
  const p = state?.providers.find(p => p.id === 'claude');
  if (quitting || !state?.settings.autoRefresh || !p || !isTracked(p) || p.accountSession?.kind !== 'claude-live-local') return;
  if (Date.parse(claudeLive.claudeLiveStatus().nextAttemptAt) > Date.now()) return;
  syncOne('claude').catch(() => {});
}
async function verifyClaudeDesktop({ enableLive = false } = {}) {
  if (disconnecting.has('claude') || quitting) throw new Error('Déconnexion en cours.');
  if (claudeWork) {
    if (!enableLive) return claudeWork;
    await claudeWork.catch(() => {});
  }
  claudeWork = (async () => {
    const p = provider('claude');
    const direct = enableLive || p.accountSession?.kind === 'claude-live-local';
    claudeConnection = { status: 'verifying', message: direct ? 'Lecture des quotas actuels auprès de Claude…' : 'Lecture du relevé local de Claude Desktop…' };
    // Keep the chosen mode even when the first request fails, including restart.
    p.accountSession = { kind: direct ? 'claude-live-local' : 'claude-desktop-local' };
    p.lastAttempt = new Date().toISOString(); broadcast();
    try {
      const snapshot = direct ? await claudeLive.readClaudeLiveUsage() : await claudeDesktop.readClaudeDesktopUsage(p.snapshot);
      p.accountSession = { kind: direct ? 'claude-live-local' : 'claude-desktop-local' };
      if (p.snapshot?.updatedAt !== snapshot.updatedAt || p.snapshot?.connectorVersion !== snapshot.connectorVersion) record(p, snapshot);
      else { p.snapshot = snapshot; p.error = null; }
      claudeConnection = { status: 'connected', message: direct ? 'Quotas Claude lus directement. Actualisation automatique chaque minute.' : 'Dernier relevé Claude Desktop récupéré. Son heure de mesure reste affichée.' };
    } catch (error) {
      p.error = error.message;
      claudeConnection = { status: 'error', message: error.message, errorCode: error.code || null };
      throw error;
    } finally {
      if (direct) {
        p.claudeSync = claudeLive.claudeLiveStatus();
        Object.assign(claudeConnection, p.claudeSync);
      }
      await persist(); broadcast();
    }
    return publicState();
  })();
  const work = claudeWork;
  try { return await work; } finally { if (claudeWork === work) claudeWork = null; }
}
async function verifyAntigravity() {
  if (disconnecting.has('antigravity') || quitting) throw new Error('Déconnexion en cours.');
  if (antigravityWork) return antigravityWork;
  antigravityWork = (async () => {
    const p = provider('antigravity');
    antigravityConnection = { status: 'verifying', message: 'Lecture des quotas dans Antigravity…' };
    p.lastAttempt = new Date().toISOString(); broadcast();
    try {
      const snapshot = await antigravityTransport.fetchAntigravityQuota();
      p.accountSession = { kind: 'antigravity-local' };
      record(p, snapshot);
      antigravityConnection = { status: 'connected', message: 'Antigravity connecté. Quotas disponibles Gemini, Claude/GPT et Argon lus.' };
    } catch (error) {
      p.error = error.message;
      antigravityConnection = { status: 'error', message: error.message };
      throw error;
    } finally { await persist(); broadcast(); }
    return publicState();
  })();
  try { return await antigravityWork; } finally { antigravityWork = null; }
}
const isConnected = p => connectors[p.id]?.mode === 'account' ? Boolean(p.accountSession) : credentials.has(p.id);
let writeQueue = Promise.resolve();
const busy = new Map();
const announced = new Set();
const uiPath = path.join(__dirname, 'renderer', 'index.html');
const uiUrl = pathToFileURL(uiPath).href;
const subscriptionAccounts = createSubscriptionController({
  getPreviousSnapshot: id => state?.providers.find(p => p.id === id)?.snapshot,
  dataDir, openBrowser: (...args) => accountBrowser.openSubscriptionBrowser(...args), deleteProfile: deleteAccountProfile, onChange: () => { if (state) broadcast(); },
  onResult: async (id, snapshot, message) => {
    const p = provider(id);
    p.accountSession = { kind: 'subscription-browser' };
    p.lastAttempt = new Date().toISOString();
    if (snapshot) record(p, snapshot);
    else p.error = message;
    await persist(); broadcast();
  },
  onFailure: async (id, message) => { const p = provider(id); p.error = message; p.lastAttempt = new Date().toISOString(); await persist(); broadcast(); },
});
const openAiAccount = createOpenAiAccount({
  rpcFactory: () => openAiTransport.openCodexRpc(),
  onChange: () => { if (state) broadcast(); },
  openExternal: url => require('electron').shell.openExternal(url),
  onResult: async (snapshot, identity) => {
    if (disconnecting.has('openai') || quitting) throw new Error('Connexion annulée.');
    const p = provider('openai');
    p.accountSession = { kind: 'openai-codex', identity };
    p.lastAttempt = new Date().toISOString(); record(p, snapshot);
    await persist(); broadcast();
  },
});

async function atomicWrite(name, data) {
  await fs.mkdir(dataDir, { recursive: true });
  const dest = path.join(dataDir, name);
  await fs.writeFile(dest + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(dest + '.tmp', dest);
}
function persist() {
  const snapshot = JSON.parse(JSON.stringify(state));
  writeQueue = writeQueue.catch(() => {}).then(() => atomicWrite('state.json', snapshot));
  return writeQueue;
}
function publicState() {
  const { history, ...visibleState } = state;
  return { ...visibleState, historyCount: history.length, historyRevision: history[0]?.id || null, providers: state.providers.map(p => ({ ...p, ...(p.id === 'ollama' && p.snapshot ? { snapshot: { ...p.snapshot, usageCredits: lastKnownUsageCredits(p.snapshot, history) } } : {}), connector: connectionInfo(p.id), connected: isConnected(p), syncing: busy.has(p.id), ...(p.id === 'antigravity' ? { accountConnection: antigravityConnection } : p.id === 'claude' ? { accountConnection: claudeConnection } : p.id === 'openai' ? { accountConnection: openAiAccount.info() } : p.id === 'orcarouter' ? { accountConnection: orcaConnection } : p.id === 'ollama' ? { accountConnection: ollamaConnection } : connectors[p.id]?.browserAccount ? { accountConnection: subscriptionAccounts.info(p.id) } : {}) })), summary: summary(state.providers), desktop: true };
}
function broadcast() {
  for (const window of [mainWindow, quickWindow]) if (window && !window.isDestroyed()) window.webContents.send('state:changed', publicState());
  if (tray) tray.setToolTip(`ProvidersBar · ${state.providers.filter(isTracked).length} services · ${state.providers.filter(isConnected).length} connecté(s)`);
}
function provider(id) {
  const p = state.providers.find(p => p.id === id);
  if (!p) throw new Error('Service inconnu.');
  return p;
}
function record(p, snapshot) {
  if (p.id === 'ollama' && p.subscriptionStatus === 'expired' && snapshot.source === 'api') snapshot = asOllamaFreeSnapshot(snapshot);
  p.snapshot = snapshot;
  p.error = null;
  state.history.unshift({ id: require('node:crypto').randomUUID(), providerId: p.id, ...snapshot });
  state.history = state.history.slice(0, 5000);
}
function assumeOllamaFree(p) {
  // "Active" is the local tracking switch, not proof of a paid Ollama plan.
  // Keep using the last provider-verified Free tier when the current settings
  // page omits its monthly section, instead of raising a false connection error.
  return p.subscriptionStatus === 'expired' || p.snapshot?.planTier === 'free';
}
function notify() {
  if (!state.settings.notifications || !Notification.isSupported()) return;
  const today = new Date().toLocaleDateString('en-CA');
  for (const p of state.providers.filter(isTracked)) {
    const messages = [];
    if (p.reviewed && p.renewalDate && daysUntil(p.renewalDate) >= 0 && daysUntil(p.renewalDate) <= 3) messages.push('Une échéance arrive dans moins de 4 jours.');
    if (p.snapshot && !p.error && Date.now() - Date.parse(p.snapshot.updatedAt) < 600000) {
      if (p.snapshot.quotaRemaining !== null && p.snapshot.quotaRemaining <= 20) messages.push('Il reste au plus 20 % de ton quota.');
      // The threshold is explicitly in USD; never compare CNY to the same threshold.
      if (p.snapshot.balances.some(b => b.currency === 'USD' && b.remaining <= state.settings.lowBalance)) messages.push(`Le solde est inférieur ou égal à ${state.settings.lowBalance} USD.`);
    }
    for (const body of messages) {
      const key = `${today}:${p.id}:${body}`;
      if (!announced.has(key)) { announced.add(key); new Notification({ title: p.name, body, icon: path.join(__dirname, 'assets/icon.png') }).show(); }
    }
  }
}
async function syncOne(id) {
  if (disconnecting.has(id)) throw new Error('Déconnexion en cours.');
  if (busy.has(id)) { await busy.get(id); return publicState(); }
  const p = provider(id);
  if (!isTracked(p)) throw new Error(p.subscriptionStatus === 'expired' ? 'Cet abonnement est expiré. Réactive-le dans sa fiche pour reprendre la synchronisation.' : 'Ce service est en pause.');
  if (!isConnected(p)) throw new Error('Connecte ce service dans Connexions.');
  const work = (async () => {
    p.lastAttempt = new Date().toISOString();
    try {
      if (id === 'orcarouter') record(p, await fetchWallet(p.accountSession, orcaSession().fetch.bind(orcaSession())));
      else if (id === 'ollama') record(p, await fetchOllamaCredits(ollamaSession().fetch.bind(ollamaSession()), new Date(), { assumeFree: assumeOllamaFree(p) }));
      else if (id === 'openai') await openAiAccount.read(p.accountSession?.identity);
      else if (id === 'antigravity') await verifyAntigravity();
      else if (id === 'claude') await verifyClaudeDesktop();
      else if (connectors[id]?.browserAccount) await subscriptionAccounts.read(id, { background: true });
      else {
        let key;
        try { key = safeStorage.decryptString(Buffer.from(credentials.get(id), 'base64')); }
        catch { throw new Error('La clé enregistrée ne peut plus être déchiffrée sur ce compte Windows. Renseigne de nouveau la clé dans Connexions.'); }
        record(p, await fetchUsage(id, key, apiFetch));
      }
    } catch (error) { p.error = error.message; }
    await persist();
    notify();
  })();
  busy.set(id, work);
  broadcast();
  try { await work; } finally { busy.delete(id); broadcast(); }
  return publicState();
}
async function syncAll() {
  await Promise.allSettled(state.providers.filter(p => isTracked(p) && isConnected(p)).map(p => syncOne(p.id)));
  return publicState();
}
function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
}
function showMain() {
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
function toggleQuick() {
  if (quickWindow.isVisible()) { quickWindow.hide(); return; }
  positionQuick();
  quickWindow.show(); quickWindow.focus();
}
function positionQuick() {
  if (!tray || !quickWindow || quickWindow.isDestroyed()) return;
  const bounds = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const size = { width: 400, height: Math.min(quickDesiredHeight, area.height - 16) };
  const x = Math.max(area.x, Math.min(bounds.x - size.width + bounds.width, area.x + area.width - size.width));
  const y = Math.max(area.y, Math.min(bounds.y - size.height - 8, area.y + area.height - size.height));
  quickWindow.setBounds({ x, y, width: size.width, height: size.height });
}
function secureAccountWindow(window) {
  const isHttps = url => { try { return new URL(url).protocol === 'https:'; } catch { return false; } };
  window.webContents.on('will-navigate', (event, url) => { if (!isHttps(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!isHttps(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => isHttps(url) ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { session: window.webContents.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } } } : { action: 'deny' });
  window.webContents.on('did-create-window', secureAccountWindow);
}
async function openOrcaAccount() {
  if (disconnecting.has('orcarouter') || quitting) throw new Error('Déconnexion en cours.');
  if (orcaLoginWindow && !orcaLoginWindow.isDestroyed()) { orcaLoginWindow.show(); orcaLoginWindow.focus(); return true; }
  const accountSession = orcaSession();
  accountSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  accountSession.setPermissionCheckHandler(() => false);
  if (!accountSession.providersBarConfigured) {
    accountSession.on('will-download', event => event.preventDefault());
    accountSession.providersBarConfigured = true;
  }
  orcaLoginWindow = new BrowserWindow({ width: 1100, height: 850, title: 'Connexion au compte OrcaRouter', parent: mainWindow,
    webPreferences: { partition: 'persist:orcarouter-account', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
  secureAccountWindow(orcaLoginWindow);
  orcaConnection = { status: 'waiting', message: 'Connecte-toi sur le site OrcaRouter. Le portefeuille sera récupéré automatiquement.' };
  broadcast();
  orcaLoginWindow.on('closed', () => {
    orcaLoginWindow = null;
    clearInterval(orcaDetectionTimer); orcaDetectionTimer = null;
    if (orcaConnection.status === 'waiting') orcaConnection = { status: 'idle', message: 'Fenêtre fermée. Rouvre le compte pour reprendre la connexion.' };
    broadcast();
  });
  try { await orcaLoginWindow.loadURL(ORCA_ORIGIN + '/console'); }
  catch { throw new Error('Le site OrcaRouter ne peut pas être ouvert. Vérifie ta connexion Internet.'); }
  let nextAttempt = 0;
  orcaDetectionTimer = setInterval(async () => {
    if (!orcaLoginWindow || orcaLoginWindow.isDestroyed() || orcaVerification || busy.has('orcarouter') || Date.now() < nextAttempt) return;
    const ref = await readOrcaAccountRef().catch(() => null);
    try { validateAccountRef(ref); } catch { return; }
    nextAttempt = Date.now() + 15000;
    await verifyOrcaAccount().catch(() => {});
  }, 1000);
  orcaDetectionTimer.unref();
  return true;
}
async function readOrcaAccountRef() {
  if (!orcaLoginWindow || orcaLoginWindow.isDestroyed() || new URL(orcaLoginWindow.webContents.getURL()).origin !== ORCA_ORIGIN) return null;
  // Only numeric account/workspace identifiers leave the remote page. Passwords,
  // tokens and cookies stay in the isolated browser session.
  return orcaLoginWindow.webContents.executeJavaScript(`(() => {
    try { const user = JSON.parse(localStorage.getItem('user') || 'null');
      return { userId: Number(user?.id), workspaceId: Number(localStorage.getItem('active_workspace_id') || user?.active_workspace_id) };
    } catch { return null; }
  })()`);
}
async function verifyOrcaAccount() {
  if (disconnecting.has('orcarouter') || quitting) throw new Error('Déconnexion en cours.');
  if (orcaVerification) { await orcaVerification; return publicState(); }
  const p = provider('orcarouter');
  if (busy.has(p.id)) throw new Error('Une synchronisation OrcaRouter est déjà en cours.');
  const work = (async () => {
    try {
      const ref = await readOrcaAccountRef();
      validateAccountRef(ref);
      orcaConnection = { status: 'verifying', message: 'Connexion détectée. Lecture du portefeuille…' };
      broadcast();
      const snapshot = await fetchWallet(ref, orcaSession().fetch.bind(orcaSession()));
      await orcaSession().cookies.flushStore();
      p.accountSession = ref;
      record(p, snapshot); p.lastAttempt = snapshot.updatedAt;
      await persist();
      orcaConnection = { status: 'connected', message: 'Connexion réussie. Le portefeuille se synchronise automatiquement.' };
      if (orcaLoginWindow && !orcaLoginWindow.isDestroyed()) orcaLoginWindow.close();
      showMain();
    } catch (error) {
      orcaConnection = { status: 'error', message: error.message };
      throw error;
    } finally { broadcast(); }
  })();
  orcaVerification = work; busy.set(p.id, work);
  try { await work; } finally { orcaVerification = null; busy.delete(p.id); broadcast(); }
  return publicState();
}
async function openOllamaSystemAccount() {
  if (disconnecting.has('ollama') || quitting) throw new Error('Déconnexion en cours.');
  if (['login', 'verifying'].includes(ollamaBrowser?.phase?.())) return true;
  if (ollamaBrowserOpening) return ollamaBrowserOpening;
  const work = (async () => {
    if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) ollamaLoginWindow.close();
    clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
    ollamaConnection = { status: 'waiting', message: 'Connecte-toi sur Ollama dans Chrome ou Edge, puis ferme cette fenêtre. La vérification démarrera ensuite.' }; broadcast();
    if (ollamaBrowser) { const browser = ollamaBrowser; ollamaBrowser = null; await browser.close(); }
    ollamaBrowser = await openOllamaBrowser(dataDir);
    ollamaDetectionTimer = setInterval(async () => {
      if (ollamaVerification || busy.has('ollama') || ollamaBrowser?.phase?.() !== 'verifying') return;
      clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
      await verifyOllamaAccount(true).catch(() => {});
    }, 750);
    ollamaDetectionTimer.unref();
    return true;
  })();
  ollamaBrowserOpening = work;
  try { return await work; }
  catch (error) { ollamaConnection = { status: 'error', message: error.message }; broadcast(); throw error; }
  finally { ollamaBrowserOpening = null; }
}
async function openOllamaAccount() {
  if (disconnecting.has('ollama') || quitting) throw new Error('Déconnexion en cours.');
  if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) { ollamaLoginWindow.show(); ollamaLoginWindow.focus(); return true; }
  const isolated = ollamaSession();
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  if (!isolated.providersBarConfigured) { isolated.on('will-download', event => event.preventDefault()); isolated.providersBarConfigured = true; }
  ollamaLoginWindow = new BrowserWindow({ width: 1100, height: 850, title: 'Connexion au compte Ollama', parent: mainWindow,
    webPreferences: { partition: 'persist:ollama-account', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
  secureAccountWindow(ollamaLoginWindow);
  ollamaConnection = { status: 'waiting', message: 'Connecte-toi sur Ollama. Les crédits seront récupérés automatiquement.' }; broadcast();
  const loginWindow = ollamaLoginWindow;
  loginWindow.on('closed', () => {
    if (ollamaLoginWindow === loginWindow) ollamaLoginWindow = null;
    if (!ollamaBrowserOpening && !ollamaBrowser) {
      clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
      if (ollamaConnection.status === 'waiting') ollamaConnection = { status: 'idle', message: 'Fenêtre fermée. Rouvre le compte pour reprendre la connexion.' };
    }
    broadcast();
  });
  let nextAttempt = 0;
  ollamaDetectionTimer = setInterval(async () => {
    if (!ollamaLoginWindow || ollamaLoginWindow.isDestroyed() || ollamaVerification || busy.has('ollama') || Date.now() < nextAttempt) return;
    let url;
    try { url = new URL(ollamaLoginWindow.webContents.getURL()); } catch { return; }
    if (url.origin !== OLLAMA_ORIGIN || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/signin')) return;
    nextAttempt = Date.now() + 15000;
    await verifyOllamaAccount(true).catch(() => {});
  }, 1000);
  ollamaDetectionTimer.unref();
  try { await ollamaLoginWindow.loadURL(SETTINGS_URL); }
  catch { ollamaConnection = { status: 'error', message: 'Le site Ollama ne peut pas être ouvert. Vérifie ta connexion Internet.' }; broadcast(); throw new Error(ollamaConnection.message); }
  return true;
}
async function verifyOllamaAccount(automatic = false) {
  if (disconnecting.has('ollama') || quitting) throw new Error('Déconnexion en cours.');
  if (ollamaVerification) { await ollamaVerification; return publicState(); }
  const p = provider('ollama');
  if (busy.has(p.id)) throw new Error('Une synchronisation Ollama est déjà en cours.');
  const work = (async () => {
    try {
      if (ollamaBrowser) {
        const cookies = await ollamaBrowser.readOllamaCookies();
        if (!cookies.length) throw Object.assign(new Error('En attente de ta connexion Ollama dans le navigateur.'), { code: 'OLLAMA_SIGNIN' });
        for (const cookie of cookies) await ollamaSession().cookies.set(cookie);
        // Save the imported login even if Ollama's usage page cannot yet be
        // parsed; otherwise a display error could discard a valid session.
        await ollamaSession().cookies.flushStore();
      }
      const snapshot = await fetchOllamaCredits(ollamaSession().fetch.bind(ollamaSession()), new Date(), { assumeFree: assumeOllamaFree(p) });
      await ollamaSession().cookies.flushStore();
      ollamaConnection = { status: 'verifying', message: 'Crédits Ollama récupérés. Enregistrement de la session…' };
      clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
      if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) ollamaLoginWindow.close();
      if (ollamaBrowser) { const browser = ollamaBrowser; ollamaBrowser = null; await browser.close(); }
      p.accountSession = { kind: 'ollama-credits' };
      record(p, snapshot); p.lastAttempt = snapshot.updatedAt;
      await persist();
      const freeLimitUnavailable = snapshot.planTier === 'free' && !snapshot.balances.length && snapshot.quotaRemaining === null;
      ollamaConnection = { status: 'connected', message: freeLimitUnavailable
        ? `Session Ollama active. ${snapshot.usageCredits ? 'Réserve supplémentaire à jour. ' : ''}Le site ne fournit pas le détail de la limite Free ; aucun montant mensuel n’est estimé.`
        : 'Ollama connecté. Les crédits mensuels sont à jour.' };
      showMain();
    } catch (error) {
      if (error.code === 'OLLAMA_LOGIN_PENDING') ollamaConnection = { status: 'waiting', message: error.message };
      else if (ollamaBrowser?.phase?.() === 'closed') {
        const browser = ollamaBrowser; ollamaBrowser = null;
        clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
        await browser.close().catch(() => {});
        ollamaConnection = { status: 'error', message: error.code === 'OLLAMA_SIGNIN' ? 'Aucune session Ollama détectée après la fermeture du navigateur. Réessaie et termine la connexion Google jusqu’au retour sur Ollama.' : error.message };
      }
      else if (automatic && error.code === 'OLLAMA_SIGNIN') ollamaConnection = { status: 'waiting', message: 'En attente de ta connexion sur le site officiel Ollama.' };
      else ollamaConnection = { status: 'error', message: error.message };
      throw error;
    }
  })();
  ollamaVerification = work; busy.set(p.id, work); broadcast();
  try { await work; } finally { ollamaVerification = null; busy.delete(p.id); broadcast(); }
  return publicState();
}
function registerIpc() {
  function handle(name, fn) {
    ipcMain.handle(name, async (event, ...args) => {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame || frame.url.split('?')[0] !== uiUrl) throw new Error('Accès refusé.');
      return fn(...args);
    });
  }
  handle('state:get', async () => {
    if (expireSubscriptions(state.providers)) { await persist(); broadcast(); }
    return publicState();
  });
  handle('history:get', () => state.history);
  handle('window:quick-size', height => {
    if (!Number.isFinite(height) || height < 100 || height > 4000 || !quickWindow || quickWindow.isDestroyed()) return;
    const area = tray ? screen.getDisplayNearestPoint(tray.getBounds()).workArea : screen.getPrimaryDisplay().workArea;
    const target = Math.round(Math.min(Math.max(240, height), 900, area.height - 16));
    if (quickDesiredHeight === target) return;
    quickDesiredHeight = target;
    if (tray) positionQuick();
    else quickWindow.setSize(400, target);
  });
  handle('provider:resets', async (id, input) => {
    const p = provider(id);
    p.manualResets = quotaResets.validate(p, input);
    await persist(); broadcast(); return publicState();
  });
  handle('strategy:update', async input => {
    state.strategy = usageStrategy.validate(input);
    await persist(); broadcast(); return publicState();
  });
  handle('orca:open-account', openOrcaAccount);
  handle('orca:verify-account', verifyOrcaAccount);
  handle('ollama:open-account', openOllamaSystemAccount);
  handle('ollama:open-email', async () => {
    clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
    if (ollamaBrowser) { const browser = ollamaBrowser; ollamaBrowser = null; await browser.close(); }
    return openOllamaAccount();
  });
  handle('ollama:verify-account', () => verifyOllamaAccount());
  handle('account:open', async id => { provider(id); if (disconnecting.has(id) || quitting) throw new Error('Déconnexion en cours.'); return id === 'antigravity' ? verifyAntigravity() : id === 'claude' ? verifyClaudeDesktop() : id === 'openai' ? openAiAccount.open() : subscriptionAccounts.open(id); });
  handle('account:verify', async id => {
    provider(id);
    if (disconnecting.has(id) || quitting) throw new Error('Déconnexion en cours.');
    if (id === 'openai') await openAiAccount.read(provider(id).accountSession?.identity);
    else if (id === 'antigravity') await verifyAntigravity();
    else if (id === 'claude') await verifyClaudeDesktop();
    else await subscriptionAccounts.read(id, { background: true, interactive: true });
    return publicState();
  });
  // Explicit activation only: never reuse a local credential on migration/startup.
  handle('claude:enable-live', async () => {
    await verifyClaudeDesktop({ enableLive: true });
    return publicState();
  });
  handle('provider:update', async (id, patch) => {
    const p = provider(id), changes = validatePatch(patch);
    if (p.type !== 'subscription' && ('subscriptionStatus' in changes || 'statusMessage' in changes)) throw new Error('Statut réservé aux abonnements.');
    if (changes.confirmRenewal && p.type !== 'subscription') throw new Error('Confirmation réservée aux abonnements.');
    if (changes.subscriptionStatus === 'active' && changes.renewalDate && daysUntil(changes.renewalDate) < 0) throw new Error('Indique une prochaine échéance future pour activer le forfait.');
    if (p.subscriptionStatus === 'expired' && changes.subscriptionStatus === 'active') {
      if (!changes.confirmRenewal || !changes.renewalDate || daysUntil(changes.renewalDate) <= 0) throw new Error('Confirme le renouvellement et indique une prochaine échéance future.');
      delete p.expiredAt;
      if (p.id === 'ollama' && p.snapshot) p.snapshot = { ...p.snapshot, balances: [], quotaRemaining: null, resetAt: null, details: [], balanceLabel: 'Crédits mensuels à vérifier' };
    }
    delete changes.confirmRenewal;
    if ('subscriptionStatus' in changes) changes.active = changes.subscriptionStatus === 'active' || (p.id === 'ollama' && changes.subscriptionStatus === 'expired');
    else if (p.type === 'subscription' && 'active' in changes) changes.subscriptionStatus = changes.active ? 'active' : 'paused';
    Object.assign(p, changes);
    if (p.id === 'ollama' && p.subscriptionStatus === 'expired') p.snapshot = asOllamaFreeSnapshot(p.snapshot);
    expireSubscriptions(state.providers);
    await persist(); broadcast(); return publicState();
  });
  handle('provider:manual', async (id, input) => {
    const p = provider(id);
    if (isConnected(p)) throw new Error('Déconnecte la synchronisation avant de saisir un relevé manuel.');
    record(p, manualSnapshot(input)); await persist(); broadcast(); notify(); return publicState();
  });
  handle('provider:connect', async (id, key) => {
    provider(id);
    if (!Object.hasOwn(connectors, id)) throw new Error('Connecteur non disponible.');
    if (connectors[id].mode === 'account') throw new Error('Utilise la connexion au compte pour lire ses usages.');
    if (busy.has(id) || disconnecting.has(id)) throw new Error('Une opération de connexion est déjà en cours.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Le chiffrement Windows est indisponible. La clé ne sera pas enregistrée.');
    // Validate access before replacing an existing, working credential.
    const work = (async () => {
      const snapshot = await fetchUsage(id, key, apiFetch);
      const encrypted = safeStorage.encryptString(key.trim()).toString('base64');
      await credentials.set(id, encrypted);
      record(provider(id), snapshot); provider(id).lastAttempt = snapshot.updatedAt;
      await persist();
    })();
    busy.set(id, work); broadcast();
    try { await work; } finally { busy.delete(id); broadcast(); }
    return publicState();
  });
  handle('provider:disconnect', async id => {
    provider(id);
    if (disconnecting.has(id)) throw new Error('Déconnexion en cours.');
    disconnecting.add(id);
    try {
      if (id === 'ollama') {
        clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
        await ollamaBrowserOpening?.catch(() => {});
      }
      if (busy.has(id)) await busy.get(id).catch(() => {});
      if (id === 'antigravity') {
        await antigravityWork?.catch(() => {});
        delete provider(id).accountSession;
        antigravityConnection = { status: 'idle', message: '' };
      }
      if (id === 'claude') {
        await claudeWork?.catch(() => {});
        claudeLive.clearClaudeLiveUsage();
        delete provider(id).accountSession;
        delete provider(id).claudeSync;
        claudeConnection = { status: 'idle', message: '' };
        await deleteAccountProfile(dataDir, id);
      }
      if (id === 'openai') { await openAiAccount.disconnect(); await subscriptionAccounts.disconnect(id); delete provider(id).accountSession; }
      if (connectors[id]?.browserAccount) {
        await subscriptionAccounts.disconnect(id);
        delete provider(id).accountSession;
      }
      if (id === 'orcarouter') {
        if (orcaLoginWindow && !orcaLoginWindow.isDestroyed()) orcaLoginWindow.close();
        await orcaSession().clearStorageData();
        delete provider(id).accountSession;
      }
      if (id === 'ollama') {
        clearInterval(ollamaDetectionTimer);
        if (ollamaBrowser) { const browser = ollamaBrowser; ollamaBrowser = null; await browser.close(); }
        if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) ollamaLoginWindow.close();
        await ollamaSession().clearStorageData();
        await deleteOllamaAccountProfile(dataDir);
        delete provider(id).accountSession;
        ollamaConnection = { status: 'idle', message: '' };
      }
      await credentials.delete(id);
      provider(id).error = null; await persist(); broadcast(); return publicState();
    } finally { disconnecting.delete(id); }
  });
  handle('sync:all', syncAll);
  handle('sync:one', syncOne);
  handle('settings:update', async patch => {
    if (typeof patch.autoRefresh !== 'boolean' || typeof patch.notifications !== 'boolean' || !Number.isFinite(patch.lowBalance) || patch.lowBalance < 0 || patch.lowBalance > 10000 || !['light', 'dark'].includes(patch.theme)) throw new Error('Réglages invalides.');
    const resumeClaude = patch.autoRefresh && !state.settings.autoRefresh;
    state.settings = { ...state.settings, autoRefresh: patch.autoRefresh, notifications: patch.notifications, lowBalance: patch.lowBalance, theme: patch.theme };
    const backgroundColor = patch.theme === 'dark' ? '#101112' : '#f2f5f0';
    for (const window of [mainWindow, quickWindow]) if (window && !window.isDestroyed()) window.setBackgroundColor(backgroundColor);
    await persist(); broadcast();
    if (resumeClaude) { claudeLive.wakeClaudeLiveUsage(); syncClaudeWhenDue(); }
    return publicState();
  });
  handle('export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Exporter mes données', defaultPath: `ProvidersBar-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Données JSON', extensions: ['json'] }] });
    if (result.canceled) return false;
    await fs.writeFile(result.filePath, JSON.stringify(state, null, 2)); return true;
  });
  handle('window:main', showMain);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) showMain(); });
  let browsersClosed = false;
  app.on('before-quit', event => {
    quitting = true;
    stopClaudeWatcher?.();
    clearInterval(claudeTimer);
    unwatchFile(CREDENTIAL_PATH);
    if (browsersClosed) return;
    event.preventDefault(); clearInterval(ollamaDetectionTimer);
    const browser = ollamaBrowser; ollamaBrowser = null;
    Promise.allSettled([subscriptionAccounts.closeAll(), openAiAccount.close(), browser?.close(), antigravityWork, claudeWork, ...busy.values()])
      .then(() => credentials.settled()).then(() => writeQueue).finally(() => { browsersClosed = true; app.quit(); });
  });
  app.whenReady().then(async () => {
    try {
      await fs.mkdir(dataDir, { recursive: true });
      try {
        state = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
        if (state.version !== 1 || !Array.isArray(state.providers) || !Array.isArray(state.history) || !state.settings) throw new Error('Format de données non reconnu.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; state = createSeed(); await persist(); }
      const importCleanup = removeImportMetadata(state);
      if (importCleanup.changed) { state = importCleanup.state; await persist(); }
      const separateGoogle = addAntigravity(state);
      if (separateGoogle.changed) { state = separateGoogle.state; await persist(); }
      const migration = removeUnusedProviders(state);
      const removedGeminiWeb = state.providers.some(p => p.id === 'gemini');
      if (migration.changed) {
        // Keep the pre-migration inventory recoverable without changing credentials.
        await fs.writeFile(path.join(dataDir, 'state.before-subscription-removal.json'), JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 })
          .catch(error => { if (error.code !== 'EEXIST') throw error; });
        state = migration.state;
        await persist();
      }
      const claudeAddition = addClaude(state);
      if (claudeAddition.changed) { state = claudeAddition.state; await persist(); }
      const presentation = normalizeProviderPresentation(state);
      if (presentation.changed) { state = presentation.state; await persist(); }
      if (expireSubscriptions(state.providers)) await persist();
      if (removedGeminiWeb) await deleteAccountProfile(dataDir, 'gemini').catch(() => console.warn('Ancien profil Gemini web verrouillé ; son suivi est désactivé.'));
      const orcaCorrection = removeInvalidOrcaBalances(state);
      if (orcaCorrection.changed) {
        await fs.writeFile(path.join(dataDir, 'state.before-orca-balance-fix.json'), JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 })
          .catch(error => { if (error.code !== 'EEXIST') throw error; });
        state = orcaCorrection.state;
        await persist();
      }
      try { credentials.load(JSON.parse(await fs.readFile(path.join(dataDir, 'credentials.json'), 'utf8'))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      registerIpc();
      const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false };
      const windowBackground = state.settings.theme === 'dark' ? '#101112' : '#f2f5f0';
      mainWindow = new BrowserWindow({ width: 1360, height: 940, minWidth: 900, minHeight: 680, show: false, title: 'ProvidersBar', backgroundColor: windowBackground, icon: path.join(__dirname, 'assets/icon.png'), autoHideMenuBar: true, webPreferences });
      secureWindow(mainWindow);
      mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
      mainWindow.once('ready-to-show', () => mainWindow.show());
      await mainWindow.loadFile(uiPath);
      quickWindow = new BrowserWindow({ width: 400, height: Math.min(700, screen.getPrimaryDisplay().workAreaSize.height - 16), show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: windowBackground, webPreferences });
      secureWindow(quickWindow);
      quickWindow.on('blur', () => quickWindow.hide());
      await quickWindow.loadFile(uiPath, { query: { mode: 'quick' } });
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png')));
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Ouvrir ProvidersBar', click: showMain }, { label: 'Synchroniser', click: () => syncAll() }, { type: 'separator' }, { label: 'Quitter', click: () => app.quit() }]));
      tray.on('click', toggleQuick); tray.on('double-click', showMain);
      broadcast();
      stopClaudeWatcher = claudeDesktop.watchClaudeDesktopUsage(() => {
        const p = state.providers.find(p => p.id === 'claude');
        if (!quitting && state.settings.autoRefresh && p && isTracked(p) && isConnected(p) && p.accountSession.kind === 'claude-desktop-local') verifyClaudeDesktop().catch(() => {});
      });
      const claude = state.providers.find(p => p.id === 'claude');
      if (claude?.accountSession?.kind === 'claude-live-local') claudeLive.restoreClaudeLiveStatus(claude.claudeSync);
      watchFile(CREDENTIAL_PATH, { interval: 2000, persistent: false }, (current, previous) => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
        claudeLive.claudeCredentialsChanged();
        syncClaudeWhenDue();
      });
      // Check the deadline rather than two independent 60-second timers, which
      // could otherwise skip a cycle because of network latency.
      claudeTimer = setInterval(syncClaudeWhenDue, 2000);
      claudeTimer.unref();
      const resumeClaude = () => { claudeLive.wakeClaudeLiveUsage(); syncClaudeWhenDue(); };
      powerMonitor.on('resume', resumeClaude);
      powerMonitor.on('unlock-screen', resumeClaude);
      setInterval(() => { if (expireSubscriptions(state.providers)) { persist().then(broadcast).catch(console.error); } }, 60 * 1000).unref();
      setInterval(() => { if (state.settings.autoRefresh) syncAll(); notify(); }, 5 * 60 * 1000).unref();
      if (state.settings.autoRefresh) syncAll();
    } catch (error) { dialog.showErrorBox('ProvidersBar ne peut pas démarrer', error.message + '\nLes fichiers existants ont été conservés.'); app.quit(); }
  });
}
