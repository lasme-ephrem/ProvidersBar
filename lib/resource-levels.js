/* Shared visual thresholds for remaining resources; billing prices are excluded. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ResourceLevels = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const labels = { unknown: 'Indisponible', healthy: 'Disponible', low: 'Niveau bas', critical: 'Presque épuisé', empty: 'Épuisé' };
  function level(value, unit) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (unit === '%' && (value < 0 || value > 100))) return 'unknown';
    if (value < 0 && ['USD', 'EUR', 'CNY'].includes(unit)) return 'empty';
    if (!['USD', '%'].includes(unit)) return 'unknown';
    if (value === 0) return 'empty';
    if (value <= (unit === 'USD' ? 2 : 10)) return 'critical';
    if (value <= (unit === 'USD' ? 5 : 25)) return 'low';
    return 'healthy';
  }
  function providerLevel(provider) {
    if (!provider.active || (provider.subscriptionStatus === 'expired' && provider.id !== 'ollama') || !provider.snapshot) return 'unknown';
    const snapshot = provider.snapshot;
    const levels = (snapshot.balances || []).map(b => level(b.remaining, b.currency));
    if (snapshot.quotaWindows?.length) levels.push(...snapshot.quotaWindows.map(w => level(w.remaining, '%')));
    else levels.push(level(snapshot.quotaRemaining, '%'));
    return ['empty', 'critical', 'low', 'healthy'].find(l => levels.includes(l)) || 'unknown';
  }
  return { level, providerLevel, labels };
});
