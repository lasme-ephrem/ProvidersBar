# Architecture

`main.cjs` gère les fenêtres, la zone de notification, les lectures périodiques et la persistance. Le renderer utilise le pont explicite de `preload.cjs` : Node.js est désactivé dans les fenêtres, avec isolation du contexte et sandbox.

`lib/seed.cjs` définit les dix fournisseurs sans compte connecté. `lib/domain.cjs` valide les saisies et normalise les relevés. `lib/migrations.cjs` adapte les anciennes données au démarrage : ajout de Claude Pro, retrait des anciens services, informations d’import et relevés OrcaRouter erronés. Les migrations concernées sauvegardent l’inventaire avant modification.

Un relevé contient des soldes par devise, un quota principal et éventuellement plusieurs `quotaWindows`. Pour Antigravity, le quota principal enregistré est le minimum des limites reçues ; les cartes et le widget distinguent les quatre limites Gemini/Claude-GPT et la semaine Gemini 4 Argon. Le bucket Argon `gemini-argon-wtu-weekly` a été observé dans le service installé, sans lui inventer de fenêtre de cinq heures. Une session authentifiée et un quota lisible sont deux états distincts.

`subscriptionStatus` (`active`, `paused`, `expired`) et `statusMessage` décrivent l’état d’un abonnement indépendamment de la connexion. Une échéance dépassée fait passer automatiquement un forfait actif à `expired` au démarrage, à la lecture de l’état ou pendant que l’application reste ouverte. Le prix, la date et l’historique sont conservés. La réactivation exige une confirmation explicite et une nouvelle échéance future. Les forfaits expirés sortent du budget et des recommandations. Ollama reste synchronisé sous Free à 0 $ pour afficher sa limite et son montant de crédits achetés ; son ancien quota payant est invalidé.

## Connecteurs

| Module dans lib/ | Responsabilité |
| --- | --- |
| connectors.cjs | API de crédits OpenRouter, DeepSeek et RunInfra |
| openai-account.cjs | codex app-server : compte, limites et connexion officielle |
| antigravity-account.cjs | Service local vérifié, méthode RetrieveUserQuotaSummary |
| subscription-accounts.cjs | Lecture ciblée des quotas Grok et Z.ai |
| account-browser.cjs | Navigateur de connexion dédié puis lecture en arrière-plan |
| subscription-controller.cjs | Coordination, annulation et vérification des connexions |
| ollama-account.cjs | Crédits mensuels de la page de réglages Ollama |
| orca-account.cjs | Portefeuille de l’espace de travail OrcaRouter |
| provider-catalog.cjs | Métadonnées et instructions de connexion |

Claude lit par défaut `plan-usage-history.json` dans le profil local de Claude Desktop (Store Windows ou profil Roaming). `lib/claude-desktop-usage.cjs` valide le format, la fraîcheur et les champs `fh` et `sd`, puis transforme les pourcentages utilisés en quotas restants. Les deux chemins sont comparés pour choisir le relevé le plus récent. Un observateur de fichiers (2 secondes, remplacements atomiques compris) déclenche une lecture dès qu’un nouvel échantillon est écrit, en respectant l’activation du suivi et de l’actualisation automatique. Claude Desktop peut suspendre ses mesures : relire le fichier ne force pas leur actualisation. Le fichier n’expose pas les prochaines remises à zéro : seules les dates antérieurement confirmées encore futures sont conservées.

`lib/claude-live-usage.cjs` fournit une lecture directe optionnelle, activée exclusivement par `claude:enable-live`. Elle utilise en mémoire le jeton existant de `~/.claude/.credentials.json` pour une requête GET fixe au service de quotas Anthropic ; aucune copie du jeton ne quitte le processus principal vers le renderer ou la persistance. Le compte enregistré ne contient que `{ kind: 'claude-live-local' }`. Un timer d’une minute respecte le suivi et l’actualisation automatique ; le lecteur sérialise les requêtes et impose le même intervalle aux clics manuels. Les erreurs gardent le dernier relevé et son horodatage ; les 429 respectent `Retry-After` avec un minimum de cinq minutes. Les deux quotas partagés sont obligatoires, et les limites par modèle sont affichées séparément sans remplacer la semaine globale. Aucun repli vers un ancien fichier Desktop ne se produit en lecture directe. `lib/claude-connection.cjs` renouvelle la connexion cinq minutes avant son expiration et une fois sur HTTP 401. Il utilise le protocole du Claude Code installé (2.1.285), les scopes déjà accordés, le client existant et les verrous `.oauth_refresh.lock` et le verrou historique du répertoire (stale 60 s, heartbeat 5 s). Une seconde lecture sous verrou adopte un jeton renouvelé par un autre processus. L’écriture atomique conserve les autres champs, compare les jetons avant écriture et ne recrée pas un fichier supprimé pendant la requête. Une rotation dont l’enregistrement échoue reste en mémoire pour retenter l’écriture avant un nouvel échange. Les refus définitifs nécessitent une reconnexion dans Claude Code. Aucun jeton ne va dans les données ProvidersBar. Le mode choisi est persisté même lors du premier échec ; les cooldowns d’erreur, dont Retry-After, survivent au redémarrage. Le scheduler contrôle la prochaine échéance toutes les 2 secondes, observe les modifications de connexion pour reprendre après reconnexion et réagit à la sortie de veille.

Z.ai lit la consommation du plan. Grok lit le dashboard Usage du nouveau forfait partagé, ou le panneau Settings → Usage historique. Un pool X Subscription représente une seule réserve Grok/Bot/Cursor. Sur un compte SuperGrok présentant deux limites, `Semaine` et `Grok Bot · Semaine` restent indépendantes. Les compteurs animés sont associés à leur section et jamais pris dans les dépenses par modèle ou les crédits supplémentaires. Ces interfaces peuvent évoluer : un format inconnu produit une erreur, jamais une estimation silencieuse.

OrcaRouter calcule le portefeuille à partir de `active_workspace.wallet_quota` et du `quota_per_unit` fourni par le service. `hard_limit_usd` est un plafond de clé, pas un solde. Ollama suit son usage inclus et son montant `Usage credits / Current balance` dans la même fiche et la même synchronisation. Un montant absent ou ambigu reste inconnu. En Free, seule une limite clairement lisible est affichée ; les anciens crédits inclus du forfait payant ne sont plus présentés comme disponibles.

## Isolation

Les connexions web utilisent des profils ou partitions propres à chaque service. Le contenu distant n’accède ni à Node.js ni au pont IPC de ProvidersBar. Les sessions et clés ne sont pas exportées. OpenAI réutilise la session de Codex et ne la déconnecte pas globalement.

Antigravity interroge seulement `127.0.0.1` sur les ports du processus de l’installation reconnue. L’acceptation du certificat auto-signé est limitée à cette requête locale. Le jeton CSRF reste en mémoire. Antigravity 2.0 doit être ouvert ; l’IDE seul n’est pas utilisé.

## Interface

`renderer/app.js` partage les logos et les regroupements de quotas entre les cartes et le widget. `renderer/styles.css` définit leurs mises en page. Les logos sont embarqués dans `assets/providers/`, sans téléchargement au lancement ; leurs origines figurent dans `sources.json`.

Le thème sombre d’origine reste dans `styles.css` et `strategy.css` ; `renderer/theme.css` définit la palette claire. `settings.theme` choisit `light` ou `dark`, avec `light` par défaut pour les anciens inventaires. Le thème est appliqué au tableau de bord et au widget dès le chargement, puis synchronisé par les mises à jour d’état.

Le serveur d’aperçu expose une liste fermée de ressources publiques et un inventaire sans comptes connectés. Il ne sert pas les dossiers de données.

## Réinitialisations

`lib/quota-resets.js` décrit les limites affichées, valide les compléments de date et choisit la provenance. `renderer/reset-ui.js` formate les dates locales et l’onglet de saisie. Les compléments persistent dans `provider.manualResets` via `provider:resets`, même pour les comptes connectés ; ils ne modifient ni le snapshot du connecteur ni l’historique.

Une date fournisseur a priorité. Un complément sans heure conserve sa précision au jour. Le moteur de recommandation reçoit une projection temporaire : pour une date sans heure, la borne de fin du jour local sert à détecter une date dépassée, sans présenter cette borne comme l’heure réelle de reset. Les pourcentages et la fraîcheur du relevé ne sont jamais changés par un complément.

## Recommandations

Argon a sa propre réserve hebdomadaire. Aucun score de qualité n’est inventé : ce modèle reste classé après les modèles dont un score est connu. Le quota Grok Bot historique entre dans la stratégie seulement lorsqu’une limite indépendante est relevée ; un pool partagé ne crée jamais une deuxième réserve.

`lib/usage-strategy.js` est un module pur partagé par Node et les deux renderers : catalogue daté, validation des options, disponibilité des réserves, estimation des coûts et classement. Aucun accès réseau ni clé ne lui est transmis. Le recalcul utilise l’état public au rendu, à chaque synchronisation et chaque minute pour la fraîcheur et les plages tarifaires.

`state.strategy` est facultatif pour les anciens inventaires. Les valeurs par défaut sont calculées sans migration destructive. Le pont `strategy:update` valide et persiste une configuration complète, séparée des préférences générales. `renderer/strategy-ui.js` affiche les recommandations et leur configuration ; `renderer/strategy.css` contient leurs styles. Le serveur d’aperçu autorise explicitement ces trois ressources et reste en lecture seule.

Les fenêtres d’un même quota sont évaluées ensemble. Antigravity possède trois réserves indépendantes ; Codex ne réutilise pas le quota Spark comme substitut ; Ollama nécessite un relevé de crédits mensuels inclus identifié. La file de recommandations et le champ recommended contiennent exclusivement les abonnements actifs disponibles. Les abonnements absents, expirés ou en pause sont écartés. apiProviders contient séparément les fournisseurs API actifs avec solde USD positif confirmé et récent, triés par crédits restants décroissants, indépendamment du catalogue tarifaire ou du profil de tokens ; seuls ces indicateurs de fournisseurs apparaissent dans la section API, sans catalogue de modèles. Le panneau de détails contient uniquement les abonnements actifs ; les routes alternatives restent configurables dans Réglages. Aucune API ne devient une recommandation, même lorsque tous les abonnements sont indisponibles.
