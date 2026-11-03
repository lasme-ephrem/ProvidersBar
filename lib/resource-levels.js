/* Shared visual and textual thresholds for remaining resources; billing prices are excluded. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ResourceLevels = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Single source of truth for colours, legends and accessible labels.
  const thresholds = {
    percent: { critical: 10, low: 25 },
    USD: { critical: 2, low: 5 },
  };
  const labels = {
    unknown: 'Indisponible',
    healthy: 'Disponible',
    low: 'Niveau bas',
    critical: 'Presque épuisé',
    empty: 'Épuisé',
  };
  // Short, colour-independent words shown in badges next to the coloured values.
  const shortLabels = {
    unknown: 'Indisponible',
    healthy: 'Suffisant',
    low: 'Bas',
    critical: 'Critique',
    empty: 'Épuisé',
  };
  function unitThresholds(unit) {
    if (unit === 'USD') return thresholds.USD;
    if (unit === '%') return thresholds.percent;
    return null;
  }
  function level(value, unit) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (unit === '%' && (value < 0 || value > 100))) return 'unknown';
    if (value < 0 && ['USD', 'EUR', 'CNY'].includes(unit)) return 'empty';
    if (!['USD', '%'].includes(unit)) return 'unknown';
    if (value === 0) return 'empty';
    const limit = unitThresholds(unit);
    if (value <= limit.critical) return 'critical';
    if (value <= limit.low) return 'low';
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
  function shortLabel(levelName) {
    return shortLabels[levelName] || shortLabels.unknown;
  }
  // Human-readable level with its threshold; never relies on colour alone.
  function describe(levelName, unit) {
    const limit = unitThresholds(unit);
    const suffix = unit === 'USD' ? 'USD' : '%';
    if (levelName === 'critical') return limit ? `Critique · ≤ ${limit.critical} ${suffix}` : 'Critique';
    if (levelName === 'low') return limit ? `Bas · ≤ ${limit.low} ${suffix}` : 'Bas';
    return shortLabel(levelName);
  }
  return { level, providerLevel, labels, shortLabels, thresholds, unitThresholds, shortLabel, describe };
});
