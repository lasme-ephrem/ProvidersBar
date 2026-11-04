# Revue de sécurité finale — ProvidersBar 0.3.0

**Auditeur :** `securite` (équipe d'analyse) — **Date :** 2026-11-03 (soir)
**Version revue :** 0.3.0, branche `refonte/pro`, Electron **44.10.2**, Node ≥ 24, Windows x64.
**Périmètre :** `main.cjs`, `preload.cjs`, `lib/account-browser.cjs`, `lib/window-security.cjs`, `lib/privacy-export.cjs`, `lib/data-store.cjs`, renderer (`index.html`, `app.js`, `views.js`, `ui-core.js`), `data:erase`, `state.apiCooldowns`, dossiers de session navigateur, export, purge, CI, documentation de conformité.
**Mode :** revue statique ciblée + garde-fous automatisés + vérifications système (grep, `npm audit`, `npm run verify`, `npm test`). Aucune connexion à un service réel, aucun login, aucun secret consulté, **aucune modification de code applicatif**.

Deux validations du Lead ne sont **pas rejouées** ici et sont citées telles quelles :
transport CDP réel via `--remote-debugging-pipe` avec Chrome 156 sous Windows
(`Browser.getVersion`, `Target.createTarget`, `Runtime.evaluate` par fd 3/4) et
`npm run doctor` (17 vérifications, aucun secret).

---

## 1. Verdict

> ## **GO pour la release 0.3.0**
>
> - **Aucun finding Critique ou Élevé ouvert.** Les deux findings Élevés de l'audit initial (`E-1` runtime Electron vulnérable, `E-2` port CDP TCP sur les profils connectés) sont **corrigés et vérifiés**.
> - **Aucune régression de sécurité détectée** entre 0.2.1 et 0.3.0 ; toutes les régressions possibles identifiées sont couvertes par des tests.
> - `npm audit` = **0 vulnérabilité**, `npm audit --omit=dev` = **0** ; Electron **44.10.2** verrouillé.
> - Suite de tests : **226 tests, 0 échec** (225 réussis, 1 ignoré pour un port d'aperçu déjà occupé), dont **15 nouveaux garde-fous de sécurité**.
>
> **Note de sécurité : 8,5 / 10** (7/10 à l'audit initial). Les points restants sont des **Faibles/Informatifs acceptés et documentés**, et des **conditions de release non bloquantes** listées en §6.

---

## 2. Périmètre revu

| Fichier | Taille | Points examinés |
| --- | --- | --- |
| `main.cjs` | 838 l. | fenêtres, IPC, export, effacement, ACL, purge, cooldowns, cycle de vie, lecteurs de comptes |
| `preload.cjs` | 28 l. | surface exposée de 25 méthodes, canaux IPC, absence d'accès brut |
| `lib/account-browser.cjs` | 473 l. | transport CDP pipe, cycle de vie des processus, profils, `sweepTemporaryProfiles` |
| `lib/window-security.cjs` | 179 l. | allowlist, durcissement fenêtres, ACL, purge conditionnelle |
| `lib/privacy-export.cjs` | 49 l. | liste d'exclusion, nettoyage récursif, structure d'export |
| `lib/data-store.cjs` | 137 l. | écriture atomique, plafond d'historique, chargement/migrations |
| `renderer/index.html` | 33 l. | CSP, scripts |
| `renderer/app.js` | 599 l. | actions, effacement, aperçu local, `innerHTML` |
| `renderer/views.js` | 1112 l. | échappement HTML des données affichées |
| `renderer/ui-core.js` | 301 l. | helpers d'échappement et de rendu |
| `tests/security.test.cjs` | 413 l. | **nouveaux garde-fous (15 tests)** |
| `PRIVACY.md`, `SECURITY.md` | 205 / 176 l. | **nouveaux documents de transparence** |

Hors revue : connecteurs réseau détaillés (`lib/*-account.cjs`, `lib/connectors.cjs`) déjà audités en vague connecteurs (`analysis/04-connecteurs.md`), rendu visuel (`analysis/05-ux-docs.md`), `scripts/` de fabrication (revus par `analysis/03-tests.md` / `packaging`).

---

## 3. Vérifications exigées — résultats

| Exigence | Preuve | Résultat |
| --- | --- | --- |
| Plus aucun `--remote-debugging-port` pour les navigateurs de compte | `lib/account-browser.cjs:12` (stdio 3/4 pipe), `:203-206` (`readerArguments`), `:222,376` (suppression d'un `DevToolsActivePort` hérité, jamais lu) ; grep de tout le code applicatif : seule occurrence restante `main.cjs:53` = **détection** de l'argument de diagnostic, sans lancement ; test `security.test.cjs` | **OK** — le lancement de navigateur ne peut plus ouvrir de port TCP ; validation réelle du pipe par le Lead |
| Aucune identité/session dans l'export | `lib/privacy-export.cjs:4-13` (`accountSession`, `claudeSync`, `apiCooldowns`, `identity`, `email`, `userId`, `workspaceId`), `:15-24` (nettoyage récursif), `:28-47` (structure autonome) ; `main.cjs:745-751` (l'export passe **uniquement** par `sanitizeStateForExport`, jamais `JSON.stringify(state)`) ; test runtime avec sentinelles + test source | **OK** |
| Allowlist effective | `main.cjs:47-49` : `{ollama.com, www.orcarouter.ai, orcarouter.ai, accounts.google.com}` exactement ; `lib/window-security.cjs:49-73` (navigation, redirection, popups et fenêtres enfants filtrés) ; `main.cjs:335,440` (seules les deux fenêtres internes) ; test qui extrait et évalue l'allowlist réelle puis vérifie que `claude.ai`, `grok.com`, `z.ai`, `evil.test`, `http://` sont refusés | **OK** |
| CSP sans `unsafe-eval`/script inline | `renderer/index.html:6` : `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'` ; aucun `<script>` sans `src`, aucun `on*=` inline, aucun `eval`/`new Function`/`document.write` dans le renderer ; test | **OK** (`style-src 'unsafe-inline'` conservé : styles inline des jauges, sans exécution de script) |
| `mode: 0o600` remplacé/accompagné par ACL | `lib/data-store.cjs:34,61` (`0o600` conservé : inopérant seul sous Windows) + `lib/window-security.cjs:92-107` (`icacls /inheritance:r` + utilisateur courant + `SYSTEM`) + `main.cjs:775` (appliquée **avant** `store.load()` :775→777) ; échec = avertissement (`main.cjs:776`), jamais blocage ; tests | **OK** — protection réelle par ACL, documentée PRIVACY §3 |
| Popups limités | `lib/window-security.cjs:58-69` : `setWindowOpenHandler` n'autorise que les origines de l'allowlist avec `sandbox`, `contextIsolation`, `nodeIntegration:false`, `devTools:false`, session du parent ; `:69` sécurise récursivement les fenêtres créées ; tests | **OK** — plus de « n'importe quel HTTPS » |
| Fenêtres UI isolées | `main.cjs:791` (`contextIsolation`, `nodeIntegration:false`, `sandbox`, `devTools:false`, `spellcheck:false`, preload explicite), `:794,799` (`secureWindow`), `lib/window-security.cjs:33-45` (popups/navigation refusés, permissions refusées, DevTools refermés) | **OK** |
| IPC filtré et minimal | `main.cjs:591-598` : **un seul** `ipcMain.handle`, wrapper qui exige la frame principale et l'URL exacte de l'interface (`frame.url.split('?')[0] !== uiUrl`) ; `preload.cjs:1-28` : 25 méthodes nommées, canaux littéraux, aucun `ipcRenderer` exposé ; tests | **OK** |
| `data:erase` | `main.cjs:541-589` : refus pendant synchronisation (`:545`), attente des écritures (`:547`), fermeture des fenêtres/browsers (`:550-559`), `clearStorageData` des partitions (`:560`), purge des clés en mémoire (`:561`), `claudeReader.clear()` (`:562`), suppression `state.json`/`credentials.json`/profils/sauvegardes/caches (`:572-580`), purge (`:581-584`), réinitialisation `createSeed()` (`:585-586`) ; IPC `:753`, preload `:24`, double confirmation UI (`renderer/app.js:201-231`, `renderer/views.js:697-703`) ; test | **OK** — limites (Claude Code, Codex, système) documentées PRIVACY §7 |
| `state.apiCooldowns` | `lib/migrations.cjs:95` (plafond 100), `:96-104` (migration de normalisation), `main.cjs:62-84` (store synchrone borné, purge, persistance), exclusion de l'export ; test | **OK** — seules des empreintes SHA-256 (non réversibles) sont conservées ; diffusion renderer voir R-2 |
| `npm audit` + Electron | `npm audit` = 0, `npm audit --omit=dev` = 0 ; `package-lock.json` : electron **44.10.2** (≥ 44.9.1, correctif de l'avis *high* de l'audit initial) avec intégrité `sha512-` ; `devDependencies.electron = ^44.10.2` | **OK avec réserve** R-1 (plage + audit de production partiel) |
| CI et garde-fous | `.github/workflows/ci.yml:36-93` (Windows, Node 24, `npm ci`, `npm run verify`, `npm test`, `npm audit --omit=dev`, artefacts en échec) ; `npm run verify` = 68 fichiers OK ; `npm test` = **226 tests, 0 échec** ; `tests/security.test.cjs` = **15/15** | **OK** |
| Documentation de conformité | `PRIVACY.md` (données, chemins, DPAPI, sessions, réseau, export, effacement, durées, droits, limites, absence de certification), `SECURITY.md` (périmètre, modèle de menace, surfaces, pratiques, hors périmètre, signalement privé, durcissement, historique) ; embarqués par `scripts/app-resources.cjs:24-27` ; test dédié | **OK** |

### Commandes exécutées

```text
npm audit                     → 0 vulnérabilité (toutes dépendances)
npm audit --omit=dev          → 0 vulnérabilité (production)
package-lock.json             → node_modules/electron 44.10.2, intégrité sha512-
npm run verify                → 68 fichiers vérifiés (node --check), OK
node --test tests/security.test.cjs   → 15 tests, 15 réussis, 0 échec
npm test                      → 226 tests, 225 réussis, 0 échec, 1 ignoré*
```

\* Le test « ignoré » est l'intégration du serveur d'aperçu de `tests/packaging.test.cjs`, volontairement sautée parce que le port 4317 était déjà occupé sur la machine de revue (aperçu de développement déjà lancé par un autre processus). Aucun échec : 225 tests réussis, `0` échec. `CHANGELOG.md` (0.3.0) et `README.md` sont désormais alignés ; le contrôle de version de `tests/quality.test.cjs` passe.

**Grep de contrôle (résultats) :** `remote-debugging-port` → 1 occurrence applicative (`main.cjs:53`, détection) ; `remote-debugging-pipe` → `account-browser.cjs` uniquement ; `WebSocket` → aucune occurrence applicative ; `eval(`/`new Function` → aucune dans le renderer ; `innerHTML` → 5 occurrences (`renderer/app.js:67,80,130,405,593`) toutes alimentées par des vues qui utilisent `escapeHtml` (84 occurrences dans `views.js`, helper `ui-core.js:44`) ; `console.log` → aucun dans le code de production ; dépendances de production → `proper-lockfile` seule.

---

## 4. Prisma des findings du premier audit

Référence : `analysis/02-securite.md` (audit 0.2.1). Statuts : **Corrigé** / **Atténué** / **Accepté** (résiduel documenté) / **Partiel**.

| Id | Finding initial (0.2.1) | Statut 0.3.0 | Preuve | Commentaire |
| --- | --- | --- | --- | --- |
| **E-1** | Electron 44.2.0 livré avec 7 avis ; `npm audit --omit=dev` trompeur | **Corrigé (runtime) / Partiel (processus)** | `package-lock.json` = 44.10.2 ; `npm audit` = 0 ; tests `security.test.cjs` (plancher 44.9.1 + intégrité) | Le runtime est à jour. La CI n'audite toujours que la production et Electron reste en plage `^44.10.2` → **R-1** (condition de release). |
| **E-2** | CDP TCP non authentifié sur les profils connectés (vol de cookies, contournement DPAPI) | **Corrigé** | `lib/account-browser.cjs:12,203-206` (pipe fd 3/4, NUL) ; `:222,376` (`DevToolsActivePort` supprimé, jamais lu) ; aucun `WebSocket` ; validation réelle Chrome 156 par le Lead | Le vecteur principal de l'audit initial est fermé : plus aucun port TCP pendant les lectures, y compris en vérification interactive. |
| **M-1** | `mode 0o600` inopérant sous Windows, aucune ACL | **Corrigé / Atténué** | `lib/window-security.cjs:92-107` + `main.cjs:775` (ACL avant création des fichiers) ; ACL non bloquante par contrat (`:776`) | Protection réelle par ACL ; `0o600` conservé sans effet Windows. Si `icacls` échoue : avertissement + héritage du dossier → **R-3**. |
| **M-2** | Code et données dans un dossier inscriptible, binaire non signé, pas d'intégrité | **Atténué / Accepté** | `PRIVACY.md` §3 ; `SECURITY.md` §6 ; ACL du dossier de données ; mise à jour atomique des ressources (`scripts/app-resources.cjs:31-34`) | Signature Authenticode et `app.asar`/intégrité non implémentés (décision de distribution) → **R-6** documenté et assumé. |
| **M-3** | Navigation HTTPS arbitraire et popups non restreints dans les fenêtres de compte | **Corrigé** | `lib/window-security.cjs:49-73` ; `main.cjs:47-49,335,440` ; tests allowlist/navigation/popup | Allowlist stricte ; `claude.ai`, `grok.com`, `z.ai` ne sont plus des origines navigables dans une fenêtre Electron (navigateurs externes pour ces fournisseurs). |
| **F-1** | DPAPI *user-scope* sans app-binding, pas de rotation | **Accepté** | `main.cjs:674` (refus si chiffrement indisponible), `:280-282` (message de déchiffrement) ; `PRIVACY.md` §3/§10 ; `SECURITY.md` §3 | Limite intrinsèque de `safeStorage` sous Windows ; un malware sous le même compte reste hors périmètre, explicitement documenté. |
| **F-2** | `.tmp` de jetons Claude en clair ; remplacement atomique réinitialisant une ACL | **Atténué** | `lib/claude-connection.cjs:69,82` (temporaire supprimé en `finally`) ; `lib/window-security.cjs:143` (purge des `.tmp` du dossier de données) | Résiduel : un arrêt brutal entre écriture et `rename` peut laisser `~/.claude/.credentials.json.providersbar-*.tmp`, **hors** du dossier purgé → **R-5** (Faible). |
| **F-3** | Identifiants pseudonymes présents dans l'état et l'export | **Corrigé pour l'export / Atténué** | `lib/privacy-export.cjs:4-24` ; `main.cjs:745-751` ; test avec sentinelles | L'état conserve l'empreinte nécessaire au rattachement du compte Codex, et `publicState` la diffuse au renderer → **R-2** (Faible, interne). |
| **F-4** | `DevToolsActivePort` résiduel / mode diagnostic | **Atténué** | `main.cjs:50-53` (mode diagnostic explicite) ; `lib/window-security.cjs:118-174` (purge conditionnelle, `:144`) ; `main.cjs:581-584,783-786` ; README §mode diagnostic ; test | L'application n'active **aucun** port par défaut ; si l'utilisateur la lance avec `--remote-debugging-port`, le renderer UI est exposé en CDP local jusqu'à la prochaine purge → **R-4** (Faible, documenté). |
| **F-5** | DevTools actifs sur les fenêtres UI | **Corrigé** | `main.cjs:791` (`devTools:false`) ; `lib/window-security.cjs:43` (referme les DevTools si ouverts) | — |
| **F-6** | Binaires externes résolus via `PATH` | **Accepté** | `lib/openai-account.cjs:7` (codex via `PATH` d'abord), `:128-130` (URL d'auth validée) ; `SECURITY.md` §3 | Même périmètre local que l'attaquant ; ne donne aucun privilège supplémentaire. Informatif. |
| **F-7** | Serveur d'aperçu sans `frame-ancestors` | **Accepté** | `scripts/preview.cjs` (routes fermées, 127.0.0.1, données `createSeed`) ; CSP `renderer/index.html:6` | Outil de développement, lecture seule, aucune donnée réelle ; non livré dans le portable (hors ressources copiées). |
| **F-8** | Rétention non bornée des sauvegardes ; export en clair | **Corrigé / Accepté** | `lib/window-security.cjs:148-156` (2 sauvegardes conservées), `lib/data-store.cjs:122-126` (plafond 20 000), export nettoyé ; `PRIVACY.md` §6/§8 | L'export reste un fichier JSON en clair choisi par l'utilisateur : documenté, à protéger par l'utilisateur. |

**Bilan :** 5 findings corrigés (E-1 runtime, E-2, M-3, F-3 export, F-5, F-8 partiellement), 4 atténués (M-1, M-2, F-2, F-4), 3 acceptés et documentés (F-1, F-6, F-7). Aucun finding Critique n'existait dans l'audit initial et aucun n'est apparu.

---

## 5. Findings résiduels (classés)

### Faibles

**R-1 — Chaîne d'approvisionnement : Electron en plage et audit de production partiel.** Faible.
`package.json` déclare `electron: "^44.10.2"` ; le lockfile fige 44.10.2 mais `npm install` (sans `ci`) pourrait installer une version ultérieure non auditée. La CI exécute `npm audit --omit=dev` (`.github/workflows/ci.yml:93`) alors que le runtime livré provient d'une *devDependency*. Risque nul aujourd'hui (`npm audit` = 0), mais une future régression du runtime passerait inaperçue.
*Recommandation :* épingler exactement (`"44.10.2"`) et ajouter `npm audit` complet en job de release. **Non bloquant.**

**R-2 — Diffusion de métadonnées de session au renderer.** Faible.
`publicState()` (`main.cjs:219-222`) diffuse l'objet `provider` complet, donc `accountSession` (dont l'empreinte d'identité OpenAI) et `state.apiCooldowns`, alors que l'interface n'utilise que `accountSession.kind` (`renderer/views.js:183,1018`). Aucune donnée secrète, renderer sandboxé, CSP `connect-src 'self'` et aucune origine distante dans le renderer (test dédié) : l'exposition reste interne.
*Recommandation :* projeter `{ kind }` et retirer `apiCooldowns` de l'état public. **Non bloquant.**

**R-3 — ACL : échec silencieux (avertissement) et protection résiduelle.** Faible.
Par contrat (§3.5), un échec `icacls` n'empêche pas le démarrage (`main.cjs:775-776`). Dans ce cas, la confidentialité de `state.json`/historique repose sur les permissions héritées du dossier parent ; les clés restent protégées par DPAPI. Documenté (`PRIVACY.md` §3, `SECURITY.md` §3).
*Condition :* message visible dans les journaux ; recommander BitLocker et un dossier non partagé. **Non bloquant.**

**R-4 — Mode diagnostic `--remote-debugging-port` exposant le renderer UI en CDP local.** Faible.
`main.cjs:53` détecte l'argument et conserve `DevToolsActivePort`. L'application n'ajoute elle-même aucun drapeau, aucun raccourci livré ne l'utilise (`Lancer ProvidersBar.cmd` = exécution simple), et le fichier est purgé au démarrage suivant hors mode diagnostic. Un lancement explicite expose le renderer au CDP local (non authentifié) — même périmètre local que `verify:connections`, documenté README + `SECURITY.md` §8.
*Condition :* ne jamais livrer de lanceur avec ce drapeau ; relancer normalement après diagnostic. **Non bloquant.**

**R-5 — `~/.claude/.credentials.json.providersbar-*.tmp` non purgé.** Faible.
La purge des `.tmp` ne couvre que le dossier de données (`window-security.cjs:143`). Un arrêt brutal pendant le renouvellement Claude peut laisser un temporaire de jetons dans `~/.claude` (mêmes ACL que le fichier de Claude Code, déjà en clair par conception). Fenêtre étroite, fichier inutile à l'application.
*Recommandation :* purge opportuniste des `providersbar-*.tmp` de `~/.claude` au démarrage (hors périmètre de cette revue). **Non bloquant.**

**R-6 — Portable non signé, sans intégrité de code.** Faible (décision de distribution).
`scripts/package.cjs` copie le runtime Electron et renomme `electron.exe` ; aucune signature Authenticode, pas d'`app.asar` ni de vérification d'intégrité. Les données sont protégées par ACL, mais un dossier d'installation inscriptible par un autre principal permettrait d'altérer le code. Documenté (`SECURITY.md` §6/§8, README §Fabriquer).
*Condition :* provenance officielle, dossier d'installation non partagé ; signature à planifier hors 0.3.0. **Non bloquant.**

### Informatifs (acceptés)

| Id | Constat | Preuve / décision |
| --- | --- | --- |
| I-1 | `app:info` expose le chemin absolu `dataDir` au renderer (contrat §3.1) ; `publicState` n'expose que `{version, electron, packaged}` | `main.cjs:200-212` ; renderer de confiance, CSP, aucune origine distante |
| I-2 | `style-src 'unsafe-inline'` nécessaire aux styles inline des jauges ; **aucun** `unsafe-eval` ni script inline | `renderer/index.html:6` ; test CSP |
| I-3 | `will-frame-navigate` (iframes) non filtré sur les fenêtres de comptes ; contenu distant sandboxé, sans preload, permissions refusées | `window-security.cjs:49-73` ; risque théorique non vérifié, aucun préload accessible |
| I-4 | `readOrcaAccountRef` exécute un script dans la page distante pour lire des identifiants **numériques** ; origine vérifiée avant/après | `main.cjs:357-366` ; inchangé depuis 0.2.1, validé par l'audit initial |
| I-5 | `state.json` et l'export ne sont pas chiffrés au repos | `PRIVACY.md` §6/§10 ; ACL + BitLocker recommandé |
| I-6 | Fichier `test-results/` et `dist/.../data` locaux contiennent des artefacts de développement (profils, journaux) | `gitignore` couvre ; `package:release` crée un dossier neuf sans données (`scripts/package.cjs:9-12`) ; ne jamais distribuer `dist/ProvidersBar-win32-x64/data` |
| I-7 | Documentation : `README.md` ne référence pas encore `PRIVACY.md`/`SECURITY.md` ; CHANGELOG 0.3.0 et `docs/validation-0.3.0.md` sont présents | Condition documentaire C-3 |
| I-8 | Le renouvellement OAuth Claude réécrit le fichier officiel de Claude Code (verrous + écriture atomique), sans copie dans ProvidersBar | `lib/claude-connection.cjs:50-83` ; documenté PRIVACY §4 |

### Points positifs confirmés (non exhaustif)

- Un **seul** point d'entrée IPC filtré ; 25 méthodes de preload nommées, aucun canal dynamique.
- `safeStorage` refusé quand le chiffrement est indisponible (`main.cjs:674`) ; clé jamais renvoyée au renderer ni exportée ; aucune journalisation de clé (aucun `console.log` en production, test « secrets » de `quality.test.cjs`).
- Fenêtres UI et de connexion : sandbox, isolation de contexte, `nodeIntegration:false`, `devTools:false`, permissions refusées, téléchargements refusés (`main.cjs:327-332,435-437`), popups limités.
- Aucune télémétrie : une seule dépendance de production (`proper-lockfile`), `connect-src 'self'`, et le seul `fetch` du renderer cible l'aperçu local `'/'+preview-state`.
- Effacement complet et vérifiable, avec refus pendant synchronisation et purge des caches/partitions.
- Documentation de transparence livrée dans le portable (`app-resources.cjs:24-27`) et garde-fous automatisés (15 tests) qui empêchent la réapparition des régressions corrigées.

---

## 6. Conditions de release

Le code est **GO**. Les conditions suivantes sont **documentaires ou de processus** et peuvent être vérifiées au moment de la publication :

1. **C-1 — Electron :** épingler exactement `44.10.2` dans `package.json` (le lockfile le fait déjà) **ou** justifier la plage `^` ; exécuter `npm audit` complet avant la release (0 aujourd'hui).
2. **C-2 — Données :** ne jamais publier `dist/ProvidersBar-win32-x64/data/`, `.local/` ni `test-results/` ; construire la release propre via `npm run package:release` (dossier neuf, sans données).
3. **C-3 — Documentation :** ajouter les liens `PRIVACY.md`/`SECURITY.md` dans `README.md` (section Documentation/Données) ; conserver `docs/validation-0.3.0.md` et l'entrée CHANGELOG 0.3.0 (présents à la revue).
4. **C-4 — Notes de release :** rappeler (a) binaire non signé, (b) dossier `data/` à ne pas partager et à protéger (BitLocker/ACL), (c) limite malware même utilisateur, (d) mode diagnostic explicite et à refermer après usage.
5. **C-5 — Publication :** vérifier que `PRIVACY.md` et `SECURITY.md` sont bien présents à la racine au moment du build (ils sont embarqués conditionnellement) et que la CI est verte sur `refonte/pro`.

---

## 7. Livrables T7

| Fichier | Contenu |
| --- | --- |
| `analysis/06-revue-securite-finale.md` | présente revue, verdict, prisma des findings, résiduels, conditions |
| `tests/security.test.cjs` | 15 garde-fous automatisés, sans Electron ni réseau : absence de port CDP TCP, args pipe, mode diagnostic, allowlist exacte et effective, fenêtres de compte, CSP, fenêtres UI/IPC, ACL non bloquante, export nettoyé, purge conditionnelle, `data:erase`, absence de télémétrie, cooldowns, Electron/audit, documentation de conformité |
| `PRIVACY.md` | données traitées, chemins, protection (DPAPI/ACL), sessions, jetons Claude Code, réseau, export, effacement, durées, droits, limites (sans promesse de certification) |
| `SECURITY.md` | versions supportées, périmètre/modèle de menace, surfaces et mesures, pratiques (pins, audit, CI, revue), hors périmètre, signalement privé, durcissement, historique |

**Aucun fichier de code applicatif, `package.json`, `README.md` ou documentation existante n'a été modifié.**

## 8. Limites de la revue

- Revue **statique** + tests locaux ; la validation dynamique du transport pipe et du diagnostic est celle du Lead (Chrome 156 réel, `npm run doctor`), non rejouée ici.
- Pas de test d'intrusion, pas de login réel, pas de lecture de jetons ou de données utilisateur.
- Le modèle de menace est celui d'un poste Windows personnel mono-utilisateur ; un adversaire avec le même compte Windows ou un accès physique déverrouillé sort du périmètre (documenté `SECURITY.md` §3/§6).
- Les fichiers `docs/`, `README.md` et `CHANGELOG.md` évoluaient pendant la revue (vague documentation) ; les conditions C-3/C-5 tiennent compte de cet état.
