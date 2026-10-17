const { connectors } = require('./provider-catalog.cjs');
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const cooldowns = new Map();
function rateLimitError(retryAt) {
  return Object.assign(new Error(`Trop de demandes. Nouvelle lecture possible après ${new Date(retryAt).toLocaleTimeString('fr-FR')}.`), { code: 'API_RATE_LIMIT', retryAt });
}
function finite(value) {
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value)) || !Number.isFinite(Number(value))) throw new Error('Réponse du fournisseur incomplète ou invalide.');
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
    const currencies = new Set();
    snapshot.balances = body.balance_infos.map(b => {
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('Réponse du fournisseur incomplète ou invalide.');
      if (!['USD', 'CNY'].includes(b.currency)) throw new Error('Devise DeepSeek inconnue.');
      if (currencies.has(b.currency)) throw new Error('Soldes DeepSeek ambigus.');
      currencies.add(b.currency);
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
async function fetchUsage(id, key, fetcher = fetch, { sleep = delay, now = Date.now } = {}) {
  if (!Object.hasOwn(connectors, id)) throw new Error('Connecteur non disponible.');
  if (connectors[id].mode === 'account') throw new Error('Ce fournisseur nécessite une connexion au compte, pas une clé API.');
  if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n]/.test(key) || /[\x00-\x20\x7f]/.test(key.trim())) throw new Error('Clé invalide.');
  const fingerprint = `${id}:${createHash('sha256').update(key.trim()).digest('hex')}`;
  for (const [entry, until] of cooldowns) if (until <= now()) cooldowns.delete(entry);
  if (cooldowns.has(fingerprint)) throw rateLimitError(cooldowns.get(fingerprint));
  let response;
  const signal = AbortSignal.timeout(20000);
  // Only read-only GETs are retried, once, within a shared request deadline.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetcher(connectors[id].endpoint, { method: 'GET', headers: { Authorization: `Bearer ${key.trim()}`, Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal });
    } catch {
      if (attempt === 0 && !signal.aborted) { await sleep(350); continue; }
      throw new Error('Connexion impossible ou délai dépassé. Vérifie ton accès Internet et ton proxy Windows.');
    }
    if (attempt === 0 && [502, 503, 504].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      await sleep(350); continue;
    }
    break;
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Clé refusée ou expirée.');
    if (response.status === 403) {
      if (id === 'openrouter') throw new Error('Une clé de gestion OpenRouter (Management key) est nécessaire pour lire le solde du compte.');
      if (id === 'runinfra') throw new Error('Utilise une clé d’espace de travail RunInfra : les clés limitées à un déploiement ou endpoint ne peuvent pas lire les crédits.');
      throw new Error('Cette clé ne permet pas de lire le solde.');
    }
    if (response.status === 429) {
      const header = response.headers?.get('retry-after');
      const parsed = header && (/^\d+(?:\.\d+)?$/.test(header.trim()) ? now() + Number(header) * 1000 : Date.parse(header));
      const until = Math.max(now() + 60000, Number.isFinite(parsed) ? parsed : 0);
      if (cooldowns.size >= 100) cooldowns.delete(cooldowns.keys().next().value);
      cooldowns.set(fingerprint, until);
      throw rateLimitError(until);
    }
    if (response.status === 404) throw new Error('La route de consultation du solde est indisponible chez ce fournisseur. La clé n’a pas été enregistrée ou remplacée.');
    throw new Error(`Fournisseur indisponible (HTTP ${response.status}).`);
  }
  let body;
  try { body = await response.json(); } catch { throw new Error('Réponse illisible du fournisseur.'); }
  return parseResponse(id, body);
}
module.exports = { fetchUsage, parseResponse };
