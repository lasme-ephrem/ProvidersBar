const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, safeStorage, dialog, Notification, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSeed } = require('./lib/seed.cjs');
const { removeUnusedProviders, removeInvalidOrcaBalances, removeImportMetadata, addAntigravity } = require('./lib/migrations.cjs');
const antigravityTransport = require('./lib/antigravity-account.cjs');
const { validatePatch, manualSnapshot, summary, daysUntil } = require('./lib/domain.cjs');
const { fetchUsage } = require('./lib/connectors.cjs');
const { connectors, connectionInfo } = require('./lib/provider-catalog.cjs');
const { ORCA_ORIGIN, fetchWallet, validateAccountRef } = require('./lib/orca-account.cjs');
const { OLLAMA_ORIGIN, SETTINGS_URL, fetchOllamaCredits } = require('./lib/ollama-account.cjs');
const { openOllamaBrowser, deleteAccountProfile } = require('./lib/account-browser.cjs');
const accountBrowser = require('./lib/account-browser.cjs');
const { createOpenAiAccount } = require('./lib/openai-account.cjs');
const openAiTransport = require('./lib/openai-account.cjs');
const { createSubscriptionController } = require('./lib/subscription-controller.cjs');

app.setName('ProvidersBar');
const dataDir = process.env.PROVIDERSBAR_DATA_DIR || (app.isPackaged ? path.join(path.dirname(process.execPath), 'data') : path.join(__dirname, '.local'));
app.setPath('userData', dataDir);
let mainWindow, quickWindow, tray, state, secrets = {}, quitting = false;
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
async function verifyAntigravity() {
  if (antigravityWork) return antigravityWork;
  antigravityWork = (async () => {
    const p = provider('antigravity');
    antigravityConnection = { status: 'verifying', message: 'Lecture des quotas dans Antigravity…' };
    p.lastAttempt = new Date().toISOString(); broadcast();
    try {
      const snapshot = await antigravityTransport.fetchAntigravityQuota();
      p.accountSession = { kind: 'antigravity-local' };
      record(p, snapshot);
      antigravityConnection = { status: 'connected', message: 'Antigravity connecté. Quotas Gemini et Claude/GPT à jour.' };
    } catch (error) {
      p.error = error.message;
      antigravityConnection = { status: 'error', message: error.message };
      throw error;
    } finally { await persist(); broadcast(); }
    return publicState();
  })();
  try { return await antigravityWork; } finally { antigravityWork = null; }
}
const isConnected = p => connectors[p.id]?.mode === 'account' ? Boolean(p.accountSession) : Boolean(secrets[p.id]);
let writeQueue = Promise.resolve();
const busy = new Map();
const announced = new Set();
const uiPath = path.join(__dirname, 'renderer', 'index.html');
const uiUrl = pathToFileURL(uiPath).href;
const subscriptionAccounts = createSubscriptionController({
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
  return { ...state, providers: state.providers.map(p => ({ ...p, connector: connectionInfo(p.id), connected: isConnected(p), syncing: busy.has(p.id), ...(p.id === 'antigravity' ? { accountConnection: antigravityConnection } : p.id === 'openai' ? { accountConnection: openAiAccount.info() } : p.id === 'orcarouter' ? { accountConnection: orcaConnection } : p.id === 'ollama' ? { accountConnection: ollamaConnection } : connectors[p.id]?.browserAccount ? { accountConnection: subscriptionAccounts.info(p.id) } : {}) })), summary: summary(state.providers), desktop: true };
}
function broadcast() {
  for (const window of [mainWindow, quickWindow]) if (window && !window.isDestroyed()) window.webContents.send('state:changed', publicState());
  if (tray) tray.setToolTip(`ProvidersBar · ${state.providers.filter(p => p.active).length} services · ${state.providers.filter(isConnected).length} connecté(s)`);
}
function provider(id) {
  const p = state.providers.find(p => p.id === id);
  if (!p) throw new Error('Service inconnu.');
  return p;
}
function record(p, snapshot) {
  p.snapshot = snapshot;
  p.error = null;
  state.history.unshift({ id: require('node:crypto').randomUUID(), providerId: p.id, ...snapshot });
  state.history = state.history.slice(0, 5000);
}
function notify() {
  if (!state.settings.notifications || !Notification.isSupported()) return;
  const today = new Date().toLocaleDateString('en-CA');
  for (const p of state.providers.filter(p => p.active)) {
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
  if (busy.has(id)) return busy.get(id);
  const p = provider(id);
  if (!isConnected(p)) throw new Error('Connecte ce service dans Connexions.');
  const work = (async () => {
    p.lastAttempt = new Date().toISOString();
    try {
      if (id === 'orcarouter') record(p, await fetchWallet(p.accountSession, orcaSession().fetch.bind(orcaSession())));
      else if (id === 'ollama') record(p, await fetchOllamaCredits(ollamaSession().fetch.bind(ollamaSession())));
      else if (id === 'openai') await openAiAccount.read(p.accountSession?.identity);
      else if (id === 'antigravity') await verifyAntigravity();
      else if (connectors[id]?.browserAccount) await subscriptionAccounts.read(id, { background: true });
      else {
        const key = safeStorage.decryptString(Buffer.from(secrets[id], 'base64'));
        record(p, await fetchUsage(id, key));
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
  await Promise.allSettled(state.providers.filter(p => p.active && isConnected(p)).map(p => syncOne(p.id)));
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
  const bounds = tray.getBounds();
  const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
  const size = quickWindow.getBounds();
  const x = Math.max(area.x, Math.min(bounds.x - size.width + bounds.width, area.x + area.width - size.width));
  const y = Math.max(area.y, Math.min(bounds.y - size.height - 8, area.y + area.height - size.height));
  quickWindow.setPosition(x, y);
  quickWindow.show(); quickWindow.focus();
}
function secureAccountWindow(window) {
  const isHttps = url => { try { return new URL(url).protocol === 'https:'; } catch { return false; } };
  window.webContents.on('will-navigate', (event, url) => { if (!isHttps(url)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!isHttps(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => isHttps(url) ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { session: window.webContents.session, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } } } : { action: 'deny' });
  window.webContents.on('did-create-window', secureAccountWindow);
}
async function openOrcaAccount() {
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
  if (ollamaBrowser?.isOpen()) return true;
  if (ollamaBrowserOpening) return ollamaBrowserOpening;
  const work = (async () => {
    if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) ollamaLoginWindow.close();
    clearInterval(ollamaDetectionTimer);
    ollamaConnection = { status: 'waiting', message: 'Connecte-toi sur Ollama dans Chrome ou Edge. ProvidersBar récupérera uniquement la session Ollama.' }; broadcast();
    if (ollamaBrowser) await ollamaBrowser.close();
    ollamaBrowser = await openOllamaBrowser(dataDir);
    let nextAttempt = 0;
    ollamaDetectionTimer = setInterval(async () => {
      if (ollamaVerification || busy.has('ollama') || Date.now() < nextAttempt) return;
      if (!ollamaBrowser?.isOpen()) { clearInterval(ollamaDetectionTimer); ollamaConnection = { status: 'idle', message: 'Navigateur fermé. Rouvre le compte pour reprendre la connexion.' }; broadcast(); return; }
      nextAttempt = Date.now() + 5000;
      await verifyOllamaAccount(true).catch(() => {});
    }, 1000);
    ollamaDetectionTimer.unref();
    return true;
  })();
  ollamaBrowserOpening = work;
  try { return await work; }
  catch (error) { ollamaConnection = { status: 'error', message: error.message }; broadcast(); throw error; }
  finally { ollamaBrowserOpening = null; }
}
async function openOllamaAccount() {
  if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) { ollamaLoginWindow.show(); ollamaLoginWindow.focus(); return true; }
  const isolated = ollamaSession();
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  if (!isolated.providersBarConfigured) { isolated.on('will-download', event => event.preventDefault()); isolated.providersBarConfigured = true; }
  ollamaLoginWindow = new BrowserWindow({ width: 1100, height: 850, title: 'Connexion au compte Ollama', parent: mainWindow,
    webPreferences: { partition: 'persist:ollama-account', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
  secureAccountWindow(ollamaLoginWindow);
  ollamaConnection = { status: 'waiting', message: 'Connecte-toi sur Ollama. Les crédits seront récupérés automatiquement.' }; broadcast();
  ollamaLoginWindow.on('closed', () => {
    ollamaLoginWindow = null; clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
    if (ollamaConnection.status === 'waiting') ollamaConnection = { status: 'idle', message: 'Fenêtre fermée. Rouvre le compte pour reprendre la connexion.' };
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
  if (ollamaVerification) { await ollamaVerification; return publicState(); }
  const p = provider('ollama');
  if (busy.has(p.id)) throw new Error('Une synchronisation Ollama est déjà en cours.');
  const work = (async () => {
    try {
      if (ollamaBrowser) {
        const cookies = await ollamaBrowser.readOllamaCookies();
        if (!cookies.length) throw Object.assign(new Error('En attente de ta connexion Ollama dans le navigateur.'), { code: 'OLLAMA_SIGNIN' });
        for (const cookie of cookies) await ollamaSession().cookies.set(cookie);
      }
      const snapshot = await fetchOllamaCredits(ollamaSession().fetch.bind(ollamaSession()));
      await ollamaSession().cookies.flushStore();
      ollamaConnection = { status: 'verifying', message: 'Crédits Ollama récupérés. Enregistrement de la session…' };
      clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
      if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) ollamaLoginWindow.close();
      if (ollamaBrowser) { const browser = ollamaBrowser; ollamaBrowser = null; await browser.close(); }
      p.accountSession = { kind: 'ollama-credits' };
      record(p, snapshot); p.lastAttempt = snapshot.updatedAt;
      await persist();
      ollamaConnection = { status: 'connected', message: 'Ollama connecté. Les crédits mensuels sont à jour.' };
      showMain();
    } catch (error) {
      if (automatic && error.code === 'OLLAMA_SIGNIN') ollamaConnection = { status: 'waiting', message: 'En attente de ta connexion sur le site officiel Ollama.' };
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
  handle('state:get', () => publicState());
  handle('orca:open-account', openOrcaAccount);
  handle('orca:verify-account', verifyOrcaAccount);
  handle('ollama:open-account', openOllamaSystemAccount);
  handle('ollama:open-email', async () => {
    clearInterval(ollamaDetectionTimer);
    if (ollamaBrowser) { const browser = ollamaBrowser; ollamaBrowser = null; await browser.close(); }
    return openOllamaAccount();
  });
  handle('ollama:verify-account', () => verifyOllamaAccount());
  handle('account:open', async id => { provider(id); return id === 'antigravity' ? verifyAntigravity() : id === 'openai' ? openAiAccount.open() : subscriptionAccounts.open(id); });
  handle('account:verify', async id => {
    provider(id);
    if (id === 'openai') await openAiAccount.read(provider(id).accountSession?.identity);
    else if (id === 'antigravity') await verifyAntigravity();
    else await subscriptionAccounts.read(id, { background: true });
    return publicState();
  });
  handle('provider:update', async (id, patch) => { Object.assign(provider(id), validatePatch(patch)); await persist(); broadcast(); return publicState(); });
  handle('provider:manual', async (id, input) => {
    const p = provider(id);
    if (isConnected(p)) throw new Error('Déconnecte la synchronisation avant de saisir un relevé manuel.');
    record(p, manualSnapshot(input)); await persist(); broadcast(); notify(); return publicState();
  });
  handle('provider:connect', async (id, key) => {
    provider(id);
    if (!Object.hasOwn(connectors, id)) throw new Error('Connecteur non disponible.');
    if (connectors[id].mode === 'account') throw new Error('Utilise la connexion au compte pour lire ses usages.');
    if (busy.has(id)) throw new Error('Une synchronisation est déjà en cours.');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Le chiffrement Windows est indisponible. La clé ne sera pas enregistrée.');
    // Validate access before replacing an existing, working credential.
    const snapshot = await fetchUsage(id, key);
    const encrypted = safeStorage.encryptString(key.trim()).toString('base64');
    secrets[id] = encrypted;
    await atomicWrite('credentials.json', secrets);
    record(provider(id), snapshot); provider(id).lastAttempt = snapshot.updatedAt;
    await persist(); broadcast(); return publicState();
  });
  handle('provider:disconnect', async id => {
    provider(id);
    if (busy.has(id)) await busy.get(id);
    if (id === 'antigravity') {
      await antigravityWork?.catch(() => {});
      delete provider(id).accountSession;
      antigravityConnection = { status: 'idle', message: '' };
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
      delete provider(id).accountSession;
      ollamaConnection = { status: 'idle', message: '' };
    }
    delete secrets[id]; await atomicWrite('credentials.json', secrets);
    provider(id).error = null; await persist(); broadcast(); return publicState();
  });
  handle('sync:all', syncAll);
  handle('sync:one', syncOne);
  handle('settings:update', async patch => {
    if (typeof patch.autoRefresh !== 'boolean' || typeof patch.notifications !== 'boolean' || !Number.isFinite(patch.lowBalance) || patch.lowBalance < 0 || patch.lowBalance > 10000) throw new Error('Réglages invalides.');
    state.settings = { autoRefresh: patch.autoRefresh, notifications: patch.notifications, lowBalance: patch.lowBalance };
    await persist(); broadcast(); return publicState();
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
    if (browsersClosed) return;
    event.preventDefault(); clearInterval(ollamaDetectionTimer);
    const browser = ollamaBrowser; ollamaBrowser = null;
    Promise.allSettled([subscriptionAccounts.closeAll(), openAiAccount.close(), browser?.close(), antigravityWork, writeQueue]).finally(() => { browsersClosed = true; app.quit(); });
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
      if (migration.changed) {
        // Keep the pre-migration inventory recoverable without changing credentials.
        await fs.writeFile(path.join(dataDir, 'state.before-subscription-removal.json'), JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 })
          .catch(error => { if (error.code !== 'EEXIST') throw error; });
        state = migration.state;
        await persist();
      }
      const orcaCorrection = removeInvalidOrcaBalances(state);
      if (orcaCorrection.changed) {
        await fs.writeFile(path.join(dataDir, 'state.before-orca-balance-fix.json'), JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 })
          .catch(error => { if (error.code !== 'EEXIST') throw error; });
        state = orcaCorrection.state;
        await persist();
      }
      try { secrets = JSON.parse(await fs.readFile(path.join(dataDir, 'credentials.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      registerIpc();
      const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false };
      mainWindow = new BrowserWindow({ width: 1360, height: 940, minWidth: 900, minHeight: 680, show: false, title: 'ProvidersBar', backgroundColor: '#101112', icon: path.join(__dirname, 'assets/icon.png'), autoHideMenuBar: true, webPreferences });
      secureWindow(mainWindow);
      mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
      mainWindow.once('ready-to-show', () => mainWindow.show());
      await mainWindow.loadFile(uiPath);
      quickWindow = new BrowserWindow({ width: 350, height: 600, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#101112', webPreferences });
      secureWindow(quickWindow);
      quickWindow.on('blur', () => quickWindow.hide());
      await quickWindow.loadFile(uiPath, { query: { mode: 'quick' } });
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png')));
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Ouvrir ProvidersBar', click: showMain }, { label: 'Synchroniser', click: () => syncAll() }, { type: 'separator' }, { label: 'Quitter', click: () => app.quit() }]));
      tray.on('click', toggleQuick); tray.on('double-click', showMain);
      broadcast();
      setInterval(() => { if (state.settings.autoRefresh) syncAll(); notify(); }, 5 * 60 * 1000).unref();
      if (state.settings.autoRefresh) syncAll();
    } catch (error) { dialog.showErrorBox('ProvidersBar ne peut pas démarrer', error.message + '\nLes fichiers existants ont été conservés.'); app.quit(); }
  });
}
