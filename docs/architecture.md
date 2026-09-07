# Architecture

`main.cjs` gère les fenêtres, la zone de notification, les lectures périodiques et la persistance. Le renderer utilise le pont explicite de `preload.cjs` : Node.js est désactivé dans les fenêtres, avec isolation du contexte et sandbox.

`lib/seed.cjs` définit les dix fournisseurs sans compte connecté. `lib/domain.cjs` valide les saisies et normalise les relevés. `lib/migrations.cjs` adapte les anciennes données au démarrage : retrait des anciens services, informations d’import et relevés OrcaRouter erronés. Les migrations concernées sauvegardent l’inventaire avant modification.

Un relevé contient des soldes par devise, un quota principal et éventuellement plusieurs `quotaWindows`. Pour Antigravity, le quota principal enregistré est le minimum des quatre limites ; les cartes et le widget affichent les quatre valeurs séparément. Une session authentifiée et un quota lisible sont deux états distincts.

## Connecteurs

| Module dans lib/ | Responsabilité |
| --- | --- |
| connectors.cjs | API de crédits OpenRouter, DeepSeek et RunInfra |
| openai-account.cjs | codex app-server : compte, limites et connexion officielle |
| antigravity-account.cjs | Service local vérifié, méthode RetrieveUserQuotaSummary |
| subscription-accounts.cjs | Lecture ciblée des quotas Gemini web, Grok et Z.ai |
| account-browser.cjs | Navigateur de connexion dédié puis lecture en arrière-plan |
| subscription-controller.cjs | Coordination, annulation et vérification des connexions |
| ollama-account.cjs | Crédits mensuels de la page de réglages Ollama |
| orca-account.cjs | Portefeuille de l’espace de travail OrcaRouter |
| provider-catalog.cjs | Métadonnées et instructions de connexion |

Gemini web lit `/usage`, Z.ai la consommation du plan et Grok le dialogue Usage. Ces interfaces et le service local Antigravity peuvent évoluer : un format inconnu doit produire une erreur, jamais une estimation silencieuse.

OrcaRouter calcule le portefeuille à partir de `active_workspace.wallet_quota` et du `quota_per_unit` fourni par le service. `hard_limit_usd` est un plafond de clé, pas un solde. Ollama distingue les crédits mensuels du prix de l’abonnement et des crédits supplémentaires.

## Isolation

Les connexions web utilisent des profils ou partitions propres à chaque service. Le contenu distant n’accède ni à Node.js ni au pont IPC de ProvidersBar. Les sessions et clés ne sont pas exportées. OpenAI réutilise la session de Codex et ne la déconnecte pas globalement.

Antigravity interroge seulement `127.0.0.1` sur les ports du processus de l’installation reconnue. L’acceptation du certificat auto-signé est limitée à cette requête locale. Le jeton CSRF reste en mémoire. Antigravity 2.0 doit être ouvert ; l’IDE seul n’est pas utilisé.

## Interface

`renderer/app.js` partage les logos et les regroupements de quotas entre les cartes et le widget. `renderer/styles.css` définit leurs mises en page. Les logos sont embarqués dans `assets/providers/`, sans téléchargement au lancement ; leurs origines figurent dans `sources.json`.

Le serveur d’aperçu expose une liste fermée de ressources publiques et un inventaire sans comptes connectés. Il ne sert pas les dossiers de données.
