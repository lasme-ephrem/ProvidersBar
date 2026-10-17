# Maintenance

## Validation

1. Installer les dépendances verrouillées avec `npm ci` si nécessaire.
2. Exécuter `npm test` pour la logique et les formats de réponse.
3. Exécuter `npm run test:desktop` pour les changements Electron ou d’interface.
   Pour Claude, exécuter aussi `npm run test:claude:desktop` : échec initial, mode direct persistant après redémarrage, panne puis reprise automatique et comparaison des pourcentages utilisés/restants.
   Pour les limites et couleurs, exécuter `npm run test:resources:desktop`, y compris Argon.
4. Examiner les captures de `test-results/` après une modification visuelle.
5. Vérifier `git diff --check` et `git status --short` avant un commit.

Les tests utilisent des réponses simulées et des données isolées. Ils couvrent les connexions, la persistance, le chiffrement, les erreurs, les migrations, le widget et les quotas séparés. Ils ne garantissent pas à eux seuls que les sites externes conservent leur format actuel.

Les régressions de connexion doivent être reproduites à partir du format observé : en octobre 2026, le solde Ollama suit directement « Usage credits · Free » avant les contrôles d’ajout de fonds, et le bouton de profil Grok possède désormais un libellé accessible. Les dépenses par modèle, les montants proposés pour un achat et l’ouverture du menu de profil ne prouvent respectivement ni un solde restant ni une connexion. Après une mise à jour portable, vérifier le code chargé dans le nouveau processus et effectuer une lecture réelle en complément des fixtures.

Les variables facultatives `PROVIDERSBAR_PLAYWRIGHT` et `PROVIDERSBAR_EXECUTABLE` sélectionnent un module Playwright ou un exécutable Electron externe pour les tests.

## Catalogue de recommandations

Les tarifs et modèles de `lib/usage-strategy.js` sont des données datées, pas une découverte des droits du compte. Avant de modifier le catalogue, vérifier les identifiants exacts, les routes effectivement disponibles, les fenêtres de contexte, les tarifs de cache et les promotions dans les sources de `docs/ordre-consommation.md`. Mettre à jour `checkedAt`, les sources et les cas de test associés. Un score d’une autre version de modèle ou d’indice ne doit pas être réutilisé silencieusement.

Les tests `usage-strategy.test.cjs` couvrent les quotas indépendants, la fraîcheur, les resets, les portefeuilles partagés, les coûts, les horaires UTC et le consentement Contributor. Le smoke test vérifie la configuration par IPC, la persistance après redémarrage et la présence du classement dans les deux fenêtres. Les appels aux fournisseurs restent simulés.

## Connecteurs

Conserver des fixtures anonymes. Vérifier les valeurs inconnues, les zéros, les sessions expirées et les réponses incomplètes. Ne pas déduire un pourcentage d’une largeur de jauge ou d’un tarif, ni remplacer une erreur par 100 %.

Les régressions de connexion sont couvertes par `subscription-accounts.test.cjs`, `native-login.test.cjs`, `api-connection.test.cjs` et `credential-store.test.cjs`. La fixture Grok doit conserver le premier titre « Paramètres », le titre imbriqué « Utilisation », puis un `number-flow-react` avec son `aria-label` et son libellé de consommation. Le smoke test utilise le vrai DOM Electron, vérifie une déconnexion pendant le remplacement d’une clé, le chiffrement, la conservation après erreur et la persistance après redémarrage. Les requêtes API passent par `session.defaultSession.fetch` ; les tests remplacent ce transport, sans appeler les comptes réels.

Vérifier le sens du compteur sur le site du fournisseur : quota restant ou consommé, période et famille de modèles. Une validation réelle utilise un compte connecté sans copier ses clés, cookies ou contenu privé dans les sources.

Le renouvellement Claude est couvert par `tests/claude-connection.test.cjs` : expiration, anticipation de cinq minutes, verrous partagés entre processus, rotation, reconnexion concurrente, suppression du fichier, verrou compromis, échec d’écriture et jeton révoqué. `tests/claude-live-usage.test.cjs` vérifie aussi le 401 avec une seule reprise, les coupures réseau, le backoff et Retry-After après redémarrage. Le protocole et les chemins de verrou doivent être revérifiés si Claude Code les modifie. Les preuves de lecture réelle doivent contenir uniquement les quotas, dates et résultats de validation, sans identité ni secrets.

## Nettoyage et sauvegardes

Git ignore les dépendances, le portable, les données, les profils, les résultats de test, les caches et les secrets usuels. Garder les données réelles aux emplacements prévus : un nom arbitraire peut contourner les exclusions.

`test-results/` et `.npm-cache/` sont régénérables ; les supprimer après l’arrêt des processus de test. Ne pas supprimer `dist/ProvidersBar-win32-x64/data/` ou `.local/` pour nettoyer le projet : ces dossiers peuvent contenir les comptes de l’utilisateur.

Les scripts ponctuels d’exploration de comptes ne font pas partie du projet maintenu. `scripts/generate-icon.py` recrée l’icône de ProvidersBar et nécessite Python avec Pillow ; il n’est pas requis pour lancer, tester ou empaqueter l’application.

Quitter l’application avant une sauvegarde complète des données. Les clés chiffrées sont liées au compte Windows. L’export JSON ne contient pas les sessions et ne remplace pas leur reconnexion.

## Distribution

Construire avec `npm ci` puis `npm run package:release` : le dossier versionné est créé sans données personnelles, et la commande refuse de réutiliser un dossier existant. `npm run package` conserve le portable personnel et son éventuel `data/` ; ne pas diffuser ce dossier. Conserver les notices Electron et les fichiers de provenance des logos. Les ressources sont remplacées ensemble afin de retirer aussi les fichiers devenus inutilisés.

## Diagnostic réel explicite

Après mise à jour, lancer le portable avec `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`, puis `npm run verify:connections`. Le rapport ignoré `test-results/connections-live.json` distingue lectures réussies, erreurs et services non suivis. Il ne contient ni identité ni secret ni solde de portefeuille. Ne pas confondre une session enregistrée et une vérification réelle réussie. Refermer puis relancer normalement le portable après le diagnostic.

Le panneau Grok observé le 17 octobre 2026 présente une limite SuperGrok et une `Weekly Grok Bot Limit` distincte. Les associer par section ; ne jamais convertir tous les compteurs animés en une seule semaine, ce qui crée de faux conflits. Les nouveaux forfaits X Subscription utilisent au contraire un pool partagé. Pour Antigravity, le bucket Argon observé est `gemini-argon-wtu-weekly`, période `weekly`.

Les scripts de packaging et de mise à jour incluent les dépendances de production (`proper-lockfile` et ses dépendances) avec leurs notices, indispensables au renouvellement Claude dans le portable.
