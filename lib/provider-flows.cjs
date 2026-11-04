'use strict';

// Parcours d'authentification et de lecture propres aux fournisseurs à compte.
// main.cjs ne connaît plus leurs fenêtres, timers ni états internes : il injecte
// les services Electron et reçoit des méthodes stables. Les décisions pures
// (repli Claude, choix de la référence OrcaRouter) restent exportées pour les
// tests.

function shouldFallbackToClaudeDesktop(code, snapshot, nowMs = Date.now()) {
  const updatedAt = Date.parse(snapshot?.updatedAt);
  if (Number.isFinite(updatedAt) && nowMs - updatedAt <= 10 * 60 * 1000) return false;
  if (typeof code !== 'string' || !code) return false;
  return code === 'rate-limit' || code.startsWith('auth-');
}
function claudeDesktopGuidance() {
  return 'Ouvre Claude Desktop (page Utilisation) pour actualiser le relevé ; la lecture directe reprendra après renouvellement du jeton dans Claude Code.';
}
// Décision pure (aucune dépendance Electron) : la ref persistée suffit à
// vérifier une session existante sans fenêtre. Celle de la fenêtre n'est
// retenue que si elle est valide et différente (connexion neuve ou changement
// de compte / espace de travail).
function chooseOrcaAccountRef(stored, fromWindow) {
  const valid = ref => Boolean(ref) && Number.isSafeInteger(ref.userId) && ref.userId > 0
    && Number.isSafeInteger(ref.workspaceId) && ref.workspaceId > 0;
  const windowRef = valid(fromWindow) ? fromWindow : null;
  const storedRef = valid(stored) ? stored : null;
  if (windowRef && (!storedRef || windowRef.userId !== storedRef.userId || windowRef.workspaceId !== storedRef.workspaceId)) return windowRef;
  return storedRef || windowRef || null;
}

function createProviderFlows({
  BrowserWindow,
  secureAccountWindow,
  ACCOUNT_ORIGINS,
  ORCA_ORIGIN,
  OLLAMA_ORIGIN,
  SETTINGS_URL,
  dataDir,
  getState,
  getMainWindow,
  provider,
  isTracked,
  disconnecting,
  busy,
  isQuitting = () => false,
  broadcast,
  persist,
  publicState,
  record,
  markHealthSuccess,
  markHealthFailure,
  showMain,
  syncOne,
  claudeReader,
  claudeDesktop,
  antigravityTransport,
  fetchWallet,
  validateAccountRef,
  orcaSession,
  fetchOllamaCredits,
  ollamaSession,
  openOllamaBrowser,
  assumeOllamaFree,
} = {}) {
  let orcaLoginWindow;
  let orcaDetectionTimer, orcaVerification;
  let orcaConnection = { status: 'idle', message: '' };
  let ollamaLoginWindow, ollamaDetectionTimer, ollamaVerification;
  let ollamaBrowser, ollamaBrowserOpening;
  let ollamaConnection = { status: 'idle', message: '' };
  let antigravityWork;
  let antigravityConnection = { status: 'idle', message: '' };
  let claudeConnection = { status: 'idle', message: '' };
  let claudeWork;

  function syncClaudeWhenDue() {
    const state = getState();
    const p = state?.providers.find(item => item.id === 'claude');
    if (isQuitting() || !state?.settings.autoRefresh || !p || !isTracked(p) || p.accountSession?.kind !== 'claude-live-local') return;
    if (Date.parse(claudeReader.info().nextAttemptAt) > Date.now()) return;
    syncOne('claude', { force: false }).catch(() => {});
  }

  async function verifyClaudeDesktop({ enableLive = false, manual = false } = {}) {
    if (disconnecting.has('claude') || isQuitting()) throw new Error('Déconnexion en cours.');
    if (claudeWork) {
      if (!enableLive) return claudeWork;
      await claudeWork.catch(() => {});
    }
    claudeWork = (async () => {
      const p = provider('claude');
      const direct = enableLive || p.accountSession?.kind === 'claude-live-local';
      if (manual && direct) claudeReader.credentialsChanged();
      claudeConnection = { status: 'verifying', message: direct ? 'Lecture des quotas actuels auprès de Claude…' : 'Lecture du relevé local de Claude Desktop…' };
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
    if (disconnecting.has('antigravity') || isQuitting()) throw new Error('Déconnexion en cours.');
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

  async function openOrcaAccount() {
    if (disconnecting.has('orcarouter') || isQuitting()) throw new Error('Déconnexion en cours.');
    if (orcaLoginWindow && !orcaLoginWindow.isDestroyed()) { orcaLoginWindow.show(); orcaLoginWindow.focus(); return true; }
    const accountSession = orcaSession();
    accountSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    accountSession.setPermissionCheckHandler(() => false);
    if (!accountSession.lasmiumConfigured) {
      accountSession.on('will-download', event => event.preventDefault());
      accountSession.lasmiumConfigured = true;
    }
    orcaLoginWindow = new BrowserWindow({ width: 1100, height: 850, title: 'Connexion au compte OrcaRouter', parent: getMainWindow(),
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

  async function readOrcaAccountRef() {
    if (!orcaLoginWindow || orcaLoginWindow.isDestroyed()) return null;
    let origin;
    try { origin = new URL(orcaLoginWindow.webContents.getURL()).origin; } catch { return null; }
    if (!ORCA_ACCOUNT_ORIGINS.has(origin)) return null;
    return orcaLoginWindow.webContents.executeJavaScript(`(() => {
      try { const user = JSON.parse(localStorage.getItem('user') || 'null');
        return { userId: Number(user?.id), workspaceId: Number(localStorage.getItem('active_workspace_id') || user?.active_workspace_id) };
      } catch { return null; }
    })()`).catch(() => null);
  }
  const ORCA_ACCOUNT_ORIGINS = new Set([ORCA_ORIGIN, ORCA_ORIGIN.replace('://www.', '://')]);

  async function verifyOrcaAccount() {
    if (disconnecting.has('orcarouter') || isQuitting()) throw new Error('Déconnexion en cours.');
    if (orcaVerification) { await orcaVerification; return publicState(); }
    const p = provider('orcarouter');
    if (busy.has(p.id)) throw new Error('Une synchronisation OrcaRouter est déjà en cours.');
    const work = (async () => {
      try {
        const fromWindow = await readOrcaAccountRef();
        const ref = chooseOrcaAccountRef(p.accountSession, fromWindow);
        validateAccountRef(ref);
        orcaConnection = { status: 'verifying', message: 'Lecture du portefeuille OrcaRouter…' };
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
        if (error.code === 'ORCA_AUTH') delete p.accountSession;
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
    if (disconnecting.has('ollama') || isQuitting()) throw new Error('Déconnexion en cours.');
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
    if (disconnecting.has('ollama') || isQuitting()) throw new Error('Déconnexion en cours.');
    if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) { ollamaLoginWindow.show(); ollamaLoginWindow.focus(); return true; }
    const isolated = ollamaSession();
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    if (!isolated.lasmiumConfigured) { isolated.on('will-download', event => event.preventDefault()); isolated.lasmiumConfigured = true; }
    ollamaLoginWindow = new BrowserWindow({ width: 1100, height: 850, title: 'Connexion au compte Ollama', parent: getMainWindow(),
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
    if (disconnecting.has('ollama') || isQuitting()) throw new Error('Déconnexion en cours.');
    if (ollamaVerification) { await ollamaVerification; return publicState(); }
    const p = provider('ollama');
    if (busy.has(p.id)) throw new Error('Une synchronisation Ollama est déjà en cours.');
    const work = (async () => {
      try {
        if (ollamaBrowser) {
          const cookies = await ollamaBrowser.readOllamaCookies();
          if (!cookies.length) throw Object.assign(new Error('En attente de ta connexion Ollama dans le navigateur.'), { code: 'OLLAMA_SIGNIN' });
          for (const cookie of cookies) await ollamaSession().cookies.set(cookie);
          await ollamaSession().cookies.flushStore();
        }
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
          delete p.accountSession;
          p.error = error.message;
          await persist();
          ollamaConnection = automatic
            ? { status: 'waiting', message: 'En attente de ta connexion sur le site officiel Ollama.' }
            : { status: 'error', message: error.message, errorCode: code };
        }
        else {
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

  async function openOllamaEmailAccount() {
    // Un lancement en cours réarme la détection après son propre await : il
    // faut l'attendre avant de nettoyer le timer, sinon celui-ci reste armé.
    await ollamaBrowserOpening?.catch(() => {});
    clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
    if (ollamaBrowser) { const browser = ollamaBrowser; ollamaBrowser = null; await browser.close(); }
    return openOllamaAccount();
  }

  function clearTimers() {
    clearInterval(orcaDetectionTimer); orcaDetectionTimer = null;
    clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
  }

  function closeWindows() {
    for (const window of [orcaLoginWindow, ollamaLoginWindow]) {
      try { if (window && !window.isDestroyed()) window.close(); } catch { /* déjà fermée */ }
    }
    orcaLoginWindow = null;
    ollamaLoginWindow = null;
  }

  async function cancelClaude() {
    await claudeWork?.catch(() => {});
    claudeWork = null;
    claudeConnection = { status: 'idle', message: '' };
  }
  async function cancelAntigravity() {
    await antigravityWork?.catch(() => {});
    antigravityWork = null;
    antigravityConnection = { status: 'idle', message: '' };
  }
  async function cancelOllama() {
    await ollamaBrowserOpening?.catch(() => {});
    ollamaBrowserOpening = null;
    clearInterval(ollamaDetectionTimer); ollamaDetectionTimer = null;
    const browser = ollamaBrowser;
    ollamaBrowser = null;
    if (browser) await browser.close().catch(() => {});
    if (ollamaLoginWindow && !ollamaLoginWindow.isDestroyed()) ollamaLoginWindow.close();
    ollamaLoginWindow = null;
    ollamaConnection = { status: 'idle', message: '' };
  }
  async function cancelOrca() {
    clearInterval(orcaDetectionTimer); orcaDetectionTimer = null;
    if (orcaLoginWindow && !orcaLoginWindow.isDestroyed()) orcaLoginWindow.close();
    orcaLoginWindow = null;
    orcaConnection = { status: 'idle', message: '' };
  }
  function pending() {
    return [claudeWork, antigravityWork, orcaVerification, ollamaVerification, ollamaBrowserOpening].filter(Boolean);
  }
  async function closeAll({ reset = false } = {}) {
    clearTimers();
    await Promise.allSettled(pending().map(item => Promise.resolve(item).catch(() => {})));
    // Un lancement de navigateur terminé pendant l'attente a réarmé sa détection.
    clearTimers();
    closeWindows();
    const browser = ollamaBrowser;
    ollamaBrowser = null;
    if (browser) await browser.close().catch(() => {});
    if (reset) {
      orcaConnection = { status: 'idle', message: '' };
      ollamaConnection = { status: 'idle', message: '' };
      antigravityConnection = { status: 'idle', message: '' };
      claudeConnection = { status: 'idle', message: '' };
    }
  }

  return {
    info: () => ({
      claude: claudeConnection,
      antigravity: antigravityConnection,
      orcarouter: orcaConnection,
      ollama: ollamaConnection,
    }),
    syncClaudeWhenDue,
    verifyClaudeDesktop,
    verifyAntigravity,
    openOrcaAccount,
    verifyOrcaAccount,
    openOllamaSystemAccount,
    openOllamaAccount,
    openOllamaEmailAccount,
    verifyOllamaAccount,
    cancelClaude,
    cancelAntigravity,
    cancelOrca,
    cancelOllama,
    closeAll,
    pending,
    chooseOrcaAccountRef,
    shouldFallbackToClaudeDesktop,
  };
}

module.exports = { createProviderFlows, shouldFallbackToClaudeDesktop, claudeDesktopGuidance, chooseOrcaAccountRef };
