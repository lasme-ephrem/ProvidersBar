const currencies = ['USD', 'EUR', 'CNY'];
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
  for (const key of ['plan', 'notes']) if (key in patch) {
    if (typeof patch[key] !== 'string' || patch[key].length > 2000) throw new Error('Texte trop long.');
    result[key] = patch[key].trim();
  }
  if ('statusMessage' in patch) {
    if (typeof patch.statusMessage !== 'string' || patch.statusMessage.length > 500) throw new Error('Message de statut trop long.');
    result.statusMessage = patch.statusMessage.trim();
  }
  if ('subscriptionStatus' in patch) {
    if (!['active', 'paused', 'expired'].includes(patch.subscriptionStatus)) throw new Error('Statut d’abonnement invalide.');
    result.subscriptionStatus = patch.subscriptionStatus;
  }
  if ('confirmRenewal' in patch) {
    if (typeof patch.confirmRenewal !== 'boolean') throw new Error('Confirmation de renouvellement invalide.');
    result.confirmRenewal = patch.confirmRenewal;
  }
  for (const key of ['favorite', 'reviewed', 'active']) if (key in patch) {
    if (typeof patch[key] !== 'boolean') throw new Error('Valeur invalide.');
    result[key] = patch[key];
  }
  for (const key of ['amount', 'nextAmount']) if (key in patch) result[key] = number(patch[key], 'Montant');
  for (const key of ['renewalDate', 'priceChangeDate']) if (key in patch) result[key] = dateOnly(patch[key]);
  if ('currency' in patch) {
    if (!currencies.includes(patch.currency)) throw new Error('Devise invalide.');
    result.currency = patch.currency;
  }
  if ('billingCycle' in patch) {
    if (!['unknown', 'monthly', 'yearly', 'one-time'].includes(patch.billingCycle)) throw new Error('Périodicité invalide.');
    result.billingCycle = patch.billingCycle;
  }
  return result;
}
function manualSnapshot(input, now = new Date()) {
  if (!input || !currencies.includes(input.currency)) throw new Error('Devise invalide.');
  const remaining = number(input.balance, 'Solde', { min: -1e12 });
  const quotaRemaining = number(input.quotaRemaining, 'Quota', { max: 100 });
  let resetAt = null;
  if (input.resetAt) {
    if (typeof input.resetAt !== 'string' || !Number.isFinite(Date.parse(input.resetAt))) throw new Error('Date de reset invalide.');
    resetAt = new Date(input.resetAt).toISOString();
  }
  if (remaining === null && quotaRemaining === null) throw new Error('Renseigne un solde ou un quota restant.');
  return { source: 'manual', updatedAt: now.toISOString(), balances: remaining === null ? [] : [{ currency: input.currency, remaining }], quotaRemaining, resetAt };
}
function daysUntil(date, now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.parse(date + 'T00:00:00Z') - today) / 86400000);
}
function summary(providers) {
  const monthly = {};
  let unpriced = 0;
  for (const p of providers.filter(p => isTracked(p) && p.type === 'subscription' && p.subscriptionStatus !== 'expired')) {
    if (p.billingCycle === 'one-time') continue;
    if (p.amount === null || !['monthly', 'yearly'].includes(p.billingCycle)) { unpriced++; continue; }
    monthly[p.currency] = (monthly[p.currency] || 0) + p.amount / (p.billingCycle === 'yearly' ? 12 : 1);
  }
  return { monthly, unpriced };
}
function isTracked(p) { return Boolean(p?.active && p.subscriptionStatus !== 'paused' && (p.subscriptionStatus !== 'expired' || p.id === 'ollama')); }
function asOllamaFreeSnapshot(snapshot) {
  if (!snapshot || snapshot.planTier === 'free') return snapshot;
  return { ...snapshot, balances: [], quotaRemaining: null, resetAt: null, details: [], balanceLabel: 'Limite Free à vérifier' };
}
function expireSubscriptions(providers, now = new Date()) {
  let changed = false;
  for (const p of providers) {
    if (p.id === 'ollama' && p.subscriptionStatus === 'expired') {
      if (!p.active) { p.active = true; changed = true; }
      if (p.snapshot && p.snapshot.planTier !== 'free' && (p.snapshot.balances?.length || p.snapshot.quotaRemaining != null || p.snapshot.resetAt || p.snapshot.details?.length)) {
        p.snapshot = asOllamaFreeSnapshot(p.snapshot);
        changed = true;
      }
    }
    if (p.type !== 'subscription' || p.subscriptionStatus === 'expired' || p.subscriptionStatus === 'paused' || !p.active || !p.renewalDate || daysUntil(p.renewalDate, now) >= 0) continue;
    p.subscriptionStatus = 'expired';
    p.active = p.id === 'ollama';
    p.expiredAt = now.toISOString();
    if (p.id === 'ollama') p.snapshot = asOllamaFreeSnapshot(p.snapshot);
    changed = true;
  }
  return changed;
}
module.exports = { validatePatch, manualSnapshot, summary, daysUntil, dateOnly, isTracked, expireSubscriptions, asOllamaFreeSnapshot };
