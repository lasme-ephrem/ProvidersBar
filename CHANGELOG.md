# Historique des versions

## 0.6.4 — 4 novembre 2026

- Le script d'installation écrit un accusé de démarrage avant d'attendre la fermeture de l'application. L'application attend cet accusé avant de quitter, afin de ne pas tuer un processus PowerShell qui n'aurait pas encore démarré.
- Validation du flux réel 0.6.0 → 0.6.4.

## 0.6.3 — 4 novembre 2026

- Le staging de mise à jour vit sous `<portable>/data/updates`, donc à l'intérieur du dossier portable. Le garde-fou l'autorise désormais explicitement tout en refusant tout autre sous-dossier du portable et une cible incluse dans le staging.
- Validation du flux réel 0.6.0 → 0.6.3.

## 0.6.2 — 4 novembre 2026

Second correctif d'extraction, découvert lors du test réel depuis la release
GitHub.

- L'entrée racine `./` des archives `tar` est ignorée.
- Les fichiers `.asar` sont écrits dans un fichier temporaire puis renommés.
  Electron patche `fs` et refuse d'écrire directement un chemin `.asar`
  (« Invalid package »), ce qui interrompait l'extraction de
  `resources/default_app.asar`.
- Validation par extraction de l'archive de release publique dans Electron,
  puis par le flux complet 0.6.0 → 0.6.2 avec préservation de `data/`.
- 269 tests.

## 0.6.1 — 4 novembre 2026

Correctif indispensable à la mise à jour automatique.

- Les archives ZIP produites par `tar -C dossier .` contiennent une entrée
  racine `./`. Elle est désormais ignorée lors de l'extraction ; sans ce
  correctif, la 0.6.0 téléchargeait l'archive puis échouait avec
  « Entrée ZIP invalide ».
- Validation complète du flux réel : vérification du manifeste publié,
  téléchargement, extraction de l'archive de release, remplacement et
  préservation de `data/`.
- 268 tests, dont un test dédié à l'entrée racine `./`.

## 0.6.0 — 4 novembre 2026

Version **Maintenance** : mise à jour automatique du portable et canary live.

### Mise à jour automatique

- Manifeste `latest.json` signé Ed25519, vérifié avant toute utilisation ;
  URL HTTPS, version minimale, SHA-256 et taille contrôlés.
- Téléchargement et extraction défensive : refus des chemins `..`, des liens
  symboliques, des doublons, des archives trop volumineuses et de tout `data/`
  embarqué.
- Remplacement après fermeture par un script séparé : sauvegarde de
  `resources/app` et de l'exécutable, copie, relance, rollback en cas d'échec.
  `data/` n'est jamais copié ni supprimé.
- Panneau **Réglages → Mises à jour** : vérification manuelle, notes, taille,
  progression et installation avec redémarrage.
- Outillage `updater:key` et `updater:sign`, clé privée dans `.local/updater/`,
  clé publique versionnée.
- Vérification automatique au démarrage (après 60 s) puis toutes les 6 heures.

### Canary live

- `connectors:canary:live` lit `.local/canary.env` (ignoré par Git) sans écraser
  l'environnement, ne journalise aucune clé et échoue explicitement si aucune clé
  n'est fournie. Les fournisseurs sans clé API sont signalés comme ignorés.

### Qualité

- 267 tests, dont manifeste, extraction ZIP, script d'installation et canary.

## 0.5.0 — 4 novembre 2026

Version **Robustesse** : les connecteurs deviennent observables, réparables et
capables d'évoluer sans reconstruire l'application. Toutes les fonctionnalités
0.4.0 sont conservées et les données existantes sont migrées sans perte.

### Contrat de connecteur et santé

- Contrat pur `lib/connector-contract.cjs` : validation des relevés, erreurs
  typées (`AUTH_REQUIRED`, `RATE_LIMITED`, `NETWORK`, `SCHEMA_DRIFT`…),
  stratégie réellement utilisée, fraîcheur calculée sur la date du relevé.
- **Un relevé incohérent ne remplace plus le dernier relevé sain** : il devient
  `SCHEMA_DRIFT`, avec conservation des dernières valeurs et un message clair.
- **Replay de fixtures** : les réponses HTTP enregistrées (OpenRouter, DeepSeek,
  RunInfra) sont rejouées dans les parseurs et validées par le contrat à chaque
  test, pour détecter une dérive avant l'application.
- Santé persistée par fournisseur (migration non destructive) : dernier succès,
  dernier échec, compteur d'échecs, code, message et prochaine tentative.
- Panneau **Santé des connexions** : dix lignes avec état, stratégie, âge du
  relevé et bouton **Tester** individuel.

### Résilience

- Disjoncteur dérivé de la santé : l'actualisation automatique espace les pannes
  transitoires (30 s → 30 min) et les dérives (15 min), au lieu de marteler le
  fournisseur. L'authentification reste immédiatement actionnable.
- Toute action manuelle (Tester, Synchroniser, tray) force une tentative ; un
  succès remet le compteur à zéro et réactive les mises à jour automatiques.
- Chaînes de stratégies explicites, sans repli inventé (Claude direct →
  Desktop ; les autres fournisseurs déclarent leur unique stratégie).
- **Sortie des parcours fournisseur de `main.cjs`** : `lib/connector-sync.cjs`
  porte les branches de synchronisation et le disjoncteur,
  `lib/provider-flows.cjs` les fenêtres, timers et états Claude, Antigravity,
  OrcaRouter et Ollama. `main.cjs` se limite au cycle de vie, aux fenêtres, à
  l’IPC et à l’état.

### Packs de connecteurs signés

- Format JSON versionné et **signé Ed25519**, vérifié au chargement : schéma,
  fournisseur, version, `minApp`, endpoint HTTPS, expiration.
- Pack embarqué + **override local signé** ; un downgrade ou un pack altéré est
  refusé et visible dans le diagnostic. En développement uniquement,
  `LASMIUM_ALLOW_UNSIGNED_PACKS=1` permet les essais.
- Endpoints API surchargeables à chaud (OpenRouter, DeepSeek, RunInfra), sans
  reconstruire l'application ; clé publique versionnée, clé privée locale.
- Outillage : `npm run connectors:sign`, `npm run connectors:key`,
  `npm run connectors:canary` (hors-ligne ou `--live` avec clés d'environnement).

### Données et diagnostic

- Sauvegardes rotatives de `state.json` toutes les 6 h (5 dernières), créées
  avant écriture et au démarrage ; restauration validée qui sauvegarde d'abord
  l'état courant. CLI `npm run state:backup`.
- Bundle de diagnostic sans clé, solde ni chemin absolu, exportable depuis
  **Réglages → Tes données** ou via `npm run diagnostic`.
- Journal local rotatif (256 Ko × 3) pour les échecs de santé et les
  sauvegardes, sans secret.

### Qualité

- 252 tests unitaires, tests dédiés au contrat, aux packs, aux sauvegardes, au
  diagnostic, au journal, au replay de fixtures et au runtime de
  synchronisation ; smoke Electron étendu à la santé et à la dérive.
- CI Windows (syntaxe, tests, canary) et documentation : matrice fournisseurs,
  runbook de dépannage et de signature.

### Limites assumées

- Les lecteurs DOM des abonnements navigateur restent dans l'application : un
  changement de sélecteur nécessite encore une version (les packs couvrent les
  endpoints API).
- Aucun canary `--live` n'est exécuté dans cette validation : pas de clés de
  test réelles fournies. Aucune mise à jour automatique ni signature de code
  Windows (certificat et hébergement à définir).

## 0.4.0 — 4 novembre 2026

Nouvelle identité **Lasmium TOKENS-HUB** et refonte UX/UI complète, sans perte de fonctionnalité.

### Identité

- **Nom** : l'application devient **Lasmium TOKENS-HUB** (fenêtre, widget, tray, notifications, packaging, documentation).
- **Logo** : nouveau monogramme Lasmium (L lumineux, nœud aqua), décliné en icône d'application, de fenêtre et de tray (`assets/icon.png`, `assets/brand/lasmium-mark.svg`).
- **Typographie** : **Sora Variable** (titres, chiffres, marque) + **Inter Variable** (texte), toutes deux embarquées avec leur licence OFL.
- **Palette** : obsidian + lime laser, thème clair porcelaine et thème sombre, rail de navigation sombre dans les deux thèmes.

### Interface

- Refonte du design system : tokens, rayons, ombres, boutons, chips, formulaires et états.
- Tableau de bord : hero, statistiques, filtres, cartes fournisseurs et quotas redessinés.
- Fiche détaillée : panneau latéral au lieu du dialogue centré, onglets et formulaires restylés.
- Connexions, abonnements, historique et réglages réalignés sur la nouvelle grille.
- Widget : marque Lasmium, lignes verticales complètes conservées, nouvelle hiérarchie et barre fine.

### Renommage et compatibilité

- API renderer exposée sous `window.lasmium` (ancien nom supprimé).
- `LASMIUM_DATA_DIR` remplace `PROVIDERSBAR_DATA_DIR`, qui reste accepté en repli.
- Le dossier portable historique `dist/ProvidersBar-win32-x64/` est conservé pour préserver les données ; l'exécutable devient `LasmiumTokensHub.exe` et le lanceur `Lancer Lasmium TOKENS-HUB.cmd`.
- Préférence de thème migrée depuis l'ancienne clé localStorage.

### Nettoyage

- Suppression de la projection morte `forStrategy` et de son test.
- Ancien CSS du widget (`.quick-value`, segments, `+N`) supprimé ; feuille de style réécrite.
- Documents d'audit déplacés dans `docs/archive/`.
- Packaging, tests et documentation alignés sur la nouvelle identité.

## 0.3.6 — 4 novembre 2026

Widget vertical complet : toutes les informations de chaque fournisseur sont visibles, sans agrégation ni « +N ».

### Interface

- **Une ligne par information** : le widget n'affiche plus un résumé plafonné à deux segments. Chaque fournisseur est un bloc vertical (logo 20 px, nom, chip de niveau) suivi de ses informations : Claude **Hebdo / Horaire / Hebdo Fable**, Antigravity **Gemini · Hebdo**, **Gemini · Horaire**, **Claude / GPT · Hebdo**, **Claude / GPT · Horaire**, **Hebdo Argon**.
- **Ollama visible** : « Limite Free » (quota) et « Crédits achetés » (réserve USD) sont désormais affichés, au lieu d'un simple « — » ; un compteur absent est signalé « non communiquée ».
- **API complètes** : tous les soldes et devises sont listés (DeepSeek USD + CNY, OpenRouter, RunInfra, OrcaRouter), avec la couleur de niveau.
- **Compacité** : une information unique (OpenAI, Grok, API mono-solde) reste en ligne avec le nom ; fenêtre **360 × 660**, lignes de 28 à 115 px, icônes 18 px, dix fournisseurs visibles sans défilement, barre fine 5 px seulement en cas de dépassement.
- **Police et segmentation** : Inter Variable, libellés Hebdo/Horaire/Hebdo Fable/Hebdo Argon et chips de statut conservés de la 0.3.5.

### Qualité

- Smokes réécrits pour le widget vertical : toutes les fenêtres (Claude 3, Antigravity 5), Ollama Free + crédits, soldes multi-devises, aucune information masquée, taille 360×660 sans défilement, défilement fin à 320 px ; libellé groupé (`Gemini · Hebdo`, `Grok / Bot / Cursor · Hebdo`) ; smoke Claude stabilisé (transport simulé avant écriture des credentials, 20 tentatives).
- `docs/validation-0.3.6.md` ; contrat UI mis à jour.

## 0.3.5 — 4 novembre 2026

Lisibilité des quotas et identité visuelle : segmentation explicite des abonnements, statuts soignés et nouvelle police.

### Interface

- **Segmentation des abonnements** : seules les fenêtres réellement fournies sont affichées, avec des libellés explicites — **Hebdo** (semaine), **Horaire** (5 heures), **Hebdo Fable** pour la limite Fable de Claude, **Hebdo Argon** pour la réserve Argon d’Antigravity (groupe « Argon »), plus aucun « 5 h » ni ligne « — » pour une fenêtre absente quand d’autres existent. Ordre Hebdo puis Horaire, groupes Gemini / Claude-GPT / Argon conservés.
- **Widget** : résumé segmenté sur deux segments maximum par ligne (les plus contraints), détail complet dans l’infobulle et aux lecteurs d’écran, `+N` pour les segments masqués ; toujours 10 fournisseurs visibles sans défilement à 360 × 520, lignes de 32 à 36 px, icônes 20 × 20.
- **Statuts de ressource** : nouveau chip discret et harmonisé (fond teinté, bordure, pastille, 11 px, contraste AA, `title` explicite) pour « Suffisant / Bas / Critique / Épuisé / Indisponible » dans les cartes, le widget, la fiche et la légende des Réglages ; le texte reste accessible.
- **Police** : **Inter Variable** (SIL OFL 1.1) embarquée dans `assets/fonts/` avec sa licence, appliquée à toute l’application et au widget, chiffres tabulaires, repli Segoe UI/system-ui, aucun chargement réseau.

### Qualité

- Tests adaptés aux libellés (Hebdo/Horaire/Hebdo Fable/Hebdo Argon), aux chips de statut et à la police embarquée ; smokes Electron rejoués, widget compact mesuré (10 lignes, sans défilement). Voir [docs/validation-0.3.5.md](docs/validation-0.3.5.md).

## 0.3.4 — 4 novembre 2026

Simplification produit demandée : suppression de la fonctionnalité de recommandation de modèle et widget compact.

### Produit et interface

- **Recommandations supprimées** partout : panneau « Ton ordre d’usage » du tableau de bord, suggestions « Utilise maintenant / Puis », classement des API, configuration d’ordre de consommation des Réglages et section de recommandation du widget. Le tableau de bord et le widget **listent** désormais les abonnements et les API avec leurs quotas, soldes et dates.
- **Fichiers retirés** : `lib/usage-strategy.js` (moteur et catalogue de tarifs), `renderer/strategy-ui.js`, `renderer/strategy.css`, tests associés, `docs/ordre-consommation.md`. L’IPC `strategy:update` et la méthode `updateStrategy` sont supprimés (23 canaux IPC).
- **Widget compact** : fenêtre par défaut **360 × 520 px** (au lieu de 400 × 700), lignes de 32 px, icônes 20 × 20 visibles, en-tête réduit, listes **Abonnements** puis **API** ; les dix fournisseurs tiennent **sans défilement** dans la fenêtre par défaut, avec une barre de défilement fine de 5 px seulement en cas de dépassement (fenêtre réduite ou police agrandie). Aucun élément coupé, focus et ARIA conservés.
- **Données** : migration non destructive qui retire `state.strategy` des inventaires existants (y compris l’ancienne configuration de modèles Gemini) ; l’état public et l’export JSON ne contiennent plus `strategy`.

### Qualité et documentation

- Tests supprimés/adaptés : `tests/usage-strategy.test.cjs` retiré, tests de migration (suppression de `strategy`), d’export (sans `strategy`), de sécurité et de qualité mis à jour ; smokes réécrits pour vérifier l’absence de recommandations et le widget compact 360 × 520 (10 lignes visibles sans défilement, icônes 20 px, défilement fin par redimensionnement).
- Documentation : README, `docs/architecture.md`, `docs/maintenance.md` mis à jour ; nouveau [docs/validation-0.3.4.md](docs/validation-0.3.4.md).

## 0.3.3 — 4 novembre 2026

Correctif de la connexion Claude : elle ne reste plus bloquée sur un relevé ancien lorsque la lecture directe échoue.

### Connexions

- **Claude** : si la lecture directe échoue (`rate-limit`, `auth-rate-limit`, `auth-*` — typiquement un jeton Claude Code à renouveler) et que le dernier relevé est absent **ou périmé de plus de 10 minutes**, ProvidersBar bascule désormais **explicitement** vers la lecture Claude Desktop et l’annonce. Auparavant, un ancien snapshot (même vieux de plusieurs jours) bloquait la bascule et le relevé restait figé. Un relevé frais (< 10 minutes) n’est jamais remplacé.
- **Relevé Desktop en repli** : un échantillon de plus de 45 minutes n’est plus une erreur bloquante dans ce seul cas de repli ; il est enregistré avec son horodatage réel, le drapeau `stale` et la mention « relevé ancien », afin d’afficher la dernière mesure honnête plutôt qu’un relevé de plusieurs jours. Le mode Desktop normal continue d’exiger un relevé de moins de 45 minutes.
- **Pas d’oscillation** : si le relevé Desktop est momentanément illisible ou absent, le mode Desktop est conservé (snapshot et cooldown intacts, message actionnable), afin que le prochain échantillon écrit par Claude Desktop soit récupéré automatiquement.
- **Lecture directe** : reste disponible après renouvellement du jeton dans Claude Code (`claude auth login`) et réactivation explicite ; le repli Desktop ne la désactive pas durablement.

### Qualité

- Tests : matrice de décision du repli (relevé absent/périmé/frais × codes d’erreur), seuil exact de 10 minutes, option `allowStale` (> 45 minutes) et non-régression du mode Desktop normal.
- Documentation : README et `docs/architecture.md` précisent la règle de bascule et l’affichage des relevés Desktop anciens ; nouveau [docs/validation-0.3.3.md](docs/validation-0.3.3.md).

## 0.3.2 — 4 novembre 2026

Correctif des connexions Ollama, OrcaRouter et OpenRouter, constatées cassées après la 0.3.0.

### Connexions

- **Ollama** : le portail `ollama.com/settings` a changé de structure (« Usage breakdown », « Free usage N % used », badge « Pay as you go », plus de section « Monthly usage »). Le lecteur reconnaît la nouvelle page : plan Free, quota restant calculé depuis le compteur, solde de crédits achetés lu depuis l’en-tête. Aucun crédit mensuel inclus n’est inventé ; les anciennes pages payantes restent prises en charge. Vérification réelle sur cette machine : `planTier: free`, quota restant 100 %, crédits achetés 1,05 USD.
- **OrcaRouter** : « Vérifier maintenant » exigeait l’ouverture de la fenêtre de connexion et, en cas d’absence, produisait une fausse erreur d’authentification qui **supprimait la session valide**. La vérification utilise désormais la référence de compte persistée (la fenêtre ne sert qu’à une connexion neuve ou à un changement de compte/espace), tolère les origines `www`/non-`www`, et remonte les erreurs `ORCA_AUTH`/`ORCA_RATE_LIMIT`/`ORCA_TRANSIENT` avec un message actionnable sans perdre le dernier relevé. Les commandes génériques d’ouverture/vérification routent aussi correctement OrcaRouter et Ollama. Vérifié sur une copie isolée : vérification sans fenêtre → portefeuille 27,258416 USD, session intacte ; ouverture réelle → `www.orcarouter.ai/console` puis `/console/overview`, détection OK.
- **OpenRouter** : un découvert réel (crédits consommés supérieurs aux crédits achetés, observé 45,08283509 USD pour 45,00 USD) était rejeté comme une incohérence, ce qui empêchait l’enregistrement de la clé de gestion. Le solde restant négatif est désormais conservé et affiché comme épuisé ; seules les réponses réellement incohérentes (format invalide, montants négatifs, découvert supérieur au montant acheté ou à 1 USD) sont refusées. Vérifié en réel avec la clé enregistrée : `remaining = -0,08283509 USD`, HTTP 200.

### Qualité

- Tests ajoutés : nouvelle page Ollama (fixture sanitisée, compteurs, cas négatifs), vérification Orca sans fenêtre et matrice de choix de référence, découvert OpenRouter réel et rejet des incohérences.
- `npm test`, `npm run verify`, les trois smoke tests Electron et `npm run doctor` sont rejoués ; détails et limites dans [docs/validation-0.3.2.md](docs/validation-0.3.2.md).

## 0.3.1 — 3 novembre 2026

Correctif ciblé des connexions Claude et Antigravity, constatées cassées après la 0.3.0.

### Connexions

- **Claude Desktop** : lecture du relevé `plan-usage-history.json` dans le nouveau profil `%LOCALAPPDATA%\Claude-Data\<profil>\` (versions récentes de Claude Desktop), en plus des deux emplacements historiques. La découverte est bornée à ce seul nom de fichier, le dossier absent est ignoré silencieusement et l’observateur de fichiers suit les nouveaux profils.
- **Antigravity** : découverte du service local corrigée. Certaines machines renvoient des sockets d’écoute avec `OwningProcess = 0` via `Get-NetTCPConnection -State Listen` ; la détection interroge désormais les ports **du processus vérifié** (avec repli CIM puis `netstat`), filtre les adresses de bouclage et trie `127.0.0.1` en premier. Erreurs distinctes : application introuvable (`ANTIGRAVITY_NOT_RUNNING`) ou service visible mais ports/jeton illisibles (`ANTIGRAVITY_NO_PORTS`). La lecture réelle des fenêtres Gemini et Claude/GPT fonctionne ; le bucket Argon reste suivi lorsqu’il est exposé par le compte.
- **Claude lecture directe** : un 429 du **renouvellement OAuth** porte désormais le code `auth-rate-limit` avec un message actionnable (ouvrir Claude Code pour renouveler, ou revenir à la lecture Desktop), distinct du 429 de l’endpoint d’usage (`rate-limit`). Le `Retry-After` du renouvellement n’est plus contourné au réveil de veille ; un changement de connexion locale efface toujours le cooldown.
- **Claude sans relevé** : si la lecture directe échoue (`rate-limit`/`auth-*`) **et** qu’aucun relevé n’existe, bascule explicite et annoncée vers la lecture Claude Desktop ; sinon l’erreur d’origine est conservée avec le relevé existant (aucun retour silencieux).

### Interface

- Le toast affiché après « Activer la lecture directe » tient compte d’une éventuelle bascule vers Claude Desktop et n’annonce plus « lecture directe activée » à tort.

### Qualité

- Tests ajoutés : profils Claude-Data (lecture, observateur, ancienneté), ports Antigravity par PID et erreurs typées, distinction `auth-rate-limit`/`rate-limit`, cooldown de renouvellement non contourné au réveil, décision et consigne du repli Claude Desktop.
- `npm test` : **238 tests**, `npm run verify` : 69 fichiers, `npm run doctor` : Claude Desktop et Antigravity détectés sur machine réelle ; smokes Electron rejoués (voir [docs/validation-0.3.1.md](docs/validation-0.3.1.md)).

## 0.3.0 — 3 novembre 2026

Version de refonte : fiabilité des connexions, sécurité du processus et des sessions, redessin accessible, outillage de diagnostic et passe de documentation. Electron **44.10.2** ; `npm audit` et `npm audit --omit=dev` : **0 vulnérabilité**.

### Sécurité

- `main.cjs` simplifié et durci : socle extrait dans `lib/data-store.cjs`, `lib/window-security.cjs` et `lib/privacy-export.cjs` ; garde IPC inchangée (frame principale et URL exacte de l’interface).
- Fenêtres d’interface : `devTools:false`, `spellcheck:false` ; identité Windows des notifications via `app.setAppUserModelId`.
- Fenêtres de connexion internes : navigation, redirections et popups limitées à une **liste fermée d’origines** (fournisseurs concernés et connexion Google) au lieu de « n’importe quel HTTPS » ; permissions et téléchargements refusés.
- Dossier de données restreint à l’utilisateur courant et à `SYSTEM` (`icacls /inheritance:r`) ; un échec produit un avertissement, jamais un blocage du démarrage.
- Purge au démarrage des fichiers `.tmp` interrompus, du port de diagnostic obsolète (sauf mode diagnostic), des sauvegardes de migration au-delà des deux plus récentes et des profils de navigateur temporaires orphelins.
- Export JSON nettoyé : `{ app, version, exportedAt, inventory, settings, strategy, manualResets, history }`, sans `accountSession`, `claudeSync`, `apiCooldowns` ni identité pseudonyme.
- Nouvelle action **Effacer mes données** (IPC `data:erase`, double confirmation côté interface) : supprime état, identifiants, profils et caches, puis réinitialise l’inventaire ; refusée pendant une synchronisation.
- Nouvel IPC `app:info` (version via `app.getVersion()`, plateforme, dossier de données, mode empaqueté) et `publicState().app` sans chemin absolu. Surface IPC portée à **24 canaux**.
- Sessions de navigateur sans **port TCP de débogage** : les lecteurs de comptes pilotent Chrome/Edge par `--remote-debugging-pipe` ; la première connexion se fait dans un navigateur ordinaire sans port de débogage, et un port local n’existe qu’en mode diagnostic explicite.

### Connexions

- Cooldowns 429 des clés API **persistants** (`state.apiCooldowns`, 100 entrées maximum), respectés après redémarrage, avec erreur `API_RATE_LIMIT` et heure de reprise conservées.
- Claude : instance unique du lecteur avec `fetchImpl = session.defaultSession.fetch` (proxy Windows respecté) ; renouvellement OAuth créé par la même factory, sans `globalThis.fetch` ; cooldown d’échec restauré au démarrage, reprise après rotation des identifiants, sortie de veille et réactivation de l’actualisation.
- Ollama et OrcaRouter : session enregistrée **avant** la première lecture ; une erreur transitoire ou un 429 conserve la session et le dernier relevé, le cycle de 5 minutes réessaie seul ; seule une authentification refusée (`OLLAMA_SIGNIN`, `ORCA_AUTH`) efface la session.
- Erreurs de connecteurs typées et distinctes (`API_RATE_LIMIT`, `OLLAMA_SIGNIN`/`OLLAMA_RATE_LIMIT`/`OLLAMA_TRANSIENT`, `ORCA_AUTH`/`ORCA_RATE_LIMIT`/`ORCA_TRANSIENT`) ; aucune logique de cooldown dupliquée.
- Requêtes API : GET uniquement, redirections refusées, délai de 20 s, reprises bornées et jitterisées, `Retry-After` plafonné ; rejet des réponses incohérentes (soldes négatifs ou incohérents, formats ambigus) plutôt qu’estimation.
- Nouveau diagnostic `npm run doctor` (17 contrôles lecture seule : dossier de données, DPAPI, navigateur, Codex, Claude Desktop, Claude Code, service Antigravity, accès réseau aux API) ; seuls `data-dir` et `encryption` sont bloquants.
- Nettoyage des profils temporaires délégué à `sweepTemporaryProfiles`, appelé au démarrage et lors de l’effacement.

### Interface

- Redessin du tableau de bord et du widget : shell, vues et helpers séparés (`renderer/views.js`, `renderer/ui-core.js`), CSS lisible et thèmes à tokens sémantiques.
- Thèmes **Clair / Sombre / Système (Windows)** : `system` suit `prefers-color-scheme` en direct (y compris changement Windows à chaud) ; les préférences explicites existantes sont conservées par migration.
- Accessibilité : contrastes texte ≥ 4,5:1 et focus ≥ 3:1, navigation jamais masquée (barre supérieure sous 900 px CSS), lien d’évitement, focus restauré après rendu, ARIA (navigation nommée, onglets, jauges avec valeur textuelle, `aria-live`), information jamais portée par la couleur seule, `prefers-reduced-motion` et `forced-colors`, texte ≥ 11 px.
- Widget : fraîcheur par ligne (« à l’instant », « il y a X min », « Relevé ancien ») et statut d’actualisation réel (« Actualisation auto : 5 min · Claude 1 min » ou désactivée).
- Version affichée dynamiquement depuis `app:info` ; marque neutre « Espace local » (plus de nom personnel) ; action **Effacer mes données** avec double confirmation ; mention explicite « Aucune télémétrie ».

### Qualité

- Suite unitaire portée à **226 tests**, 0 échec (un test d’aperçu s’auto-ignore si le port 4317 est déjà occupé), dont nouveaux tests pour `data-store`, `window-security`, `privacy-export`, `diagnostics`, packaging, qualité transverse et extensions de migrations.
- Test qualité réactivé sur la cohérence des versions : `package.json` = dernier titre du CHANGELOG = version annoncée par le README.
- `npm run verify` / `npm run lint` : vérification syntaxique de **68 fichiers** ; `npm run test:coverage` disponible.
- Intégration continue Windows (`.github/workflows/ci.yml`) : job **tests** obligatoire (`npm ci`, `verify`, `lint`, `npm test`, `npm audit --omit=dev`) et job **smoke-electron** best-effort (`continue-on-error`) pour les trois smoke tests, avec artefacts.
- Dé-flake d’un test de reprise réseau (horloge injectée) ; robustesse des timers du processus principal (expiration et actualisation protégées, synchronisations sans rejet non géré).
- Dépendances : Electron **44.10.2**, Playwright 1.63.0, `proper-lockfile` 4.1.2 ; aucune nouvelle dépendance.

### Documentation

- README réécrit pour la 0.3.0 (utilisation, dix fournisseurs, comportement des connexions, interface accessible, confidentialité, commandes réelles, CI, limites honnêtes).
- `docs/architecture.md` mis à jour : stockage et migrations, sécurité des fenêtres, allowlist, ACL, purge, sessions par pipe CDP, cooldowns, sessions Ollama/Orca, 24 canaux IPC, thème système.
- `docs/ordre-consommation.md` corrigé : trois réserves Antigravity (Gemini, Claude/GPT, Argon), priorité Argon, profil de coût aligné sur le cache lu (écriture exclue).
- Nouveau `docs/validation-0.3.0.md` (résultats réels datés, emplacements smoke à compléter) ; `renderer/CONTRAT-UI.md` documente le contrat d’interface de la refonte.

## 0.2.1 — 17 octobre 2026

- L’actualisation automatique Grok utilise un navigateur sans fenêtre, sans ouvrir ni réduire une fenêtre à chaque relevé.
- Si le dashboard redirige vers une authentification externe, le lecteur essaie une seule fois le panneau officiel Grok. Il ne lit pas la page d’authentification externe et conserve les quotas SuperGrok et Grok Bot distincts.
- Test de régression sur les actualisations répétées et vérification réelle des deux quotas sans fenêtre. La connexion et la vérification manuelles restent visibles.
- Le lecteur attend le rendu de la limite Grok Bot déjà connue pour éviter de la faire disparaître pendant le chargement du panneau.

## 0.2.0 — 17 octobre 2026

- Connexion au nouveau dashboard Grok, avec lecture du pool hebdomadaire partagé Grok/Grok Bot/Cursor et compatibilité du panneau Usage historique.
- Quota hebdomadaire Gemini 4 Argon dans le lecteur Antigravity, les cartes, le widget, les réinitialisations et les recommandations.
- Protection des connexions : tests des erreurs réseau, délais, renouvellement Claude, concurrence et conservation des derniers relevés.
- Intégration des changements locaux existants : lecture directe Claude, réserve Ollama, thèmes, dates et stratégie de consommation.
- Suppression du lecteur et du logo Gemini web devenus inutilisés ; correction du logo Claude dans l’aperçu.
- Remplacement complet des ressources lors des mises à jour, sans toucher aux comptes, et construction séparée d’une distribution sans données personnelles.
- README réorganisé et diagnostic réel des connexions explicite, avec rapport local sans secrets.
