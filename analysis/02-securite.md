# Audit sécurité et confidentialité — ProvidersBar 0.2.1

**Auditeur :** `securite` (équipe d'analyse) — **Date :** 2026-11-03
**Périmètre :** code applicatif Windows/Electron (`main.cjs`, `preload.cjs`, `lib/*`, `renderer/*`), scripts de build/diagnostic, manifeste et arbre de dépendances, données réellement présentes dans le dossier portable.
**Mode :** analyse statique + inspection du système de fichiers (lecture seule). Aucun test intrusif, aucune requête vers un service réel, aucun lancement de l'application.
**Version auditée :** 0.2.1 (`package.json`), Electron 44.2.0, Node ≥ 24.

---

## 1. Synthèse exécutive

ProvidersBar est une application **locale, mono-utilisateur, sans serveur ni télémétrie**, et sa posture de sécurité est globalement **bonne pour ce type d'application** : frontière renderer↔main très soignée, secrets isolés du state et des exports, jetons Claude jamais copiés, aucun endpoint hors fournisseurs officiels, CSP stricte et échappement HTML systématique.

**Aucun finding Critique n'a été identifié** : je n'ai trouvé aucune vulnérabilité permettant à un attaquant *distant* (site web, fournisseur compromis, contenu distant injecté) d'exécuter du code, de lire les clés ou de voler les sessions sans interaction locale.

Les points qui pèsent réellement sont **locaux et/ou de chaîne d'approvisionnement** :

1. **Élevé — runtime Electron 44.2.0 vulnérable** (7 avis, dont 1 *high* « compromised eMudhra intermediate certificates » et 6 *moderate/low*), et `npm audit --omit=dev` renvoie 0 vulnérabilité parce qu'Electron est une *devDependency* alors que son binaire est **livré** par `scripts/package.cjs`. Correctif disponible : 44.10.2.
2. **Élevé — port CDP non authentifié sur les profils de session connectés.** Les lectures de comptes (Grok, Z.ai, Claude, OpenAI) lancent Chrome avec `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1` sur le profil *déjà connecté* ; tout processus local peut lire `DevToolsActivePort` et se connecter pour exfiltrer les cookies de session en clair — **contournement total de DPAPI**. Fenêtre d'exposition : quelques secondes toutes les 5 minutes (auto-refresh) et jusqu'à ~60 s lors d'une vérification interactive.
3. **Moyen — absence de durcissement ACL sur le dossier de données portable.** `mode: 0o600` est **inopérant sous Windows** ; `credentials.json`, `state.json`, les profils de navigateur et **le code applicatif** héritent des ACL du dossier d'installation (bureau, USB, partage). Sur cette machine, plusieurs SID locaux (`CodexSandboxUsers`, `MuseSandboxUsers`, comptes sandbox) ont `Modify`/`ReadAndExecute` sur `dist\ProvidersBar-win32-x64\data` **et** `resources\app` (constat d'environnement, voir §7).
4. **Moyen — navigation des fenêtres de compte trop permissive** : `will-navigate` n'autorise que HTTPS mais **n'importe quelle origine HTTPS**, et `setWindowOpenHandler` autorise tout `https:` en popup avec la session du compte.
5. **Faible** — plusieurs durcissements manquants : `devTools` actif sur les fenêtres UI, export/backups contenant un identifiant de compte pseudonyme, fichiers `.tmp` de jetons Claude après arrêt brutal, `DevToolsActivePort` résiduel, absence de signature de code.

**Note globale : 7 / 10.** C'est solide pour un outil personnel, mais deux corrections (mise à jour Electron, suppression du CDP TCP sur profils connectés) sont attendues avant de considérer l'application comme « défendable » face à un malware local non privilégié ou à un autre compte Windows.

---

## 2. Tableau récapitulatif

| Id | Sévérité | Finding | Exploitabilité | Preuve principale |
|----|----------|---------|----------------|-------------------|
| E-1 | **Élevé** | Electron 44.2.0 livré avec 7 avis de sécurité (1 high, 5 moderate, 2 low) ; audit prod trompeur | Distante (TLS/MITM, permissions, SameSite), dépend de l'usage | `package.json:19-22`, `scripts/package.cjs:6,12`, `npm audit` |
| E-2 | **Élevé** | CDP TCP non authentifié exposant les profils connectés à tout processus local | Locale, précondition : lire le dossier de données / être un autre utilisateur local | `lib/account-browser.cjs:52-62,91-98` |
| M-1 | Moyen | `mode 0o600` inopérant sous Windows ; aucune ACL explicite sur les données | Locale multi-utilisateurs / dossier partagé | `main.cjs:143-148,631,644` + ACL observées |
| M-2 | Moyen | Code applicatif et données dans le même dossier utilisateur inscriptible, binaire non signé, pas d'intégrité | Locale : altération de `main.cjs`/`preload.cjs` → exécution | `main.cjs:27`, `scripts/package.cjs:9-16`, ACL |
| M-3 | Moyen | Fenêtres de compte : navigation HTTPS arbitraire et popups HTTPS non restreints | Distante/UI : hameçonnage dans une fenêtre de l'app | `main.cjs:257-263` |
| F-1 | Faible | Secret DPAPI *user-scope* sans app-binding (v10), pas de rotation | Locale mono-utilisateur : malware même utilisateur | `main.cjs:522-527` ; blobs observés `76 31 30` |
| F-2 | Faible | Fichier temporaire de jetons Claude en clair si arrêt brutal ; remplacement atomique qui réinitialise une ACL posée sur le fichier | Locale, faible probabilité | `lib/claude-connection.cjs:68-83` |
| F-3 | Faible | Identifiants pseudonymes (SHA-256 non salé de l'e-mail, userId/workspaceId) présents dans `state.json` et l'export | Locale (export partagé) | `lib/openai-account.cjs:83`, `main.cjs:137,593-597` |
| F-4 | Faible | `DevToolsActivePort` résiduel + scripts de diagnostic qui s'y connectent ; switches Chromium acceptés par l'exe | Locale, nécessite un lancement avec le flag | `dist/.../data/DevToolsActivePort`, `scripts/update-portable.cjs:9-29`, `scripts/verify-connections.cjs:10-18` |
| F-5 | Faible | DevTools accessible sur les fenêtres UI (menu par défaut) | Locale, aucune capacité nouvelle | `main.cjs:652-662` (pas de `devTools:false`) |
| F-6 | Faible | Binaires externes résolus via `PATH` (`codex.exe`, `powershell.exe`, `chrome.exe`) | Locale : entrée `PATH` utilisateur inscriptible | `lib/openai-account.cjs:7`, `lib/antigravity-account.cjs:14` |
| F-7 | Faible | Serveur d'aperçu : pas de `frame-ancestors`, CSP en meta, port de dev toujours disponible | Locale (lecture seule, données factices) | `scripts/preview.cjs:9-20`, `renderer/index.html:6` |
| F-8 | Faible | Rétention non bornée des sauvegardes `state.before-*.json` (10 fichiers, ~27 Mo observés) et export en clair de 5 000 relevés | Locale, fuite en cas de partage de dossier | `main.cjs:631,644,593-597`, fichiers observés |

---

## 3. Détail des findings

### E-1 — Runtime Electron 44.2.0 vulnérable ; l'audit « production » est trompeur

**Constat.** `electron` est déclaré en `devDependencies` (`package.json:20`) mais le script de packaging copie **le binaire Electron installé** dans le dossier portable (`scripts/package.cjs:6` `require('electron')`, `:12` `fs.cp(path.dirname(executable), out)`), puis le renomme `ProvidersBar.exe` (`:14`). Le runtime livré est donc Electron **44.2.0**, et non une dépendance de production « inexistante ».

`npm audit --omit=dev` renvoie **0 vulnérabilité** (5 dépendances prod), ce qui est techniquement vrai mais **sans rapport avec le binaire livré**. `npm audit` complet remonte 7 avis sur `electron@44.2.0`, tous corrigés en **44.10.2** (`fixAvailable`, non majeur) :

| Sévérité | Avis | Plage corrigée |
|---|---|---|
| high | GHSA-jr5w-w6x2-84p9 — Mitigation for compromised eMudhra intermediate certificates | < 44.9.1 |
| moderate | GHSA-fw47-9c62-h3vw — HID/USB permission checks attributed to wrong origin | < 44.3.0 |
| moderate | GHSA-2p8c-gr87-2676 — SameSite cookie restrictions not applied to windows opened from links | < 44.3.0 |
| moderate | GHSA-x562-297c-g43g — Pointer lock permission attributed to wrong frame | < 44.5.0 |
| moderate | GHSA-997q-gvvc-jwmx — `openExternal` permission attributed to wrong origin | < 44.3.0 |
| low | GHSA-3qxv-5xgr-q7w9 / GHSA-h3v5-h239-pg29 — géométrie de frame fournie par le GPU | < 44.4.3 |

**Scénario d'attaque.** Le plus pertinent ici est l'avis *high* : un certificat frauduleux enchaînant sur une AC intermédiaire compromise peut être accepté lors des connexions HTTPS sortantes (services de quotas, OAuth Claude, portefeuille Orca). Les avis SameSite/`openExternal` sont aggravés par l'usage réel de l'app : fenêtres ouvertes par des liens (`main.cjs:261`) et appels `shell.openExternal` (`main.cjs:133`). Les avis HID/USB et pointer-lock sont peu exploitables (aucune demande de permission n'est accordée : `main.cjs:234-235`), mais restent des correctifs gratuits.

**Correctif.** Passer à `electron@44.10.2` (ou la dernière 44.x) dans `package.json` + `package-lock.json`, puis **auditer l'arbre complet** (`npm audit`, pas `--omit=dev`) en CI/release ; ajouter une étape de vérification au script `package:release`. À défaut, documenter l'acceptation de risque — mais il n'y a aucune raison de garder 44.2.0.

---

### E-2 — Port CDP non authentifié sur les profils de session connectés

**Constat.** Pour lire Grok, Z.ai, Claude et OpenAI (Codex mis à part), `openAccountBrowser` lance Chrome/Edge ainsi :

```
lib/account-browser.cjs:52-54   profile = dataDir/account-browsers/<id>   (profil dédié, persistant)
lib/account-browser.cjs:58      suppression du DevToolsActivePort périmé
lib/account-browser.cjs:62      spawn(executable, ['--user-data-dir=…',
                                  '--remote-debugging-address=127.0.0.1',
                                  '--remote-debugging-port=0', …, url])
lib/account-browser.cjs:91-98   lecture de <profile>/DevToolsActivePort puis
                                  new WebSocket('ws://127.0.0.1:<port>/devtools/browser/<uuid>')
```

Ce port est **non authentifié** : le protocole CDP ne vérifie que l'en-tête `Host` (anti-DNS-rebinding), pas l'identité de l'appelant. Le profil ouvert est celui **où l'utilisateur est connecté** (Claude, Grok, Z.ai, ChatGPT), et il reste ouvert pendant toute la lecture : jusqu'à ~60 s en vérification interactive (`lib/subscription-controller.cjs:33` : 120 tentatives × 500-1000 ms) et quelques secondes **toutes les 5 minutes** en arrière-plan (`main.cjs:686` → `syncAll` → `subscriptionAccounts.read(id, { background: true })` → `lib/account-browser.cjs:293-294` headless).

**Scénario d'attaque.** Un processus local non privilégié (malware, autre compte Windows, utilisateur du sandbox) :
1. surveille `…\data\account-browsers\<id>\DevToolsActivePort` (fichier lisible si le dossier est lisible — voir M-1) ;
2. ouvre `ws://127.0.0.1:<port>/devtools/browser/<uuid>` ;
3. appelle `Target.getTargets` / `Network.getAllCookies` ou `Runtime.evaluate` dans la page connectée pour extraire les cookies de session, déclencher des `fetch` authentifiés et lire les quotas/comptes.

Cela **contourne entièrement DPAPI** : les cookies au repos sont chiffrés par Windows (clé liée à l'utilisateur), mais ici ils sont servis en clair par le port de débogage, y compris à un **autre utilisateur local** (le loopback Windows n'est pas cloisonné par utilisateur).

**Ce qui limite déjà l'impact (à créditer).** Le port est aléatoire (`=0`) et limité à `127.0.0.1` ; le profil est dédié à ProvidersBar (pas de profil navigateur partagé) ; `DevToolsActivePort` est supprimé avant lancement (`:58,205`) ; le port n'est ouvert que pour le processus lecteur, pas pendant la phase de login utilisateur (`openNativeLogin` n'active aucun port, `:254`). Le risque reste réel mais **borné dans le temps**.

**Correctifs recommandés (par ordre de préférence).**
1. **Supprimer le CDP TCP** : effectuer la lecture dans un `BrowserWindow`/`WebContentsView` Electron sur la partition `persist:<id>-account` (le pattern existe déjà pour Orca/Ollama, `main.cjs:274-275,366-368`) puis `webContents.executeJavaScript(...)` sur le même modèle que `readOrcaAccountRef` (`main.cjs:298-307`). Plus aucun port local.
2. À défaut, durcir le profil : ACL explicite refusant tout autre SID sur `data/account-browsers` (voir M-1), et supprimer `DevToolsActivePort` dès la fin de la lecture.
3. Ne jamais exposer ce mode en production : réserver `--remote-debugging-port` aux scripts de diagnostic (aujourd'hui `scripts/verify-connections.cjs:10-18` et `scripts/update-portable.cjs:9-29` s'appuient sur ce fichier).

---

### M-1 — `0o600` inopérant sous Windows ; aucune ACL explicite sur les données

**Constat.** L'écriture atomique pose `mode: 0o600` (`main.cjs:146`), de même que les sauvegardes de migration (`main.cjs:631,644`) et le fichier temporaire des jetons Claude (`lib/claude-connection.cjs:71`). **Sous Windows, Node.js n'applique que le bit lecture seule** : le paramètre `mode` n'a aucun effet sur la DACL. Les fichiers reçoivent donc les ACL **héritées du dossier** :

- dossier de données = `path.dirname(process.execPath)/data` en mode portable (`main.cjs:27`), donc souvent le Bureau, une clé USB ou un dossier partagé ;
- fichiers concernés : `credentials.json` (chiffré DPAPI), `state.json` + sauvegardes (historique complet), `account-browsers/<id>` (profils Chrome complets, cookies chiffrés DPAPI), `Partitions/*` (cookies Electron), `Local Storage`, `Network/Cookies`.

**Constat d'environnement (non imputable au code).** Sur cette machine, `Get-Acl` montre `Modify` pour `HP-OMEN-LASME\CodexSandboxUsers` et plusieurs SID de comptes sandbox, et `ReadAndExecute` pour `MuseSandboxUsers`, sur `dist\ProvidersBar-win32-x64\data`, `dist\...\resources` **et** `%USERPROFILE%\.claude`. Ce sont des ACL posées par l'outillage de développement ; elles illustrent concrètement qu'un dossier portable hérite de tout ce que le dossier parent accorde.

**Scénario d'attaque.** Sur un PC partagé, avec un dossier de données sur un partage réseau ou une clé USB : un autre utilisateur lit `state.json`/l'historique, écrase `state.json` (intégrité), remplace `account-browsers/<id>` (déni de service) ; il peut aussi lire `~/.claude/.credentials.json` (jetons OAuth en clair, par conception de Claude Code) si l'ACL du profil utilisateur est permissive — ce qui est précisément le cas ici.

**Correctif.** Au démarrage, appliquer une DACL explicite sur `dataDir` via `icacls` (équivalent Windows de `chmod 600`) :
`icacls "<dataDir>" /inheritance:r /grant:r "%USERNAME%":(OI)(CI)F /grant:r "SYSTEM":(OI)(CI)F /grant:r "Administrators":(OI)(CI)F`
sinon basculer par défaut sur `%LOCALAPPDATA%\ProvidersBar` (profil utilisateur, ACL correcte par héritage) et réserver le mode « portable » à une clé chiffrée (BitLocker To Go). Documenter que le dossier `dist` ne doit jamais être partagé.

---

### M-2 — Code et données dans le même dossier inscriptible ; aucune intégrité ni signature

**Constat.** `scripts/package.cjs:12-16` copie le runtime Electron, `scripts/app-resources.cjs:19-22` copie `main.cjs`, `preload.cjs`, `lib/`, `renderer/` en clair dans `resources/app` (pas d'`app.asar`), puis l'exe est un simple renommage d'`electron.exe` (`:14-15`). `main.cjs:27` place les données **à côté** de ce code. Aucun contrôle d'intégrité, aucune signature Authenticode, aucune vérification de mise à jour (`scripts/update-portable.cjs` ne fait que copier des fichiers locaux).

**Scénario d'attaque.** Si le dossier est inscriptible par un autre principal (cf. ACL observées, M-1), cet attaquant modifie `resources/app/lib/credential-store.cjs` ou `preload.cjs` : à la prochaine ouverture, exécution de code dans le contexte du propriétaire légitime — avec accès à `safeStorage` (donc aux clés en clair) et à `~/.claude`. Même conséquence si l'utilisateur télécharge un zip d'une source non vérifiée.

**Correctif.** (a) Signer `ProvidersBar.exe` et les resources (ou au minimum publier un SHA-256 avec la release) ; (b) empaqueter en `app.asar` avec `asarIntegrity`/fuses Electron (`EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, `RunAsNode: false`) ; (c) documenter l'installation dans un dossier non inscriptible par les autres utilisateurs (`%LOCALAPPDATA%\Programs`), avec données dans `%LOCALAPPDATA%`.

---

### M-3 — Navigation des fenêtres de compte trop permissive (hameçonnage dans une fenêtre de l'app)

**Constat.** `secureAccountWindow` (`main.cjs:257-263`) :

```
:259  will-navigate  → preventDefault seulement si le schéma n'est pas https:
:260  will-redirect  → idem
:261  setWindowOpenHandler → { action: 'allow' } pour TOUTE url https:
```

Toute page distante chargée dans la fenêtre de connexion (Orca, Ollama) peut donc :
- naviguer la fenêtre vers **n'importe quelle origine HTTPS** (le garde-fou porte sur le schéma, pas sur l'hôte) ;
- ouvrir une popup HTTPS arbitraire qui hérite de la même session persistante (`session: window.webContents.session`) ;
- ces popups sont re-durcies par récursion `did-create-window` (`:262`) mais **aucune liste d'hôtes** n'est appliquée.

**Scénario d'attaque.** Une page fournisseur compromise (ou un contenu tiers embarqué) ouvre `window.open('https://connexion-compte.example')` ; la fenêtre, sans barre d'adresse ni chrome, ressemble à une étape de connexion légitime et invite à saisir des identifiants. Variante : navigation de la fenêtre entière vers une page de hameçonnage. Aucun accès Node/IPC n'est possible (sandbox, pas de preload explicite), donc l'impact est de l'**ingénierie sociale**, pas une compromission directe.

**Correctif.** Restreindre `will-navigate`/`will-redirect` à une allowlist d'origines par fournisseur (`ACCOUNT_ORIGINS[id]` + hôtes d'authentification nécessaires : `accounts.google.com`, `login.microsoftonline.com`) et refuser le reste ; dans `setWindowOpenHandler`, n'autoriser que `https:` **et** une allowlist d'hôtes, sinon `{action: 'deny'}`. Afficher l'origine courante dans le titre de la fenêtre de connexion.

---

### F-1 — DPAPI *user-scope* sans app-binding, pas de rotation de clé

**Constat.** `safeStorage.encryptString` (`main.cjs:526`) produit, sous Windows, un blob `v10` (constaté : les 4 valeurs de `credentials.json` commencent par `76 31 30` = `"v10"`), c'est-à-dire une clé AES protégée par DPAPI au niveau **utilisateur**. Conséquences : (a) tout processus du même utilisateur peut déchiffrer `credentials.json` ; (b) pas d'app-binding (contrairement à l'App-Bound Encryption de Chrome) ; (c) aucune rotation/re-chiffrement, aucun contrôle de version. La clé en clair existe en mémoire dans `syncOne` (`main.cjs:214-216`) puis est envoyée en `Authorization: Bearer` à l'endpoint du fournisseur (`lib/connectors.cjs:70`).

**Atténuations présentes (à créditer).** Aucun fallback en clair : si `safeStorage.isEncryptionAvailable()` est faux, `provider:connect` **refuse avant tout envoi de la clé** (`main.cjs:522`) ; si le déchiffrement échoue (autre machine, profil DPAPI perdu), l'erreur est explicite et rien n'est réécrit en clair (`main.cjs:214-215`) ; `credential-store.cjs:6` refuse un fichier corrompu sans écraser l'existant ; le fichier de clés est séparé du state et **jamais exporté** (`main.cjs:596` n'écrit que `state` ; tests `scripts/smoke.cjs:151-156,193,429-434`).

**Correctif.** Assumer et documenter le résidu de risque (threat model « malware même utilisateur = compromis »), et réduire la surface : éviter de conserver les clés en mémoire au-delà du nécessaire (aujourd'hui la variable `key` vit le temps du `syncOne` : acceptable), ne jamais journaliser (vérifié : aucun `console.*` ne reçoit de secret, `main.cjs:641,685` uniquement), et à terme migrer vers Windows Credential Manager ou un chiffrement avec entropie liée à l'application.

---

### F-2 — Jetons Claude : fichier temporaire en clair et ACL réinitialisée par le remplacement atomique

**Constat.** `atomicCredentials` (`lib/claude-connection.cjs:68-83`) écrit `~/.claude/.credentials.json.providersbar-<uuid>.tmp` en `wx` **contenant access_token et refresh_token en clair**, `sync()`, puis `rename`. Le `finally` supprime le temporaire (`:82`), mais un arrêt brutal (kill, coupure, BSOD) entre `writeFile` et `rename` laisse un fichier de jetons valides sur disque, sans nettoyage au démarrage suivant. Par ailleurs, `rename` sur Windows **remplace la cible par un nouveau fichier** : une DACL explicite posée manuellement sur `.credentials.json` est remplacée par les ACL héritées du dossier `~/.claude`. Enfin, l'application **écrit dans le magasin d'un autre logiciel** (Claude Code) — c'est documenté (`README:57`, `docs/architecture.md:27`) et protégé par les deux verrous de Claude Code (`:50-66`), mais cela reste une dépendance à un format non versionné.

**Scénario d'attaque.** Faible probabilité : nécessite un arrêt au mauvais instant, puis la lecture du dossier `~/.claude` par un autre principal. Impact : vol de jeton OAuth (accès aux quotas, voire à l'inférence selon les scopes).

**Correctif.** Au démarrage, purger les `~/.claude/.credentials.json.providersbar-*.tmp` (et les `.tmp` du dossier de données) ; écrire le temporaire avec une DACL restreinte (ou dans un sous-dossier temporaire à ACL par défaut du profil), et prévoir un fallback « écrire dans le fichier existant après copie de sauvegarde » si la DACL de la cible est plus restrictive que celle du dossier.

---

### F-3 — Identifiants pseudonymes présents dans l'état et l'export

**Constat.** `state.json` et `state.export` contiennent `providers[openai].accountSession.identity` = SHA-256 **non salé** de l'e-mail en minuscules (`lib/openai-account.cjs:83`, conservé dans `main.cjs:137`) et `providers[orcarouter].accountSession = {userId, workspaceId}` (observé : `{userId:102647, workspaceId:102238}`). Aucun jeton, aucune clé (vérifié par scan des données réelles et par les tests). Mais un export partagé expose un identifiant réversible par dictionnaire (e-mail → SHA-256) et les identifiants numériques de compte.

**Correctif.** HMAC avec un secret local (clé aléatoire stockée via `safeStorage`) plutôt que SHA-256 nu, et exclure `accountSession` de l'export (ou le remplacer par un booléen `connected`).

---

### F-4 — `DevToolsActivePort` résiduel et scripts de diagnostic

**Constat.** `dist\ProvidersBar-win32-x64\data\DevToolsActivePort` existe (60 octets) alors que l'application **n'active aucun port de débogage par elle-même** : le fichier provient de lancements de diagnostic. `scripts/update-portable.cjs:9-29` et `scripts/verify-connections.cjs:10-18` s'en servent pour se connecter en CDP et fermer/piloter l'app. Les garde-fous existent (URL exacte de l'UI vérifiée, `verify-connections.cjs:14-16`), mais le fichier résiduel est un artefact à ne pas livrer. Rappel : tout exe Electron accepte `--remote-debugging-port` en ligne de commande, ce qui donnerait à un processus local un accès complet au renderer et à la passerelle `providersBar` (état, connexions, export) — mais il faut pour cela lancer l'exe avec le flag (action locale).

**Correctif.** Supprimer ce fichier du dossier portable avant livraison et l'ajouter au nettoyage de `scripts/package.cjs` ; ne jamais créer de raccourci avec ce flag ; documenter que `verify-connections` est un outil de développeur.

---

### F-5 — DevTools actifs sur les fenêtres UI

**Constat.** Les fenêtres UI (`main.cjs:652-662`) n'ont pas `devTools: false` ; le menu Electron par défaut (`autoHideMenuBar: true`, aucun `Menu.setApplicationMenu(null)`) permet d'ouvrir les DevTools. Les fenêtres de compte, elles, ont bien `devTools: false` (`main.cjs:275,367,261`).

**Impact.** Un utilisateur local (ou un malware avec accès physique/session) peut ouvrir la console du renderer et appeler `window.providersBar` — mais il peut déjà cliquer dans l'UI. Aucune capacité supplémentaire, surface inutile.

**Correctif.** `webPreferences.devTools: false` + `Menu.setApplicationMenu(null)` en production (ou menu minimal), et `app.commandLine.appendSwitch('disable-features', ...)` inutile ici.

---

### F-6 — Résolution de binaires via `PATH`

**Constat.** `findCodex` privilégie les entrées `PATH` avant le dossier d'installation (`lib/openai-account.cjs:7-10`) ; `powershell.exe` (`lib/antigravity-account.cjs:14`) et `chrome.exe`/`msedge.exe` (`lib/account-browser.cjs:34-43`, `Program Files` d'abord puis `LOCALAPPDATA`) sont aussi résolus par nom/chemin.

**Impact.** Faible : exploiter suppose de contrôler une entrée `PATH` ou `LOCALAPPDATA` de l'utilisateur — auquel cas l'attaquant a déjà les mêmes droits. Le script PowerShell d'Antigravity est une **constante** non interpolée (pas d'injection de commande) et filtre sur le chemin exact de l'exe (`:18-19`), ce qui est correct.

**Correctif.** Inverser l'ordre pour Codex (dossier d'installation d'abord), et valider la signature Authenticode de `codex.exe`/`chrome.exe` avant lancement.

---

### F-7 — Serveur d'aperçu (`scripts/preview.cjs`)

**Constat vérifié.** Le serveur écoute `127.0.0.1:4317` et sert une **liste fermée** de chemins (`routes`, `:9-13`) ; aucun `path.join` avec l'URL brute, donc **pas de traversée de répertoire** : `const file = routes[url.pathname]` puis `path.join(__dirname,'..',file)` sur une valeur de la table (`:19-20`). `/preview-state` renvoie `createSeed()` (données factices, aucun compte) ; le renderer reçoit `desktop:false` et désactive toutes les écritures (`renderer/app.js:332,390`). Aucun en-tête CORS n'est émis (pas d'`Access-Control-Allow-Origin`), donc un site web ne peut pas lire les réponses.

**Points mineurs.** (a) CSP en balise `<meta>` (`renderer/index.html:6`) et pas d'en-tête `Content-Security-Policy`/`frame-ancestors` : la page de prévisualisation est encadrable (clickjacking sans conséquence, elle est en lecture seule) ; (b) le serveur de dev reste lançable à tout moment (`npm run preview`) — ne pas le laisser tourner pendant l'usage réel.

**Correctif.** Ajouter `frame-ancestors 'none'` au CSP et émettre le CSP + `X-Content-Type-Options: nosniff` en en-têtes HTTP ; rappeler dans le README que `preview` est réservé au développement.

---

### F-8 — Rétention des sauvegardes et export en clair

**Constat.** Migrations : `state.before-subscription-removal.json` et `state.before-orca-balance-fix.json` sont écrits en `wx` (`main.cjs:631,644`) et **jamais purgés** ; le dossier porte également 8 autres `state.before-*.json` issus de sauvegardes manuelles (≈ 27 Mo de relevés personnels observés). L'export (`main.cjs:593-597`) écrit tout le state (jusqu'à 5 000 relevés) en JSON non chiffré à l'emplacement choisi. Aucun de ces fichiers ne contient de clé (vérifié par scan des données réelles et tests).

**Correctif.** Politique de rétention (conserver au plus N sauvegardes / 30 jours), et avertir que l'export est un fichier en clair à protéger.

---

## 4. Ce qui est bien fait (contrôles vérifiés)

Ces points ne sont pas des constats de complaisance : ils ont été vérifiés dans le code et, quand c'était possible, dans les tests existants.

**Frontière renderer ↔ main**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` sur **toutes** les fenêtres applicatives (`main.cjs:652,275,367,261`) ; aucun `webview`, aucun `enableRemoteModule`.
- Passerelle IPC unique et **filtre de frame** : chaque `ipcMain.handle` vérifie `event.senderFrame === event.sender.mainFrame` **et** `frame.url.split('?')[0] === uiUrl` (`main.cjs:439-446`) — un contenu distant, une popup ou un iframe ne peuvent pas appeler l'IPC même s'ils héritaient du preload.
- Preload minimal et explicite : 24 méthodes nommées, aucune primitive générique (`preload.cjs:2-25`).
- Fenêtres UI : `setWindowOpenHandler` → `deny`, `will-navigate` → `preventDefault`, permissions (`camera`, `geolocation`, notifications…) **toutes refusées** (`main.cjs:231-236`) ; même politique sur les sessions de compte (`:268-269,363-364,371`).
- Validation systématique des payloads IPC : `validatePatch` (`lib/domain.cjs:12-46`), `manualSnapshot` (`:47-58`), `quotaResets.validate` (`lib/quota-resets.js:29-42`), `usageStrategy.validate` (liste blanche de clés, bornes numériques, modèles/routes connus), `settings:update` typé (`main.cjs:584`), `window:quick-size` borné (`:452-460`). Aucun `id` arbitraire n'est accepté : `provider(id)` lève pour tout id inconnu (`:162-166`).
- CSP stricte et sans `unsafe-eval` : `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'` (`renderer/index.html:6`). Aucun script inline (seul `theme-init.js` externe), aucun `eval`/`new Function` dans le renderer.
- Rendu HTML : `escapeHtml` appliqué de façon quasi systématique aux valeurs dynamiques (`renderer/app.js:20`, puis `:34,70,72,158,161,166,170,171,178,187,192,203,213,245,250,286,293,294,297,302,309,317,321,329`) — y compris les libellés issus de réponses distantes (`quotaWindows[].label`, `details[].label`). Les seules interpolations non échappées sont des nombres validés et des `p.id` provenant du seed/state local (cf. M-1 pour le cas « state altéré »).

**Secrets et sessions**
- Clés API : chiffrées `safeStorage`/DPAPI uniquement, **refus d'enregistrement si le chiffrement est indisponible** (`main.cjs:522`), **vérification auprès du fournisseur avant remplacement** d'une clé qui fonctionne (`:523-529`), fichier séparé du state, jamais exporté, jamais renvoyé au renderer (`publicState`, `:154-157` ne contient aucune clé).
- Le renderer ne reçoit jamais de clé ni de jeton ; le champ de saisie est vidé après connexion (`renderer/app.js:405`) et n'est jamais rendu en clair (`type="password"`).
- Sessions navigateur : profil `--user-data-dir` **dédié par fournisseur** (`lib/account-browser.cjs:52-54`), `DevToolsActivePort` périmé supprimé avant lancement (`:58,205`), nettoyage récursif **restreint au profil temporaire créé** (`:70-77`), suppression du profil vérifiée par `realpath` + `basename` (`:182-197`) — pas de suppression arbitraire.
- Import de cookies Ollama : **filtre de domaine strict** (`ollama.com` uniquement, rejeté pour `accounts.google.com`, `.evilollama.com`, `ollama.com.evil.example`, `ollama.com.evil…`) et mapping `sameSite`/`httpOnly` explicite (`lib/account-browser.cjs:26-33`), couvert par test (`tests/account-browser.test.cjs:23-29`). Les cookies Google ne sont **jamais** lus (`Network.getCookies` limité à `ollama.com/settings`, `:167`).
- Orca : ne quittent la page distante que des identifiants numériques (`main.cjs:298-307`), l'origine est vérifiée avant et après (`:299`), le portefeuille est validé numériquement (`lib/orca-account.cjs:3-15`), `clearStorageData` à la déconnexion (`main.cjs:565,572`).

**Jetons OAuth Claude Code**
- **Aucune copie** dans les données ProvidersBar : `state.providers.claude.accountSession = {kind:'claude-live-local'}` uniquement ; `claudeSync` ne persiste que `{nextAttemptAt, errorCode}` (`lib/claude-live-usage.cjs:102-109`) — vérifié dans le state réel et par test (`scripts/smoke-claude.cjs:76-77` : `!persisted.includes('fixture-only')`).
- Aucune journalisation de jeton : erreurs remplacées par des messages génériques (`lib/claude-live-usage.cjs:89-96`), test explicite de non-fuite du jeton dans `error.message` (`tests/claude-live-usage.test.cjs:92-93`), `JSON.stringify(snapshots)` vérifié sans jeton (`:75`).
- Renouvellement robuste : deux verrous compatibles Claude Code (`.oauth_refresh.lock` + verrou historique, stale 60 s, heartbeat 5 s, `lib/claude-connection.cjs:50-66`), écriture atomique (tmp+`sync`+`rename`), **comparaison des jetons avant écriture** pour ne pas écraser un login concurrent (`:88-103`), adoption d'un jeton renouvelé par un autre processus, protection contre la réutilisation d'un refresh token mort (`deadRefreshToken`, `:113,126`), validation stricte des réponses OAuth (statuts, `expires_in` borné, scopes, refresh token) (`:124-137`), `redirect: 'error'` (pas de fuite de jeton vers une redirection), timeout 20 s.
- Lecture des credentials bornée (fichier ≤ 64 Ko, jeton non vide ≤ 16 Kio sans CR/LF) et erreur unique `auth-unavailable` sans détail (`:35-46`).

**Réseau / TLS**
- Inventaire d'endpoints **exhaustif et fermé** : `openrouter.ai`, `api.deepseek.com`, `api.runinfra.ai`, `platform.claude.com`, `api.anthropic.com`, `chatgpt.com`, `claude.ai`, `grok.com`, `z.ai`, `ollama.com`, `www.orcarouter.ai` (`lib/provider-catalog.cjs:22,29,36`, `lib/claude-connection.cjs:11`, `lib/claude-live-usage.cjs:4`, `lib/subscription-accounts.cjs:2-7`, `lib/orca-account.cjs:1`). **Aucune télémétrie, aucun analytics, aucun CDN** ; les logos sont embarqués (`assets/providers/`).
- Toutes les requêtes sortantes utilisent `redirect: 'error'` (clés/jetons jamais renvoyés vers une redirection) : `lib/connectors.cjs:70`, `lib/claude-connection.cjs:119`, `lib/claude-live-usage.cjs:60`, `lib/orca-account.cjs:21` ; Ollama gère les redirections manuellement et revalide l'origine finale (`lib/ollama-account.cjs:97-105`).
- Timeouts et annulation partout (`AbortSignal.timeout`), taille de réponse bornée pour Antigravity (512 Ko, `lib/antigravity-account.cjs:35`), Claude Desktop (1 Mo, `lib/claude-desktop-usage.cjs:8`), credentials (64 Ko).
- Validation stricte des réponses avant persistance : schémas, devises en liste blanche, sommes finies/bornées, pourcentages 0-100, dates ISO vérifiées, détection des valeurs contradictoires (`lib/connectors.cjs:12-57`, `lib/claude-live-usage.cjs:7-46`, `lib/antigravity-account.cjs:49-67`, `lib/openai-account.cjs:57-75`, `lib/ollama-account.cjs:37-94`, `lib/subscription-accounts.cjs:307-326`). **Aucune estimation silencieuse** : format inconnu ⇒ erreur, dernier relevé conservé.
- TLS : **aucun** handler `certificate-error` ni `setCertificateVerifyProc` — la validation Chromium/Node par défaut s'applique. La **seule** exception `rejectUnauthorized: false` est confinée à un `https.request` vers `127.0.0.1` sur un port dont le processus propriétaire est vérifié par chemin exact (`lib/antigravity-account.cjs:11-47`) : risque résiduel = réutilisation de port entre la découverte et la requête (théorique, non vérifié, fenêtre de quelques ms) ; le jeton CSRF ne quitte pas la mémoire.
- `shell.openExternal` n'est appelé qu'après validation stricte `https:` + **liste blanche d'hôtes** OpenAI (`lib/openai-account.cjs:128-131`) : pas d'ouverture d'URL arbitraire depuis le renderer.

**Chaîne d'approvisionnement**
- Versions **épinglées exactes** (aucun `^`/`~`) et lockfile avec `integrity` SHA-512 pour chaque paquet (`package.json:19-28`, `package-lock.json`).
- Une **seule** dépendance de production (`proper-lockfile@4.1.2`, sans vulnérabilité connue) ; l'arbre prod ne contient que 5 paquets. Le runtime du portable est assemblé à partir des dépendances réellement installées (`scripts/runtime-dependencies.cjs`), avec vérification que chaque paquet copié est bien sous `node_modules` du workspace.
- `npm audit --omit=dev` : **0 vulnérabilité** (mais voir E-1 pour Electron).
- `.gitignore` couvre correctement les données personnelles et secrets : `data/`, `credentials.json`, `state.json`, `state.before-*.json`, `account-browsers/`, `Partitions/`, `DevToolsActivePort`, `.env*`, `*.pem`, `*.key`, `*.log`, `*.tmp` ; `git ls-files` confirme qu'**aucun** fichier de données n'est suivi, et `git status` est propre.
- Historique Git : un « tableau de bord mobile privé via Tailscale » a existé puis a été **entièrement annulé** (`27b3159` → `f537ba0`, 20 fichiers). Le code actuel n'ouvre **aucun port réseau** et `git grep` ne trouve plus aucune référence. (Si la fonctionnalité revient, elle devra être re-auditée : le serveur annulé utilisait un jeton et une allowlist `*.ts.net`, mais exposait l'état des comptes sur le réseau.)

**Tests de sécurité existants (à créditer)**
- `scripts/smoke.cjs:151-156` : la clé en clair n'apparaît jamais dans `credentials.json` ; `:193` idem après remplacement ; `:429-434` : l'export ne contient pas la clé.
- `scripts/smoke-claude.cjs:76-77` : aucun jeton persisté dans `state.json`.
- `tests/claude-connection.test.cjs` : rotation concurrente, écriture atomique, réutilisation, révocation.
- `tests/account-browser.test.cjs` : filtrage des cookies par domaine, absence de fenêtre pour les refresh automatiques Grok.
- `tests/claude-desktop-usage.test.cjs`, `tests/ollama-account.test.cjs`, `tests/orca-account.test.cjs` : validation des formats et des erreurs.

---

## 5. Dépendances — détail

| Paquet | Version | Rôle | Verdict |
|---|---|---|---|
| `electron` | 44.2.0 (devDep, **livré**) | runtime de l'application | **7 avis (1 high, 5 moderate, 2 low)** → passer à **44.10.2** |
| `proper-lockfile` | 4.1.2 (prod) | verrous OAuth Claude | OK, aucune vulnérabilité connue |
| `playwright` / `playwright-core` | 1.63.0 (dev) | tests/smoke | non livré, OK |
| `graceful-fs`, `retry`, `signal-exit` (transitifs prod) | 4.2.11 / 0.12.0 / 3.0.7 | via proper-lockfile | OK |

**Bloquant vs informatif :** seul **Electron 44.2.0** est bloquant à terme (correctif disponible, changement mineur, aucune régression d'API attendue). Le reste est informatif. `npm audit --omit=dev` doit être complété par `npm audit` dans la procédure de release, sinon le binaire livré n'est jamais audité.

---

## 6. Évaluation par axe de la mission

| Axe | Constat |
|---|---|
| Stockage/chiffrement des clés | Clés chiffrées DPAPI, refus si chiffrement indisponible, aucune fuite vers le renderer/export. Résidus : pas d'app-binding (F-1), permissions fichiers non appliquées sous Windows (M-1). |
| Frontière renderer↔main | **Très bonne** : sandbox+isolation partout, IPC filtré par frame, payloads validés, CSP stricte, échappement HTML systématique, aucun `eval`. |
| Navigation des comptes web | Profils dédiés et sessions isolées (bon), mais ports CDP exposés (E-2) et navigation/popups HTTPS non restreints (M-3). |
| Jetons OAuth Claude | **Très bon** : aucune copie, aucun log, verrous, atomique, comparaison, adoption, bornes. Résidus : `.tmp` en clair (F-2), écriture dans le magasin d'un tiers. |
| Réseau / TLS | **Très bon** : endpoints fermés, `redirect:'error'` partout, validation stricte, aucune télémétrie, exception auto-signée limitée au loopback vérifié. Uniquement la dette Electron (E-1). |
| Surface locale | CDP sur profils connectés (E-2, le point le plus sérieux) ; serveur d'aperçu correct mais sans `frame-ancestors` ; `DevToolsActivePort` résiduel ; pas de signature/intégrité du portable (M-2). |
| Confidentialité | Pas de télémétrie, pas de clé/jeton dans les données ; identifiants pseudonymes exportés (F-3), sauvegardes non purgées (F-8). |

---

## 7. À vérifier manuellement

Ces points ne peuvent pas être tranchés par analyse statique, ou dépendent de la machine cible. Aucun n'est un finding : ils sont à tester avant de conclure.

1. **`safeStorage` sur la machine cible** : vérifier `safeStorage.isEncryptionAvailable() === true` au premier lancement, puis après un changement de mot de passe Windows / une restauration de profil. Vérifier que la perte de clé DPAPI produit bien le message de `main.cjs:214-215` et **aucun** enregistrement en clair.
2. **ACL effectives du dossier de données** sur la machine de l'utilisateur : `icacls "…\data"` et `icacls "…\resources\app"`. Sur cette machine, `CodexSandboxUsers`/`MuseSandboxUsers` et plusieurs SID sandbox y ont accès (artefact d'environnement) — à rejouer hors outillage de dev.
3. **Héritage du preload par `window.open`** : Electron hérite des `webPreferences` du parent pour les fenêtres issues de `window.open`, et l'override (`main.cjs:261`) ne fixe pas `preload`. Vérifier expérimentalement qu'une popup ouverte depuis une page de compte ne reçoit pas la passerelle `providersBar` ; en tout état de cause le filtre d'URL (`main.cjs:443`) rend l'IPC inopérant depuis une origine distante — le confirmer par un test.
4. **Fenêtre CDP effective** (E-2) : lancer l'app, déclencher une synchronisation de Grok/Z.ai et mesurer combien de temps `DevToolsActivePort` existe, et si un second processus du même utilisateur (ou d'un autre compte local) parvient à se connecter au socket. **Test à faire uniquement sur une copie de profil de test**, pas sur les sessions réelles.
5. **Réelle indisponibilité du chiffrement** : simuler (`safeStorage.isEncryptionAvailable` forcé à `false` via un test unitaire ou un profil Windows dégradé) et vérifier qu'aucune clé n'est écrite, ni envoyée au fournisseur.
6. **Arrêt brutal pendant un renouvellement Claude** : tuer le processus pendant `atomicCredentials` et vérifier la présence éventuelle de `~/.claude/.credentials.json.providersbar-*.tmp` (F-2) ; vérifier aussi que `~/.claude/.credentials.json` reste lisible par Claude Code après un cycle.
7. **Déconnexion réelle** : confirmer qu'un « Déconnecter » côté ProvidersBar invalide la session côté fournisseur ou, à défaut, documenter que seule la copie locale est effacée (les cookies restent valides côté serveur).
8. **Portée de l'export** : ouvrir un export et vérifier la présence de `accountSession.identity` et des identifiants Orca (F-3), et décider s'ils doivent être retirés.
9. **Serveur d'aperçu** : vérifier depuis un navigateur que `http://127.0.0.1:4317/../../credentials.json` (et variantes encodées) renvoie bien 404, et qu'aucun en-tête CORS n'est émis.
10. **Binaire portable** : vérifier la signature Authenticode (attendue absente), le comportement SmartScreen, et qu'aucun `DevToolsActivePort` ni `data/` ne sont livrés dans l'archive de release.
11. **`--remote-debugging-port`** : vérifier qu'aucun raccourci/script livré ne lance l'app avec ce flag (aujourd'hui seuls les scripts de dev le font), et que `ProvidersBar.exe --remote-debugging-port=0` n'est pas documenté.
12. **Ré-audit si le tableau de bord mobile Tailscale est réintroduit** (fonctionnalité annulée, `f537ba0`) : elle ouvrait un serveur HTTP réseau et exposait l'état des comptes avec un jeton — surface entièrement nouvelle.
13. **Audit npm au moment de la release** : relancer `npm audit` complet avec le registre à jour (aujourd'hui l'arbre épinglé donne 44.2.0 → 44.10.2 disponible).

---

## 8. Note globale et priorités

**Note : 7 / 10.**

- **Conception** (isolation, secrets, réseau, validation) : 9/10 — nettement au-dessus de la moyenne des applications Electron personnelles. Les choix sont documentés (`docs/architecture.md`) et les tests couvrent les propriétés sensibles.
- **Hygiène opérationnelle** (dépendances, durcissement Windows, distribution) : 4,5/10 — runtime Electron vulnérable livré, audit prod trompeur, permissions Windows non appliquées, absence de signature/intégrité.
- **Surface locale** : 6/10 — le CDP sur profils connectés est le point à corriger en premier.

**Priorités recommandées, dans l'ordre :**
1. **Mettre à jour Electron vers 44.10.2** et auditer l'arbre complet avant chaque release (E-1).
2. **Supprimer le CDP TCP des profils connectés** en réutilisant le pattern `BrowserWindow` + `executeJavaScript` déjà utilisé pour Orca/Ollama (E-2).
3. **Durcir les ACL du dossier de données** (ou déplacer les données sous `%LOCALAPPDATA%`) et retirer `mode: 0o600` du code au profit d'une vraie ACL (M-1).
4. **Allowlist de navigation/popups** dans les fenêtres de compte (M-3).
5. **Signature + `app.asar` + fuses d'intégrité** pour la distribution portable (M-2).
6. Puis les faibles : purge des `.tmp`/`DevToolsActivePort`, `devTools:false`, `frame-ancestors`, rétention des sauvegardes, `accountSession` hors export.

**Limites de cet audit.** Analyse statique et inspection du système de fichiers uniquement : aucun test d'exécution, aucune connexion aux services, aucun test d'intrusion local. Les findings notés « théorique, non vérifié » n'ont pas été reproduits. Un test dynamique sur une copie isolée des profils est nécessaire pour confirmer E-2 et le point 3 de la section 7.
