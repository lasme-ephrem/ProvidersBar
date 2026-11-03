/* ProvidersBar — panneau d'ordre de consommation et rappels (renderer).
 * Moteur pur partagé : lib/usage-strategy.js. Aucun appel réseau, aucune écriture.
 */
'use strict';

function strategyResult() {
  return UsageStrategy.recommend(state.providers, state.strategy);
}

function strategyStatus(item) {
  return ({
    ready: 'Disponible',
    blocked: 'Épuisé / insuffisant',
    unknown: 'À vérifier',
    disabled: 'Exclu',
  })[item.status];
}

function strategyApiPanel(r) {
  const items = r.apiProviders.map((provider, index) =>
    `<li data-api-provider="${escapeHtml(provider.providerId)}">`
    + `<span class="strategy-index" aria-hidden="true">${index + 1}</span>`
    + `${logo(state.providers.find(item => item.id === provider.providerId), true)}`
    + `<div><strong>${escapeHtml(provider.providerName)}</strong></div>`
    + `<span class="strategy-api-cost resource-value ${resourceClass(provider.balance, 'USD')}">`
    + `${money(provider.balance, 'USD')}<small>restants</small></span></li>`).join('');
  return `<section class="strategy-api" aria-label="API disponibles à utiliser">`
    + `<h3>API disponibles à utiliser</h3>`
    + `<p class="hint">Crédits USD restants, du solde le plus élevé au plus faible.</p>`
    + `${r.apiProviders.length
      ? `<ol class="strategy-api-providers">${items}</ol>`
      : '<p class="hint">Aucune API confirmée disponible. Vérifie les connexions, les soldes et les routes retenues.</p>'}`
    + `</section>`;
}

function strategyPanel() {
  const r = strategyResult();
  const first = r.recommended;
  const next = first ? r.queue.slice(1, 4) : [];
  const title = first ? first.modelName
    : r.mode === 'paused' ? 'Recommandations en pause'
      : r.mode === 'verify' ? 'Abonnements à vérifier'
        : 'Aucun abonnement disponible';
  const intro = first
    ? escapeHtml(first.providerName === first.labelOrKind
      ? first.providerName : `${first.providerName} · ${first.labelOrKind}`)
    : r.mode === 'paused' ? 'Réactive les recommandations dans les réglages.'
      : r.mode === 'verify' ? 'Synchronise les quotas ou précise les modèles des abonnements actifs.'
        : 'Les abonnements actifs sont épuisés, exclus ou absents. Les API disponibles sont listées séparément.';
  const nextItems = next.map((item, index) =>
    `<li><span class="strategy-index" aria-hidden="true">${index + 2}</span><div>`
    + `<strong>${escapeHtml(item.modelName)}</strong>`
    + `<span>${escapeHtml(item.providerName)}${item.providerId === 'antigravity'
      ? ` · ${escapeHtml(item.label)}` : ''}</span>`
    + `<small>${escapeHtml(item.reason)}</small></div></li>`).join('');
  const fullOrder = r.queue.length
    ? '<h3>Ordre complet des abonnements disponibles</h3>'
      + `<ol class="strategy-full-order">${r.queue.map(item => `<li>`
        + `<strong>${escapeHtml(item.modelName)}</strong> · ${escapeHtml(item.providerName)}`
        + `${item.providerId === 'antigravity' ? ` · ${escapeHtml(item.label)}` : ''}</li>`).join('')}</ol>`
    : '';
  const reserves = '<h3>Réserves des abonnements actifs</h3><div class="strategy-list">'
    + r.subscriptions.map(item => `<div class="strategy-line"><div>`
      + `<strong>${escapeHtml(item.label)} · ${escapeHtml(item.modelName)}</strong>`
      + `<span>${escapeHtml(item.reason)}</span></div>`
      + `<span class="badge${item.status === 'ready' ? ' badge-live' : ''}">`
      + `${escapeHtml(strategyStatus(item))}</span></div>`).join('')
    + '</div>';
  return '<section class="strategy-panel" aria-label="Ordre de consommation">'
    + '<div class="strategy-heading"><div><p class="eyebrow">TON ORDRE D’USAGE</p>'
    + `<h2>${first ? 'Utilise maintenant' : 'Abonnements actifs'}</h2></div>`
    + '<button type="button" class="secondary" data-action="strategy-settings">Régler l’ordre</button></div>'
    + '<div class="strategy-current">'
    + `${first ? logo(state.providers.find(item => item.id === first.providerId), true) : icon('shield', 24)}`
    + `<div><h3>${escapeHtml(title)}</h3><p>${intro}</p>`
    + `${first ? `<p class="strategy-reason">${escapeHtml(first.reason)}</p>` : ''}</div></div>`
    + `${next.length ? `<ol class="strategy-next" aria-label="Suite des abonnements disponibles">${nextItems}</ol>` : ''}`
    + '<p class="strategy-foot">Recommandations limitées aux abonnements actifs : qualité, puis prochaine '
    + 'remise à zéro à niveau égal. Les modèles sont des choix à confirmer dans tes sélecteurs.</p>'
    + `${r.uncertainSubscriptions.length
      ? `<p class="strategy-foot warning">${r.uncertainSubscriptions.length} réserve(s) d’abonnements `
        + 'actifs à vérifier.</p>' : ''}`
    + strategyApiPanel(r)
    + '<details class="strategy-details" data-disclosure="subscriptions" '
    + `${disclosureState.get('subscriptions') ? 'open' : ''}>`
    + `<summary>Voir le détail des abonnements actifs</summary>${fullOrder}${reserves}</details></section>`;
}

function strategyWidget() {
  const r = strategyResult();
  const first = r.recommended;
  const next = first ? r.queue[1] : null;
  const label = first
    ? `Ouvrir le classement des abonnements. À utiliser maintenant : ${first.modelName} chez ${first.providerName}.`
    : 'Ouvrir le classement des abonnements.';
  const detail = first
    ? `<small>${escapeHtml(first.providerName)} · ${escapeHtml(first.reason)}</small>`
      + `${next ? `<small>Puis ${escapeHtml(next.modelName)} · ${escapeHtml(next.providerName)}</small>` : ''}`
    : '';
  const apiButtons = r.apiProviders.map(provider => {
    const name = escapeHtml(provider.providerName);
    const amount = money(provider.balance, 'USD');
    const levelName = ResourceLevels.level(provider.balance, 'USD');
    const levelText = escapeHtml(ResourceLevels.describe(levelName, 'USD'));
    return `<button type="button" data-action="main" data-api-provider="${escapeHtml(provider.providerId)}"`
      + ` aria-label="${name} : ${amount} de crédits restants · ${levelText}"`
      + ` title="${name} · ${amount} de crédits restants · ${levelText}">`
      + `${logo(state.providers.find(item => item.id === provider.providerId), true)}`
      + `<span class="resource-value ${resourceClass(provider.balance, 'USD')}">${amount}</span>`
      + `<span class="sr-only">${levelText}</span></button>`;
  }).join('');
  return `<button type="button" class="quick-strategy" data-action="main" aria-label="${escapeHtml(label)}">`
    + `<span>${first ? 'ABONNEMENT À UTILISER'
      : r.mode === 'paused' ? 'STRATÉGIE EN PAUSE' : 'ABONNEMENTS'}</span>`
    + `<strong>${escapeHtml(first ? first.modelName
      : r.mode === 'verify' ? 'Quotas ou modèles à préciser'
        : r.mode === 'paused' ? 'Activer dans les réglages' : 'Aucun abonnement disponible')}</strong>`
    + `${detail}</button>`
    + '<section class="quick-api" aria-label="API disponibles à utiliser">'
    + '<h3>API disponibles à utiliser <small>· crédits décroissants</small></h3>'
    + `${r.apiProviders.length
      ? `<div class="quick-api-providers">${apiButtons}</div>`
      : '<p>Aucune API confirmée disponible</p>'}`
    + '</section>';
}

function strategySettings() {
  const config = UsageStrategy.settings(state.strategy);
  const modelFields = UsageStrategy.buckets.map(bucket =>
    `<div class="field"><label for="strategy-model-${bucket.id}">${escapeHtml(bucket.label)}</label>`
    + `<select id="strategy-model-${bucket.id}" name="model:${bucket.id}">`
    + `${['unknown', ...bucket.choices, 'off'].map(id => `<option value="${id}"`
      + `${config.subscriptionModels[bucket.id] === id ? ' selected' : ''}>`
      + `${id === 'off' ? 'Exclure de la stratégie' : escapeHtml(UsageStrategy.models[id].name)}</option>`)
      .join('')}</select></div>`).join('');
  const tokenFields = [
    ['inputTokens', 'Tokens d’entrée', 1, 1000000],
    ['outputTokens', 'Tokens de sortie facturés', 1, 1000000],
    ['cachePercent', 'Entrée relue depuis le cache (%)', 0, 100],
  ].map(([key, label, min, max]) =>
    `<div class="field"><label for="strategy-${key}">${label}</label>`
    + `<input id="strategy-${key}" name="${key}" type="number" min="${min}" max="${max}"`
    + ` step="1" required value="${config[key]}"></div>`).join('');
  const routes = UsageStrategy.routes.map(route =>
    `<label class="check-row"><input name="route:${route.id}" type="checkbox"`
    + ` ${config.disabledRoutes.includes(route.id) ? '' : 'checked'}>`
    + `${escapeHtml(UsageStrategy.models[route.model].name)} · `
    + `${escapeHtml(state.providers.find(item => item.id === route.providerId)?.name || route.providerId)}`
    + '</label>').join('');
  return '<form id="strategy-form" class="settings-panel strategy-settings">'
    + '<div class="section-heading"><h2>Ordre de consommation</h2>'
    + '<span class="badge">Conseil uniquement</span></div>'
    + '<p class="hint">Les recommandations concernent uniquement les abonnements actifs. '
    + 'Les API sont présentées séparément par crédits restants décroissants. Le classement ne lance '
    + 'aucun modèle et ne recharge aucun compte.</p>'
    + `<label class="check-row"><input name="strategyEnabled" type="checkbox"`
    + ` ${config.enabled ? 'checked' : ''}>Afficher les recommandations</label>`
    + '<h3>Modèles accessibles dans tes abonnements</h3>'
    + '<p class="hint">Choisis le modèle proposé dans chaque compte. « À préciser » signale une réserve '
    + 'à vérifier ; « Exclure » retire cette réserve du classement. Les scores sont des repères généraux '
    + 'aux réglages de raisonnement évalués.</p>'
    + `<div class="fields">${modelFields}</div>`
    + '<h3>Profil global pour comparer les coûts API</h3>'
    + '<p class="hint">Même profil pour toutes les tâches. La sortie inclut les tokens de raisonnement '
    + 'facturés. Le cache désigne uniquement les tokens réellement relus depuis le cache.</p>'
    + `<div class="fields">${tokenFields}</div>`
    + `<label class="check-row"><input name="contributor" type="checkbox"`
    + ` ${config.contributor ? 'checked' : ''}>J’accepte Muse Contributor et l’utilisation de mes entrées `
    + 'et sorties pour l’entraînement de Meta.</label>'
    + '<details class="strategy-details" data-disclosure="api-routes"'
    + `${disclosureState.get('api-routes') ? ' open' : ''}>`
    + '<summary>Choisir les routes API à conserver</summary>'
    + '<p class="hint">Décoche une route inaccessible avec ta clé ou que tu ne souhaites pas utiliser. '
    + 'La lecture d’un solde ne vérifie pas les droits d’inférence de chaque modèle.</p>'
    + `<div class="check-list">${routes}</div></details>`
    + `<p class="hint strategy-foot">Tarifs du ${shortDate(UsageStrategy.checkedAt)}. DeepSeek varie `
    + 'selon l’heure UTC ; Luna selon la taille du contexte ; la promotion Gemini est prise en compte '
    + 'jusqu’à fin 2026. Les tarifs du catalogue ne sont pas relus en ligne automatiquement.</p>'
    + '<button class="primary" type="submit">Enregistrer la stratégie</button>'
    + '<p class="form-error" role="alert"></p></form>';
}
