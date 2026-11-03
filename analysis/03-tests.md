# Analyse 03 — Qualité et couverture des tests (ProvidersBar 0.2.1)

> Mission : tâche partagée `task-3`. Périmètre : `tests/` (19 fichiers), `package.json`, scripts smoke/verify, `docs/maintenance.md`, `docs/validation-0.2.0.md`, et cartographie de `lib/` (19 modules) + `main.cjs`.
> Seul fichier produit : `analysis/03-tests.md`. Aucun code, test ou script n'a été modifié.

## 1. Méthode

| Élément | Valeur |
| --- | --- |
| Date de l'analyse | 2026-11-03 |
| Répertoire | `C:\Users\lasme\Desktop\projects\ProvidersBar` |
| Node / npm | v24.18.0 / 11.16.0 |
| Commande officielle exécutée | `npm test` → `node --test tests/*.test.cjs` |
| Exécution réelle | oui (deux fois : run normal + run avec couverture intégrée) |
| Code de sortie | **0** (aucun échec) |
| Tests Electron exécutés | **non** — `test:desktop`, `test:claude:desktop`, `test:resources:desktop` exigent une session graphique Windows + Playwright Electron ; analyse **statique** du code à la place (voir §5) |
| Build / `npm start` | non exécutés (hors mission) |

Fichiers lus intégralement : les 19 fichiers de `tests/`, les 19 modules de `lib/`, `main.cjs`, `preload.cjs`, `scripts/smoke.cjs` (646 lignes), `scripts/smoke-claude.cjs`, `scripts/smoke-resource-status.cjs`, `scripts/verify-connections.cjs`, `scripts/app-resources.cjs`, `scripts/runtime-dependencies.cjs`, `scripts/package.cjs`, `renderer/index.html`, `docs/maintenance.md`, `docs/validation-0.2.0.md`, `package.json`, `.gitignore`.

Commande de couverture complémentaire (n'altère rien, Node 24 la fournit nativement) :

```
node --test --experimental-test-coverage tests/*.test.cjs
```

## 2. Résultat brut de `npm test`

Extrait exact de la sortie (les 135 lignes `✔` sont omises ici, aucune n'est `✖`) :

```
> providersbar@0.2.1 test
> node --test tests/*.test.cjs

✔ Repeated Grok automatic refreshes use no browser window; login and explicit checks remain visible (0.6349ms)
…
✔ manual quota is usable but no fabricated Antigravity group or Ollama included balance (0.2125ms)
ℹ tests 135
ℹ suites 0
ℹ pass 135
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1420.9652
```

| Indicateur | Valeur |
| --- | --- |
| Code de sortie | **0** |
| Fichiers de test | 19 |
| Tests exécutés | **135** |
| Suites (`describe`) | 0 — les tests sont des `test()` plats, nommés par comportement |
| Succès | **135** |
| Échecs | **0** |
| Annulés / ignorés / todo | 0 / 0 / 0 |
| Durée | **≈ 1,42 s** (1,35 s au second run) |
| Test le plus lent | « Claude human verification keeps Chrome open until the usage page becomes readable » ≈ 1 005 ms (attente réelle de 1 000 ms dans le contrôleur) |
| Autres tests > 100 ms | verrous Claude multi-processus (519 / 589 ms), lecture d'historique Claude Desktop (105 ms) |

Deux constats de lecture :

- Le compte statique de blocs `test(` est de 132, mais `tests/native-login.test.cjs` génère 3 tests via une boucle (`for … of accounts.filter(nativeLogin)`) + 1 test contrôleur, ce qui donne bien 135 tests exécutés (vérifié fichier par fichier).
- `docs/validation-0.2.0.md` annonce « 133 tests unitaires réussis » ; le dépôt 0.2.1 en compte **135**. La documentation de validation n'a pas été mise à jour pour 0.2.1 (écart mineur mais à corriger pour la traçabilité).

Répartition par fichier (tests réellement exécutés) :

| Fichier de test | Tests |
| --- | ---: |
| `tests/account-browser.test.cjs` | 2 |
| `tests/additional-connectors.test.cjs` | 5 |
| `tests/antigravity-account.test.cjs` | 6 |
| `tests/api-connection.test.cjs` | 3 |
| `tests/app-resources.test.cjs` | 3 |
| `tests/claude-connection.test.cjs` | 10 |
| `tests/claude-desktop-usage.test.cjs` | 3 |
| `tests/claude-live-usage.test.cjs` | 11 |
| `tests/credential-store.test.cjs` | 2 |
| `tests/domain.test.cjs` | 9 |
| `tests/migrations.test.cjs` | 6 |
| `tests/native-login.test.cjs` | 4 (dont 3 générés par boucle) |
| `tests/ollama-account.test.cjs` | 9 |
| `tests/openai-account.test.cjs` | 5 |
| `tests/orca-account.test.cjs` | 3 |
| `tests/quota-resets.test.cjs` | 7 |
| `tests/resource-levels.test.cjs` | 4 |
| `tests/subscription-accounts.test.cjs` | 22 |
| `tests/usage-strategy.test.cjs` | 21 |
| **Total** | **135** |

## 3. Couverture mesurée (instrumentée) et sa lecture critique

Sortie agrégée de `node --test --experimental-test-coverage` :

| Fichier instrumenté | Lignes % | Branches % | Fonctions % | Lignes non couvertes |
| --- | ---: | ---: | ---: | --- |
| `lib/account-browser.cjs` | 23,65 | 71,79 | 42,11 | 8-24, 34-198, 201-244 |
| `lib/antigravity-account.cjs` | 54,43 | 91,89 | 66,67 | 11-24, 26-47 |
| `lib/claude-connection.cjs` | 96,27 | 81,90 | 70,00 | 60-62, 77-79 |
| `lib/claude-desktop-usage.cjs` | 97,53 | 82,61 | 100,00 | 60-61 |
| `lib/claude-live-usage.cjs` | 100,00 | 92,08 | 100,00 | — |
| `lib/connectors.cjs` | 98,06 | 96,74 | 85,71 | 97-98 |
| `lib/credential-store.cjs` | 100,00 | 95,24 | 90,91 | — |
| `lib/domain.cjs` | 86,60 | 85,88 | 100,00 | 16-18, 39-40, 42-44, 54-55, 84-86 |
| `lib/migrations.cjs` | 100,00 | 98,39 | 100,00 | — |
| `lib/ollama-account.cjs` | 98,15 | 88,18 | 100,00 | 66-67 |
| `lib/openai-account.cjs` | 64,00 | 77,92 | 77,78 | 6-13, 15-55, 122, 134-137 |
| `lib/orca-account.cjs` | 100,00 | 83,87 | 100,00 | — |
| `lib/provider-catalog.cjs` | 100,00 | 93,75 | 100,00 | — |
| `lib/quota-resets.js` | 93,59 | 85,33 | 100,00 | 4, 71-74 |
| `lib/resource-levels.js` | 96,00 | 95,12 | 100,00 | 4 |
| `lib/seed.cjs` | 100,00 | 100,00 | 100,00 | — |
| `lib/subscription-accounts.cjs` | 11,01 | 93,48 | 80,00 | 15-305 |
| `lib/subscription-controller.cjs` | 97,69 | 86,54 | 78,26 | 96-98 |
| `lib/usage-strategy.js` | 97,75 | 84,79 | 97,96 | 4, 74-76 |
| `scripts/app-resources.cjs` | 100,00 | 84,62 | 100,00 | — |
| `scripts/runtime-dependencies.cjs` | 52,63 | 50,00 | 50,00 | 8-16 |
| **TOTAL des fichiers chargés** | **70,49** | **87,28** | **87,21** | — |

**Ces chiffres doivent être lus avec quatre biais explicites :**

1. **`lib/subscription-accounts.cjs` à 11 % est un artefact de mesure, pas un trou réel.** Les tests exécutent `inspectSubscriptionPage.toString()` dans un `vm.runInNewContext()` ; le code s'exécute dans un contexte VM non rattaché au fichier source. Les 22 tests couvrent largement la fonction (branches à 93,48 %), mais la couverture de lignes est attribuée à « rien ». La vraie couverture du module est bien supérieure ; en revanche la fiabilité de cette couverture est limitée par des DOM simulés à la main (§7).
2. **`main.cjs`, `preload.cjs` et `renderer/*.js` sont absents du rapport = 0 % par `npm test`.** Ils ne sont jamais `require` par les tests Node. Seuls les smoke tests Electron les exercent, et ils ne font pas partie de `npm test`.
3. **`lib/account-browser.cjs` (23,65 %) et `lib/openai-account.cjs` (64 %) sont de vrais trous**, pas des artefacts : `openAccountBrowser` (CDP réel, lignes 34-198), `openNativeOllamaLogin` (201-244), `findCodex` et `openCodexRpc` (6-55) ne sont jamais exécutés par un test unitaire.
4. **Le « 70,49 % global » mélange des fichiers très couverts et deux modules massivement non couverts** ; le noyau logique pur (`usage-strategy`, `quota-resets`, `resource-levels`, `domain`, `migrations`, `connectors`, `credential-store`, `claude-*`, `ollama`, `orca`) est en réalité à **≈ 95-100 % de lignes**.

Estimation consolidée : **≈ 90 % de couverture logique du noyau `lib/`** ; **≈ 0 % par `npm test` de `main.cjs` / `preload.cjs` / `renderer/`**, couverts seulement de façon non automatisée par les smoke tests Electron. Couverture fonctionnelle globale du code de production estimée : **≈ 70 %**, avec une « note de confiance » plus basse sur l'orchestration Electron.

## 4. Cartographie module → couverture → risque

Légende type : **Direct** = fichier de test dédié qui exerce le module ; **Indirect** = exercé par le test d'un autre module ou par un smoke test ; **Non couvert** = aucun test automatisé.
Risque = probabilité qu'une régression passe inaperçue × impact utilisateur.

| Module | Tests qui l'exercent | Type | Lignes % | Risque | Commentaire |
| --- | --- | --- | ---: | --- | --- |
| `lib/account-browser.cjs` | `account-browser.test.cjs` (2 : routage `openSubscriptionBrowser`, `ollamaCookie`), `native-login.test.cjs` (4) ; smoke Electron | Direct partiel + smoke | 23,65 | **Élevé** | Toute la couche CDP (`openAccountBrowser`, 34-198) et le login Ollama natif (201-244) ne sont testés qu'en smoke, avec des transports substitués. Les branches « navigateur fermé », « DevToolsActivePort périmé », fallback `?s=usage` une seule fois, nettoyage de profil ne sont pas testées unitairement. |
| `lib/antigravity-account.cjs` | `antigravity-account.test.cjs` (6) | Direct | 54,43 | **Moyen** | `parseAntigravityQuota` bien couvert (4 quotas, Argon, fractions invalides, doublons) ; `discoverServers` (PowerShell `Get-CimInstance`) et `readQuotaSummary` (HTTPS local, certificat auto-signé, timeout 4 s) ne sont jamais exécutés : seule la couche pure est testée. |
| `lib/claude-connection.cjs` | `claude-connection.test.cjs` (10) | Direct | 96,27 | **Faible** | Excellent : expiration, marge 5 min, rotation des deux jetons, 2 lecteurs concurrents, 2 **processus** Node réels partageant les verrous `proper-lockfile`, login frère, échec d'enregistrement Windows, logout, jeton révoqué, 400/401/429/403/503, 401 précoce avec jeton déjà remplacé. Trous : échec de libération des verrous (60-62) et retries `fs.rename` EPERM/EBUSY (77-79). |
| `lib/claude-desktop-usage.cjs` | `claude-desktop-usage.test.cjs` (3) | Direct | 97,53 | **Faible / Moyen** | Parsing, bornes de fraîcheur 45 min, resets connus, détection de remplacement atomique par `watchFile` réel testés. Manque : fichier > 1 Mo / JSON corrompu (60-61), et le test de veille dépend du timing (voir §7). |
| `lib/claude-live-usage.cjs` | `claude-live-usage.test.cjs` (11) | Direct | 100,00 | **Faible** | Le module le mieux couvert : parseur (fenêtres partagées, Fable/Sonnet/Opus, contradictions), sériisation, cache 60 s, 401→renouvellement unique, 429 + Retry-After, backoff 3 paliers, reprise, `restore()` après redémarrage, `wake()`/`credentialsChanged()`, secrets absents des erreurs. Seuls les exports singleton par défaut ne sont pas testés directement (utilisés via `defaultReader`). |
| `lib/connectors.cjs` | `api-connection.test.cjs` (3), `additional-connectors.test.cjs` (5), `domain.test.cjs` (2) | Direct | 98,06 | **Faible / Moyen** | Très bon : retry unique réseau/502/503/504, 401/403/404/429, validation de clé (espaces, CRLF, NUL), cooldown par empreinte SHA-256, « clé de remplacement non bloquée », secrets absents des messages. Manque : statut HTTP inattendu (500, 418 → ligne 97), saturation du Map de cooldowns (> 100), `signal.aborted` empêchant le retry (timeout 20 s), corps non-JSON sur réponse `ok`. |
| `lib/credential-store.cjs` | `credential-store.test.cjs` (2) | Direct | 100,00 | **Faible** | Sérialisation de la file, préservation en mémoire tant que l'écriture disque n'a pas réussi, reprise après échec, document illisible, protection `toString`/prototype. |
| `lib/domain.cjs` | `domain.test.cjs` (9) | Direct | 86,60 | **Moyen** | Règles métier centrales (résumé mensuel, `validatePatch`, `manualSnapshot`, `expireSubscriptions`, `isTracked`, dates). Trous : validation `plan`/`notes` > 2000 caractères, devise invalide, périodicité invalide, `resetAt` valide converti en ISO, branche `asOllamaFreeSnapshot` d'`expireSubscriptions`. |
| `lib/migrations.cjs` | `migrations.test.cjs` (6) + `antigravity-account.test.cjs` (`addAntigravity`) | Direct | 100,00 | **Faible** | Toutes les migrations testées avec vérification d'immutabilité (`state` d'origine non muté, `structuredClone`) et idempotence (`changed:false` au 2ᵉ passage). |
| `lib/ollama-account.cjs` | `ollama-account.test.cjs` (9) | Direct | 98,15 | **Faible / Moyen** | Parsing HTML fragile très bien couvert : montants/`Current balance`, en-tête actuel, tiers Free/Pro, pourcentages, `data-time`, pages publiques/`sign in`, montants ambigus ignorés, HTML non-string. Manque : branche « `$ X used` + `includes $ Y` » (66-67) et statut HTTP 5xx. |
| `lib/openai-account.cjs` | `openai-account.test.cjs` (5) | Direct | 64,00 | **Élevé** | `parseOpenAiLimits` et le cycle `open/read/disconnect` (concurrence, annulation pendant le démarrage) sont bons ; mais `findCodex` et `openCodexRpc` (framing JSON-lines, `initialize`, timeout 12 s, fermeture du process, `account/login/start`, `onLogin`) ne sont **jamais** testés unitairement — uniquement via un mock global dans `smoke.cjs`. |
| `lib/orca-account.cjs` | `orca-account.test.cjs` (3) | Direct | 100,00 | **Faible / Moyen** | `parseWallet` et `fetchWallet` bien couverts (conversion, workspace, identité changée, 401, réseau). Branches non couvertes : 403, 429, autre statut, JSON illisible (`get()` lignes 24-27). |
| `lib/provider-catalog.cjs` | `additional-connectors.test.cjs`, `subscription-accounts.test.cjs`, `domain.test.cjs` | Indirect | 100,00 | **Faible** | `connectionInfo` testé (modes, `toString` → `null`) ; le contenu éditorial (descriptions, instructions, endpoints) n'est pas asserté, mais il est statique. |
| `lib/quota-resets.js` | `quota-resets.test.cjs` (7) | Direct | 93,59 | **Moyen** | Slots par fournisseur, priorités provider/manuel, précision heure, dates locales inexistantes (DST), staleness 10 min, alias « Période en cours ». Manque : `forStrategy` sur un fournisseur **sans** `quotaWindows` avec un seul slot (71-74) — cas Ollama `Mois`/scalaire. |
| `lib/resource-levels.js` | `resource-levels.test.cjs` (4) | Direct | 96,00 | **Faible** | Seuils USD/% et négatifs multi-devises, fenêtres multiples, `active:false`/expiré. |
| `lib/seed.cjs` | `domain.test.cjs`, `migrations.test.cjs`, `antigravity-account.test.cjs` | Indirect | 100,00 | **Faible** | Inventaire de départ asserté (10 services, 6 abonnements, 4 API, favoris, thème) ; les valeurs non assertées sont couvertes par les migrations. |
| `lib/subscription-accounts.cjs` | `subscription-accounts.test.cjs` (22), `native-login.test.cjs` | Direct (via VM) | 11,01 (artefact) | **Moyen / Élevé** | Le cœur le plus complexe du produit (327 lignes de scraping DOM, Claude/Grok/Z.ai) est couvert par des DOM construits à la main et exécutés en VM. Les cas documentés sont bien là (Grok Dashboard vs Settings vs SuperGrok, avatar, conflits, sign-in, origine étrangère, conversation, zéro/100, « D'occasion » zai, resets français). Mais : branche `openai` de `inspectSubscriptionPage` non exercée, `resetAt` Claude par jour de semaine partiellement, et le comportement sur le **vrai** DOM n'est vérifié que par 3 fixtures du smoke. |
| `lib/subscription-controller.cjs` | `subscription-accounts.test.cjs` (~8 tests contrôleur), `native-login.test.cjs` (1) | Direct | 97,69 | **Faible / Moyen** | Propriétaire des cycles de vie navigateur : open/read/disconnect, concurrence, annulation d'une lecture en cours, vérification humaine (challenge), mode automatique, conservation du quota Bot connu, fermeture différée. Manque : tick du minuteur (96-98), échec de `deleteProfile` pendant `disconnect`, `open()` pendant `closeAll()`. |
| `lib/usage-strategy.js` | `usage-strategy.test.cjs` (21) | Direct | 97,75 | **Moyen** | Moteur de recommandation très bien testé (qualité vs renouvellement, Grok/Bot, Antigravity/Argon, Claude par modèle, Spark, fraîcheur, portefeuilles, ordre des crédits, heures pleines UTC, cache/contexte long, Contributor, validation). Risque résiduel : catalogue tarifaire **daté** (`checkedAt: 2026-09-12`) non testé contre une source, et branche `validate` d'un `subscriptionModels` valide (74-76) non exercée. |
| **`main.cjs` (690 lignes)** | Aucun test de `npm test` ; `scripts/smoke.cjs` (~200 assertions), `smoke-claude.cjs`, `smoke-resource-status.cjs` | **Non couvert** par les tests unitaires | 0,00 | **Critique** | Toute l'orchestration Electron : démarrage/migrations/backups, IPC et son garde `senderFrame`, `safeStorage`, `provider:update` (règles abonnement), `provider:connect` (validation avant remplacement), `provider:disconnect` (sessions/profils/clés), `syncOne`/`syncAll`, notifications, tray, `before-quit`, widget, export. Seul le smoke le touche, et ces scripts ne tournent pas dans `npm test`. |
| `preload.cjs` | Smoke seulement (via `window.providersBar`) | Indirect | 0,00 (non instrumenté) | **Moyen** | Surface IPC exposée (26 lignes) : aucun test d'API (présence/typage des méthodes, absence de fuite `ipcRenderer`). |
| `renderer/app.js` (66 Ko), `renderer/strategy-ui.js`, `renderer/reset-ui.js`, `renderer/theme-init.js` | `smoke.cjs` / `smoke-resource-status.cjs` | Non couvert par `npm test` | 0,00 | **Élevé** | ~108 Ko de logique UI (statuts, formats fr-FR, filtres, recherche, dialogue, resets, widget, sizing) sans test unitaire ; smoke vérifie surtout le rendu final et des fixtures visuelles. |
| `scripts/app-resources.cjs` | `app-resources.test.cjs` (3) | Direct | 100,00 | **Faible** | Remplacement complet de l'arborescence, préservation octet par octet des données portables, source manquante → ENOENT sans toucher l'installation, refus hors `dist` : très solide. |
| `scripts/runtime-dependencies.cjs` | Importé par `app-resources.cjs` (test indirect) | Indirect | 52,63 | **Moyen** | Copie des dépendances de production (dont `proper-lockfile`) partiellement exercée ; branche « dépendance hors workspace » (ligne 13) non testée. |
| `scripts/package.cjs`, `scripts/update-portable.cjs`, `scripts/preview.cjs`, `scripts/generate-icon.py` | Aucun | **Non couvert** | 0,00 | **Moyen** | Packaging/distribution non vérifié automatiquement (Windows x64 uniquement, renommage `electron.exe`, `closeRunningApp`, mode release vs portable). |
| `scripts/smoke*.cjs`, `scripts/verify-connections.cjs` | Aucun (ce sont des outils de test) | n/a | n/a | **Faible** | Non exécutés ici ; dépendent de Playwright/Electron et d'une session graphique ; `verify-connections` exige un portable lancé avec port de diagnostic. |

## 5. Ce que les smoke tests Electron couvrent réellement

Analyse statique (non exécutés, conformément à la consigne). Trois scripts, ~750 lignes, plus de 200 assertions.

### `scripts/smoke.cjs` (646 lignes) — couverture réelle

- **Inventaire et rendu** : 10 cartes, thème clair, couleur de sidebar, recherche, filtres API/tous, onglets Abonnements (6 lignes), Connexions (10 cartes).
- **Édition fournisseur via IPC réel** : plan, montant, périodicité, date future, `reviewed`, stats, expiration d'abonnement, rejet sans `confirmRenewal`, réactivation, relevé manuel, historique + graphe, statut expiré.
- **Clés API et chiffrement** : clé refusée (403) sans écriture, clé valide chiffrée (`safeStorage`) — assertion explicite que `credentials.json` ne contient **pas** le secret ; déconnexion pendant le remplacement d'une clé (course connect/disconnect), absence de résurrection ; export JSON sans clés ; redémarrage et persistance (`plan`, quota, favori, réglages, stratégie, `historyCount`, sessions).
- **Comptes à navigateur** : OrcaRouter via partition isolée (`protocol.handle` + `fetch` simulés), sélection du workspace, `localStorage` → détection, fermeture automatique, session expirée conservant l'ancien relevé ; Ollama idem (crédits inclus, réserve, `302` = session expirée, préservation du dernier relevé) ; séparation des sessions (`persist:orcarouter-account` ≠ `persist:ollama-account`) ; isolation des fenêtres de compte (`window.require` et `window.providersBar` absents) ; OpenAI/Grok/Z.ai/Claude via transports substitués ; Antigravity substitué ; `gemini` web refusé ; no-op si déjà connecté.
- **Réglages** : autoRefresh, thème (propagation aux deux fenêtres), widget rapide (10 lignes, stratégie, API), dimensions, `overflow-y`, footer, fermeture → tray (fenêtre masquée), redémarrage.
- **Rendu réel Chromium du lecteur de comptes** : 4 documents HTML réels chargés dans des `BrowserWindow` sandboxées et exécution de `inspectSubscriptionPage` (Grok number-flow, SuperGrok + Bot, Claude FR) — c'est la meilleure preuve que les mocks DOM du test unitaire correspondent au DOM.
- **Stratégie / resets / ressources** : panneau stratégie, ordre des recommandations, resets manuels zai, niveaux de ressources (empty/critical/low/healthy), « Solde épuisé », cohérence dashboard ↔ widget.
- **Sécurité renderer** : `window.require` et `window.process` absents, CSP/`sandbox` réels.

### `scripts/smoke-claude.cjs` (81 lignes) — injection de pannes

- Échec initial `auth-required` : mode `claude-live-local` choisi et **persisté** malgré l'échec, aucun relevé, UI « Prochaine tentative ».
- Redémarrage : le mode choisi est conservé.
- Panne puis reprise : horloge injectée + transport `fetch` simulé, 3 requêtes, `updatedAt` conservé pendant la panne puis mis à jour après reprise, capture d'écran, et **aucun jeton persisté** dans `state.json`.

### `scripts/smoke-resource-status.cjs` (89 lignes) — visuel

- Soldes négatifs rouges pour les 4 API dans les 3 devises et les 2 thèmes ; statuts de quota par fenêtre pour Claude/Z.ai/Antigravity/OpenAI/Grok ; statut global seulement si toutes les limites affichées sont épuisées ; Grok pool partagé ; ardoise « Fable non épuisé » ; captures dashboard + widget.

### Ce que les smoke tests **ne couvrent pas**

- Aucune assertion sur les **notifications** Windows (seuils 20 %, `lowBalance`, déduplication).
- Aucune assertion sur les actions du **menu du tray** (Synchroniser, Quitter) ni sur le **single-instance lock** (`second-instance`).
- `before-quit` (flush `writeQueue`, `credentials.settled()`, fermeture des navigateurs) non asserté.
- **Packaging/distribution** : aucun smoke ne lance l'exécutable packagé (le README le suggère manuellement) ; `test-results/connections-live.json` relève d'un diagnostic manuel.
- **IPC guard** (`event.senderFrame` ≠ frame principale ou URL ≠ `uiUrl` → « Accès refusé. ») jamais exercé négativement.
- **Limites de l'approche** : Playwright Electron + fenêtres réelles (pas de CI headless ici), stubs par mutation de `process.mainModule.require` (API Node dépréciée, couplage fort à l'identité des modules), captures d'écran enregistrées mais **non comparées** (pas de régression visuelle automatique), et scripts hors `npm test` donc non protégés par une exécution systématique.

## 6. Trous précis (branches, cas d'erreur, chemins non testés)

### Formats inconnus / réponses inattendues

- `lib/connectors.cjs:97` : statut HTTP non géré (500, 418…) jamais testé ; `lib/connectors.cjs:75-78` : retry après `response.body.cancel()` jamais vérifié ; saturation des cooldowns (100 entrées) non testée.
- `lib/orca-account.cjs:24-27` : 403, 429, autre statut, JSON illisible non testés.
- `lib/ollama-account.cjs:66-67` : extraction `$ X used` + `includes $ Y` (plan payant sans « of $ Z ») jamais exercée ; statut 5xx jamais testé.
- `lib/claude-desktop-usage.cjs:60-61` : fichier non-ENOENT illisible (> 1 Mo, JSON invalide) non couvert.
- `lib/antigravity-account.cjs:11-47` : découverte PowerShell, certificat auto-signé, réponse interrompue, timeout 4 s, `statusCode !== 200` non exécutés.
- `lib/openai-account.cjs:6-55` : tout le transport Codex (frames JSON multi-lignes, `initialize`, timeout 12 s, sortie du process, erreurs `message.error`).
- `lib/subscription-accounts.cjs` : branche `openai` (chemins `/codex/…`) jamais exercée (devenue connecteur Codex), chemins zai alternatifs, `resetAt` Claude par jour de semaine partiellement.
- `lib/account-browser.cjs` : port CDP invalide/périmé, socket fermée, `fallbackUsageUrl` après 5 lectures vides, nettoyage de profil temporaire, `AbortSignal` en cours de lecture.

### Timeouts et annulations

- Aucun test ne déclenche réellement `AbortSignal.timeout` : `connectors.cjs` (20 s, branche `signal.aborted`), `claude-connection.cjs` (`AbortSignal.any`), `claude-live-usage.cjs` (12 s), `orca-account.cjs` (15 s), `ollama-account.cjs` (15 s), `openai-account.cjs` (12 s), `antigravity-account.cjs` (4 s).
- `subscription-controller.cjs:96-98` : tick du `setInterval` (vérifie l'état du navigateur, relance `read`) non couvert par un test à horloge simulée.
- `main.cjs` : annulation d'un `open` en cours par `disconnect` (partiellement via smoke), `closeAll` pendant une vérification (partiellement).

### 401/403/429 et cooldowns

- API : 401/403/404/429 + Retry-After (secondes et date) bien couverts ; **500 générique absent** ; 429 sans `Retry-After` couvert via `domain.test.cjs` (délai minimum 60 s) ; `429` de `claude-connection` couvert (retryAt=+7 200 000) ; `429` de `claude-live-usage` couvert avec 4 valeurs d'en-tête ; `429` Orca/Ollama testés ; `Retry-After` décimal/non numérique non testé.
- Cooldown partagé : `connectors.cjs` utilise un `Map` **global au module**, jamais réinitialisé entre tests — les clés sont actuellement distinctes (`test-transient`, `test-cooldown-seconds`, `replacement`…) mais toute réutilisation d'une même clé créerait une dépendance d'ordre silencieuse.
- Claude : verrou `auth-busy`, verrou compromis, échec d'écriture Windows couverts ; **échec d'acquisition du second verrou legacy** (`claude-connection.cjs:60-62`) non couvert.

### Migrations et démarrage

- Migrations pures très bien couvertes (idempotence, immutabilité, préservation des comptes/historique/stratégie). Non testés :
  - `addClaude` quand `openai` est absent (insertion à l'index 0) et `addAntigravity` quand `gemini` est absent ;
  - écriture des sauvegardes `state.before-*.json` avec `flag:'wx'` et gestion `EEXIST` (`main.cjs:631-645`) ;
  - démarrage avec `state.json` tronqué/JSON invalide, `version !== 1`, `providers`/`history` non tableaux (`main.cjs:620-622`) → comportement actuel : `dialog.showErrorBox` + `app.quit()`, **aucun test** ;
  - `removeImportMetadata` : notes héritées par défaut (liste `legacyNotes`) partiellement testée.

### Concurrence et verrous

- Couverts : 2 lecteurs Claude dans un process, 2 process Node distincts avec verrous `proper-lockfile`, login frère gagnant, logout pendant renouvellement, verrou compromis, store de credentials sérialisé, contrôleur (concurrence open/read/disconnect), OpenAI (opens concurrents, disconnect pendant démarrage), Grok (lecture interrompue par réouverture).
- Non couverts : échec d'acquisition des verrous (chemin `catch` de `acquireRefreshLock`), écriture concurrente de deux providers sur `state.json` via `main.cjs` (`writeQueue`), double `syncOne` simultané (`busy`), `expireSubscriptions` concurrent du timer 60 s (`main.cjs:685`).

### Chiffrement / secrets

- Couverts : secrets absents des messages et erreurs (connecteurs, Claude, Grok/Z.ai, Ollama), `credentials.json` sans clair (smoke), `state.json` sans jeton Claude (smoke), export sans clés (smoke), sanitisation des réponses HTML.
- Non couverts par `npm test` : `safeStorage.isEncryptionAvailable()` indisponible (`main.cjs:522`), échec de `decryptString` pour une clé devenue illisible (`main.cjs:214-215`), `atomicWrite` en échec (disque plein/permissions), `credentials.settled()` au quit.

### Notifications, tray, interface

- `notify()` (`main.cjs:180-196`) : seuil 20 %, seuil USD uniquement (devises étrangères exclues), déduplication `${today}:${id}:${body}`, désactivation par réglage — **aucun test**.
- Tray : tooltip (`broadcast`), menu (Ouvrir/Synchroniser/Quitter), clic/double-clic, positionnement multi-écran/DPI — **aucun test**.
- Widget : smoke vérifie taille/contenu ; pas de test du redimensionnement sous cas limites (`window:quick-size` bornes 100-4000, clamp 240-900, absence de tray/écran).

### Angles morts transverses

- **Renderer** : `renderer/app.js` (66 Ko), `strategy-ui.js`, `reset-ui.js`, `theme-init.js` — 0 test unitaire. Formats monétaires fr-FR, badges de statut, filtres, recherches, dialogue, resets, sizing du widget ne sont vérifiés que par smoke.
- **Preload** : surface API de 26 méthodes sans test (contrat renderer ↔ main).
- **Packaging** : `scripts/package.cjs`, `update-portable.cjs`, `runtime-dependencies.cjs` (branche d'erreur) — non couverts, alors que la distribution est un livrable.
- **CI** : aucun workflow CI détecté (pas de dossier `.github`), donc `npm test` n'est pas garanti à chaque commit, et les smoke tests Electron ne sont lancés que manuellement.
- **Cohérence doc/code** : `docs/maintenance.md:13` dit que « les tests » couvrent les connexions, la persistance, **le chiffrement** et le **widget** ; c'est vrai de l'ensemble `npm test` + smoke Electron, mais **faux pour `npm test` seul** (chiffrement/persistance/widget = smoke uniquement). À clarifier dans la doc pour éviter une fausse confiance.

## 7. Fragilité, assertions faibles, sur-mocking, fixtures

### Assertions faibles (passent pour une mauvaise raison possible)

- Nombreux `assert.throws(...)` **sans regex ni code** : `domain.test.cjs` (lignes 26-30, 34), `antigravity-account.test.cjs` (26-27, 39-41), `orca-account.test.cjs` (18-22), `subscription-accounts.test.cjs` (50). Un changement de message ou une erreur différente passerait.
- `openai-account.test.cjs:17` : vérifie `identity.length === 64` au lieu de la valeur SHA-256 exacte (une fonction de hachage erronée de même longueur passerait).
- `account-browser.test.cjs` : vérifie le **câblage des dépendances injectées** (`args[2] === true`, `minimized === false`), pas le comportement réel du CDP. Un bug dans `openAccountBrowser` ne serait pas détecté (couverture 23,65 %).
- `additional-connectors.test.cjs:41-43` : boucle sur un tableau à **une seule entrée** (runinfra) ; les autres connecteurs « additionnels » sont en fait couverts ailleurs, mais la formulation laisse croire à une couverture multiple.
- `subscription-accounts.test.cjs` : quelques assertions se contentent de `windows.length` ou de `result.authenticated`, sans vérifier les libellés/resets dans tous les cas.

### Tests qui mockent trop

- `subscription-accounts.test.cjs` : 22 tests reposent sur des nœuds DOM construits à la main (`innerText`, `getClientRects`, `querySelectorAll`) et sur `vm.runInNewContext` avec `inspectSubscriptionPage.toString()`. C'est inévitable pour du code exécuté dans le navigateur, mais **la fidélité au vrai DOM n'est prouvée que par 3 fixtures du smoke** ; les mocks reproduisent aussi implicitement le comportement attendu (risque de test « tautologique »).
- `smoke.cjs` substitue des exports de modules via `process.mainModule.require(...)` (stubs d'`openCodexRpc`, `openSubscriptionBrowser`, `readClaudeDesktopUsage`, `fetchAntigravityQuota`, `session.fetch`, `protocol.handle`). Très efficace, mais couplage fort à l'implémentation et à l'API dépréciée `process.mainModule` ; une refonte interne (destructuration à l'import) casserait le smoke sans casser le produit.
- Les tests unitaires des contrôleurs injectent `openBrowser`/`wait` (bons « seams ») ; en revanche `main.cjs` n'expose **aucun seam** de test, d'où son 0 %.

### Fixtures partagées et dossiers isolés

- Bons réflexes : `fs.mkdtemp` dans `os.tmpdir()` (Claude, credentials) ou dans `test-results/` (app-resources, native-login), nettoyage `t.after`, assertions anti-`..` avant `fs.rm` récursif, `structuredClone` pour l'immutabilité, vérification octet par octet des données portables.
- Risques :
  - `app-resources.test.cjs` et `native-login.test.cjs` écrivent dans `test-results/` **du dépôt** (assertions sur `path.dirname(dir)`), donc `npm test` exige un workspace inscriptible et un chemin non exotique ; un crash laisse des dossiers (aucun restant actuellement → nettoyage fiable).
  - 93 dossiers résiduels dans `test-results/` (76 `smoke-data-*`, 8 `claude-*`, 8 `resource-*`, 1 `ui-*`) issus des runs smoke : git-ignorés mais volumineux (profils Chromium complets) ; à nettoyer après les campagnes.
  - Horloge/timing : `claude-desktop-usage.test.cjs` s'appuie sur `fs.watchFile` réel (interval 20 ms, sleep 60 ms, timeout 3 s) ; `claude-connection.test.cjs` lance 2 processus Node réels avec une porte de 150 ms et des verrous à `retries: 4` ; le test « Claude human verification » attend 1 000 ms réels. Sur une machine chargée (CI, antivirus Windows), ce sont les candidats les plus probables à un flake.
  - Aucune graine aléatoire ni dépendance réseau dans `npm test` : bon point (le smoke seul nécessite Electron).

## 8. Top 10 des tests manquants les plus critiques

| # | Test manquant (scénario) | Cible | Assertions clés attendues | Priorité |
| --- | --- | --- | --- | --- |
| 1 | **Démarrage avec état corrompu** : `state.json` tronqué (JSON invalide), `version:2`, `providers` non tableau, puis `state.before-subscription-removal.json` déjà existant (`wx`/EEXIST). L'app doit conserver les fichiers, afficher l'erreur et quitter sans écraser. | `main.cjs:616-648` (extraire `loadState`/`migrateState`) | fichier d'origine intact, aucune écriture partielle, `dialog.showErrorBox` appelé, backup non écrasé | P0 |
| 2 | **Garde IPC et preload** : `ipcMain.handle` appelé depuis une frame non principale / une URL ≠ `uiUrl` doit lever « Accès refusé. » ; la vraie frame passe. Vérifier aussi la surface de `preload.cjs` (26 méthodes, pas d'exposition d'`ipcRenderer`). | `main.cjs:439-446`, `preload.cjs` | rejet exact, aucun effet de bord, API exposée conforme | P0 |
| 3 | **Règles `provider:update`** : statut d'abonnement refusé sur une API ; `expired → active` sans `confirmRenewal`/échéance future refusé ; `active:false` sur abonnement → `paused` ; `ollama` expiré reste actif et purge ses montants ; `expireSubscriptions` relancé après patch. | `main.cjs:494-511` | messages d'erreur exacts, état final, `summary` recalculé | P0 |
| 4 | **Atomicité de `provider:connect`** : clé invalide ne remplace pas une clé existante (`credentials.set` non appelé) ; `safeStorage.isEncryptionAvailable() === false` → erreur, rien enregistré ; clé enregistrée indéchiffrable → message dédié ; connect concurrent + disconnect simultanés. | `main.cjs:517-534`, `main.cjs:214-215` | `credentials.json` inchangé, `connected:false`, pas de course | P0 |
| 5 | **`provider:disconnect` par type** : attend `busy`/`opening`/`work`, ferme navigateur/fenêtre, purge session isolée (`orcarouter`, `ollama`), supprime profil et credential, remet le statut `idle` ; échec de `deleteProfile` n'empêche pas de sortir de `disconnecting` (idempotence). | `main.cjs:535-580` | sessions/profils/clés absents, `disconnecting` vide, second appel sans erreur | P0 |
| 6 | **`notify()`** : quota ≤ 20 % notifié, solde USD ≤ `lowBalance` notifié, solde CNY ignoré, une seule notification par jour/provider/message, rien si `notifications:false`. | `main.cjs:180-196` | `Notification` mocké 1×/cas, corps exacts, déduplication | P1 |
| 7 | **Transport Codex réel** : deux réponses JSON dans un même chunk + fragment suivant, timeout de 12 s rejette, sortie du process rejette les requêtes en attente, `initialize`/`initialized`, `account/login/start`, `onLogin(success:false)`, URL d'auth hors `auth.openai.com` refusée. | `lib/openai-account.cjs:6-55` | résolutions/rejets, `close()` tue le process, pas de fuite | P0 |
| 8 | **Lecteur CDP réel** : `DevToolsActivePort` invalide puis valide, navigateur fermé pendant une commande, `fallbackUsageUrl` tenté **une seule fois** et seulement si l'origine correspond, profil temporaire supprimé vs profil dédié conservé, `AbortSignal` interrompt. | `lib/account-browser.cjs:34-198` | erreurs exactes, nombre de tentatives, effet disque | P1 |
| 9 | **Cas HTTP limites des connecteurs** : 500/418 → « Fournisseur indisponible (HTTP 500) », 429 sans en-tête → cooldown minimum 60 s, en-tête décimal/invalide, Map de cooldowns plein (100) → éviction du plus ancien, timeout réseau pendant le retry → une seule tentative. | `lib/connectors.cjs:58-101` | messages/codes, nombre d'appels au fetcher, cooldowns | P1 |
| 10 | **Branches restantes de scraping/parsing** : zai page `/manage-apikey/usage`, Claude `resetAt` par jour de semaine et reset 5 h > 5,5 h → `null`, Grok conflit → `ACCOUNT_USAGE_INVALID`, `parseAccountUsage` rejette label/`remaining`/`resetAt` invalides, `quota-resets.forStrategy` sur provider mono-slot sans `quotaWindows`, `domain.manualSnapshot` avec `resetAt` valide. | `lib/subscription-accounts.cjs`, `lib/quota-resets.js:71-74`, `lib/domain.cjs:54-55` | codes d'erreur et valeurs exactes | P1 |

> À défaut de tests 1-5 (main.cjs), l'alternative réaliste et moins coûteuse est d'**extraire** ces logiques dans des modules purs (`createStateLoader`, `createIpcHandlers({ ipcMain, ... })`, `createNotifications`, `createConnectionService`) puis de les tester en `node:test` — c'est la recommandation structurante n°1.

## 9. Qualité globale des tests et note

### Points forts (à conserver)

- **135 tests exécutés en ~1,4 s**, sans réseau, sans Electron, sans état partagé entre processus : excellent ratio retour sur investissement pour une base `node:test` native.
- **Noms de tests comportementaux** (français/anglais) qui documentent des règles métier précises : « Holds are already accounted for », « renewal never assumes a restored quota », « a compromised lock cannot publish the response »…
- **Profondeur d'erreurs inhabituelle** pour un projet de cette taille : secrets absents des messages/erreurs, sessions expirées, contradictions de quotas, cooldowns serveur, jeton révoqué, verrou compromis, échec d'écriture Windows, charge de clé invalide.
- **Isolation et propreté** : `os.tmpdir()`/`test-results` uniques, nettoyage `t.after`, assertions anti-`..` avant suppression récursive, immutabilité via `structuredClone`.
- **Tests de contrat multi-processus** réels (`claude-connection.test.cjs`) et **fixtures DOM exécutées dans le vrai Chromium** (smoke) : rare et précieux.
- **Deux couches complémentaires** : unitaires déterministes + smoke Electron de bout en bout, avec captures de non-régression visuelle (non comparées).

### Points faibles structurants

1. `main.cjs` (690 lignes d'orchestration critique, IPC, chiffrement, persistance, tray, notifications) n'a **aucun test unitaire** ; tout dépend de smoke tests hors `npm test` et non exécutables en CI standard.
2. `renderer/` (~108 Ko) n'a **aucun test unitaire**, alors que la logique d'affichage (statuts, formats fr-FR, resets, widget) y est dense.
3. La couche transport (`account-browser` CDP, `openai-account` RPC, `antigravity` PowerShell/HTTPS) est quasi non testée : or c'est précisément ce qui casse quand un tiers évolue.
4. Les tests de `subscription-accounts.cjs` sont **très mocks** et génèrent une couverture instrumentée trompeuse ; leur fidélité au DOM réel n'est validée que par 3 fixtures smoke.
5. **Aucun CI**, aucun seuil de couverture, pas de script `coverage` dans `package.json` ; `npm test` ne couvre pas les smoke tests ; la doc (`maintenance.md:13`) entretient l'ambiguïté entre « tests » Node et Electron.
6. Quelques **flakes potentiels** liés au temps réel (`watchFile` 20 ms/60 ms/3 s, processus enfants, attente 1 s) et une dépendance de layout `test-results/` dans le dépôt.

### Note

**Note globale : 7,5 / 10** (décomposition indicative : profondeur et qualité du noyau logique **9/10** ; gestion des erreurs/sécurité **8,5/10** ; couverture de l'orchestration Electron `main.cjs` **3/10** ; renderer **3/10** ; automatisation/CI **4/10** ; maintenabilité des tests **7,5/10**).

La base de tests est **nettement au-dessus de la moyenne** pour un projet Electron de cette taille, avec un noyau quasi exhaustif et des assertions de sécurité rares. Le risque résiduel se concentre là où elle ne va pas : l'orchestration Electron, le renderer et les transports externes — c'est-à-dire précisément les zones où une régression est invisible dans `npm test` et visible pour l'utilisateur.

## 10. Recommandations priorisées

### P0 — avant la prochaine release (bloquant qualité)

1. **Extraire et tester `main.cjs`** : `createStateLoader` (lecture + migrations + backups), `createIpcHandlers({ ipcMain, … })` avec injection d'`event`, `createConnectionService` (connect/disconnect/sync), `createNotifications`. Tests `node:test` avec mocks `electron` (aucune modif de comportement). Viser les tests manquants n°1 à 5 du §8.
2. **Tester le transport Codex** (`findCodex`, `openCodexRpc`) avec un faux process (`child_process` injecté) : framing, timeouts, fermeture — test n°7.
3. **Tester le lecteur CDP réel** avec un faux `WebSocket`/fichier `DevToolsActivePort` injecté : port périmé, socket close, fallback unique, cleanup — test n°8.
4. **Rendre les smoke tests exécutables de façon fiable** : au minimum un job CI Windows (ou une checklist de release explicite dans `docs/maintenance.md`) exécutant `npm run test:desktop`, `npm run test:claude:desktop`, `npm run test:resources:desktop` ; à défaut, documenter qu'ils sont obligatoires avant release.

### P1 — sous 1 à 2 itérations

5. **Ajouter `npm run coverage`** (`node --test --experimental-test-coverage tests/*.test.cjs`) et un seuil (par ex. 85 % lignes sur `lib/` hors fichiers VM/Electron), avec exclusion documentée de `subscription-accounts.cjs`/`main.cjs` du seuil ou compensation par tests dédiés.
6. **Compléter les branches listées au §6** : `connectors` 500/timeout/cooldown plein ; `orca` 403/429/JSON ; `quota-resets.forStrategy` scalaire ; `domain` validations `plan`/`notes`/devise/périodicité/`resetAt` valide ; `claude-desktop` fichier illisible ; `openai` erreurs de login ; `antigravity` découverte/lecture ; `subscription-accounts` branches ouvertes.
7. **Tester `notify()`** (tables de seuils et déduplication) et **`window:quick-size`/tray** avec des mocks Electron (boîtes de calcul bornes/clamp).
8. **Tester le packaging** : `scripts/package.cjs` et `update-portable.cjs` dans un `dist/` temporaire (release vs portable, refus de dossier existant, renommage `electron.exe`), `runtime-dependencies` (branche « hors workspace », dépendances imbriquées).
9. **Ajouter des tests renderer minimaux** : soit via le smoke existant (assertions supplémentaires ciblées sur `statusBadge`, formats fr-FR, filtres, resets), soit introduire un DOM de test (`jsdom`/`linkedom`) et charger `app.js` avec un `window.providersBar` mocké — au moins pour les fonctions pures extraites.

### P2 — hygiène et maintenabilité

10. **Réduire les assertions faibles** : remplacer les `assert.throws` nus par `{ code }` ou regex, asserter la valeur exacte du hash d'identité OpenAI, compléter `account-browser` au-delà du câblage.
11. **Fixtures partagées** : extraire les helpers dupliqués (`provider()`, `wallet()`, documents DOM Grok/Z.ai) dans un `tests/helpers/` et documenter leur fidélité aux formats observés (référence `docs/maintenance.md`).
12. **Supprimer les flakes potentiels** : passer le test `watchFile` en horloge simulée quand possible, remplacer les attentes réelles par `t.mock.timers` (le contrôleur s'y prête déjà), regrouper les tests multi-processus.
13. **Nettoyer `test-results/` automatiquement** en fin de smoke (ou au démarrage) et documenter sa taille ; ne pas dépendre du dépôt pour les fixtures `npm test` (préférer `os.tmpdir()`).
14. **Mettre à jour la documentation** : `docs/maintenance.md` (distinguer `npm test` des smoke Electron, ajouter la commande de couverture), `docs/validation-0.2.0.md` (133 → 135 tests, ou créer `validation-0.2.1.md`), et consigner les formats observés (Ollama « Usage credits », Grok `number-flow-react`) déjà partiellement présents.
15. **CI minimale** : workflow Windows `npm ci && npm test` sur push/PR, et job nocturne ou manuel pour les smoke Electron.

---

*Fin de l'analyse 03 — tests. Aucune conclusion sur les modules `lib/` ne repose sur une exécution des smoke tests Electron : ceux-ci ont été analysés statiquement, comme demandé.*
