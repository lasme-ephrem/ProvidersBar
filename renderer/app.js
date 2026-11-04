/* Lasmium TOKENS-HUB — état, événements et boucle de rendu (renderer).
 * Chargé après ui-core.js, reset-ui.js et views.js.
 * Globals conservés pour le smoke et le diagnostic : state, page, filter, query,
 * render, receiveState, renderQuick, statusBadge.
 */
'use strict';

let state;
let appInfo = null;
let page = 'overview';
let filter = 'all';
let query = '';
let dialogId = null;
let dialogTab = 'info';
let historyProvider = 'all';
let historyPeriod = 'all';
let syncing = false;
let historyLoaded = false;
let historyLoading = false;
let historyError = '';
let erasePending = false;
let eraseTimer = null;

let api = window.lasmium;
const quick = new URLSearchParams(location.search).get('mode') === 'quick';

const PREVIEW_BANNER = '<p class="preview-banner" role="status">Aperçu en lecture seule. '
  + 'Ouvre l’application Windows pour enregistrer tes données et connecter tes comptes.</p>';

// Aperçu navigateur volontairement en lecture seule, sans identifiants.
if (!api) {
  api = {
    getState: async () => {
      const response = await fetch('/preview-state');
      if (!response.ok) throw new Error('Ouvre Lasmium TOKENS-HUB avec son lanceur Windows.');
      return response.json();
    },
    onChange: () => () => {},
    showMain: () => location.assign('/'),
  };
}

/* ------------------------------------------------------------------ *
 * Rendu principal
 * ------------------------------------------------------------------ */
function render() {
  if (!state) return;
  applyTheme(state.settings?.theme || 'light');
  if (quick) { renderQuick(); return; }
  const dialog = document.getElementById('detail-dialog');
  const focusInsideDialog = Boolean(dialog?.open && dialog.contains(document.activeElement));
  const token = focusInsideDialog ? null : captureFocus();
  const scrollPosition = window.scrollY;
  const pageContent = page === 'overview' ? overview()
    : page === 'subscriptions' ? subscriptions()
      : page === 'history' ? historyPage()
        : page === 'connections' ? connections()
          : settingsPage({
            version: appInfo?.version || null,
            electronVersion: appInfo?.electron || null,
            packaged: typeof appInfo?.packaged === 'boolean' ? appInfo.packaged : null,
            erasePending,
          });
  const content = (state.desktop ? '' : PREVIEW_BANNER) + pageContent;
  document.getElementById('app').innerHTML = shell(content, page);
  if (!focusInsideDialog && !restoreFocus(token) && scrollPosition) {
    window.scrollTo(0, scrollPosition);
  }
  if (page === 'history' && !historyLoaded && !historyLoading && !historyError) loadHistory();
}

function renderDialog() {
  if (!dialogId) return;
  const provider = state.providers.find(item => item.id === dialogId);
  if (!provider) return;
  const dialog = document.getElementById('detail-dialog');
  const token = dialog.contains(document.activeElement) ? captureFocus() : null;
  dialog.innerHTML = dialogMarkup(provider, dialogTab);
  if (token) restoreFocus(token);
}

function openDetail(id, tab = 'info') {
  dialogId = id;
  dialogTab = tab;
  renderDialog();
  const dialog = document.getElementById('detail-dialog');
  if (!dialog.open) dialog.showModal();
  const activeTab = dialog.querySelector('[role="tab"][aria-selected="true"]');
  if (activeTab) activeTab.focus();
}

/* ------------------------------------------------------------------ *
 * Widget (fenêtre de notification) — liste compacte, sans recommandation
 * ------------------------------------------------------------------ */
function renderQuick() {
  if (!state) return;
  applyTheme(state.settings?.theme || 'light');
  document.body.classList.add('quick-mode');
  const subscriptions = state.providers.filter(provider =>
    provider.type === 'subscription' && isTracked(provider));
  const apis = state.providers.filter(provider =>
    provider.type === 'api' && isTracked(provider));
  const token = captureFocus();
  const body = subscriptions.length || apis.length
    ? `${subscriptions.length
      ? `<p class="quick-group-title">Abonnements</p>${subscriptions.map(quickAccountRow).join('')}`
      : ''}${apis.length
      ? `<p class="quick-group-title">API</p>${apis.map(quickAccountRow).join('')}`
      : ''}`
    : '<p class="hint quick-empty">Aucun compte à afficher.</p>';
  document.getElementById('app').innerHTML = '<main class="quick">'
    + quickHeader({
      total: subscriptions.length + apis.length,
      subscriptions: subscriptions.length,
      apis: apis.length,
    })
    + `<div class="quick-list">${body}</div>`
    + '<footer class="quick-footer"><button type="button" class="text-button" data-action="main">'
    + `Ouvrir le tableau de bord ${icon('arrow', 12)}</button></footer></main>`;
  restoreFocus(token);
}

/* ------------------------------------------------------------------ *
 * Historique paresseux
 * ------------------------------------------------------------------ */
function loadHistory() {
  if (historyLoading || (historyLoaded && Array.isArray(state.history))) return;
  historyLoaded = false;
  if (typeof api.getHistory !== 'function') {
    historyError = 'L’historique est indisponible dans cet aperçu.';
    return;
  }
  historyLoading = true;
  historyError = '';
  const revision = state.historyRevision;
  let stale = false;
  api.getHistory().then(entries => {
    if (!Array.isArray(entries)) throw new Error('La réponse de l’historique est illisible.');
    if (revision !== state.historyRevision) { stale = true; return; }
    state.history = entries;
    historyLoaded = true;
  }).catch(error => {
    historyError = error?.message || 'Impossible de charger l’historique.';
  }).finally(() => {
    historyLoading = false;
    if (page === 'history') {
      if (stale) loadHistory();
      else render();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;

async function runAction(action, button) {
  if (!state.desktop && !['close-dialog', 'main', 'erase-cancel'].includes(action)) {
    toast('Cette action est disponible dans l’application Windows.');
    return;
  }
  if (action === 'close-dialog') {
    document.getElementById('detail-dialog').close();
    dialogId = null;
    return;
  }
  if (action === 'main') { api.showMain(); return; }
  if (action === 'history-retry') { historyError = ''; loadHistory(); render(); return; }
  if (action === 'erase-cancel') {
    erasePending = false;
    clearTimeout(eraseTimer);
    render();
    return;
  }
  if (action === 'erase-data') {
    if (!erasePending) {
      erasePending = true;
      clearTimeout(eraseTimer);
      eraseTimer = setTimeout(() => { erasePending = false; if (page === 'settings') render(); }, 10000);
      render();
      announce('Confirmation requise pour effacer toutes les données locales.');
      return;
    }
    if (typeof api.eraseData !== 'function') {
      toast('L’effacement des données est indisponible dans cette version.');
      return;
    }
    erasePending = false;
    clearTimeout(eraseTimer);
    button.disabled = true;
    try {
      await api.eraseData();
      state = await api.getState();
      historyLoaded = Array.isArray(state.history);
      historyError = '';
      render();
      toast('Données effacées. Tu peux reconnecter tes comptes.');
      announce('Toutes les données locales ont été effacées.');
    } catch (error) {
      const node = document.getElementById('erase-error');
      if (node) node.textContent = error.message.replace(IPC_ERROR_PREFIX, '');
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (action === 'claude-enable-live') {
    button.disabled = true;
    try {
      state = await api.enableClaudeLive();
      render();
      if (dialogId) renderDialog();
      const claude = state.providers.find(item => item.id === 'claude');
      // Le main bascule explicitement en lecture Desktop si le renouvellement du
      // jeton Claude Code est refusé : ne jamais annoncer une lecture directe qui
      // n'est pas active (le message de bascule reste visible dans la fiche).
      if (claude?.accountSession?.kind === 'claude-live-local') {
        toast('Lecture directe Claude activée.');
      } else {
        toast('Connexion Claude mise à jour : relevé Claude Desktop utilisé.');
      }
    } catch (error) {
      const node = document.getElementById('account-account-error');
      if (node) node.textContent = error.message.replace(IPC_ERROR_PREFIX, '');
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (['account-open', 'account-verify'].includes(action)) {
    const id = dialogId;
    button.disabled = true;
    try {
      if (action === 'account-open') {
        await api.openAccount(id);
        toast(id === 'antigravity' ? 'Quotas Antigravity actualisés.'
          : id === 'openai' ? 'Connexion OpenAI en cours via Codex.'
            : 'Connecte-toi sur le site officiel, puis ferme cette fenêtre Chrome ou Edge.');
      } else {
        state = await api.verifyAccount(id);
        render();
        if (dialogId) renderDialog();
        const provider = state.providers.find(item => item.id === id);
        toast(provider.error || (id === 'claude'
          ? 'Relevé Claude récupéré.' : 'Compte connecté. Quotas mis à jour.'));
        announce(provider.error
          ? 'La vérification a échoué ; le dernier relevé est conservé.'
          : 'Vérification terminée.');
      }
    } catch (error) {
      const message = error.message.replace(IPC_ERROR_PREFIX, '');
      const node = document.getElementById('account-account-error');
      if (node) node.textContent = message; else toast(message);
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (['orca-open', 'orca-verify', 'ollama-open', 'ollama-verify', 'ollama-email'].includes(action)) {
    const isOllama = action.startsWith('ollama-');
    const name = isOllama ? 'Ollama' : 'OrcaRouter';
    button.disabled = true;
    const errorNode = document.getElementById(`${isOllama ? 'ollama' : 'orca'}-account-error`);
    if (errorNode) errorNode.textContent = '';
    try {
      if (action === 'ollama-email') {
        await api.openOllamaEmail();
        toast('Utilise « Continue with email » sur Ollama.');
      } else if (action.endsWith('-open')) {
        await (isOllama ? api.openOllamaAccount() : api.openOrcaAccount());
        toast(`Connecte-toi sur ${name}. Les usages seront récupérés automatiquement.`);
      } else {
        state = await (isOllama ? api.verifyOllamaAccount() : api.verifyOrcaAccount());
        render();
        renderDialog();
        toast(`${name} synchronisé.`);
      }
    } catch (error) {
      if (errorNode) errorNode.textContent = error.message.replace(IPC_ERROR_PREFIX, '');
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (action === 'sync') {
    if (!state.providers.some(provider => provider.connected && isTracked(provider))) {
      toast('Connecte un compte dans Connexions pour synchroniser les soldes.');
      if (!quick) { page = 'connections'; render(); }
      return;
    }
    syncing = true;
    render();
    announce('Synchronisation en cours.');
    try {
      state = await api.syncAll();
      const errors = state.providers.filter(provider =>
        provider.connected && isTracked(provider) && provider.error);
      toast(errors.length
        ? `${errors.length} connexion(s) à vérifier. Les derniers relevés ont été conservés.`
        : 'Les soldes sont à jour.');
      announce(errors.length ? 'Synchronisation terminée avec des erreurs.' : 'Soldes à jour.');
    } finally {
      syncing = false;
      render();
    }
    return;
  }
  if (action === 'disconnect') {
    button.disabled = true;
    try {
      state = await api.disconnect(dialogId);
      render();
      renderDialog();
      toast('Compte déconnecté. Historique conservé.');
    } finally {
      button.disabled = false;
    }
  }
  if (action === 'export') {
    if (await api.exportData()) toast('Données exportées, sans les clés.');
  }
}

/* ------------------------------------------------------------------ *
 * Événements
 * ------------------------------------------------------------------ */
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  try {
    if (button.dataset.nav) {
      page = button.dataset.nav;
      dialogId = null;
      render();
      window.scrollTo(0, 0);
      announce(`${NAV_LABELS[page]} affichée.`);
    } else if (button.dataset.filter) {
      filter = button.dataset.filter;
      render();
      announce(`${document.querySelectorAll('#provider-cards .card').length} services affichés.`);
    } else if (button.dataset.sync) {
      const id = button.dataset.sync;
      const provider = state.providers.find(item => item.id === id);
      button.disabled = true;
      try {
        state = await api.syncOne(id);
        const updated = state.providers.find(item => item.id === id);
        toast(updated?.error
          ? `${updated.name} : ${updated.error}`
          : `${updated?.name || 'Connexion'} vérifié${updated?.health?.state === 'ok' ? ' · à jour' : ''}.`);
        announce('Vérification terminée.');
      } catch (error) {
        toast(`${provider?.name || 'Connexion'} : ${String(error.message).replace(IPC_ERROR_PREFIX, '')}`);
      } finally {
        render();
      }
    } else if (button.dataset.open) {
      openDetail(button.dataset.open, button.dataset.tab || 'info');
    } else if (button.dataset.dialogTab) {
      dialogTab = button.dataset.dialogTab;
      renderDialog();
      document.querySelector(`[data-dialog-tab="${CSS.escape(dialogTab)}"]`)?.focus();
    } else if (button.dataset.favorite) {
      if (!state.desktop) { toast('Les favoris se modifient dans l’application Windows.'); return; }
      const provider = state.providers.find(item => item.id === button.dataset.favorite);
      state = await api.updateProvider(provider.id, { favorite: !provider.favorite });
      render();
    } else if (button.dataset.action) {
      await runAction(button.dataset.action, button);
    }
  } catch (error) {
    toast(error.message.replace(IPC_ERROR_PREFIX, ''));
    button.disabled = false;
  }
});

// Onglets de fiche : flèches gauche/droite, Début/Fin.
document.addEventListener('keydown', event => {
  const tab = event.target.closest?.('[data-dialog-tab]');
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-dialog-tab]')];
  const index = tabs.indexOf(tab);
  const next = event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
    : event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'Home' ? 0 : tabs.length - 1;
  event.preventDefault();
  dialogTab = tabs[next].dataset.dialogTab;
  renderDialog();
  document.querySelector(`[data-dialog-tab="${CSS.escape(dialogTab)}"]`)?.focus();
});

let searchTimer = null;
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  const container = document.getElementById('provider-cards');
  if (container) container.innerHTML = filteredCards();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const count = document.querySelectorAll('#provider-cards .card').length;
    announce(`${count} service${count > 1 ? 's' : ''} correspondant à la recherche.`);
  }, 400);
});

document.addEventListener('change', event => {
  if (event.target.id === 'history-provider') { historyProvider = event.target.value; render(); }
  if (event.target.id === 'history-period') { historyPeriod = event.target.value; render(); }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const errorNode = form.querySelector('.form-error');
  if (!state.desktop) {
    if (errorNode) errorNode.textContent = 'Ouvre l’application Windows pour enregistrer cette modification.';
    return;
  }
  const data = new FormData(form);
  const get = name => data.get(name);
  const num = name => (get(name) === '' ? null : Number(get(name)));
  const button = form.querySelector('button[type="submit"]');
  const oldLabel = button.textContent;
  button.disabled = true;
  button.textContent = form.id === 'connection-form' ? 'Vérification…' : 'Enregistrement…';
  if (errorNode) errorNode.textContent = '';
  try {
    if (form.id === 'provider-form') {
      const provider = state.providers.find(item => item.id === dialogId);
      const patch = {
        plan: get('plan'),
        amount: num('amount'),
        currency: get('currency'),
        billingCycle: get('billingCycle'),
        renewalDate: get('renewalDate') || null,
        nextAmount: num('nextAmount'),
        priceChangeDate: get('priceChangeDate') || null,
        notes: get('notes'),
        reviewed: data.has('reviewed'),
      };
      if (provider.type === 'subscription') {
        patch.subscriptionStatus = get('subscriptionStatus');
        patch.statusMessage = get('statusMessage');
        patch.confirmRenewal = data.has('confirmRenewal');
      } else {
        patch.active = data.has('active');
      }
      state = await api.updateProvider(dialogId, patch);
      document.getElementById('detail-dialog').close();
      dialogId = null;
      toast('Fiche enregistrée.');
    }
    if (form.id === 'resets-form') {
      const provider = state.providers.find(item => item.id === dialogId);
      const dates = Object.fromEntries(QuotaResets.slots(provider).map((slot, index) => [
        slot.key,
        get(`reset-date-${index}`)
          ? { date: get(`reset-date-${index}`), time: get(`reset-time-${index}`) || null }
          : null,
      ]));
      state = await api.saveResets(dialogId, dates);
      renderDialog();
      toast('Dates de réinitialisation enregistrées.');
    }
    if (form.id === 'manual-form') {
      state = await api.saveManual(dialogId, {
        balance: num('balance'),
        currency: get('currency'),
        quotaRemaining: num('quotaRemaining'),
        resetAt: get('resetAt') ? new Date(get('resetAt')).toISOString() : null,
      });
      document.getElementById('detail-dialog').close();
      dialogId = null;
      toast('Relevé ajouté à l’historique.');
    }
    if (form.id === 'connection-form') {
      state = await api.connect(dialogId, get('key'));
      form.reset();
      renderDialog();
      toast('Compte connecté. Le solde a été récupéré.');
    }
    if (form.id === 'settings-form') {
      state = await api.updateSettings({
        autoRefresh: data.has('autoRefresh'),
        notifications: data.has('notifications'),
        lowBalance: num('lowBalance'),
        theme: get('theme') || 'light',
      });
      toast('Préférences enregistrées.');
    }
    render();
  } catch (error) {
    if (errorNode) errorNode.textContent = error.message.replace(IPC_ERROR_PREFIX, '');
  } finally {
    button.disabled = false;
    button.textContent = oldLabel;
  }
});

document.getElementById('detail-dialog').addEventListener('close', () => { dialogId = null; });

/* ------------------------------------------------------------------ *
 * Réception d'état
 * ------------------------------------------------------------------ */
function receiveState(data) {
  if (!state) { state = data; render(); return; }
  const changedAccounts = data.providers
    .filter(provider => provider.connector?.mode === 'account')
    .filter(after => {
      const before = state.providers.find(provider => provider.id === after.id);
      return JSON.stringify([
        before?.connected, before?.accountConnection, before?.error, before?.snapshot?.updatedAt,
      ]) !== JSON.stringify([after.connected, after.accountConnection, after.error, after.snapshot?.updatedAt]);
    });
  const justConnected = changedAccounts.filter(after =>
    after.accountConnection?.status === 'connected'
    && state.providers.find(provider => provider.id === after.id)?.accountConnection?.status !== 'connected');
  const historyChanged = data.historyRevision !== state.historyRevision;
  const cachedHistory = state.history;
  state = { ...data, ...(!historyChanged && Array.isArray(cachedHistory) ? { history: cachedHistory } : {}) };
  if (data.app) appInfo = { ...appInfo, ...data.app };
  historyLoaded = Array.isArray(state.history);
  if (historyChanged) historyError = '';
  applyTheme(state.settings?.theme || 'light');
  if (quick) {
    renderQuick();
  } else {
    const dialog = document.getElementById('detail-dialog');
    const editingField = page === 'settings'
      || Boolean(document.querySelector('#search:focus'))
      || Boolean(dialog?.open && dialog.contains(document.activeElement)
        && document.activeElement.matches('input, textarea, select'));
    if (!editingField) render();
  }
  if (changedAccounts.some(provider => provider.id === dialogId) && dialogTab === 'connection') {
    renderDialog();
  }
  for (const provider of justConnected) {
    toast(provider.error || (provider.id === 'claude'
      ? 'Relevé Claude récupéré.' : `${provider.name} connecté. Les usages sont à jour.`));
  }
}

/* ------------------------------------------------------------------ *
 * Démarrage
 * ------------------------------------------------------------------ */
async function start() {
  try {
    state = await api.getState();
    historyLoaded = Array.isArray(state.history);
    appInfo = state.app || null;
    if (typeof api.getAppInfo === 'function') {
      try {
        const info = await api.getAppInfo();
        if (info) appInfo = { ...appInfo, ...info };
      } catch {}
    }
    watchSystemTheme(() => {
      if (quick) renderQuick();
      else if (!dialogId) render();
    });
    render();
    api.onChange?.(receiveState);
    setInterval(() => {
      if (quick) return;
      if (dialogId || page === 'settings') return;
      if (document.querySelector('input:focus, textarea:focus, select:focus, [contenteditable]:focus')) return;
      render();
    }, 60000);
  } catch (error) {
    document.getElementById('app').innerHTML = '<div class="loading loading-error" role="alert">'
      + `${icon('warning', 28)}<p>${escapeHtml(error.message)}</p>`
      + '<p class="hint">Ferme puis relance Lasmium TOKENS-HUB avec son lanceur Windows.</p></div>';
  }
}

start();
