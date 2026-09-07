const { connectors } = require('./provider-catalog.cjs');
function finite(value) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('Réponse du fournisseur incomplète ou invalide.');
  return Number(value);
}
function parseResponse(id, body, now = new Date()) {
  const snapshot = { source: 'api', updatedAt: now.toISOString(), quotaRemaining: null, resetAt: null, balances: [] };
  if (id === 'openrouter') {
    const total = finite(body?.data?.total_credits), used = finite(body?.data?.total_usage);
    if (total < 0 || used < 0) throw new Error('Réponse du fournisseur invalide.');
    snapshot.balances = [{ currency: 'USD', remaining: total - used, total, used }];
  } else if (id === 'deepseek') {
    if (!Array.isArray(body?.balance_infos) || !body.balance_infos.length) throw new Error('Aucun solde retourné par DeepSeek.');
    snapshot.balances = body.balance_infos.map(b => {
      if (!['USD', 'CNY'].includes(b.currency)) throw new Error('Devise DeepSeek inconnue.');
      return { currency: b.currency, remaining: finite(b.total_balance) };
    });
  } else if (id === 'runinfra') {
    const cents = value => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Montant RunInfra invalide : un nombre entier de centimes est attendu.');
      return value / 100;
    };
    if (body?.object !== 'credits' || body.currency !== 'usd') throw new Error('Format ou devise RunInfra inconnu.');
    const balance = cents(body.balance_cents), available = cents(body.available_cents), held = cents(body.held_cents);
    if (available < 0 || held < 0 || available !== Math.max(0, balance)) throw new Error('Soldes RunInfra incohérents.');
    // Holds are already accounted for in balance_cents: never subtract them again.
    snapshot.balances = [{ currency: 'USD', remaining: balance }];
    snapshot.details = [
      { label: 'Disponible pour de nouveaux appels', amount: available, currency: 'USD' },
      { label: 'Réservé par les appels en cours (déjà déduit)', amount: held, currency: 'USD' },
    ];
    if (body.period?.spent_cents !== undefined) {
      const spent = cents(body.period.spent_cents);
      if (spent < 0) throw new Error('Dépenses RunInfra invalides.');
      snapshot.details.push({ label: 'Dépenses de la période', amount: spent, currency: 'USD' });
    }
    if (body.as_of !== undefined) {
      if (typeof body.as_of !== 'string' || !Number.isFinite(Date.parse(body.as_of))) throw new Error('Horodatage RunInfra invalide.');
      snapshot.updatedAt = new Date(body.as_of).toISOString();
    }
  } else if (id === 'orcarouter') {
    // This route reports API-key limits (100,000,000 for an unlimited key),
    // not active_workspace.wallet_quota. No value here is a wallet balance.
    throw new Error('OrcaRouter : cette clé donne accès au plafond de la clé, pas au solde du portefeuille. Une connexion au compte est nécessaire.');
  } else throw new Error('Connecteur non disponible.');
  return snapshot;
}
async function fetchUsage(id, key, fetcher = fetch) {
  if (!Object.hasOwn(connectors, id)) throw new Error('Connecteur non disponible.');
  if (connectors[id].mode === 'account') throw new Error('Ce fournisseur nécessite une connexion au compte, pas une clé API.');
  if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n]/.test(key)) throw new Error('Clé invalide.');
  let response;
  try {
    response = await fetcher(connectors[id].endpoint, { method: 'GET', headers: { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('Connexion impossible ou délai dépassé. Vérifie ton accès Internet.'); }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Clé refusée ou expirée.');
    if (response.status === 403) {
      if (id === 'openrouter') throw new Error('Une clé de gestion OpenRouter (Management key) est nécessaire pour lire le solde du compte.');
      if (id === 'runinfra') throw new Error('Utilise une clé d’espace de travail RunInfra : les clés limitées à un déploiement ou endpoint ne peuvent pas lire les crédits.');
      throw new Error('Cette clé ne permet pas de lire le solde.');
    }
    if (response.status === 429) throw new Error('Trop de demandes. Réessaie dans quelques minutes.');
    if (response.status === 404) throw new Error('La route de consultation du solde est indisponible chez ce fournisseur. La clé n’a pas été enregistrée ou remplacée.');
    throw new Error(`Fournisseur indisponible (HTTP ${response.status}).`);
  }
  let body;
  try { body = await response.json(); } catch { throw new Error('Réponse illisible du fournisseur.'); }
  return parseResponse(id, body);
}
module.exports = { fetchUsage, parseResponse };
