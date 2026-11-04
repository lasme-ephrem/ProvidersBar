# Validation de la version 0.4.0 — 4 novembre 2026

Nouvelle identité **Lasmium TOKENS-HUB**, refonte UX/UI complète et nettoyage du projet, avec conservation de toutes les fonctionnalités validées jusqu'en 0.3.6.

## 1. Identité

- **Nom** : Lasmium TOKENS-HUB (fenêtre, widget, tray, notifications, dépôt, documentation).
- **Logo** : monogramme Lasmium — L lumineux dégradé lime → aqua, nœud aqua, trois points de signal — décliné en `assets/brand/lasmium-mark.svg` et `assets/icon.png` (512/256/128/64/32 px). Utilisé dans le rail, le widget, l'icône de fenêtre et la zone de notification.
- **Typographie** : **Sora Variable** (titres, chiffres, marque) et **Inter Variable** (texte), embarquées dans `assets/fonts/` avec leurs licences OFL (`LICENSE-Sora.txt`, `LICENSE-Inter.txt`). Aucune police distante.
- **Palette** : obsidian/lime laser. Thème clair porcelaine, thème sombre obsidian, rail de navigation sombre dans les deux thèmes.
- **Ton** : « Contrôle tes tokens » — libellés français, tutoiement cohérent, états lisibles.

## 2. Refonte UX/UI

- **Rail de navigation** 264 px : marque, espace local, navigation avec compteurs, réglages et note de stockage local.
- **Barre supérieure** : fil d'Ariane, pastille « Stockage local », date ; fond translucide flouté.
- **Tableau de bord** : hero éditorial, quatre statistiques, filtres segmentés, recherche, cartes fournisseurs redessinées (logo, plan, quotas, chips, échéances).
- **Cartes** : chaque fenêtre de quota est une ligne avec libellé, valeur Sora, jauge et chip de niveau ; groupes Gemini / Claude-GPT / Argon conservés.
- **Fiche détaillée** : panneau latéral (600 px) au lieu du dialogue centré, en-tête fournisseur, onglets, formulaires et zones de danger restylés.
- **Connexions, abonnements, historique, réglages** : alignés sur la nouvelle grille et les nouveaux composants.
- **Widget 360 × 660** : marque Lasmium, en-tête compact, lignes verticales complètes (toutes les fenêtres, Ollama Free + crédits, soldes multi-devises), barre fine 5 px seulement en cas de dépassement.
- **Accessibilité** : contrastes AA, focus visibles, `prefers-reduced-motion`, rôles et libellés conservés, `sr-only` et chips textuelles.

Captures : `test-results/lasmium-dashboard-light.png`, `lasmium-dashboard-dark.png`, `lasmium-widget-light.png`, `lasmium-widget-dark.png`, `design-dialog.png`, `design-connections.png`.

## 3. Renommage et compatibilité

- API renderer : `window.lasmium` (remplace l'ancien nom, plus aucun alias).
- Variable de données : `LASMIUM_DATA_DIR`, avec repli `PROVIDERSBAR_DATA_DIR`.
- Thème : clé `lasmium-theme`, avec reprise de l'ancienne clé dans `theme-init.js`.
- Packaging : `LasmiumTokensHub.exe`, release `LasmiumTokensHub-0.4.0-win32-x64`, lanceur `Lancer Lasmium TOKENS-HUB.cmd`.
- **Données préservées** : le dossier portable historique `dist/ProvidersBar-win32-x64/` est conservé (l'exécutable est renommé sur place) ; `data/state.json` reste intact. Aucune migration destructive.

## 4. Nettoyage et refactorisation

- Suppression de `forStrategy` (projection morte) et de son assertion.
- Feuille de style réécrite : plus de `.quick-value`, `.quick-segment`, `.quick-extra` ni de règles mortes.
- Suppression de `readStoredThemePreference` (code inutilisé).
- Documents d'audit déplacés dans `docs/archive/` (`ANALYSE-0.3.md`, `REFONTE-CONTRATS-0.3.md`, `audit-0.3/`).
- Anciens dossiers de release et fichiers temporaires de test purgés (voir §6).
- Contrat UI, README, CHANGELOG et tests alignés sur Lasmium.

## 5. Validation

| Commande | Résultat |
| --- | --- |
| `npm test` | **228 tests, 228 réussis, 0 échec, 0 ignoré** |
| `npm run verify` | **66 fichiers** validés |
| `npm run test:desktop` | **PASS** (marque + logo, thèmes, polices Inter/Sora, widget 360×660, tray, export) |
| `npm run test:resources:desktop` | **PASS** (statuts, chips, thèmes clair/sombre) |
| `npm run test:claude:desktop` | **PASS** (repli Desktop, reprise, backoff) |

Le smoke vérifie désormais : titre `Lasmium TOKENS-HUB`, wordmark, logo chargé (≥ 32 px), Sora chargé dans le tableau de bord et le widget, Inter dans le corps, widget sans défilement à 360×660 et défilement fin à 320.

## 6. Fabrication et déploiement

- `npm run package:release` : `dist/LasmiumTokensHub-0.4.0-win32-x64/`, **sans données**, avec logo, polices, licences et documentation.
- `npm run release:artifacts` : `dist/LasmiumTokensHub-0.4.0-win32-x64.zip` (**151,8 Mo**), SHA-256 `0baa46202f2552b6c77183a310ad0a4baf2d860271cbe4e0492aa70acb026e88` (`dist/SHA256SUMS-0.4.0.txt`).
- `npm run update:portable` : ressources 0.4.0 dans le dossier historique, **exécutable `LasmiumTokensHub.exe`**, données conservées (`data/state.json`, 3,34 Mo).
- Nettoyage : anciennes releases 0.2.x–0.3.5 et dossiers temporaires de test supprimés ; release 0.3.6 et 0.4.0 conservées.

## 7. Limites connues

1. L'icône de l'exécutable Windows (affichée par l'Explorateur) reste celle d'Electron ; la fenêtre, la barre des tâches et la zone de notification utilisent le logo Lasmium. Une personnalisation de la ressource PE nécessiterait un outil supplémentaire.
2. Les captures d'écran de validation sont générées avec des données de démonstration ; les données personnelles ne sont ni copiées ni exportées dans les artefacts.
3. L'application ouverte avant la mise à jour doit être quittée puis relancée via le nouveau lanceur pour charger la 0.4.0.

## 8. Conclusion

Lasmium TOKENS-HUB dispose d'une identité et d'une interface entièrement nouvelles, sans régression fonctionnelle : 228 tests et les trois smokes Electron passent, la release 0.4.0 est construite et le portable personnel a été mis à jour en conservant les données.
