const currencies = ['USD', 'EUR', 'CNY'];
const BILLING_CYCLES = ['unknown', 'monthly', 'yearly', 'one-time'];
function dateOnly(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Date invalide.');
  return value;
}
function number(value, label, { min = 0, max = 1e12 } = {}) {
  if (value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} invalide.`);
  return value;
}
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Modification invalide.');
  const result = {};
  // Fiche réduite à l'essentiel (0.6.9) : forfait, prix, fréquence, échéance.
  if ('plan' in patch) {
    if (typeof patch.plan !== 'string' || patch.plan.length > 200) throw new Error('Nom du forfait trop long.');
    result.plan = patch.plan.trim();
  }
  if ('subscriptionStatus' in patch) {
    if (!['active', 'paused', 'expired'].includes(patch.subscriptionStatus)) throw new Error('Statut d’abonnement invalide.');
    result.subscriptionStatus = patch.subscriptionStatus;
  }
  if ('confirmRenewal' in patch) {
    if (typeof patch.confirmRenewal !== 'boolean') throw new Error('Confirmation de renouvellement invalide.');
    result.confirmRenewal = patch.confirmRenewal;
  }
  for (const key of ['favorite', 'active']) if (key in patch) {
    if (typeof patch[key] !== 'boolean') throw new Error('Valeur invalide.');
    result[key] = patch[key];
  }
  if ('amount' in patch) result.amount = number(patch.amount, 'Prix');
  if ('renewalDate' in patch) result.renewalDate = dateOnly(patch.renewalDate);
  if ('currency' in patch) {
    if (!currencies.includes(patch.currency)) throw new Error('Devise invalide.');
    result.currency = patch.currency;
  }
  if ('billingCycle' in patch) {
    if (!BILLING_CYCLES.includes(patch.billingCycle)) throw new Error('Fréquence invalide.');
    result.billingCycle = patch.billingCycle;
  }
  return result;
}
function daysUntil(date, now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.parse(date + 'T00:00:00Z') - today) / 86400000);
}
// Échéance d'un abonnement récurrent dépassée : il reste compté, mais la date
// est à vérifier (renouvellement non confirmé). Les paiements uniques expirent.
function renewalOverdue(p, now = new Date()) {
  return p?.type === 'subscription' && p.subscriptionStatus !== 'expired' && p.billingCycle !== 'one-time'
    && Boolean(p.renewalDate) && daysUntil(p.renewalDate, now) < 0;
}

// Coûts des abonnements suivis, par devise :
// - `monthly` : mensuels + annuels ÷ 12 (récurrents) ;
// - `oneTime` : somme des paiements uniques en cours, quelle que soit leur
//   durée ; chacun sort du total à sa date d'expiration.
function summary(providers, now = new Date(), { apiSpending = null } = {}) {
  const monthly = {}, oneTime = {};
  let unpriced = 0, oneTimeCount = 0, overdue = 0, nextOneTimeEnd = null;
  for (const p of providers.filter(p => isTracked(p) && p.type === 'subscription' && p.subscriptionStatus !== 'expired')) {
    if (p.billingCycle === 'one-time') {
      if (typeof p.amount !== 'number') { unpriced++; continue; }
      if (p.renewalDate && daysUntil(p.renewalDate, now) < 0) continue;
      oneTime[p.currency] = (oneTime[p.currency] || 0) + p.amount;
      oneTimeCount++;
      if (p.renewalDate && (!nextOneTimeEnd || p.renewalDate < nextOneTimeEnd)) nextOneTimeEnd = p.renewalDate;
      continue;
    }
    if (typeof p.amount !== 'number' || !['monthly', 'yearly'].includes(p.billingCycle)) { unpriced++; continue; }
    monthly[p.currency] = (monthly[p.currency] || 0) + p.amount / (p.billingCycle === 'yearly' ? 12 : 1);
    if (renewalOverdue(p, now)) overdue++;
  }
  return { monthly, oneTime, oneTimeCount, nextOneTimeEnd, overdue, unpriced, ...(apiSpending ? { api: apiSpending } : {}) };
}
function isTracked(p) { return Boolean(p?.active && p.subscriptionStatus !== 'paused' && (p.subscriptionStatus !== 'expired' || p.id === 'ollama')); }
function asOllamaFreeSnapshot(snapshot) {
  if (!snapshot || snapshot.planTier === 'free') return snapshot;
  return { ...snapshot, balances: [], quotaRemaining: null, resetAt: null, details: [], balanceLabel: 'Limite Free à vérifier' };
}
// Ollama (0.6.10) : le forfait lu sur le site décide du statut, pas la date.
// « free » → suivi Free compté 0 $ ; un forfait payant explicite (Pro, Max,
// Team, ou « paid ») → abonnement actif compté avec son prix. Après « Je n'ai
// plus cet abonnement » (`endedByUser`), le site peut encore afficher le
// forfait payant jusqu'à la fin de la période réglée : il ne le réactive pas.
const OLLAMA_PAID_PLANS = { pro: 'Pro', max: 'Max', team: 'Team', paid: null };
function applyOllamaPlan(p, snapshot, now = new Date()) {
  if (p?.id !== 'ollama' || snapshot?.source !== 'api' || typeof snapshot.planTier !== 'string') return false;
  if (snapshot.planTier === 'free') {
    let changed = false;
    if (p.subscriptionStatus !== 'expired') { p.subscriptionStatus = 'expired'; p.expiredAt = now.toISOString(); changed = true; }
    if (!p.active) { p.active = true; changed = true; }
    if (p.endedByUser) { delete p.endedByUser; changed = true; }
    return changed;
  }
  if (!Object.hasOwn(OLLAMA_PAID_PLANS, snapshot.planTier) || p.endedByUser) return false;
  let changed = false;
  if (p.subscriptionStatus !== 'active') { p.subscriptionStatus = 'active'; delete p.expiredAt; changed = true; }
  if (!p.active) { p.active = true; changed = true; }
  const name = OLLAMA_PAID_PLANS[snapshot.planTier];
  if (name && p.plan !== name) { p.plan = name; changed = true; }
  return changed;
}

function expireSubscriptions(providers, now = new Date()) {
  let changed = false;
  for (const p of providers) {
    // Le dernier forfait Ollama connu corrige aussi l'ancienne règle de date.
    if (applyOllamaPlan(p, p.snapshot, now)) changed = true;
    if (p.id === 'ollama' && p.subscriptionStatus === 'expired') {
      if (!p.active) { p.active = true; changed = true; }
      if (p.snapshot && p.snapshot.planTier !== 'free' && (p.snapshot.balances?.length || p.snapshot.quotaRemaining != null || p.snapshot.resetAt || p.snapshot.details?.length)) {
        p.snapshot = asOllamaFreeSnapshot(p.snapshot);
        changed = true;
      }
    }
    // Seul un paiement unique expire à sa date (fin de la période payée) ; un
    // abonnement récurrent, Ollama compris, passe « à vérifier ».
    if (p.type !== 'subscription' || p.subscriptionStatus === 'expired' || p.subscriptionStatus === 'paused' || !p.active || !p.renewalDate || daysUntil(p.renewalDate, now) >= 0) continue;
    if (p.billingCycle !== 'one-time') continue;
    p.subscriptionStatus = 'expired';
    p.active = p.id === 'ollama';
    p.expiredAt = now.toISOString();
    if (p.id === 'ollama') p.snapshot = asOllamaFreeSnapshot(p.snapshot);
    changed = true;
  }
  return changed;
}
module.exports = { BILLING_CYCLES, validatePatch, summary, renewalOverdue, daysUntil, dateOnly, isTracked, expireSubscriptions, applyOllamaPlan, asOllamaFreeSnapshot };
