# Contrats de la refonte 0.3.0 (référence unique)

Document piloté par le Lead. **Toute divergence doit être signalée au Lead avant d'être codée.**

## 1. Contexte

- Branche : `refonte/pro` (partir de `main`, commit `e14417e`).
- Version cible : **0.3.0**. Electron : **44.10.2** (déjà installé, `npm audit` = 0 vulnérabilité).
- Node ≥ 24, Windows x64. Aucune nouvelle dépendance sans accord du Lead.
- Objectif : restaurer la fiabilité des connexions, redesign accessible du tableau de bord et du widget, `main.cjs` simplifié/durci, tests + CI + documentation de niveau professionnel.
- Règle absolue : **les tests et le smoke test doivent rester verts à la fin de chaque vague**. Les agents ne modifient que les fichiers de leur périmètre (voir §2).

## 2. Propriété des fichiers (write scopes exclusifs)

| Propriétaire | Fichiers |
|---|---|
| **Lead** | `REFONTE-CONTRATS.md`, `package.json`, `package-lock.json`, `.gitignore`, `ANALYSE.md`, commit/merge final |
| **architecte** | `main.cjs`, `preload.cjs`, `lib/data-store.cjs`*, `lib/window-security.cjs`*, `lib/privacy-export.cjs`*, `lib/seed.cjs`, `lib/migrations.cjs`, `scripts/package.cjs`, `scripts/app-resources.cjs`, `scripts/update-portable.cjs`, `tests/data-store.test.cjs`*, `tests/window-security.test.cjs`*, `tests/privacy-export.test.cjs`*, `tests/migrations.test.cjs`, `tests/app-resources.test.cjs`, `tests/domain.test.cjs` (exception T4a : uniquement le defaut de thème) |
| **connecteurs** | `lib/connectors.cjs`, `lib/openai-account.cjs`, `lib/usage-strategy.js`, `lib/claude-live-usage.cjs`, `lib/claude-connection.cjs`, `lib/claude-desktop-usage.cjs`, `lib/antigravity-account.cjs`, `lib/ollama-account.cjs`, `lib/orca-account.cjs`, `lib/diagnostics.cjs`*, `scripts/doctor.cjs`*, et leurs tests dédiés dans `tests/` |
| **securite** | `lib/account-browser.cjs`, `lib/subscription-controller.cjs`, `lib/subscription-accounts.cjs`, `tests/account-browser.test.cjs`, `tests/subscription-accounts.test.cjs`, `tests/native-login.test.cjs` |
| **ux-docs** | `renderer/**`, `lib/resource-levels.js`, `tests/resource-levels.test.cjs`, `renderer/CONTRAT-UI.md`* |
| **qualite-tests** | `.github/**`, `scripts/smoke.cjs`, `scripts/smoke-claude.cjs`, `scripts/smoke-resource-status.cjs`, `scripts/verify-connections.cjs`, `tests/quality.test.cjs`*, `docs/maintenance.md` |
| **vague 3 (docs)** | `README.md`, `CHANGELOG.md`, `docs/**`, `PRIVACY.md`*, `SECURITY.md`* (attribué plus tard, ne pas toucher avant) |

`*` = fichier nouveau. Interdits à tous sauf mention : `package.json`, `package-lock.json`, `REFONTE-CONTRATS.md`.

## 3. Contrats d'interface figés

### 3.1 API renderer (`preload.cjs` → `window.providersBar`)

**Toutes les méthodes existantes restent identiques** (smoke + renderer). Ajouts autorisés, à implémenter par architecte :

```js
getAppInfo: () => ipcRenderer.invoke('app:info')      // Promise<{version, electron, platform, dataDir, packaged}>
eraseData:  () => ipcRenderer.invoke('data:erase')    // Promise<boolean> — double confirmation côté UI
```

`app:info` renvoie la version via `app.getVersion()` (source unique de vérité).

### 3.2 État public (`publicState()`)

- Ajout : `app: { version, electron, packaged }` (lecture seule, sans chemin absolu exposé au renderer).
- Ajout : `settings.theme` accepte désormais `'light' | 'dark' | 'system'` ; `theme-init.js` et `applyTheme` résolvent `system` via `matchMedia('(prefers-color-scheme: dark)')`.
- Ajout : `state.apiCooldowns` (objet `{ "<fournisseur>:<empreinte>": <epoch ms> }`, plafonné à 100 entrées) — persistance des cooldowns 429 des clés API. Non exposé inutilement au renderer ? Il l'est déjà puisque `publicState` diffuse l'état ; accepter (ce n'est pas un secret : empreinte SHA-256 de clé non réversible).
- `state.history` reste un tableau dans `state.json`, plafond porté à **20 000** relevés (≈ 7 jours à 10 fournisseurs), avec purge des plus anciens.

### 3.3 Connecteurs (contrat vers `main.cjs`)

- `fetchUsage(id, key, fetcher, options)` : nouvelle option `{ cooldowns }` où `cooldowns` est un store `{ get(fingerprint), set(fingerprint, untilMs), prune(nowMs) }` ; défaut = store mémoire interne (compatibilité tests). Les erreurs conservent `code: 'API_RATE_LIMIT'` + `retryAt`.
- `claudeLive` : conserver les exports actuels ; `main.cjs` instanciera `createClaudeLiveReader({ fetchImpl: apiFetch })` + `createClaudeConnection({ fetchImpl: apiFetch })` et remplacera l'usage du singleton par défaut. `createClaudeLiveReader` accepte déjà `{ fetchImpl }`.
- `ollama` / `orca` : fournir un code d'erreur exploitable (`OLLAMA_SIGNIN`, `ORCA_AUTH`) pour distinguer auth de transitoire ; le `main` conserve la session (`accountSession`) avant le premier fetch et laisse le cycle 5 min réessayer.
- `openai` : `parseOpenAiLimits` doit exposer ses fenêtres ; `usage-strategy` doit exiger les fenêtres `5 heures` **et** `Semaine` pour le bucket `openai` (comme `claude`/`zai`). Un relevé incomplet doit être signalé, jamais présenté comme complet.
- `diagnostics` (nouveau) : `collectDiagnostics({ dataDir })` → `[{ id, label, ok, detail, hint }]` sans secret, utilisé par `scripts/doctor.cjs` (`npm run doctor`).

### 3.4 Session navigateur (contrat vers `main.cjs`)

- `account-browser.cjs` ne doit **plus ouvrir de port TCP de débogage** : utiliser `--remote-debugging-pipe` (framing JSON + `\0`, fd 3/4) ; supprimer la lecture de `DevToolsActivePort`.
- `openAccountBrowser` / `openNativeLogin` / `openNativeOllamaLogin` gardent leurs signatures et retours (`isOpen`, `phase`, `onReady`, `readSubscriptionPage`, `readOllamaCookies`, `close`).
- Nouvel export `sweepTemporaryProfiles(dataDir)` : purge les profils `temporary-account-browsers/*` orphelins, appelé par `main.cjs` au démarrage.
- `subscription-controller.read(id, { interactive: true })` a **priorité** : une vérification interactive ne doit jamais être silencieusement servie par un travail de fond en cours.

### 3.5 Sécurité processus (implémenté par architecte, revu par securite)

- `lib/window-security.cjs` :
  - `secureWindow(win)` : navigation/window.open refusés, permissions refusées, `devTools` non activable.
  - `secureAccountWindow(win, allowedOrigins)` : navigation/redirection/popup **limitées à une allowlist d'origines** (origines fournisseurs + `accounts.google.com` si nécessaire), pas n'importe quel HTTPS.
  - `applyDataDirAcl(dataDir)` : sous Windows, `icacls /inheritance:r` + droits complets utilisateur courant + SYSTEM ; échec = avertissement, jamais blocage du démarrage.
  - `purgeLeftovers(dataDir)` : `.tmp`, `DevToolsActivePort`, `state.before-*.json` (garder les 2 plus récents), `temporary-account-browsers` via securite.
- `lib/privacy-export.cjs` : `sanitizeStateForExport(state)` retire `accountSession`, `claudeSync`, `apiCooldowns` et toute identité pseudonyme ; l'export contient `{ app, version, exportedAt, inventory, settings, strategy, manualResets, history }`.
- Fenêtres UI : `devTools:false`, `spellcheck:false`. Notifications : `app.setAppUserModelId` configuré sur Windows ; `notify()` protégé (`balances ?? []`).
- `data:erase` : supprime `state.json`, `credentials.json`, `account-browsers/`, `temporary-account-browsers/`, caches, puis réinitialise `createSeed()` et rediffuse l'état.

### 3.6 Contrat UI (renderer) — à documenter par ux-docs dans `renderer/CONTRAT-UI.md`

À préserver pour limiter la casse du smoke test (sinon documenter le remplacement) :

- Globals exposés : `render()`, `receiveState(state)`, `strategyResult()`, variable globale `state`.
- Navigation : `[data-nav="overview|subscriptions|history|connections|settings"]`.
- Actions : `[data-action="sync|strategy-settings|export|disconnect|account-open|account-verify|claude-enable-live|ollama-email|main|close-dialog|history-retry"]`.
- Stratégie : `.strategy-panel`, `.strategy-current`, `.strategy-next`, `.strategy-next li`, `.strategy-api`, `.strategy-api-providers`, `.strategy-details summary`, `[data-disclosure="subscriptions"]`, `#strategy-form`, `#strategy-model-ollama`, `#strategy-inputTokens`, `[name="contributor"]`.
- Divers : `#toast`, `#app`, `#detail-dialog`, `.cards .card`, `.workspace`.
- Redesign : navigation latérale conservée sur desktop, **remplacée par une barre supérieure visible** sous 900 px (jamais `display:none`), texte ≥ 11 px, contrastes AA (≥ 4,5:1), focus restauré après rendu, thème clair/sombre/système, version dynamique, badge de fraîcheur dans le widget, statut d'actualisation réel, action « Effacer mes données », marque neutre.

## 4. Definition of Done (par tâche)

1. Code écrit, `node --check` OK sur les fichiers modifiés.
2. Tests ciblés verts (`node --test tests/<fichiers concernés>`), puis suite complète verte au moment du rapport.
3. Aucun secret, aucune donnée personnelle, textes UI en français.
4. Rapport au Lead : fichiers modifiés, tests exécutés + résultats, écarts au contrat, éléments non vérifiés, risques restants.
5. Tâche partagée passée à `completed` avec la révision courante.
