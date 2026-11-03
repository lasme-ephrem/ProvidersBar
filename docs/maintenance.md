# Maintenance

Documentation des commandes réelles de vérification, de l'intégration continue et
des procédures de maintenance. La version cible est **0.3.3** (branche `refonte/pro`,
Node.js ≥ 24, Windows x64, Electron 44.x).

## Validation locale (Definition of Done)

1. Installer les dépendances verrouillées : `npm ci`.
2. Vérifier la syntaxe : `npm run verify` (ou directement `node scripts/check-syntax.cjs`
   si le script npm n'est pas encore déclaré). `npm run lint` exécute le même contrôle
   et doit rester vert.
3. Exécuter `npm test` : suite unitaire déterministe, sans Electron ni réseau.
4. Diagnostic local des données et de l'environnement : `npm run doctor`
   (`scripts/doctor.cjs`, sans secret). Il vérifie les chemins, les fichiers d'état,
   les sessions et les prérequis Windows sans lancer d'inférence.
5. Exécuter les smoke tests Electron sur une session graphique Windows :
   `npm run test:desktop`, `npm run test:resources:desktop`, puis
   `npm run test:claude:desktop` pour les pannes et la reprise Claude.
   Pour les changements visuels, examiner les captures de `test-results/`.
6. Couverture locale (optionnelle, sans dépendance) :
   `node --test --experimental-test-coverage tests/*.test.cjs`.
7. Audit des dépendances de production : `npm audit --omit=dev`.
8. Vérifier `git diff --check` et `git status --short` avant commit.

## Intégration continue (`.github/workflows/ci.yml`)

Workflow Windows unique, déclenché sur `main`, `refonte/**`, les pull requests et
manuellement. Deux jobs :

- **tests** (`windows-latest`, Node 24, cache npm) : `npm ci`, `npm run verify`
  (repli automatique sur `node scripts/check-syntax.cjs` si le script npm manque),
  `npm run lint` s'il est déclaré, `npm test`, puis `npm audit --omit=dev`.
  Ce job est bloquant.
- **smoke-electron** : les trois smoke tests Playwright/Electron, **best-effort**
  (`continue-on-error: true`). Ils dépendent d'une session graphique Windows
  interactive et de DPAPI pour le chiffrement : un échec est visible dans Actions,
  les captures `test-results/` sont conservées en artefact (7 jours), mais il ne
  bloque pas la fusion. La validation de release exige malgré tout ces trois tests
  verts sur une machine Windows interactive avant `npm run package:release`.

Concurrence : un nouveau push annule la CI précédente sur la même référence.
Permissions : lecture seule du dépôt. Aucun secret de dépôt n'est nécessaire.

## Scripts de vérification et tests transverses

- **`scripts/check-syntax.cjs`** : `node --check` sur `main.cjs`, `preload.cjs`,
  `lib/*.cjs`, `lib/*.js`, `scripts/*.cjs`, `renderer/*.js` et `tests/*.cjs`.
  Sortie claire, code de sortie 1 en cas d'erreur ou de fichier requis absent.
  Appelé par `npm run verify` et `npm run lint`.
- **`tests/quality.test.cjs`** : garde-fous transverses — absence de secret en dur
  et de chemin utilisateur dans le code de production, `.gitignore` couvrant
  `data/`, `.local/`, `test-results/`, `credentials.json`, `state.json` et les
  sauvegardes, cohérence CHANGELOG/README/`package.json`, absence de marqueur
  `TODO`/`FIXME`/`XXX`/`HACK`, validation que chaque script npm pointe vers un
  fichier existant, contrôle du workflow CI, helpers de `verify-connections`,
  et documentation de maintenance à jour. Le test de version est actif :
  package.json, README et CHANGELOG doivent annoncer la même version.
- **`tests/packaging.test.cjs`** : packaging sur chemins simulés, sans Electron et
  sans copie du portable de 160 Mo — `scripts/package.cjs --release` (distribution
  versionnée, renommage `ProvidersBar.exe`, dépendances de production imbriquées,
  refus d'écraser une release existante), mise à jour du portable (données
  préservées octet par octet, fichiers obsolètes retirés), `scripts/app-resources.cjs`
  (refus hors `dist`), `scripts/update-portable.cjs` (état de diagnostic absent ou
  invalide) et `scripts/preview.cjs` (état simulé, 404, contenu HTML).

## Tests : deux couches distinctes

- **`npm test`** (`node --test tests/*.test.cjs`) : tests unitaires et de contrat,
  sans Electron. Ils couvrent les connecteurs et leurs formats, les erreurs et
  timeouts, les migrations, le renouvellement Claude, les verrous multi-processus,
  la sérialisation des credentials, le parsing DOM simulé des comptes, les quotas,
  les resets, la stratégie et les tests transverses ci-dessus. Ils n'exécutent ni
  IPC Electron, ni `safeStorage`, ni widget, ni tray.
- **Smoke tests Electron** : intégration réelle (IPC, chiffrement `safeStorage`,
  persistance après redémarrage, export sans clés, widget, tray, thèmes, sessions
  isolées, captures). Ils nécessitent une session Windows interactive et ne font
  pas partie de `npm test`.
- Les tests utilisent des réponses simulées et des dossiers isolés
  (`os.tmpdir()` ou `test-results/`). Les fixtures restent anonymes : jamais de
  compte réel, de jeton, de cookie ni de contenu privé dans les sources.
- Ne pas confondre une session enregistrée avec une vérification réelle réussie :
  les tests verts ne garantissent pas que les sites externes conservent leur
  format. Une lecture réelle complète la suite lorsque les services changent.

Les régressions de connexion doivent être reproduites à partir du format observé :
en octobre 2026, le solde Ollama suit directement « Usage credits · Free » avant
les contrôles d'ajout de fonds, et le bouton de profil Grok possède un libellé
accessible. Les dépenses par modèle, les montants proposés pour un achat et
l'ouverture du menu de profil ne prouvent respectivement ni un solde restant ni
une connexion.

Le renouvellement Claude est couvert par `tests/claude-connection.test.cjs`
(expiration, anticipation de cinq minutes, verrous partagés entre processus,
rotation, reconnexion concurrente, suppression du fichier, verrou compromis,
échec d'écriture et jeton révoqué) et `tests/claude-live-usage.test.cjs`
(401 unique, coupures réseau, backoff, Retry-After après redémarrage). Le protocole
et les chemins de verrou doivent être revérifiés si Claude Code les modifie.

Après une mise à jour portable, vérifier le code chargé dans le nouveau processus
et effectuer une lecture réelle en complément des fixtures.

Les variables facultatives `PROVIDERSBAR_PLAYWRIGHT` et `PROVIDERSBAR_EXECUTABLE`
sélectionnent un module Playwright ou un exécutable Electron externe pour les
smoke tests.

## Catalogue de recommandations

Les tarifs et modèles de `lib/usage-strategy.js` sont des données datées, pas une
découverte des droits du compte. Avant de modifier le catalogue, vérifier les
identifiants exacts, les routes effectivement disponibles, les fenêtres de
contexte, les tarifs de cache et les promotions dans les sources de
`docs/ordre-consommation.md`. Mettre à jour `checkedAt`, les sources et les cas
de test associés. Un score d'une autre version de modèle ou d'indice ne doit pas
être réutilisé silencieusement.

Les tests `usage-strategy.test.cjs` couvrent les quotas indépendants, la fraîcheur,
les resets, les portefeuilles partagés, les coûts, les horaires UTC et le
consentement Contributor. Le smoke test vérifie la configuration par IPC, la
persistance après redémarrage et la présence du classement dans les deux fenêtres.
Les appels aux fournisseurs restent simulés.

## Connecteurs

Conserver des fixtures anonymes. Vérifier les valeurs inconnues, les zéros, les
sessions expirées et les réponses incomplètes. Ne pas déduire un pourcentage d'une
largeur de jauge ou d'un tarif, ni remplacer une erreur par 100 %.

Les régressions de connexion sont couvertes par `subscription-accounts.test.cjs`,
`native-login.test.cjs`, `api-connection.test.cjs` et `credential-store.test.cjs`.
La fixture Grok doit conserver le premier titre « Paramètres », le titre imbriqué
« Utilisation », puis un `number-flow-react` avec son `aria-label` et son libellé
de consommation. Le smoke test utilise le vrai DOM Electron, vérifie une
déconnexion pendant le remplacement d'une clé, le chiffrement, la conservation
après erreur et la persistance après redémarrage. Les requêtes API passent par
`session.defaultSession.fetch` ; les tests remplacent ce transport, sans appeler
les comptes réels.

Vérifier le sens du compteur sur le site du fournisseur : quota restant ou
consommé, période et famille de modèles. Une validation réelle utilise un compte
connecté sans copier ses clés, cookies ou contenu privé dans les sources.

Depuis 0.2.1, les lectures automatiques Grok restent strictement sans fenêtre. Ne
pas réintroduire une fenêtre réduite comme solution à un dashboard vide : certains
anciens comptes sont redirigés vers l'authentification Cursor, alors que le panneau
Grok `/?_s=usage` reste lisible sans fenêtre. Le lecteur tente ce parcours officiel
une seule fois et n'inspecte jamais le contenu de l'origine externe.

Le panneau Grok observé le 17 octobre 2026 présente une limite SuperGrok et une
`Weekly Grok Bot Limit` distincte. Les associer par section ; ne jamais convertir
tous les compteurs animés en une seule semaine, ce qui crée de faux conflits. Les
nouveaux forfaits X Subscription utilisent au contraire un pool partagé. Pour
Antigravity, le bucket Argon observé est `gemini-argon-wtu-weekly`, période
`weekly`.

## Nettoyage et sauvegardes

Git ignore les dépendances, le portable, les données, les profils, les résultats
de test, les caches et les secrets usuels (`data/`, `.local/`, `test-results/`,
`dist/`, `node_modules/`, `credentials.json`, `state.json`). Garder les données
réelles aux emplacements prévus : un nom arbitraire peut contourner les exclusions.

`test-results/` et `.npm-cache/` sont régénérables ; les supprimer après l'arrêt
des processus de test, notamment les dossiers `smoke-data-*` qui contiennent des
profils Chromium complets. Ne pas supprimer `dist/ProvidersBar-win32-x64/data/` ou
`.local/` pour nettoyer le projet : ces dossiers peuvent contenir les comptes de
l'utilisateur.

Les scripts ponctuels d'exploration de comptes ne font pas partie du projet
maintenu. `scripts/generate-icon.py` recrée l'icône de ProvidersBar et nécessite
Python avec Pillow ; il n'est pas requis pour lancer, tester ou empaqueter
l'application.

Quitter l'application avant une sauvegarde complète des données. Les clés
chiffrées sont liées au compte Windows. L'export JSON ne contient ni clés ni
sessions et ne remplace pas leur reconnexion.

## Distribution

Construire avec `npm ci` puis `npm run package:release` : le dossier versionné est
créé sans données personnelles, et la commande refuse de réutiliser un dossier
existant (comportement vérifié par `tests/packaging.test.cjs`). `npm run package`
conserve le portable personnel et son éventuel `data/` ; ne pas diffuser ce dossier.
Conserver les notices Electron et les fichiers de provenance des logos. Les
ressources sont remplacées ensemble afin de retirer aussi les fichiers devenus
inutilisés.

Les scripts de packaging et de mise à jour incluent les dépendances de production
(`proper-lockfile` et ses dépendances imbriquées) avec leurs notices, indispensables
au renouvellement Claude dans le portable.

## Diagnostic réel explicite

Après mise à jour, quitter le portable puis le lancer avec
`--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`, puis exécuter
`npm run verify:connections` (ajouter `--include-inactive` pour vérifier aussi les
connexions des services expirés ou en pause). Le script :

- normalise et compare strictement l'URL de l'interface attendue
  (`resources/app/renderer/index.html`) et ignore le widget `?mode=quick` ;
- lit le port de diagnostic de façon stricte (première ligne numérique, seconde
  ligne `/devtools/browser/<id>`) et refuse tout autre contenu ;
- synchronise les connexions déjà suivies, puis écrit le rapport ignoré
  `test-results/connections-live.json` ;
- ne contient ni message d'erreur, ni identité, ni clé, ni cookie, ni montant de
  portefeuille : seuls les identifiants, états et fenêtres de quota sont exposés ;
- renvoie le code 1 si un service suivi est en erreur ou non connecté, 0 sinon.

`npm run doctor` fournit un diagnostic hors Electron des données locales et de
l'environnement, sans secret. Pour les deux outils, ne pas confondre une session
enregistrée et une vérification réelle réussie. Refermer puis relancer normalement
le portable après le diagnostic.
