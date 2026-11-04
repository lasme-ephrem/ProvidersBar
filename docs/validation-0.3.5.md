# Validation Lasmium TOKENS-HUB 0.3.5

Vérifications réelles du **4 novembre 2026** (Europe/Paris) sur Windows x64, Node.js **v24.18.0**, Electron **44.10.2**, version applicative **0.3.5**. Cette validation couvre T19 (segmentation Hebdo/Horaire, chips de statut textuelles, police **Inter Variable** autohébergée) et T20 (adaptation des smokes/qualité).

**Méthode** : tests unitaires et smoke tests Electron réellement exécutés ; mesures de rendu dans Chromium via les fenêtres Electron (taille réelle, familles calculées, dimensions de lignes). Aucun fichier `renderer/`, `main.cjs`, `lib/` ou `preview.cjs` modifié par cette validation : seuls les smokes, `tests/quality.test.cjs` et ce document l'ont été.

## 1. Libellés segmentés vérifiés

| Contexte | Attendu | Vérifié |
|---|---|---|
| Carte Claude | `Hebdo 40 % · Horaire 80 % · Hebdo Fable 30 %` (aucun « 5 h ») | oui — `.quota-period-label` = `['Hebdo','Horaire','Hebdo Fable']`, aucune occurrence de « 5 h » |
| Carte Antigravity | Gemini `Hebdo 88 % / Horaire 95 %`, Claude/GPT `Hebdo 70 % / Horaire 90 %`, groupe Argon `Hebdo Argon 60 %` | oui — labels `['Hebdo','Horaire','Hebdo','Horaire','Hebdo Argon']` |
| Carte Z.ai (5 h seulement) | une seule ligne `Horaire 50 %`, **aucune ligne « — »** | oui — un seul `.quota-period`, label `Horaire`, pas de tiret dans la carte |
| Widget Claude | segments `Hebdo Fable 30 % · Hebdo 40 % +1` | oui — `.quick-value-label`=Hebdo Fable, `.quick-value-main`=30, `.quick-segment-label`=Hebdo, `.quick-segment-value`=40, `.quick-extra`=+1 |
| Widget Antigravity | segments `Hebdo Argon 60 % · Hebdo 70 % +1` | oui — label Hebdo Argon 60, second segment Hebdo 70, `+1` |
| Widget Z.ai | `Horaire 50 %`, aucun second segment inventé | oui — pas de `.quick-segment-label`, pas de `.quick-extra` |

Sémantique T19 vérifiée : `.quick-value-label`/`.quick-value-main` = segment le plus contraint ; `.quick-segment-label`/`.quick-segment-value` = second segment ; `.quick-extra` compte les **segments masqués** (2 affichés max, un par libellé agrégé) — Claude et Antigravity ont 3 catégories → `+1`, pas `+4` comme avant. Aucun libellé « 5 h » n'est plus attendu par les smokes.

## 2. Chips de statut

- `.level-pill` reste la classe unique : cartes, widget (`.level-pill.quick-level`), légende des Réglages et fiche.
- Textes toujours visibles, jamais portés par la couleur seule : `Épuisé / Critique / Bas / Suffisant / Indisponible`.
- `title` explicite vérifié dans les cartes et le widget : `Ressource suffisante`, `Bas · ≤ …`, `Critique · ≤ …`, `Ressource épuisée`, `Donnée indisponible`.
- Légende des Réglages vérifiée : `Épuisé · 0`, `Critique · ≤ 2 USD ou ≤ 10 %`, `Bas · ≤ 5 USD ou ≤ 25 %`, `Suffisant · au-dessus`, `Indisponible · aucune donnée`.
- `.quick-level` conserve son rôle de chip compacte dans les 10 lignes du widget (classe `resource-*` + texte + `title`).

## 3. Police Inter Variable autohébergée

- `assets/fonts/InterVariable.woff2` : **352 240 octets**, signature WOFF2 (`wOF2`) valide ; `assets/fonts/LICENSE-Inter.txt` : licence **SIL Open Font License**.
- `renderer/styles.css` : `@font-face` local (`url("../assets/fonts/InterVariable.woff2") format("woff2")`, `font-weight: 100 900`, `font-display: swap`), aucune police distante (aucun CDN, CSP `'self'`).
- `--font-ui` commence par `"Inter Variable", "Inter"` (repli Segoe UI/system-ui) ; `font-variant-numeric: tabular-nums` sur le corps.
- Vérification réelle dans **les deux surfaces** (fenêtre principale et widget `?mode=quick`) : `document.fonts.check('400 13px "Inter Variable"') === true`, famille calculée contenant `Inter Variable`, `font-variant-numeric` = `tabular-nums`.
- Embarquement : `scripts/app-resources.cjs` copie `assets/` (donc la police et sa licence) dans le portable ; le smoke vérifie conditionnellement un portable déjà reconstruit avec la nouvelle feuille de style (aucun portable 0.3.5 reconstruit au moment de la validation — voir §6).
- L'aperçu navigateur exige le MIME `font/woff2` (ajouté par le Lead dans `scripts/preview.cjs`) : sans lui, la route de la police répondait 500 et `document.fonts.check` restait `false`.

## 4. Widget 360×520

- Fenêtre par défaut **360 × 520** (aucun auto-dimensionnement) ; **10 lignes** (6 abonnements puis 4 API), sections `Abonnements` / `API`, `.quick-count` « 10 comptes · 6 abonnements · 4 API ».
- Lignes **36 px** (assertion 35–40 px), **aucun chevauchement**, icônes **20×20 px** chargées et visibles, chips sur deux lignes internes autorisées.
- **Aucun défilement** en 360×520 : `scrollHeight <= clientHeight` (mesure de référence Chromium/aperçu : **421 px / 421 px**), pied `.quick-footer` visible.
- **Défilement fin uniquement en cas de dépassement** : à 360×320 (fenêtre temporairement redimensionnable dans le test), `scrollHeight > clientHeight`, `overflow-y: auto|scroll` ; capture `test-results/widget-scroll-360x320.png`. La barre fine (5 px / `scrollbar-width: thin`) est définie en CSS.
- Aucun âge affiché en permanence ; seul un indicateur « Relevé à vérifier » apparaît si nécessaire ; fournisseurs non suivis absents.

## 5. Résultats réels

### 5.1 Smoke tests Electron (exécutés réellement)

| Commande | Résultat | Durée locale | Contenu |
|---|---|---:|---|
| `npm run test:desktop` | **PASS**, exit 0 | **12,5 s** | libellés, chips, segments, police (fichiers/offline/OFL/chargement dashboard+widget/tabular-nums), widget 360×520 (10×36 px, icônes 20, sans défilement, scroll à 320), recommandations absentes, inventaire/filtres, connexions, effacement, thème, redémarrage |
| `npm run test:resources:desktop` | **PASS**, exit 0 | **2,0 s** | cartes (statuts `Hebdo/Horaire/Hebdo Argon`, `Toutes les limites atteintes`), rouges des soldes négatifs dans les 2 thèmes, widget segmenté (`.quick-value`/`.quick-segment*`/`.quick-level`) |
| `npm run test:claude:desktop` | **PASS**, exit 0 | **5,9 s** | aucun changement requis (repli Claude Desktop, panne/reprise, aucun jeton persisté) |

Captures de référence : `test-results/after-claude-card.png`, `after-antigravity-card.png`, `after-zai-card.png`, `after-widget-segmented.png`, `after-widget.png`, `after-claude-dialog.png` (fournies/validées par le Lead), plus les captures régénérées par les smokes : `quick.png` (widget 360×520), `resource-levels-widget.png`, `resource-levels-dashboard.png`, `widget-scroll-360x320.png`.

### 5.2 Tests et vérifications statiques

| Commande | Résultat |
|---|---|
| `npm test` | **227 tests, 226 réussis, 0 échec, 1 ignoré** — exit 0, 4,6 s |
| `npm run verify` (`node scripts/check-syntax.cjs`) | **66 fichiers**, exit 0 |
| `node scripts/doctor.cjs` (contrôle environnement) | non rejoué dans cette validation ciblée (inchangé depuis 0.3.3) |

Le seul test ignoré est `tests/packaging.test.cjs` → « preview.cjs sert l'interface… » : **port 4317 occupé** par le serveur d'aperçu utilisé pour mesurer/valider le rendu. Skip environnemental attendu ; il repasse port libre.

### 5.3 Assertions ajoutées / modifiées

- `smoke.cjs` : attentes `Limite 5 h` remplacées par les libellés T19 ; nouvelles assertions `Hebdo`/`Horaire`/`Hebdo Fable`/`Hebdo Argon` (cartes et widget), absence de « 5 h », fenêtre absente sans « — », segments `.quick-segment-label`/`.quick-segment-value` et `.quick-extra=+1` (au lieu de `+4`), chips (`.level-pill`, `.quick-level`, `title`), légende des Réglages, police (fichiers WOFF2 + licence OFL + `document.fonts.check` + famille + `tabular-nums`, dans les deux fenêtres, et contrôle conditionnel du portable reconstruit), lignes de 36 px (35–40) au lieu de ~32 px.
- `smoke-resource-status.cjs` : statuts attendus `Limite horaire atteinte` et `Limite hebdo Argon atteinte` (au lieu de « 5 h » et « Gemini 4 Argon · hebdo »), libellé le plus contraint `Horaire`/`Hebdo Argon`, `.quick-extra` calculé par catégories de segments (Claude/Antigravity `+1`, les autres 0), second segment vérifié ; attente de création de la fenêtre widget au démarrage (course corrigée).
- `tests/quality.test.cjs` : nouveaux marqueurs « libellés segmentés + chips + police » ; nouveau test **police Inter empaquetée** (WOFF2 valide, licence OFL, `@font-face` locale, `--font-ui`, aucun CDN, copie `assets/` par le packaging) ; nouveau test **libellés/chips couverts** (Hebdo, Horaire, Hebdo Fable, Hebdo Argon, segments, chips, absence de statut « 5 h » obsolète).

## 6. Limites et points de vigilance

1. **Police OFL** : Inter Variable est embarquée sous SIL Open Font License ; `LICENSE-Inter.txt` doit rester distribué avec le portable (copié via `assets/`). La police variable pèse **352 Ko** dans le paquet ; c'est le seul coût de la fonctionnalité (aucune requête réseau).
2. **Tailles inchangées** : le widget reste **360×520**, lignes **36 px**, capture de référence **@2x** (720×1040). Aucun auto-dimensionnement ; au zoom ou avec une police système agrandie, la liste défile avec la barre fine (comportement voulu, vérifié à 320 px).
3. **Aperçu navigateur** : la police ne se charge dans `npm run preview` qu'avec le MIME `font/woff2` (corrigé par le Lead). Dans Electron (`file://`), le chargement est direct et vérifié par le smoke.
4. **Portable/release** : au moment de la validation, aucun portable 0.3.5 n'était encore reconstruit. Depuis, le Lead a exécuté `npm run package:release` et `npm run update:portable` : la police et sa licence sont présentes dans `dist/Lasmium TOKENS-HUB-0.3.5-win32-x64/resources/app/assets/fonts/` **et** dans le portable personnel ; voir §8.
5. **Libellés agrégés** : un même libellé (ex. plusieurs « Hebdo » Gemini/Claude, ou « Hebdo » Semaine/Grok Bot) n'affiche qu'un segment, le plus contraint ; le détail complet reste dans le `title` et le texte accessible de la ligne. Ce choix est conforme au contrat §8.1.
6. **Chips et couleur** : le texte reste toujours visible sans la couleur (AA conservé) ; les seuils de la légende et des notifications sont distincts.
7. Le test `preview` reste ignoré tant que le serveur d'aperçu occupe le port 4317 ; relancer `npm test` après l'avoir arrêté pour le voir passer.
8. Validation locale et datée (une machine, fenêtres Electron réelles, transports simulés pour les fournisseurs) ; les libellés et tailles sont déterministes, la police dépend des fichiers embarqués.

## 7. Conclusion

La segmentation Hebdo/Horaire, les libellés `Hebdo Fable` et `Hebdo Argon`, les chips de statut textuelles et la police Inter Variable autohébergée sont fonctionnels et vérifiés dans le tableau de bord **et** le widget. Le widget compact 360×520 affiche 10 lignes de 36 px avec segments et chips, sans défilement ni chevauchement, et ne défile qu'en cas de dépassement. Les trois smokes et la suite unitaire sont verts ; les limites ci-dessus (licence OFL, tailles figées, MIME de l'aperçu) sont documentées et n'affectent pas la livraison 0.3.5.

## 8. Fabrication et déploiement (Lead)

- `npm test` rejoué : **227 tests, 227 réussis, 0 échec, 0 ignoré** (~4,3 s, port d'aperçu libéré) ; `npm run verify` : **66 fichiers**.
- Smokes rejoués par le Lead : `test:desktop` **PASS**, `test:resources:desktop` **PASS**, `test:claude:desktop` **PASS** (rejoué seul après un premier échec d'enchaînement : les trois commandes lancées consécutivement dans le même shell peuvent se chevaucher ; les exécuter séparément ou avec une pause, comme en CI où chaque étape est isolée).
- `npm run package:release` : `dist/Lasmium TOKENS-HUB-0.3.5-win32-x64/` créé, **sans `data/`**, avec la police et la licence OFL dans `resources/app/assets/fonts/` ; `README.md`, `CHANGELOG.md`, `PRIVACY.md`, `SECURITY.md` embarqués.
- `npm run release:artifacts` : `dist/Lasmium TOKENS-HUB-0.3.5-win32-x64.zip` (**151,5 Mo**), SHA-256 `0b3445cefb7b62cd34e1e319393c054c2d152366c609d7631d4548b72c8b0ef8` (`dist/SHA256SUMS-0.3.5.txt`).
- `npm run update:portable` : portable personnel `dist/Lasmium TOKENS-HUB-win32-x64/` passé en **0.3.5**, données conservées (`data/state.json` intact), police et licence présentes. Quitter l'application encore ouverte puis la relancer pour charger la nouvelle version.
