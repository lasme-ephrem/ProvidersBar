# Maintenance

## Validation

1. Installer les dépendances verrouillées avec `npm ci` si nécessaire.
2. Exécuter `npm test` pour la logique et les formats de réponse.
3. Exécuter `npm run test:desktop` pour les changements Electron ou d’interface.
4. Examiner les captures de `test-results/` après une modification visuelle.
5. Vérifier `git diff --check` et `git status --short` avant un commit.

Les tests utilisent des réponses simulées et des données isolées. Ils couvrent les connexions, la persistance, le chiffrement, les erreurs, les migrations, le widget et les quotas séparés. Ils ne garantissent pas à eux seuls que les sites externes conservent leur format actuel.

Les variables facultatives `PROVIDERSBAR_PLAYWRIGHT` et `PROVIDERSBAR_EXECUTABLE` sélectionnent un module Playwright ou un exécutable Electron externe pour les tests.

## Connecteurs

Conserver des fixtures anonymes. Vérifier les valeurs inconnues, les zéros, les sessions expirées et les réponses incomplètes. Ne pas déduire un pourcentage d’une largeur de jauge ou d’un tarif, ni remplacer une erreur par 100 %.

Vérifier le sens du compteur sur le site du fournisseur : quota restant ou consommé, période et famille de modèles. Une validation réelle utilise un compte connecté sans copier ses clés, cookies ou contenu privé dans les sources.

## Nettoyage et sauvegardes

Git ignore les dépendances, le portable, les données, les profils, les résultats de test, les caches et les secrets usuels. Garder les données réelles aux emplacements prévus : un nom arbitraire peut contourner les exclusions.

`test-results/` et `.npm-cache/` sont régénérables ; les supprimer après l’arrêt des processus de test. Ne pas supprimer `dist/ProvidersBar-win32-x64/data/` ou `.local/` pour nettoyer le projet : ces dossiers peuvent contenir les comptes de l’utilisateur.

Les scripts ponctuels d’exploration de comptes ne font pas partie du projet maintenu. `scripts/generate-icon.py` recrée l’icône de ProvidersBar et nécessite Python avec Pillow ; il n’est pas requis pour lancer, tester ou empaqueter l’application.

Quitter l’application avant une sauvegarde complète des données. Les clés chiffrées sont liées au compte Windows. L’export JSON ne contient pas les sessions et ne remplace pas leur reconnexion.

## Distribution

Construire dans un checkout propre avec `npm ci` puis `npm run package`. Ne pas diffuser le portable utilisé personnellement : il peut contenir `data/`, même après un nouveau packaging. Conserver les notices Electron et les fichiers de provenance des logos.
