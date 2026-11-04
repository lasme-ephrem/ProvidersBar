/* Lasmium TOKENS-HUB — widget compact (renderer).
 * Faits par fournisseur, lignes verticales et en-tête du widget ?mode=quick.
 * Pur affichage : lit l'état global fourni par app.js, ne modifie rien, aucun accès réseau.
 * Dépend de ui-core.js (escapeHtml, icon, money, logo, levelPill, fullDateTime,
 * ollamaFree), de views-shell.js (brand), de views-cards.js (quotaStatusPeriods,
 * quotaPeriodLabel, providerResourceLevel, resourceUnverified), du global
 * ResourceLevels (lib/) et des globals d'app.js (state, syncing) au moment du rendu.
 * renderQuick (app.js) assemble quickHeader et quickAccountRow.
 * Les hooks DOM documentés dans renderer/CONTRAT-UI.md sont conservés.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Widget compact : simple liste abonnements puis API (aucune recommandation)
 * ------------------------------------------------------------------ */
// Widget compact vertical : chaque abonnement affiche TOUTES ses fenêtres et
// chaque API tous ses soldes. Aucune agrégation ni « +N » ne masque une donnée.
function quickFact(label, value, levelName) {
  return { label, value, levelName };
}
function quickSubscriptionFacts(provider) {
  if (provider.id === 'ollama') {
    const facts = [];
    const quota = provider.snapshot?.quotaRemaining;
    if (typeof quota === 'number' && Number.isFinite(quota)) {
      const remaining = Math.max(0, Math.min(100, quota));
      facts.push(quickFact('Limite Free', remaining + '<small>%</small>', ResourceLevels.level(remaining, '%')));
    } else if (provider.snapshot) {
      facts.push(quickFact('Limite Free', 'non communiquée', 'unknown'));
    }
    // Réserve de crédits achetés : affichée dès qu'un montant USD valide existe,
    // quel que soit le connecteur qui l'a produit (clé `usageCredits` du snapshot).
    const reserve = provider.snapshot?.usageCredits;
    if (reserve && reserve.currency === 'USD' && typeof reserve.remaining === 'number'
      && Number.isFinite(reserve.remaining) && reserve.remaining >= 0) {
      facts.push(quickFact('Crédits achetés', money(reserve.remaining, 'USD'),
        ResourceLevels.level(reserve.remaining, 'USD')));
    }
    return facts.length ? facts : [quickFact('Quota', 'Indisponible', 'unknown')];
  }
  const facts = [];
  for (const period of quotaStatusPeriods(provider)) {
    const remaining = period.quota?.remaining;
    if (typeof remaining !== 'number' || !Number.isFinite(remaining)) continue;
    const clamped = Math.max(0, Math.min(100, remaining));
    let label = quotaPeriodLabel(provider, period.key, period.label);
    const group = period.groupName === 'Claude et GPT' ? 'Claude / GPT' : period.groupName;
    if (group && label !== 'Hebdo Argon' && provider.id === 'antigravity') label = group + ' · ' + label;
    if (group && group !== 'Grok' && provider.id === 'grok') label = group + ' · ' + label;
    facts.push(quickFact(label, clamped + '<small>%</small>', ResourceLevels.level(clamped, '%')));
  }
  return facts.length ? facts : [quickFact('Quota', 'Indisponible', 'unknown')];
}
function quickApiFacts(provider) {
  const balances = Array.isArray(provider.snapshot?.balances) ? provider.snapshot.balances : [];
  if (!balances.length) return [quickFact('Solde', 'Indisponible', 'unknown')];
  return balances.map(balance => quickFact(balance.currency,
    money(balance.remaining, balance.currency),
    ResourceLevels.level(balance.remaining, balance.currency)));
}
function quickChip(levelName, unit = '%') {
  return levelPill(levelName, unit, 'quick-level');
}

function quickDetailText(provider) {
  if (provider.type === 'api') {
    const balances = Array.isArray(provider.snapshot?.balances) ? provider.snapshot.balances : [];
    return balances.map(balance => `${money(balance.remaining, balance.currency)} (`
      + `${ResourceLevels.shortLabel(ResourceLevels.level(balance.remaining, balance.currency))})`).join(' · ');
  }
  return quotaStatusPeriods(provider)
    .filter(({ quota }) => typeof quota?.remaining === 'number' && Number.isFinite(quota.remaining))
    .map(period => `${period.groupName ? period.groupName + ' ' : ''}`
      + `${quotaPeriodLabel(provider, period.key, period.label)} : ${period.quota.remaining} %`)
    .join(' · ');
}

function quickAccountRow(provider) {
  const snapshot = provider.snapshot;
  const levelName = providerResourceLevel(provider);
  const unverified = resourceUnverified(provider);
  const facts = provider.type === 'api' ? quickApiFacts(provider) : quickSubscriptionFacts(provider);
  const detailText = quickDetailText(provider);
  const details = [];
  if (detailText) details.push(detailText);
  if (snapshot?.updatedAt) details.push('Dernier relevé : ' + fullDateTime(snapshot.updatedAt));
  if (provider.error) details.push(provider.error);
  const label = provider.name + (provider.error ? ' · relevé à vérifier' : '');
  const factMarkup = facts.map(fact => '<span class="quick-fact">'
    + '<span class="quick-fact-label">' + escapeHtml(fact.label) + '</span>'
    + '<span class="quick-fact-value resource-' + fact.levelName + '">' + fact.value + '</span></span>').join('');
  // Une seule information : elle tient en ligne avec le nom, la ligne reste basse.
  // Un placeholder « Indisponible » n'est pas répété : le chip de niveau suffit.
  const placeholder = facts.length === 1 && facts[0].levelName === 'unknown'
    && facts[0].value === 'Indisponible';
  const inlineFact = facts.length === 1 && !placeholder ? facts[0] : null;
  return '<button type="button" class="quick-row quick-row-stacked resource-' + levelName
    + (unverified ? ' is-stale' : '') + '" data-provider="' + escapeHtml(provider.id) + '" data-action="main"'
    + ' title="' + escapeHtml([label, ...details].join(' — ')) + '">'
    + '<span class="quick-row-head"><span class="quick-provider">'
    + logo(provider, true) + '<span class="provider-name">' + escapeHtml(provider.name)
    + (ollamaFree(provider) ? ' · Free' : '') + '</span></span>'
    + (inlineFact ? '<span class="quick-fact quick-fact-inline">'
      + '<span class="quick-fact-label">' + escapeHtml(inlineFact.label) + '</span>'
      + '<span class="quick-fact-value resource-' + inlineFact.levelName + '">'
      + inlineFact.value + '</span></span>' : '')
    + quickChip(levelName)
    + (unverified ? '<span class="quick-stale" aria-label="Relevé à vérifier" title="Relevé à vérifier">'
      + icon('warning', 12) + '</span>' : '')
    + '</span>'
    + (inlineFact || placeholder ? '' : '<span class="quick-facts">' + factMarkup + '</span>')
    + (detailText ? '<span class="sr-only">' + escapeHtml(detailText) + '</span>' : '')
    + '</button>';
}

function quickHeader({ total, subscriptions, apis }) {
  const autoRefresh = state.settings?.autoRefresh;
  const refreshText = autoRefresh ? 'Auto 5 min · Claude 1 min' : 'Actualisation désactivée';
  const busy = typeof syncing !== 'undefined' && syncing;
  return `<header class="quick-head">${brand}`
    + `<button type="button" class="icon-button" data-action="sync" aria-label="Synchroniser"`
    + ` aria-busy="${busy}" ${busy ? 'disabled' : ''}>${icon('refresh', 16)}</button></header>`
    + `<p class="quick-refresh-status">${icon(autoRefresh ? 'refresh' : 'info', 11)} ${refreshText}`
    + `<span class="quick-count">${total} comptes · ${subscriptions} abonnements · ${apis} API</span></p>`;
}
