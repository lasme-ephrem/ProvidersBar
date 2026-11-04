/* Lasmium TOKENS-HUB — vues du tableau de bord et du widget (renderer).
 * Pur affichage : lit l'état global fourni par app.js, ne modifie rien, aucun accès réseau.
 * Les hooks DOM documentés dans renderer/CONTRAT-UI.md sont conservés.
 */
'use strict';

const NAV_LABELS = {
  overview: 'Vue d’ensemble',
  subscriptions: 'Abonnements',
  history: 'Historique',
  connections: 'Connexions',
  settings: 'Réglages',
};

const brand = `<div class="brand">`
  + `<span class="brand-logo"><img src="../assets/brand/lasmium-mark.svg" alt="" width="42" height="42" draggable="false"></span>`
  + `<span class="brand-text"><span class="brand-name">Lasmium</span>`
  + `<span class="brand-sub">TOKENS-HUB</span></span></div>`;

/* ------------------------------------------------------------------ *
 * Composants de base
 * ------------------------------------------------------------------ */
function heading(kicker, title, description, action = '') {
  return `<header class="page-heading">`
    + `<div class="page-heading-text"><p class="eyebrow">${escapeHtml(kicker)}</p>`
    + `<h1>${escapeHtml(title)}</h1><p class="page-description">${escapeHtml(description)}</p></div>`
    + `${action}</header>`;
}

function syncButton(compact = false) {
  const busy = typeof syncing !== 'undefined' && syncing;
  return `<button class="primary${compact ? ' primary-compact' : ''}" type="button"`
    + ` data-action="sync" aria-busy="${busy}" ${busy ? 'disabled' : ''}>`
    + `${icon('refresh', 16)}<span>${busy ? 'Synchronisation…' : 'Synchroniser'}</span></button>`;
}

function nav(id, label, iconName, count) {
  const active = page === id;
  const badge = count === undefined ? '' : `<span class="nav-count">${count}</span>`;
  return `<button type="button" data-nav="${id}" class="nav-link${active ? ' is-active' : ''}"`
    + `${active ? ' aria-current="page"' : ''}>${icon(iconName, 18)}`
    + `<span class="nav-text">${label}</span>${badge}</button>`;
}

function shell(content, activePage) {
  const label = NAV_LABELS[activePage] || '';
  const now = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<a class="skip-link" href="#main-content">Aller au contenu</a>`
    + `<div class="app-shell">`
    + `<aside class="sidebar">${brand}`
    + `<div class="workspace"><div class="workspace-text"><strong>Espace local</strong>`
    + `<small>Données sur cet appareil</small></div></div>`
    + `<p class="nav-label" id="nav-label-main">Navigation</p>`
    + `<nav class="nav" aria-labelledby="nav-label-main">`
    + nav('overview', NAV_LABELS.overview, 'grid', state.providers.length)
    + nav('subscriptions', NAV_LABELS.subscriptions, 'wallet',
      state.providers.filter(provider => provider.type === 'subscription').length)
    + nav('history', NAV_LABELS.history, 'chart')
    + nav('connections', NAV_LABELS.connections, 'plug')
    + `</nav>`
    + `<div class="sidebar-bottom"><nav class="nav nav-secondary" aria-label="Réglages">`
    + nav('settings', NAV_LABELS.settings, 'settings')
    + `</nav><p class="local-status">${icon('shield', 14)} Données stockées sur cet appareil</p></div>`
    + `</aside>`
    + `<div class="main">`
    + `<header class="topbar"><p class="crumb"><span>Espace local</span>`
    + `<span class="crumb-separator" aria-hidden="true">/</span><span>${escapeHtml(label)}</span></p>`
    + `<div class="top-actions"><span class="local-pill">${icon('shield', 13)} Stockage local</span>`
    + `<time class="today" datetime="${new Date().toISOString().slice(0, 10)}">${now}</time></div></header>`
    + `<main class="content" id="main-content" tabindex="-1">${content}</main>`
    + `</div></div>`;
}

function resourceLegend() {
  return `<p class="resource-legend">Niveaux des ressources restantes : `
    + `<span class="level-pill resource-empty">Épuisé · 0</span> `
    + `<span class="level-pill resource-critical">Critique · ≤ 2 USD ou ≤ 10 %</span> `
    + `<span class="level-pill resource-low">Bas · ≤ 5 USD ou ≤ 25 %</span> `
    + `<span class="level-pill resource-healthy">Suffisant · au-dessus</span> `
    + `<span class="level-pill resource-unknown">Indisponible · aucune donnée</span>. `
    + `Le niveau est toujours écrit en toutes lettres : la couleur ne porte jamais l’information seule. `
    + `Les seuils en dollars ne concernent que les soldes USD et sont distincts du seuil des notifications.</p>`;
}

/* ------------------------------------------------------------------ *
 * Vue d'ensemble : chiffres clés, filtres, cartes
 * ------------------------------------------------------------------ */
function stats() {
  const subscriptions = state.providers.filter(provider => provider.type === 'subscription' && isTracked(provider));
  const apiCount = state.providers.filter(provider => provider.type === 'api' && isTracked(provider)).length;
  const connected = state.providers.filter(provider => provider.connected).length;
  const totals = Object.entries(state.summary.monthly);
  const monthly = totals.length
    ? totals.map(([currency, value]) => money(value, currency)).join(' + ')
    : '—';
  const next = state.providers
    .filter(provider => isTracked(provider) && provider.renewalDate && days(provider.renewalDate) >= 0)
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))[0];
  const autoRefresh = state.settings?.autoRefresh;
  const refreshNote = !autoRefresh
    ? 'Actualisation automatique désactivée'
    : 'Actualisation auto : comptes toutes les 5 min · Claude chaque minute';
  return `<section class="stats" aria-label="Chiffres clés">`
    + `<div class="stat"><p class="stat-label">Services suivis ${icon('grid', 16)}</p>`
    + `<p class="stat-value">${subscriptions.length + apiCount}<small>services</small></p>`
    + `<p class="stat-note">${subscriptions.length} abonnements · ${apiCount} accès API</p></div>`
    + `<div class="stat"><p class="stat-label">Abonnements / mois ${icon('wallet', 16)}</p>`
    + `<p class="stat-value">${monthly}</p><p class="stat-note">`
    + `${state.summary.unpriced
      ? `${state.summary.unpriced} périodicités ou tarifs à préciser`
      : 'Équivalent mensuel des tarifs renseignés'}</p></div>`
    + `<div class="stat"><p class="stat-label">Comptes connectés ${icon('plug', 16)}</p>`
    + `<p class="stat-value accent">${connected}<small>/ ${state.providers.filter(hasConnector).length} connectables</small></p>`
    + `<p class="stat-note">${connected ? refreshNote : 'Connecte un compte pour démarrer le suivi automatique'}</p></div>`
    + `<div class="stat"><p class="stat-label">Prochaine échéance ${icon('clock', 16)}</p>`
    + `<p class="stat-value">${next ? `${days(next.renewalDate)}<small>jours</small>` : '—'}</p>`
    + `<p class="stat-note">${next
      ? `${escapeHtml(next.name)}${next.reviewed ? '' : ' · date à vérifier'}`
      : 'Aucune date à venir renseignée'}</p></div>`
    + `</section>`;
}

function toolbar(activeFilter, queryValue) {
  const filters = [
    ['all', 'Tous les services'],
    ['subscription', 'Abonnements'],
    ['api', 'API'],
    ['favorite', 'Favoris'],
  ];
  return `<div class="toolbar">`
    + `<div class="filters" role="group" aria-label="Filtrer les services">`
    + filters.map(([id, label]) => `<button type="button" data-filter="${id}"`
      + ` class="${activeFilter === id ? 'is-active' : ''}"`
      + ` aria-pressed="${activeFilter === id}">${label}</button>`).join('')
    + `</div>`
    + `<label class="search"><span class="sr-only">Rechercher un service</span>`
    + `${icon('search', 16)}<input id="search" type="search" autocomplete="off"`
    + ` placeholder="Rechercher un service…" aria-label="Rechercher un service"`
    + ` value="${escapeHtml(queryValue)}"></label>`
    + `</div>`;
}

function filteredCards() {
  const providers = state.providers.filter(provider => {
    const matchesFilter = filter === 'all'
      || (filter === 'favorite' ? provider.favorite : provider.type === filter);
    const matchesQuery = provider.name.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  });
  if (!providers.length) {
    return `<div class="empty-state" role="status"><h2>Aucun service trouvé</h2>`
      + `<p>Essaie un autre nom ou un autre filtre.</p></div>`;
  }
  return providers.map(card).join('');
}

function overview() {
  return heading('TOUT SOUS LES YEUX', 'Tes usages, en un regard.',
    'Quotas, crédits et abonnements. Garde le fil de tes outils IA.', syncButton())
    + stats()
    + `<div class="section-heading"><h2>Mes fournisseurs `
    + `<small>${state.providers.length} services</small></h2>`
    + `<p class="section-hint">Ouvre une carte pour la configurer.</p></div>`
    + toolbar(filter, query)
    + `<section class="cards" id="provider-cards" aria-label="Mes fournisseurs">${filteredCards()}</section>`
    + `<div class="bottom-note"><span>${icon('shield', 14)} Tes clés restent chiffrées sur cet appareil.</span>`
    + `<span>Aucune estimation présentée comme un solde réel.</span></div>`
    + resourceLegend();
}

/* ------------------------------------------------------------------ *
 * Badges d'état des fournisseurs
 * ------------------------------------------------------------------ */
function statusBadge(provider) {
  if (provider.subscriptionStatus === 'expired' && !ollamaFree(provider)) {
    return '<span class="badge badge-error">Expiré · désactivé</span>';
  }
  if (!isTracked(provider)) return '<span class="badge badge-warn">En pause</span>';
  if (provider.syncing) return '<span class="badge">Synchronisation…</span>';
  if (provider.id === 'claude' && provider.error?.startsWith('Relevé Claude Desktop ancien')) {
    return '<span class="badge badge-warn">Relevé ancien</span>';
  }
  if (provider.error) {
    if (provider.id === 'claude' && provider.accountSession?.kind === 'claude-live-local') {
      return `<span class="badge badge-error">${provider.claudeSync?.errorCode === 'auth-required'
        ? 'Reconnexion requise' : 'Dernier relevé · reprise en attente'}</span>`;
    }
    if (provider.connected && provider.error.includes('quota indisponible')) {
      return '<span class="badge badge-warn">Quota indisponible</span>';
    }
    return '<span class="badge badge-error">Connexion à vérifier</span>';
  }
  if (ollamaFree(provider) && provider.connected) return '<span class="badge badge-warn">Free · 0 $</span>';
  if (provider.snapshot) {
    if (provider.snapshot.source === 'api' && !provider.connected) {
      return '<span class="badge">Déconnecté · dernier relevé</span>';
    }
    if (Date.now() - Date.parse(provider.snapshot.updatedAt) > FRESHNESS_MS) {
      return '<span class="badge badge-warn">Relevé ancien</span>';
    }
    return `<span class="badge ${provider.snapshot.source === 'api' ? 'badge-live' : ''}">`
      + `${provider.snapshot.source === 'api' ? 'Synchronisé' : 'Saisie manuelle'}</span>`;
  }
  return `<span class="badge">${provider.connected ? 'Compte connecté' : hasConnector(provider) ? 'À connecter' : 'Saisie manuelle'}</span>`;
}

/* ------------------------------------------------------------------ *
 * Santé des connexions
 * ------------------------------------------------------------------ */
function strategyLabel(strategy) {
  return {
    'claude-direct': 'Lecture directe',
    'claude-desktop': 'Claude Desktop',
    'openai-codex': 'Codex',
    'antigravity-local': 'Application locale',
    'ollama-browser': 'Navigateur',
    'orca-session': 'Session OrcaRouter',
    'browser-session': 'Navigateur',
    'account-session': 'Compte',
    'api-key': 'Clé API',
  }[strategy] || 'Automatique';
}

function healthPresentation(provider) {
  if (!provider.connected) {
    return { state: 'idle', label: 'Non connecté', detail: 'Aucune session active pour ce service.' };
  }
  const health = provider.health;
  if (!health) {
    return { state: 'unknown', label: 'Jamais vérifié', detail: 'Lance une vérification pour établir la santé de cette connexion.' };
  }
  const labels = {
    ok: 'À jour',
    stale: 'Relevé ancien',
    auth: 'Reconnexion requise',
    rate: 'Limité',
    drift: 'Interface modifiée',
    down: 'Indisponible',
    error: 'Erreur',
    idle: 'Inactif',
  };
  const details = {
    AUTH_REQUIRED: 'La session ou le jeton doit être renouvelé. Reconnecte ce service.',
    AUTH_EXPIRED: 'La session a expiré. Reconnecte ce service.',
    AUTH_RATE_LIMITED: 'Le renouvellement d’authentification est temporairement limité ; reprise automatique.',
    RATE_LIMITED: 'Le fournisseur limite les lectures ; reprise automatique au prochain cycle.',
    NETWORK: 'Réseau indisponible ; le dernier relevé sain est conservé.',
    TIMEOUT: 'Délai dépassé ; le dernier relevé sain est conservé.',
    UPSTREAM: 'Le fournisseur est momentanément indisponible ; reprise automatique.',
    SCHEMA_DRIFT: 'Réponse valide mais inattendue : aucun faux zéro n’est écrit, le dernier relevé sain est conservé.',
    PARSER_EMPTY: 'Aucune donnée exploitable dans la page ; le dernier relevé sain est conservé.',
    CONFLICT: 'Valeurs contradictoires : le dernier relevé sain est conservé.',
  };
  const state = labels[health.state] ? health.state : 'error';
  let detail = details[health.error?.code] || health.error?.message || 'Dernière lecture réussie.';
  if (state === 'stale') detail = 'La lecture a réussi, mais le relevé date de plus de 10 minutes.';
  if (state === 'ok' && Array.isArray(health.warnings) && health.warnings.length) detail = health.warnings[0];
  if (state === 'ok' && !health.error) detail = `Lecture ${strategyLabel(health.strategy)} · aucune anomalie.`;
  if (health.error?.retryAt) {
    const retry = new Date(health.error.retryAt);
    if (Number.isFinite(retry.getTime())) detail += ` Nouvel essai après ${retry.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
  }
  return { state, label: labels[state] || 'Erreur', detail };
}

function healthPanel() {
  const providers = state.providers.filter(hasConnector);
  const connected = providers.filter(provider => provider.connected);
  const healthy = connected.filter(provider => provider.health?.state === 'ok').length;
  const rows = providers.map(provider => {
    const health = provider.health;
    const presentation = healthPresentation(provider);
    return `<div class="health-row" data-state="${escapeHtml(presentation.state)}">`
      + `<span class="health-dot" aria-hidden="true"></span>`
      + `<div class="health-main"><strong>${escapeHtml(provider.name)}</strong>`
      + `<span class="health-detail">${escapeHtml(presentation.detail)}</span></div>`
      + `<span class="health-strategy">${escapeHtml(strategyLabel(health?.strategy))}</span>`
      + `<span class="health-state">${escapeHtml(presentation.label)}</span>`
      + `<span class="health-age">${health?.lastSuccessAt ? escapeHtml(relativeAge(health.lastSuccessAt)) : '—'}</span>`
      + `<button type="button" class="ghost health-test" data-sync="${escapeHtml(provider.id)}"`
      + `${!provider.connected || provider.syncing ? ' disabled' : ''}>`
      + `${provider.syncing ? 'Lecture…' : 'Tester'}</button>`
      + `</div>`;
  });
  return `<section class="health-panel" aria-labelledby="health-title">`
    + `<div class="health-head"><div><p class="eyebrow">DIAGNOSTIC</p>`
    + `<h2 id="health-title">Santé des connexions</h2>`
    + `<p class="hint">Chaque lecture est typée : une réponse illisible ne remplace jamais le dernier relevé sain.</p></div>`
    + `<span class="health-summary"><strong>${healthy}/${connected.length}</strong> à jour</span></div>`
    + `<div class="health-list">${rows.join('')}</div>`
    + packStatusMarkup()
    + `</section>`;
}

function packStatusMarkup() {
  const packs = Array.isArray(state.connectorPacks) ? state.connectorPacks : [];
  const errors = Array.isArray(state.connectorPackErrors) ? state.connectorPackErrors : [];
  const active = packs.map(pack => `${pack.provider} ${pack.version}`).join(' · ');
  return `<p class="health-packs">${packs.length
    ? `Packs signés actifs : ${escapeHtml(active)}.`
    : 'Aucun pack signé actif ; les connecteurs intégrés restent utilisés.'}`
    + `${errors.length ? ` ${errors.length} pack(s) refusé(s) : ${escapeHtml(errors[0].reason)}.` : ''}</p>`;
}

/* ------------------------------------------------------------------ *
 * Quotas : regroupements et libellés (sémantique conservée)
 * ------------------------------------------------------------------ */
function quotaGroups(provider) {
  if (provider.type !== 'subscription' || provider.id === 'ollama') return [];
  const slots = QuotaResets.slots(provider);
  const groups = [];
  for (const slot of slots) {
    let group = groups.find(item => item.groupKey === slot.group);
    if (!group) {
      let name = slot.group;
      if (provider.id === 'claude' && slot.group === 'Fable') name = '';
      else if (slot.group === 'Claude et GPT') name = 'Claude / GPT';
      else if (provider.id === 'antigravity' && slot.group === 'Gemini 4 Argon') name = 'Argon';
      else if (provider.id === 'grok' && !slot.group) {
        name = provider.snapshot?.usageKind === 'x-subscription-shared'
          ? 'Grok / Bot / Cursor'
          : slots.some(item => item.group === 'Grok Bot') ? 'Grok' : '';
      }
      group = { groupKey: slot.group, name, periods: [] };
      groups.push(group);
    }
    let quota = provider.snapshot?.quotaWindows?.find(window =>
      QuotaResets.canonical(window.label) === slot.key);
    if (!quota && !provider.snapshot?.quotaWindows?.length && slots.length === 1) {
      quota = { remaining: provider.snapshot?.quotaRemaining, resetAt: provider.snapshot?.resetAt };
    }
    group.periods.push({ label: slot.period, key: slot.key, quota });
  }
  return groups;
}

function quotaPeriodLabel(provider, key, label) {
  if (provider.id === 'claude' && key === 'Fable · Semaine') return 'Hebdo Fable';
  if (provider.id === 'antigravity' && key.includes('Argon')) return 'Hebdo Argon';
  if (label === 'Semaine') return 'Hebdo';
  if (label === '5 heures' || label === 'Période en cours') return 'Horaire';
  return label;
}

// Une fenêtre absente du relevé n'est jamais rendue comme une ligne « — ».
function displayedQuotaGroups(provider) {
  const windows = provider.snapshot?.quotaWindows || [];
  if (!windows.length) return [];
  const present = new Set(windows.map(window => QuotaResets.canonical(window.label)));
  return quotaGroups(provider)
    .map(group => ({ ...group, periods: group.periods.filter(period => present.has(period.key)) }))
    .filter(group => group.periods.length);
}

function quotaStatusPeriods(provider) {
  return displayedQuotaGroups(provider).flatMap(group =>
    group.periods.map(period => ({ ...period, groupName: group.name })));
}

function allQuotaPeriodsExhausted(provider) {
  const periods = quotaStatusPeriods(provider);
  if (!periods.length) return false;
  return periods.every(({ quota }) =>
    typeof quota?.remaining === 'number' && Number.isFinite(quota.remaining) && quota.remaining === 0);
}

function providerResourceLevel(provider) {
  const currentLevel = ResourceLevels.providerLevel(provider);
  if (provider.type !== 'subscription' || provider.id === 'ollama' || currentLevel === 'unknown') {
    return currentLevel;
  }
  if ((provider.snapshot?.balances || [])
    .some(balance => ResourceLevels.level(balance.remaining, balance.currency) === 'empty')) {
    return 'empty';
  }
  const periods = quotaGroups(provider).flatMap(group => group.periods);
  if (!periods.some(({ quota }) =>
    typeof quota?.remaining === 'number' && Number.isFinite(quota.remaining))) {
    return ResourceLevels.providerLevel(provider);
  }
  if (allQuotaPeriodsExhausted(provider)) return 'empty';
  const levels = [
    ...(provider.snapshot?.balances || [])
      .map(balance => ResourceLevels.level(balance.remaining, balance.currency)),
    ...periods.map(({ quota }) => ResourceLevels.level(quota?.remaining, '%')),
  ].filter(value => value !== 'unknown' && value !== 'empty');
  return ['critical', 'low', 'healthy'].find(value => levels.includes(value)) || 'unknown';
}

function quotaLimitStatus(provider, key, label, groupName = '') {
  const period = label === 'Semaine' ? 'hebdo'
    : (label === '5 heures' || label === 'Période en cours') ? 'horaire'
      : label.toLocaleLowerCase('fr-FR');
  if (provider.id === 'antigravity' && key.includes('Argon')) {
    return 'Limite hebdo Argon atteinte';
  }
  if (provider.id === 'claude') {
    const model = key.includes(' · ') ? key.slice(0, key.lastIndexOf(' · ')) : '';
    return `Limite ${period}${model ? ' ' + model : ''} atteinte`;
  }
  return `Limite ${groupName ? groupName + ' · ' : ''}${period} atteinte`;
}

function quotaSlotLabel(provider, slot) {
  if (provider.id === 'antigravity' && slot.group === 'Gemini 4 Argon') return 'Hebdo Argon';
  const label = quotaPeriodLabel(provider, slot.key, slot.period);
  if (label === 'Hebdo Fable') return label;
  const group = slot.group === 'Claude et GPT' ? 'Claude / GPT' : slot.group;
  return group ? `${group} · ${label}` : label;
}

function resourceAmount(balance) {
  const levelName = ResourceLevels.level(balance.remaining, balance.currency);
  return `<span class="resource-value resource-${levelName}"`
    + ` title="${escapeHtml(ResourceLevels.describe(levelName, balance.currency))}">`
    + `${money(balance.remaining, balance.currency)}</span>`;
}

function resourceUnverified(provider) {
  return Boolean(provider.error
    || (provider.snapshot?.source === 'api' && !provider.connected)
    || Date.now() - Date.parse(provider.snapshot?.updatedAt) > FRESHNESS_MS);
}

function ollamaUsageCredits(provider) {
  const reserve = provider.id === 'ollama'
    && provider.snapshot?.connectorVersion === 'ollama-monthly-credits-v1'
    ? provider.snapshot.usageCredits : null;
  return reserve?.currency === 'USD'
    && typeof reserve.remaining === 'number'
    && Number.isFinite(reserve.remaining)
    && reserve.remaining >= 0 ? reserve : null;
}

function ollamaReserveMarkup(provider, compact = false) {
  if (provider.id !== 'ollama' || provider.snapshot?.connectorVersion !== 'ollama-monthly-credits-v1') {
    return '';
  }
  const reserve = ollamaUsageCredits(provider);
  const label = reserve?.stale
    ? `Dernière valeur connue · ${age(reserve.observedAt)}`
    : reserve ? 'Réserve supplémentaire' : 'Réserve indisponible';
  const className = compact ? 'quick-ollama-reserve' : 'ollama-reserve';
  const title = reserve?.stale
    ? ` title="Dernier montant lu le ${escapeHtml(new Date(reserve.observedAt).toLocaleString('fr-FR'))}"`
    : '';
  return `<span class="${className}${reserve?.stale ? ' stale' : ''}">`
    + `<span class="reserve-label">${escapeHtml(label)}</span>`
    + `<strong class="resource-value resource-${resourceClass(reserve?.remaining, 'USD').replace('resource-', '')}"${title}>`
    + `${reserve ? money(reserve.remaining, 'USD') : '—'}</strong></span>`;
}

function resourceNotice(provider, compact = false) {
  const levelName = providerResourceLevel(provider);
  if (levelName === 'unknown') return '';
  const emptyBalance = (provider.snapshot?.balances || [])
    .some(balance => ResourceLevels.level(balance.remaining, balance.currency) === 'empty');
  const quotaPeriods = provider.type === 'subscription' && provider.id !== 'ollama'
    ? quotaStatusPeriods(provider) : [];
  const hasQuota = quotaPeriods.some(({ quota }) =>
    typeof quota?.remaining === 'number' && Number.isFinite(quota.remaining));
  let text;
  if (provider.id === 'ollama' && emptyBalance) {
    text = `Crédits inclus épuisés${ollamaUsageCredits(provider)?.remaining > 0 ? ' · réserve disponible' : ''}`;
  } else if (emptyBalance) {
    text = 'Solde épuisé';
  } else if (hasQuota) {
    if (!allQuotaPeriodsExhausted(provider)) return '';
    text = quotaPeriods.length > 1 ? 'Toutes les limites atteintes' : 'Limite atteinte';
  } else if (levelName === 'empty') {
    text = 'Limite atteinte';
  } else {
    return '';
  }
  const className = compact ? 'quick-resource-status' : 'resource-status';
  const suffix = resourceUnverified(provider) ? ' · dernier relevé' : '';
  return `<span class="${className}">${escapeHtml(text + suffix)}</span>`;
}

/* ------------------------------------------------------------------ *
 * Cartes fournisseurs
 * ------------------------------------------------------------------ */
function quotaGroupsMarkup(groups, provider) {
  const periodRank = period => period.label === 'Semaine' ? 0
    : (period.label === '5 heures' || period.label === 'Période en cours') ? 1 : 2;
  return `<div class="quota-groups">${groups.map(group => {
    const sorted = [...group.periods].sort((a, b) => periodRank(a) - periodRank(b));
    const periods = sorted.map(({ label, quota, key }) => {
      const value = quota?.remaining;
      const known = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
      const levelName = known ? ResourceLevels.level(value, '%') : 'unknown';
      const status = known && value === 0
        ? `<p class="quota-period-status">${escapeHtml(quotaLimitStatus(provider, key, label, group.name))}</p>`
        : '';
      const pill = known && value !== 0 ? levelPill(levelName, '%') : '';
      return `<div class="quota-period resource-${levelName}">`
        + `<span class="quota-period-label">${escapeHtml(quotaPeriodLabel(provider, key, label))}</span>`
        + `${meterMarkup(known ? value : undefined,
          `${quotaPeriodLabel(provider, key, label)} : quota restant`)}`
        + `<span class="quota-period-value">${known ? `${value}<small>%</small>` : '—'}</span>`
        + `${pill}${status}${resetMarkup(provider, key)}</div>`;
    }).join('');
    return `<section class="quota-group">`
      + `${group.name ? `<h4>${escapeHtml(group.name)}</h4>` : ''}`
      + `<div class="quota-periods${group.periods.length === 1 ? ' single' : ''}">${periods}</div></section>`;
  }).join('')}</div>`;
}

function expiredCard(provider) {
  const status = statusBadge(provider);
  const message = escapeHtml(provider.statusMessage || 'Aucun renouvellement prévu pour le moment.');
  return `<article class="card expired-card">`
    + `<button type="button" class="card-open" data-open="${escapeHtml(provider.id)}"`
    + ` aria-label="Configurer ${escapeHtml(provider.name)}"></button>`
    + `<div class="card-top">${logo(provider)}`
    + `<div class="provider-title"><h3>${escapeHtml(provider.name)}</h3>`
    + `<p>${escapeHtml(provider.plan && provider.plan !== provider.name ? provider.plan : 'Abonnement')} · expiré</p></div>`
    + `${favoriteButton(provider)}</div>`
    + `<div class="card-content"><p class="expired-title">Abonnement expiré</p>`
    + `<p class="expired-message">${message}</p>`
    + `<div class="card-bottom"><span class="card-meta">Suivi et recommandations arrêtés</span>${status}</div>`
    + `</div></article>`;
}

function favoriteButton(provider) {
  const label = `${provider.favorite ? 'Retirer' : 'Ajouter'} ${escapeHtml(provider.name)} `
    + `${provider.favorite ? 'des' : 'aux'} favoris`;
  return `<button type="button" class="icon-button${provider.favorite ? ' is-selected' : ''}"`
    + ` data-favorite="${escapeHtml(provider.id)}"`
    + ` title="${provider.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}"`
    + ` aria-label="${label}" aria-pressed="${provider.favorite}">${icon('star', 16)}</button>`;
}

function card(provider) {
  if (provider.subscriptionStatus === 'expired' && !ollamaFree(provider)) return expiredCard(provider);
  const snapshot = provider.snapshot;
  const groups = displayedQuotaGroups(provider);
  const levelName = providerResourceLevel(provider);
  const unverified = resourceUnverified(provider);
  let metric;
  let label;
  let note;
  let unit = '%';
  let rawValue = null;
  if (snapshot?.balances?.length) {
    label = escapeHtml(snapshot.balanceLabel || 'Dernier solde connu');
    metric = snapshot.balances.map(resourceAmount).join('<small class="separator"> / </small>');
    note = age(snapshot.updatedAt);
    unit = snapshot.balances[0].currency;
    rawValue = snapshot.balances[0].remaining;
  } else if (snapshot?.quotaRemaining !== null && snapshot?.quotaRemaining !== undefined) {
    label = escapeHtml(snapshot.quotaLabel || 'Quota restant');
    rawValue = snapshot.quotaRemaining;
    metric = `<span class="resource-value resource-${ResourceLevels.level(rawValue, '%')}">`
      + `${quotaDisplay(rawValue, provider.id)}<small>%</small></span>`;
    note = age(snapshot.updatedAt);
  } else if (ollamaFree(provider)) {
    label = 'Limite Free';
    metric = '<span class="unknown">—</span>';
    note = 'Usage de base mensuel · une requête à la fois · limite non communiquée';
  } else if (provider.type === 'subscription') {
    label = 'Tarif renseigné';
    metric = typeof provider.amount === 'number'
      ? money(provider.amount, provider.currency || 'USD') : '<span class="unknown">—</span>';
    note = provider.billingCycle === 'monthly' ? 'par mois'
      : provider.billingCycle === 'yearly' ? 'par an'
        : provider.billingCycle === 'one-time' ? 'paiement unique'
          : 'Périodicité à préciser';
    unit = provider.currency || 'USD';
  } else {
    label = 'Crédits restants';
    metric = '<span class="unknown">—</span>';
    note = 'Connecte le compte ou ajoute un relevé';
  }
  const hasQuota = typeof rawValue === 'number';
  const metricPill = hasQuota ? levelPill(ResourceLevels.level(rawValue, unit), unit) : '';
  const subline = ollamaFree(provider) ? 'Forfait expiré · Free'
    : snapshot?.resetAt ? resetLabel(snapshot.resetAt)
      : provider.type === 'subscription'
        ? (provider.renewalDate
          ? `${days(provider.renewalDate) < 0 ? 'Date passée' : 'Échéance'} · ${shortDate(provider.renewalDate)}`
          : 'Échéance à préciser')
        : '';
  const meta = groups.length ? freshnessMarkup(snapshot?.updatedAt) : escapeHtml(subline);
  const freeHint = ollamaFree(provider)
    ? '<p class="card-hint">Forfait payant expiré · usage Free suivi</p>' : '';
  const claudeHint = provider.id === 'claude'
    ? '<p class="card-hint">Hebdo Fable : disponible avec Max, non incluse avec Pro.</p>' : '';
  const simpleQuota = groups.length ? '' : `<div class="metric-label">${label}</div>`
    + `<div class="metric-row"><p class="metric">${metric}</p>${metricPill}</div>`
    + `<p class="metric-note">${escapeHtml(note)}</p>`
    + `<div class="quota${hasQuota ? ' resource-' + ResourceLevels.level(rawValue, unit) : ''}">`
    + `<div class="quota-label"><span>${hasQuota ? 'Quota restant'
      : ollamaFree(provider) ? 'Limite Free à vérifier'
        : provider.type === 'subscription' ? 'Usage non renseigné' : 'Solde du compte'}</span>`
    + `<strong>${hasQuota ? quotaDisplay(rawValue, provider.id) + ' %' : '—'}</strong></div>`
    + `${meterMarkup(hasQuota ? rawValue : undefined, 'Quota restant')}</div>`;
  return `<article class="card resource-${levelName}${unverified ? ' is-stale' : ''}`
    + `${ollamaFree(provider) && !hasQuota ? ' ollama-free-unknown' : ''}">`
    + `<button type="button" class="card-open" data-open="${escapeHtml(provider.id)}"`
    + ` aria-label="Ouvrir la fiche de ${escapeHtml(provider.name)}"></button>`
    + `<div class="card-top">${logo(provider)}<div class="provider-title">`
    + `<h3>${escapeHtml(provider.name)}</h3>`
    + `<p>${escapeHtml(ollamaFree(provider) ? 'Free · 0 $/mo'
      : provider.plan && provider.plan !== provider.name ? provider.plan : '')
      || (provider.type === 'subscription' ? 'Abonnement' : 'API à la consommation')}`
    + `${provider.active ? '' : ' · en pause'}</p></div>${favoriteButton(provider)}</div>`
    + `<div class="card-content">${freeHint}`
    + `${groups.length
      ? `<p class="metric-label">Quotas restants</p>${quotaGroupsMarkup(groups, provider)}${claudeHint}`
      : simpleQuota}`
    + `${provider.id === 'ollama' ? resetMarkup(provider, 'Mois') : ''}`
    + `${ollamaReserveMarkup(provider)}${resourceNotice(provider)}`
    + `<div class="card-bottom"><span class="card-meta">${meta}</span>`
    + `<span class="card-badges">${levelPill(levelName, unit)}${statusBadge(provider)}</span></div>`
    + `${provider.error ? `<p class="card-error">${escapeHtml(provider.error)}</p>` : ''}`
    + `</div></article>`;
}

/* ------------------------------------------------------------------ *
 * Abonnements
 * ------------------------------------------------------------------ */
function subscriptions() {
  const list = state.providers.filter(provider => provider.type === 'subscription');
  const rows = list.map(provider => {
    const expired = provider.subscriptionStatus === 'expired';
    const status = ollamaFree(provider) ? 'Free · forfait payant expiré'
      : expired ? 'Expiré · désactivé'
        : isTracked(provider)
          ? (provider.reviewed ? 'Informations vérifiées' : 'Informations à vérifier')
          : 'En pause';
    const date = expired
      ? (provider.renewalDate ? `Fin du forfait : ${shortDate(provider.renewalDate)}` : 'Aucun renouvellement prévu')
      : shortDate(provider.renewalDate);
    const past = !expired && provider.renewalDate && days(provider.renewalDate) < 0;
    const dateNote = past ? '<span class="past-date">Date passée · à vérifier</span>' : '';
    const amountText = ollamaFree(provider) ? money(0, 'USD')
      : typeof provider.amount === 'number' ? money(provider.amount, provider.currency || 'USD') : '—';
    const nextAmount = !expired && typeof provider.nextAmount === 'number'
      ? `<span class="price-next">Puis ${money(provider.nextAmount, provider.currency || 'USD')}</span>` : '';
    const billing = { unknown: 'À préciser', monthly: 'Mensuelle', yearly: 'Annuelle', 'one-time': 'Paiement unique' }[provider.billingCycle];
    return `<tr class="${expired ? 'expired-row' : ''}">`
      + `<td><div class="table-name">${logo(provider, true)}<div>`
      + `<strong>${escapeHtml(provider.name)}</strong><small>${status}</small>`
      + `${expired ? `<small class="expired-reason">${escapeHtml(provider.statusMessage || 'Renouvellement indisponible.')}</small>` : ''}`
      + `</div></div></td>`
      + `<td>${amountText}${nextAmount}</td>`
      + `<td class="muted">${escapeHtml(billing || 'À préciser')}</td>`
      + `<td class="${expired ? 'expired-date' : past ? 'warning' : 'muted'}">${date}${dateNote}</td>`
      + `<td><button type="button" class="secondary" data-open="${escapeHtml(provider.id)}"`
      + ` aria-label="Modifier ${escapeHtml(provider.name)}">Modifier</button></td></tr>`;
  });
  return heading('BUDGET & ÉCHÉANCES', 'Tes abonnements.',
    'Retrouve tes tarifs, les abonnements expirés et les prochaines échéances.')
    + stats()
    + `<div class="table-wrap"><table class="data-table">`
    + `<thead><tr><th scope="col">Service</th><th scope="col">Tarif</th>`
    + `<th scope="col">Périodicité</th><th scope="col">Prochaine échéance</th>`
    + `<th scope="col"><span class="sr-only">Actions</span></th></tr></thead>`
    + `<tbody>${rows.join('')}</tbody></table></div>`
    + `<p class="settings-foot">Les abonnements expirés ou en pause sont exclus du budget et de l’ordre `
    + `d’utilisation. Ollama reste synchronisé en Free pour afficher sa limite et ses crédits. `
    + `Leurs anciens relevés restent consultables.</p>`;
}

/* ------------------------------------------------------------------ *
 * Connexions
 * ------------------------------------------------------------------ */
function connections() {
  const cards = state.providers.filter(hasConnector).map(provider => {
    const warning = provider.subscriptionStatus === 'expired'
      ? escapeHtml(provider.statusMessage || (ollamaFree(provider)
        ? 'Forfait payant expiré · suivi Free actif'
        : 'Abonnement expiré · suivi désactivé'))
      : provider.error ? escapeHtml(provider.error) : '';
    return `<section class="connection-card" aria-labelledby="connection-${escapeHtml(provider.id)}">`
      + `<div class="card-top">${logo(provider)}<div class="provider-title">`
      + `<h3 id="connection-${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</h3>`
      + `<p>${escapeHtml(provider.connector.scope)}</p></div>${statusBadge(provider)}</div>`
      + `<p class="connection-description">${escapeHtml(provider.connector.description)}</p>`
      + `${warning ? `<p class="warning">${warning}</p>` : ''}`
      + `<div class="connection-footer">`
      + `<span class="muted connection-age">${provider.connected
        ? freshnessMarkup(provider.snapshot?.updatedAt) || 'Aucun relevé'
        : 'Connexion non configurée'}</span>`
      + `<button type="button" class="primary" data-open="${escapeHtml(provider.id)}" data-tab="connection">`
      + `${icon('plug', 15)} ${provider.connected ? 'Gérer la connexion' : 'Connecter'}</button>`
      + `</div></section>`;
  });
  return heading('SYNCHRONISATION', 'Connecte tes comptes.',
    'Tes soldes et quotas, lus directement auprès des fournisseurs.', syncButton())
    + healthPanel()
    + `<div class="connection-grid">${cards.join('')}</div>`
    + `<div class="info-box"><p>Les clés sont chiffrées par Windows et ne sont jamais incluses dans `
    + `les exports. Les connexions API lisent les crédits. Les autres fournisseurs utilisent chacun `
    + `une session de compte isolée. Aucun modèle n’est appelé.</p></div>`
    + `<p class="hint">Un relevé manuel reste possible depuis la fiche d’un service déconnecté.</p>`;
}

/* ------------------------------------------------------------------ *
 * Historique
 * ------------------------------------------------------------------ */
function graph(entries, provider) {
  const currencies = [...new Set(entries.flatMap(entry =>
    entry.balances.map(balance => balance.currency)))];
  const series = currencies.map(currency => ({
    label: `Solde · ${currency}`,
    points: entries.filter(entry => entry.balances.some(balance => balance.currency === currency))
      .map(entry => ({
        t: Date.parse(entry.updatedAt),
        v: entry.balances.find(balance => balance.currency === currency).remaining,
      })),
  }));
  const quotas = entries.filter(entry => entry.quotaRemaining !== null);
  if (quotas.length) {
    series.push({
      label: 'Quota restant · %',
      points: quotas.map(entry => ({ t: Date.parse(entry.updatedAt), v: entry.quotaRemaining })),
    });
  }
  return series.map(serie => {
    const points = serie.points.sort((a, b) => a.t - b.t);
    const lo = Math.min(...points.map(point => point.v));
    const hi = Math.max(...points.map(point => point.v));
    const first = points[0].t;
    const last = points.at(-1).t;
    const coords = points.map(point => ({
      x: first === last ? 350 : 30 + (point.t - first) / (last - first) * 640,
      y: hi === lo ? 75 : 130 - (point.v - lo) / (hi - lo) * 105,
    }));
    const title = `${provider.name} · ${serie.label}`;
    return `<section class="chart-panel"><h3>${escapeHtml(title)} `
      + `<span class="muted">(${points.length} relevé${points.length > 1 ? 's' : ''})</span></h3>`
      + `<svg viewBox="0 0 700 155" role="img" aria-label="${escapeHtml(serie.label)} : de `
      + `${points[0].v} à ${points.at(-1).v}">`
      + `<path class="chart-grid" d="M30 25H670M30 78H670M30 130H670"/>`
      + `<polyline class="chart-line" points="${coords.map(point => `${point.x},${point.y}`).join(' ')}"/>`
      + coords.map((point, index) => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3.5">`
        + `<title>${escapeHtml(new Date(points[index].t).toLocaleString('fr-FR'))} : ${points[index].v}</title>`
        + `</circle>`).join('')
      + `<text class="chart-axis" x="30" y="14">${hi.toFixed(2)}</text>`
      + `<text class="chart-axis" x="30" y="148">${lo.toFixed(2)}</text></svg>`
      + `<div class="chart-labels"><span>${new Date(first).toLocaleString('fr-FR')}</span>`
      + `<span>${new Date(last).toLocaleString('fr-FR')}</span></div></section>`;
  }).join('');
}

function historyPage() {
  const header = heading('AU FIL DU TEMPS', 'Ton historique d’usage.',
    'Chaque synchronisation et chaque relevé manuel sont conservés.',
    `<button class="secondary" type="button" data-action="export">`
    + `${icon('download', 16)} Exporter</button>`);
  if (!historyLoaded || !Array.isArray(state.history)) {
    if (historyError) {
      return header + `<div class="empty-state" role="alert"><div class="empty-icon">${icon('warning', 28)}</div>`
        + `<h2>Historique indisponible</h2><p>${escapeHtml(historyError)}</p>`
        + `<button type="button" class="secondary" data-action="history-retry">Réessayer</button></div>`;
    }
    return header + `<div class="loading-state" role="status" aria-live="polite">`
      + `<p>Chargement de l’historique…</p></div>`;
  }
  const cutoff = historyPeriod === 'all' ? 0 : Date.now() - Number(historyPeriod) * 86400000;
  const entries = state.history.filter(entry =>
    (historyProvider === 'all' || entry.providerId === historyProvider)
    && Date.parse(entry.updatedAt) >= cutoff);
  const providerOptions = state.providers.map(provider =>
    `<option value="${escapeHtml(provider.id)}"${historyProvider === provider.id ? ' selected' : ''}>`
    + `${escapeHtml(provider.name)}</option>`).join('');
  const periodOptions = [['all', 'Tout l’historique'], ['7', '7 derniers jours'], ['30', '30 derniers jours']]
    .map(([value, label]) => `<option value="${value}"${historyPeriod === value ? ' selected' : ''}>${label}</option>`)
    .join('');
  const filters = `<div class="history-filters">`
    + `<label class="select-field"><span>Service</span>`
    + `<select id="history-provider" aria-label="Service dans l’historique">`
    + `<option value="all">Tous les services</option>${providerOptions}</select></label>`
    + `<label class="select-field"><span>Période</span>`
    + `<select id="history-period" aria-label="Période de l’historique">${periodOptions}</select></label></div>`;
  if (!entries.length) {
    return header + filters + `<div class="empty-state">`
      + `<div class="empty-icon">${icon('chart', 28)}</div>`
      + `<h2>${state.history.length ? 'Aucun relevé sur cette sélection' : 'Ton historique commence ici.'}</h2>`
      + `<p>Connecte l’un de tes comptes API, ou ajoute ton premier relevé manuel. `
      + `Tu retrouveras ici l’évolution de tes soldes et quotas.</p>`
      + `<button type="button" class="primary" data-nav="connections">`
      + `${icon('plug', 16)} Voir les connexions</button></div>`;
  }
  const chart = historyProvider !== 'all'
    ? graph(entries, state.providers.find(provider => provider.id === historyProvider))
    : '<p class="hint">Sélectionne un service pour afficher l’évolution de ses soldes et quotas.</p>';
  const rows = entries.slice(0, 200).map(entry => {
    const name = state.providers.find(provider => provider.id === entry.providerId)?.name;
    const balances = entry.balances.map(balance => money(balance.remaining, balance.currency)).join(' / ');
    const quota = entry.quotaRemaining !== null
      ? `${entry.balances.length ? ' · ' : ''}${quotaDisplay(entry.quotaRemaining, entry.providerId)} %` : '';
    return `<tr><td class="muted">${new Date(entry.updatedAt).toLocaleString('fr-FR')}</td>`
      + `<td>${escapeHtml(name)}</td><td>${balances}${quota}</td>`
      + `<td><span class="badge">${entry.source === 'api' ? 'API' : 'Manuel'}</span></td></tr>`;
  }).join('');
  const truncation = entries.length > 200
    ? 'Les 200 plus récents sont affichés. ' : '';
  return header + filters + chart
    + `<div class="table-wrap"><table class="data-table"><thead><tr>`
    + `<th scope="col">Date du relevé</th><th scope="col">Service</th>`
    + `<th scope="col">Solde / quota restant</th><th scope="col">Source</th>`
    + `</tr></thead><tbody>${rows}</tbody></table></div>`
    + `<p class="settings-foot">${entries.length} relevés · ${truncation}Jusqu’à 5 000 relevés conservés. `
    + `Une variation de solde peut inclure une recharge ; elle ne représente pas nécessairement une dépense.</p>`;
}

/* ------------------------------------------------------------------ *
 * Réglages
 * ------------------------------------------------------------------ */
function settingsPage({ version = null, electronVersion = null, packaged = null, erasePending = false } = {}) {
  const versionText = version ? `Version ${escapeHtml(version)}` : 'Version non exposée';
  const aboutDetail = [electronVersion ? `Electron ${escapeHtml(electronVersion)}` : null,
    packaged === true ? 'Portable Windows' : packaged === false ? 'Mode développement' : null]
    .filter(Boolean).join(' · ');
  const themeOptions = [['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système (Windows)']]
    .map(([value, label]) => {
      const selected = (state.settings.theme || 'light') === value;
      return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
    }).join('');
  const eraseButton = erasePending
    ? `<div class="danger-zone" role="alert"><p><strong>Confirmer l’effacement définitif ?</strong> `
      + `Le prochain clic supprime l’inventaire, l’historique, les connexions et les clés. `
      + `Cette action est irréversible.</p>`
      + `<div class="form-actions"><button type="button" class="secondary" data-action="erase-cancel">Annuler</button>`
      + `<button type="button" class="danger" data-action="erase-data">Effacer définitivement</button></div></div>`
    : `<button type="button" class="danger" data-action="erase-data">Effacer mes données</button>`;
  return heading('À TA MAIN', 'Tes préférences.', 'Un suivi discret, sur ton appareil.')
    + `<form id="settings-form" class="settings-panel" novalidate>`
    + `<label class="settings-row"><span class="settings-row-text"><strong>Apparence</strong>`
    + `<span>Choisis le thème du tableau de bord et du widget. « Système » suit Windows.</span></span>`
    + `<select name="theme" aria-label="Thème de l’application">${themeOptions}</select></label>`
    + `<label class="settings-row"><span class="settings-row-text"><strong>Actualisation automatique</strong>`
    + `<span>Relit Claude chaque minute et les autres comptes toutes les 5 minutes. `
    + `L’application doit rester ouverte, même dans la zone de notification.</span></span>`
    + `<input name="autoRefresh" type="checkbox" ${state.settings.autoRefresh ? 'checked' : ''}></label>`
    + `<label class="settings-row"><span class="settings-row-text"><strong>Notifications Windows</strong>`
    + `<span>Échéance dans les 3 jours, quota inférieur ou égal à 20 % ou solde USD sous le seuil choisi. `
    + `Une alerte par jour et par motif.</span></span>`
    + `<input name="notifications" type="checkbox" ${state.settings.notifications ? 'checked' : ''}></label>`
    + `<label class="settings-row"><span class="settings-row-text"><strong>Alerte de solde faible · USD</strong>`
    + `<span>Ce seuil s’applique uniquement aux soldes en dollars US.</span></span>`
    + `<input name="lowBalance" type="number" min="0" max="10000" step="0.01"`
    + ` value="${state.settings.lowBalance}"></label>`
    + resourceLegend()
    + `<button class="primary" type="submit">Enregistrer les préférences</button>`
    + `<p class="form-error" role="alert"></p></form>`
    + `<section class="settings-panel" aria-labelledby="about-title">`
    + `<div class="section-heading"><h2 id="about-title">À propos</h2>`
    + `<span class="badge" id="app-version">${versionText}</span></div>`
    + `<p class="hint">${aboutDetail ? escapeHtml(aboutDetail) : 'Informations système indisponibles.'}</p>`
    + `<p class="hint privacy-note">${icon('shield', 15)} Aucune télémétrie : Lasmium TOKENS-HUB n’envoie `
    + `aucune donnée d’usage à un serveur Lasmium TOKENS-HUB. Les seules connexions réseau sont celles `
    + `nécessaires à la lecture des soldes chez les fournisseurs que tu as configurés.</p></section>`
    + `<section class="settings-panel" aria-labelledby="data-title">`
    + `<div class="section-heading"><h2 id="data-title">Tes données t’appartiennent</h2></div>`
    + `<p class="hint">Les données et les clés chiffrées sont enregistrées localement. `
    + `L’export contient l’inventaire, les réglages et l’historique, sans les clés. `
    + `Fermer la fenêtre laisse Lasmium TOKENS-HUB accessible près de l’horloge ; un clic droit sur `
    + `l’icône permet de quitter.</p>`
    + `<div class="data-actions"><button type="button" class="secondary" data-action="export">`
    + `${icon('download', 16)} Exporter mes données</button>`
    + `<button type="button" class="secondary" data-action="diagnostic">`
    + `${icon('info', 16)} Diagnostic</button>${eraseButton}</div>`
    + `<p class="form-error" role="alert" id="erase-error"></p></section>`;
}

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

/* ------------------------------------------------------------------ *
 * Fiche détaillée (dialogue)
 * ------------------------------------------------------------------ */
function inputField(label, name, value, type = 'text', extra = '', full = false) {
  return `<div class="field${full ? ' full' : ''}"><label for="${name}">${escapeHtml(label)}</label>`
    + `<input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></div>`;
}

function selectField(label, name, value, options) {
  const items = options.map(([id, text]) =>
    `<option value="${id}"${id === value ? ' selected' : ''}>${text}</option>`).join('');
  return `<div class="field"><label for="${name}">${escapeHtml(label)}</label>`
    + `<select id="${name}" name="${name}">${items}</select></div>`;
}

function providerInfoBody(provider) {
  const currencies = [['USD', 'USD · Dollar US'], ['EUR', 'EUR · Euro'], ['CNY', 'CNY · Yuan']];
  const subscriptionFields = provider.type === 'subscription'
    ? `${selectField('Statut de l’abonnement', 'subscriptionStatus', subscriptionStatus(provider),
      [['active', 'Actif'], ['paused', 'En pause'],
        ['expired', provider.id === 'ollama' ? 'Expiré · Free' : 'Expiré · désactivé']])}`
      + `<div class="field"><label for="statusMessage">Message affiché si expiré</label>`
      + `<textarea name="statusMessage" id="statusMessage" maxlength="500" `
      + `placeholder="Ex. Renouvellement indisponible pour ce plan.">${escapeHtml(provider.statusMessage || '')}</textarea></div>`
      + `${provider.subscriptionStatus === 'expired' ? '<label class="check-row"><input type="checkbox" name="confirmRenewal">'
        + 'Je confirme avoir renouvelé ce forfait</label>' : ''}`
      + `<p class="hint full status-hint">Un forfait expiré sort du budget et des recommandations. `
      + `Ollama reste suivi en Free. Pour réactiver un forfait payant, confirme son renouvellement `
      + `et indique une nouvelle échéance future.</p>`
    : '';
  const amountLabel = ollamaFree(provider) ? 'Ancien tarif du forfait'
    : provider.type === 'subscription' ? 'Tarif' : 'Budget de référence (facultatif)';
  return `<form id="provider-form"><div class="fields">`
    + `${inputField('Offre / formule', 'plan', provider.plan, 'text',
      'maxlength="200" placeholder="Nom de ton offre"', true)}`
    + `${subscriptionFields}`
    + `${inputField(amountLabel, 'amount', provider.amount, 'number',
      'min="0" max="1000000000000" step="0.01" placeholder="Inconnu"')}`
    + `${selectField('Devise', 'currency', provider.currency, currencies)}`
    + `${selectField('Périodicité', 'billingCycle', provider.billingCycle,
      [['unknown', 'À préciser'], ['monthly', 'Mensuelle'], ['yearly', 'Annuelle'], ['one-time', 'Paiement unique']])}`
    + `${inputField(provider.type === 'subscription' && subscriptionStatus(provider) === 'expired'
      ? 'Dernière échéance connue' : 'Prochaine échéance', 'renewalDate', provider.renewalDate, 'date')}`
    + `${inputField('Prochain tarif (facultatif)', 'nextAmount', provider.nextAmount, 'number',
      'min="0" step="0.01" placeholder="Aucun"')}`
    + `${inputField('Date du changement de tarif', 'priceChangeDate', provider.priceChangeDate, 'date')}`
    + `<div class="field full"><label for="notes">Notes</label>`
    + `<textarea name="notes" id="notes" maxlength="2000">${escapeHtml(provider.notes)}</textarea></div></div>`
    + `<label class="check-row"><input type="checkbox" name="reviewed" ${provider.reviewed ? 'checked' : ''}>`
    + `J’ai vérifié les informations de cette fiche</label>`
    + `${provider.type === 'subscription' ? ''
      : `<label class="check-row"><input type="checkbox" name="active" ${provider.active ? 'checked' : ''}>`
        + `Inclure ce service dans le suivi actif</label>`}`
    + `<p class="form-error" role="alert"></p>`
    + `<div class="form-actions"><button type="button" class="secondary" data-action="close-dialog">Annuler</button>`
    + `<button type="submit" class="primary">Enregistrer</button></div></form>`;
}

function providerManualBody(provider) {
  const snapshot = provider.snapshot;
  const balance = snapshot?.balances.find(item => item.currency === provider.currency);
  let localReset = '';
  if (snapshot?.resetAt) {
    const date = new Date(snapshot.resetAt);
    localReset = new Date(date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  if (provider.connected) {
    return `<div class="connection-success">Ce compte est synchronisé automatiquement.</div>`
      + `<p class="hint">Pour saisir un solde manuel, déconnecte d’abord le compte dans l’onglet `
      + `Connexion. Le dernier relevé restera dans l’historique.</p>`;
  }
  const currencies = [['USD', 'USD · Dollar US'], ['EUR', 'EUR · Euro'], ['CNY', 'CNY · Yuan']];
  return `<form id="manual-form"><p class="hint">Saisis une valeur lue sur ton compte. `
    + `Ce relevé sera daté et identifié comme manuel. Un champ vide reste inconnu.</p>`
    + `<div class="fields">`
    + `${inputField('Solde restant', 'balance', balance?.remaining ?? null, 'number',
      'step="0.01" placeholder="Inconnu"')}`
    + `${selectField('Devise du solde', 'currency', provider.currency, currencies)}`
    + `${inputField('Quota restant (%)', 'quotaRemaining', snapshot?.quotaRemaining, 'number',
      'min="0" max="100" step="0.1" placeholder="Inconnu"')}`
    + `${inputField('Prochaine réinitialisation (heure locale)', 'resetAt', localReset, 'datetime-local')}`
    + `</div><p class="form-error" role="alert"></p>`
    + `<div class="form-actions"><button type="submit" class="primary">Enregistrer le relevé</button>`
    + `</div></form>`;
}

function quotaWindowsNote(provider, extra = '') {
  if (!provider.snapshot?.quotaWindows?.length) return '';
  return `<div class="source-note">${provider.snapshot.quotaWindows.map(quotaWindow =>
    `<strong>${escapeHtml(quotaWindow.label)} : ${quotaWindow.remaining} % restants</strong>`
    + `${quotaWindow.resetAt
      ? `<br>Remise à zéro : ${new Date(quotaWindow.resetAt).toLocaleString('fr-FR')}` : ''}`)
    .join('<br>')}${extra ? `<br>${escapeHtml(extra)}` : ''}</div>`;
}

function providerConnectionBody(provider) {
  if (provider.id === 'claude') return claudeConnectionBody(provider);
  if (provider.id === 'antigravity') return antigravityConnectionBody(provider);
  if (!hasConnector(provider)) return '';
  if (provider.connector?.mode === 'account') return accountConnectionBody(provider);
  return apiKeyConnectionBody(provider);
}

function apiKeyConnectionBody(provider) {
  const connectedNote = provider.connected
    ? '<div class="connection-success">Compte connecté · clé enregistrée et chiffrée</div>' : '';
  const details = provider.snapshot?.details?.length
    ? `<div class="source-note">${provider.snapshot.details.map(detail =>
      `${escapeHtml(detail.label)} : <strong>${money(detail.amount, detail.currency)}</strong>`).join('<br>')}`
      + `<br>${age(provider.snapshot.updatedAt)}</div>`
    : '';
  return `${connectedNote}<p class="connection-note">${escapeHtml(provider.connector.instructions)}<br>`
    + `La connexion est vérifiée avant l’enregistrement de la clé.</p>${details}`
    + `<form id="connection-form"><div class="field">`
    + `<label for="api-key">${provider.connected ? 'Remplacer la clé' : escapeHtml(provider.connector.keyLabel)}</label>`
    + `<input id="api-key" name="key" type="password" autocomplete="off" spellcheck="false" required`
    + ` maxlength="4096" placeholder="Colle ta clé ici">`
    + `<small>Ta clé ne sera jamais affichée dans l’historique ou dans un export.</small></div>`
    + `<p class="form-error" role="alert"></p>`
    + `<div class="form-actions">${provider.connected
      ? '<button type="button" class="secondary" data-action="disconnect">Déconnecter</button>' : ''}`
    + `<button type="submit" class="primary">${provider.connected ? 'Vérifier et remplacer' : 'Vérifier et connecter'}</button>`
    + `</div></form>`
    + `${provider.error ? `<div class="divider"></div><p class="form-error">${escapeHtml(provider.error)}</p>` : ''}`;
}

function accountConnectionBody(provider) {
  const prefix = (provider.connector.browserAccount || provider.connector.codexAccount || provider.connector.localAccount)
    ? 'account' : provider.id === 'orcarouter' ? 'orca' : 'ollama';
  const progress = provider.accountConnection;
  const balanceLine = provider.connected && (provider.snapshot?.balances?.length || ollamaUsageCredits(provider))
    ? `<div class="source-note">`
      + `${provider.snapshot?.balances?.length
        ? `<strong>${escapeHtml(provider.snapshot.balanceLabel || 'Solde du portefeuille')} : `
          + `${provider.snapshot.balances.map(balance => money(balance.remaining, balance.currency)).join(' / ')}</strong>`
        : ''}`
      + `${provider.id === 'ollama'
        ? `<br><strong>${ollamaUsageCredits(provider)?.stale ? 'Dernier solde acheté connu' : 'Réserve supplémentaire'} : `
          + `${ollamaUsageCredits(provider) ? money(ollamaUsageCredits(provider).remaining, 'USD') : '—'}</strong>`
          + `${ollamaUsageCredits(provider)?.stale
            ? `<br>Dernière lecture : ${age(ollamaUsageCredits(provider).observedAt)}` : ''}`
        : ''}`
      + `${(provider.snapshot?.details || []).map(detail =>
        `<br>${escapeHtml(detail.label)} : ${money(detail.amount, detail.currency)}`).join('')}`
      + `${provider.snapshot?.resetAt
        ? `<br>Remise à zéro : ${new Date(provider.snapshot.resetAt).toLocaleString('fr-FR')}` : ''}`
      + `<br>${age(provider.snapshot?.updatedAt)}</div>`
    : '';
  const prefixLabel = provider.connector.codexAccount
    ? (provider.connected ? 'Actualiser via Codex' : 'Connecter avec Codex')
    : provider.connected ? 'Ouvrir mon compte' : `Se connecter sur ${escapeHtml(provider.name)}`;
  return `${provider.connected
    ? `<div class="${provider.error ? 'connection-note' : 'connection-success'}">${provider.error
      ? 'Session enregistrée · dernier relevé à vérifier'
      : `Session ${escapeHtml(provider.name)} enregistrée sur cet appareil`}</div>` : ''}`
    + `<p class="connection-note">${escapeHtml(provider.connector.instructions)}</p>`
    + `${progress?.message
      ? `<p class="${progress.status === 'error' ? 'form-error' : 'connection-note'}" role="status"`
        + ` id="${prefix}-connection-progress">${escapeHtml(progress.message)}</p>` : ''}`
    + `${balanceLine}`
    + `<p class="source-note">${provider.id === 'ollama'
      ? (ollamaUsageCredits(provider)?.stale
        ? 'Ollama ne fournit pas de montant plus récent ; cette valeur est le dernier solde acheté confirmé. '
        : 'Le montant des crédits achetés est affiché avec le compte Ollama. ')
      : ''}`
    + `${provider.connector.codexAccount
      ? 'La session est gérée par Codex sur ce PC.'
      : 'La session reste dans un navigateur isolé de l’application.'}`
    + ` Aucun mot de passe n’est lu par Lasmium TOKENS-HUB.</p>`
    + `<div class="form-actions">`
    + `<button type="button" class="secondary" data-action="${prefix}-open">${prefixLabel}</button>`
    + `<button type="button" class="primary" data-action="${prefix}-verify">Vérifier maintenant</button></div>`
    + `<p class="form-error" id="${prefix}-account-error" role="alert"></p>`
    + `${provider.connected
      ? `<div class="form-actions"><button type="button" class="secondary" data-action="disconnect">`
        + `Déconnecter et effacer la session</button></div>` : ''}`
    + `${provider.error ? `<p class="form-error">${escapeHtml(provider.error)}</p>` : ''}`;
}

function claudeConnectionBody(provider) {
  const direct = provider.accountSession?.kind === 'claude-live-local';
  const retry = provider.claudeSync?.nextAttemptAt;
  const windows = provider.snapshot?.quotaWindows?.length
    ? `<div class="source-note">${provider.snapshot.quotaWindows.map(window =>
      `<strong>${escapeHtml(window.label)} : ${window.remaining} % restants</strong>`
      + `${direct ? ` (${Math.round((100 - window.remaining) * 100) / 100} % utilisés)` : ''}`
      + `${window.resetAt ? `<br>Remise à zéro : ${new Date(window.resetAt).toLocaleString('fr-FR')}` : ''}`)
      .join('<br>')}<br>Relevé du ${new Date(provider.snapshot.updatedAt).toLocaleString('fr-FR')}`
      + ` · ${age(provider.snapshot.updatedAt)}</div>`
    : '';
  return `${provider.connected
    ? `<div class="${provider.error ? 'source-note' : 'connection-success'}">${direct
      ? (provider.error ? 'Lecture directe activée · dernier relevé conservé'
        : 'Lecture directe Claude activée · chaque minute')
      : 'Suivi Claude Desktop activé sur ce PC'}</div>` : ''}`
    + `<p class="connection-note">${escapeHtml(provider.connector.instructions)}</p>`
    + `${provider.accountConnection?.message
      ? `<p class="${provider.accountConnection.status === 'error' ? 'form-error' : 'connection-note'}"`
        + ` role="status">${escapeHtml(provider.accountConnection.message)}</p>` : ''}`
    + `<div class="source-note">${direct
      ? 'Source : service de quotas Claude, via le compte connecté dans Claude Code. '
        + 'Lecture chaque minute, renouvellement automatique de la connexion et reprise après une panne. '
        + 'Ce suivi est périodique ; les délais imposés par Claude sont respectés.'
      : 'Source : historique local de Claude Desktop. Détection des nouveaux relevés sous 2 secondes ; '
        + 'Claude Desktop peut espacer ou suspendre ses mesures.'}`
    + `${direct && !state.settings.autoRefresh
      ? '<br><strong>Actualisation automatique désactivée dans Réglages.</strong>' : ''}</div>`
    + `${provider.error && retry && Date.parse(retry) > Date.now()
      ? `<p class="connection-note">Prochaine tentative : ${new Date(retry).toLocaleTimeString('fr-FR')}.</p>` : ''}`
    + `${windows}`
    + `${!direct
      ? `<p class="connection-note">Activer la lecture directe autorise Lasmium TOKENS-HUB à utiliser et `
        + `renouveler la connexion Claude Code existante auprès d’Anthropic pour lire les quotas. `
        + `Les jetons renouvelés sont enregistrés uniquement dans le fichier de connexion Claude Code, `
        + `jamais dans les données Lasmium TOKENS-HUB.</p>`
        + `<div class="form-actions"><button type="button" class="primary" `
        + `data-action="claude-enable-live">Activer la lecture directe (1 min)</button></div>` : ''}`
    + `<div class="form-actions"><button type="button" class="secondary" data-action="account-verify">`
    + `${direct ? 'Actualiser les quotas Claude' : 'Relire le relevé Claude Desktop'}</button></div>`
    + `<p class="form-error" id="account-account-error" role="alert"></p>`
    + `${provider.connected
      ? `<div class="form-actions"><button type="button" class="secondary" data-action="disconnect">`
        + `Arrêter le suivi Claude</button></div>` : ''}`
    + `${provider.error ? `<p class="form-error">${escapeHtml(provider.error)}</p>` : ''}`;
}

function antigravityConnectionBody(provider) {
  return `<p class="connection-note">${escapeHtml(provider.connector.instructions)}</p>`
    + `${provider.accountConnection?.message
      ? `<p class="connection-note" role="status">${escapeHtml(provider.accountConnection.message)}</p>` : ''}`
    + `<div class="source-note">Ces quotas concernent les modèles utilisés dans Antigravity. `
    + `Le pourcentage principal correspond à la limite la plus basse.<br>`
    + `Antigravity 2.0 doit rester ouvert pour l’actualisation automatique.</div>`
    + `${quotaWindowsNote(provider)}`
    + `<div class="form-actions">`
    + `<button type="button" class="primary" data-action="account-open">`
    + `${provider.connected ? 'Actualiser Antigravity' : 'Connecter Antigravity'}</button>`
    + `<button type="button" class="secondary" data-action="account-verify">Vérifier maintenant</button></div>`
    + `<p class="form-error" id="account-account-error" role="alert"></p>`
    + `${provider.connected
      ? `<div class="form-actions"><button type="button" class="secondary" data-action="disconnect">`
        + `Arrêter le suivi Antigravity</button></div>` : ''}`;
}

function dialogTabs(provider, activeTab) {
  const tabs = [['info', 'Informations'], ['manual', 'Relevé manuel'],
    ...(provider.type === 'subscription' ? [['resets', 'Réinitialisations']] : []),
    ...(hasConnector(provider) ? [['connection', 'Connexion']] : [])];
  return `<div class="dialog-tabs" role="tablist" aria-label="Sections de la fiche">`
    + tabs.map(([id, label]) => `<button type="button" role="tab" id="tab-${id}"`
      + ` data-dialog-tab="${id}" aria-selected="${activeTab === id}"`
      + ` aria-controls="dialog-panel" tabindex="${activeTab === id ? '0' : '-1'}"`
      + ` class="dialog-tab${activeTab === id ? ' is-active' : ''}">${label}</button>`).join('')
    + `</div>`;
}

function dialogBody(provider, activeTab) {
  if (activeTab === 'info') return providerInfoBody(provider);
  if (activeTab === 'manual') return providerManualBody(provider);
  if (activeTab === 'resets' && provider.type === 'subscription') return resetForm(provider);
  if (activeTab === 'connection') return providerConnectionBody(provider);
  return providerInfoBody(provider);
}

function dialogMarkup(provider, activeTab) {
  return `<div class="dialog-head">${logo(provider)}`
    + `<div class="dialog-head-text"><h2 id="detail-title">${escapeHtml(provider.name)}</h2>`
    + `<p>${provider.type === 'subscription' ? 'Abonnement' : 'Accès API'} · `
    + `${provider.reviewed ? 'Fiche vérifiée' : 'Fiche à vérifier'}</p>`
    + `${levelPill(providerResourceLevel(provider),
      provider.type === 'api' ? (provider.snapshot?.balances?.[0]?.currency || 'USD') : '%',
      'dialog-level')}</div>`
    + `<button type="button" class="icon-button" data-action="close-dialog" aria-label="Fermer la fiche">`
    + `${icon('close', 20)}</button></div>`
    + dialogTabs(provider, activeTab)
    + `<div class="dialog-body" id="dialog-panel" role="tabpanel"`
    + ` aria-labelledby="tab-${escapeHtml(activeTab)}" tabindex="0">${dialogBody(provider, activeTab)}</div>`;
}
