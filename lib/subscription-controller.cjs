const { accountConfig, parseAccountUsage } = require('./subscription-accounts.cjs');
const delay = (ms, signal) => require('node:timers/promises').setTimeout(ms, undefined, { signal });

// Owns browser lifetimes and serializes opening, verification and disconnect.
// Injectable transport lets tests exercise the same controller without accounts.
//
// Une seule passe navigateur est active par fournisseur : deux lancements
// simultanés ouvriraient deux Chrome/Edge sur le même profil dédié. Une demande
// `interactive: true` ne rejoint jamais une passe de fond : elle attend la fin
// de celle-ci puis relance une vérification réellement interactive.
function createSubscriptionController({ dataDir, openBrowser, deleteProfile, onChange, onResult, onFailure = async () => {}, getPreviousSnapshot = () => null, wait = delay }) {
  const entries = new Map();
  const entry = id => {
    accountConfig(id);
    if (!entries.has(id)) entries.set(id, { status: 'idle', message: '', browser: null, opening: null, work: null, workInteractive: false, interactiveQueued: null, timer: null, disconnecting: false, abort: null });
    return entries.get(id);
  };
  const update = (id, status, message) => { Object.assign(entry(id), { status, message }); onChange(); };
  const info = id => { const e = entry(id); return { status: e.status, message: e.message }; };

  function startPass(e, id, config, { background = false, automatic = false, interactive = false } = {}) {
    const abort = new AbortController(); e.abort = abort;
    const signal = abort.signal;
    const work = (async () => {
      if (e.opening) await e.opening;
      let browser = e.browser;
      const temporary = !browser?.isOpen();
      if (temporary && !background) throw new Error('Ouvre le compte avant de vérifier la connexion.');
      let accepted = false;
      try {
        if (temporary || browser.phase?.() === 'verifying') update(id, 'verifying', `Connexion ${config.name} terminée. Vérification de la session et des quotas…`);
        if (temporary) { browser = await openBrowser(dataDir, id, true, { signal, interactive }); e.browser = browser; }
        let result, snapshot;
        const previous = getPreviousSnapshot(id);
        // Allow navigation and client-rendered settings to settle in a fresh browser.
        const attempts = interactive ? 120 : temporary || browser.phase?.() === 'verifying' ? 20 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
          signal.throwIfAborted();
          result = await browser.readSubscriptionPage({ signal, interactive });
          signal.throwIfAborted();
          // Grok renders its Bot quota after the main total. Do not publish an
          // intermediate render that silently removes a previously known limit.
          // A verified switch to the shared pool may legitimately change shape.
          if (id === 'grok' && previous?.usageKind && previous.usageKind === result.usageKind && previous.quotaWindows?.some(w => !result.windows?.some(current => current.label === w.label))) {
            result = { ...result, windows: [] };
          }
          if (result.authenticated && result.windows?.length) break;
          if (result.blocked === 'challenge' && interactive) {
            update(id, 'waiting', `${config.name} demande une vérification humaine. Termine-la dans la fenêtre Chrome ou Edge ; ProvidersBar attend ensuite les quotas.`);
          }
          // A changed/missing usage layout is not a login failure. Do not keep
          // an authenticated account open for the entire human-check timeout.
          if (result.authenticated && attempt >= 19) break;
          if (attempt < attempts - 1) await wait(result.blocked === 'challenge' && interactive ? 1000 : 500, signal);
        }
        snapshot = parseAccountUsage(id, result);
        if (!snapshot && automatic && !temporary && !result.loginCompleted) {
          update(id, 'waiting', `Connexion détectée. ${config.hint} Si aucun quota n’est affiché, clique sur Vérifier maintenant pour conserver la session.`);
          return null;
        }
        const message = snapshot ? `${config.name} connecté. Quotas mis à jour.` : `${config.name} connecté · quota indisponible. La session et le dernier relevé sont conservés. Le site n’a pas encore fourni de quota lisible.`;
        await onResult(id, snapshot, message);
        accepted = true;
        clearInterval(e.timer); e.timer = null;
        update(id, 'connected', message);
        return snapshot;
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.code === 'ACCOUNT_LOGIN_PENDING') update(id, 'waiting', error.message);
        else {
          clearInterval(e.timer); e.timer = null;
          update(id, 'error', error.message);
          await onFailure(id, error.message);
        }
        throw error;
      } finally {
        // Visible login windows remain available if usage is not yet readable.
        if ((temporary || accepted || browser?.phase?.() === 'verifying') && browser) { await browser.close(); if (e.browser === browser) e.browser = null; }
      }
    })();
    e.work = work;
    e.workInteractive = interactive;
    return work.finally(() => {
      if (e.work === work) { e.work = null; e.workInteractive = false; }
      if (e.abort === abort) e.abort = null;
    });
  }

  // File prioritaire : la passe de fond doit d'abord se terminer (elle ferme son
  // navigateur) avant qu'une vérification interactive ne démarre, une seule fois.
  function queueInteractive(e, id, config, options) {
    if (e.interactiveQueued) return e.interactiveQueued;
    const running = e.work;
    const queued = (async () => {
      await running?.catch(() => {});
      e.interactiveQueued = null;
      if (e.disconnecting) throw new Error('Déconnexion en cours.');
      return startPass(e, id, config, { ...options, interactive: true });
    })();
    e.interactiveQueued = queued;
    return queued;
  }

  async function read(id, { background = false, automatic = false, interactive = false } = {}) {
    const e = entry(id), config = accountConfig(id);
    if (e.disconnecting) throw new Error('Déconnexion en cours.');
    interactive = Boolean(interactive);
    if (!e.work) return startPass(e, id, config, { background, automatic, interactive });
    // Un rafraîchissement de fond rejoint la passe en cours. Une vérification
    // interactive, elle, n'est jamais servie par un travail de fond.
    if (!interactive || e.workInteractive) return e.work;
    return queueInteractive(e, id, config, { background, automatic });
  }

  async function open(id) {
    const e = entry(id), config = accountConfig(id);
    if (e.disconnecting) throw new Error('Déconnexion en cours.');
    if (e.opening) return e.opening;
    update(id, 'opening', `Ouverture du navigateur ${config.name}…`);
    // Référence capturée avant l'abandon : la passe de fond doit se terminer,
    // mais une vérification interactive en file attend l'ouverture (`e.opening`)
    // et ne doit donc jamais être attendue ici (interblocage).
    const running = e.work;
    e.abort?.abort();
    const work = (async () => {
      if (running) await running.catch(() => {});
      if (e.browser?.isOpen()) return true;
      if (e.browser) await e.browser.close();
      e.browser = await openBrowser(dataDir, id, false);
      update(id, 'waiting', `Connecte-toi sur ${config.name}. ${config.hint}`);
      e.browser.onReady?.(() => { if (!e.disconnecting && !e.work) read(id, { automatic: true }).catch(() => {}); });
      clearInterval(e.timer);
      e.timer = setInterval(() => {
        if (e.work || e.disconnecting) return;
        if (!e.browser?.isOpen()) { clearInterval(e.timer); e.timer = null; return; }
        read(id, { automatic: true }).catch(() => {});
      }, 1000);
      e.timer.unref();
      return true;
    })();
    e.opening = work;
    try { return await work; }
    catch (error) { update(id, 'error', error.message); throw error; }
    finally { e.opening = null; }
  }
  async function disconnect(id) {
    const e = entry(id);
    e.disconnecting = true; clearInterval(e.timer); e.timer = null;
    e.abort?.abort();
    try {
      await e.opening?.catch(() => {});
      await e.work?.catch(() => {});
      await e.interactiveQueued?.catch(() => {});
      if (e.browser) { await e.browser.close(); e.browser = null; }
      await deleteProfile(dataDir, id);
      update(id, 'idle', '');
    } finally { e.disconnecting = false; }
  }
  async function closeAll() {
    await Promise.all([...entries.keys()].map(async id => {
      const e = entry(id); e.disconnecting = true; clearInterval(e.timer);
      e.abort?.abort();
      await e.opening?.catch(() => {}); await e.work?.catch(() => {}); await e.interactiveQueued?.catch(() => {});
      if (e.browser) { await e.browser.close(); e.browser = null; }
    }));
  }
  return { info, open, read, disconnect, closeAll };
}
module.exports = { createSubscriptionController };
