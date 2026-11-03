# ProvidersBar

Application desktop Windows pour suivre les abonnements, quotas et crédits de **dix fournisseurs d’IA**. Un tableau de bord et un widget dans la zone de notification regroupent les ressources restantes, leur fraîcheur et leurs dates de réinitialisation.

**Version 0.3.0 — 3 novembre 2026 :** refonte de fiabilité et de sécurité des connexions, redessin accessible du tableau de bord et du widget, thème système, effacement des données, historique porté à 20 000 relevés, `main.cjs` simplifié et durci. Détails dans [CHANGELOG.md](CHANGELOG.md) et [docs/validation-0.3.0.md](docs/validation-0.3.0.md).

## Ce qui change en 0.3.0

- **Connexions plus fiables** : une session Ollama ou OrcaRouter est conservée dès qu’elle est validée, même si la lecture échoue temporairement ; le cycle d’actualisation réessaie seul au lieu de demander une reconnexion. Les cooldowns 429 des clés API survivent au redémarrage.
- **Session navigateur durcie** : les lecteurs de comptes pilotent Chrome/Edge par un **pipe local** (plus de port TCP de débogage) ; la première connexion se fait dans un navigateur ordinaire, sans port de débogage, et les fenêtres de connexion internes n’acceptent qu’une **liste fermée d’origines** (fournisseurs concernés et connexion Google).
- **Diagnostic intégré** : `npm run doctor` vérifie en lecture seule les prérequis (dossier de données, DPAPI, navigateur, Codex, Claude, Antigravity, accès réseau aux API).
- **Interface redessinée et accessible** : thèmes clair / sombre / **système**, contrastes AA, navigation jamais masquée, widget avec fraîcheur des relevés et statut d’actualisation réel, version affichée dynamiquement, marque neutre.
- **Données maîtrisées** : export JSON nettoyé (sans clés, sessions ni identifiants), action **Effacer mes données** avec double confirmation, dossier de données à ACL restreinte, purge automatique des fichiers résiduels.

## Utiliser l’application

Lancer **`Lancer ProvidersBar.cmd`** (portable personnel) ou `dist/ProvidersBar-win32-x64/ProvidersBar.exe`. Conserver tout le dossier du portable : Node.js n’est pas nécessaire sur le PC qui l’utilise. Le dossier `dist/` est généré et exclu de Git ; pour produire une distribution propre, voir la section « Fabriquer et mettre à jour » ci-dessous.

1. **Connexions** : connecter les comptes et renseigner les clés API.
2. **Vue d’ensemble** : cartes par fournisseur, ressources restantes, prochaine réinitialisation.
3. **Abonnements** : prix, échéances, périodicité et budget mensuel.
4. **Réglages** : actualisation automatique, notifications, thème (Clair / Sombre / Système), ordre de consommation, version, effacement des données.

Fermer la fenêtre conserve l’application dans la zone de notification. Un clic sur l’icône ouvre le widget ; clic droit → **Quitter** arrête l’application. L’historique et l’export JSON restent accessibles depuis le tableau de bord.

Les pourcentages indiquent les **quotas restants**. Une valeur absente reste inconnue. Chaque fenêtre garde son propre état ; épuiser une réserve ne signifie pas que toutes les réserves du fournisseur le sont. Les couleurs passent du rouge à zéro à l’orange (≤ 10 % ou 2 USD), au jaune (≤ 25 % ou 5 USD), puis au vert ; les seuils monétaires concernent uniquement les crédits USD. Un relevé de plus de dix minutes, en erreur ou déconnecté est signalé « Relevé ancien » sans perdre son contraste.

## Connexions et données disponibles

| Fournisseur | Connexion requise | Ressources suivies |
| --- | --- | --- |
| OpenAI GPT | Codex installé et connecté à ChatGPT | Limites et dates de remise à zéro lues via Codex |
| Anthropic Claude | Claude Desktop, ou lecture directe activée avec Claude Code connecté | Session de 5 h, semaine, limites par modèle et dates si fournies |
| xAI Grok | Compte dans Chrome ou Edge dédié | Quota hebdomadaire du dashboard ; ancien panneau Usage compatible |
| Antigravity | Antigravity App ouvert et connecté à Google | Gemini et Claude/GPT : semaine + 5 h ; **Gemini 4 Argon : semaine** |
| Z.ai | Compte Token Plan dans Chrome ou Edge dédié | Semaine et 5 h |
| Ollama | Compte connecté | Crédits mensuels inclus et réserve de crédits supplémentaires |
| OpenRouter | Clé de gestion (Management key) | Crédits achetés, consommés et restants |
| DeepSeek Platform | Clé API | Solde dans sa devise USD/CNY |
| RunInfra | Clé d’espace de travail non restreinte | Solde, réservations et dépenses de période |
| OrcaRouter | Session de compte et espace de travail | Portefeuille réel, distinct du plafond d’une clé API |

Les connecteurs lisent les ressources ; ils ne lancent aucun modèle et n’achètent rien. Lire le solde d’une clé ne prouve pas ses droits d’inférence sur tous les modèles.

### Comportement des connexions

- **Sessions conservées** : pour Ollama et OrcaRouter, la session est enregistrée dès qu’elle est validée, **avant** la première lecture. Un 429 ou une panne transitoire conserve la connexion et le dernier relevé, affiche l’erreur et laisse le cycle de 5 minutes réessayer. Seule une authentification refusée (`OLLAMA_SIGNIN`, `ORCA_AUTH`) efface la session et redemande une connexion.
- **Cooldowns 429** : lorsqu’une clé API (OpenRouter, DeepSeek, RunInfra) reçoit un 429, l’échéance est mémorisée dans l’état public (`state.apiCooldowns`, 100 entrées maximum) et respectée après redémarrage. L’erreur reste `API_RATE_LIMIT` avec l’heure de reprise.
- **Proxy Windows** : les appels API et la lecture directe Claude passent par `session.defaultSession.fetch`, donc par la configuration réseau et proxy de Windows (comme les fenêtres de l’application).
- **Lectures bornées** : GET uniquement, redirections refusées, délai de 20 s, une seule reprise sur erreur réseau ou 502/503/504, `Retry-After` respecté et plafonné. Aucune estimation n’est inventée quand un format change : le dernier relevé est conservé avec un message.
- **Diagnostic** : `npm run doctor` liste 17 contrôles. Deux seulement sont bloquants (dossier de données et chiffrement DPAPI) ; les autres sont des avertissements actionnables.

### Grok et Grok Bot

Avec **The X Subscription**, Grok, Grok Bot et les usages Cursor éligibles consomment un même pool hebdomadaire, consultable dans [grok.com/dashboard → Usage](https://grok.com/dashboard). ProvidersBar suit ce pool sans fabriquer un deuxième quota Bot. L’authentification xAI commune ne fusionne pas les comptes et ne change aucun forfait.

Les anciens forfaits SuperGrok restent distincts : le panneau Settings → Usage est conservé comme parcours compatible. Lorsqu’il affiche une **Weekly Grok Bot Limit**, ProvidersBar la lit séparément de la limite SuperGrok, avec sa propre date de reset ; l’épuisement de l’une ne bloque pas artificiellement l’autre. Certains comptes historiques utilisent encore le dashboard Cursor. Un compteur absent n’est jamais déduit de l’autre quota. [Parcours et limites officiels](https://docs.x.ai/x-subscription/grok-bot), [pool hebdomadaire](https://docs.x.ai/x-subscription/usage-limits).

Pour la première connexion web, se connecter dans la fenêtre Chrome ou Edge dédiée, puis **la fermer** : ProvidersBar vérifie alors la session. **Vérifier maintenant** ouvre une fenêtre visible ; laisser le lecteur terminer et effectuer soi-même un éventuel contrôle humain. Une session valide sans quota lisible conserve le dernier relevé avec un avertissement.

La lecture automatique Grok fonctionne sans fenêtre Chrome ou Edge, y compris au démarrage. Si le dashboard redirige un ancien compte vers une connexion Cursor, le lecteur essaie une seule fois le panneau d’utilisation officiel Grok, sans inspecter la page externe. Seules les actions explicites **Ouvrir mon compte** et **Vérifier maintenant** peuvent ouvrir une fenêtre visible.

### Antigravity et Argon

Garder **Antigravity App** ouvert ; aucune CLI supplémentaire n’est nécessaire. L’IDE seul ne suffit pas. Le connecteur lit le service local du processus installé et distingue **trois réserves indépendantes** : Gemini, Claude/GPT et **Gemini 4 Argon** (hebdomadaire). Il ne prête à Argon aucune limite de cinq heures ni le quota d’un autre groupe.

Argon apparaît dans les cartes, le widget, les dates et les recommandations. Aucun score de qualité n’est inventé : tant que ce score reste inconnu, le classement place les modèles dotés d’un score avant lui. [Modèles et disponibilité](https://www.antigravity.google/docs/models), [limites des forfaits](https://www.antigravity.google/docs/plans).

### Claude

Par défaut, ProvidersBar lit le fichier local `plan-usage-history.json` de Claude Desktop. Les modifications sont détectées toutes les deux secondes, mais Claude Desktop peut espacer ses propres mesures. Le fichier ne fournit pas les dates de reset ; un relevé ancien est signalé.

**Connexions → Anthropic Claude → Activer la lecture directe (1 min)** autorise l’utilisation de la connexion Claude Code existante pour lire les quotas Anthropic. Les jetons restent dans le processus principal et dans le fichier officiel Claude Code ; le renouvellement OAuth est effectué par ProvidersBar avec le même transport réseau, sans jamais copier de jeton vers le renderer ou les données de l’application. Une révocation impose une reconnexion dans Claude Code.

La lecture directe exige l’actualisation automatique. Elle respecte une minute entre lectures, les erreurs temporaires et `Retry-After`. Une erreur conserve le dernier relevé et son heure réelle, sans retour silencieux vers un fichier Desktop plus ancien. [Détails du protocole et de la protection des jetons](docs/architecture.md).

## Abonnements, dates et recommandations

Une échéance dépassée marque l’abonnement **expiré** et le retire du budget et des recommandations. La réactivation demande de confirmer le renouvellement et de fournir une nouvelle échéance future. Ollama continue sous Free à 0 USD avec les ressources réellement lisibles. Une échéance de facturation ne remet jamais un quota à 100 %.

Chaque limite affiche sa prochaine réinitialisation si elle est fournie. Une date passée demande une nouvelle lecture. Dans la fiche → **Réinitialisations**, ajouter une date manquante, avec heure facultative. Les dates fournisseur restent prioritaires ; les compléments manuels sont identifiés et ne créent aucun relevé de consommation.

**Utilise maintenant**, puis **Puis**, proposent uniquement les abonnements actifs dont les ressources sont confirmées et récentes. Les réserves Antigravity sont indépendantes ; les fenêtres d’une même réserve sont cumulatives. Configurer les modèles et exclusions dans **Réglages → Ordre de consommation**.

Les API disponibles sont affichées séparément, par solde USD positif décroissant. Le catalogue de modèles et tarifs embarqué est daté du **12 septembre 2026**, avec ajout d’Argon en octobre ; il ne se met pas à jour automatiquement. [Méthode, hypothèses et sources](docs/ordre-consommation.md).

## Interface et accessibilité

- **Thèmes** : Clair, Sombre ou **Système (Windows)**. `system` suit `prefers-color-scheme` en direct ; les anciens inventaires gardent leur choix explicite clair ou sombre.
- **Mise en page** : navigation latérale sur desktop ; sous 900 px CSS (fenêtre réduite ou zoom), la navigation devient une **barre supérieure toujours visible**, jamais `display:none`. Lien d’évitement « Aller au contenu ».
- **Contrastes** : paires texte/fond ≥ 4,5:1 et indicateur de focus ≥ 3:1 (contrastes calculés, voir [renderer/CONTRAT-UI.md](renderer/CONTRAT-UI.md)). Aucune information portée par la couleur seule ; les niveaux sont aussi écrits.
- **Focus** : restauré après chaque rendu (navigation, filtres, fiches, synchronisation) ; sélection de texte préservée.
- **ARIA** : navigation nommée, `aria-current`, onglets de fiche `role="tab"`, jauges `role="meter"` avec valeur textuelle, zone `aria-live` pour les annonces, `role="alert"` sur les erreurs de formulaire.
- **Mouvement** : `prefers-reduced-motion` neutralise les transitions ; `forced-colors` renforce les bordures.
- **Widget** : chaque ligne affiche la fraîcheur (« à l’instant », « il y a X min ») et « Relevé ancien » au-delà de dix minutes ; le statut d’actualisation reflète le réglage réel (« Actualisation auto : 5 min · Claude 1 min » ou « désactivée »).
- **Version** : affichée dynamiquement depuis l’IPC `app:info` (`app.getVersion()`), jamais codée en dur.

## Données et confidentialité

| Mode | Dossier |
| --- | --- |
| Portable personnel | `dist/ProvidersBar-win32-x64/data/` |
| Développement | `.local/` |
| Tests isolés et captures | `test-results/` |

`PROVIDERSBAR_DATA_DIR` permet de choisir un autre dossier. Les données incluent l’inventaire, l’historique, les réglages, la stratégie, les profils de connexion et `credentials.json`.

- **Clés API** : chiffrées avec Electron `safeStorage` et Windows DPAPI, liées à l’utilisateur Windows. Aucune clé n’est renvoyée au renderer ni incluse dans l’export.
- **Dossier de données** : à chaque démarrage, son héritage ACL est retiré et seuls l’utilisateur courant et `SYSTEM` y ont accès (`icacls`). Un échec produit un avertissement, jamais un blocage.
- **Sessions web** : chaque fournisseur utilise un profil ou une partition isolés. Les navigateurs de connexion sont pilotés par un **pipe local** (`--remote-debugging-pipe`) ; aucun port TCP de débogage n’est ouvert par les lecteurs de comptes. Un port local n’existe qu’en **mode diagnostic explicite** (`--remote-debugging-port`), utilisé par `npm run verify:connections` et `npm run update:portable`.
- **Purge au démarrage** : fichiers `.tmp` interrompus, port de diagnostic obsolète (sauf en mode diagnostic), sauvegardes de migration au-delà des deux plus récentes, profils de navigateur temporaires orphelins.
- **Historique** : plafonné à **20 000 relevés** (≈ 7 jours à dix fournisseurs avec l’actualisation de 5 minutes) ; les plus anciens sont purgés.
- **Export** : document JSON autonome `{ app, version, exportedAt, inventory, settings, strategy, manualResets, history }`, **sans** session, sans identité et sans empreinte de clé. La restauration depuis l’export n’est pas proposée.
- **Effacer mes données** (Réglages, double confirmation) : supprime `state.json`, `credentials.json`, les profils de navigateur, les sauvegardes et les caches, puis réinitialise l’inventaire. Refusé pendant une synchronisation.
- **Télémétrie** : aucune. ProvidersBar n’envoie aucune donnée d’usage à un serveur ProvidersBar.

Détails complets et limites : [politique de confidentialité](PRIVACY.md) et [politique de sécurité](SECURITY.md) (modèle de menace, signalement privé, hors périmètre).

**Ne jamais distribuer le dossier `data/`, `.local/` ou les profils de navigateur.** Ils sont exclus de Git. Les erreurs conservent les dernières valeurs connues ; un format inconnu ne devient jamais une estimation de crédit ou de quota. Les devises ne sont pas converties.

## Développement et vérification

Prérequis : **Windows x64**, **Node.js ≥ 24**, npm. Chrome ou Edge est requis pour les comptes web ; Codex, Claude et Antigravity seulement pour les lecteurs concernés.

```powershell
npm ci
npm start
```

| Commande | Rôle |
| --- | --- |
| `npm test` | Suite unitaire déterministe : formats, erreurs, concurrence, migrations, chiffrement, cooldowns, sécurité et télémétrie zéro |
| `npm run test:coverage` | Même suite avec couverture de code Node (`--experimental-test-coverage`) |
| `npm run verify` | Vérification syntaxique de tous les `.cjs`/`.js` du dépôt (`node --check`) |
| `npm run lint` | Alias de `npm run verify` |
| `npm run doctor` | Diagnostic lecture seule des prérequis (17 contrôles, `--json` disponible) |
| `npm run test:desktop` | Intégration Electron : inventaire, IPC, chiffrement, persistance, widget |
| `npm run test:resources:desktop` | Couleurs et épuisement de chaque limite dans les deux vues et les deux thèmes |
| `npm run test:claude:desktop` | Pannes, reprise et persistance du choix de lecture directe Claude |
| `npm run preview` | Aperçu en lecture seule, sans comptes ni clés, sur `http://127.0.0.1:4317` |
| `npm run package` | Construire ou actualiser le portable personnel, données conservées |
| `npm run package:release` | Construire un dossier versionné neuf, sans données personnelles |
| `npm run release:artifacts` | Créer l'archive ZIP et son empreinte SHA-256 de la release construite |
| `npm run update:portable` | Remplacer uniquement les ressources du portable personnel |
| `npm run verify:connections` | Lectures réelles via le portable démarré en mode diagnostic |

Les tests unitaires n’utilisent ni Electron, ni réseau, ni compte réel. Les tests Electron et les smoke tests nécessitent une session Windows interactive (DPAPI, fenêtres Chromium) ; ils utilisent des dossiers de données isolés et des réponses simulées.

**Intégration continue** : [`.github/workflows/ci.yml`](.github/workflows/ci.yml) exécute sur `windows-latest` et Node 24 un job **tests** obligatoire (`npm ci`, `npm run verify`, `npm run lint`, `npm test`, `npm audit --omit=dev`) et un job **smoke-electron** *best-effort* (`continue-on-error`) pour les trois smoke tests, avec artefacts `test-results/`. Un échec du job smoke reste visible mais ne bloque pas la fusion ; la validation de release exécute les smoke tests sur une machine Windows interactive.

### Diagnostic réel des connexions

Quitter le portable, puis le lancer avec `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1` et exécuter `npm run verify:connections`. Le script vérifie le chemin exact de l’interface, synchronise les connexions déjà suivies et écrit `test-results/connections-live.json`, sans identité, clé, cookie ni montant de portefeuille. `--include-inactive` vérifie aussi les services expirés ou en pause. Quitter puis relancer normalement pour fermer le port de diagnostic. Voir [docs/maintenance.md](docs/maintenance.md).

## Fabriquer et mettre à jour

```powershell
npm ci
npm run verify
npm test
npm run test:desktop
npm run test:resources:desktop
npm run test:claude:desktop
npm run package:release
npm run release:artifacts
```

La distribution propre est créée dans `dist/ProvidersBar-0.3.0-win32-x64/` ; la commande refuse un dossier de release déjà existant. `npm run release:artifacts` produit l'archive ZIP et `dist/SHA256SUMS-0.3.0.txt`, et refuse d'archiver une release contenant un dossier de données personnelles. Le portable personnel reste dans `dist/ProvidersBar-win32-x64/`, à côté de ses données.

Les ressources applicatives sont préparées dans un dossier temporaire puis remplacées ensemble : les fichiers retirés des sources ne subsistent pas dans l’installation. `npm run update:portable` conserve `data/` et les sessions, ferme l’ancien processus s’il est joignable en diagnostic, puis nécessite de relancer l’application ; sinon, la quitter manuellement avant la mise à jour. Le packaging inclut les dépendances de production (`proper-lockfile` et ses dépendances) et leurs notices.

L’exécutable **n’est pas signé** et conserve les métadonnées binaires Electron ; conserver toutes les licences et notices du dossier distribué. Aucune mise à jour automatique n’est proposée.

## Limites connues

- **Aucune lecture réelle rejouée pour la 0.3.0** : la validation automatique utilise des réponses simulées. Les lectures réelles de la 0.2.0 restent la référence historique ; refaire `npm run verify:connections` après les changements de connexion (voir [docs/validation-0.3.0.md](docs/validation-0.3.0.md)).
- Les lecteurs web (Grok, Z.ai, Ollama, bases Antigravity) dépendent des pages et services officiels, qui peuvent changer sans préavis. Un format inconnu produit une erreur, jamais une estimation.
- Claude Desktop peut suspendre ses mesures ; le fichier local ne fournit pas de dates de reset fiables.
- L’export JSON n’est pas restaurable depuis l’interface ; la connexion des comptes et des clés doit être refaite.
- Les prix et modèles recommandés sont un catalogue embarqué et daté, pas une découverte des droits réels du compte.
- L’audit d’accessibilité est statique (structure ARIA et contrastes calculés) ; un essai avec lecteur d’écran (NVDA, Narrator) reste recommandé.
- Windows x64 uniquement ; Node.js n’est requis que pour le développement et le packaging.

## Structure et documentation

- `main.cjs` et `preload.cjs` : processus principal (fenêtres, IPC, orchestration) et pont IPC limité (24 canaux `invoke`).
- `lib/` : stockage (`data-store.cjs`), sécurité des fenêtres et des données (`window-security.cjs`), export nettoyé (`privacy-export.cjs`), diagnostic (`diagnostics.cjs`), connecteurs, quotas et recommandations.
- `renderer/` : shell, vues, helpers UI, thèmes et réglages ; contrat dans [renderer/CONTRAT-UI.md](renderer/CONTRAT-UI.md).
- `scripts/` et `tests/` : fabrication, diagnostic, maintenance et validation.
- [Architecture, IPC et modèles de données](docs/architecture.md)
- [Maintenance et procédures de validation](docs/maintenance.md)
- [Validation de la version 0.3.0](docs/validation-0.3.0.md) · [validation 0.2.0](docs/validation-0.2.0.md) (archive)
- [Méthode de recommandation](docs/ordre-consommation.md)
- [Historique des versions](CHANGELOG.md)
- [Provenance des logos](assets/providers/sources.json)

Les logos appartiennent à leurs fournisseurs. Le concept de suivi dans la zone de notification est inspiré de [CodexBar](https://codexbar.app/).
