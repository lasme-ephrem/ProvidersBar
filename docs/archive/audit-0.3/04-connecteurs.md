# 04 — Fiabilité des connecteurs et des lectures de quotas

> Projet : **ProvidersBar 0.2.1** (Electron/Windows, suivi de 10 fournisseurs d'IA).
> Périmètre : `lib/connectors.cjs`, `lib/openai-account.cjs`, `lib/antigravity-account.cjs`,
> `lib/subscription-accounts.cjs`, `lib/subscription-controller.cjs`, `lib/ollama-account.cjs`,
> `lib/orca-account.cjs`, `lib/claude-desktop-usage.cjs`, `lib/claude-live-usage.cjs`,
> `lib/claude-connection.cjs` (verrous et renouvellement Claude Code), `lib/account-browser.cjs`,
> `lib/usage-strategy.js` (disponibilité/fraîcheur) et l'orchestration
> `main.cjs` (rafraîchissements, timers, IPC, cycle de vie), comparés à `README.md` et
> `docs/architecture.md`.
> Méthode : **lecture seule du code et des tests** ; aucun test exécuté, `npm run verify:connections`
> et le portable n'ont pas été lancés. Les comportements des services distants restent
> **non vérifiés** (voir § 12).
> Note de fiabilité synthétique : **7,5 / 10**.

---

## 1. Résumé exécutif

L'architecture est nettement plus défensive que la moyenne : validation stricte des formats,
refus explicite des valeurs ambiguës, conservation du dernier relevé en erreur, distinction
absent/0, absence d'estimation silencieuse, verrous inter-processus pour Claude Code, cooldown
persistant pour la lecture directe Claude, et un moteur de disponibilité qui n'utilise jamais une
donnée périmée. Les faiblesses résiduelles sont surtout : (a) le **parsing DOM** des portails web
Grok/Z.ai, fragile par nature ; (b) la **validation incomplète des fenêtres OpenAI** (une fenêtre
hebdomadaire manquante passe pour un relevé valide) ; (c) le **cooldown 429 des clés API non
persisté** et l'absence de `Retry-After` pour Ollama/OrcaRouter ; (d) quelques **courses
manuel/auto** où une vérification interactive est silencieusement dégradée ; (e) des **fuites
potentielles de processus Chrome/Edge** et de profils temporaires ; (f) la **lecture directe
Claude qui contourne le proxy Electron/Windows**. Aucun cas n'a été trouvé où une erreur produit
une valeur de quota inventée.

---

## 2. Matrice de synthèse par fournisseur

| Fournisseur | Mécanisme de lecture | Fenêtres / ressources suivies | Fragilité connue | Impact utilisateur |
|---|---|---|---|---|
| **OpenAI GPT (Codex)** | `codex app-server --stdio`, JSON-RPC local (`lib/openai-account.cjs:15-55`), parse `57-75`, sync `main.cjs:208` + `134-140` | `primary`/`secondary` de chaque groupe de `rateLimitsByLimitId`, en % restant ; le minimum des fenêtres « Codex et Work » (`openai-account.cjs:72-74`) | Aucune fenêtre hebdomadaire **requise** (bucket `openai` sans `required`, `usage-strategy.js:21`) ; durée inconnue acceptée et étiquetée `N min` (`openai-account.cjs:67`) ; 12 s par RPC (`:45`), 3 à 4 RPC par lecture ; login laissé ouvert sans échéance (`:111-131`) ; identité via email hachée, `null` si absent (`:83-84`) | Quota affiché « disponible » sur la seule fenêtre de 5 h si la semaine disparaît de la réponse ; erreur claire si Codex absent/non connecté |
| **Anthropic Claude (Desktop)** | Fichier local `plan-usage-history.json`, deux emplacements Windows (`lib/claude-desktop-usage.cjs:10-15`), validation `17-48`, veille fichier 2 s `70-79`, branchée `main.cjs:667-670` | `fh` (5 h) et `sd` (semaine), % restants ; pas de date de reset fournie par le fichier, réutilisation seulement des dates passées **encore futures** (`:35-39`) | Claude peut suspendre ses mesures → erreur au-delà de 45 min (`:7,28-30`) ; le fichier le plus récent est choisi (`:64`) mais si son format est invalide, le second valide n'est pas essayé (`:64-65` + `17-20`) ; dates de reset potentiellement recyclées | Badge « Relevé ancien » (renderer `app.js:82,87`) ; dernier relevé conservé, pas de retour silencieux |
| **Anthropic Claude (lecture directe)** | `GET https://api.anthropic.com/api/oauth/usage` avec le jeton de `~/.claude/.credentials.json` (`lib/claude-live-usage.cjs:4-6,54-100`), renouvellement OAuth `lib/claude-connection.cjs:85-158` | 5 h et semaine **obligatoires** (`claude-live-usage.cjs:19`), limites par modèle en plus (`:22-41`), dates ISO | Tout nouveau `limit.kind` ou champ renommé lève une erreur de format (`:25-41`) ; `fetch` global (`:54,60`) et `fetch` du renouvellement (`claude-connection.cjs:85,119`) **n'utilisent pas** `session.defaultSession.fetch` (`main.cjs:33`) → proxy Windows ignoré ; clic manuel dans les 60 s renvoie le cache sans requête (`claude-live-usage.cjs:64-69`) ; 403 sur l'endpoint de jeton traité comme panne réseau (`claude-connection.cjs:129`) | Mode direct indisponible jusqu'à correction/reconnexion ; dernier relevé conservé ; proxy d'entreprise → échec persistant non vérifié |
| **xAI Grok** | Chrome/Edge dédié piloté en CDP (headless en auto), inspection DOM `lib/account-browser.cjs:45-181`, `lib/subscription-accounts.cjs:74-270`, fallback `/?_s=usage` une seule fois `131-137,148-155`, contrôleur `lib/subscription-controller.cjs` | Pool partagé X Subscription (une seule réserve), ou panneau historique SuperGrok + `Grok Bot · Semaine` distinct (`subscription-accounts.cjs:178-253`), compteurs animés lus par `aria-label` (`:144-148,261-267`) | Dépend de la structure DOM, des libellés FR/EN, des titres (« Paramètres » puis « Utilisation ») et du rendu différé : 20 tentatives × 500 ms en auto (`subscription-controller.cjs:33,51`) ; association compteur/section par position en repli (`:226`) ; un changement de mise en page produit une erreur (pas d'estimation) mais peut aussi produire une association erronée | Quota « en attente » ou « contradictoire » ; dernier relevé conservé, page d'utilisation à vérifier (message `subscription-accounts.cjs:309-310`) |
| **Z.ai** | Même navigateur dédié + DOM (`lib/subscription-accounts.cjs:76-79,274-299`), cas spécial « D'occasion » pour la traduction française de « Used » (`:284-287`) | `5 heures` et `Semaine` (`usage-strategy.js:23`) | Heuristique de pourcentages dans une fenêtre de 220 caractères (`:279-280`), dépend de la locale et du rendu Angular ; labels validés après coup (`:316`) ; pas de détection de « dépense » au-delà du contexte de titre | Erreur explicite ou quota absent ; jamais de valeur inventée mais rupture possible à chaque refonte du portail |
| **Antigravity (Gemini, Claude/GPT, Argon)** | Découverte du processus installé `language_server.exe` via PowerShell/CIM, puis POST loopback `RetrieveUserQuotaSummary` avec CSRF (`lib/antigravity-account.cjs:8-47`), parse `49-67`, sync `main.cjs:90-110` | Gemini 5 h + semaine, Claude et GPT 5 h + semaine, `Gemini 4 Argon · Semaine` (`antigravity-account.cjs:53`) — aucune fenêtre 5 h inventée pour Argon | Antigravity 2.0 doit tourner et le chemin d'installation doit correspondre (`:18-19`) ; `rejectUnauthorized: false` sur loopback (`:31`) avec fenêtre TOCTOU entre découverte et requête ; un bucket **reconnu** dont la `window` change fait échouer toute la lecture (`:55-57`) ; encodage PowerShell/CIM potentiellement non UTF-8 dans le JSON (voir § 8, R-08) ; 4 s par port (`:32`), jusqu'à 8 ports (`:22`) | Erreur « Ouvre Antigravity 2.0… » ; dernier relevé conservé ; utilisateurs avec chemin Windows non ASCII potentiellement non détectés (non vérifié) |
| **Ollama** | Login Chrome/Edge dédié puis import **des seuls cookies Ollama** dans une partition Electron (`lib/account-browser.cjs:201-244,159-170`), fetch HTML `/settings` via session (`main.cjs:207,408`), parse `lib/ollama-account.cjs:37-94`, fetch `95-107` | Crédits mensuels inclus (USD), réserve `Usage credits / Current balance`, quota Free lisible | Parsing HTML par libellés et bornes de section (`:8-9,54-56`) ; en cas d'échec transitoire **après** l'import des cookies, `ollamaBrowser.phase()` vaut `closed` et le statut est effacé (`main.cjs:422-428`) alors que la session est déjà enregistrée ; `assumeFree` peut classer « Free » un compte payant dont la section mensuelle a disparu (`main.cjs:174-179`, `ollama-account.cjs:59`) ; 429 sans `Retry-After` ni cooldown (`:100`) | Session enregistrée mais statut « non connecté » jusqu'à un clic manuel ; montants jamais estimés, réserve historique marquée « stale » via `lastKnownUsageCredits` (`:28-36`, `main.cjs:156`) |
| **OpenRouter** | Clé de gestion, `GET /api/v1/credits` (`lib/connectors.cjs:14-17,58-102`) | `total_credits`, `total_usage`, restant USD | `remaining = total - used` peut être **négatif** sans rejet (`:15-17`) ; 429 honoré mais cooldown **en mémoire seulement** (`:4,88-95`) ; retry unique fixe 350 ms (`:72,77`) ; 404 message parle d'enregistrement alors qu'il s'agit d'une lecture (`:96`) | Mauvaise clé/route : erreur immédiate conservant l'ancien relevé ; après redémarrage, nouvelle requête malgré `Retry-After` long |
| **DeepSeek** | Clé API, `GET /user/balance` (`lib/connectors.cjs:18-27`) | Soldes USD/CNY **non convertis**, devises dupliquées refusées | Devise inconnue → erreur ; `finite()` n'accepte que nombre ou chaîne décimale simple (`:8-11`) donc un changement de format (`1e3`, symbole) casse la lecture ; cooldown non persisté | Erreur explicite, dernier relevé conservé ; pas de conversion de devise (conforme README:81) |
| **RunInfra** | Clé d'espace de travail, `GET /v1/credits` (`lib/connectors.cjs:28-50`) | Solde USD (centimes entiers), disponible, réservé (déjà déduit), dépenses de période, `as_of` | `balance_cents` négatif non rejeté (`:29-37`) ; `as_of` peut être très ancien sans avertissement local, c'est `usage-strategy` qui tranche (>10 min, `:94-95`) ; cooldown non persisté ; 429 honoré, 5xx générique | Erreur explicite ; un relevé ancien devient « Relevé ancien · synchroniser » |
| **OrcaRouter** | Session de compte, deux GET `/api/user/self` + `/api/status` via partition Electron (`lib/orca-account.cjs:16-32`), contrôle `main.cjs:298-335` | `wallet_quota / quota_per_unit`, USD, identifiants `userId`/`workspaceId` validés (`orca-account.cjs:3-12`) | Statut « connecté » écrit **après** le premier fetch réussi (`main.cjs:321`) : un échec transitoire initial laisse la session non connectée et sans reprise auto ; 401/403 → session expirée mais 429 sans `Retry-After` (`:24-25`) ; référence lue dans `localStorage` du site (`main.cjs:302-306`) | Clic « Vérifier maintenant » à refaire, dernière valeur conservée ; rien d'estimé |
| **Transverse navigateur** | Chrome/Edge dédié, profil par fournisseur, CDP (`lib/account-browser.cjs:34-181`), spawn à chaque lecture auto (`:62`), `subscription-controller.cjs:29` | Session web du fournisseur | Un spawn Chrome complet (profil temporaire `mkdtemp`, `:54`) pour Grok/Z.ai **toutes les 5 minutes** (`main.cjs:686`) ; `stopBrowserProcess` abandonne après 1,5 s + 2 s sans confirmer la mort du processus (`account-browser.cjs:8-24`) ; profils temporaires non nettoyés après crash (nettoyage uniquement dans `cleanup()`, `:70-77`) | Coût CPU/disque, fenêtres fantômes possibles après arrêt brutal ; aucune donnée personnelle lue hors du fournisseur ciblé |

---

## 3. Analyse du parsing

### 3.1 Distinction absent / zéro, unités, devises

Points forts constatés :

- `finite()` refuse explicitement `null`, `undefined`, booléens, formes libres : un champ absent lève une
  erreur au lieu de devenir 0 (`lib/connectors.cjs:8-11`).
- DeepSeek exige `balance_infos` non vide, devise `USD`/`CNY`, refuse les doublons
  (`lib/connectors.cjs:18-27`).
- RunInfra exige des centimes **entiers** (`Number.isSafeInteger`), vérifie la cohérence
  `available === max(0, balance)` et ne soustrait pas deux fois les *holds* (`lib/connectors.cjs:28-50`,
  commentaire `:36`).
- Antigravity : `remainingFraction` borné à `[0,1]`, bucket inconnu ignoré, bucket `disabled` ignoré,
  doublon de libellé refusé (`lib/antigravity-account.cjs:53-62`) ; zéro reste zéro
  (test `tests/antigravity-account.test.cjs:30`).
- OpenAI : `usedPercent` borné `[0,100]`, `windowDurationMins > 0`, `resetsAt` fini et positif
  (`lib/openai-account.cjs:65-66`) ; aucune fenêtre → erreur `:71`.
- Claude lecture directe : `utilization` borné, dates vérifiées, contradictions entre limites
  répétées détectées (`lib/claude-live-usage.cjs:10-41`).
- Claude Desktop : version de format exigée, `fh`/`sd` numériques dans `[0,100]`, échantillon futur
  toléré à 2 min près, âge maximal 45 min (`lib/claude-desktop-usage.cjs:19-30`).
- Ollama : montants `null` ≠ 0 ; `$0 of $0 used` reste inconnu (`lib/ollama-account.cjs:73-78`,
  test `tests/ollama-account.test.cjs:35-37`) ; montants multiples → erreur d'ambiguïté
  (`:73-74`) ; le budget hebdomadaire/les prix d'achat sont exclus par bornes de section
  (`:8-9,54-56`).
- DOM Grok/Z.ai : les largeurs de jauge ne sont jamais lues ; seuls les `number-flow-react` avec
  direction « used/remaining » explicite sont acceptés (`lib/subscription-accounts.cjs:144-148,193-203,
  260-267`), ce qui exclut les compteurs purement décoratifs.
- `usage-strategy` traite `percent()` (0 inclus) séparément de `!finite()` : `0` est un quota épuisé,
  `null` une donnée inconnue (`lib/usage-strategy.js:84-85,118-121`).

### 3.2 Risques de parsing

| ID | Risque | Preuve | Effet |
|---|---|---|---|
| P-01 | Le parsing Grok/Z.ai dépend du DOM, des libellés et du rendu. | `lib/subscription-accounts.cjs:74-305`, `lib/subscription-controller.cjs:33,51` | Échec explicite fréquent à chaque refonte ; risque résiduel d'associer un pourcentage d'une autre section (breakdown produit, compteur animé) car le repli associe `flows[headingIndex]` par position (`subscription-accounts.cjs:226`) |
| P-02 | Les fenêtres OpenAI ne sont pas contraintes. | `lib/usage-strategy.js:21` (bucket sans `required`), `lib/openai-account.cjs:58-74` | Une réponse sans fenêtre hebdomadaire est publiée comme « prête » ; l'utilisateur peut ignorer un épuisement hebdomadaire non renvoyé |
| P-03 | Un bucket Antigravity **reconnu** avec une `window` différente fait échouer toute la lecture. | `lib/antigravity-account.cjs:55-57` | Une évolution du service (nouvelle période) rend Antigravity indisponible au lieu d'ignorer la fenêtre inconnue ; strict par conception mais cassant |
| P-04 | Toute nouvelle `limit.kind` Claude ou tout champ renommé casse la lecture directe. | `lib/claude-live-usage.cjs:25-41` | Mode direct indisponible jusqu'à mise à jour ; dernier relevé conservé |
| P-05 | Ollama : heuristiques HTML (titres, libellés de plan, montants) et classification Free/paid. | `lib/ollama-account.cjs:37-94`, `main.cjs:174-179` | Montant mensuel non reconnu → erreur (jamais d'estimation) ; risque de plan mal classé si la section mensuelle disparaît d'un compte payant |
| P-06 | Claude Desktop : un fichier récent mais invalide masque l'autre fichier valide. | `lib/claude-desktop-usage.cjs:64-65` | Mode Desktop indisponible alors qu'une source valide existait |
| P-07 | Restes négatifs non validés (OpenRouter, RunInfra). | `lib/connectors.cjs:15-17,29-37` | Un solde négatif peut être enregistré et affiché ; `usage-strategy` le classe « épuisé » mais l'historique contient une valeur incohérente |
| P-08 | Dates ISO sans fuseau acceptées (Antigravity, Claude direct). | `lib/antigravity-account.cjs:59`, `lib/claude-live-usage.cjs:13-16` | Interprétation locale d'une heure fournisseur ; décalage possible de la date de reset affichée |
| P-09 | Grok : le type de quota est déduit du texte de la page (`usageKind`) et une ancienne limite connue peut être effacée à la première lecture. | `lib/subscription-accounts.cjs:103-116,246-252,303`, `lib/subscription-controller.cjs:41-43` | Changement de mise en page transitoire : quota marqué indisponible une lecture, préservé ensuite ; comportement documenté mais perfectible |
| P-10 | Identité OpenAI `null` si Codex ne renvoie pas d'email. | `lib/openai-account.cjs:83-84` | Un changement de compte Codex sans email n'est pas détecté |
| P-11 | Anciens parseurs web `claude` et `openai` toujours présents mais non câblés. | `lib/subscription-accounts.cjs:26-79`, `lib/provider-catalog.cjs:9-11` (`browserAccount: false` pour ces deux ids) | Code mort non exercé en réel ; dérive de maintenance sans impact utilisateur direct |
| P-12 | Encodage PowerShell/CIM vers JSON pour Antigravity. | `lib/antigravity-account.cjs:8,14-22` | Avec un chemin utilisateur non ASCII, la comparaison de chemin Node/JSON peut échouer et donner « service non détecté » (hypothèse **non vérifiée**) |

---

## 4. Erreurs, délais, backoff et cooldowns

### 4.1 Budget de délais et reprises par connecteur

| Connecteur | Timeout | Reprises | Statuts traités | Cooldown / `Retry-After` | Persistance |
|---|---|---|---|---|---|
| API clés (OpenRouter/DeepSeek/RunInfra) | 20 s partagé entre les 2 tentatives (`lib/connectors.cjs:66`) | 1 seule, réseau et 502/503/504 (`:68-80`), pause fixe 350 ms | 401/403/404/429 traités, autres 5xx génériques (`:81-98`) | 429 → `retryAt = max(now+60 s, Retry-After)` (`:88-94`) | **En mémoire seulement** (`:4`), perdu au redémarrage |
| Ollama | 15 s (`lib/ollama-account.cjs:97`) | Aucune | 3xx/401/403 → session absente, 429 générique, autres erreurs (`:99-105`) | Message « réessaie dans quelques minutes », aucun `Retry-After`, aucun cooldown (`:100`) | — |
| OrcaRouter | 15 s par requête, 2 requêtes (`lib/orca-account.cjs:21-31`) | Aucune | 401/403 session, 429 générique, autres erreurs (`:24-27`) | Aucun `Retry-After`, aucun cooldown (`:25`) | — |
| Antigravity | PowerShell 12 s (`lib/antigravity-account.cjs:14`) + 4 s par port HTTP (`:32`) | Aucune ; essaie les ports/services l'un après l'autre (`:72-76`) | 200 exigé (`:38`) | Sans objet | — |
| OpenAI/Codex | 12 s par RPC (`lib/openai-account.cjs:45`) | Aucune | Erreur JSON-RPC → message générique (`:35`) | Sans objet | — |
| Claude direct | Requête quota 12 s (`lib/claude-live-usage.cjs:60`), refresh jeton 20 s (`lib/claude-connection.cjs:120`) | 401 → un renouvellement + une nouvelle requête (`claude-live-usage.cjs:74-79`) | 429, 403, 401, 5xx, format (`:80-84`) | 429 min 5 min, backoff 1→2→4→5 min, erreurs auth 5 min (`:88-97`) ; `Retry-After` jeton min 5 min (`claude-connection.cjs:29-34,124`) | **Persisté** via `provider.claudeSync` (`main.cjs:79-82,672` ; `claude-live-usage.cjs:102-109`) |
| Claude Desktop | Lecture fichier, veille 2 s | — | format/ancienneté/régression temporelle (`lib/claude-desktop-usage.cjs:19-33`) | Sans objet | — |
| Navigateur web | port DevTools 80×250 ms = 20 s (`lib/account-browser.cjs:87-96`), CDP 10 s (`:100`), commande 10 s (`:81`), arrêt 1,5 s + 2 s (`:8-24`) | Non (le contrôleur refait une tentative dans la boucle) | `blocked: challenge`, conflits (`lib/subscription-accounts.cjs:309-310`) | Aucun | — |

### 4.2 Constats sur la gestion d'erreur

**Points forts**

- Le dernier relevé n'est jamais écrasé par une erreur : `record()` n'est appelé qu'en cas de succès
  (`main.cjs:167-173`), les branches d'échec écrivent seulement `p.error` (`main.cjs:218, 70-71, 104,
  128`), et l'horodatage affiché reste celui de la mesure réelle (Claude Desktop utilise `sample.t`,
  `lib/claude-desktop-usage.cjs:45` ; RunInfra utilise `as_of`, `lib/connectors.cjs:47-50`).
- La fraîcheur est contrôlée indépendamment de l'erreur : `usage-strategy` refuse un relevé de plus
  de 10 minutes, un `updatedAt` futur de plus de 60 s, un compte déconnecté ou un `p.error`
  (`lib/usage-strategy.js:86-97`), et le renderer applique le même seuil (`renderer/app.js:87,137`).
- Messages actionnables et distincts : clé refusée (401), clé insuffisante (403), route absente (404),
  quota ancien, contrôle humain, conflit de quotas, session expirée
  (`lib/connectors.cjs:81-98` ; `lib/subscription-accounts.cjs:309-311` ;
  `lib/claude-desktop-usage.cjs:28-33`).
- Aucun secret ne fuit dans les messages : les tests vérifient que la clé, le jeton ou le corps de
  réponse n'apparaissent pas (`tests/api-connection.test.cjs:22-32`,
  `tests/claude-live-usage.test.cjs:91-99`).

**Faiblesses**

1. **Cooldown 429 non persistant pour les clés API** : `cooldowns` est une `Map` de module
   (`lib/connectors.cjs:4`), vidée au redémarrage. Un `Retry-After` d'une heure est donc oublié
   après relance de l'application, alors que Claude direct le persiste. `docs/architecture.md:27` ne
   précise pas que cette persistance est spécifique à Claude ; un lecteur peut supposer un traitement
   homogène.
2. **`Retry-After` ignoré sur les 5xx réessayés** : un 503 avec `Retry-After` est réessayé après
   350 ms fixes (`lib/connectors.cjs:75-78`), sans jitter ni backoff, puis échoue avec un message
   générique (`:97`). Les 500/501/505 ne sont pas réessayés du tout.
3. **Pas de cooldown Ollama/OrcaRouter** : un 429 est retenté à chaque cycle automatique de 5 min
   (`main.cjs:686`) sans fenêtre de repos, et `Retry-After` n'est même pas lu
   (`lib/ollama-account.cjs:100`, `lib/orca-account.cjs:25`).
4. **Claude direct : 403 sur l'endpoint de jeton classé « panne réseau »** (`lib/claude-connection.cjs:129`) :
   un refus définitif boucle en backoff de 5 min au lieu de demander une reconnexion (les statuts
   400/401 sont bien classés « reconnexion requise », `:125-128`).
5. **Clic manuel Claude dans les 60 s** : `read()` renvoie le snapshot en cache sans requête
   (`lib/claude-live-usage.cjs:64-69`) ; l'interface peut annoncer « quotas lus » alors qu'aucune
   mesure n'a eu lieu. L'horodatage, lui, reste honnête.
6. **`p.error` invalide immédiatement la recommandation** même si le relevé est frais
   (`lib/usage-strategy.js:90`) : c'est cohérent avec « pas de repli silencieux » mais un 429
   transitoire retire l'abonnement du classement pendant tout le cooldown.
7. **Autres statuts 4xx/5xx et 429 sans distinction de gravité** : pas de différenciation
   « réessayer » vs « action utilisateur » au niveau des connecteurs hors Claude ; c'est le message
   qui porte l'information.

---

## 5. Concurrence, annulation, verrouillage

### 5.1 Garde-fous par composant

| Composant | Mécanisme | Preuve | Qualité |
|---|---|---|---|
| `syncOne` (tous fournisseurs) | `busy` Map : si une synchronisation est en cours, attend sa fin au lieu d'en lancer une seconde | `main.cjs:113,199,222-224` | Bon ; la vérification et la pose sont dans la même section synchrone (pas d'`await` entre `has` et `set`) |
| `provider:connect` | refus si `busy`/`disconnecting`, puis même pattern `busy` | `main.cjs:517-533` | Bon ; la clé n'est écrite qu'après validation (`:525-528`) |
| Claude Desktop/Live | `claudeWork` unique + `work` interne au lecteur + scheduler 2 s qui teste la prochaine échéance | `main.cjs:55-89,680`, `lib/claude-live-usage.cjs:64-100` | Bon ; `record()` déduplique les relevés identiques (`main.cjs:71-72`) |
| Antigravity | `antigravityWork` unique | `main.cjs:90-110` | Bon |
| OpenAI | `work` unique + `generation`/`opening`/`loginRpc` pour annuler une connexion | `lib/openai-account.cjs:78,90-99,100-147` | Bon ; `close()` incrémente `generation` et ferme le RPC de login (`:142-147`) |
| Grok/Z.ai | `entries` par fournisseur : `work`, `opening`, `abort`, `disconnecting`, timer 1 s | `lib/subscription-controller.cjs:7-12,18-22,78-79` | Bon en apparence ; voir course manuel/auto § 5.3 |
| Ollama/Orca | `ollamaVerification`/`orcaVerification` + `busy` | `main.cjs:312,332-333,395,435` | Bon ; mais refusent au lieu d'attendre si un sync est en cours |
| Claude Code (inter-processus) | `proper-lockfile` sur le répertoire **et** sur le verrou historique `<dir>.lock`, heartbeat 5 s, stale 60 s, `onCompromised` → abort de la requête | `lib/claude-connection.cjs:50-66`, utilisations `:107-142` | Très bon ; testé (`tests/claude-connection.test.cjs:105-117`) |
| Claude renouvellement | file d'attente unique (`work`), adoption d'un jeton renouvelé par un autre processus, `pending` conservé en mémoire si l'écriture échoue | `lib/claude-connection.cjs:87-155` | Très bon ; écriture atomique `:68-83` |

### 5.2 Annulation et fermeture

- Le contrôleur web est correctement annulable : `read()` crée un `AbortController`
  (`lib/subscription-controller.cjs:19-20`), les commandes CDP et les attentes le respectent
  (`lib/account-browser.cjs:46,51,88,95,226,272`), `open()` annule une lecture en cours avant de
  rouvrir (`lib/subscription-controller.cjs:86-90`). Test dédié :
  `tests/subscription-accounts.test.cjs:158-168`.
- `disconnect()` attend l'ouverture et la lecture en cours avant de fermer le navigateur et de
  supprimer le profil (`lib/subscription-controller.cjs:108-119`) ; `closeAll()` fait de même pour
  tous les comptes (`:120-127`).
- `before-quit` attend `closeAll`, `openAiAccount.close`, le navigateur Ollama, les travaux
  Antigravity/Claude et tous les `busy`, puis les écritures de clés et d'état
  (`main.cjs:605-615`). Conséquence : la fermeture peut attendre le timeout réseau le plus long
  (jusqu'à ~20 s pour un connecteur API — délai partagé entre les deux tentatives — et ~44 s pour
  une découverte Antigravity : 12 s de PowerShell puis 8 ports × 4 s), sans fenêtre de progression.
- Le connecteur Antigravity, Ollama et OrcaRouter n'ont **pas** de signal d'annulation : une
  déconnexion attend leur timeout au lieu de les interrompre (`main.cjs:544` ; les appels
  `lib/antigravity-account.cjs:26-47`, `lib/ollama-account.cjs:95-107` et `lib/orca-account.cjs:16-28`
  ne reçoivent aucun `AbortSignal`).

### 5.3 Courses entre lecture manuelle et actualisation automatique

| Cas | Comportement observé | Preuve | Verdict |
|---|---|---|---|
| API clés : « Vérifier » pendant l'auto-refresh | attend le `busy` puis renvoie l'état | `main.cjs:199` | Correct |
| Grok/Z.ai : « Vérifier maintenant » pendant une lecture auto | `read()` renvoie **le travail de fond existant** (`if (e.work) return e.work;`) : le drapeau `interactive` est perdu, donc pas de fenêtre visible pour un contrôle humain ni de nouvelle tentative de 120 itérations | `lib/subscription-controller.cjs:15-18` puis `:33` | **Dégradation silencieuse** ; l'utilisateur croit avoir lancé une vérification interactive |
| Grok/Z.ai : lecture auto pendant une vérification manuelle | le manuel garde la main ; l'auto attend | `lib/subscription-controller.cjs:18` | Correct |
| Ollama/Orca : auto-refresh pendant une vérification manuelle | erreur « déjà en cours » au lieu d'attendre | `main.cjs:312,397` | Incohérent avec les autres fournisseurs (UX) |
| OpenAI | `read()` partage le travail en cours | `lib/openai-account.cjs:91` | Correct |
| Claude Desktop : veille fichier pendant une lecture | partage `claudeWork` | `main.cjs:55-60,667-670` | Correct |
| Claude direct : clic manuel < 60 s | renvoie le cache (pas de requête) | `lib/claude-live-usage.cjs:64-69` | Correct fonctionnellement, message trompeur |
| Un clic « Vérifier » pour Grok/Z.ai avec une fenêtre ouverte mais quota illisible | le timer de 1 s continue à inspecter la page tant que la fenêtre reste ouverte (pas de plafond global au-delà de la boucle de 20 tentatives par lecture) | `lib/subscription-controller.cjs:95-100,33` | Coût CPU et lectures répétées tant que la fenêtre est visible ; s'arrête à la fermeture (`:96-97`) |

### 5.4 Verrous Claude Code (heartbeat/stale) — points d'attention

- Deux verrous sont pris **séquentiellement** ; si le second échoue, le premier est libéré
  (`lib/claude-connection.cjs:54-62`). Si un autre processus détient le verrou, l'erreur est
  `auth-busy` avec message « nouvel essai automatique » (`:17,61`) — pas d'écrasement de jeton.
- `stale: 60000` vs `update: 5000` (12 heartbeats de marge) et requête de renouvellement limitée à
  20 s : cohérent, le verrou ne devrait pas être volé pendant un échange normal.
- `onCompromised` déclenche l'abort de la requête de jeton (`:53,116,120`) : testé
  (`tests/claude-connection.test.cjs:105-117`).
- Limite : si deux versions de Claude Code utilisent des chemins de verrous différents (répertoire
  `~/.claude` vs autre), un verrou propre à ProvidersBar ne protège pas d'une rotation concurrente ;
  c'est le verrou historique qui couvre ce cas, et il repose sur l'hypothèse « Claude Code 2.1.285 »
  documentée (`docs/architecture.md:27`). **Hypothèse à revérifier** à chaque mise à jour de Claude
  Code (voir `docs/maintenance.md:33`).

---

## 6. Cycle de vie (démarrage, veille, reconnexion, fermeture)

### 6.1 Démarrage

Ordre réel (`main.cjs:616-689`) : chargement `state.json` → migrations (avec sauvegardes ponctuelles
`:631,644`) → `expireSubscriptions` → chargement des clés (`:649`) → IPC et fenêtres → veilleur Claude
Desktop (`:667`) → restauration du cooldown Claude direct (`:672`) → veilleur `.credentials.json`
(`:673-677`) → timer Claude 2 s (`:680`) → timers globaux (`:685-686`) → `syncAll()` si
auto-refresh (`:687`).

Points forts : un état corrompu ou d'un format inconnu **arrête** l'application avec conservation des
fichiers (`:620-622,688`) au lieu de repartir silencieusement ; les migrations critiques laissent une
copie de l'inventaire (`:629-635,642-648`) ; les listeners de reprise de veille et de connexion sont
posés une seule fois (`:683-684`).

Risques : au démarrage, `syncAll()` lance **simultanément** Codex, un navigateur pour Grok, un pour
Z.ai, une découverte PowerShell/Antigravity, la lecture Claude, et toutes les API (`:228,687`) —
pic de ressources et concurrence de démarrages Chrome. Aucune limitation de parallélisme n'est
prévue.

### 6.2 Veille / reprise / reconnexion

- `powerMonitor.on('resume')` et `powerMonitor.on('unlock-screen')` ne réveillent que Claude direct
  (`main.cjs:682-684` → `claude-live-usage.cjs:113-115`). Les autres fournisseurs attendent le tick
  de 5 min (`main.cjs:686`) : après une veille longue, les relevés peuvent rester « anciens »
  jusqu'à 5 minutes, mais l'interface les signale (`renderer/app.js:87,137`).
- Une reconnexion Claude Code est détectée en 2 s par la veille de `.credentials.json`
  (`main.cjs:673-677`) : elle efface les cooldowns d'authentification
  (`lib/claude-live-usage.cjs:110-112`) sans contourner un `Retry-After` de rate-limit (test
  `tests/claude-live-usage.test.cjs:144-153`).
- Le mode de lecture Claude choisi est persisté **même si la première lecture échoue**
  (`main.cjs:66,70`), ce qui évite un retour silencieux au fichier Desktop.
- Aucun gestionnaire de `suspend` ne suspend les timers ; aucun rattrapage de l'intervalle de 5 min
  n'est forcé au retour de veille (seul Claude a un `wake()`).

### 6.3 Fermeture et fuites

| Ressource | Nettoyage | Preuve | Risque résiduel |
|---|---|---|---|
| Timers (Claude 2 s, sync 5 min, expiration 1 min, détections Orca/Ollama, timer contrôleur) | `unref()` systématique et `clearInterval` dans `before-quit` (Ollama) | `main.cjs:295,351,388,680-686`, `subscription-controller.cjs:100` | `orcaDetectionTimer` n'est pas explicitement arrêté dans `before-quit` (`main.cjs:611` ne cite qu'Ollama) ; la fermeture des fenêtres le stoppe en pratique (`:279-284`) |
| Veilleur Claude Desktop | `stopClaudeWatcher()` dans `before-quit` | `main.cjs:607`, `claude-desktop-usage.cjs:78` | Aucun |
| Veilleur `.credentials.json` | `unwatchFile(CREDENTIAL_PATH)` | `main.cjs:609` | Aucun |
| Navigateurs Grok/Z.ai | `closeAll()` → `browser.close()` → kill + attente | `main.cjs:613`, `account-browser.cjs:171-179` | `stopBrowserProcess` résout après 2 s **sans vérifier** que le processus est mort (`:8-24`) ; un Chrome récalcitrant peut survivre |
| Navigateur Ollama (login natif) | fermé dans `before-quit` via `browser?.close()` | `main.cjs:611-613` | OK |
| Fenêtres de connexion Electron (Orca/Ollama email) | fermées implicitement par `app.quit()` | `main.cjs:274,366` | Pas de fermeture explicite dans `before-quit`, mais acceptable |
| Sous-processus `codex app-server` | `openAiAccount.close()` dans `before-quit`, et `close()` dans `finally` de `read` | `main.cjs:613`, `openai-account.cjs:95,142-147` | Un login laissé ouvert (`open()` → `rpc.onLogin`) peut maintenir un processus Codex pendant toute la session de l'application (`:111-131`) |
| Profils Chrome temporaires | `cleanup()` après fermeture, avec contrôle de chemin et `realpath` | `account-browser.cjs:70-77,115-118,176-178` | Aucun balayage au démarrage des profils `temporary-account-browsers` laissés par un crash ; croissance disque possible |
| Écritures d'état/cles | `writeQueue` sérialisé, `atomicWrite` (temp + rename, mode 600) | `main.cjs:143-153`, `credential-store.cjs:10-21` | Le pattern `queue.catch(() => {}).then(...)` avale l'échec précédent : une écriture ratée peut n'être signalée qu'à l'appelant courant, sans log ni reprise (voir R-11) |

---

## 7. Scénarios de panne : attendu vs code observé

| # | Scénario | Comportement attendu | Comportement du code | Verdict |
|---|---|---|---|---|
| S1 | 429 avec `Retry-After: 3600` sur une clé API, puis redémarrage de l'app | Ne pas re-interroger avant l'échéance | Cooldown en mémoire (`connectors.cjs:4,92-94`), perdu au redémarrage ; nouvelle requête possible immédiatement | **Partiel** |
| S2 | 503 passager sur OpenRouter | Reprise avec délai raisonnable, sans bloquer l'UI | Réessai unique après 350 ms (`:75-78`), puis erreur conservant l'ancien relevé ; pas de cooldown | **Partiel** |
| S3 | Réponse DeepSeek au format inconnu (champ renommé) | Erreur explicite, aucun solde inventé | `finite()` lève « Réponse du fournisseur incomplète ou invalide » (`:9`), `p.error` posé, snapshot intact (`main.cjs:218`) | **Conforme** |
| S4 | Antigravity 2.0 fermé | Message expliquant d'ouvrir l'app, dernier relevé conservé | Découverte vide → message `closedMessage` (`antigravity-account.cjs:9,71,77`) ; `p.error` posé (`main.cjs:103`) | **Conforme** |
| S5 | Codex installé mais non connecté à ChatGPT | Proposer la connexion officielle | `OPENAI_SIGNIN` → `open()` démarre `account/login/start`, valide l'URL et ouvre le navigateur (`openai-account.cjs:109-131`) | **Conforme** (non vérifié en réel) |
| S6 | Grok redirige vers l'authentification Cursor | Ne jamais inspecter la page externe, tenter une fois la route officielle | Origine vérifiée dans `inspectSubscriptionPage` (`subscription-accounts.cjs:16`) ; fallback une seule fois après 5 lectures vides (`account-browser.cjs:131-137,148-155`) | **Conforme** (tests `subscription-accounts.test.cjs:183-190`) |
| S7 | Contrôle humain Cloudflare pendant une vérification manuelle | Attendre l'utilisateur, puis lire ; échouer proprement sinon | `blocked: 'challenge'` → statut `waiting`, attente 1 s par itération (`subscription-controller.cjs:45-47,51`), erreur `ACCOUNT_BROWSER_CHECK` après épuisement (`:309`) | **Conforme** |
| S8 | Claude Desktop n'écrit plus depuis 46 min | Signaler un relevé ancien, conserver l'ancien | Erreur après 45 min (`claude-desktop-usage.cjs:28-30`), message actionnable, veilleur toujours actif | **Conforme** |
| S9 | `Retry-After: 7200` sur Claude direct puis redémarrage | Respecter 2 h même après relance | `retryAt` persisté via `claudeSync` puis restauré (`claude-live-usage.cjs:102-109`, `main.cjs:672`), `wake()` ne contourne pas (`:113-115`) | **Conforme** |
| S10 | Jeton Claude révoqué (401 puis 400 au refresh) | Une seule reprise, puis demander une reconnexion sans boucler | 401 → un renouvellement (`claude-live-usage.cjs:74-79`) ; 400/401 du refresh → `auth-required` + jeton mort mémorisé (`claude-connection.cjs:125-128,113`), cooldown 5 min | **Conforme** |
| S11 | Erreur transitoire juste après l'import des cookies Ollama | Conserver la session et réessayer automatiquement | `main.cjs:422-428` ferme le navigateur et affiche une erreur ; `p.accountSession` non défini → `isConnected` faux donc pas de reprise auto ; clic manuel nécessaire | **Écart UX** |
| S12 | Échec transitoire de la première vérification OrcaRouter | Garder la session et réessayer | `p.accountSession` posé seulement après `fetchWallet` (`main.cjs:321`) ; cookie conservé mais statut non connecté ; détection arrêtée à la fermeture de fenêtre (`:279-284`) | **Écart UX** |
| S13 | Clic « Vérifier maintenant » pendant un auto-refresh Grok | Ouvrir la fenêtre et attendre le contrôle humain | `read()` renvoie le travail de fond existant et ignore `interactive` (`subscription-controller.cjs:18`) | **Écart** |
| S14 | Quitter pendant une synchronisation lente | Fermer proprement sans perdre l'état | `before-quit` attend tous les travaux et écritures (`main.cjs:605-615`) ; fermeture potentiellement longue mais cohérente | **Conforme**, latence à surveiller |
| S15 | Réveil de veille après 8 h | Rafraîchir rapidement | Seul Claude est réveillé (`main.cjs:682-684`) ; les autres attendent le tick 5 min (`:686`) et affichent « Relevé ancien » entre-temps | **Acceptable**, à documenter |
| S16 | Retour de veille avec horloge recalée de 2 min en arrière | Ne pas déclarer tous les relevés futurs | `usage-strategy` tolère 60 s de futur (`:94-95`) ; au-delà, « Relevé ancien · synchroniser » jusqu'au prochain sync | **Conforme mais réactif** |

---

## 8. Risques classés

| ID | Gravité | Risque | Preuve | Statut |
|---|---|---|---|---|
| R-01 | **Élevée** | Parsing DOM Grok/Z.ai cassable à chaque refonte ; repli d'association par position des compteurs animés | `lib/subscription-accounts.cjs:74-305,226` ; `lib/subscription-controller.cjs:33` | Non vérifié en réel ; tests fixtures |
| R-02 | **Élevée** | Fenêtre hebdomadaire OpenAI absente acceptée comme quota complet | `lib/usage-strategy.js:21` ; `lib/openai-account.cjs:58-74` | Vérifié par lecture ; pas de test dédié |
| R-03 | Moyenne | Cooldown 429 des clés API non persistant ; `Retry-After` ignoré sur 5xx réessayés ; pas de jitter | `lib/connectors.cjs:4,75-78,88-97` | Testé en mémoire (`tests/api-connection.test.cjs:35-47`), pas après redémarrage |
| R-04 | Moyenne | Ollama/Orca : un échec initial transitoire efface/empêche l'état « connecté » et la reprise auto | `main.cjs:321,422-428` | Non testé en réel |
| R-05 | Moyenne | Chrome/Edge : spawn complet toutes les 5 min pour Grok/Z.ai, arrêt non confirmé, profils temporaires orphelins après crash | `main.cjs:686` ; `subscription-controller.cjs:29` ; `account-browser.cjs:8-24,54,70-77` | Tests `account-browser.test.cjs` ne couvrent pas les fuites |
| R-06 | Moyenne | Vérification interactive Grok/Z.ai silencieusement dégradée pendant un auto-refresh ; boucle de lecture 1 s tant qu'une fenêtre reste ouverte sans quota | `subscription-controller.cjs:18,95-100` | Test de concurrence partiel (`subscription-accounts.test.cjs:158-168`) |
| R-07 | Moyenne | Lecture directe Claude et renouvellement OAuth hors proxy Electron/Windows (`globalThis.fetch`) | `claude-live-usage.cjs:54,60` ; `claude-connection.cjs:85,119` ; comparaison `main.cjs:33` | Hypothèse solide, **non vérifiée** |
| R-08 | Moyenne | Antigravity : `rejectUnauthorized: false` sur loopback (TOCTOU découverte→requête) ; encodage PowerShell/CIM si chemin non ASCII | `antigravity-account.cjs:14,18-22,31` | Non vérifié |
| R-09 | Faible | Soldes négatifs non refusés (OpenRouter `total-used`, RunInfra `balance_cents`) | `lib/connectors.cjs:15-17,29-37` | Lecture |
| R-10 | Faible | Dates ISO sans offset acceptées (heure locale interprétée) | `antigravity-account.cjs:59` ; `claude-live-usage.cjs:13-16` | Lecture |
| R-11 | Faible | Échec d'écriture d'état silencieusement absorbé par le `catch` de la file ; aucun log | `main.cjs:149-153` ; `credential-store.cjs:10-21` | Lecture |
| R-12 | Faible | `notify()` et `syncAll()` du timer ne sont pas protégés (rejet non capturé si `balances` absent d'un ancien snapshot) | `main.cjs:189,686` | Lecture |
| R-13 | Faible | Claude Desktop : un fichier récent invalide empêche d'utiliser l'autre fichier valide | `claude-desktop-usage.cjs:64-65` | Lecture ; test partiel |
| R-14 | Faible | 403 sur l'endpoint de jeton Claude traité comme panne réseau (boucle 5 min au lieu de reconnexion) | `claude-connection.cjs:129` | Testé (`tests/claude-connection.test.cjs:132-148`) mais sémantique discutable |
| R-15 | Faible | Parseurs web `claude`/`openai` non câblés (code mort) | `subscription-accounts.cjs:26-79` ; `provider-catalog.cjs:9-11` | Lecture |
| R-16 | Info | Formes de quota Grok : effacement temporaire d'une limite connue pendant le rendu | `subscription-controller.cjs:41-43` | Intentionnel, testé (`subscription-accounts.test.cjs:261+`) |

---

## 9. Points forts

1. **Aucune estimation silencieuse** : formats inconnus, montants ambigus, compteurs contradictoires
   et pourcentages hors bornes produisent une erreur, jamais un 100 % ou un montant déduit
   (`lib/connectors.cjs:9` ; `lib/ollama-account.cjs:73` ; `lib/subscription-accounts.cjs:301-302` ;
   `lib/antigravity-account.cjs:57` ; `lib/claude-live-usage.cjs:10-12`).
2. **Conservation systématique du dernier relevé et de son horodatage réel** : `record()` sur succès
   uniquement (`main.cjs:167-173`), `p.error` séparé, `updatedAt` = heure de mesure quand le
   fournisseur la donne (RunInfra `as_of`, Claude Desktop `sample.t`).
3. **Fraîcheur et honnêteté UI** : seuil de 10 min, futur toléré à 60 s, badge « Relevé ancien »,
   message « dernier relevé » et `stale` explicite pour la réserve Ollama
   (`lib/usage-strategy.js:86-97` ; `renderer/app.js:82,87,137` ; `lib/ollama-account.cjs:28-36`).
4. **Sélection prudente des compteurs** : lecture des `number-flow-react` par `aria-label` + direction,
   jamais des largeurs de jauge ; exclusion des sections dépenses/achats par bornes de texte
   (`subscription-accounts.cjs:144-148,193-203,260-267` ; `ollama-account.cjs:8-9,54-56` ;
   `connectors.cjs:28-50`).
5. **Concurrence maîtrisée** : `busy` par fournisseur (`main.cjs:113,199,222-224`), verrou unique
   par lecteur, `AbortController` dans le navigateur, annulation d'une lecture de fond par une
   réouverture (`subscription-controller.cjs:18-20,86-90`).
6. **Renouvellement Claude Code de qualité industrielle** : deux verrous, heartbeat/stale, adoption
   d'un jeton renouvelé par un autre processus, écriture atomique, conservation du jeton « pending »,
   pas de fuite de secret (`claude-connection.cjs:50-155`).
7. **Cooldown Claude persistant et respectueux de `Retry-After`**, y compris après redémarrage, avec
   un `wake()` qui ne contourne jamais un rate-limit (`claude-live-usage.cjs:64-115`, `main.cjs:672`).
8. **Isolation et surface de sécurité réduite** : profils Chrome dédiés, cookies Ollama filtrés au
   domaine exact (`account-browser.cjs:26-33`), CSP-like restrictions IPC par frame
   (`main.cjs:439-446`), fichiers d'état/cles en mode 600 (`main.cjs:146`).
9. **Couverture de tests riche et lisible** sur les cas difficiles : reprises réseau et 502/503/504,
   sessions expirées, ambiguïté, zéro, concurrence, verrous, 401, backoff, conservation
   (`tests/api-connection.test.cjs`, `tests/subscription-accounts.test.cjs`,
   `tests/claude-connection.test.cjs`, `tests/claude-live-usage.test.cjs`,
   `tests/ollama-account.test.cjs`, `tests/usage-strategy.test.cjs`).
10. **Pas de conversion de devise implicite** (README:81) : DeepSeek USD/CNY conservés séparément,
    seuils monétaires limités aux soldes USD (`main.cjs:188-189`).

---

## 10. Recommandations priorisées

### P0 — à corriger avant toute nouvelle version

1. **Persister les cooldowns 429 des connecteurs API** dans `state` (par empreinte de clé ou par
   fournisseur) et les recharger au démarrage ; au minimum vérifier `Retry-After` avant toute
   requête. Fichier : `lib/connectors.cjs:4,88-94` + `main.cjs:616-650`.
2. **Honorer `Retry-After` sur les 5xx réessayés** et ajouter un backoff exponentiel avec jitter
   (ex. 350 ms → 800 ms → renoncer), au lieu d'un délai fixe. Fichier : `lib/connectors.cjs:75-78`.
3. **Valider les fenêtres OpenAI** : ajouter `required: ['Codex et Work · 5 heures', 'Codex et Work · Semaine']`
   au bucket `openai` *ou* exiger dans `parseOpenAiLimits` au moins une fenêtre `300` et une `10080`
   par groupe principal ; à défaut, publier un relevé « incomplet » plutôt que « prêt ».
   Fichiers : `lib/usage-strategy.js:21`, `lib/openai-account.cjs:58-74`.
4. **Corriger l'état de connexion Ollama/Orca après un échec transitoire** : une fois les cookies
   importés/vérifiés, écrire `accountSession` (avec un drapeau `pendingQuota`) et laisser
   `syncOne` réessayer automatiquement ; dans `main.cjs:422-428`, ne fermer le navigateur que pour
   `OLLAMA_SIGNIN`, pas pour `network`/5xx. Fichiers : `main.cjs:321,422-428`, `lib/ollama-account.cjs:95-107`.
5. **Ne jamais dégrader une demande interactive** : dans `subscription-controller.read`, si
   `interactive` et qu'un travail non interactif est en cours, terminer celui-ci puis relancer une
   passe interactive (ou mettre un drapeau `e.interactiveRequested`). Fichier :
   `lib/subscription-controller.cjs:15-18,33`.

### P1 — fiabilité et sécurité à court terme

6. **Router la lecture directe Claude et le renouvellement OAuth via le transport Electron**
   (`apiFetch` de `main.cjs:33`) en injectant `fetchImpl` dans `createClaudeLiveReader` /
   `createClaudeConnection`, pour honorer le proxy Windows comme les autres connecteurs.
   Fichiers : `lib/claude-live-usage.cjs:54-60`, `lib/claude-connection.cjs:85,119`.
7. **Rendre la découverte Antigravity robuste** : éviter de comparer des chemins issus d'un JSON
   PowerShell (forcer UTF-8 ou faire le filtrage de chemin côté PowerShell avec le chemin attendu
   passé en argument), et documenter le risque TOCTOU du port avant la requête HTTPS
   `rejectUnauthorized:false`. Fichier : `lib/antigravity-account.cjs:8-32`.
8. **Borner la vie des navigateurs** : balayer `temporary-account-browsers/` au démarrage
   (suppression des profils non verrouillés), confirmer la mort du processus (attendre `exit` après
   `kill`, sinon nouvel essai), et sérialiser les lancements Grok/Z.ai pour éviter 2 Chrome
   simultanés. Fichiers : `lib/account-browser.cjs:8-24,54,70-77`, `main.cjs:228,687`.
9. **Claude Desktop : replier sur l'autre fichier** si le plus récent est invalide (itération sur
   les historiques triés jusqu'au premier parse réussi) et ne lever une erreur de format que si
   aucun fichier n'est exploitable. Fichier : `lib/claude-desktop-usage.cjs:53-65`.
10. **Ollama/Orca : lire et respecter `Retry-After`** sur 429 (cooldown local par fournisseur,
   message « prochaine tentative à HH:MM »). Fichiers : `lib/ollama-account.cjs:100`,
    `lib/orca-account.cjs:25`.
11. **Refuser les restes négatifs** (OpenRouter `total - used < 0`, RunInfra/Orca `remaining < 0`)
   et les requalifier en erreur de format. Fichiers : `lib/connectors.cjs:15-17,29-37`,
    `lib/orca-account.cjs:11-14`.
12. **Refuser les dates sans fuseau** (exiger `Z` ou `±HH:MM`) pour Antigravity et Claude direct, ou
   les interpréter explicitement comme UTC. Fichiers : `lib/antigravity-account.cjs:59`,
    `lib/claude-live-usage.cjs:13-16`.

### P2 — robustesse, maintenance, observabilité

13. **Rendre la file d'écriture observable** : journaliser `writeQueue`/`credential-store` en cas
    d'échec, ne pas masquer l'erreur précédente par `catch(() => {})`, et retenter une écriture
    d'état au prochain cycle. Fichiers : `main.cjs:143-153`, `lib/credential-store.cjs:10-21`.
14. **Protéger `notify()`** (`p.snapshot.balances ?? []`) et envelopper le timer `:686` d'un
    `try/catch` avec `console.error` pour éviter un rejet non capturé. Fichier : `main.cjs:180-196,686`.
15. **Documenter explicitement** dans `docs/architecture.md` : cooldowns API clés en mémoire,
    absence de `Retry-After` Ollama/Orca, coût d'un Chrome par cycle pour Grok/Z.ai, latence de
    fermeture bornée par les timeouts, comportement au réveil de veille (5 min max).
16. **Nettoyer le code mort** des parseurs web `claude`/`openai` (`subscription-accounts.cjs:26-79`,
    `account-browser.cjs:292`) ou le marquer comme héritage explicitement, pour éviter qu'une
    évolution future ne réactive un chemin non testé en réel.
17. **Ajouter des tests de non-régression** : fenêtre OpenAI manquante, solde négatif, `Retry-After`
    sur 5xx, persistance de cooldown après redémarrage, clic manuel pendant auto-refresh Grok,
    échec transitoire après import cookies Ollama (transport simulé).
18. **Considérer un `powerMonitor.on('resume')` global** qui déclenche un `syncAll()` unique et
    immédiat (après un court délai), plutôt que d'attendre le tick de 5 min pour neuf fournisseurs.
    Fichier : `main.cjs:682-687`.

---

## 11. Écarts documentation ↔ code

| Documentation | Code | Nature de l'écart |
|---|---|---|
| `README.md:59` : « La lecture directe exige l'actualisation automatique » | `claude:enable-live` lit immédiatement même si `autoRefresh` est faux (`main.cjs:490-493`) ; seul le rafraîchissement périodique est conditionné (`main.cjs:51,680`) | Formulation à préciser : l'activation manuelle fonctionne, l'actualisation périodique exige le réglage |
| `docs/architecture.md:27` : « les cooldowns d'erreur, dont Retry-After, survivent au redémarrage » | Vrai **uniquement pour Claude direct** (`claude-live-usage.cjs:102-109`, `main.cjs:672`) ; les clés API perdent leur cooldown (`connectors.cjs:4`) | Risque d'interprétation d'un traitement uniforme |
| `README.md:45` : Grok automatique sans fenêtre, y compris au démarrage | Conforme (`main.cjs:687`, `account-browser.cjs:286-294`) | Le coût (spawn Chrome à chaque cycle) n'est pas mentionné |
| `docs/architecture.md:25` : « Les deux chemins sont comparés » | Il s'agit des deux fichiers `plan-usage-history.json`, pas des modes Desktop/Live (`claude-desktop-usage.cjs:10-15,64`) | Ambigu mais exact |
| `docs/architecture.md:7` / `README.md:49` : Argon sans fenêtre 5 h inventée | Conforme (`antigravity-account.cjs:53`) ; mais un bucket reconnu avec une autre `window` fait échouer la lecture (`:55-57`) | La dureté de cette validation n'est pas documentée |
| `README.md:18,81` : relevé ancien atténué, erreurs conservant les dernières valeurs | Conforme (`usage-strategy.js:86-97`, `main.cjs:167-173`, `renderer/app.js:87,137`) | Aucun écart |
| `README.md:29` / `docs/architecture.md:31` : réserve Ollama historisée, jamais estimée | Conforme (`ollama-account.cjs:28-36`, `main.cjs:156`, `renderer/app.js:139`) | Aucun écart |

---

## 12. Limites de l'analyse / éléments non vérifiés

- **Aucun service distant n'a été interrogé** (contrainte de mission) : formats réels Grok, Z.ai,
  Ollama, OrcaRouter, OpenAI Codex, DeepSeek, OpenRouter, RunInfra, Antigravity et Anthropic non
  observés à la date de l'analyse. Tout ce qui dépend d'un service est marqué « non vérifié ».
- **Aucun test n'a été exécuté** : la couverture citée provient de la lecture de `tests/`, pas d'une
  exécution (les tests électroniques exigent une session Windows interactive).
- **Hypothèse proxy** : le fait que `globalThis.fetch` (processus principal Node) n'utilise pas la
  configuration proxy Windows contrairement à `session.defaultSession.fetch` est un comportement
  documenté d'Electron/Node, mais n'a pas été validé sur cette machine.
- **Hypothèse encodage PowerShell** pour Antigravity (`lib/antigravity-account.cjs:14`) : à confirmer
  avec un profil utilisateur Windows non ASCII.
- **Hypothèse TOCTOU** sur le port loopback Antigravity : fenêtre de course très courte
  (découverte → requête HTTPS) ; impact pratique non mesuré.
- **Contrats externes non vérifiables ici** : schéma JSON-RPC `codex app-server`, endpoint
  `/api/oauth/usage` d'Anthropic, routes `/api/user/self` et `/api/status` d'OrcaRouter,
  `RetrieveUserQuotaSummary` d'Antigravity, formats HTML de settings Ollama, DOM Grok/Z.ai.
- **Verrous Claude Code** : conformité supposée au protocole de Claude Code 2.1.285 (heartbeat 5 s,
  stale 60 s, deux verrous) ; une évolution de Claude Code peut invalider cette hypothèse
  (`docs/maintenance.md:33`).
