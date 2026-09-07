// Only official subscription portals. No API keys or inference requests.
const accounts = Object.freeze({
  openai: { name: 'OpenAI', url: 'https://chatgpt.com/', origin: 'https://chatgpt.com', nativeLogin: false, scope: 'Limites OpenAI · compte ChatGPT de Codex', hint: 'Connecte le compte ChatGPT déjà utilisé dans Codex. Si nécessaire, la connexion officielle s’ouvre dans ton navigateur et se confirme automatiquement.' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app', usageUrl: 'https://gemini.google.com/usage', origin: 'https://gemini.google.com', nativeLogin: true, scope: 'Quotas de l’application Gemini', hint: 'Connecte-toi dans Chrome ou Edge, puis ferme cette fenêtre. Les quotas se trouvent dans Paramètres → Limites d’utilisation de Gemini.' },
  grok: { name: 'Grok', url: 'https://grok.com/', origin: 'https://grok.com', nativeLogin: true, scope: 'Quota d’utilisation de Grok', hint: 'Connecte-toi dans Chrome ou Edge, puis ferme cette fenêtre. Les quotas se trouvent dans Settings → Usage (Paramètres → Utilisation) de Grok.' },
  zai: { name: 'Z.ai', url: 'https://z.ai/manage-apikey/coding-plan/personal/usage', origin: 'https://z.ai', nativeLogin: true, scope: 'Quotas du plan Z.ai', hint: 'Connecte-toi dans Chrome ou Edge sur le portail Z.ai, puis ferme cette fenêtre. ProvidersBar pourra alors lire les quotas de ton abonnement.' },
});
function accountConfig(id) {
  if (!Object.hasOwn(accounts, id)) throw new Error('Connexion au compte non disponible.');
  return accounts[id];
}

// Executed only in the dedicated browser. Never return page text, credentials,
// account identity, chat contents or storage. Read usage settings sections only.
function inspectSubscriptionPage(id, expectedOrigin) {
  if (location.origin !== expectedOrigin) return { authenticated: false, windows: [] };
  if (/^(just a moment|un instant|checking your browser|vérification du navigateur)/i.test(document.title || '')) return { authenticated: false, windows: [], blocked: 'challenge' };
  const visible = el => Boolean(el.getClientRects().length);
  const controls = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')].filter(visible);
  const label = el => (el.getAttribute('aria-label') || el.innerText || '').trim();
  const login = controls.some(el => /^(sign in|log in|se connecter|connexion)$/i.test(label(el)));
  const explicitAccount = controls.some(el => /^(sign out|log out|se déconnecter|déconnexion)$|^(google account|compte google)\b|^(open profile menu|ouvrir le menu du profil)$/i.test(label(el)));
  if (login) window.__providersBarAuthenticated = false;
  else if (explicitAccount) window.__providersBarAuthenticated = true;
  const authenticated = !login && Boolean(window.__providersBarAuthenticated);
  let scopes = [];
  if ((id === 'openai' && /^\/codex\/(?:cloud\/settings\/analytics|settings\/usage)\/?$/.test(location.pathname)) ||
      (id === 'zai' && /^\/manage-apikey\/(subscription|usage|coding-plan\/personal\/usage)\/?$/.test(location.pathname))) {
    scopes = [...document.querySelectorAll('main, [role="main"]')].filter(visible);
  }
  if (id === 'gemini' && /^\/usage\/?$/.test(location.pathname)) scopes = [...document.querySelectorAll('usage-metrics-window')].filter(visible);
  // Gemini/Grok expose usage in a settings dialog or panel. Never scan chats.
  for (const el of document.querySelectorAll('[role="dialog"], dialog, [role="tabpanel"]')) {
    if (!visible(el)) continue;
    const title = el.querySelector('h1,h2,h3,[role="heading"]');
    if (title && /^(usage(?: limits)?|limits|utilisation|limites(?: d[’\x27]utilisation)?|consommation)$/i.test(title.innerText.trim())) scopes.push(el);
  }
  if (!scopes.length && !login) {
    // Open only the documented settings/usage controls, never a purchase,
    // conversation or model action. The user can also navigate there manually.
    const usage = controls.find(el => /^(usage(?: limits)?|utilisation|limites d[’\x27]utilisation|consommation)$/i.test(label(el).split('\n')[0].trim()));
    if (usage) usage.click();
    else if (!window.__providersBarSettingsOpened && ['gemini', 'grok'].includes(id)) {
      const settings = controls.find(el => /^(settings(?: (?:and|&) help)?|paramètres(?: et aide)?|réglages)$/i.test(label(el)));
      if (settings) { settings.click(); window.__providersBarSettingsOpened = true; }
      else if (id === 'grok' && !window.__providersBarProfileOpened) {
        // Grok's account menu is an unlabelled avatar button. Opening this menu
        // is not authentication evidence: require its explicit logout control.
        const profile = controls.filter(el => el.tagName === 'BUTTON' && el.getAttribute('aria-haspopup') === 'menu' && !el.getAttribute('aria-label') && el.querySelector('img'));
        if (profile.length === 1) {
          // The menu opens on pointerdown rather than the synthetic click event.
          profile[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
          profile[0].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
          window.__providersBarProfileOpened = true;
        }
      }
    }
  }
  const texts = scopes.map(el => el.innerText.slice(0, 20000));
  if (id === 'grok') {
    for (const scope of scopes) {
      if (!/(weekly limit|limite hebdomadaire)/i.test(scope.innerText)) continue;
      // Grok renders the total percentage in number-flow's shadow DOM. Its
      // accessible label is the displayed value; the adjacent label states
      // whether it is used. Never substitute a model breakdown or bar width.
      for (const number of scope.querySelectorAll('number-flow-react[aria-label]')) {
        const value = number.getAttribute('aria-label') || '';
        const direction = number.parentElement?.innerText.trim() || '';
        if (visible(number) && /^\d{1,3}(?:[.,]\d+)?\s*%$/.test(value) && /^(used|utilis[ée]s?)$/i.test(direction)) texts.push(`Weekly limit\n${value} ${direction}`);
      }
    }
  }
  // Only bounded quota lines leave the browser. Reset dates require an explicit
  // ISO date; relative/localized ambiguous dates are intentionally left unknown.
  const windows = [];
  const heading = /(?:current usage|utilisation actuelle|5[ -]?(?:hours?|heures?|h)\b(?:\s+(?:usage|limit|limite))?|five[ -]hour(?: usage)?(?: limit)?|weekly(?: usage)?(?: limit)?|hebdomadaire|semaine|monthly(?: usage)?(?: limit)?|mensuel(?:le)?)/gi;
  for (const text of texts) {
    const matches = [...text.matchAll(heading)];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i][0].length;
      const chunk = text.slice(start, Math.min(start + 220, matches[i + 1]?.index ?? text.length));
      let match = chunk.match(/(?:^|\s)(\d{1,3}(?:[.,]\d+)?)\s*%\s*(remaining|left|restants?|disponibles?|used|utilis[ée]s?|consomm[ée]s?)/i);
      if (!match) {
        const reversed = chunk.match(/(remaining|left|restants?|disponibles?|used|utilis[ée]s?|consomm[ée]s?)\s*:?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i);
        if (reversed) match = [reversed[0], reversed[2], reversed[1]];
      }
      if (!match) continue;
      const value = Number(match[1].replace(',', '.'));
      if (value < 0 || value > 100) continue;
      const remaining = /^(remaining|left|restant|disponible)/i.test(match[2]) ? value : 100 - value;
      const name = /current usage|utilisation actuelle/i.test(matches[i][0]) ? 'Période en cours' : /5|five/i.test(matches[i][0]) ? '5 heures' : /week|hebdomadaire|semaine/i.test(matches[i][0]) ? 'Semaine' : 'Mois';
      const reset = chunk.match(/(?:resets?|remise à zéro|réinitialisation)[^\n\d]{0,20}(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/i);
      windows.push({ label: name, remaining, resetAt: reset?.[1] || null });
    }
  }
  const unique = windows.filter((w, i) => windows.findIndex(other => other.label === w.label && other.remaining === w.remaining && other.resetAt === w.resetAt) === i);
  const conflict = unique.some((w, i) => unique.findIndex(other => other.label === w.label) !== i);
  return { authenticated: !login && (authenticated || unique.length > 0), windows: conflict ? [] : unique };
}

function parseAccountUsage(id, result, now = new Date()) {
  const config = accountConfig(id);
  if (result?.blocked === 'challenge') throw Object.assign(new Error(`${config.name} demande une vérification de sécurité du navigateur. La session n’a pas pu être vérifiée automatiquement.`), { code: 'ACCOUNT_BROWSER_CHECK' });
  if (!result?.authenticated) throw Object.assign(new Error(`Session ${config.name} absente ou expirée. Ouvre le compte et connecte-toi. ${config.hint}`), { code: 'ACCOUNT_SIGNIN' });
  if (!Array.isArray(result.windows)) throw new Error('Réponse du compte illisible.');
  if (!result.windows.length) return null;
  const windows = result.windows.map(w => {
    if (!['Période en cours', '5 heures', 'Semaine', 'Mois'].includes(w.label) || typeof w.remaining !== 'number' || !Number.isFinite(w.remaining) || w.remaining < 0 || w.remaining > 100) throw new Error('Quota du compte invalide.');
    if (w.resetAt !== null && (typeof w.resetAt !== 'string' || !Number.isFinite(Date.parse(w.resetAt)))) throw new Error('Date de remise à zéro invalide.');
    return { label: w.label, remaining: Math.round(w.remaining * 100) / 100, resetAt: w.resetAt ? new Date(w.resetAt).toISOString() : null };
  });
  // Main card shows the most constrained window; all windows remain visible.
  const tightest = windows.reduce((a, b) => a.remaining <= b.remaining ? a : b);
  return { source: 'api', connectorVersion: `${id}-account-usage-v1`, updatedAt: now.toISOString(), balances: [], quotaRemaining: tightest.remaining, resetAt: tightest.resetAt, quotaWindows: windows, quotaLabel: `${config.scope} · ${tightest.label}` };
}
module.exports = { accounts, accountConfig, inspectSubscriptionPage, parseAccountUsage };
