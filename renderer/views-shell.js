/* Lasmium TOKENS-HUB — coquille du tableau de bord (renderer).
 * Libellés de navigation, marque, en-têtes de page, bouton de synchronisation,
 * légende des niveaux, chiffres clés et barre d'outils (filtres + recherche).
 * Pur affichage : lit l'état global fourni par app.js, ne modifie rien, aucun accès réseau.
 * Dépend de ui-core.js (escapeHtml, icon, money, days, hasConnector, isTracked)
 * et des globals d'app.js (state, page, syncing) au moment du rendu.
 * Expose NAV_LABELS et brand, utilisés par app.js, views-pages.js et views-quick.js.
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
 * Vue d'ensemble : chiffres clés et barre d'outils
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
    : 'Actualisation auto : comptes toutes les 5 min';
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
