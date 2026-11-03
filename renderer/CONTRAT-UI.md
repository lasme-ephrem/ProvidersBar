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
| `renderer/styles.css` | base, mise en page, composants, responsive | lignes 10 |
| `renderer/strategy.css` | panneau stratégie et rappels du widget | ligne 11 |
| `renderer/theme.css` | **tokens sémantiques** clair/sombre, typographie, rayons | ligne 12 |
| `../lib/quota-resets.js` | dates de réinitialisation (inchangé) | ligne 13 |
| `../lib/resource-levels.js` | seuils et libellés de niveau (étendu) | ligne 14 |
| `renderer/ui-core.js` | **nouveau** : échappement, formatage, icônes, thème, focus, toasts, niveaux | ligne 15 |
| `renderer/reset-ui.js` | `resetMarkup` / `resetForm` (restructuré) | ligne 16 |
| `../lib/usage-strategy.js` | moteur de recommandations (propriété connecteurs, interface inchangée) | ligne 17 |
| `renderer/strategy-ui.js` | `strategyResult`, `strategyPanel`, `strategyWidget`, `strategySettings` | ligne 18 |
| `renderer/views.js` | **nouveau** : toutes les vues et le HTML des fiches/widget | ligne 19 |
| `renderer/app.js` | état, événements, boucle de rendu, actions | ligne 20 |

Ordre à respecter : `ui-core.js` avant `reset-ui.js`, `strategy-ui.js` et `views.js` ;
`views.js` avant `app.js`. Aucun script inline, aucun `eval`, aucune dépendance.

**Action d'intégration requise hors périmètre ux-docs :** `scripts/preview.cjs`
(serveur d'aperçu) doit ajouter les routes `/ui-core.js` et `/views.js` vers
`renderer/ui-core.js` et `renderer/views.js`. Sans cela, `npm run preview` renvoie
404 sur ces deux scripts et la page d'aperçu reste vide. `scripts/app-resources.cjs`
copie tout `renderer/` : rien à ajouter pour le portable.

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
| `strategyResult()` | fonction | `UsageStrategy.recommend(...)` (smoke l'appelle) |
| `UsageStrategy`, `QuotaResets`, `ResourceLevels` | globaux de `lib/` | inchangés |

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

Le widget (fenêtre `?mode=quick`) est rendu dans `#app` :

```html
<main class="quick">
  <header class="quick-head">…<button data-action="sync" aria-label="Synchroniser">…</button></header>
  <p class="quick-refresh-status">Actualisation auto : 5 min · Claude 1 min</p>
  <p class="quick-columns">10 comptes · restant</p>
  <button class="quick-strategy" data-action="main" aria-label="…">…</button>
  <section class="quick-api" aria-label="API disponibles à utiliser">…</section>
  <div class="quick-list">
    <button class="quick-row resource-healthy" data-provider="openai" data-action="main">
      <span class="quick-provider">…<span class="level-pill">…</span></span>
      <span class="quick-values">…quotas…</span>
      <span class="quick-freshness"><span class="freshness">il y a 2 min</span></span>
    </button>
  </div>
  <footer class="quick-footer"><button class="text-button" data-action="main">…</button></footer>
</main>
```

Le contenu d'un `.quick-row` est exclusivement constitué d'éléments **phrasing**
(`span`, `img`, `small`) : plus de `<div>`/`<h3>` dans un `<button>`.

---

## 4. Hooks DOM conservés (contrat §3.6)

Vérifiés par audit statique sur toutes les vues :

- Globals : `render`, `receiveState`, `strategyResult`, `state`, plus `renderQuick`,
  `statusBadge`, `page`, `filter`, `query` (héritage smoke).
- Navigation : `[data-nav="overview|subscriptions|history|connections|settings"]`,
  `.sidebar`, `.workspace`, `#app`, `#detail-dialog`, `#toast`.
- Actions : `[data-action="sync|strategy-settings|export|disconnect|account-open|
  account-verify|claude-enable-live|ollama-email|main|close-dialog|history-retry"]`.
- Stratégie : `.strategy-panel`, `.strategy-current`, `.strategy-next`, `.strategy-next li`,
  `.strategy-api`, `.strategy-api-providers`, `.strategy-details summary`,
  `[data-disclosure="subscriptions"]`, `#strategy-form`, `#strategy-model-ollama`,
  `#strategy-inputTokens`, `[name="contributor"]`. S'y ajoutent `#strategy-outputTokens`,
  `#strategy-cachePercent`, `[name="strategyEnabled"]`, `[data-disclosure="api-routes"]`,
  `#strategy-form button[type="submit"]`.
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
  `[name="notifications"]`, `[name="lowBalance"]`, `[data-action="export"]`.
- Widget : `.quick`, `.quick-head`, `.quick-columns`, `.quick-list`, `.quick-row`
  (+ `.resource-{level}`), `[data-provider]`, `.quick-strategy`, `.quick-api`,
  `.quick-api-providers [data-api-provider]`, `.quick-footer`, `.quick-quota`,
  `.quick-period`, `.quick-period-label`, `.quick-period-status`,
  `.quick-ollama-reserve`, `.stale`,
  `[aria-label="Relevé à vérifier"]` (uniquement sur un relevé réellement ancien).
- Textes conservés mot pour mot quand le smoke les vérifie : « Expiré · désactivé »,
  « En pause », « Synchronisation… », « Relevé ancien », « Connexion à vérifier »,
  « Quota indisponible », « Free · 0 $ », « Déconnecté · dernier relevé »,
  « Synchronisé », « Saisie manuelle », « Compte connecté », « À connecter »,
  « Limite … atteinte », « Limite hebdo Fable atteinte », « Toutes les limites
  atteintes », « Limite atteinte », « Solde épuisé », « Crédits inclus épuisés ·
  réserve disponible », « Réserve supplémentaire », « Dernière valeur connue »,
  « Grok / Bot / Cursor », « Fin du forfait : … », « Free · 0 $/mo »,
  « Date passée · à vérifier », « heure non précisée », « manuel »,
  toasts « Stratégie enregistrée. », « Préférences enregistrées. »,
  « Dates de réinitialisation enregistrées. », « Données exportées, sans les clés. ».

---

## 5. Hooks remplacés ou requalifiés

| Ancien | Nouveau | Raison | Impact smoke |
|---|---|---|---|
| `.shell` | `.app-shell` | grille de page | non utilisé par le smoke |
| `.workspace` avec « L’atelier de Lasme » + avatar « L » | `.workspace` avec « Espace local » / « Données sur cet appareil » | marque neutre (§3.6) | **`scripts/smoke.cjs:24` doit changer** : `/Lasme/` → `/Espace local/` |
| `nav button.active`, `.filters button.active`, `.dialog-tabs button.active` | `.is-active` (+ `aria-current`/`aria-selected`) | convention d'état unique | non utilisé par le smoke |
| `.badge.error` / `.badge.warn` / `.badge.live` | `.badge-error` / `.badge-warn` / `.badge-live` | tokens sémantiques | non utilisé par le smoke |
| `.icon-button.selected` | `.icon-button.is-selected` | convention d'état | non utilisé par le smoke |
| `.resource-unverified` (opacity `.65`) | classe conservée mais **sans atténuation** ; `.is-stale` + `.freshness.is-stale` | contraste AA sur les relevés anciens | aucun test ne vérifie l'opacité |
| `.meter` en `<div>` | `<span class="meter">` (role=meter/img, aria-valuenow) | HTML valide dans un bouton | aucun test ne vérifie la balise |
| `.reset-date` toujours présent (même sans date) | **absent** si aucune date ; sinon `.reset-date` + `.reset-date-value`, `.is-past`, `.is-compact` | supprime le bruit « Date non fournie » ×5 | `smoke.cjs:450` reste vert (date manuelle zai) ; aucune assertion « Date non fournie » trouvée |
| `.quick-row` sans `aria-label` → contenu lu | **pas** d'`aria-label` global ; le contenu (fournisseur, quotas, fraîcheur) reste exposé | ne pas masquer l'information aux AT | aucun test ne lit le nom accessible de la ligne |
| Widget sans fraîcheur | `.quick-freshness > .freshness` (« il y a 2 min », « à l’instant ») + `Relevé ancien` | corrige M-06 de l'audit | **`smoke.cjs:449`** (`doesNotMatch /Échéance\|Il y a\|À l’instant/`) devient obsolète : la fraîcheur est volontairement affichée. Il passe encore par hasard (minuscules), mais doit être remplacé par une assertion positive `/il y a\|à l’instant/`. |
| `#settings` panneau unique + « Version 0.1.0 » | `#app-version` dynamique + panneau « À propos » + « Aucune télémétrie » + bouton `[data-action="erase-data"]` + `[data-action="erase-cancel"]` | version source unique et effacement RGPD | aucun test ne vérifie la version ; nouveaux hooks à couvrir par `quality.test.cjs` si souhaité |
| Thème `light|dark` | `light|dark|system` ; `data-theme-preference` sur `<html>` | suit Windows | `smoke.cjs:23` : si le thème par défaut du seed est `system` (c'est le cas dans `lib/seed.cjs`), l'assertion `dataset.theme === 'light'` dépend du mode Windows. À remplacer par la valeur attendue calculée (`matchMedia('(prefers-color-scheme: dark)')`) ou forcer `theme:'light'` dans la fixture. |
| `.sidebar` couleurs | **inchangées** : `rgb(234, 240, 233)` clair, `rgb(20, 22, 23)` sombre via `--sidebar-bg` | limiter la casse smoke | `smoke.cjs:25` et `:422` restent verts |
| `styles.css` minifié | CSS lisible (1 303 lignes, aucune ligne > 185 caractères hors CSP) | maintenabilité | — |

Tous les hooks de `smoke-resource-status.cjs` et `smoke-claude.cjs` sont conservés
(textes de statut de quota, classes `resource-*`, `.quota-period-status`,
`.quick-period-status`, `.resource-status`, `.level-pill`,
`.connection-success`, `.dialog-body`, globals `page`/`filter`/`query`).

> Note (correction du 3 novembre 2026) : `.quick-resource-status` (statut global
> de ligne dans le widget) **n'est pas rendu** en 0.3.0 — le widget affiche un
> statut par fenêtre (`.quick-period-status`) et la pastille de niveau
> (`.level-pill`). Les smokes ont été alignés sur le rendu réel.

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
`opacity` : un relevé ancien garde son contraste et reçoit un texte « Relevé ancien ».

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
  (ou `role="img"` + « indisponible » si inconnu) ; `aria-live` global
  `#live-region` pour filtres, recherche, synchronisation, vérification et effacement ;
  `role="alert"` sur les erreurs de formulaire ; `aria-busy` sur les boutons de
  synchronisation ; toasts `role="status"` ; `aria-label` explicite sur les boutons
  d'API du widget (fournisseur + montant + niveau).
- **Pas de couleur seule** : `.level-pill` écrit « Épuisé / Critique / Bas / Suffisant »,
  `Libre`/`Indisponible`, `aria-valuetext` inclut le seuil, `resource-status` et
  `quota-period-status` sont textuels, la légende complète est affichée sur
  Vue d'ensemble **et** dans Réglages, `freshness` écrit « Relevé ancien ».
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

## 8. Widget : fraîcheur, actualisation, états

- Chaque ligne avec relevé affiche `.quick-freshness` : « à l’instant », « il y a X min »,
  « il y a X h », « il y a X j ». Au-delà de 10 minutes (ou en erreur / déconnecté),
  `.freshness.is-stale` affiche « Relevé ancien » + l’âge et porte
  `aria-label="Relevé à vérifier"` (le smoke vérifie son absence sur un relevé frais).
- `.quick-refresh-status` affiche l'état réel : « Actualisation auto : 5 min ·
  Claude 1 min » ou « Actualisation automatique désactivée » (source :
  `state.settings.autoRefresh`). La statistique équivalente du tableau de bord
  (`.stats`) utilise le même libellé.
- Ordre : ordre de l'inventaire (`state.providers`), fournisseurs expirés non-Ollama
  exclus ; état vide « Aucun compte à afficher. » ; aucun tri alphabétique implicite
  (préserve l'ordre attendu par `scripts/smoke.cjs:444`).
- La taille du panneau est calculée sur le contenu réel (`.quick-list` défilable si
  le contenu dépasse la hauteur maximale du processus principal).

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

1. **Ligne 24** : `.workspace` ne contient plus « Lasme ». Remplacer
   `/Lasme/` par `/Espace local/` (ou supprimer l'assertion, la marque étant neutre).
2. **Ligne 23** : le seed par défaut est `theme: 'system'` ; `dataset.theme` vaut
   `dark` ou `light` selon Windows. Remplacer par une attente calculée
   (`matchMedia('(prefers-color-scheme: dark)')`) ou forcer `theme:'light'` dans la
   fixture avant le premier lancement.
3. **Ligne 449** : l'absence de fraîcheur dans le widget n'est plus vraie.
   Remplacer `doesNotMatch(..., /Échéance|Il y a|À l’instant/)` par une assertion
   positive sur `.quick-freshness` (`/il y a|à l’instant/`).
4. **Lignes 451–452, 464, 511–518** : la hauteur du widget augmente (fraîcheur +
   statut d'actualisation). Le panneau est dimensionné sur le contenu et défile
   au-delà de 900 px ; conserver les tolérances existantes
   (`scrollHeight <= clientHeight || innerHeight === 900`) ou vérifier que le
   `.quick-footer` reste dans la fenêtre.
5. **Lignes 25 et 422** : inchangées (couleurs de `.sidebar` préservées).
6. **Ligne 467** : `.logo img` compte toujours 10 logos de lignes (les boutons API
   du widget n'ajoutent des logos que si des fournisseurs API sont disponibles à ce
   stade du scénario, comportement inchangé).
7. Aucun autre changement attendu : classes `resource-*`, textes de statut, ids de
   formulaires, actions, `.cards .card`, `.data-table`, `.connection-card`,
   `.strategy-*`, `.quick-row`/`.quick-quota` sont conservés.
8. **Toast d'activation Claude** : `scripts/smoke.cjs` ne vérifie pas le texte
   « Lecture directe Claude activée. » (il attend seulement
   `.connection-success` /chaque minute/ et le passage de `accountSession.kind` à
   `claude-live-local` sur le chemin direct). Aucune mise à jour obligatoire ;
   qualite-tests peut ajouter un cas de repli Desktop avec le nouveau toast
   « Connexion Claude mise à jour : relevé Claude Desktop utilisé. ».

### `scripts/smoke-resource-status.cjs`

Aucun changement attendu : il force `documentElement.dataset.theme`, assigne
`page`/`filter`/`query` et vérifie `.card.resource-*`, `.quota-period-status`,
`.quick-period-status`, `.resource-status`, `.level-pill`,
`resource-value` (rouge pour soldes négatifs). Tous ces hooks existent encore.

### `scripts/smoke-claude.cjs`

Aucun changement attendu : `.dialog-body`, `.connection-success`,
`#account-account-error`, textes « chaque minute », « 39 % utilisés » et
« Prochaine tentative » sont conservés.

### `scripts/preview.cjs`

Ajouter les routes (obligatoire pour `npm run preview`) :

```js
routes['/ui-core.js'] = 'renderer/ui-core.js';
routes['/views.js'] = 'renderer/views.js';
```

### `main.cjs` (architecte)

Optionnel mais recommandé par le contrat « minWidth n'est plus un piège » :
abaisser `minWidth` de 900 à ~720 px. Le renderer est déjà utilisable en dessous de
900 px (barre supérieure) ; la fenêtre actuelle ne peut pas y être réduite, seul le
zoom déclenche le mode compact.

### `scripts/quality.test.cjs` (qualite-tests)

Si ce test vérifie la taille/les lignes du renderer, cibles actuelles :
`renderer/app.js` 599 lignes (max 116 car./ligne), `renderer/views.js` 1 104 lignes
(max 142), `renderer/ui-core.js` 302 lignes, `renderer/styles.css` 1 303 lignes
(aucune règle minifiée), `renderer/theme.css` 122, `renderer/strategy.css` 183.
La CSP de `index.html` n'a pas changé.

---

## 11. Vérifications effectuées (sans lancer l'application)

| Vérification | Commande / méthode | Résultat |
|---|---|---|
| Syntaxe JS | `node --check` sur `app.js`, `views.js`, `ui-core.js`, `strategy-ui.js`, `reset-ui.js`, `theme-init.js` | OK |
| Tests ciblés | `node --test tests/resource-levels.test.cjs` | 6/6 verts |
| Rendu statique | harnais Node + `vm` avec DOM factice : `overview`, `subscriptions`, `connections`, `historyPage`, `settingsPage`, `strategyPanel`, `strategyWidget`, `strategySettings`, 10 `quickAccountRow`, 40 `dialogMarkup`, `shell` | aucune exception ; hooks du contrat et du smoke présents ; aucun `undefined`/`NaN` |
| Application | harnais `vm` chargeant `app.js` avec API simulée | rendu initial, `openDetail`, changement de page, `receiveState` sans erreur |
| Widget | harnais `vm` en `?mode=quick` | 10 `.quick-row`, `.quick-freshness`, `.quick-refresh-status`, `.quick-strategy`, `.quick-api`, `receiveState` OK |
| HTML | audit des boutons du widget | plus de `<div>`/`<h3>` dans un `<button>` |
| Couleurs | calcul WCAG sur les tokens | 58 paires ≥ 4,5:1 (focus ≥ 3:1) |
| CSP | inspection `renderer/*` | aucun handler inline, `eval`, `new Function`, URL externe ; seul `fetch('/preview-state')` same-origin pour l'aperçu |

**Non vérifié (nécessite l'application) :** rendu visuel réel, captures, zoom
navigateur, lecteur d'écran NVDA/Narrator, comportement des images dans Chromium,
smoke complet, intégration `getAppInfo`/`eraseData` de bout en bout. Ces points sont
à valider par le Lead lors de la vague d'intégration.

---

## 12. Risques et points de vigilance

1. **Prévisualisation cassée tant que `scripts/preview.cjs` n'a pas ses deux routes**
   (non bloquant pour le smoke, bloquant pour `npm run preview`).
2. **`scripts/smoke.cjs` doit être mis à jour** (marque neutre, thème système,
   fraîcheur) ; les autres assertions sont préservées par construction.
3. **Thème système au premier lancement** : si Windows est en mode sombre,
   `dataset.theme` vaut `dark` avant toute interaction ; les tests existants qui
   supposent `light` doivent forcer la préférence.
4. **Double confirmation d'effacement** : le main refuse l'effacement pendant une
   synchronisation ; le message d'erreur est affiché dans `#erase-error`, mais le
   bouton reste actif pendant la synchro (pas de désactivation croisée).
5. **`state.providers` partiellement migré** : le renderer tolère `amount`/`currency`/
   `nextAmount` absents (garde `typeof`), mais pas un `billingCycle` inconnu au-delà
   du libellé par défaut ; une migration `lib/migrations.cjs` peut rester nécessaire.
6. **`getAppInfo`/`eraseData`** : implémentés par `architecte` ; le renderer a un
   repli, mais la version ne s'affiche qu'après l'IPC. Si le préchargement est plus
   ancien, « Version non exposée » et toast d'effacement indisponible apparaissent.
7. **Widget et hauteur** : plus de contenu (fraîcheur + statut) ; le panneau grandit
   jusqu'à 900 px puis défile. Vérifier que le `.quick-footer` reste visible sur les
   écrans dont la zone de travail est < 916 px.
8. **Aucun test automatisé du nouveau code renderer** : le harnais statique ne
   remplace pas le smoke Electron. Le Lead doit lancer `npm run test:desktop`,
   `npm run test:resources:desktop` et `npm run test:claude:desktop`.

---

## 13. Captures / revue visuelle à produire par le Lead

Les captures habituelles (`test-results/smoke-*`, `resource-status-*`,
`settings-dark.png`, `settings-light.png`, `compact-window.png`, `quick.png`) doivent
être régénérées. Points à vérifier visuellement : barre supérieure sous 900 px,
zoom 150/200 %, hiérarchie des cartes, pastilles de niveau, widget complet, dialogue
à 400 px de large, thème sombre et clair.
