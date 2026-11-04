# Contrat UI du renderer — ProvidersBar 0.3.0

Document de référence pour l'intégration de la refonte `refonte/pro`.
Propriétaire : `ux-docs` (`task-6`). Tout écart constaté par un autre agent doit être
signalé au Lead avant modification.

**Périmètre écrit :** `renderer/**`, `lib/resource-levels.js`,
`tests/resource-levels.test.cjs`. Aucune modification de `main.cjs`, `preload.cjs`,
`package.json`, des scripts de smoke ou des autres tests.

---

## 1. Fichiers et ordre de chargement

| Fichier | Rôle | Chargé par `renderer/index.html` |
|---|---|---|
| `renderer/theme-init.js` | résolution du thème **avant les CSS** (évite le flash) | ligne 9, sans `defer` |
| `renderer/styles.css` | base, mise en page, composants, widget compact, responsive | lignes 10 |
| `renderer/theme.css` | **tokens sémantiques** clair/sombre, typographie, rayons | ligne 11 |
| `../lib/quota-resets.js` | dates de réinitialisation (inchangé) | ligne 12 |
| `../lib/resource-levels.js` | seuils et libellés de niveau (étendu) | ligne 13 |
| `renderer/ui-core.js` | échappement, formatage, icônes, thème, focus, toasts, niveaux | ligne 14 |
| `renderer/reset-ui.js` | `resetMarkup` / `resetForm` (restructuré) | ligne 15 |
| `renderer/views.js` | toutes les vues, fiches et widget compact | ligne 16 |
| `renderer/app.js` | état, événements, boucle de rendu, actions | ligne 17 |

`renderer/strategy-ui.js` et `renderer/strategy.css` **ont été supprimés** en 0.3.4
avec toute la fonctionnalité d'ordre de consommation ; `../lib/usage-strategy.js`
n'est plus chargé par le renderer (le moteur reste côté `lib/` pour les tests et
l'export, mais l'UI ne l'appelle plus).

Ordre à respecter : `ui-core.js` avant `reset-ui.js` et `views.js` ;
`views.js` avant `app.js`. Aucun script inline, aucun `eval`, aucune dépendance.

**Routes d'aperçu :** `scripts/preview.cjs` sert déjà `/ui-core.js`, `/views.js`,
`styles.css`, `theme.css`, `theme-init.js`, `reset-ui.js`, les deux scripts `lib/` et
les assets ; les routes `strategy*` et `usage-strategy` ont été retirées côté Lead.
`scripts/app-resources.cjs` copie tout `renderer/` : rien à ajouter pour le portable.

---

## 2. Globals et contrat JavaScript

Conservés tels quels (utilisés par `scripts/smoke.cjs`, `smoke-resource-status.cjs`
et `smoke-claude.cjs`) :

| Global | Type | Usage |
|---|---|---|
| `state` | variable globale assignable | état public ; le smoke la remplace et appelle `render()` |
| `page` | `'overview' \| 'subscriptions' \| 'history' \| 'connections' \| 'settings'` | page courante, assignable par le smoke |
| `filter` | `'all' \| 'subscription' \| 'api' \| 'favorite'` | filtre des cartes |
| `query` | chaîne | recherche |
| `render()` | fonction | rendu complet de la fenêtre principale |
| `renderQuick()` | fonction | rendu complet du widget |
| `receiveState(state)` | fonction | réception d'un état différé |
| `statusBadge(provider)` | fonction | badge textuel d'état (smoke l'appelle directement) |
| `QuotaResets`, `ResourceLevels` | globaux de `lib/` | inchangés |

`strategyResult()` et `UsageStrategy` **ne sont plus exposés** par le renderer :
la recommandation d'ordre de consommation a été retirée de l'UI en 0.3.4. Les tests
et le smoke qui s'appuyaient dessus doivent être mis à jour (voir §10).

Nouveaux helpers globaux (non contractuels, peuvent évoluer) :
`escapeHtml`, `money`, `shortDate`, `age`, `relativeAge`, `days`, `resetLabel`,
`icon`, `logo`, `meterMarkup`, `levelPill`, `freshnessMarkup`, `resourceClass`,
`toast`, `announce`, `captureFocus`, `restoreFocus`, `applyTheme`, `shell`, `card`,
`dialogMarkup`, `quickAccountRow`, `settingsPage`, `historyPage`, etc.

Fonctions supprimées ou renommées : `settings()` → `settingsPage(options)`,
`history()` → `historyPage()`, `brand` reste une constante, `applyTheme(value)` →
`applyTheme(preference, { persist })` (accepte `'light' | 'dark' | 'system'`),
`resourceLegend()` reste global. Aucune de ces fonctions n'est utilisée par les smoke.

---

## 3. Structure DOM de la fenêtre principale

```html
<div id="app">
  <a class="skip-link" href="#main-content">Aller au contenu</a>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">…</div>
      <div class="workspace"><div class="workspace-text"><strong>Espace local</strong>…</div></div>
      <p class="nav-label">Navigation</p>
      <nav class="nav" aria-labelledby="nav-label-main">
        <button data-nav="overview" class="nav-link is-active" aria-current="page">…</button>
        <button data-nav="subscriptions">…</button>
        <button data-nav="history">…</button>
        <button data-nav="connections">…</button>
      </nav>
      <div class="sidebar-bottom">
        <nav class="nav nav-secondary" aria-label="Réglages">
          <button data-nav="settings">…</button>
        </nav>
        <p class="local-status">…</p>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">…</header>
      <main class="content" id="main-content" tabindex="-1">…page…</main>
    </div>
  </div>
</div>
```

Sous 900 px CSS (fenêtre étroite **ou zoom 125/150/200 %**), `.sidebar` devient une
barre supérieure horizontale défilable : `.sidebar` n'est **jamais** `display:none`
et les cinq boutons `[data-nav]` restent visibles et focusables. Seuls
`.workspace`, `.nav-label` et `.local-status` (non navigables) sont masqués.

`#detail-dialog` (élément `<dialog>` déclaré dans `index.html`) contient :

```html
<div class="dialog-head">… <h2 id="detail-title">…</h2> …</div>
<div class="dialog-tabs" role="tablist" aria-label="Sections de la fiche">
  <button role="tab" id="tab-info" data-dialog-tab="info" aria-selected="true"
          aria-controls="dialog-panel" class="dialog-tab is-active">Informations</button>
  …
</div>
<div class="dialog-body" id="dialog-panel" role="tabpanel" aria-labelledby="tab-info" tabindex="0">…</div>
```

Le widget (fenêtre `?mode=quick`, **360×560** côté Electron) est rendu dans `#app` :

```html
<main class="quick">
  <header class="quick-head">…<button data-action="sync" aria-label="Synchroniser">…</button></header>
  <p class="quick-refresh-status">Auto 5 min · Claude 1 min
    <span class="quick-count">10 comptes · 6 abonnements · 4 API</span></p>
  <div class="quick-list">
    <p class="quick-group-title">Abonnements</p>
    <button class="quick-row resource-healthy" data-provider="openai" data-action="main">
      <span class="quick-provider">logo 22 px + <span class="provider-name">OpenAI GPT</span></span>
      <span class="quick-value resource-healthy" title="Hebdo : 40 %">
        <span class="quick-value-label">Hebdo</span>
        <span class="quick-value-main">40<small>%</small></span>
        <span class="quick-level">Suffisant</span>
        <span class="quick-extra">+1</span>
      </span>
    </button>
    … (5 autres abonnements)
    <p class="quick-group-title">API</p>
    <button class="quick-row resource-low" data-provider="openrouter" data-action="main">
      <span class="quick-provider">logo + <span class="provider-name">OpenRouter</span></span>
      <span class="quick-value" title="74,50 $US">
        <span class="resource-value resource-low">74,50 $US</span>
        <span class="quick-level">Bas</span>
      </span>
    </button>
    … (3 autres API)
  </div>
  <footer class="quick-footer"><button class="text-button" data-action="main">…</button></footer>
</main>
```

Le widget **n'affiche plus de recommandation** : plus de « À utiliser maintenant »,
de « Puis », de classement ni de section « API disponibles à utiliser » ; c'est une
liste : abonnements d'abord, API ensuite. Le contenu d'un `.quick-row` est
exclusivement constitué d'éléments **phrasing** (`span`, `img`, `small`) : plus de
`<div>`/`<h3>` dans un `<button>`.

---

## 4. Hooks DOM conservés (contrat §3.6)

Vérifiés par audit statique sur toutes les vues :

- Globals : `render`, `receiveState`, `state`, plus `renderQuick`,
  `statusBadge`, `page`, `filter`, `query` (héritage smoke).
  `strategyResult` et `UsageStrategy` ont été retirés (§10).
- Navigation : `[data-nav="overview|subscriptions|history|connections|settings"]`,
  `.sidebar`, `.workspace`, `#app`, `#detail-dialog`, `#toast`.
- Actions : `[data-action="sync|export|disconnect|account-open|
  account-verify|claude-enable-live|ollama-email|main|close-dialog|history-retry"]`
  (`strategy-settings` supprimé).
- Cartes : `.cards .card`, `.card.resource-{level}`, `.card-open[data-open]`,
  `.card-top`, `.card-content`, `.card-bottom`, `.card-error`, `.expired-card`,
  `.expired-row`, `.metric`, `.quota`, `.quota-period`, `.quota-period-label`,
  `.quota-period-value`, `.quota-period-status`, `.meter`, `.resource-value`,
  `.resource-status`, `.badge`, `.ollama-reserve.stale`.
- Recherche/filtres : `#search`, `[data-filter="all|subscription|api|favorite"]`,
  `[data-favorite]`, `.stats`, `.data-table`, `.data-table tbody tr`.
- Connexions : `.connection-card`, `[data-open]` avec `data-tab="connection"`,
  `.connection-success`, `.dialog-body`, `#api-key`, `#connection-form`,
  `#account-connection-progress`, `#orca-connection-progress`,
  `#ollama-connection-progress`.
- Fiche : `[data-dialog-tab="info|manual|resets|connection"]`, `#provider-form`
  (`#plan`, `#amount`, `#currency`, `#billingCycle`, `#renewalDate`, `#nextAmount`,
  `#priceChangeDate`, `#notes`, `#subscriptionStatus`, `#statusMessage`,
  `[name="reviewed"]`, `[name="confirmRenewal"]`, `[name="active"]`),
  `#manual-form` (`#balance`, `#quotaRemaining`, `#resetAt`), `#resets-form`
  (`#reset-date-N`, `#reset-time-N`), `.form-error`.
- Historique : `#history-provider`, `#history-period`, `.chart-panel`,
  `.chart-grid`, `.chart-line`, `.chart-point`, `.data-table`.
- Réglages : `#settings-form`, `[name="theme"]`, `[name="autoRefresh"]`,
  `[name="notifications"]`, `[name="lowBalance"]`, `[data-action="export"]`,
  `[data-action="erase-data"]` / `[data-action="erase-cancel"]`, `#app-version`.
- Widget compact : `.quick`, `.quick-head`, `.quick-refresh-status`, `.quick-count`,
  `.quick-list`, `.quick-group-title`, `.quick-row` (+ `.resource-{level}`),
  `[data-provider]`, `.quick-provider`, `.provider-name`, `.quick-value`,
  `.quick-value-label`, `.quick-value-main`, `.quick-level`, `.quick-extra`,
  `.quick-stale` et `[aria-label="Relevé à vérifier"]` (uniquement sur un relevé
  réellement ancien), `.quick-footer`.
- Textes conservés mot pour mot quand le smoke les vérifie (hors stratégie) :
  « Expiré · désactivé », « En pause », « Synchronisation… », « Relevé ancien »,
  « Connexion à vérifier », « Quota indisponible », « Free · 0 $ »,
  « Déconnecté · dernier relevé », « Synchronisé », « Saisie manuelle »,
  « Compte connecté », « À connecter », « Limite … atteinte »,
  « Limite hebdo Fable atteinte », « Toutes les limites atteintes »,
  « Limite atteinte », « Solde épuisé », « Crédits inclus épuisés ·
  réserve disponible », « Réserve supplémentaire », « Dernière valeur connue »,
  « Grok / Bot / Cursor », « Fin du forfait : … », « Free · 0 $/mo »,
  « Date passée · à vérifier », « heure non précisée », « manuel »,
  toasts « Préférences enregistrées. », « Dates de réinitialisation enregistrées. »,
  « Données exportées, sans les clés. » (`Stratégie enregistrée.` supprimé).

---

## 5. Hooks remplacés ou supprimés (0.3.4)

| Ancien | Nouveau | Raison | Impact smoke |
|---|---|---|---|
| `.strategy-panel`, `.strategy-current`, `.strategy-next`, `.strategy-api`, `.strategy-details`, `[data-disclosure="subscriptions"]` | **supprimés** du tableau de bord | demande utilisateur : plus de suggestion de modèle | `smoke.cjs:103,149,162-192,565-566,641` à supprimer/réécrire |
| `[data-action="strategy-settings"]`, `#strategy-form`, `#strategy-model-*`, `#strategy-inputTokens`, `[name="contributor"]`, `#strategy-form button[type=submit]` | **supprimés** des Réglages et des actions | plus de panneau d'ordre de consommation | `smoke.cjs:134-145,681-683` et `updateStrategy` à retirer du scénario |
| `.quick-strategy`, `.quick-api`, `.quick-api-providers`, `[data-api-provider]` | **supprimés** du widget (liste API sans classement) | plus de recommandation/classement | `smoke.cjs:562-566` à supprimer |
| `.quick-period`, `.quick-period-label`, `.quick-period-status`, `.quick-quota`, `.quick-values`, `.quick-freshness`, `.quick-group-label`, `.quick-ollama-reserve` | **supprimés** ; remplacés par le résumé `.quick-value` par fournisseur | compaction et lisibilité | `smoke-resource-status.cjs` (statuts par fenêtre) et `smoke.cjs:449,463,468,562-566,589-641` à réécrire |
| `.quick-columns` | `.quick-refresh-status` + `.quick-count` (une seule ligne) | en-tête plus court | non utilisé tel quel par le smoke |
| Auto-dimensionnement via `fitQuick()`/`ResizeObserver` | **supprimé** : la fenêtre garde sa taille par défaut (360×560) | widget compact stable | `smoke.cjs` 451-452, 464, 511-518, 526 (tests de redimensionnement) à retirer |
| `.quick-row` en grille 2 lignes | `.quick-row` flex sur une ligne, 32 px | demande utilisateur | nouveaux hooks `.quick-value` à couvrir |
| `.shell` | `.app-shell` | grille de page | non utilisé par le smoke |
| `.workspace` avec « L’atelier de Lasme » + avatar « L » | `.workspace` avec « Espace local » / « Données sur cet appareil » | marque neutre (§3.6) | **`scripts/smoke.cjs:24` doit changer** : `/Lasme/` → `/Espace local/` |
| `nav button.active`, `.filters button.active`, `.dialog-tabs button.active` | `.is-active` (+ `aria-current`/`aria-selected`) | convention d'état unique | non utilisé par le smoke |
| `.badge.error` / `.badge.warn` / `.badge.live` | `.badge-error` / `.badge-warn` / `.badge-live` | tokens sémantiques | non utilisé par le smoke |
| `.icon-button.selected` | `.icon-button.is-selected` | convention d'état | non utilisé par le smoke |
| `.resource-unverified` (opacity `.65`) | classe conservée mais **sans atténuation** ; `.is-stale` | contraste AA sur les relevés anciens | aucun test ne vérifie l'opacité |
| `.reset-date` toujours présent (même sans date) | **absent** si aucune date ; sinon `.reset-date` + `.reset-date-value`, `.is-past`, `.is-compact` | supprime le bruit « Date non fournie » ×5 | `smoke.cjs:450` reste vert (date manuelle zai) ; aucune assertion « Date non fournie » trouvée |
| `#settings` panneau unique + « Version 0.1.0 » | `#app-version` dynamique + panneau « À propos » + « Aucune télémétrie » + bouton `[data-action="erase-data"]` / `[data-action="erase-cancel"]` | version source unique et effacement RGPD | aucun test ne vérifie la version ; nouveaux hooks à couvrir par `quality.test.cjs` si souhaité |
| Thème `light|dark` | `light|dark|system` ; `data-theme-preference` sur `<html>` | suit Windows | `smoke.cjs:23` : le seed par défaut est `theme:'system'` ; remplacer par la valeur calculée ou forcer `light`. |
| `.sidebar` couleurs | **inchangées** : `rgb(234, 240, 233)` clair, `rgb(20, 22, 23)` sombre via `--sidebar-bg` | limiter la casse smoke | `smoke.cjs:25` et `:422` restent verts |
| `styles.css` minifié | CSS lisible (aucune règle minifiée) | maintenabilité | — |

> Les hooks `.quota-period*`, `.resource-status`, `.level-pill`, `.connection-success`,
> `.dialog-body` et les globals `page`/`filter`/`query` restent valables côté cartes,
> fiches et smoke-claude. En revanche, `scripts/smoke-resource-status.cjs` s'appuyait
> sur les statuts **par fenêtre du widget** (`.quick-period-status`,
> `.quick-quota`) : ils n'existent plus dans le widget compact et doivent être
> réécrits (voir §10).

---

## 6. Comportement du thème

1. **Avant le premier rendu** : `theme-init.js` lit `localStorage['providersbar-theme']`
   (`light`, `dark` ou `system`), résout `system` avec
   `matchMedia('(prefers-color-scheme: dark)')`, puis pose
   `<html data-theme="light|dark" data-theme-preference="light|dark|system">`.
   Aucun flash clair/sombre dans le cas normal.
2. **Après réception de l'état** : `app.js` appelle
   `applyTheme(state.settings.theme)`. `state.settings.theme` est la source de
   vérité ; `system` est résolu en direct et persisté tel quel dans
   `localStorage`.
3. **Changement Windows en direct** : `watchSystemTheme()` (ui-core) écoute
   `matchMedia` et met à jour le thème si la préférence est `system` ; `main.cjs`
   reste cohérent via `nativeTheme.shouldUseDarkColors` pour le fond natif.
4. **Réglages** : le select propose `Clair`, `Sombre`, `Système (Windows)` ; la
   valeur est envoyée à `settings:update` (main accepte `system`, contrat §3.2).
5. Les tests qui forcent `document.documentElement.dataset.theme` (smoke
   resource-status) continuent de fonctionner : les CSS ne dépendent que de
   l'attribut `data-theme`, jamais d'une variable JS.

**Contraste (WCAG 2.1, calculé) :** toutes les paires texte/fond des deux thèmes
sont ≥ 4,5:1, y compris `--text-muted`, placeholders, badges, pastilles de niveau,
axe de graphique et boutons `primary`/`danger`. L'indicateur de focus est ≥ 3:1
(`focus` clair `#0b57d0`, sombre `#ffd166`). Aucune donnée n'est atténuée par
`opacity` : un relevé ancien garde son contraste (badge dans les cartes, icône
`.quick-stale` avec `aria-label="Relevé à vérifier"` dans le widget).

---

## 7. Accessibilité livrée

- **Navigation toujours visible** : barre latérale ≥ 900 px, barre supérieure
  horizontale < 900 px ; jamais `display:none` ; lien d'évitement « Aller au contenu ».
- **Focus** : indicateur `:focus-visible` 3 px contrasté sur tous les contrôles ;
  `captureFocus()`/`restoreFocus()` sauvegardent le sélecteur stable
  (`data-nav`, `data-filter`, `data-favorite`, `data-open`, `data-action`,
  `data-dialog-tab`, `data-provider`, `id`, `name`) et la sélection de texte, puis le
  restaurent après chaque rendu complet (actions, IPC, timer 60 s). Le dialogue
  restaure aussi le focus après reconstruction d'onglet.
- **ARIA** : navigation principale nommée + navigation Réglages nommée ; `aria-current`
  sur la page active ; `aria-pressed` sur filtres et favoris ; onglets de fiche
  `role="tablist/tab/tabpanel"` + `aria-selected` + `aria-controls`, flèches
  gauche/droite/Début/Fin ; `role="meter"` avec `aria-valuenow/min/max/valuetext`
  dans les cartes (le widget compact n'affiche plus de jauge) ; `aria-live` global
  `#live-region` pour filtres, recherche, synchronisation, vérification et effacement ;
  `role="alert"` sur les erreurs de formulaire ; `aria-busy` sur les boutons de
  synchronisation ; toasts `role="status"` ; lignes du widget = boutons nommés
  « fournisseur + résumé » et `title` détaillant toutes les fenêtres/soldes.
- **Pas de couleur seule** : `.level-pill` écrit « Épuisé / Critique / Bas / Suffisant »,
  `Indisponible`, `aria-valuetext` inclut le seuil, `resource-status` et
  `quota-period-status` sont textuels, le widget affiche toujours `.quick-level`
  (même vocabulaire), la légende complète est affichée sur Vue d'ensemble **et** dans
  Réglages ; un relevé ancien est signalé par une icône avec `aria-label`.
- **Typographie** : plancher 11 px (`--text-xs`), 12 px pour les libellés, 13 px de
  corps, 15–26 px pour les titres ; aucune règle à 8, 9 ou 10 px.
- **Cibles** : boutons ≥ 32–34 px, liens de navigation ≥ 38 px, cases à cocher 18–20 px
  dans une ligne `.check-row`.
- **Mouvement** : `prefers-reduced-motion` neutralise transitions et animations
  (y compris le chargement). `forced-colors` ajoute bordures et `Highlight` aux
  composants critiques.
- **Langue** : `<html lang="fr">`, textes UI en français, dates/monnaies `fr-FR`.
- **Logos** : `alt=""` quand le nom du fournisseur est adjacent (décoratif), jamais
  utilisé seul comme unique identification d'un bouton (les boutons API du widget ont
  un `aria-label` complet).

---

## 8. Widget compact : dimensions, contenu, défilement

- **Dimensions cibles : 360 × 560 px** (fenêtre Electron modifiée par l'architecte en
  parallèle). Le rendu a été mesuré au format 360×560, échelle 1× et 2×, via le
  serveur d'aperçu : capture `test-results/widget-compact.png`.
- **Aucun auto-dimensionnement** : `fitQuick()`/`ResizeObserver` ont été retirés du
  renderer ; la fenêtre garde sa taille par défaut. La liste ne défile que si le
  contenu dépasse réellement (`scrollHeight <= clientHeight` attendu en 360×560), avec
  une barre fine de 5 px (`.quick-list::-webkit-scrollbar`, `scrollbar-width: thin`).
- **Structure** : en-tête 26 px (marque + bouton synchroniser 26 px), une ligne de
  statut (`Auto 5 min · Claude 1 min` ou `Actualisation désactivée`) suivie du compte
  `N comptes · X abonnements · Y API`, puis la liste :
  - titre `Abonnements` (11 px, capitales) et les abonnements actifs (6 en seed) ;
  - titre `API` et les accès API actifs (4 en seed), avec leur solde.
  L'ordre suit l'inventaire ; aucun classement, aucune recommandation, aucun « À
  utiliser maintenant / Puis ».
- **Lignes** : 32 px de hauteur minimale, une seule ligne, contenu uniquement
  phrasing (`span`, `img`, `small`). Icône 20×20 px dans un carré de 24 px, nom 12 px
  tronqué par ellipsis, valeur 11–12 px alignée à droite, pastille de niveau
  **textuelle** (`.quick-level`, ex. « Suffisant », « Bas »), badge `+N` si plusieurs
  fenêtres/soldes.
  - Abonnement : résumé de la fenêtre la plus contrainte (`Hebdo 40 % · Bas +1`) ;
    le détail de toutes les fenêtres est dans le `title` de la valeur.
  - API : solde le plus contraint (`74,50 $US · Bas`) ; les autres devises sont
    résumées par `+N` et détaillées dans le `title`.
  - Quota/solde inconnu : « — » + « Indisponible » (texte accessible), aucune barre,
    aucun faux pourcentage.
  - Relevé ancien/erreur : icône d'avertissement `.quick-stale` avec
    `aria-label="Relevé à vérifier"` ; sinon l'heure du relevé reste dans le `title`.
- **État vide** : « Aucun compte à afficher. »
- **Actualisation** : `.quick-refresh-status` reflète `state.settings.autoRefresh`
  (« Auto 5 min · Claude 1 min » ou « Actualisation désactivée »).
- **Accessibilité** : chaque ligne est un bouton `[data-provider][data-action="main"]`
  dont le nom accessible contient fournisseur + résumé ; `aria-busy` sur le bouton de
  synchronisation ; `:focus-visible` conservé ; aucun texte < 11 px.

---

## 9. Réglages : version, marque neutre, effacement

- **Version dynamique** : `window.providersBar.getAppInfo()` → `#app-version`
  (« Version 0.3.0 »), avec repli sur `state.app.version`, puis « Version non exposée »
  si les deux sont absents. Aucune version en dur dans le renderer.
- **Marque neutre** : plus de « L'atelier de Lasme », plus d'avatar « L » ;
  l'espace local est présenté comme « Espace local ».
- **Effacement** : bouton « Effacer mes données » → premier clic : zone
  `role="alert"` de confirmation + boutons « Annuler » / « Effacer définitivement » ;
  second clic : `eraseData()` ; message de succès, rechargement de l'état, annonce
  live. Si l'API est absente (aperçu / version antérieure), toast explicite.
  Un délai de 10 s annule la confirmation.
- **Télémétrie** : mention explicite « Aucune télémétrie : ProvidersBar n'envoie
  aucune donnée d'usage à un serveur ProvidersBar. »
- **Export** : bouton `[data-action="export"]` conservé (historique + réglages).
- **Thème** : select à trois valeurs (`light`, `dark`, `system`).
- **Ordre de consommation retiré** : le formulaire `#strategy-form` (modèles,
  exclusions, routes, profil de tokens, Contributor) n'est plus rendu dans Réglages,
  et l'action `[data-action="strategy-settings"]` a disparu du tableau de bord.

### 9.1 Repli Claude Desktop après activation de la lecture directe

Depuis T9, `main.cjs` peut basculer explicitement en lecture Claude Desktop quand
le renouvellement du jeton Claude Code est refusé : l'état retourné par
`claude:enable-live` contient alors `provider.accountSession.kind =
'claude-desktop-local'` et `provider.accountConnection.message =
« Lecture directe indisponible (renouvellement du jeton Claude Code limité) ;
ProvidersBar utilise le relevé Claude Desktop. »`.

Le renderer (`renderer/app.js`, branche `claude-enable-live` de `runAction`) lit
cet état après l'appel et applique deux retours distincts :

| État retourné | Toast (rôle `status`, `#toast`) |
|---|---|
| lecture directe réellement active (`accountSession.kind === 'claude-live-local'`) | « Lecture directe Claude activée. » (inchangé) |
| bascule Desktop, tout autre cas | « Connexion Claude mise à jour : relevé Claude Desktop utilisé. » |

Aucun message « lecture directe active » n'est affiché en cas de bascule. La fiche
Claude rend toujours le message de bascule via
`provider.accountConnection.message` (paragraphe `role="status"` dans l'onglet
Connexion) ainsi que « Suivi Claude Desktop activé sur ce PC » dans
`.connection-success` ; `renderDialog()` est appelé avant le toast pour que la fiche
soit déjà à jour. Aucun hook DOM nouveau : `[data-action="claude-enable-live"]`,
`#account-account-error` et `#toast` sont inchangés.

---

## 10. Points à mettre à jour dans les scripts (hors périmètre ux-docs)

### `scripts/smoke.cjs`

**Bloc stratégie à supprimer/réécrire** (fonctionnalité retirée) :
- `:103` `.strategy-panel` / « Abonnements à vérifier » ;
- `:134-145` clic `[data-action="strategy-settings"]`, assertions `#strategy-form`,
  `#strategy-model-ollama`, `#strategy-inputTokens`, `updateStrategy`, état `strategy` ;
- `:149` `strategyVisualOriginal` ;
- `:162-192` `.strategy-current`, `.strategy-next li`, `.strategy-api`,
  `.strategy-details`, `UsageStrategy.recommend`, `strategyResult`, captures
  `strategy-dashboard.png` / `strategy-api.png` ;
- `:562-566` `.quick-strategy`, `[data-api-provider]`, comparaison de recommandation
  entre tableau de bord et widget ;
- `:641` `strategyResult().queue` / `apiProviders` ;
- `:681-683` persistance `loaded.strategy`.

**Widget compact — assertions à adapter** :
- `:443-444` `.quick-row` count 10 et ordre : conservés (abonnements en tête puis API
  dans l'ordre de l'inventaire).
- `:449` l'assertion d'absence de fraîcheur devient sans objet : la fraîcheur n'est
  plus affichée en permanence (seul un indicateur « Relevé à vérifier » apparaît si
  nécessaire). Supprimer cette ligne.
- `:451-452, 464, 511-518, 526` : plus de `fitQuick()` ni de redimensionnement
  automatique ; remplacer par `assert.ok(scrollHeight <= clientHeight)` à 360×560
  (la fenêtre de test doit être dimensionnée en 360×560) et vérifier que
  `.quick-footer` reste visible.
- `:562-566` supprimés (voir bloc stratégie) ; `:467` `.logo img` = 10 logos conservé.
- `:492-504` : plus de `.quick-quota`, `.quick-period-status` ni `.quick-resource-status`
  côté widget. Vérifier à la place `.quick-row[data-provider]` (classe
  `resource-*`), `.quick-value` (texte « Épuisé/Bas/Critique ») et, pour les soldes,
  `.quick-value .resource-value` (couleur rouge des soldes négatifs conservée).
- `:637` (pastille) et `:589` (toast masqué) restent valables.

**Conservé** : `:24-25` (`.workspace` → remplacer `/Lasme/` par `/Espace local/`),
`:23` (thème système à calculer), `.cards .card`, filtres, recherche, fiches,
historique, connexions, réglages, toasts existants, `:467` logos.

### `scripts/smoke-resource-status.cjs`

**À réécrire pour la partie widget** : le script vérifie aujourd'hui, dans
`.quick-row`, des statuts par fenêtre (`.quick-quota`, `.quick-period-status`,
`.quick-resource-status`), qui n'existent plus. Conserver les vérifications des
cartes (`.card.resource-*`, `.quota-period-status`, `.resource-status`,
`.resource-value`, `.level-pill`) et adapter le widget à `.quick-row.resource-*` +
`.quick-value` / `.quick-level` (et `.resource-value` pour les soldes). Les fixtures
USD/négatives restent valables.

### `scripts/smoke-claude.cjs`

Aucun changement attendu : `.dialog-body`, `.connection-success`,
`#account-account-error`, textes « chaque minute », « 39 % utilisés » et
« Prochaine tentative » sont conservés.

### `scripts/preview.cjs`

Aucune action : le Lead a déjà ajouté `/ui-core.js` et `/views.js` et retiré les
routes `strategy*` / `usage-strategy`. Le renderer ne référence plus ces fichiers.

### `main.cjs` (architecte)

- **Fenêtre widget** : faite — `main.cjs` crée `quickWindow` en **360×560**
  (`width: 360`, `height: Math.min(560, …)`, `quickDesiredHeight = 560`). Le renderer
  n'appelle plus `fitQuick`/`window:quick-size` ; l'API preload reste exposée mais
  n'est plus utilisée par le renderer actuel.
- Optionnel : abaisser `minWidth` de la fenêtre principale de 900 à ~720 px ; le
  renderer gère déjà les largeurs < 900 px (barre supérieure).

### `scripts/quality.test.cjs` (qualite-tests)

Si ce test vérifie la taille/les lignes du renderer, cibles actuelles :
`renderer/app.js` 561 lignes (max 112 car./ligne), `renderer/views.js` 1 108 lignes
(max 142), `renderer/ui-core.js` 301 lignes, `renderer/styles.css` 1 273 lignes,
`renderer/theme.css` 122. `renderer/strategy-ui.js` et `renderer/strategy.css`
n'existent plus ; `lib/usage-strategy.js` a également été retiré du dépôt par la
vague produit. La CSP de `index.html` n'a pas changé.

---

## 11. Vérifications effectuées (sans lancer l'application)

| Vérification | Commande / méthode | Résultat |
|---|---|---|
| Syntaxe JS | `node --check` sur `app.js`, `views.js`, `ui-core.js`, `reset-ui.js`, `theme-init.js` | OK |
| Tests ciblés | `node --test tests/resource-levels.test.cjs` | 6/6 verts |
| Rendu statique | harnais Node + `vm` avec DOM factice : `overview`, `subscriptions`, `connections`, `historyPage`, `settingsPage`, 10 `quickAccountRow`, 40 `dialogMarkup`, `shell` | aucune exception ; aucun `undefined`/`NaN` ; aucun appel `UsageStrategy` |
| Application | harnais `vm` chargeant `app.js` avec API simulée | rendu initial, `openDetail`, changement de page, `receiveState`, effacement, repli Claude sans erreur |
| Widget compact | harnais `vm` en `?mode=quick` | 10 `.quick-row` (6 abonnements + 4 API), 2 `.quick-group-title`, `.quick-refresh-status`, aucune section stratégie |
| **Chromium réel** (aperçu) | 360×560 @1x et @2x : `scrollHeight <= clientHeight`, chevauchement, hauteur des lignes, logos | 10 lignes (6 abonnements + 4 API), 2 titres de section, **hauteurs 32 px**, **liste 461 px / 461 px = aucun défilement**, 0 chevauchement, 10 logos chargés et visibles (20×20 px), footer dans la fenêtre, `scrollbar-width: thin` + règle `::-webkit-scrollbar` 5 px ; capture `test-results/widget-compact.png` |
| Petite hauteur | 360×320 : débordement volontaire | la liste défile (`overflow-y:auto`) sans chevauchement ; à 560 px elle ne défile pas |
| États connus | quotas %, crédits USD, fenêtres multiples (Antigravity 5, Claude 2, Z.ai 2) | 10 lignes de 32 px, 0 débordement, résumés « Hebdo 0 % · Épuisé +4 », « 2,00 $US · Critique +1 » |
| Tableau de bord / Réglages | Chromium 1280×900 : absence `.strategy-*` / `#strategy-form`, 10 cartes, filtres | OK |
| Résidus | `grep -R "strategy\|UsageStrategy\|updateStrategy" renderer/*.js renderer/*.html renderer/*.css` | 0 résultat (seul le présent document mentionne l'historique) |
| Couleurs | calcul WCAG sur les tokens | 58 paires ≥ 4,5:1 (focus ≥ 3:1) |
| CSP | inspection `renderer/*` | aucun handler inline, `eval`, `new Function`, URL externe ; seul `fetch('/preview-state')` same-origin pour l'aperçu |

**Non vérifié (nécessite l'application Electron) :** rendu dans la fenêtre Electron
réelle (taille 360×560 dépend de la modification `main.cjs` par l'architecte), zoom,
lecteur d'écran NVDA/Narrator, smoke complet. Ces points sont à valider par le Lead.

---

## 12. Risques et points de vigilance

1. **Fenêtre Electron** : `main.cjs` crée bien le widget en 360×560 (vérifié le
   4 novembre 2026) ; le renderer a été validé dans ce format via l'aperçu. Si une
   ancienne version du renderer reste en cache dans un portable déjà construit, elle
   continuera d'appeler `fitQuick` : reconstruire les ressources (`npm run
   update:portable`) pour propager le nouveau widget compact.
2. **`scripts/smoke.cjs` doit être largement mis à jour** : tout le bloc stratégie
   (lignes citées §10) et les hooks widget par fenêtre disparaissent. Sans mise à
   jour, le smoke échouera — c'est attendu et documenté pour T10/qualite-tests.
3. **`scripts/smoke-resource-status.cjs`** doit être adapté à la partie widget
   (statuts par fenêtre remplacés par `.quick-value`/`.quick-level`).
4. **Thème système au premier lancement** : si Windows est en mode sombre,
   `dataset.theme` vaut `dark` avant toute interaction ; les tests existants qui
   supposent `light` doivent forcer la préférence.
5. **Double confirmation d'effacement** : le main refuse l'effacement pendant une
   synchronisation ; le message d'erreur est affiché dans `#erase-error`, mais le
   bouton reste actif pendant la synchro.
6. **`state.providers` partiellement migré** : le renderer tolère `amount`/`currency`/
   `nextAmount` absents, mais pas un `billingCycle` inconnu au-delà du libellé par
   défaut ; une migration `lib/migrations.cjs` peut rester nécessaire.
7. **Widget fixe sans auto-fit** : si les textes système sont agrandis (zoom), les
   10 lignes peuvent dépasser 560 px ; la liste défile alors avec une barre fine
   (comportement voulu). Aucun élément n'est coupé horizontalement (testé 360 px).
8. **Aucun test automatisé du nouveau code renderer** : le harnais statique et les
   mesures Chromium ne remplacent pas le smoke Electron. Le Lead doit lancer
   `npm run test:desktop`, `npm run test:resources:desktop` et
   `npm run test:claude:desktop` après mise à jour des scripts.

---

## 13. Captures / revue visuelle

- Nouvelle capture de référence : **`test-results/widget-compact.png`** (360×560 @2x,
  aperçu Chromium) — 10 fournisseurs, 2 sections, aucune barre de défilement.
- Captures Lead à régénérer : `ui-widget-light.png`, `ui-widget-rows.png`,
  `quick.png`, `compact-window.png`, `settings-*.png` ; elles ne doivent plus montrer
  de panneau « Ton ordre d'usage » ni de section recommandation dans le widget.
- Points visuels : widget 360×560 sans défilement, icônes 20 px visibles, lignes 32 px,
  en-tête court, tableau de bord sans encart recommandation, Réglages sans formulaire
  d'ordre de consommation, thème clair et sombre.
