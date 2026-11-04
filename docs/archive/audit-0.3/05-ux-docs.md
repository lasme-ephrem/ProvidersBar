# Analysis 05 — Cohérence interface ↔ documentation ↔ produit

**Projet :** ProvidersBar 0.2.1 (Electron, Windows x64)
**Auteur :** `ux-docs` (tâche partagée `task-5`)
**Date :** 3 novembre 2026
**Périmètre lu :** `renderer/*` (8 fichiers), `lib/resource-levels.js`, `lib/quota-resets.js`, `lib/usage-strategy.js`, `README.md`, `docs/*.md` (4), `CHANGELOG.md`, `assets/providers/sources.json`, plus les points d'appui nécessaires dans `main.cjs`, `preload.cjs`, `lib/domain.cjs`, `lib/seed.cjs`, `lib/migrations.cjs`, `lib/provider-catalog.cjs`, `lib/account-browser.cjs`, `lib/connectors.cjs`, `lib/openai-account.cjs`, `package.json`, `scripts/package.cjs`, `scripts/app-resources.cjs`, `scripts/update-portable.cjs`, `scripts/preview.cjs`, `scripts/verify-connections.cjs`, `scripts/smoke-resource-status.cjs`, `tests/resource-levels.test.cjs`, `tests/quota-resets.test.cjs` (survol), `.gitignore`, `Lancer ProvidersBar.cmd`, `git log`.

**Méthode :** revue statique de code et de documentation, lecture seule, sans lancer l'application ni Playwright (contrainte de la tâche). Les ratios de contraste ont été **calculés** selon la formule WCAG 2.1 (luminance relative sRGB), y compris la composition alpha pour les éléments atténués. Aucun test avec lecteur d'écran (NVDA/Narrator) n'a été mené : les constats ARIA sont issus du code et de la spécification ARIA/HTML, pas d'une observation d'AT réelle. Les constats de comportement de focus reposent sur le comportement standard du DOM (`innerHTML` remplace et détruit les nœuds focalisés).

**Limites :** pas de mesure de rendu réelle (captures, zoom, forced-colors), pas d'audit axe-core, pas de vérification manuelle des services fournisseurs. Les notes sont donc des notes de revue, pas de certification.

---

## 0. Synthèse exécutive

| Sous-axe | Note /10 | Justification en une phrase |
|---|---:|---|
| Cohérence documentation ↔ code | **6,5** | L'essentiel des promesses du README est vérifié (seuils, fraîcheur, priorités de dates, 10 fournisseurs, export), mais plusieurs affirmations sont inexactes ou incomplètes (fraîcheur du widget, « toutes les 5 min », ordre de consommation à 2 groupes, catalogue daté, notifications non documentées, version affichée). |
| Qualité du renderer / UI | **5,0** | Fonctionnel et cohérent visuellement, mais monolithe `app.js` de 65,5 Ko en 430 lignes avec des lignes de 2 400 caractères, duplication cartes/widget, rendu complet à chaque état, base CSS minifiée sur une ligne puis surchargée, sélecteurs morts. |
| Accessibilité | **3,5** | Plusieurs échecs AA de contraste (dont 2,47:1 sur les axes de graphique en thème clair), focus perdu à chaque rendu, navigation inaccessible au zoom, `aria-label` qui masque du contenu, information portée par la couleur seule, typographie 8–10 px. Points forts réels : `:focus-visible`, `prefers-reduced-motion`, dialogue natif, toasts `aria-live`. |
| Rédaction française | **6,5** | Ensemble très lisible et souvent pédagogique, mais anglicismes (« providers », « Reset », « Free »), terminologie instable (quota/limite/fenêtre/réserve/forfait/abonnement), quelques typos et messages techniques. |
| Positionnement / produit public | **4,0** | README honnête et local-first, mais il n'y a ni licence, ni politique de confidentialité, ni signature de code, ni mise à jour pour non-développeurs, ni i18n, ni « effacer mes données », et la marque personnelle « L'atelier de Lasme » est codée en dur. |
| Exactitude du CHANGELOG | **8,0** | Les entrées 0.2.0 et 0.2.1 correspondent aux deux gros commits (`19ad3b4`, `e14417e`) ; il manque l'entrée 0.1.0 (commit initial `0841ab2`) et un document de validation 0.2.1. |
| **Note globale** | **5,5** | Produit personnel solide et honnête ; pas encore prêt pour une distribution publique sans travail d'accessibilité, de distribution légale et de finition produit. |

**Top 5 des écarts les plus visibles pour l'utilisateur :**

1. Réglages affiche « **Version 0.1.0** » alors que l'application est en 0.2.1 (`renderer/app.js:237`).
2. Le widget promet la **fraîcheur** des relevés (README `README.md:3`) mais ne l'affiche jamais : seule une atténuation d'opacité existe (`renderer/app.js:247-261`).
3. Le tableau de bord annonce « Actualisation automatique toutes les 5 min » même quand elle est **désactivée**, et même pour Claude (1 min) (`renderer/app.js:70`, `renderer/app.js:237`, `main.cjs:49-54,686`).
4. Les **contrastes** échouent AA à plusieurs endroits, surtout en thème clair, et les valeurs « en retard » deviennent les moins lisibles à cause de `opacity:.65` (`renderer/styles.css:1`, `renderer/app.js:203`, `renderer/theme.css:75-88`).
5. La documentation d'ordre de consommation est **restée à deux groupes Antigravity** alors que le produit en suit trois depuis Argon (`docs/ordre-consommation.md:45` vs `lib/quota-resets.js:12`, `docs/architecture.md:61`).

**Top 5 des points forts à préserver :**

1. Les seuils de couleur sont **exactement** ceux promis et centralisés : rouge à 0, orange ≤ 2 USD / ≤ 10 %, jaune ≤ 5 USD / ≤ 25 %, vert au-delà (`lib/resource-levels.js:7-15`, `tests/resource-levels.test.cjs:5-14`, `README.md:18`).
2. La fraîcheur de 10 minutes est appliquée de façon cohérente côté rendu et côté stratégie (`renderer/app.js:87,137`, `lib/usage-strategy.js:95`, `lib/quota-resets.js:49`, `main.cjs:186`).
3. Dates de reset fournisseur prioritaires, compléments manuels tracés, aucune invention de relevé (`lib/quota-resets.js:43-57`, `renderer/reset-ui.js:8`, `README.md:65`).
4. Recommandations strictement limitées aux abonnements actifs disponibles et récents ; les API ne prennent jamais la place d'un abonnement (`lib/usage-strategy.js:86-96,138-143,165-175`).
5. Défense en profondeur XSS correcte : CSP `script-src 'self'` sans handlers inline (`renderer/index.html:6`), `escapeHtml` systématique sur les textes dynamiques (`renderer/app.js:20`), `:focus-visible` et `prefers-reduced-motion` présents (`renderer/styles.css:1`).

---

## 1. Tableau « promesse doc → réalité code → verdict »

Légende : **✓** conforme, **~** partiellement conforme ou nuance, **✗** non conforme.

### 1.1 README

| # | Promesse (référence) | Réalité code (référence) | Verdict |
|---|---|---|---|
| 1 | Dix fournisseurs suivis (`README.md:3,22-33`) | `lib/seed.cjs:1-12` : 10 entrées (6 abonnements, 4 API), `connectionInfo` pour les 10 (`lib/provider-catalog.cjs:52-58`) | ✓ |
| 2 | Couleurs : rouge à 0, orange ≤ 10 %/≤ 2 USD, jaune ≤ 25 %/≤ 5 USD, vert (`README.md:18`) | `lib/resource-levels.js:11-14` : `value===0 → empty`, `<=2`/`<=10 → critical`, `<=5`/`<=25 → low` ; tests d'égalité exacte `tests/resource-levels.test.cjs:5-14` | ✓ |
| 3 | « Les seuils monétaires concernent uniquement les crédits USD » (`README.md:18`) | Les seuils 2/5 USD ne s'appliquent qu'à `unit === 'USD'` (`lib/resource-levels.js:10,12-13`), **mais** un solde négatif EUR/CNY est aussi marqué rouge `empty` (`lib/resource-levels.js:9`, `tests/resource-levels.test.cjs:24-32`, `scripts/smoke-resource-status.cjs:43`) | ~ nuance |
| 4 | Relevé de plus de 10 min ou en erreur atténué (`README.md:18`) | `resourceUnverified` : âge > 600 000 ms **ou** erreur **ou** API déconnectée (`renderer/app.js:137`) ; classe `.resource-unverified` → `opacity:.65` (`renderer/styles.css:49`) ; badge « Relevé ancien » (`renderer/app.js:87`) | ✓ (le cas « API déconnectée » n'est pas documenté) |
| 5 | Dates de reset fournisseur prioritaires ; compléments manuels identifiés (`README.md:65`) | `QuotaResets.resolve` : fenêtre fournisseur d'abord, puis `manualResets` (`lib/quota-resets.js:43-57`) ; libellé « · manuel » (`renderer/reset-ui.js:8`) | ✓ |
| 6 | Le widget regroupe ressources restantes, **fraîcheur** et dates (`README.md:3`) | Le widget affiche quotas et dates (`renderer/app.js:245,260`) mais **jamais** l'âge du relevé : aucun `age()` dans `quickAccountRow`/`renderQuick` (`renderer/app.js:247-261,278-285`) ; seule l'opacité change | ✗ |
| 7 | Export ≤ 5 000 relevés, sans clés ni sessions (`README.md:79`) | Historique tronqué à 5 000 (`main.cjs:172`), export = `state` complet (`main.cjs:593-597`) ; les clés sont dans `credentials.json` séparé ; `state.providers[].accountSession` contient le type de session et, pour OpenAI, un **hash SHA-256 d'identité** (`lib/openai-account.cjs:83`) — pas une clé ni une session, mais un identifiant pseudonyme exporté | ✓ avec nuance |
| 8 | Actualisation automatique (5 min évoquées par l'UI) (`renderer/app.js:70,237`) | Boucle globale 5 min (`main.cjs:686`), Claude direct 1 min (`main.cjs:49-54`, `docs/architecture.md:27`) ; la statistique « toutes les 5 min » ignore `settings.autoRefresh` et la cadence Claude | ~ |
| 9 | Notifications Windows : échéance à 3 jours, quota < 20 %, solde USD sous le seuil (`renderer/app.js:237`) | `main.cjs:180-196` : échéance `daysUntil <= 3`, quota `quotaRemaining <= 20`, USD `<= lowBalance`, fraîcheur < 10 min, une alerte par jour/provier ; **absentes du README et des docs** | ✓ code / ✗ doc |
| 10 | Chaque limite affiche sa prochaine réinitialisation si fournie (`README.md:65`) | `resetMarkup` par fenêtre (`renderer/app.js:162,178`, `renderer/reset-ui.js:1-11`) ; « ↻ Date non fournie » répété quand la date manque | ✓ (bruit visuel, cf. F-19) |
| 11 | « Utilise maintenant, puis **Puis**, proposent uniquement les abonnements actifs dont les ressources sont confirmées et récentes » (`README.md:67`) | File = `ready` seulement, expiration/pause exclues, fraîcheur 10 min (`lib/usage-strategy.js:86-96,138-143,171-175`) ; le libellé « Puis » n'existe que dans le widget (`renderer/strategy-ui.js:16`), pas dans le panneau du tableau de bord | ~ |
| 12 | Réserves Antigravity indépendantes, fenêtres d'une même réserve cumulatives (`README.md:67`) | 3 buckets Antigravity (`lib/usage-strategy.js:27-29`), toutes les fenêtres requises doivent être présentes/positives (`lib/usage-strategy.js:109-124`), une fenêtre à 0 bloque (`:118-119`) | ✓ |
| 13 | Argon dans cartes, widget, dates, recommandations (`README.md:51`) | `QuotaResets` : `Gemini 4 Argon · Semaine` (`lib/quota-resets.js:12`) ; bucket dédié (`lib/usage-strategy.js:29`) ; rendu par les groupes de quotas (`renderer/app.js:95-101,245`) | ✓ |
| 14 | API disponibles listées séparément, solde USD positif décroissant (`README.md:69`) | `apiProviders` = fournisseurs API actifs, frais, sans erreur, solde USD > 0, triés décroissant (`lib/usage-strategy.js:165-169`) ; section séparée (`renderer/strategy-ui.js:6-8`) | ✓ |
| 15 | Catalogue daté du 12 septembre 2026, ajout Argon en octobre, pas de mise à jour automatique (`README.md:69`) | `checkedAt='2026-09-12'` (`lib/usage-strategy.js:8`) ; Argon `quality:null` (`:14`) ; date affichée en Réglages « Tarifs du 12 sept. 2026 » (`renderer/strategy-ui.js:20`) ; `pricesOld` est calculé (`lib/usage-strategy.js:174`) mais **jamais affiché** ; `docs/ordre-consommation.md:36` indique Opus 5.5 ajouté après le 22 septembre, non mentionné par le README | ~ |
| 16 | Thème clair/sombre réglable, appliqué dès le chargement (`README.md:14`, `docs/architecture.md:43`) | `theme-init.js:4` lit `localStorage` avant le CSS (`renderer/index.html:9-12`) ; `applyTheme` (`renderer/app.js:28-32`) ; fond natif synchronisé (`main.cjs:587-588,653,659`) ; **défaut clair, pas de préférence système** | ✓ (nuance : `prefers-color-scheme` absent) |
| 17 | Fermer la fenêtre → zone de notification ; clic icône → widget ; clic droit → Quitter (`README.md:16`) | `main.cjs:656` (hide), `661-665` (blur/hide, clic toggleQuick, menu tray), `main.cjs:664` | ✓ |
| 18 | Lancer `Lancer ProvidersBar.cmd` ou `dist/ProvidersBar-win32-x64/ProvidersBar.exe` (`README.md:9`) | `Lancer ProvidersBar.cmd` ne contient qu'un `start` vers **`dist\ProvidersBar-win32-x64\ProvidersBar.exe`** (portable personnel) ; la distribution propre (`dist/ProvidersBar-0.2.1-win32-x64/`) **ne contient ni ce .cmd ni un README lisible à côté de l'exe** (`scripts/app-resources.cjs:19-20`) ; typo « Lancer **Lancer** ProvidersBar.cmd » (`README.md:9`) | ~ |
| 19 | Réactivation d'un forfait expiré = confirmation + échéance future (`README.md:63`) | `main.cjs:499-501` : `confirmRenewal` obligatoire + `renewalDate` strictement future ; expiration automatique (`lib/domain.cjs:78-95`, timer `main.cjs:685`) | ✓ |
| 20 | Version 0.2.1 (`README.md:5`, `package.json:3`, `CHANGELOG.md:3`) | Réglages affiche **« Version 0.1.0 »** en dur (`renderer/app.js:237`) ; le RPC Codex annonce `version:'0.1.0'` (`lib/openai-account.cjs:51`) ; aucune utilisation de `app.getVersion()` dans l'UI | ✗ |
| 21 | Claude : lecture directe optionnelle, 1 min, Retry-After, pas de repli silencieux (`README.md:55-59`) | Gating `autoRefresh` (`main.cjs:51`), timer 2 s / échéance, doc détaillée (`docs/architecture.md:25-27`) ; `Retry-After` et conservation du dernier relevé décrits et couverts par `tests/claude-live-usage.test.cjs` | ✓ |
| 22 | Grok automatique sans fenêtre, fallback officiel unique, quotas Bot distincts (`README.md:43-45`, `CHANGELOG.md:5-8`) | `--headless=new` pour la lecture de fond (`lib/account-browser.cjs:62`), commentaire et parcours `fallbackUsageUrl` (`lib/subscription-accounts.cjs:5`) ; commit `e14417e` | ✓ |
| 23 | Antigravity : service local, aucune CLI, IDE seul insuffisant (`README.md:49`, `docs/architecture.md:37`) | `lib/antigravity-account.cjs` interroge le service local, `docs/architecture.md:37` ; instructions `lib/provider-catalog.cjs:3-8` | ✓ |
| 24 | `npm test`, `npm run test:desktop`, `test:resources:desktop`, `test:claude:desktop`, `preview`, `package`, `package:release`, `update:portable`, `verify:connections` (`README.md:92-102`) | Tous présents dans `package.json:7-18` ; scripts `scripts/*.cjs` correspondants | ✓ |
| 25 | Aperçu lecture seule sur `127.0.0.1:4317` (`README.md:98`) | `scripts/preview.cjs:9-21` : liste fermée de routes, `/preview-state` sans comptes, aucune écriture | ✓ |
| 26 | Rapport `connections-live.json` sans identité, clé, cookie ni montant de portefeuille (`README.md:106`) | `scripts/verify-connections.cjs:29-39` n'exporte que `id`, statuts, horodatages, `quotaWindows` (labels, %, reset) ; commentaire explicite `:34` | ✓ |
| 27 | Distribution `dist/ProvidersBar-0.2.1-win32-x64/`, refus si dossier existant, licences conservées (`README.md:118-122`) | `scripts/package.cjs:9-15` (nom versionné, `mkdir` non récursif), Electron `LICENSE`/`LICENSES.chromium.html` présents dans `dist/ProvidersBar-0.2.1-win32-x64/`, exécutable non signé (constat assumé `README.md:122`) | ✓ |
| 28 | Données locales chiffrées (`README.md:79-81`) | `safeStorage`/DPAPI (`main.cjs`, `lib/credential-store.cjs`) ; avertissement local et export sans clés (`renderer/app.js:73,192,237`) | ✓ |

### 1.2 docs/architecture.md, docs/ordre-consommation.md, docs/maintenance.md

| # | Affirmation (référence) | Réalité code (référence) | Verdict |
|---|---|---|---|
| 29 | `renderer/app.js` partage logos et regroupements de quotas entre cartes et widget (`docs/architecture.md:41`) | `logo`, `quotaGroups`, `quotaPeriodLabel`, `resetMarkup`, `UsageStrategy` partagés (`renderer/app.js:33-34,92-107`, `renderer/reset-ui.js`, `renderer/strategy-ui.js`) | ✓ |
| 30 | Thème sombre d'origine dans `styles.css`/`strategy.css`, palette claire dans `theme.css`, clair par défaut (`docs/architecture.md:43`) | `renderer/styles.css:1` (`:root` sombre), `renderer/theme.css:2-13` (clair), seed `theme:'light'` (`lib/seed.cjs:24`) | ✓ |
| 31 | Aperçu : liste fermée de ressources publiques, pas de dossiers de données (`docs/architecture.md:45`) | `scripts/preview.cjs:9-13` (liste blanche), pas de route `data/` | ✓ |
| 32 | `quota-resets` choisit la provenance, `reset-ui` formate les dates, compléments persistés via `provider:resets` (`docs/architecture.md:49-51`) | `lib/quota-resets.js:43-57`, `renderer/reset-ui.js:1-17`, `main.cjs:461-465` enregistre `p.manualResets` | ✓ |
| 33 | Antigravity possède **trois** réserves indépendantes (`docs/architecture.md:61`) | 3 buckets (`lib/usage-strategy.js:27-29`) | ✓ |
| 34 | Ordre de consommation : « Antigravity possède **deux** groupes à suivre : Gemini et Claude/GPT » (`docs/ordre-consommation.md:45`) | Trois réserves suivies depuis Argon (`lib/quota-resets.js:12`, `lib/usage-strategy.js:29`, README `:27`) ; la table des priorités `docs/ordre-consommation.md:25-32` ne contient pas Argon | ✗ (doc périmée) |
| 35 | Règle 5 : estimer entrée, cache lu/**écrit**, sortie, raisonnement (`docs/ordre-consommation.md:86`) | Le code exclut explicitement l'écriture de cache (`lib/usage-strategy.js:31,134`), et la fin du même document le dit (`docs/ordre-consommation.md:90`) : contradiction interne | ~ |
| 36 | Contributor n'entre dans « la liste séparée des API disponibles » qu'après accord (`docs/ordre-consommation.md:72`) | La section « API disponibles » liste des **fournisseurs** par solde, jamais des routes (`lib/usage-strategy.js:165-169`, `renderer/strategy-ui.js:7`) ; Contributor n'y apparaît donc jamais, il ne change que l'estimation des routes | ~ |
| 37 | Tarifs et repères de qualité du document (`docs/ordre-consommation.md:52-66,34,70,76,78`) | Correspondent au catalogue `lib/usage-strategy.js:9-49,51-55,126-136` (heures pleines DeepSeek, promo Gemini jusqu'au 31/12/2026, Multiplicateurs) | ✓ |
| 38 | Claude : watcher 2 s, `fh`/`sd`, deux profils comparés (`docs/architecture.md:25`) | `lib/claude-desktop-usage.cjs:12-13,25,41-42`, `main.cjs:667-677` (interval 2000) | ✓ |
| 39 | Tests/captures à examiner après modification visuelle (`docs/maintenance.md:10`) | Dossiers `test-results/` présents ; aucune capture versionnée (exclus par `.gitignore:5`) | ~ (procédure non automatisée) |
| 40 | `npm run test:resources:desktop` couvre Argon (`docs/maintenance.md:9`) | `scripts/smoke-resource-status.cjs:82-87` annonce 5 fenêtres et les deux surfaces | ✓ |
| 41 | Validation 0.2.0 : 133 tests unitaires (`docs/validation-0.2.0.md:7`) | 132 sites `test(` statiques au 3/11/2026, dont des tests générés en boucle (ex. `tests/native-login.test.cjs:10`) : le décompte exact ne peut pas être vérifié sans exécuter `npm test` (hors de mon périmètre) ; incohérence possible mais faible enjeu | à vérifier |

### 1.3 CHANGELOG vs réalité

| # | Entrée CHANGELOG | Réalité | Verdict |
|---|---|---|---|
| 42 | 0.2.1 : lecture Grok sans fenêtre, fallback unique, quotas Bot distincts, attente du rendu Bot (`CHANGELOG.md:3-8`) | Commit `e14417e` (« Corrige les ouvertures automatiques de Grok et attend le quota Bot ») modifie `lib/account-browser.cjs`, `lib/subscription-controller.cjs`, `main.cjs`, tests ; `--headless=new` (`lib/account-browser.cjs:62`) ; fallback `lib/subscription-accounts.cjs:5` | ✓ |
| 43 | 0.2.0 : nouveau dashboard Grok + pool partagé, Argon partout, protection des connexions, lecture directe Claude, réserve Ollama, thèmes, dates, stratégie (`CHANGELOG.md:10-18`) | Commit `19ad3b4` ajoute `usage-strategy.js`, `quota-resets.js`, `resource-levels.js`, `theme.css`, `theme-init.js`, `strategy-ui.js`, `reset-ui.js`, etc. ; tous présents | ✓ |
| 44 | 0.2.0 : suppression du lecteur et du logo Gemini web | `git show 19ad3b4` supprime `assets/providers/gemini.svg` ; plus aucune référence `gemini` hors migrations (`lib/migrations.cjs:2,8-12,54`) | ✓ |
| 45 | 0.2.0 : remplacement complet des ressources à la mise à jour, distribution sans données | `scripts/app-resources.cjs:8-33` (staging + swap + data préservées), `scripts/package.cjs:9-11` | ✓ |
| 46 | 0.2.0 : README réorganisé, diagnostic réel explicite, rapport local sans secrets (`CHANGELOG.md:18`) | `scripts/verify-connections.cjs` + section README `README.md:104-106` | ✓ |
| 47 | **Manque** l'entrée 0.1.0 | Commit initial `0841ab2` « Initialise ProvidersBar: application, tests et documentation » ; l'UI affiche encore « Version 0.1.0 » (`renderer/app.js:237`) ; aucun document de validation 0.1.0 | ✗ (lacune) |
| 48 | **Manque** une validation 0.2.1 | `docs/validation-0.2.0.md` s'arrête à 0.2.0, alors que `README.md:132` et `CHANGELOG.md:7` invoquent une vérification réelle 0.2.1 ; `docs/maintenance.md:55` la décrit partiellement | ~ |

**Bilan du croisement :** 34 promesses vérifiées ou vérifiées avec nuance, 6 écarts nets (widget/fraîcheur, version affichée, ordre de consommation à 2 groupes, notification non documentée, README « Lancer Lancer », dépendance du watcher Claude à l'actualisation automatique), et plusieurs nuances de rédaction. Aucun mensonge produit majeur ; les écarts sont surtout de la **dérive documentaire** après l'ajout d'Argon et de la version 0.2.1.

---

## 2. Qualité du renderer

### 2.1 Taille, structure, couplage

| Mesure | Valeur | Commentaire |
|---|---|---|
| `renderer/app.js` | **65 532 caractères**, 430 lignes, ~152 caractères/ligne en moyenne | 17 lignes dépassent 700 caractères, dont 4 dépassent 1 900 (jusqu'à **2 387** caractères en `renderer/app.js:321`) |
| `renderer/strategy-ui.js` | 8 481 caractères, 21 lignes | Lignes `:12`, `:16`, `:20` > 1 400 caractères |
| `renderer/styles.css` | 25 282 caractères, dont **16 423 sur la seule ligne 1** (base minifiée à la main) | Puis 60 lignes de surcharges successives `:2-61` |
| `renderer/strategy.css` | 5 007 caractères, 4 lignes | Même schéma que `styles.css:1` |
| `renderer/theme.css` | 6 053 caractères, 100 lignes | Seul CSS lisible ; bon point |

Constats :

- **Aucun module** : tout est en portée globale (IIFE pour `lib/*` uniquement). `strategy-ui.js`, `reset-ui.js` et `app.js` se partagent implicitement `state`, `escapeHtml`, `logo`, `inputField`, `resourceClass`, `disclosureState`, `render`, `renderDialog`, `toast`, `page` (`renderer/app.js:39-52`, `renderer/strategy-ui.js:2`, `renderer/reset-ui.js:1`). L'ordre de chargement manuel (`renderer/index.html:13-18`) est porteur de sens : inverser deux `<script>` casse silencieusement l'UI.
- **Pas de `"use strict"`, pas de point d'entrée nommé** : `start()` est appelé en fin de fichier (`renderer/app.js:429-430`) et le fichier navigue entre helpers purs, rendu de page, gestion de dialogue et handlers globaux.
- **Pas de routeur** : `page` est une variable globale (`renderer/app.js:39`), l'état de navigation/filtre n'est pas persisté (retour à « Vue d'ensemble » à chaque relance, `filtre` perdu).
- **Pas de séparation rendu/état** : chaque fonction de page reconstruit du HTML par template strings et relit `state` global.
- Le commentaire d'en-tête « Local UI. Provider credentials only cross the narrow preload bridge. » (`renderer/app.js:1`) est le seul garde-fou documentaire sur l'architecture du renderer.

### 2.2 Duplication cartes / widget / stratégie

- Les quotas sont rendus **trois fois** avec des variantes : `quotaGroupsMarkup` pour les cartes (`renderer/app.js:157-164`), `quickPeriods`/`quickQuota` pour le widget (`:239-246`), et les « réserves » du panneau stratégie (`renderer/strategy-ui.js:12`).
- La logique « niveau global de la carte » est recalculée dans `providerResourceLevel` (`renderer/app.js:117-126`), `allQuotaPeriodsExhausted` (`:112-116`) et `resourceNotice` (`:140-155`) avec des parcours de fenêtres très proches.
- La métrique de carte est un bloc `if/else` de 5 branches (`renderer/app.js:170-178`) qui duplique des choix déjà présents dans `quickAccountRow` (`:247-261`) : mêmes conditions `balances` / `quotaRemaining` / `ollamaFree` / `subscription`.
- Le seuil de fraîcheur `600000` est **codé en dur quatre fois** : `renderer/app.js:87`, `renderer/app.js:137`, `lib/usage-strategy.js:95`, `lib/quota-resets.js:49` (+ `main.cjs:186` pour les notifications). La promesse README « dix minutes » est donc à cinq endroits, sans constante commune.
- Le libellé « Date non fournie » est injecté pour chaque fenêtre de chaque fournisseur (`renderer/reset-ui.js:3`) : une carte Antigravity peut afficher jusqu'à cinq fois « ↻ Date non fournie », et le widget aussi.
- Points positifs : `logo`, `quotaGroups`, `quotaPeriodLabel`, `resetMarkup` et le moteur `UsageStrategy` sont bien factorisés ; `reset-ui.js` isole proprement le formatage des dates.

Recommandation : extraire un module d'affichage de quotas unique (données → modèle → composant carte/widget), centraliser `FRESHNESS_MS = 600000`, et rendre « date non fournie » une seule fois au niveau du groupe.

### 2.3 Gestion d'état, cycle de rendu, focus

- `render()` reconstruit **tout** `#app` via `innerHTML` (`renderer/app.js:60`) : navigation, filtres, cartes, dialogues exclus. Toute action (clic nav, filtre, favori, synchronisation) déclenche ce remplacement (`renderer/app.js:377-383`) : l'élément focalisé est détruit et le focus retombe sur `document.body`.
- `receiveState` re-rend à chaque diffusion d'IPC (`renderer/app.js:425`) et un `setInterval` de 60 s re-rend aussi la page si aucun champ n'a le focus (`renderer/app.js:429`) ; seule exception : `page === 'settings'`, et `#search` focalisé (`renderer/app.js:425`).
  - **Conséquence clavier/AT** : après avoir activé « Vue d'ensemble » au clavier, il faut re-tabuler depuis le début ; un utilisateur qui lit les cartes au clavier perd sa position toutes les 60 s.
  - Le recours à `disclosureState` pour préserver les `<details>` ouverts (`renderer/app.js:41-45,57`) est un pansement qui confirme le problème.
- Le dialogue est le seul endroit où ce risque a été anticipé : `renderDialog` ne reconstruit que lui (`renderer/app.js:329`), mais **chaque changement d'onglet le reconstruit aussi** (`renderer/app.js:380`) → le focus est perdu à chaque onglet ; et `receiveState` peut le reconstruire en cours d'ouverture (`renderer/app.js:426`). Il n'y a **aucune sauvegarde/restauration explicite du focus** ni `autofocus` ciblé.
- État de chargement de l'historique correct (`historyLoaded`/`historyLoading`/`historyError`, `renderer/app.js:206-235`), mais l'état est dupliqué dans `state.history` et dans `sessionStorage`? Non — il est mémorisé uniquement en mémoire, perdu à chaque navigation ? Non, `historyLoaded` est global et `state.history` reste chargé (`renderer/app.js:226,421`). En revanche, `receiveState` jette l'historique en cache quand `historyRevision` change (`:419-423`), ce qui vide l'affichage puis recharge ; c'est correct mais l'utilisateur voit un clignotement « Chargement… ».
- `syncing` global, pas par fournisseur (`renderer/app.js:39,367-368`) : le bouton global devient « Synchronisation… » mais le contenu ne montre pas quel fournisseur travaille, alors que le modèle porte `p.syncing` (`renderer/app.js:81`). L'état `busy` est bien exposé (`main.cjs:156`).

### 2.4 Rendu HTML et sûreté XSS

Verdict : **globalement sûr aujourd'hui, pattern fragile à moyen terme**.

- `escapeHtml` est correct et échappe `& < > " '` (`renderer/app.js:20`). Il est appliqué à la quasi-totalité des champs dynamiques : noms, plans, messages, instructions, labels de fenêtres, notes, `quotaLabel`, `balanceLabel`, `statusMessage`, messages d'erreur, textes de la stratégie (`renderer/app.js:166-178,187,192,203,297,310,317,321-329`, `renderer/strategy-ui.js:7,12,16,20`, `renderer/reset-ui.js:10`).
- La CSP `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'` (`renderer/index.html:6`) bloque les scripts inline et les handlers `onerror`/`onclick` injectés ; c'est une deuxième barrière réelle.
- **Interpolations sans `escapeHtml` repérées** : `w.remaining` dans le détail des quotas (`renderer/app.js:297,323,324,325`), `value` dans `aria-valuenow` (`:162`), attributs `data-*` avec des `id` internes (`:166,178,181,187,192,250,260`), `p.id` dans `style` de `logo` — la couleur est échappée (`:34`). Ces valeurs viennent des connecteurs et sont validées en amont, donc le risque exploitable est faible, mais l'invariant « tout champ dynamique est échappé » n'est pas garanti par le code.
- `money()` (`renderer/app.js:21`) peut lever `RangeError` si `currency` est inconnue ; les connecteurs et la saisie manuelle valident les devises (`lib/connectors.cjs:23`, `lib/domain.cjs:1,48`), mais une donnée restaurée ancienne ou altérée ferait échouer tout `render()` (`renderer/app.js:429` capture l'erreur au démarrage uniquement).
- Le texte injecté via `innerHTML` mélange structure et données ; une approche `document.createElement`/`textContent` ou un helper balisé réduirait le risque et faciliterait les tests.

### 2.5 États vides, erreur, chargement

| État | Implémentation | Verdict |
|---|---|---|
| Chargement initial | `<div class="loading">Chargement de ProvidersBar…</div>` (`renderer/index.html:21`) | ✓ visuel ; pas de `role="status"`, pas de spinner |
| Erreur de démarrage | remplace `#app` par un `.loading` contenant `error.message` (`renderer/app.js:429`) | ~ : même style que le chargement, pas de bouton « Réessayer », pas de `role="alert"` |
| Historique vide | carte avec icône, titre et CTA « Voir les connexions » (`renderer/app.js:213`) | ✓ |
| Erreur d'historique | message + bouton « Réessayer » (`renderer/app.js:209`) | ✓ |
| Recherche sans résultat | « Aucun service trouvé / Essaie un autre nom ou un autre filtre. » (`renderer/app.js:76`) | ✓ |
| Widget vide | « Aucun compte à afficher. » (`renderer/app.js:281`) | ✓ |
| Synchronisation sans compte | toast + bascule vers Connexions (`renderer/app.js:366`) | ✓ |
| Erreur fournisseur | badge, texte `.card-error`, avertissement dans Connexions, `.form-error` dans la fiche, toast après sync (`renderer/app.js:83,192,302,317`) | ✓ globalement bon |
| Synchronisation en cours | bouton désactivé + libellé, badge « Synchronisation… », `aria-busy` seulement dans le widget (`renderer/app.js:63,81,281`) | ~ |
| Hors-ligne / échec global de connectivité | pas d'indicateur global ; seule la liste des erreurs par fournisseur | ~ |
| Erreur de formulaire | `.form-error role="alert"` vidé puis rempli (`renderer/app.js:300,310,317,329`) | ✓ |
| Toast | `role="status" aria-live="polite"`, 4,5 s (`renderer/index.html:23`, `renderer/app.js:51`) | ✓ (masqué en mode widget : `renderer/styles.css:10`) |

Manques notables : pas de **squelette de chargement** pour l'historique (simple texte), pas d'**annonce live** lors des filtrages ou des mises à jour de quota, et l'erreur de démarrage n'offre aucune action de récupération.

### 2.6 Thème clair/sombre au démarrage

- `index.html` déclare `<html lang="fr" data-theme="light">` (`renderer/index.html:2`) ; `theme-init.js` est chargé **avant** les feuilles de style (`:9-12`) et applique `localStorage['providersbar-theme']` (`renderer/theme-init.js:4`). Le premier rendu correct est donc garanti **si** le choix est en localStorage, ce qui est le cas normal (écrit par `applyTheme`, `renderer/app.js:31`).
- Le fond natif de la fenêtre est aligné sur `settings.theme` dès la création (`main.cjs:653,659`) et à chaque changement (`main.cjs:587-588`) : bon point, évite le flash clair au lancement et le flash blanc en widget.
- Aucun échec de cohérence code ↔ doc : `docs/architecture.md:43` décrit exactement ce fonctionnement.
- Limites : défaut **clair imposé** même si Windows est en mode sombre (pas de `matchMedia('(prefers-color-scheme: dark)')`, pas d'option « Système ») ; et si le portable est copié vers un autre profil Windows sans le dossier `Local Storage` du `userData`, `theme-init` retombe sur clair alors que `state.settings.theme` peut être `dark` → flash clair jusqu'à l'arrivée de l'état (`applyTheme` dans `render()`). Cas de bord, mais réel pour un usage « portable ».
- Le widget hérite du thème via `render()`/`applyTheme` (`renderer/app.js:54-58`) : ✓.

### 2.7 HTML, ergonomie et finitions

- **HTML invalide** : `quickAccountRow` rend un `<button>` contenant `<div>` et `<h3>` (`renderer/app.js:250,260`). Le modèle de contenu d'un `button` est « phrasing content » ; ce marquage est invalide, peut perturber les lecteurs d'écran (titres aplatis) et la navigation. À corriger en `<div role="button">`/lien ou en sortant le titre du bouton.
- **Tooltips morts** : `.card .card-content { pointer-events:none }` (`renderer/styles.css:1`) désactive les `title` posés sur les valeurs et périodes (`renderer/app.js:136,162`, `renderer/reset-ui.js:10`). Les infobulles (niveau, countdown de reset, dernier montant lu) ne s'affichent donc jamais à la souris ; le contenu visible reste lisible mais l'information complémentaire est perdue.
- **Copie impossible** : même cause, les montants, pourcentages et messages d'erreur des cartes ne peuvent pas être sélectionnés à la souris (pas de sélection par glisser) — gênant pour un produit de suivi de comptes que l'on veut citer/vérifier.
- **Typographie trop petite** : le socle est 14 px, mais on trouve 8 px (`.quick-columns > span:first-child`, `.quick-period-status`), 9 px (badges, `.quick-quota strong`, `.quick-group-label`, `.quick-api p`), 10 px (nav-label, notes, dates de reset, `.badge`), 11 px (majorité des descriptions) — voir §3.7.
- **`quick` non redimensionnable** (`resizable:false`, 400 px, `main.cjs:659`) : choix produit cohérent avec un widget, mais aucun réglage de taille/police pour les utilisateurs qui en ont besoin.
- **Menu Electron par défaut** : `autoHideMenuBar: true` mais `Menu.setApplicationMenu` n'est jamais appelé ; Alt révèle un menu anglais (File/Edit/View/Window/Help, Zoom, DevTools) dans une application française, et il n'y a **ni « À propos », ni version, ni lien d'aide**. Finition attendue pour un produit public.
- **Pas de restauration de la taille/position de la fenêtre** : 1360×940 à chaque lancement (`main.cjs:654`).
- **CSS mort** : `.quick-row-expired`, `.quick-expired` (`renderer/styles.css:31-32`), `.meter.low span`, `.quick-meter.low i` (`:1,8`), `.manual-list` vide car tous les fournisseurs ont un connecteur (`renderer/app.js:192` et `lib/provider-catalog.cjs:52-58`), `pricesOld` jamais rendu (`lib/usage-strategy.js:174`), `stats` « 5 min » figé. Le CSS compte par ailleurs des redéfinitions successives du même sélecteur (`.logo` ligne 1 puis `renderer/styles.css:13` ; `.quick-row` `:8`, `:15`, `:45` ; `.quota-periods` `:6`, `:14` ; `.quick-strategy` `renderer/strategy.css:1` et `:4`) : la cascade est difficile à auditer.
- **`innerHTML` + tailles** : le recours à des `<span style="width:${value}%">` impose `style-src 'unsafe-inline'` (`renderer/index.html:6`) ; acceptable pour une app locale, mais c'est la seule raison de cette exception CSP.

---

## 3. Accessibilité

### 3.1 Contrastes (WCAG 2.1, calculés)

Méthode : luminance relative sRGB, seuil AA texte normal 4,5:1, grand texte 3:1, composants non textuels 3:1. Les valeurs « atténuées » composent la couleur à 65 % sur le fond (`.resource-unverified`, `renderer/styles.css:49`).

**Thème sombre** (échantillon : 24 paires, seules les anomalies sont listées ; les autres passent) :

| Couleur / usage | Fond | Ratio | Verdict |
|---|---:|---:|---|
| `.nav-label` `#69716e` | `#141617` | **3,62** | ✗ AA |
| `.search input::placeholder` `#717975` | `#16191a` | **3,95** | ✗ AA |
| `.bottom-note` `#6f7872` | `#101213` | **4,12** | ✗ AA (texte 10 px) |
| Valeur rouge atténuée `#ae6c6c` (composition) | `#181b1c` | **4,26** | ✗ AA |
| Libellés atténués `#666c6a` | `#181b1c` | **3,23** | ✗ AA |
| Texte courant `#edf0e9` | `#101213` | 16,32 | ✓ |
| `--muted` `#909794` | `#101213` / `#181b1c` | 6,30 / 5,81 | ✓ |
| Accent `#cfedaa` (titres, focus) | `#101213` | 14,62 | ✓ |
| Primaire `#24301c` sur `#cfedaa` | — | 10,79 | ✓ |
| Orange `#f5ae70`, jaune `#f0d477`, vert `#cfedaa` | `#181b1c` | 9,21 / 11,87 / 13,48 | ✓ |
| Rouge `#ff9797` | `#181b1c` | 8,35 | ✓ |
| Badge erreur `#efa392` | `#34251f` | 7,22 | ✓ |
| Note de source `#bcb29d` | `#25231e` | 7,47 | ✓ |

**Thème clair** :

| Couleur / usage | Fond | Ratio | Verdict |
|---|---:|---:|---|
| Axes de graphique `#9da89b` (fill **codé en dur**, `renderer/app.js:203`) | `#ffffff` | **2,47** | ✗ AA (et cohérence de thème : la valeur reste grise sombre alors que le reste passe en clair) |
| `.nav-label` `#637569` | `#eaf0e9` | **4,24** | ✗ AA |
| Placeholder `#75847a` | `#ffffff` | **3,93** | ✗ AA |
| Vert atténué `#74a584` | `#ffffff` | **2,82** | ✗ AA |
| Orange atténué `#ca8f66` | `#ffffff` | **2,75** | ✗ AA |
| Rouge atténué `#ca7c80` | `#ffffff` | **3,13** | ✗ AA |
| `--muted` `#647369` | `#f2f5f0` | 4,55 | ✓ limite |
| Primaire blanc sur `#326b3e` | — | 6,35 | ✓ |
| Orange `#ae5314` / jaune `#946b08` / vert `#297441` | `#ffffff` | 5,19 / 4,81 / 5,72 | ✓ |
| Badges clair | — | 5,12–6,22 | ✓ |
| Info/source/erreur expirée | — | 6,00–7,57 | ✓ |

**Lecture :** le thème sombre est bien meilleur que le thème clair ; les principaux échecs sont des **textes secondaires** (surtout en clair), les **placeholders**, et **toutes les données atténuées** — c'est-à-dire précisément les relevés en retard, dont la lecture est critique. Le graphique d'historique clair est le cas le plus grave (2,47:1) car la couleur est en dur dans le JS.

### 3.2 Focus visible et navigation clavier

Points forts :

- `:focus-visible` défini pour `button`, `input`, `select`, `textarea` avec `outline:2px solid var(--accent)` et `outline-offset:4px` (`renderer/styles.css:1`) ; contraste indicateur/fond élevé dans les deux thèmes (14,6:1 sombre, ~7,4:1 clair) ; `card-open:focus-visible` dédié (`renderer/styles.css:1`).
- Toutes les actions sont des `<button>` (activation Entrée/Espace native), les `<details>` sont utilisables au clavier, le dialogue `showModal()` piège le focus et Échap le ferme (`renderer/index.html:22`, `renderer/app.js:288`), les onglets de fiche sont des boutons (`:329`).
- Pas de `tabindex` positif, pas de focus piégé hors dialogue.

Faiblesses :

| # | Constat | Preuve |
|---|---|---|
| A1 | **Focus perdu à chaque rendu complet** : clic nav/filtre/favori/sync, mise à jour d'état, re-rendu 60 s → l'élément focalisé disparaît ; aucun `focus()` de restauration. | `renderer/app.js:60,377-383,425,429` |
| A2 | **Changement d'onglet de fiche = focus perdu** : `renderDialog` remplace `innerHTML` (le bouton d'onglet cliqué n'existe plus). | `renderer/app.js:380,329` |
| A3 | **Changement de filtre historique = focus perdu** : `<select>` déclenche `render()` complet. | `renderer/app.js:386,53-60` |
| A4 | **Pas de lien d'évitement** (« Aller au contenu »), sidebar fixe de 5 entrées à retraverser. | `renderer/app.js:60` |
| A5 | **Pas de raccourcis clavier documentés** (le menu Electron fournit Ctrl+±/Ctrl+0, mais aucun écran d'aide). | `main.cjs:654` (menu par défaut) |
| A6 | Second `<nav>` (Réglages) **sans `aria-label`** : deux navigations, une seule nommée. | `renderer/app.js:60` |
| A7 | Dialogue : onglets **sans `role="tablist"`/`aria-selected`/`aria-controls`** ; l'état actif est visuel (`.active`). | `renderer/app.js:329`, `renderer/styles.css:1` |
| A8 | `aria-busy` seulement sur le bouton sync du widget ; le bouton principal est simplement désactivé avec un libellé qui change. | `renderer/app.js:63` vs `renderer/app.js:281` |
| A9 | Aucune annonce live lors du filtrage/recherche ou du rafraîchissement (seul le toast est `aria-live`). | `renderer/app.js:385-386`, `renderer/index.html:23` |
| A10 | `title` inaccessibles au survol (pointer-events) et non exposés au clavier. | `renderer/styles.css:1`, `renderer/app.js:136,162` |

### 3.3 ARIA et sémantique

Points corrects : `aria-current="page"` sur la nav active (`renderer/app.js:52`), `aria-pressed` sur les filtres et favoris (`:72,178`), `aria-label` sur la recherche, les selects d'historique et le dialogue (`:72,213,22`), `role="meter"` avec `aria-valuenow/min/max` sur les jauges de quota (`:162`), `role="img"` + `aria-label` sur le graphique (`:203`), `role="status"`/`aria-live` sur les toasts et messages de progression (`renderer/index.html:23`, `renderer/app.js:294,321,323`), `aria-hidden` sur les SVG décoratifs (`renderer/app.js:19`).

Anomalies :

| # | Constat | Preuve | Sévérité |
|---|---|---|---|
| AR1 | `aria-label` sur le bouton `.quick-strategy` **remplace** le contenu visible : le modèle recommandé, le fournisseur, la raison et le « Puis … » ne sont plus exposés aux AT (le nom accessible devient « Ouvrir le classement des abonnements »). | `renderer/strategy-ui.js:16` | Majeur |
| AR2 | Boutons de la barre « API disponibles » du widget : nom accessible = **le montant seul** (« 12,50 $US ») ; le fournisseur n'existe que dans `title` (non fiable comme nom accessible) et le logo a `alt=""`. | `renderer/strategy-ui.js:16`, `renderer/app.js:34` | Majeur |
| AR3 | `aria-label` posé sur des `<span>` génériques (`.quick-quota`) : nommage interdit sur `role=generic`, support AT incohérent ; l'information « quota restant » de la jauge n'est portée que par le texte visible. | `renderer/app.js:242` | Mineur |
| AR4 | `role="meter"` sans `aria-valuenow` quand la valeur est inconnue (seulement `aria-valuetext`), alors que `aria-valuenow` est requis pour ce rôle. | `renderer/app.js:162` | Mineur |
| AR5 | Ligne de widget = un unique `<button>` dont le nom accessible est la concaténation de tous les quotas/dates (très verbeux) ; `<h3>` et `<div>` à l'intérieur d'un `button` (HTML invalide). | `renderer/app.js:250,260` | Mineur |
| AR6 | SVG des graphiques : points avec `<title>` non accessibles au clavier ; `aria-label` global donne seulement début/fin. | `renderer/app.js:203` | Mineur |
| AR7 | La plupart des informations d'état (niveau de ressource, fraîcheur) ne sont **pas** dans le nom accessible : atténuation visuelle et couleur seulement. | `renderer/app.js:136-137`, `renderer/styles.css:38,49` | Majeur |
| AR8 | `alt=""` sur les logos est correct dans les cartes/tableaux (nom adjacent), mais **incorrect** dans les boutons API du widget où le logo est la seule identification du fournisseur (cf. AR2). | `renderer/app.js:34` | Mineur |

### 3.4 Zoom, redimensionnement, reflow

- Fenêtre principale : `minWidth: 900`, `minHeight: 680` (`main.cjs:654`) ; grille `cards` 3→2 colonnes à ≤ 1100 px, 1 colonne seulement en dessous de 760 px, et **la sidebar est masquée à ≤ 760 px sans remplacement** (`renderer/styles.css:1`).
- À 100 %, le seuil n'est jamais atteint (900 > 760). Mais au **zoom navigateur 125 %** (Chromium : `Ctrl++`, accélérateurs du menu par défaut toujours actifs), la largeur CSS tombe à 720 px → **la navigation disparaît** et il n'existe ni menu hamburger ni barre d'onglets de secours : l'utilisateur est bloqué sur la page courante.
  - Le zoom est un besoin fréquent (basse vision, écrans 1080p) ; ce défaut est **bloquant** pour l'accessibilité, d'autant que le texte de base est petit (§ 3.7).
- Le dialogue a `max-width:95vw` (`renderer/styles.css:1`) mais les formulaires restent en 2 colonnes jusqu'à 480 px (règle seulement sur `.strategy-settings`, `renderer/strategy.css:1`) : à fort zoom, champs et dialogues deviennent étroits ; pas de test `prefers-reduced-motion`-like pour le zoom.
- Widget : largeur fixe 400 px (`main.cjs:659`), non redimensionnable, `overflow:auto` sur `.quick-list` (`renderer/styles.css:1`) ; à 200 % de zoom, les lignes de quota 4 colonnes (`.quick-api-providers` en `repeat(4,…)` `renderer/strategy.css:4`) deviennent illisibles.
- Absence de `@media (forced-colors: active)` : en mode Contraste élevé Windows, les fonds personnalisés (`.primary`, cartes `resource-empty`, jauges par `background`) peuvent être réécrits sans équivalent lisible ; les jauges reposant uniquement sur une barre de couleur deviennent invisibles.

### 3.5 `prefers-reduced-motion`, thème et préférences système

- `@media (prefers-reduced-motion:reduce){*{transition:none!important}}` (`renderer/styles.css:1`) : ✓ les seules animations sont des `transition` (toast, boutons) et elles sont coupées. **Bon point à conserver.**
- Aucune animation de type `keyframes`, pas de `smooth scroll`, pas de carrousel : rien d'autre à neutraliser.
- Pas de `prefers-color-scheme` (défaut clair imposé) ni de `prefers-contrast` ; pas de réglage « thème système ».
- Le thème est appliqué au tableau de bord **et** au widget, et le fond natif suit (voir § 2.6).

### 3.6 Textes alternatifs des logos

- `logo()` produit soit `<img src="../assets/providers/…" alt="">` (décoratif), soit le monogramme échappé (`renderer/app.js:34`). Les 10 logos existent bien (`assets/providers/` : 10 fichiers + `sources.json`) et sont embarqués (pas de téléchargement, `docs/architecture.md:41`).
- `alt=""` est le bon choix là où le nom du fournisseur est du texte adjacent (cartes `h3`, tableaux, `dialog-head`, liste stratégie). Il devient un défaut dans les boutons compacts du widget où seule l'image + un montant sont présents (cf. AR2) : il faudrait `aria-label` explicite sur le bouton ou un nom fournisseur visible/`sr-only`.
- Provenance : `assets/providers/sources.json:1-12` ne liste que des URL, sans licence d'utilisation ni mention de marque ; correct pour la traçabilité, insuffisant pour une redistribution publique (voir § 5).

### 3.7 Couleur seule et tailles de texte

- Les **niveaux de ressource** sont encodés uniquement par la couleur : orange/jaune/vert/rouge (`lib/resource-levels.js:6-14`) ; le texte visible n'indique le niveau que dans les cas extrêmes (`.resource-status` « Limite atteinte », `renderer/app.js:140-155`). La légende n'existe que dans **Réglages** (`renderer/app.js:156`, rendue `:237`) — pas sur Vue d'ensemble, pas dans le widget. Pour un daltonien (deutéranopie) et pour tout utilisateur pressé, la différence orange/jaune/vert est faible ; piste : afficher « ≤ 10 % » / « ≤ 25 % », une icône, ou un motif de jauge.
- Le **widget** n'affiche aucun libellé de niveau ; l'information critique est donc portée par la couleur et la petite barre.
- **Tailles** : `.quick-columns` 8 px, `.quick-period-status` 8 px, badges 9 px, `.quick-quota strong` 10 px (widget), textes de note 10 px, `.quick-group-label` 9 px (`renderer/styles.css:1,8,59-61`, `renderer/strategy.css:3-4`). Le widget est une surface de lecture rapide : 8–10 px est trop petit, surtout avec une mise à l'échelle Windows à 100 % sur un écran 1080p. Recommandation : plancher de 11–12 px, 12–13 px pour les surfaces secondaires, et vérifier au zoom 125/150 %.

### 3.8 Synthèse de conformité WCAG

| Critère | Statut | Preuve principale |
|---|---|---|
| 1.4.1 Utilisation de la couleur | ✗ | niveaux uniquement colorés (§ 3.7, `renderer/app.js:136-156`) |
| 1.4.3 Contraste (minimum) | ✗ | § 3.1 (axes graphique 2,47, dimming 2,7–3,1, placeholders 3,9, labels 3,6–4,2) |
| 1.4.4 / 1.4.10 Redimensionnement & reflow | ✗ | sidebar masquée sans alternative au zoom (`renderer/styles.css:1`, `main.cjs:654`) |
| 2.1.1 Clavier | ~ | tout est bouton, mais focus perdu (A1–A3) |
| 2.4.1 Évitement des blocs | ✗ | pas de lien d'évitement |
| 2.4.3 Ordre du focus | ~ | ordre DOM correct, mais focus perdu à chaque re-rendu |
| 2.4.7 Focus visible | ✓ | `:focus-visible` net, contrasté |
| 2.5.5 Taille de la cible | ~ | la plupart ≥ 24 px, `.icon-button` 30 px ✓ ; liens de navigation 12 px de texte mais padding 12 px ✓ |
| 3.1.1 Langue | ✓ | `<html lang="fr">` |
| 3.3.1 / 3.3.2 Erreurs et libellés | ✓ | labels associés, `role=alert`, messages explicites |
| 4.1.2 Nom, rôle, valeur | ✗ | AR1/AR2/AR3/AR4/AR5 |
| 4.1.3 Messages de statut | ~ | toast `aria-live` ✓ ; mises à jour de quota non annoncées |
| prefers-reduced-motion | ✓ | `renderer/styles.css:1` |

**Conclusion accessibilité :** l'application n'atteint pas WCAG 2.1 AA, principalement à cause des contrastes clairs/diminués, de la couleur seule, du focus perdu et de la navigation au zoom. Ce sont des correctifs ciblés et peu risqués (les fondations `:focus-visible`, `reduced-motion`, `dialog`, `aria-live` sont déjà là).

---

## 4. Findings classés

Définitions : **Bloquant** = empêche un usage public/accessible sans contournement ; **Majeur** = gêne réelle, non-conformité ou promesse trompeuse ; **Mineur** = finition, dette, cohérence.

### 4.1 Bloquants

| ID | Finding | Preuve | Impact | Recommandation |
|---|---|---|---|---|
| B-01 | **Aucune licence ni politique de confidentialité** ; `package.json` est `"private": true` ; pas de `LICENSE`, `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md` à la racine | `package.json:4` ; racine du dépôt ; `dist/*/LICENSE` = licence Electron, pas celle du produit | Distribution publique juridiquement impossible ; aucun moyen pour un utilisateur de savoir ce qu'il peut faire du logiciel ni comment ses données sont traitées | Choisir une licence (MIT/AGPL/commercial), ajouter `LICENSE`, `PRIVACY.md` (données locales, aucun envoi, aucun compte cloud, fournisseurs contactés), `SECURITY.md` (contact, périmètre) |
| B-02 | **Navigation impossible au zoom ≥ 125 %** : la sidebar disparaît à ≤ 760 px CSS et la fenêtre ne peut pas descendre sous 900 px | `renderer/styles.css:1` (`@media(max-width:760px){.sidebar{display:none}}`) ; `main.cjs:654` (`minWidth:900`) ; zoom via menu Electron par défaut | Les utilisateurs qui agrandissent le texte (basse vision) perdent l'accès aux pages Abonnements/Historique/Connexions/Réglages | Garder la sidebar visible jusqu'à ~600 px ou ajouter une barre de navigation horizontale/compacte sous 900 px ; test zoom 125/150/200 % |

### 4.2 Majeurs

| ID | Finding | Preuve | Impact | Recommandation |
|---|---|---|---|---|
| M-01 | **Contrastes AA insuffisants** (axes graphique 2,47 en clair, labels 3,62–4,24, placeholders 3,93–3,95, bottom-note 4,12) | § 3.1 ; `renderer/app.js:203` (`fill="#9da89b"` en dur) ; `renderer/styles.css:1` ; `renderer/theme.css:22` | Non-conformité WCAG 1.4.3 ; lisibilité dégradée, surtout pour le graphique d'historique clair | Utiliser `var(--muted)`/une variable `--chart-axis` dans le SVG, assombrir `#69716e`, `#637569`, `#75847a` ; viser ≥ 4,5:1 ; ajouter un test de contraste (axe-core ou test unitaire sur les tokens) |
| M-02 | **Données atténuées sous le seuil AA** : `opacity:.65` applique 2,75–3,13 en clair sur les valeurs de quota et 3,23–4,26 en sombre | `renderer/styles.css:49` ; § 3.1 | Le relevé en retard — dont la lecture est cruciale — est le moins lisible | Remplacer l'opacité par un style à contraste préservé (bordure pointillée, badge « Relevé ancien » visible, italique) et réserver l'atténuation aux éléments décoratifs |
| M-03 | **Focus perdu à chaque rendu** (nav, filtres, favoris, sync, état IPC, intervalle 60 s ; onglets du dialogue) | `renderer/app.js:60,377-383,425,429`, `:380,329` ; § 2.3 | Navigation clavier et lecteur d'écran instables ; l'utilisateur doit re-tabuler en permanence | Rendu incrémental par page/zone, `focus()` restauré après re-rendu (mémoriser `activeElement` et son `data-*`), ou `replaceChildren` ciblé ; tests clavier |
| M-04 | **Information portée par la couleur seule** (niveaux orange/jaune/vert/rouge, fraîcheur) ; légende seulement en Réglages | `lib/resource-levels.js:6-14`, `renderer/app.js:136-156,140-155` ; `renderer/styles.css:38` | WCAG 1.4.1 ; daltoniens et utilisateurs pressés ne peuvent pas distinguer ≤ 10 % / ≤ 25 % | Ajouter un libellé textuel court (« ≤ 10 % », « ≤ 25 % », « épuisé ») ou des icônes/motifs ; afficher la légende sur Vue d'ensemble et dans le widget |
| M-05 | **ARIA qui masque du contenu** : `aria-label` du bouton stratégie du widget cache modèle/fournisseur/raison ; boutons API sans nom de fournisseur | `renderer/strategy-ui.js:16` ; § 3.3 AR1/AR2 | Les utilisateurs d'AT n'obtiennent pas la recommandation principale du widget | Mettre l'information dans le contenu du bouton, `aria-label` descriptif court + texte lisible, `aria-labelledby`/`sr-only` pour le fournisseur ; logo `alt=""` seulement si nom textuel |
| M-06 | **Le widget ne montre pas la fraîcheur alors que le README la promet** | `README.md:3` ; `renderer/app.js:247-261,278-285` (aucun `age`) | Promesse non tenue ; l'utilisateur ne sait pas si un quota est vieux de 2 min ou de 3 h (hors atténuation) | Ajouter « il y a X min » ou un badge « Relevé ancien » dans `quickAccountRow`, ou corriger le README |
| M-07 | **Statistique « Actualisation automatique toutes les 5 min » toujours affichée**, même si `autoRefresh` est désactivé, et fausse pour Claude (1 min) | `renderer/app.js:70` ; `main.cjs:49-54,686` ; `renderer/app.js:237` | Fausse information produit ; l'utilisateur croit que les données se rafraîchissent alors que non | Afficher l'état réel (`settings.autoRefresh ? 'toutes les 5 min · Claude chaque minute' : 'désactivée'`), avec lien vers Réglages |
| M-08 | **Version obsolète dans l'UI** : « Version 0.1.0 » en Réglages ; RPC Codex annonce `0.1.0` | `renderer/app.js:237` ; `lib/openai-account.cjs:51` ; `package.json:3`, `README.md:5`, `CHANGELOG.md:3` | Perte de confiance, support impossible (version affichée fausse) ; identité client incohérente côté OpenAI | Exposer `app.getVersion()` via preload (`versions`), l'afficher dans Réglages/À propos, et utiliser la même version pour `clientInfo` |
| M-09 | **Documentation d'ordre de consommation périmée** : « Antigravity possède deux groupes » et table de priorités sans Argon | `docs/ordre-consommation.md:45,25-32` vs `lib/quota-resets.js:12`, `lib/usage-strategy.js:29`, `docs/architecture.md:61`, `README.md:27` | Un lecteur configure mal sa stratégie (Argon absent des priorités) | Mettre à jour le tableau (3 réserves), mentionner `quality:null` d'Argon et sa règle de classement |
| M-10 | **Typographie 8–10 px** sur les surfaces denses (widget, notes) | `renderer/styles.css:1,8,59-61`, `renderer/strategy.css:3-4` | Lisibilité, fatigue visuelle, accessibilité (taille non paramétrable) | Plancher 11–12 px ; agrandir le widget ou permettre une taille de police ; revoir les tailles en priorité sur le widget |
| M-11 | **Marque personnelle codée en dur** : « L'atelier de Lasme » / « Atelier de Lasme » / avatar « L » dans le tableau de bord | `renderer/app.js:60` | Inutilisable tel quel pour un autre utilisateur/public ; fuite d'identité dans les captures | Rendre le nom d'espace optionnel, par défaut neutre (« Mon espace »), ou le supprimer |
| M-12 | **Aucune action « effacer mes données »** dans l'UI (export seulement) ; la restauration est explicitement absente | `renderer/app.js:237` (export seul) ; `README.md:79` ; `main.cjs` (aucun handler de suppression globale) | Pour un produit local qui se veut privé, l'utilisateur ne peut pas exercer simplement son droit à l'effacement ; risque RGPD | Ajouter « Effacer toutes mes données » (double confirmation, suppression `state.json`/`credentials.json`/profils) et le documenter |
| M-13 | **Pas de mise à jour pour un non-développeur** : seules les commandes `npm run package`/`update:portable` (qui exigent Node, `npm`, un port de diagnostic) | `README.md:108-120` ; `scripts/update-portable.cjs` ; `scripts/package.cjs` | Un utilisateur public ne peut pas se mettre à jour ; risque de rester sur une version cassée | Décider : auto-update (electron-updater + signature) ou ZIP de mise à jour documenté avec sauvegarde de `data/` ; publier notes de version |

### 4.3 Mineurs

| ID | Finding | Preuve | Recommandation |
|---|---|---|---|
| m-01 | « ↻ Date non fournie » répété par fenêtre (jusqu'à 5 fois sur Antigravity) en carte et widget | `renderer/reset-ui.js:3` ; `renderer/app.js:162,245` | Afficher une seule mention par groupe, ou rien si aucune date |
| m-02 | Typo README « Lancer **Lancer** ProvidersBar.cmd » | `README.md:9` | Corriger |
| m-03 | Le lanceur `.cmd` cible le portable **personnel** (`dist\ProvidersBar-win32-x64`) et n'existe pas dans la distribution propre ; pas de README à côté de l'exe | `Lancer ProvidersBar.cmd` ; `scripts/app-resources.cjs:19-20` ; `dist/ProvidersBar-0.2.1-win32-x64/` (inventaire) | Documenter clairement les deux modes, ajouter un `LISEZ-MOI.txt` dans la distribution |
| m-04 | « Puis **Puis** » dans README ; « Puis » n'existe que dans le widget, pas dans le panneau | `README.md:67` ; `renderer/strategy-ui.js:12,16` | Reformuler (« Utilise maintenant, puis les suivants ») ou aligner l'UI |
| m-05 | Devise des seuils incohérente dans la rédaction (« 2 USD » README vs « 2 $ » UI vs « $US » Intl) | `README.md:18,79` ; `renderer/app.js:156` ; `renderer/styles.css` | Choisir « USD » partout (ou « $US ») et l'appliquer dans README/UI |
| m-06 | Notifications Windows non documentées (3 jours, 20 %, seuil USD, fraîcheur < 10 min, une alerte/jour/provier) et texte « quota inférieur à 20 % » pour un test `<= 20` | `README.md:14` ; `renderer/app.js:237` ; `main.cjs:180-196` | Ajouter une section « Notifications » au README ; corriger « inférieur ou égal à » |
| m-07 | Le watcher Claude Desktop dépend aussi de `autoRefresh`, non dit dans le README | `README.md:55` vs `main.cjs:669` | Le préciser (ou rendre la détection indépendante) |
| m-08 | `docs/ordre-consommation.md` se contredit sur le cache écrit (règle 5 vs § final) | `docs/ordre-consommation.md:86` vs `:90` ; `lib/usage-strategy.js:31,134` | Aligner la règle 5 sur l'implémentation (cache lu seulement) |
| m-09 | Contributor : le doc parle de « liste séparée des API disponibles » alors que la section liste des fournisseurs, pas des routes | `docs/ordre-consommation.md:72` ; `lib/usage-strategy.js:165-169` | Reformuler (« n'influence que l'estimation des routes quand l'accord est donné ») |
| m-10 | Catalogue : `checkedAt` 12/09/2026 antérieur à Opus 5.5 (22/09) et Argon (octobre) ; `pricesOld` calculé mais jamais affiché ; date visible seulement en Réglages | `lib/usage-strategy.js:8,14,174` ; `docs/ordre-consommation.md:36` ; `renderer/strategy-ui.js:20` | Afficher « Catalogue du … · à vérifier » sur le panneau stratégie si `pricesOld`, mettre à jour `checkedAt`, documenter les ajouts |
| m-11 | Historique : « Jusqu'à 5 000 relevés conservés » mais seulement 200 affichés, sans pagination ni export partiel | `renderer/app.js:213` ; `main.cjs:172` | Ajouter pagination/recherche, ou mentionner clairement la limite |
| m-12 | Pas de `prefers-color-scheme` : défaut clair même sur Windows sombre ; pas d'option « Système » | `renderer/theme-init.js:4` ; `renderer/index.html:2` ; `lib/seed.cjs:24` | Ajouter l'option « Système » (trois valeurs) |
| m-13 | Échecs de thème clair « ad hoc » : la couleur d'axe du graphique est en dur, plusieurs `#hex` sombres sont surchargés ligne par ligne | `renderer/app.js:203` ; `renderer/theme.css:15-67` ; `renderer/strategy.css:1` | Utiliser exclusivement des variables sémantiques ; test visuel des deux thèmes (déjà partiellement couvert par `scripts/smoke-resource-status.cjs:33-34`) |
| m-14 | Billing/`currency` non normalisés pour d'anciens inventaires : `billingCycle` absent → « undefined » à l'écran ; `currency` absente + `amount` → `RangeError` dans `money()` | `renderer/app.js:187,21,173` ; `lib/migrations.cjs:72-82` (aucune normalisation) | Migration de normalisation (valeurs par défaut `unknown`/`USD`) et garde-fous de rendu |
| m-15 | CSS/JS morts : sélecteurs `.quick-row-expired`, `.quick-expired`, `.meter.low` ; `manual-list` vide ; `pricesOld` inutilisé | `renderer/styles.css:8,31-32` ; `renderer/app.js:192` ; `lib/usage-strategy.js:174` | Supprimer ou brancher |
| m-16 | HTML invalide : `<button>` contenant `<div>/<h3>` dans le widget | `renderer/app.js:250,260` | Restructurer |
| m-17 | Menu Electron par défaut anglais (Alt), avec DevTools/zoom, sans « À propos » ni version | `main.cjs:654` (aucun `Menu.setApplicationMenu`) | Menu personnalisé FR avec À propos/version/aide/raccourcis |
| m-18 | Pas de restauration de taille/position de fenêtre | `main.cjs:654` | Persister les bornes |
| m-19 | Pas d'annonce live lors du filtrage/recherche/rafraîchissement ; erreur de démarrage sans action | `renderer/app.js:385-386,429` | Région `aria-live` pour les résultats/erreurs, bouton Réessayer |
| m-20 | Second `<nav>` sans nom ; onglets de fiche sans sémantique d'onglets ; `aria-valuenow` absent sur meter inconnu | `renderer/app.js:60,329,162` | Compléter ARIA (ou convertir les onglets en boutons simples assumés) |
| m-21 | README ne documente pas les cas où l'atténuation s'applique (erreur, API déconnectée) | `README.md:18` vs `renderer/app.js:137` | Compléter la phrase |
| m-22 | CHANGELOG sans entrée 0.1.0 ; pas de doc de validation 0.2.1 alors que le README la cite indirectement | `CHANGELOG.md:3-18` ; `docs/validation-0.2.0.md` | Ajouter l'entrée 0.1.0 (ou décider qu'elle n'a pas existé) et un `docs/validation-0.2.1.md` |
| m-23 | `sources.json` ne contient que des URL : pas de licence/marque, pas de date de collecte | `assets/providers/sources.json:1-12` ; `README.md:134` | Ajouter licence/marque/date et une note sur la redistribution des logos |
| m-24 | README mélange guide utilisateur et guide développeur (lancement, npm, diagnostic) | `README.md:7-16,83-122` | Séparer `GUIDE-UTILISATEUR.md` (installation, mise à jour, sauvegarde, SmartScreen) et garder le README technique |

---

## 5. Écarts documentaires — vue d'ensemble

### 5.1 README

| Élément | État |
|---|---|
| Promesses vérifiées | seuils de couleur, fraîcheur > 10 min, priorités de dates, 10 fournisseurs, export 5 000, dates de reset, recommandations restreintes, API séparées, commandes npm, aperçu, rapport sans secrets, distribution, non-signature assumée |
| Écarts nets | fraîcheur du widget (M-06), « 5 min » figé (M-07), typo « Lancer Lancer » (m-02), lanceur personnel vs distribution (m-03), « puis Puis » (m-04), notifications non documentées (m-06), watcher Claude conditionné à `autoRefresh` (m-07), README mixte utilisateur/développeur (m-24) |
| Précisions à ajouter | cas d'atténuation (erreur/déconnecté), absence de préférence système, absence de restauration, comportement de l'export (identifiant pseudonyme OpenAI), limite d'affichage de l'historique (200), stabilité des interfaces fournisseurs |

### 5.2 docs/architecture.md

Document solide et précis ; vérifié sur 13 points (modules, cycle de vie, thèmes, aperçu, resets, recommandations, Argon, Claude). Une seule divergence détectée, externe au fichier : `docs/architecture.md:61` dit trois réserves, ce qui **contredit** `docs/ordre-consommation.md:45` (deux groupes). La version de Claude Code (2.1.285) est une hypothèse opérationnelle (`lib/claude-connection.cjs:48`), correctement présentée comme telle mais fragile dans le temps.

### 5.3 docs/ordre-consommation.md

- Périmé sur Argon (M-09) et sur la cohérence cache écrit (m-08).
- Table des tarifs et scores vérifiée ligne à ligne contre `lib/usage-strategy.js` : cohérente (GLM Flash OrcaRouter 0,075/0,25 ; Qwen 0,15/0,47 ; DeepSeek 0,15/0,60 et 0,30/1,20 en heures pleines ; Luna 0,20/1,20 ; Gemini 0,75/3,75 ; Muse 1,25/4,25 ; RunInfra 0,10/0,40 ; heures pleines 01–04/06–10 UTC ; promotion Gemini jusqu'au 31/12/2026). C'est le document le plus technique et le mieux aligné sur le code.
- Nuance : « deux groupes à suivre » et « Antigravity possède deux groupes » sont les seules affirmations fausses depuis 0.2.0.

### 5.4 docs/maintenance.md et docs/validation-0.2.0.md

- `maintenance.md` est cohérent (commandes, fixtures, verrous Claude, diagnostic, packaging). Il documente la correction Grok 0.2.1 (`docs/maintenance.md:55`) alors qu'il n'y a pas de `validation-0.2.1.md`.
- `validation-0.2.0.md` annonce « 133 tests unitaires » ; le décompte statique actuel est de 132 sites `test(` dont des tests générés en boucle. Le chiffre exact ne peut être confirmé que par `npm test` (couvert par `task-3`) ; à défaut, le document devrait préciser la commande et la date pour être reproductible. Il ne couvre pas 0.2.1, alors que le README et le CHANGELOG mentionnent des vérifications réelles 0.2.1.

### 5.5 CHANGELOG

Exact sur 0.2.0/0.2.1 (voir § 1.3), lacunaire sur 0.1.0. Aucune mention d'un changement utilisateur de 0.2.1 autre que Grok, ce qui est cohérent avec le contenu du commit. Les trois documents (README version, CHANGELOG, package.json) sont alignés sur **0.2.1**, seule l'UI est restée à 0.1.0.

---

## 6. Rédaction française

### 6.1 Typos et fautes certaines

| Réf. | Texte | Correction |
|---|---|---|
| `README.md:9` | « Lancer **Lancer ProvidersBar.cmd** » | « Lancer **ProvidersBar.cmd** » |
| `renderer/app.js:192` | « Les connexions API lisent les crédits ; **Les** autres fournisseurs… » | minuscule après point-virgule |
| `renderer/app.js:213` | « Connecte **un de tes** comptes API » | « l'un de tes comptes » |
| `README.md:67` | « **Utilise maintenant**, puis **Puis**, proposent… » | « **Utilise maintenant**, puis la liste **Puis**, proposent… » ou reformuler |
| `README.md:18` | « Les couleurs passent du rouge à zéro à l'orange… » | « Les couleurs passent du rouge (0) à l'orange (≤ 10 % ou 2 USD), au jaune… » |
| `renderer/app.js:172` | « Usage de démarrage mensuel · 1 requête simultanée · limite chiffrée non disponible » | clarifier (« usage mensuel inclus ; une requête à la fois ; limite non communiquée ») |
| `renderer/app.js:70` | « Comptes connectés X / N **disponibles** » | préciser « connectables » |

### 6.2 Incohérences terminologiques

| Terme | Emplois observés | Problème | Recommandation |
|---|---|---|---|
| quota / limite / fenêtre | « Quotas restants » (carte), « Limite atteinte », « 5 h / Hebdo », « fenêtre » (docs), « compteur » (maintenance) | quatre mots pour la même notion selon les surfaces | glossaire : quota = enveloppe d'un fournisseur ; fenêtre = période (5 h, semaine) ; limite = valeur d'une fenêtre ; bannir « compteur » ou le définir |
| réserve | « Réserve supplémentaire » Ollama (`renderer/app.js:139,321`), « réserves Antigravity » (`README.md:67`), « Réserves des abonnements actifs » (`renderer/strategy-ui.js:12`), « réserve(s) à vérifier » (`renderer/strategy-ui.js:12`) | le même mot désigne un solde de crédits, un groupe de fenêtres et un bucket de stratégie | réserver « réserve » aux crédits achetés (Ollama) et parler de « groupe de quotas » pour Antigravity/buckets |
| forfait / abonnement / plan / offre | « forfait expiré », « abonnement expiré », « Offre / formule », « plan », « Claude Pro » | distinction implicite entre entité suivie et palier commercial | définir : abonnement = entité suivie ; forfait = palier ; offre/formule = libellé du formulaire (« Nom du palier ») |
| providers | « Mes providers » (UI, deux occurrences), « providers » dans docs/code ; « fournisseurs » ailleurs | anglicisme visible dans l'UI française | « Mes fournisseurs » partout (UI, aria-label, README) |
| Reset / réinitialisation | « Reset dans 3 h », « Reset passé », « Prochain reset », « réinitialisation » (UI et docs) | mélange anglais/français | « réinitialisation » partout ; « Reset » réservé au code |
| Semaine / Hebdo / hebdomadaire | « Semaine » (badge), « Hebdo » (carte), « hebdomadaire » (docs/notifications) | trois formes | « Semaine » ou « Hebdo » mais une seule, et définir dans le glossaire |
| 5 heures / 5 h | « 5 heures » (données), « 5 h » (carte) | abréviation non homogène | « 5 h » dans les libellés courts, « 5 heures » dans les phrases |
| USD / $ / $US | README « 2 USD » ; UI « 2 $ » ; Intl « 12,50 $US » ; widget « 0 $/mo » | trois écritures | « USD » dans les textes, formatage monétaire `Intl` pour les montants (déjà le cas) |
| API / accès API | « Accès API », « API à la consommation », « services » | flou | « accès API » pour l'entité, « API » pour la section |
| Free / Pro / Max | « Free · 0 $/mo », « Forfait expiré · Free » | noms officiels, OK, mais mélangés à des traductions | conserver les noms officiels et les expliquer une fois |

### 6.3 Jargon et messages

- **Messages d'erreur fournisseur** : globalement bons et actionnables (« La clé enregistrée ne peut plus être déchiffrée sur ce compte Windows… » `main.cjs:215`, « Indique une prochaine échéance future pour activer le forfait. » `main.cjs:498`). Points à polir : « Réponse du fournisseur incomplète ou invalide. » (correct mais sec), « Quota incomplet · vérifier les limites » et « Fenêtres de quota manquantes » (`lib/usage-strategy.js:115,121`) sont techniques pour un utilisateur final ; « Le navigateur dédié s'est arrêté avant la vérification… » (`lib/account-browser.cjs:94`) est clair.
- **Traduction d'erreurs IPC** : préfixe Electron nettoyé (`renderer/app.js:383`) ; bon réflexe.
- **Ton éditorial** : le « tu » est cohérent dans l'UI (« Tes usages », « Connecte tes comptes ») ; le README est au « tu » implicite/infinitif ; cohérent, à garder. Le mélange « Tes clés restent chiffrées » (UI) et « Les clés sont chiffrées… » (README) est acceptable.
- **Chiffres et dates** : `fr-FR` partout (dates, monnaies) ; cohérent. Les échéances affichent « Puis 19,99 € » (`renderer/app.js:187`) — « Puis » est correct mais « À partir du … » serait plus clair avec `priceChangeDate` non affichée dans le tableau.

---

## 7. Ventes / positionnement : ce qui manque pour un usage public

### 7.1 Ce que l'application promet (et tient)

- Suivi local et privé de 10 fournisseurs, quotas restants, crédits, abonnements, historique, dates de reset, recommandations d'ordre d'usage ; widget dans la zone de notification ; aucune génération payante ; clés chiffrées Windows ; export JSON sans clés ; aucune dépendance à un compte cloud ProvidersBar.
- Positionnement différenciant crédible : **local-first, zéro télémétrie implicite, zéro estimation silencieuse** (README l'affirme : « un format inconnu ne devient jamais une estimation », `README.md:81`).

### 7.2 Manques pour une distribution publique

| Axe | Constat | Réf. | Priorité |
|---|---|---|---|
| Légal / confiance | Pas de licence produit ; `private: true` ; pas de politique de confidentialité, de CGU, de contact sécurité ; logos de marques tierces redistribués sans licence explicite | `package.json:4` ; racine ; `assets/providers/sources.json:1-12` | P0 |
| Signature / SmartScreen | Exécutable non signé, assumé | `README.md:122` | P0 (au moins documenter et publier un hash SHA-256 + notes de version) |
| Mises à jour | Pas d'auto-update ; mise à jour via npm/scripts et port de diagnostic | `README.md:108-120` ; `scripts/update-portable.cjs` | P0/P1 |
| Installation | Portable uniquement ; pas d'installateur, pas de raccourcis menu Démarrer, pas de désinstallation, pas d'autostart | `scripts/package.cjs`, `scripts/app-resources.cjs` | P1 |
| Documentation utilisateur | README mêle utilisateur et développeur ; pas de guide d'installation/mise à jour/sauvegarde/dépannage SmartScreen ; pas de FAQ « pourquoi mon quota est-il ancien ? » | `README.md:7-16,83-122` | P1 |
| Identité | « L'atelier de Lasme » codé en dur ; version affichée fausse ; pas d'écran À propos | `renderer/app.js:60,237` | P1 |
| Internationalisation | Aucune : chaînes françaises en dur dans `app.js`, `strategy-ui.js`, `reset-ui.js`, `main.cjs` ; dates/monnaies `fr-FR` | `renderer/app.js:59-63,237`, `renderer/strategy-ui.js:2-20`, `main.cjs:180-196,594` | P1/Majeur (si cible internationale) |
| Télémétrie | Aucune télémétrie ni crash-report — excellent pour la vie privée, **mais non affirmé explicitement** | `README.md:71-81` (section confidentialité) | P1 : l'écrire noir sur blanc (« aucune télémétrie, aucun analytics, aucun serveur ProvidersBar ») |
| Accessibilité déclarée | Pas de déclaration d'accessibilité, pas de test lecteur d'écran documenté | — | P1/P2 |
| Support | Pas de canal de support, pas de journal exportable pour diagnostic (seul `verify-connections` dev) | `scripts/verify-connections.cjs` | P1 |
| Fiabilité perçue | Dépend de Chrome/Edge et de sites tiers ; formats qui changent ; catalogue daté jamais mis à jour automatiquement ; pas d'indicateur global « dernière synchro réussie » | `README.md:85`, `docs/maintenance.md:13,21` | P2 |
| Catalogue / prix | Date visible seulement en Réglages ; `pricesOld` non affiché ; ajout d'Argon non daté dans le README | `lib/usage-strategy.js:8,174`, `renderer/strategy-ui.js:20` | P2 |
| Marque | Inspiration CodexBar créditée (`README.md:136`) ; nom « ProvidersBar » sans recherche de disponibilité visible ; pas de site ni de page de téléchargement | `README.md:136` | P2 |
| Comptes multi-utilisateurs / roaming | Données locales par utilisateur Windows, pas de synchronisation (choix assumé) | `main.cjs:27-28` | Information à documenter |

### 7.3 Recommandation de séquence de lancement

1. **Pré-lancement (bloquants)** : licence + confidentialité + sécurité ; correction contrastes/focus/zoom ; version dynamique ; suppression de la marque personnelle ; README utilisateur séparé ; décision mise à jour/signature.
2. **Bêta privée** : corrections M-01→M-13 ; tests NVDA/Narrator ; test zoom 125/150/200 % ; test SmartScreen documenté ; « effacer mes données ».
3. **Public** : auto-update signé (ou ZIP de mise à jour documenté), écran À propos, i18n ou positionnement France explicite, déclaration d'accessibilité, page de téléchargement avec hash.

---

## 8. Recommandations priorisées

| Priorité | Action | Fichiers concernés | Effort estimé | Critère d'acceptation |
|---|---|---|---|---|
| **P0** | Corriger les contrastes AA : variable `--chart-axis` (supprimer `fill="#9da89b"`), assombrir `#69716e`/`#637569`/`#75847a`, revoir `opacity:.65` | `renderer/styles.css:1`, `renderer/theme.css:22,75-88`, `renderer/app.js:203` | 0,5 j | Toutes les paires texte/fond ≥ 4,5:1 dans les deux thèmes, y compris valeurs atténuées et placeholders ; ajouter un test de tokens |
| **P0** | Rétablir la navigation au zoom : sidebar/onglets visibles ≥ 600 px, ou menu compact ; tester 125/150/200 % | `renderer/styles.css:1`, `renderer/app.js:60` | 1 j | Toutes les pages atteignables au clavier à 200 % (1 440 px de large) |
| **P0** | Stabiliser le focus : rendu incrémental par page/zone ou restauration d'`activeElement` ; focus explicite dans le dialogue à chaque onglet | `renderer/app.js:53-60,329,380,425,429` | 1–2 j | Parcours clavier complet sans perte de focus (test Playwright clavier) |
| **P0** | Version unique et dynamique : exposer `app.getVersion()` via preload, l'afficher (Réglages + À propos), aligner `clientInfo` Codex | `preload.cjs`, `main.cjs:51`, `renderer/app.js:237` | 0,5 j | UI, package.json et CHANGELOG affichent 0.2.1/0.2.2 ; plus aucune chaîne « 0.1.0 » |
| **P0** | Licence + `PRIVACY.md` + `SECURITY.md` (+ retirer `private:true` ou documenter l'intention) | racine | 0,5 j | Fichiers présents et cohérents avec le README |
| **P1** | Corriger les promesses : fraîcheur du widget, stat « 5 min », typos, « Puis », notifications documentées, `docs/ordre-consommation.md` à 3 réserves, mode de lancement/distribution | `renderer/app.js:70,237,247-261`, `renderer/strategy-ui.js:16`, `README.md`, `docs/ordre-consommation.md` | 1 j | Audit doc↔code repasse au vert sur les 6 écarts nets |
| **P1** | Dédupliquer et modulariser le renderer : composant quotas unique, `FRESHNESS_MS`, extraction des helpers, suppression du HTML invalide | `renderer/app.js`, `renderer/strategy-ui.js`, `renderer/reset-ui.js` | 2–3 j | `app.js` < ~400 lignes avec rendu par zones ; pas de régression visuelle (smoke visuel) |
| **P1** | Qualité d'écriture : glossaire (quota/fenêtre/limite/réserve/forfait/abonnement), « fournisseurs » au lieu de « providers », « réinitialisation » au lieu de « Reset », tailles de police ≥ 11 px | `renderer/app.js`, `renderer/styles.css:1`, `README.md` | 1 j | Revue de texte et captures validées |
| **P1** | Accessibilité ARIA : corriger AR1/AR2 (contenu des boutons widget), role=meter, nav nommée, annonces live, légende de couleurs sur Vue d'ensemble/widget | `renderer/strategy-ui.js:16`, `renderer/app.js:60,162,242`, `renderer/index.html:23` | 1 j | Test NVDA/Narrator des parcours clés ; plus de contenu d'information masqué par `aria-label` |
| **P1** | « Effacer mes données » + assistant de premier lancement minimal | `main.cjs` (handler), `renderer/app.js:237`, `preload.cjs` | 1 j | Suppression complète avec confirmation, testé en smoke |
| **P2** | Menu FR (À propos/version/aide/raccourcis), persistance de fenêtre, restauration de mise à jour pour non-dev (auto-update ou ZIP documenté), écrire « zéro télémétrie » | `main.cjs:654`, `README.md:71-81,108-120` | 2–3 j | Menu localisé, version visible, procédure de mise à jour testée sur un dossier `data/` réel |
| **P2** | i18n (fr/en) ou positionnement France explicite ; catalogue avec date visible + alerte `pricesOld` ; i18n des formats | `renderer/*`, `lib/usage-strategy.js:174`, `renderer/strategy-ui.js:20` | 3–5 j selon choix | Décision documentée ; si France seule, README le dit |
| **P2** | Ménage CSS/JS morts, éliminer les surcharges de thème ad hoc, normaliser les migrations (`billingCycle`/`currency`) | `renderer/styles.css`, `renderer/strategy.css`, `lib/migrations.cjs` | 1 j | Plus de sélecteur/variable morte signalée par un lint CSS ; état ancien sans « undefined » |

---

## 9. Notes détaillées par sous-axe

**Cohérence doc ↔ code : 6,5/10.**
Le README est globalement fiable et honnête ; les seuils, la fraîcheur, les priorités de dates, les recommandations et l'export sont conformes. Les pertes de points viennent de quatre promesses non tenues ou incomplètes (fraîcheur du widget, cadence « 5 min », « Lancer Lancer », notifications non documentées) et d'une doc d'ordre de consommation périmée depuis Argon. Aucune promesse dangereuse (pas de fausse garantie de disponibilité, pas de conversion de devises cachée).

**Qualité du renderer / UI : 5,0/10.**
L'interface est cohérente, les états sont plutôt bien traités, le partage de helpers entre tableau de bord et widget est réel, et la sûreté XSS est défendue par la CSP et `escapeHtml`. Mais la maintenabilité est faible : monolithe à lignes géantes, CSS minifié sur une ligne avec surcharges, duplication des rendus de quotas, état global et rendu complet destructeur, dette de sélecteurs morts. Le tout fonctionne, mais chaque évolution visuelle est risquée.

**Accessibilité : 3,5/10.**
Fondations présentes (focus-visible, reduced-motion, dialogue natif, live region, labels, meters) mais non-conformité AA large : contrastes (surtout clair et données atténuées), couleur seule, focus perdu, navigation au zoom, textes 8–10 px, ARIA qui masque du contenu, HTML invalide. Les correctifs sont ciblés ; aucune refonte n'est nécessaire.

**Rédaction française : 6,5/10.**
Style clair et pédagogique, messages d'erreur souvent actionnables, dates/monnaies localisées. Les défauts sont des anglicismes visibles (« providers », « Reset »), une terminologie instable (quota/limite/fenêtre/réserve/forfait/abonnement), quelques typos et un jargon technique résiduel dans les raisons de recommandation.

**Positionnement / produit public : 4,0/10.**
Le socle local-first et les fonctionnalités sont réels, mais tout ce qui fait un produit distribuable manque : licence, confidentialité, signature, mises à jour, installateur, guide utilisateur, À propos/version, i18n, effacement des données, support. En l'état, c'est un excellent outil personnel, pas un produit public.

**Exactitude du CHANGELOG : 8,0/10.**
Très bon alignement 0.2.0/0.2.1 avec les commits et les documents ; pénalisé par l'absence d'entrée 0.1.0, l'absence de validation 0.2.1 et un chiffre de tests non reproductible.

**Note globale : 5,5/10.**
Un produit personnel abouti sur le fond (connecteurs, quotas, stratégie, honnêteté documentaire) mais qui a besoin d'une passe d'accessibilité, d'une passe de finition produit et de fondamentaux de distribution avant tout usage public.

---

## Annexe A — Détail des contrastes calculés

Formule WCAG 2.1 : `(L1+0,05)/(L2+0,05)` avec `L = 0,2126R + 0,7152G + 0,0722B` sur les composantes linéarisées. Les valeurs atténuées sont composées `couleur×0,65 + fond×0,35`.

Paires vérifiées conformes (échantillon) :
- Sombre : texte 16,32 ; muted 5,81–6,30 ; nav 7,13 ; nav actif 11,25 ; primaire 10,79 ; secondaire 11,40 ; filtres actifs 10,25 ; badges 7,12–9,41 ; source 7,47 ; toast 11,41 ; niveaux ressource 8,35–13,48.
- Clair : texte 12,20 ; muted 4,55–5,00 ; nav 5,92 ; nav actif 6,79 ; primaire 6,35 ; secondaire 10,75 ; badges 5,12–6,22 ; info 7,45 ; source 7,57 ; niveaux ressource 4,81–6,27 ; erreur expirée 6,00.
- Focus : `#cfedaa` sur `#101213` = 14,62 ; `#326b3e` sur `#f2f5f0` = 6,99.

Paires en échec : voir § 3.1 (tableaux sombre et clair).

## Annexe B — Inventaire des éléments vérifiés sans écart

- `QuotaResets.validate` : dates `AAAA-MM-JJ` strictes, heures locales validées (heure inexistante rejetée), clés inconnues refusées (`lib/quota-resets.js:26-42`).
- `usage-strategy.validate` : bornes des tokens, cache 0–100 %, modèles par bucket, routes inconnues refusées, consentement Contributor (`lib/usage-strategy.js:56-82`).
- `domain.validatePatch` : bornes des montants, dates, devises, statuts (`lib/domain.cjs:12-46`).
- `settings:update` : validation de `theme` (`light|dark`), `lowBalance` 0–10000, booléens (`main.cjs:583-591`).
- Export : dialogue natif, chemin par défaut daté, pas de clés (`main.cjs:593-597`).
- Aperçu : liste de routes fermée, pas de données réelles, `desktop:false` affiché (`scripts/preview.cjs:9-17`, `renderer/app.js:60`).
- Recherche/filtres : conservés pendant la saisie (`renderer/app.js:385`), filtres `aria-pressed` (`:72`).
- Recommandations : `reviewFirst` quand toutes les réserves sont incertaines, `recommended` null si désactivé (`lib/usage-strategy.js:170-175`), API jamais dans la file (`:165-169`).
- `disclosureState` : préservation de l'ouverture des `<details>` à travers les re-rendus (`renderer/app.js:41-45,57`).

---

*Rapport produit en lecture seule, sans exécution de l'application ni de Playwright, conformément à la contrainte de la tâche `task-5`. Les renvois croisés vers `analysis/01-architecture.md`, `02-securite.md`, `03-tests.md` et `04-connecteurs.md` sont volontairement limités : ce document couvre l'angle UX/documentation/produit, les autres couvrent l'architecture, la sécurité, les tests et les connecteurs.*
