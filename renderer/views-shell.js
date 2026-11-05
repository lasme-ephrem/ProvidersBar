/* Lasmium TOKENS-HUB — coquille du tableau de bord (renderer).
 * Libellés de navigation, marque, en-têtes de page, bouton de synchronisation,
 * barre du haut (recherche, synchronisation, widget, thème, réglages), légende
 * des niveaux, chiffres clés et barre d'outils (filtres).
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

// Barre du haut façon VS Code (fenêtre sans cadre, boutons Windows natifs à
// droite) : marque et page, recherche au centre, puis mise à jour (si
// disponible), synchronisation, widget, thème et réglages.
function titleBarButton(action, iconName, label, extra = '') {
  return `<button type="button" class="titlebar-button" data-action="${action}" title="${escapeHtml(label)}"`
    + ` aria-label="${escapeHtml(label)}"${extra}>${icon(iconName, 16)}</button>`;
}

function titleBar(activePage) {
  const update = state.update || {};
  const busyUpdate = ['downloading', 'extracting', 'installing'].includes(update.state);
  const updatePill = update.available && ['available', 'ready'].includes(update.state)
    ? `<button type="button" class="titlebar-update" data-action="update-install"`
      + ` title="Installer la version ${escapeHtml(update.available.version)} et redémarrer">Mettre à jour</button>`
    : busyUpdate ? '<span class="titlebar-update is-busy" role="status">Mise à jour…</span>' : '';
  const busy = typeof syncing !== 'undefined' && syncing;
  const dark = document.documentElement.dataset.theme === 'dark';
  return `<header class="titlebar" aria-label="Barre de l’application">`
    + `<div class="titlebar-brand"><img src="../assets/brand/lasmium-mark.svg" alt="" width="18" height="18" draggable="false">`
    + `<span class="titlebar-name">Lasmium TOKENS-HUB</span>`
    + `<span class="titlebar-page">${escapeHtml(NAV_LABELS[activePage] || '')}</span></div>`
    + `<label class="titlebar-search"><span class="sr-only">Rechercher un service</span>${icon('search', 14)}`
    + `<input id="search" type="search" autocomplete="off" spellcheck="false" placeholder="Rechercher un service…"`
    + ` aria-label="Rechercher un service" value="${escapeHtml(typeof query === 'string' ? query : '')}"></label>`
    + `<div class="titlebar-actions">${updatePill}`
    + titleBarButton('sync', 'refresh', busy ? 'Synchronisation…' : 'Synchroniser', ` aria-busy="${busy}"${busy ? ' disabled' : ''}`)
    + titleBarButton('toggle-widget', 'widget', 'Ouvrir le widget')
    + titleBarButton('toggle-theme', dark ? 'sun' : 'moon', dark ? 'Passer en thème clair' : 'Passer en thème sombre')
    + titleBarButton('open-settings', 'settings', 'Réglages', activePage === 'settings' ? ' aria-current="page"' : '')
    + `</div></header>`;
}

function nav(id, label, iconName, count) {
  const active = page === id;
  const badge = count === undefined ? '' : `<span class="nav-count">${count}</span>`;
  return `<button type="button" data-nav="${id}" class="nav-link${active ? ' is-active' : ''}"`
    + `${active ? ' aria-current="page"' : ''}>${icon(iconName, 18)}`
    + `<span class="nav-text">${label}</span>${badge}</button>`;
}

function shell(content, activePage) {
  return `<a class="skip-link" href="#main-content">Aller au contenu</a>`
    + titleBar(activePage)
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
// Coûts en clair (0.6.9) : récurrent par mois, paiements uniques à part,
// dépenses API du mois, puis la prochaine échéance.
function stats() {
  const summary = state.summary || {};
  const totals = values => {
    const entries = Object.entries(values || {});
    return entries.length ? entries.map(([currency, value]) => money(value, currency)).join(' + ') : '—';
  };
  const api = summary.api || { month: {}, tracked: 0, topUps: 0 };
  const next = state.providers
    .filter(provider => isTracked(provider) && provider.type === 'subscription' && provider.subscriptionStatus !== 'expired'
      && provider.renewalDate && days(provider.renewalDate) >= 0)
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))[0];
  const recurringNote = summary.overdue
    ? `${summary.overdue} échéance${summary.overdue > 1 ? 's' : ''} à vérifier`
    : summary.unpriced ? `${summary.unpriced} prix ou fréquence à préciser` : 'Mensuels + annuels ÷ 12';
  const oneTimeNote = summary.oneTimeCount
    ? `${summary.oneTimeCount} paiement${summary.oneTimeCount > 1 ? 's' : ''}${summary.nextOneTimeEnd
      ? ` · prochaine fin le ${shortDate(summary.nextOneTimeEnd)}` : ''}`
    : 'Aucun paiement unique en cours';
  const apiNote = api.tracked
    ? `${api.topUps} recharge${api.topUps > 1 ? 's' : ''} détectée${api.topUps > 1 ? 's' : ''} ce mois`
    : 'Indique un montant de départ dans une fiche API';
  return `<section class="stats" aria-label="Chiffres clés">`
    + `<div class="stat"><p class="stat-label">Abonnements / mois ${icon('wallet', 16)}</p>`
    + `<p class="stat-value">${totals(summary.monthly)}</p><p class="stat-note">${recurringNote}</p></div>`
    + `<div class="stat"><p class="stat-label">Paiements uniques en cours ${icon('grid', 16)}</p>`
    + `<p class="stat-value">${totals(summary.oneTime)}</p><p class="stat-note">${escapeHtml(oneTimeNote)}</p></div>`
    + `<div class="stat"><p class="stat-label">Dépenses API · ce mois ${icon('plug', 16)}</p>`
    + `<p class="stat-value accent">${totals(api.month)}</p><p class="stat-note">${apiNote}</p></div>`
    + `<div class="stat"><p class="stat-label">Prochaine échéance ${icon('clock', 16)}</p>`
    + `<p class="stat-value">${next ? `${days(next.renewalDate)}<small>jours</small>` : '—'}</p>`
    + `<p class="stat-note">${next
      ? `${escapeHtml(next.name)} · ${next.billingCycle === 'one-time' ? 'fin du paiement unique' : 'prochain paiement'}`
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
    + `${queryValue ? `<p class="search-note">Recherche : « ${escapeHtml(queryValue)} »</p>` : ''}`
    + `</div>`;
}
