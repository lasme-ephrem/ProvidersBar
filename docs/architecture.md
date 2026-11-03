# Architecture

`main.cjs` (processus principal Electron) gère le cycle de vie, les fenêtres, la zone de notification, la surface IPC, l’orchestration des lectures et l’état en mémoire. Il délègue au reste de `lib/` : stockage et migrations, sécurité des fenêtres et du dossier de données, export nettoyé, connecteurs, diagnostic. Le renderer utilise le pont explicite de `preload.cjs` : Node.js est désactivé dans les fenêtres, avec isolation du contexte, sandbox, `devTools:false` et `spellcheck:false`.

## Processus principal et cycle de vie

- **Dossier de données** : `PROVIDERSBAR_DATA_DIR`, sinon `data/` à côté de l’exécutable (packagé) ou `.local/` (développement). Il est aussi utilisé comme `userData` Electron : `state.json`, `credentials.json`, les partitions Chromium et les profils de navigateur y cohabitent.
- **Instance unique** : `app.requestSingleInstanceLock()` ; un second lancement réaffiche la fenêtre principale.
- **Démarrage** : création du dossier, restriction ACL (`lib/window-security.cjs`), chargement de l’état avec migrations (`lib/data-store.cjs`), purge des résidus, chargement des clés chiffrées, enregistrement de l’IPC, création des deux fenêtres, du tray, des observateurs et des timers.
- **Erreur de démarrage** : dialogue d’erreur et arrêt ; les fichiers existants ne sont jamais réinitialisés silencieusement.
- **Fenêtres** : la fenêtre principale se masque à la fermeture ; le widget est une fenêtre sans cadre, ancrée au tray, masquée au blur et dimensionnée sur son contenu. Les fenêtres de connexion internes (OrcaRouter, Ollama) sont sandboxées, sans preload, avec partition persistante et liste fermée d’origines.
- **Timers** : échéance Claude toutes les 2 s (vérifie `nextAttemptAt`), expiration des abonnements toutes les 60 s, actualisation et notifications toutes les 5 min, actualisation initiale si activée ; tous `unref()` et protégés contre les exceptions. Observateurs de fichiers sur les identifiants Claude Code (2 s) et le relevé Claude Desktop (2 s).
- **Reprise** : `powerMonitor` (`resume`, `unlock-screen`) réveille la lecture Claude et déclenche une synchronisation si elle est due.
- **Arrêt ordonné** (`before-quit`) : arrêt des observateurs, fermeture des navigateurs et attente des travaux en cours, puis vidage de la file d’écriture (`store.settle()` et `credentials.settled()`), avant l’arrêt effectif.
- **Notifications** : identité Windows via `app.setAppUserModelId` ; seuils d’échéance et de solde USD ; une alerte par jour et par motif ; calcul protégé contre un relevé sans tableau de soldes.

## Surface IPC

Tous les canaux passent par une garde unique : la frame émettrice doit être la **frame principale** de la fenêtre et son URL, paramètres retirés, doit être **exactement** le fichier `renderer/index.html` de l’installation (`main.cjs`). Aucun canal générique de fichiers, de commandes ou de réseau n’est exposé ; une clé API en clair ne circule du renderer vers le processus principal qu’au moment de `provider:connect`.

**24 canaux `ipcMain.handle`**, miroir exact dans `preload.cjs` (24 méthodes `invoke` + l’abonnement `state:changed`) :

| Domaine | Canaux |
| --- | --- |
| État et fenêtres | `state:get`, `history:get`, `window:main`, `window:quick-size`, `app:info` |
| Inventaire | `provider:update`, `provider:manual`, `provider:resets`, `provider:connect`, `provider:disconnect` |
| Synchronisation | `sync:all`, `sync:one` |
| Réglages et stratégie | `settings:update`, `strategy:update` |
| Connexions de compte | `account:open`, `account:verify`, `orca:open-account`, `orca:verify-account`, `ollama:open-account`, `ollama:open-email`, `ollama:verify-account`, `claude:enable-live` |
| Données | `export`, `data:erase` |

`publicState()` expose l’inventaire sans l’historique complet (`historyCount` et `historyRevision`), la destination de chaque compteur, `summary`, `desktop`, `app: { version, electron, packaged }` (sans chemin absolu) et `history:get` sert l’historique complet. `app:info` renvoie `{ version, electron, platform, dataDir, packaged }`, la version venant de `app.getVersion()` (source unique). `settings.theme` accepte `light`, `dark` et `system`.

## Stockage, migrations et cooldowns

`lib/data-store.cjs` porte tout ce qui touche au fichier d’état :

- **Format** : `state = { version: 1, providers, settings, history, strategy?, apiCooldowns }`. Un format inconnu ou un JSON illisible fait échouer le démarrage ; l’application ne réinitialise jamais l’état à la place de l’utilisateur.
- **Écriture atomique sérialisée** : fichier `.tmp` puis `rename`, mode `0o600`, file d’écriture unique ; `settle()` permet un arrêt propre. Les identifiants suivent le même chemin (`credentials.json`).
- **Migrations idempotentes** exécutées dans l’ordre historique : nettoyage des métadonnées d’import, ajout d’Antigravity puis de Claude, retrait des services obsolètes, normalisation de présentation, normalisation du thème, initialisation non destructive des cooldowns, expiration des abonnements, purge des relevés OrcaRouter invalides, plafonnement de l’historique.
- **Sauvegardes** : `state.before-subscription-removal.json` et `state.before-orca-balance-fix.json`, écrites avec le drapeau `wx` (jamais écrasées) ; la purge de démarrage ne conserve que les deux sauvegardes les plus récentes.
- **Historique** : plafonné à **20 000** relevés (`HISTORY_LIMIT`), les plus anciens purgés au chargement et à chaque écriture.
- **Clés API** : chiffrées par `safeStorage`/DPAPI, base64 dans `credentials.json`, décryptées en mémoire uniquement pour un appel ; le store ne publie une valeur qu’après l’écriture disque réussie (`lib/credential-store.cjs`).
- **Cooldowns 429** : `state.apiCooldowns` mappe `<fournisseur>:<sha256(clé)>` vers une échéance en millisecondes, plafonné à 100 entrées. `main.cjs` fournit à `fetchUsage` un store synchrone `{ get, set, prune }` adossé à cet objet ; la valeur est écrite immédiatement sur 429 et purgée avant chaque lecture. Les cooldowns Ollama/Orca restent gérés en mémoire par leurs modules respectifs (aucune duplication d’état).

## Sécurité des fenêtres et des sessions

`lib/window-security.cjs` :

- `secureWindow(win)` : navigation refusée, `window.open` refusé, permissions refusées (requête et vérification), garde `devtools-opened`.
- `secureAccountWindow(win, allowedOrigins)` : navigation, redirections et popups limitées à une **allowlist d’origines HTTPS** (Ollama, OrcaRouter, connexion Google) ; les fenêtres créées héritent des mêmes règles et des webPreferences durcies.
- `applyDataDirAcl(dataDir)` : sous Windows, `icacls /inheritance:r` puis droits complets pour l’utilisateur courant et `SYSTEM` ; délai borné et échec non bloquant (avertissement).
- `purgeLeftovers(dataDir)` : fichiers `.tmp`, `DevToolsActivePort` obsolète (préservé en mode diagnostic), sauvegardes au-delà de deux, profils `temporary-account-browsers` (délégation à `sweepTemporaryProfiles` de `account-browser.cjs`, sinon suppression directe).

**Sessions navigateur** : chaque fournisseur web utilise un profil Chrome/Edge dédié ou une partition Electron. Les lecteurs pilotent le navigateur par **`--remote-debugging-pipe`** (messages JSON terminés par NUL) : aucun port TCP de débogage n’est ouvert. Un port local n’existe qu’en **mode diagnostic explicite** (`--remote-debugging-port=0`), utilisé par `npm run verify:connections` et `npm run update:portable` ; pour cette raison, la purge de démarrage ne supprime pas `DevToolsActivePort` lorsque ce mode est actif.

## Export et effacement

`lib/privacy-export.cjs` transforme l’état en document autonome `{ app, version, exportedAt, inventory, settings, strategy, manualResets, history }` : les clés `accountSession`, `claudeSync`, `apiCooldowns`, `identity`, `email`, `emailHash`, `userId`, `workspaceId` sont retirées récursivement ; les compléments de date sont regroupés à part, par fournisseur. L’export ne contient ni clé, ni cookie, ni jeton. Aucune restauration n’est proposée.

`data:erase` (double confirmation côté interface) refuse de s’exécuter pendant une synchronisation ou une déconnexion, ferme les navigateurs et fenêtres de connexion, vide les partitions et le store de clés, supprime état, identifiants, profils, sauvegardes et caches Chromium, purge les résidus, puis réinitialise l’inventaire (`createSeed()`) et rediffuse l’état. Les cooldowns mémoire Ollama/Orca sont remis à zéro via les fonctions de leurs modules.

## Connecteurs

| Module dans lib/ | Responsabilité |
| --- | --- |
| connectors.cjs | API de crédits OpenRouter, DeepSeek et RunInfra ; store de cooldowns injectable, reprises bornées |
| openai-account.cjs | codex app-server : compte, limites, connexion officielle |
| antigravity-account.cjs | Service local vérifié, méthode RetrieveUserQuotaSummary |
| subscription-accounts.cjs | Lecture ciblée des quotas Grok et Z.ai |
| account-browser.cjs | Navigateur de connexion dédié (pipe CDP), lecture en arrière-plan, purge des profils temporaires |
| subscription-controller.cjs | Coordination, annulation, priorité des vérifications interactives |
| ollama-account.cjs | Crédits mensuels et réserve supplémentaires ; codes d’erreur d’authentification/transitoires |
| orca-account.cjs | Portefeuille de l’espace de travail OrcaRouter ; codes d’erreur d’authentification/transitoires |
| provider-catalog.cjs | Métadonnées et instructions de connexion |
| diagnostics.cjs | Contrôles de prérequis lecture seule (utilisés par `scripts/doctor.cjs`) |
| claude-connection.cjs | Renouvellement OAuth de Claude Code sous verrous, écriture atomique |
| claude-live-usage.cjs | Lecture directe des quotas Anthropic (instance unique côté `main.cjs`) |
| claude-desktop-usage.cjs | Relevé local Claude Desktop et observateur de fichier |
| usage-strategy.js | Moteur de recommandations pur, partagé Node/renderer |

Claude lit par défaut `plan-usage-history.json` dans le profil local de Claude Desktop (Store Windows ou profil Roaming). `claude-desktop-usage.cjs` valide le format, la fraîcheur et les champs `fh` et `sd`, puis transforme les pourcentages utilisés en quotas restants. Les deux chemins sont comparés pour choisir le relevé le plus récent. Un observateur de fichiers (2 secondes) déclenche une lecture dès qu’un nouvel échantillon est écrit, en respectant le suivi et l’actualisation automatique. Claude Desktop peut suspendre ses mesures : relire le fichier ne force pas leur actualisation. Le fichier n’expose pas les prochaines remises à zéro : seules les dates antérieurement confirmées encore futures sont conservées.

`claude-live-usage.cjs` fournit une lecture directe optionnelle, activée exclusivement par `claude:enable-live`. `main.cjs` en crée **une instance unique** au démarrage : `createClaudeLiveReader({ fetchImpl: apiFetch })`, où `apiFetch` est `session.defaultSession.fetch` (configuration réseau/proxy Windows). Le renouvellement OAuth est créé par la même factory ; aucun jeton ne quitte le processus principal vers le renderer ou la persistance, et aucun appel Claude n’utilise `globalThis.fetch`. Le compte enregistré ne contient que `{ kind: 'claude-live-local' }`. Un timer d’une minute respecte le suivi et l’actualisation automatique ; le lecteur sérialise les requêtes et impose le même intervalle aux clics manuels. Les erreurs gardent le dernier relevé et son horodatage ; les 429 respectent `Retry-After` avec un minimum de cinq minutes. Les deux quotas partagés sont obligatoires et les limites par modèle sont affichées séparément sans remplacer la semaine globale. L’état persistant `p.claudeSync` ne conserve que le cooldown d’échec et est restauré au démarrage ; il est effacé à la déconnexion.

**Repli explicite vers Claude Desktop** : en lecture directe, aucun retour silencieux vers un fichier Desktop plus ancien ne se produit tant qu’un relevé direct existe (il est conservé avec son horodatage). En l’absence de **tout** relevé, une lecture directe bloquée par un 429 de quota ou de renouvellement OAuth, ou par une erreur d’authentification (`rate-limit`, `auth-rate-limit`, `auth-*`), déclenche une lecture Claude Desktop de secours. Si elle réussit, `accountSession` passe explicitement à `{ kind: 'claude-desktop-local' }`, le relevé est enregistré (`record`) et l’interface annonce « Lecture directe indisponible (renouvellement du jeton Claude Code limité) ; ProvidersBar utilise le relevé Claude Desktop. » — la bascule est donc annoncée, pas silencieuse, et aucune rotation de jeton n’est forcée. Si Claude Desktop est aussi illisible, l’erreur d’origine est conservée (code et cooldown inclus) et enrichie de la consigne : ouvrir Claude Code pour renouveler le jeton, ou déconnecter puis reconnecter Claude pour utiliser la lecture Desktop. La décision de repli est une fonction pure de `main.cjs` (`shouldFallbackToClaudeDesktop`), couverte par `tests/claude-desktop-usage.test.cjs`.

`claude-connection.cjs` renouvelle la connexion cinq minutes avant son expiration et une fois sur HTTP 401. Il utilise le protocole du Claude Code installé (2.1.285), les scopes déjà accordés, le client existant et les verrous `.oauth_refresh.lock` et le verrou historique du répertoire (stale 60 s, heartbeat 5 s). Une seconde lecture sous verrou adopte un jeton renouvelé par un autre processus. L’écriture atomique conserve les autres champs, compare les jetons avant écriture et ne recrée pas un fichier supprimé pendant la requête. Une rotation dont l’enregistrement échoue reste en mémoire pour retenter l’écriture avant un nouvel échange. Les refus définitifs nécessitent une reconnexion dans Claude Code. Aucun jeton ne va dans les données ProvidersBar.

Z.ai lit la consommation du plan. Grok lit le dashboard Usage du nouveau forfait partagé, ou le panneau Settings → Usage historique. Un pool X Subscription représente une seule réserve Grok/Bot/Cursor. Sur un compte SuperGrok présentant deux limites, `Semaine` et `Grok Bot · Semaine` restent indépendantes. Les compteurs animés sont associés à leur section et jamais pris dans les dépenses par modèle ou les crédits supplémentaires. Ces interfaces peuvent évoluer : un format inconnu produit une erreur, jamais une estimation silencieuse.

**Ollama** et **OrcaRouter** enregistrent leur session (`accountSession`) **avant** la première lecture : une erreur transitoire (`OLLAMA_RATE_LIMIT`/`OLLAMA_TRANSIENT`, `ORCA_RATE_LIMIT`/`ORCA_TRANSIENT`) conserve la connexion, le dernier relevé et `p.error`, et le cycle de 5 minutes réessaie ; une authentification refusée (`OLLAMA_SIGNIN`, `ORCA_AUTH`) efface la session pour demander une reconnexion. OrcaRouter calcule le portefeuille à partir de `active_workspace.wallet_quota` et du `quota_per_unit` fourni par le service ; `hard_limit_usd` est un plafond de clé, pas un solde. Ollama suit son usage inclus et son montant `Usage credits / Current balance` dans la même fiche et la même synchronisation ; un montant absent ou ambigu reste inconnu.

Antigravity interroge seulement `127.0.0.1` sur les ports du processus de l’installation reconnue. L’acceptation du certificat auto-signé est limitée à cette requête locale ; le jeton CSRF reste en mémoire ; l’application Antigravity 2.0 doit être ouverte (l’IDE seul n’est pas utilisé).

Un relevé contient des soldes par devise, un quota principal et éventuellement plusieurs `quotaWindows`. Pour Antigravity, le quota principal enregistré est le minimum des limites reçues ; les cartes et le widget distinguent les trois réserves : Gemini (semaine et 5 h), Claude/GPT (semaine et 5 h) et Gemini 4 Argon (semaine). Le bucket Argon `gemini-argon-wtu-weekly` a été observé dans le service installé, sans lui inventer de fenêtre de cinq heures. Une session authentifiée et un quota lisible sont deux états distincts.

`subscriptionStatus` (`active`, `paused`, `expired`) et `statusMessage` décrivent l’état d’un abonnement indépendamment de la connexion. Une échéance dépassée fait passer automatiquement un forfait actif à `expired` au démarrage, à la lecture de l’état ou pendant que l’application reste ouverte. Le prix, la date et l’historique sont conservés. La réactivation exige une confirmation explicite et une nouvelle échéance future. Les forfaits expirés sortent du budget et des recommandations. Ollama reste synchronisé sous Free à 0 $ pour afficher sa limite et son montant de crédits achetés ; son ancien quota payant est invalidé.

## Interface

`renderer/index.html` charge, dans l’ordre, `theme-init.js` puis les feuilles de style, les modules partagés de `lib/` (`quota-resets.js`, `resource-levels.js`, `usage-strategy.js`) et les scripts du renderer (`ui-core.js`, `reset-ui.js`, `strategy-ui.js`, `views.js`, `app.js`). `ui-core.js` fournit échappement, formatage, icônes, thème, focus, annonces et niveaux ; `views.js` contient les vues et le HTML des fiches et du widget ; `app.js` porte l’état, les événements, la boucle de rendu et les actions. Aucun script inline, aucun `eval`, aucune dépendance externe ; la CSP de `index.html` interdit les ressources distantes et `connect-src 'self'`.

Le thème sombre d’origine reste dans `styles.css` et `strategy.css` ; `renderer/theme.css` définit les tokens sémantiques clair/sombre. `settings.theme` vaut `light`, `dark` ou `system` ; `system` est résolu par `matchMedia('(prefers-color-scheme: dark)')` et suit les changements Windows en direct ; `main.cjs` aligne le fond natif via `nativeTheme.shouldUseDarkColors`. Les préférences explicites des anciens inventaires sont conservées (migration non destructive).

Le contrat d’interface détaillé (globals, hooks DOM, structure du dialogue, accessibilité, widget) est maintenu dans [renderer/CONTRAT-UI.md](../renderer/CONTRAT-UI.md). Le serveur d’aperçu expose une liste fermée de ressources publiques et un inventaire sans comptes connectés ; il ne sert jamais les dossiers de données.

## Réinitialisations

`lib/quota-resets.js` décrit les limites affichées, valide les compléments de date et choisit la provenance. `renderer/reset-ui.js` formate les dates locales et l’onglet de saisie. Les compléments persistent dans `provider.manualResets` via `provider:resets`, même pour les comptes connectés ; ils ne modifient ni le snapshot du connecteur ni l’historique.

Une date fournisseur a priorité. Un complément sans heure conserve sa précision au jour. Le moteur de recommandation reçoit une projection temporaire : pour une date sans heure, la borne de fin du jour local sert à détecter une date dépassée, sans présenter cette borne comme l’heure réelle de reset. Les pourcentages et la fraîcheur du relevé ne sont jamais changés par un complément.

## Recommandations

Argon a sa propre réserve hebdomadaire, indépendante de Gemini et de Claude/GPT. Aucun score de qualité n’est inventé : ce modèle reste classé après les modèles dont un score est connu. Le quota Grok Bot historique entre dans la stratégie seulement lorsqu’une limite indépendante est relevée ; un pool partagé ne crée jamais une deuxième réserve.

`lib/usage-strategy.js` est un module pur partagé par Node et les deux renderers : catalogue daté, validation des options, disponibilité des réserves, estimation des coûts et classement. Aucun accès réseau ni clé ne lui est transmis. Le recalcul utilise l’état public au rendu, à chaque synchronisation et chaque minute pour la fraîcheur et les plages tarifaires.

`state.strategy` est facultatif pour les anciens inventaires. Les valeurs par défaut sont calculées sans migration destructive. Le pont `strategy:update` valide et persiste une configuration complète, séparée des préférences générales. `renderer/strategy-ui.js` affiche les recommandations et leur configuration ; `renderer/strategy.css` contient leurs styles. Le serveur d’aperçu autorise explicitement ces ressources et reste en lecture seule.

Les fenêtres d’un même quota sont évaluées ensemble. Antigravity possède trois réserves indépendantes ; Codex ne réutilise pas le quota Spark comme substitut ; Ollama nécessite un relevé de crédits mensuels inclus identifié. La file de recommandations et le champ `recommended` contiennent exclusivement les abonnements actifs disponibles ; les abonnements absents, expirés ou en pause sont écartés. `apiProviders` contient séparément les fournisseurs API actifs avec solde USD positif confirmé et récent, triés par crédits restants décroissants, indépendamment du catalogue tarifaire ou du profil de tokens. Aucune API ne devient une recommandation, même lorsque tous les abonnements sont indisponibles.

## Diagnostic

`lib/diagnostics.cjs` fournit des contrôles **lecture seule** et sans secret : dossier de données, chiffrement DPAPI (sonde PowerShell), navigateur Chrome/Edge, Codex, Claude Desktop, Claude Code, service local Antigravity, puis un accès HTTP non authentifié par endpoint de fournisseur (401/403 considérés comme normaux). `scripts/doctor.cjs` les exécute (`npm run doctor`, `--json` disponible) ; seuls `data-dir` et `encryption` sont bloquants, les autres résultats sont des avertissements actionnables. `scripts/verify-connections.cjs` reste le diagnostic **réel** des connexions : il se connecte au portable lancé avec `--remote-debugging-port=0`, vérifie l’URL exacte de la fenêtre, synchronise puis écrit `test-results/connections-live.json` sans identité, clé, cookie ni montant de portefeuille.
