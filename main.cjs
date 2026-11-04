// Lasmium TOKENS-HUB — processus principal Electron (Windows).
// Rôle : cycle de vie (fenêtres, tray, widget, single-instance), surface IPC
// exposée par preload.cjs, orchestration des lectures via les connecteurs de
// lib/, état en mémoire et persistance (lib/data-store.cjs), durcissement des
// fenêtres (lib/window-security.cjs) et export nettoyé (lib/privacy-export.cjs).
// Les parcours d'authentification fournisseur (OrcaRouter, Ollama, Claude,
// OpenAI Codex) restent dans ce fichier ; tout le reste est délégué à lib/.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme, screen, safeStorage, dialog, Notification, session, powerMonitor } = require('electron');
const quotaResets = require('./lib/quota-resets.js');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSeed } = require('./lib/seed.cjs');
const { MAX_API_COOLDOWNS } = require('./lib/migrations.cjs');
const { createDataStore, HISTORY_LIMIT } = require('./lib/data-store.cjs');
const { createBackupManager } = require('./lib/state-backups.cjs');
const { createLogger } = require('./lib/logger.cjs');
const { secureWindow, secureAccountWindow, applyDataDirAcl, purgeLeftovers } = require('./lib/window-security.cjs');
const { sanitizeStateForExport } = require('./lib/privacy-export.cjs');
const { buildDiagnosticBundle } = require('./lib/diagnostic-bundle.cjs');
const antigravityTransport = require('./lib/antigravity-account.cjs');
const { validatePatch, manualSnapshot, summary, daysUntil, isTracked, expireSubscriptions, asOllamaFreeSnapshot } = require('./lib/domain.cjs');
const { fetchUsage } = require('./lib/connectors.cjs');
const { createCredentialStore } = require('./lib/credential-store.cjs');
const { connectors, connectionInfo } = require('./lib/provider-catalog.cjs');
const { ORCA_ORIGIN, fetchWallet, validateAccountRef, resetOrcaRateLimit } = require('./lib/orca-account.cjs');
const { OLLAMA_ORIGIN, SETTINGS_URL, fetchOllamaCredits, lastKnownUsageCredits, resetOllamaRateLimit } = require('./lib/ollama-account.cjs');
const { openOllamaBrowser, deleteAccountProfile, deleteOllamaAccountProfile } = require('./lib/account-browser.cjs');
const accountBrowser = require('./lib/account-browser.cjs');
const { createOpenAiAccount } = require('./lib/openai-account.cjs');
const openAiTransport = require('./lib/openai-account.cjs');
const { createSubscriptionController } = require('./lib/subscription-controller.cjs');
const { assertSnapshot, healthSuccess, healthFailure, publicHealth, strategyFor, breakerOpen } = require('./lib/connector-contract.cjs');
const { loadPacks, packFor, packSummary } = require('./lib/connector-packs.cjs');
const claudeDesktop = require('./lib/claude-desktop-usage.cjs');
const claudeLive = require('./lib/claude-live-usage.cjs');
const { CREDENTIAL_PATH } = require('./lib/claude-connection.cjs');
const { watchFile, unwatchFile } = require('node:fs');

app.setName('Lasmium TOKENS-HUB');
// Identité stable des notifications Windows (toasts), indépendante du raccourci
// que l'utilisateur a éventuellement créé pour l'application.
if (process.platform === 'win32') app.setAppUserModelId('com.lasmium.tokenshub');
const dataDir = (process.env.LASMIUM_DATA_DIR || process.env.PROVIDERSBAR_DATA_DIR) || (app.isPackaged ? path.join(path.dirname(process.execPath), 'data') : path.join(__dirname, '.local'));
app.setPath('userData', dataDir);
const store = createDataStore({ dataDir });
const logger = createLogger({ dataDir });
const backups = createBackupManager({ dataDir, logger });
// Origines autorisées dans les fenêtres de connexion Electron. Seules les deux
// fenêtres internes (OrcaRouter, Ollama) utilisent cette liste ; Claude, Grok,
// Z.ai et OpenAI s'authentifient dans un Chrome/Edge externe ou via Codex.
// `orcarouter.ai` sans www couvre une éventuelle redirection canonique du site.
const ACCOUNT_ORIGINS = [...new Set([
  OLLAMA_ORIGIN, ORCA_ORIGIN, ORCA_ORIGIN.replace('://www.', '://'), 'https://accounts.google.com',
])];
// Mode diagnostic (`verify:connections`, `update:portable`) : Chromium écrit
// data/DevToolsActivePort et un autre processus peut s'en servir. La purge doit
// donc laisser ce fichier intact tant que ce processus tourne.
const diagnosticMode = process.argv.some(argument => argument.startsWith('--remote-debugging-port'));
let mainWindow, quickWindow, tray, state, quitting = false;
const credentials = createCredentialStore({ write: document => store.atomicWrite('credentials.json', document) });
const disconnecting = new Set();
// Electron uses Windows' network/proxy configuration for API connections too.
const apiFetch = (...args) => session.defaultSession.fetch(...args);
// Cooldowns 429 des clés API : store synchrone exigé par fetchUsage, adossé à
// state.apiCooldowns (persisté, plafonné à 100 entrées) pour survivre au
// redémarrage. Ne duplique pas la logique Ollama/Orca, qui vivent dans leur lib.
const cooldowns = {
  get(fingerprint) {
    const until = state?.apiCooldowns?.[fingerprint];
    return Number.isFinite(until) ? until : undefined;
  },
  set(fingerprint, untilMs) {
    if (!state || typeof fingerprint !== 'string' || !Number.isFinite(untilMs) || untilMs <= 0) return;
    if (!state.apiCooldowns || typeof state.apiCooldowns !== 'object' || Array.isArray(state.apiCooldowns)) state.apiCooldowns = {};
    state.apiCooldowns[fingerprint] = untilMs;
    const entries = Object.entries(state.apiCooldowns);
    if (entries.length > MAX_API_COOLDOWNS) {
      entries.sort((a, b) => b[1] - a[1]);
      state.apiCooldowns = Object.fromEntries(entries.slice(0, MAX_API_COOLDOWNS));
    }
    // Un 429 est rare : écrire tout de suite évite de dépendre du cycle suivant.
    persist().catch(() => {});
  },
  prune(nowMs) {
    const entries = state?.apiCooldowns;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
    for (const [fingerprint, until] of Object.entries(entries)) if (!(until > nowMs)) delete entries[fingerprint];
  },
};
// Lecture directe Claude : instance unique du lecteur, transport Windows
// (session.defaultSession.fetch) partagé avec les appels API. Le renouvellement
// OAuth est créé par la même factory, donc sans globalThis.fetch.
const claudeReader = claudeLive.createClaudeLiveReader({ fetchImpl: apiFetch });
let quickDesiredHeight = 660;
let connectorPacks = new Map();
let connectorPackErrors = [];
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
  if (Date.parse(claudeReader.info().nextAttemptAt) > Date.now()) return;
  syncOne('claude', { force: false }).catch(() => {});
}
// Repli explicite Claude Desktop : décision pure, sans dépendance Electron
// (testée par tests/claude-desktop-usage.test.cjs). La lecture directe peut être
// remplacée quand elle est bloquée par un 429 ou un problème d'authentification
// ET que le dernier relevé direct est absent ou périmé (> 10 min, seuil de
// fraîcheur de l'interface) : un relevé périmé n'a rien de valable à préserver.
function shouldFallbackToClaudeDesktop(code, snapshot, nowMs = Date.now()) {
  const updatedAt = Date.parse(snapshot?.updatedAt);
  if (Number.isFinite(updatedAt) && nowMs - updatedAt <= 10 * 60 * 1000) return false;
  if (typeof code !== 'string' || !code) return false;
  // `rate-limit` (quota ou renouvellement limité) et tous les codes `auth-*`,
  // y compris `auth-rate-limit` renvoyé par le renouvellement OAuth.
  return code === 'rate-limit' || code.startsWith('auth-');
}
function claudeDesktopGuidance() {
  return 'Ouvre Claude Desktop (page Utilisation) pour actualiser le relevé ; la lecture directe reprendra après renouvellement du jeton dans Claude Code.';
}
async function verifyClaudeDesktop({ enableLive = false, manual = false } = {}) {
  if (disconnecting.has('claude') || quitting) throw new Error('Déconnexion en cours.');
  if (claudeWork) {
    if (!enableLive) return claudeWork;
    await claudeWork.catch(() => {});
  }
  claudeWork = (async () => {
    const p = provider('claude');
    const direct = enableLive || p.accountSession?.kind === 'claude-live-local';
    // Action explicite (bouton Vérifier / Connexion) : une reconnexion Claude Code
    // doit pouvoir être prise en compte sans attendre le cooldown d'un échec passé.
    if (manual && direct) claudeReader.credentialsChanged();
    claudeConnection = { status: 'verifying', message: direct ? 'Lecture des quotas actuels auprès de Claude…' : 'Lecture du relevé local de Claude Desktop…' };
    // Keep the chosen mode even when the first request fails, including restart.
    p.accountSession = { kind: direct ? 'claude-live-local' : 'claude-desktop-local' };
    p.lastAttempt = new Date().toISOString(); broadcast();
    try {
      const snapshot = direct ? await claudeReader.read() : await claudeDesktop.readClaudeDesktopUsage(p.snapshot);
      p.accountSession = { kind: direct ? 'claude-live-local' : 'claude-desktop-local' };
      if (p.snapshot?.updatedAt !== snapshot.updatedAt || p.snapshot?.connectorVersion !== snapshot.connectorVersion) record(p, snapshot);
      else { p.snapshot = snapshot; p.error = null; markHealthSuccess(p, snapshot); }
      claudeConnection = { status: 'connected', message: direct ? 'Quotas Claude lus directement. Actualisation automatique chaque minute.' : 'Dernier relevé Claude Desktop récupéré. Son heure de mesure reste affichée.' };
    } catch (error) {
      const blocked = direct && shouldFallbackToClaudeDesktop(error.code, p.snapshot);
      if (blocked) {
        // Bascule explicite et annoncée : le relevé direct est inutilisable et
        // absent/périmé. On ne change de mode qu'une fois un relevé Desktop
        // réellement lu : sans donnée à afficher, on conserve le mode direct et
        // son cooldown (aucune oscillation), avec une consigne actionnable.
        const previousSession = p.accountSession;
        try {
          const snapshot = await claudeDesktop.readClaudeDesktopUsage(p.snapshot, { allowStale: true });
          p.accountSession = { kind: 'claude-desktop-local' };
          record(p, snapshot);
          p.claudeSync = claudeReader.info();
          claudeConnection = { status: 'connected', message: snapshot.stale
            ? 'Lecture directe indisponible (renouvellement du jeton Claude Code limité) ; Lasmium TOKENS-HUB utilise le dernier relevé Claude Desktop connu (relevé ancien).'
            : 'Lecture directe indisponible (renouvellement du jeton Claude Code limité) ; Lasmium TOKENS-HUB utilise le relevé Claude Desktop.' };
          return publicState();
        } catch {
          // Relevé Desktop aussi indisponible : conserver mode, snapshot et
          // cooldown (écrit par le `finally`) et fournir une consigne actionnable.
          p.accountSession = previousSession;
          const failure = new Error(`${error.message} ${claudeDesktopGuidance()}`);
          failure.code = error.code;
          p.error = failure.message;
          markHealthFailure(p, failure);
          claudeConnection = { status: 'error', message: failure.message, errorCode: failure.code || null };
          throw failure;
        }
      }
      p.error = error.message;
      markHealthFailure(p, error);
      claudeConnection = { status: 'error', message: error.message, errorCode: error.code || null };
      throw error;
    } finally {
      if (direct) {
        p.claudeSync = claudeReader.info();
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
      markHealthFailure(p, error);
      antigravityConnection = { status: 'error', message: error.message };
      throw error;
    } finally { await persist(); broadcast(); }
    return publicState();
  })();
  try { return await antigravityWork; } finally { antigravityWork = null; }
}
const isConnected = p => connectors[p.id]?.mode === 'account' ? Boolean(p.accountSession) : credentials.has(p.id);
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
    else {
      p.error = message;
      markHealthFailure(p, Object.assign(new Error(message || 'Aucun relevé.'), { code: 'PARSER_EMPTY' }));
    }
    await persist(); broadcast();
  },
  onFailure: async (id, message) => { const p = provider(id); p.error = message; p.lastAttempt = new Date().toISOString(); markHealthFailure(p, new Error(message)); await persist(); broadcast(); },
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

function persist() {
  // La copie de sécurité est faite avant l'écriture, au plus toutes les 6 h ;
  // une erreur de sauvegarde ne doit jamais empêcher la persistance.
  return backups.maybeBackup().catch(error => { logger.warn(`Sauvegarde d’état : ${error.message}`); })
    .then(() => store.persist(state));
}
function appInfo() {
  return {
    version: app.getVersion(),
    electron: process.versions.electron || null,
    platform: process.platform,
    dataDir,
    packaged: app.isPackaged,
  };
}
// Version minimale exposée dans publicState() : aucun chemin absolu.
function publicAppInfo() {
  return { version: app.getVersion(), electron: process.versions.electron || null, packaged: app.isPackaged };
}
// `system` suit le thème Windows ; ce fond de fenêtre n'a qu'un rôle visuel, le
// thème CSS étant appliqué par le renderer.
function windowBackgroundFor(theme) {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#101112' : '#f2f5f0';
}
function publicState() {
  const { history, ...visibleState } = state;
  // L'ordre de consommation a été retiré : aucun `strategy` n'est exposé.
  delete visibleState.strategy;
  return { ...visibleState, app: publicAppInfo(), connectorPacks: packSummary(connectorPacks), connectorPackErrors: connectorPackErrors.map(({ file, provider, reason }) => ({ file, provider: provider || null, reason })), historyCount: history.length, historyRevision: history[0]?.id || null, providers: state.providers.map(p => ({ ...p, ...(p.id === 'ollama' && p.snapshot ? { snapshot: { ...p.snapshot, usageCredits: lastKnownUsageCredits(p.snapshot, history) } } : {}), connector: connectionInfo(p.id), connected: isConnected(p), syncing: busy.has(p.id), health: publicHealth(state.connectorHealth?.[p.id], p.snapshot), ...(p.id === 'antigravity' ? { accountConnection: antigravityConnection } : p.id === 'claude' ? { accountConnection: claudeConnection } : p.id === 'openai' ? { accountConnection: openAiAccount.info() } : p.id === 'orcarouter' ? { accountConnection: orcaConnection } : p.id === 'ollama' ? { accountConnection: ollamaConnection } : connectors[p.id]?.browserAccount ? { accountConnection: subscriptionAccounts.info(p.id) } : {}) })), summary: summary(state.providers), desktop: true };
}
async function loadConnectorPacks() {
  try {
    const publicKey = await fs.readFile(path.join(__dirname, 'lib', 'connector-packs-public.pem'), 'utf8');
    const result = await loadPacks({
      dirs: [path.join(__dirname, 'assets', 'connector-packs'), path.join(dataDir, 'connector-packs')],
      publicKey,
      appVersion: app.getVersion(),
      providers: Object.keys(connectors),
      // Un pack local non signé n'est accepté qu'en développement explicite.
      allowUnsigned: !app.isPackaged && process.env.LASMIUM_ALLOW_UNSIGNED_PACKS === '1',
    });
    connectorPacks = result.packs;
    connectorPackErrors = result.errors;
  } catch (error) {
    connectorPacks = new Map();
    connectorPackErrors = [{ file: 'connector-packs', provider: null, reason: error.message }];
  }
}
function broadcast() {
  for (const window of [mainWindow, quickWindow]) if (window && !window.isDestroyed()) window.webContents.send('state:changed', publicState());
  if (tray) tray.setToolTip(`Lasmium TOKENS-HUB · ${state.providers.filter(isTracked).length} services · ${state.providers.filter(isConnected).length} connecté(s)`);
}
function provider(id) {
  const p = state.providers.find(p => p.id === id);
  if (!p) throw new Error('Service inconnu.');
  return p;
}
function record(p, snapshot) {
  if (p.id === 'ollama' && p.subscriptionStatus === 'expired' && snapshot.source === 'api') snapshot = asOllamaFreeSnapshot(snapshot);
  // Valider AVANT de toucher au dernier relevé : une réponse valide HTTP mais
  // illisible ne doit jamais remplacer un relevé sain ni afficher un faux zéro.
  assertSnapshot(p.id, snapshot);
  p.snapshot = snapshot;
  p.error = null;
  state.connectorHealth = state.connectorHealth || {};
  state.connectorHealth[p.id] = healthSuccess(state.connectorHealth[p.id], {
    providerId: p.id,
    strategy: strategyFor(p, connectors),
    snapshot,
  });
  state.history.unshift({ id: require('node:crypto').randomUUID(), providerId: p.id, ...snapshot });
  state.history = state.history.slice(0, HISTORY_LIMIT);
}
function markHealthSuccess(p, snapshot) {
  state.connectorHealth = state.connectorHealth || {};
  state.connectorHealth[p.id] = healthSuccess(state.connectorHealth[p.id], {
    providerId: p.id,
    strategy: strategyFor(p, connectors),
    snapshot,
  });
}
function markHealthFailure(p, error) {
  state.connectorHealth = state.connectorHealth || {};
  state.connectorHealth[p.id] = healthFailure(state.connectorHealth[p.id], {
    providerId: p.id,
    strategy: strategyFor(p, connectors),
    error,
  });
  const failure = state.connectorHealth[p.id].error;
  if (failure) logger.warn(`Connecteur ${p.id} (${failure.code}) : ${failure.message}`);
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
      if ((p.snapshot.balances ?? []).some(b => b.currency === 'USD' && b.remaining <= state.settings.lowBalance)) messages.push(`Le solde est inférieur ou égal à ${state.settings.lowBalance} USD.`);
    }
    for (const body of messages) {
      const key = `${today}:${p.id}:${body}`;
      if (!announced.has(key)) { announced.add(key); new Notification({ title: p.name, body, icon: path.join(__dirname, 'assets/icon.png') }).show(); }
    }
  }
}
async function syncOne(id, { force = true } = {}) {
  if (disconnecting.has(id)) throw new Error('Déconnexion en cours.');
  if (busy.has(id)) { await busy.get(id); return publicState(); }
  const p = provider(id);
  if (!isTracked(p)) throw new Error(p.subscriptionStatus === 'expired' ? 'Cet abonnement est expiré. Réactive-le dans sa fiche pour reprendre la synchronisation.' : 'Ce service est en pause.');
  if (!isConnected(p)) throw new Error('Connecte ce service dans Connexions.');
  // Disjoncteur : après une panne transitoire, ne pas marteler le fournisseur.
  // Une action manuelle (« Tester ») force une tentative immédiate.
  if (!force && breakerOpen(state.connectorHealth?.[id])) {
    return publicState();
  }
  const work = (async () => {
    p.lastAttempt = new Date().toISOString();
    try {
      cooldowns.prune(Date.now());
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
        record(p, await fetchUsage(id, key, apiFetch, { cooldowns, endpoint: packFor(connectorPacks, id)?.endpoint }));
      }
    } catch (error) {
      p.error = error.message;
      markHealthFailure(p, error);
      // Session explicitement invalide : repasser « non connecté » pour que la
      // prochaine action soit une reconnexion, pas une boucle d'échecs.
      if (id === 'orcarouter' && error.code === 'ORCA_AUTH') delete p.accountSession;
      if (id === 'ollama' && error.code === 'OLLAMA_SIGNIN') delete p.accountSession;
    }
    await persist();
    notify();
  })();
  busy.set(id, work);
  broadcast();
  try { await work; } finally { busy.delete(id); broadcast(); }
  return publicState();
}
async function syncAll({ force = false } = {}) {
  await Promise.allSettled(state.providers.filter(p => isTracked(p) && isConnected(p)).map(p => syncOne(p.id, { force })));
  return publicState();
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
  const size = { width: 360, height: Math.min(quickDesiredHeight, area.height - 16) };
  const x = Math.max(area.x, Math.min(bounds.x - size.width + bounds.width, area.x + area.width - size.width));
  const y = Math.max(area.y, Math.min(bounds.y - size.height - 8, area.y + area.height - size.height));
  quickWindow.setBounds({ x, y, width: size.width, height: size.height });
}
async function openOrcaAccount() {
  if (disconnecting.has('orcarouter') || quitting) throw new Error('Déconnexion en cours.');
  if (orcaLoginWindow && !orcaLoginWindow.isDestroyed()) { orcaLoginWindow.show(); orcaLoginWindow.focus(); return true; }
  const accountSession = orcaSession();
  accountSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  accountSession.setPermissionCheckHandler(() => false);
  if (!accountSession.lasmiumConfigured) {
    accountSession.on('will-download', event => event.preventDefault());
    accountSession.lasmiumConfigured = true;
  }
  orcaLoginWindow = new BrowserWindow({ width: 1100, height: 850, title: 'Connexion au compte OrcaRouter', parent: mainWindow,
    webPreferences: { partition: 'persist:orcarouter-account', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
  secureAccountWindow(orcaLoginWindow, ACCOUNT_ORIGINS);
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
// Origines acceptées pour la fenêtre de compte OrcaRouter : le site canonique
// (www) et sa redirection sans www. La fenêtre est déjà contrainte par
// `secureAccountWindow` ; cette liste ne sert qu'à décider si le localStorage
// peut être lu pour récupérer les identifiants numériques.
const ORCA_ACCOUNT_ORIGINS = new Set([ORCA_ORIGIN, ORCA_ORIGIN.replace('://www.', '://')]);

// Décision pure (aucune dépendance Electron, testée hors application) : la ref
// persistée suffit à vérifier une session existante sans fenêtre. Celle de la
// fenêtre n'est retenue que si elle est valide et différente (connexion neuve ou
// changement de compte / espace de travail).
function chooseOrcaAccountRef(stored, fromWindow) {
  const valid = ref => Boolean(ref) && Number.isSafeInteger(ref.userId) && ref.userId > 0
    && Number.isSafeInteger(ref.workspaceId) && ref.workspaceId > 0;
  const windowRef = valid(fromWindow) ? fromWindow : null;
  const storedRef = valid(stored) ? stored : null;
  if (windowRef && (!storedRef || windowRef.userId !== storedRef.userId || windowRef.workspaceId !== storedRef.workspaceId)) return windowRef;
  return storedRef || windowRef || null;
}
async function readOrcaAccountRef() {
  if (!orcaLoginWindow || orcaLoginWindow.isDestroyed()) return null;
  let origin;
  try { origin = new URL(orcaLoginWindow.webContents.getURL()).origin; } catch { return null; }
  if (!ORCA_ACCOUNT_ORIGINS.has(origin)) return null;
  // Only numeric account/workspace identifiers leave the remote page. Passwords,
  // tokens and cookies stay in the isolated browser session.
  return orcaLoginWindow.webContents.executeJavaScript(`(() => {
    try { const user = JSON.parse(localStorage.getItem('user') || 'null');
      return { userId: Number(user?.id), workspaceId: Number(localStorage.getItem('active_workspace_id') || user?.active_workspace_id) };
    } catch { return null; }
  })()`).catch(() => null);
}
async function verifyOrcaAccount() {
  if (disconnecting.has('orcarouter') || quitting) throw new Error('Déconnexion en cours.');
  if (orcaVerification) { await orcaVerification; return publicState(); }
  const p = provider('orcarouter');
  if (busy.has(p.id)) throw new Error('Une synchronisation OrcaRouter est déjà en cours.');
  const work = (async () => {
    try {
      // Une session persistée valide se vérifie directement : la fenêtre de
      // connexion n'est pas requise (elle ne sert qu'à une connexion neuve ou à
      // un changement de compte / espace de travail).
      const fromWindow = await readOrcaAccountRef();
      const ref = chooseOrcaAccountRef(p.accountSession, fromWindow);
      validateAccountRef(ref);
      orcaConnection = { status: 'verifying', message: 'Lecture du portefeuille OrcaRouter…' };
      // Session écrite AVANT la première lecture : un 429 ou une panne transitoire
      // ne doit pas faire croire à une déconnexion (reprise au cycle de 5 minutes).
      const previous = p.accountSession;
      if (previous?.userId !== ref.userId || previous?.workspaceId !== ref.workspaceId) { p.accountSession = ref; await persist(); }
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
      // ORCA_AUTH : la session n'est plus valable, l'UI repasse non connectée et
      // le message invite à reconnecter. ORCA_RATE_LIMIT / ORCA_TRANSIENT :
      // session conservée, dernier relevé intact, réessai automatique annoncé.
      if (error.code === 'ORCA_AUTH') delete p.accountSession;
      // Session acceptée mais lecture transitoire : la fenêtre de connexion a
      // rempli son rôle, la reprise se fera en arrière-plan.
      else if (orcaLoginWindow && !orcaLoginWindow.isDestroyed()) orcaLoginWindow.close();
      if (error.code === 'ORCA_RATE_LIMIT' || error.code === 'ORCA_TRANSIENT') {
        error.message = `${error.message} Réessai automatique au prochain cycle d’actualisation.`;
      }
      p.error = error.message;
      markHealthFailure(p, error);
      await persist();
      orcaConnection = { status: 'error', message: error.message, errorCode: error.code || null };
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
  if (!isolated.lasmiumConfigured) { isolated.on('will-download', event => event.preventDefault()); isolated.lasmiumConfigured = true; }
  ollamaLoginWindow = new BrowserWindow({ width: 1100, height: 850, title: 'Connexion au compte Ollama', parent: mainWindow,
    webPreferences: { partition: 'persist:ollama-account', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: false } });
  secureAccountWindow(ollamaLoginWindow, ACCOUNT_ORIGINS);
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
      // Session écrite AVANT la première lecture : un 429 ou une panne transitoire
      // ne doit pas faire croire à une déconnexion (reprise au cycle de 5 minutes).
      if (p.accountSession?.kind !== 'ollama-credits') { p.accountSession = { kind: 'ollama-credits' }; await persist(); }
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
      const code = error.code || null;
      markHealthFailure(p, error);
      if (code === 'OLLAMA_LOGIN_PENDING') ollamaConnection = { status: 'waiting', message: error.message };
      else if (code === 'OLLAMA_SIGNIN' && ollamaBrowser?.phase?.() === 'closed') {
        const browser = ollamaBrowser; ollamaBrowser = null;
        clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
        await browser.close().catch(() => {});
        delete p.accountSession;
        p.error = error.message;
        await persist();
        ollamaConnection = { status: 'error', message: 'Aucune session Ollama détectée après la fermeture du navigateur. Réessaie et termine la connexion Google jusqu’au retour sur Ollama.' };
      }
      else if (code === 'OLLAMA_SIGNIN') {
        // Session refusée : repasser non connecté pour demander une reconnexion.
        delete p.accountSession;
        p.error = error.message;
        await persist();
        ollamaConnection = automatic
          ? { status: 'waiting', message: 'En attente de ta connexion sur le site officiel Ollama.' }
          : { status: 'error', message: error.message, errorCode: code };
      }
      else {
        // OLLAMA_RATE_LIMIT / OLLAMA_TRANSIENT (format inclus) : session valide
        // conservée avec le dernier relevé, réessai au cycle suivant. Le
        // navigateur éventuellement ouvert n'est pas fermé.
        p.error = error.message;
        await persist();
        ollamaConnection = { status: 'error', message: error.message, errorCode: code };
      }
      throw error;
    }
  })();
  ollamaVerification = work; busy.set(p.id, work); broadcast();
  try { await work; } finally { ollamaVerification = null; busy.delete(p.id); broadcast(); }
  return publicState();
}
// Caches et sessions Chromium recréés au besoin : effacés avec les données.
const ERASABLE_CACHE_ENTRIES = Object.freeze([
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Shared Dictionary',
  'DIPS', 'Local Storage', 'Session Storage', 'Network', 'blob_storage', 'WebStorage',
  'Service Worker', 'Partitions', 'Local State', 'Preferences', 'DevToolsActivePort',
  'declarative_performance_observer.db', 'declarative_performance_observer.db-journal',
]);

// Effacement complet demandé par l'utilisateur (après double confirmation côté
// UI) : sessions, identifiants, profils, caches puis inventaire initial.
async function eraseAllData() {
  if (quitting) throw new Error('Arrêt en cours.');
  if (disconnecting.size || busy.size) throw new Error('Attends la fin des synchronisations avant d’effacer les données.');
  // Aucune écriture en attente ne doit pouvoir recréer un fichier effacé.
  await Promise.allSettled([store.settle(), credentials.settled()]);
  clearInterval(orcaDetectionTimer); orcaDetectionTimer = null;
  clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
  for (const window of [orcaLoginWindow, ollamaLoginWindow]) {
    try { if (window && !window.isDestroyed()) window.close(); } catch { /* déjà fermée */ }
  }
  orcaLoginWindow = null;
  ollamaLoginWindow = null;
  const browser = ollamaBrowser;
  ollamaBrowser = null;
  await Promise.allSettled([
    subscriptionAccounts.closeAll(), openAiAccount.close(), browser?.close?.(), antigravityWork, claudeWork,
  ].map(item => Promise.resolve(item).catch(() => {})));
  await Promise.allSettled([orcaSession().clearStorageData(), ollamaSession().clearStorageData()]);
  await credentials.load({});
  claudeReader.clear();
  // Cooldowns mémoire Ollama/Orca : un effacement complet ne doit pas laisser
  // l'utilisateur bloqué 60 s sur des compteurs qu'il vient de réinitialiser.
  resetOllamaRateLimit();
  resetOrcaRateLimit();
  announced.clear();
  orcaConnection = { status: 'idle', message: '' };
  ollamaConnection = { status: 'idle', message: '' };
  antigravityConnection = { status: 'idle', message: '' };
  claudeConnection = { status: 'idle', message: '' };
  await Promise.allSettled([
    store.remove('state.json'),
    store.remove('credentials.json'),
    store.remove('account-browsers'),
    store.remove('temporary-account-browsers'),
    store.remove('state.before-subscription-removal.json'),
    store.remove('state.before-orca-balance-fix.json'),
    ...ERASABLE_CACHE_ENTRIES.map(name => store.remove(name)),
  ]);
  await purgeLeftovers(dataDir, {
    preserveDevToolsPort: diagnosticMode,
    sweepTemporaryProfiles: typeof accountBrowser.sweepTemporaryProfiles === 'function' ? accountBrowser.sweepTemporaryProfiles : null,
  });
  state = createSeed();
  await store.persist(state);
  broadcast();
  return true;
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
    else quickWindow.setSize(360, target);
  });
  handle('provider:resets', async (id, input) => {
    const p = provider(id);
    p.manualResets = quotaResets.validate(p, input);
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
  handle('account:open', async id => { provider(id); if (disconnecting.has(id) || quitting) throw new Error('Déconnexion en cours.'); return id === 'antigravity' ? verifyAntigravity() : id === 'claude' ? verifyClaudeDesktop({ manual: true }) : id === 'openai' ? openAiAccount.open() : id === 'orcarouter' ? openOrcaAccount() : id === 'ollama' ? openOllamaAccount() : subscriptionAccounts.open(id); });
  handle('account:verify', async id => {
    provider(id);
    if (disconnecting.has(id) || quitting) throw new Error('Déconnexion en cours.');
    try {
      if (id === 'openai') await openAiAccount.read(provider(id).accountSession?.identity);
      else if (id === 'antigravity') await verifyAntigravity();
      else if (id === 'claude') await verifyClaudeDesktop({ manual: true });
      else if (id === 'orcarouter') await verifyOrcaAccount();
      else if (id === 'ollama') await verifyOllamaAccount();
      else await subscriptionAccounts.read(id, { background: true, interactive: true });
    } catch (error) {
      // Les connecteurs dédiés enregistrent déjà leur santé ; ce filet couvre
      // OpenAI/Codex et toute erreur remontée avant leur propre catch.
      markHealthFailure(provider(id), error);
      await persist(); broadcast();
      throw error;
    }
    return publicState();
  });
  // Explicit activation only: never reuse a local credential on migration/startup.
  handle('claude:enable-live', async () => {
    await verifyClaudeDesktop({ enableLive: true, manual: true });
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
      const snapshot = await fetchUsage(id, key, apiFetch, { cooldowns, endpoint: packFor(connectorPacks, id)?.endpoint });
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
        claudeReader.clear();
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
  handle('sync:all', () => syncAll({ force: true }));
  handle('sync:one', (id, options = {}) => syncOne(id, { force: options?.force !== false }));
  handle('settings:update', async patch => {
    if (typeof patch.autoRefresh !== 'boolean' || typeof patch.notifications !== 'boolean' || !Number.isFinite(patch.lowBalance) || patch.lowBalance < 0 || patch.lowBalance > 10000 || !['light', 'dark', 'system'].includes(patch.theme)) throw new Error('Réglages invalides.');
    const resumeClaude = patch.autoRefresh && !state.settings.autoRefresh;
    state.settings = { ...state.settings, autoRefresh: patch.autoRefresh, notifications: patch.notifications, lowBalance: patch.lowBalance, theme: patch.theme };
    const backgroundColor = windowBackgroundFor(patch.theme);
    for (const window of [mainWindow, quickWindow]) if (window && !window.isDestroyed()) window.setBackgroundColor(backgroundColor);
    await persist(); broadcast();
    if (resumeClaude) { claudeReader.wake(); syncClaudeWhenDue(); }
    return publicState();
  });
  handle('export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Exporter mes données', defaultPath: `Lasmium TOKENS-HUB-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Données JSON', extensions: ['json'] }] });
    if (result.canceled) return false;
    // Export nettoyé : ni session, ni identité, ni empreinte de clé (contrat §3.5).
    const document = sanitizeStateForExport(state, { version: app.getVersion() });
    await fs.writeFile(result.filePath, JSON.stringify(document, null, 2)); return true;
  });
  handle('diagnostic', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter un diagnostic',
      defaultPath: `Lasmium-diagnostic-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Diagnostic JSON', extensions: ['json'] }],
    });
    if (result.canceled) return false;
    const bundle = buildDiagnosticBundle({
      app: { name: app.getName(), version: app.getVersion(), electron: process.versions.electron, packaged: app.isPackaged },
      state: { ...state, providers: publicState().providers },
      packs: packSummary(connectorPacks),
      packErrors: connectorPackErrors,
      backups: await backups.list(),
      versions: { node: process.version },
      platform: process.platform,
    });
    await fs.writeFile(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
    return true;
  });
  handle('app:info', async () => appInfo());
  handle('data:erase', eraseAllData);
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
      .then(() => credentials.settled()).then(() => store.settle()).finally(() => { browsersClosed = true; app.quit(); });
  });
  app.whenReady().then(async () => {
    try {
      await store.ensureDir();
      const acl = await applyDataDirAcl(dataDir);
      if (acl.warning) console.warn(acl.warning);
      const loaded = await store.load();
      state = loaded.state;
      await loadConnectorPacks();
      await backups.maybeBackup({ force: true, reason: 'startup' }).catch(error => {
        logger.warn(`Sauvegarde de démarrage : ${error.message}`);
      });
      logger.info(`Démarrage ${app.getVersion()} · ${connectorPacks.size} pack(s) · ${state.providers.length} fournisseurs`);
      // Cooldowns 429 expirés : purgés dès le chargement, avant toute lecture.
      cooldowns.prune(Date.now());
      // Restes d'une exécution interrompue : `.tmp`, port de diagnostic obsolète,
      // sauvegardes en surnombre (2 conservées) et profils temporaires orphelins.
      await purgeLeftovers(dataDir, {
        preserveDevToolsPort: diagnosticMode,
        sweepTemporaryProfiles: typeof accountBrowser.sweepTemporaryProfiles === 'function' ? accountBrowser.sweepTemporaryProfiles : null,
      });
      if (loaded.legacyGeminiProfile) await deleteAccountProfile(dataDir, 'gemini').catch(() => console.warn('Ancien profil Gemini web verrouillé ; son suivi est désactivé.'));
      const keyDocument = await store.readJSON('credentials.json');
      if (keyDocument) credentials.load(keyDocument);
      registerIpc();
      const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: false };
      const windowBackground = windowBackgroundFor(state.settings.theme);
      mainWindow = new BrowserWindow({ width: 1360, height: 940, minWidth: 900, minHeight: 680, show: false, title: 'Lasmium TOKENS-HUB', icon: path.join(__dirname, 'assets/icon.png'), backgroundColor: windowBackground, icon: path.join(__dirname, 'assets/icon.png'), autoHideMenuBar: true, webPreferences });
      secureWindow(mainWindow);
      mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
      mainWindow.once('ready-to-show', () => mainWindow.show());
      await mainWindow.loadFile(uiPath);
      quickWindow = new BrowserWindow({ width: 360, height: Math.min(660, screen.getPrimaryDisplay().workAreaSize.height - 16), show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, icon: path.join(__dirname, 'assets/icon.png'), backgroundColor: windowBackground, webPreferences });
      secureWindow(quickWindow);
      quickWindow.on('blur', () => quickWindow.hide());
      await quickWindow.loadFile(uiPath, { query: { mode: 'quick' } });
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png')));
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Ouvrir Lasmium TOKENS-HUB', click: showMain }, { label: 'Synchroniser', click: () => syncAll({ force: true }).catch(error => console.error('Synchronisation manuelle :', error)) }, { type: 'separator' }, { label: 'Quitter', click: () => app.quit() }]));
      tray.on('click', toggleQuick); tray.on('double-click', showMain);
      broadcast();
      stopClaudeWatcher = claudeDesktop.watchClaudeDesktopUsage(() => {
        const p = state.providers.find(p => p.id === 'claude');
        if (!quitting && state.settings.autoRefresh && p && isTracked(p) && isConnected(p) && p.accountSession.kind === 'claude-desktop-local') verifyClaudeDesktop().catch(() => {});
      });
      const claude = state.providers.find(p => p.id === 'claude');
      // Lecture directe : restaurer le cooldown d'échec persisté, jamais un succès.
      if (claude?.accountSession?.kind === 'claude-live-local') claudeReader.restore(claude.claudeSync);
      watchFile(CREDENTIAL_PATH, { interval: 2000, persistent: false }, (current, previous) => {
        if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
        claudeReader.credentialsChanged();
        syncClaudeWhenDue();
      });
      // Check the deadline rather than two independent 60-second timers, which
      // could otherwise skip a cycle because of network latency.
      claudeTimer = setInterval(syncClaudeWhenDue, 2000);
      claudeTimer.unref();
      const resumeClaude = () => { claudeReader.wake(); syncClaudeWhenDue(); };
      powerMonitor.on('resume', resumeClaude);
      powerMonitor.on('unlock-screen', resumeClaude);
      setInterval(() => {
        try { if (expireSubscriptions(state.providers)) persist().then(broadcast).catch(console.error); }
        catch (error) { console.error('Expiration des abonnements :', error); }
      }, 60 * 1000).unref();
      setInterval(() => {
        try {
          if (state.settings.autoRefresh) syncAll().catch(error => console.error('Actualisation automatique :', error));
          notify();
        } catch (error) { console.error('Actualisation automatique :', error); }
      }, 5 * 60 * 1000).unref();
      if (state.settings.autoRefresh) syncAll().catch(error => console.error('Synchronisation initiale :', error));
    } catch (error) { dialog.showErrorBox('Lasmium TOKENS-HUB ne peut pas démarrer', error.message + '\nLes fichiers existants ont été conservés.'); app.quit(); }
  });
}
