# Validation ProvidersBar 0.3.4

Vérifications réelles du **4 novembre 2026** (Europe/Paris) sur Windows x64, Node.js **v24.18.0**, Electron **44.10.2**. Version cible **0.3.4** ; `package.json` observé pendant les tests : **0.3.3** (le bump et l'alignement README/CHANGELOG sont faits par le Lead en parallèle, hors de cette validation).

Cette validation couvre deux changements produit majeurs (T16/T17) : **suppression complète de la fonctionnalité de recommandation/ordre de consommation** et **widget compact 360×520** (taille ajustée par le Lead depuis 360×560 après mesure du contenu). Aucun fichier `renderer/`, `main.cjs`, `preload.cjs` ou `package.json` n'a été modifié par cette validation : seuls les smokes, le test qualité et ce document l'ont été.

## 1. Ce qui a été vérifié

### 1.1 Recommandations / ordre de consommation supprimés

- Fichiers retirés du dépôt : `lib/usage-strategy.js`, `renderer/strategy-ui.js`, `renderer/strategy.css`, `tests/usage-strategy.test.cjs`.
- Preload : `updateStrategy` retiré (23 canaux `invoke` restants). Canal `strategy:update` retiré de `main.cjs`.
- Migration : `state.strategy` supprimé de l'état persisté ; l'état public ne contient plus `strategy` (`delete visibleState.strategy`).
- Export : le document exporté ne contient plus de clé `strategy`.
- Interface : plus de panneau « Ton ordre d'usage » / « Utilise maintenant / Puis » dans le tableau de bord, plus de formulaire « Ordre de consommation » dans Réglages, plus de section recommandation/classement d'API dans le widget.

Vérifié en smoke par des assertions **négatives** explicites : absence des textes « Utilise maintenant », « Abonnements à vérifier », « API disponibles à utiliser », « Régler l'ordre », « Ton ordre d'usage », « Ordre de consommation » ; absence des sélecteurs `.strategy-*`, `#strategy-form`, `[data-action="strategy-settings"]` ; `strategyResult`/`UsageStrategy` non définis dans le renderer ; `'strategy' in publicState === false` ; clé absente de l'export et du `state.json`.

### 1.2 Widget compact 360×520

- Fenêtre Electron par défaut **360 × 520** (`main.cjs` : `quickDesiredHeight = 520`, création `Math.min(520, zone de travail − 16)`), **sans auto-dimensionnement** : le renderer n'appelle plus `fitQuick()` / `window:quick-size` (API preload conservée mais inutilisée).
- Liste unique : titre **Abonnements** (6 entrées) puis titre **API** (4 entrées), ordre de l'inventaire, sans classement ni recommandation.
- Lignes compactes de **32 px** environ, une seule ligne, contenu phrasing uniquement ; **icônes 20×20 px** visibles ; niveau toujours **textuel** (`.quick-level` : Suffisant / Bas / Critique / Épuisé / Indisponible) ; résumé de la fenêtre la plus contrainte (`.quick-value-label`, `.quick-value-main`, badge `.quick-extra +N`) ; solde API dans `.quick-value .resource-value` ; quota/solde inconnu = « — » + « Indisponible », sans barre.
- **10 lignes visibles sans défilement** : mesure smoke `scrollHeight <= clientHeight` (+1 px de tolérance) à 360×520, pied du widget visible.
- **Défilement fin uniquement en cas de dépassement** : à 360×320 (fenêtre temporairement redimensionnable dans le test), la liste défile (`scrollHeight > clientHeight`, `overflow-y:auto|scroll`) ; capture `test-results/widget-scroll-360x320.png`. La règle CSS de barre fine (5 px / `scrollbar-width: thin`) est définie dans `renderer/styles.css`.
- **Pas d'âge affiché en permanence** : l'heure du dernier relevé reste dans le `title` ; l'icône `.quick-stale` « Relevé à vérifier » n'apparaît que si le relevé est ancien/en erreur/déconnecté.
- **Fournisseurs non suivis absents** : un abonnement expiré non-Ollama ou en pause disparaît du widget (testé : Z.ai expiré → 9 lignes ; Ollama Free reste suivi). Ollama en Free reste inclus.

## 2. Résultats réels

### 2.1 Smoke tests Electron (exécutés réellement)

| Commande | Résultat | Durée locale | Points couverts |
|---|---|---:|---|
| `npm run test:desktop` | **PASS**, exit 0 | **16,3 s** | recommandations absentes (dashboard/réglages/widget/export), inventaire 10 cartes + filtres, widget 360×520 : 10 lignes (6 abonnements + 4 API), 2 titres de section, hauteurs ~32 px, icônes 20 px visibles, `scrollHeight <= clientHeight`, footer visible, pas de chevauchement, défilement fin à 320, fournisseur expiré absent ; connexions/Claude/Ollama/Orca, effacement, thème, redémarrage, export |
| `npm run test:resources:desktop` | **PASS**, exit 0 | **3,8 s** | cartes inchangées (`.card.resource-*`, statuts par fenêtre, `resource-status`, rouges des soldes négatifs) + widget adapté aux nouveaux hooks `.quick-value` / `.quick-level` / `.quick-value-label` / `.resource-value` |
| `npm run test:claude:desktop` | **PASS**, exit 0 | **7,5 s** | aucun changement requis (repli Claude Desktop, toast neutre T11, panne/reprise, aucun jeton persisté) |

Captures produites/régénérées : `test-results/quick.png` (widget 360×520 du smoke), `widget-scroll-360x320.png` (défilement fin), `resource-levels-widget.png`, `resource-levels-dashboard.png`, `widget-compact.png` (capture de référence 360×560 @2x fournie par ux-docs — la fenêtre par défaut est depuis passée à 520), `dashboard.png`, `compact-window.png`, etc.

### 2.2 Tests et vérifications statiques

| Commande | Résultat |
|---|---|
| `npm test` | **225 tests, 224 réussis, 0 échec, 1 ignoré** — exit 0 |
| `npm run verify` (`node scripts/check-syntax.cjs`) | **66 fichiers**, exit 0 |

Le seul test ignoré est `tests/packaging.test.cjs` → « preview.cjs sert l'interface… » : **port 4317 déjà occupé** par le serveur d'aperçu lancé pour mesurer le widget. Skip environnemental attendu, sans échec ; il repasse lorsque le port est libre. Suppression de `tests/usage-strategy.test.cjs` prise en compte dans le décompte (les deux nouveaux tests qualité sur l'absence de recommandations et le widget compact sont inclus).

### 2.3 Assertions ajoutées / supprimées dans les smokes

**Supprimées (fonctionnalité retirée)** : clic `[data-action="strategy-settings"]`, `#strategy-form`, `#strategy-model-*`, `#strategy-inputTokens`, `updateStrategy()`, état `strategy`, fixtures et captures `strategy-dashboard.png`/`strategy-api.png`, `.strategy-panel/current/next/api/api-providers/details`, comparaison de recommandation tableau de bord↔widget, asserts de persistance `loaded.strategy.*`, auto-dimensionnement (`fitQuick`, `innerHeight < previous`, `innerHeight === 900`).

**Ajoutées (non-régression T16/T17)** : absence de tous les textes/selectors de recommandation (dashboard, réglages, widget, export, état public) ; `typeof strategyResult/UsageStrategy === 'undefined'` ; `state.json` sans clé `strategy` ; taille de contenu widget ≈ 360×520 ; ordre exact des 10 fournisseurs (6 abonnements puis 4 API) ; 2 titres `.quick-group-title` ; `.quick-count` « 10 comptes · 6 abonnements · 4 API » ; `.quick-value`/`.quick-level`/`.quick-value-label`/`.quick-extra` ; 10 icônes 20×20 chargées et visibles ; hauteurs de ligne 31–40 px sans chevauchement ; non-défilement à 520 et défilement à 320 ; absence d'âge permanent (`il y a`/`à l'instant`/`Dernier relevé` hors `title`) ; exclusion d'un fournisseur expiré non-Ollama ; absence des anciens hooks `.quick-quota/.quick-period*/.quick-resource-status/.quick-freshness/.meter` dans le widget.

## 3. Limites et points de vigilance

1. **Widget de hauteur fixe 520 px, sans auto-fit** : c'est un choix produit assumé. Avec un zoom Windows important ou une police système agrandie, les 10 lignes peuvent dépasser 520 px ; la liste défile alors avec la barre fine (comportement voulu, vérifié à 320 px). Aucun élément n'est coupé horizontalement (largeur 360 px).
2. **Pas d'âge permanent dans le widget** : la fraîcheur est consultable dans le `title` de la ligne ; seul un indicateur « Relevé à vérifier » apparaît en cas de problème. Ce choix diffère du widget 0.3.0 et doit rester documenté.
3. **Fournisseurs non suivis absents** : abonnements expirés non-Ollama et services en pause ne sont pas listés dans le widget ; Ollama Free reste listé.
4. **La capture `widget-compact.png` a été régénérée par le Lead à 360×520 @2x** après l'ajustement de hauteur ; le smoke produit aussi `quick.png` à 520. Captures Lead : `widget-compact.png`, `widget-compact-520.png`, `widget-compact-short.png`.
5. **Validation locale et datée** : une machine, un compte, fixtures et transports simulés ; aucune lecture fournisseur réelle liée à ce changement. Les formats externes ne sont pas concernés par la suppression des recommandations.
6. Le test `preview` est ignoré pendant que le serveur d'aperçu occupe le port 4317 ; relancer `npm test` après l'avoir arrêté pour le voir passer.
7. Les tests de cette validation ont d'abord tourné avec `package.json` en 0.3.3, puis la suite complète et les trois smokes ont été rejoués après le bump 0.3.4 : **225/225 tests, 0 échec, 0 ignoré**, smokes PASS. Les comportements vérifiés ne dépendent pas du numéro de version.

## 4. Conclusion

La suppression des recommandations/ordre de consommation est effective et vérifiée sur les quatre surfaces (état public, export, tableau de bord, réglages, widget) sans laisser de fichier, de canal IPC ni de sélecteur actif. Le widget compact 360×520 affiche 10 lignes (6 abonnements puis 4 API), hauteur ~32 px, icônes 20×20, sans défilement ni chevauchement, et ne défile avec une barre fine qu'en cas de dépassement. Les trois smokes et la suite unitaire sont verts ; les limites ci-dessus (hauteur fixe, pas d'âge permanent, fournisseurs non suivis absents) sont documentées et n'affectent pas la livraison 0.3.4.

## 5. Fabrication et déploiement

- `npm run package:release` : `dist/ProvidersBar-0.3.4-win32-x64/` créé, **sans `data/`**, avec `README.md`, `CHANGELOG.md`, `PRIVACY.md` et `SECURITY.md` embarqués ; `lib/usage-strategy.js`, `renderer/strategy-ui.js` et `renderer/strategy.css` absents du livrable (vérifié).
- `npm run release:artifacts` : `dist/ProvidersBar-0.3.4-win32-x64.zip` (**151,2 Mo**), SHA-256 `5a9ca63a78bb0afff880b68f2fab7d71ed324a43792fc74889d3c99828dc512b` (`dist/SHA256SUMS-0.3.4.txt`).
- `npm run update:portable` : portable personnel `dist/ProvidersBar-win32-x64/` passé en **0.3.4**, données conservées (`data/state.json` intact). L'application encore ouverte doit être quittée puis relancée pour charger la nouvelle version.

## 6. Conclusion de livraison

Le produit est simplifié comme demandé : les abonnements et les API sont listés, sans suggestion de modèle ni ordre de consommation, dans le tableau de bord comme dans le widget compact. La release 0.3.4 est construite, vérifiée et déployée sur le portable personnel.
