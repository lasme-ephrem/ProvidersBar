# ProvidersBar

Application desktop Windows pour suivre les abonnements, quotas et crédits de dix fournisseurs IA. Un tableau de bord et un widget dans la zone de notification regroupent les ressources restantes, leur fraîcheur et leurs dates de réinitialisation.

**Version 0.2.0 — octobre 2026 :** nouveau dashboard Grok et pool partagé avec Grok Bot/Cursor, quota hebdomadaire Gemini 4 Argon dans Antigravity, connexions renforcées et mise à jour du portable sans conserver les anciennes sources applicatives.

## Utiliser l’application

Lancer **Lancer ProvidersBar.cmd**, ou `dist/ProvidersBar-win32-x64/ProvidersBar.exe`. Conserver tout le dossier du portable : Node.js n’est pas nécessaire sur le PC qui l’utilise. Le dossier `dist/` est généré et exclu de Git.

1. Ouvrir **Connexions** pour connecter les comptes et renseigner les clés API.
2. Consulter **Vue d’ensemble** et ouvrir une fiche pour les détails et réinitialisations.
3. Renseigner, si souhaité, prix et échéances dans **Abonnements**.
4. Régler l’actualisation automatique, les notifications et le thème dans **Réglages**.

Fermer la fenêtre conserve l’application dans la zone de notification. Un clic sur l’icône ouvre le widget ; clic droit → **Quitter** arrête l’application. L’historique et l’export JSON restent accessibles depuis le tableau de bord.

Les pourcentages indiquent les **quotas restants**. Une valeur absente reste inconnue. Chaque fenêtre garde son propre état ; épuiser une réserve ne signifie pas que toutes les réserves du fournisseur le sont. Les couleurs passent du rouge à zéro à l’orange (≤ 10 % ou 2 USD), au jaune (≤ 25 % ou 5 USD), puis au vert. Les seuils monétaires concernent uniquement les crédits USD. Un relevé ancien de plus de dix minutes ou en erreur est atténué.

## Connexions et données disponibles

| Fournisseur | Connexion requise | Ressources suivies |
| --- | --- | --- |
| OpenAI GPT | Codex installé et connecté à ChatGPT | Quota hebdomadaire Codex/Work |
| Anthropic Claude | Claude Desktop, ou lecture directe activée avec Claude Code connecté | Session de 5 h, semaine, limites par modèle et dates si fournies |
| xAI Grok | Compte dans Chrome ou Edge dédié | Quota hebdomadaire du dashboard ; ancien panneau Usage compatible |
| Antigravity | Antigravity App ouvert et connecté à Google | Gemini et Claude/GPT : semaine + 5 h ; **Gemini 4 Argon : semaine** |
| Z.ai | Compte Token Plan dans Chrome ou Edge dédié | Semaine et 5 h |
| Ollama | Compte connecté | Crédits mensuels inclus et réserve de crédits supplémentaires |
| OpenRouter | Clé de gestion (Management key) | Crédits achetés, consommés et restants |
| DeepSeek Platform | Clé API | Solde dans sa devise USD/CNY |
| RunInfra | Clé d’espace de travail non restreinte | Solde, réservations et dépenses de période |
| OrcaRouter | Session de compte et espace de travail | Portefeuille réel, distinct du plafond d’une clé API |

Les connecteurs lisent les ressources ; ils ne lancent aucun modèle. Lire le solde d’une clé ne prouve pas ses droits d’inférence sur tous les modèles.

### Grok et Grok Bot

Avec **The X Subscription**, Grok, Grok Bot et les usages Cursor éligibles consomment un même pool hebdomadaire. Il est consultable dans [grok.com/dashboard → Usage](https://grok.com/dashboard). ProvidersBar suit ce pool sans fabriquer un deuxième quota Bot. L’authentification xAI commune ne fusionne pas les comptes et ne change aucun forfait.

Les anciens forfaits SuperGrok restent distincts : le panneau Settings → Usage est conservé comme parcours compatible. Lorsqu’il affiche une **Weekly Grok Bot Limit**, ProvidersBar la lit séparément de la limite SuperGrok, avec sa propre date de reset ; l’épuisement de l’une ne bloque pas artificiellement l’autre. Certains comptes historiques utilisent encore le dashboard Cursor. Un compteur absent n’est jamais déduit de l’autre quota. [Parcours et limites officiels](https://docs.x.ai/x-subscription/grok-bot), [pool hebdomadaire](https://docs.x.ai/x-subscription/usage-limits).

Pour la première connexion web, se connecter dans la fenêtre Chrome ou Edge dédiée, puis **la fermer**. ProvidersBar vérifie alors la session. **Vérifier maintenant** ouvre une fenêtre visible : laisser le lecteur terminer et effectuer soi-même un éventuel contrôle humain. Une session valide sans quota lisible conserve le dernier relevé avec un avertissement.

La lecture automatique Grok utilise une fenêtre Chrome ou Edge normale, démarrée réduite puis fermée après lecture : le portail actuel ne rend pas ses réglages correctement en mode sans fenêtre. Aucun contrôle humain n’est contourné.

### Antigravity et Argon

Garder **Antigravity App** ouvert ; aucune CLI supplémentaire n’est nécessaire. L’IDE seul ne suffit pas. Le connecteur lit le service local du processus installé et reconnaît séparément le quota `Gemini 4 Argon · Semaine`. Il ne lui attribue aucune limite de cinq heures ni le quota d’un autre groupe.

Argon apparaît dans les cartes, le widget, les dates et les recommandations. Aucun score de qualité n’est inventé : tant que ce score reste inconnu, le classement place les modèles dotés d’un score avant lui. [Modèles et disponibilité](https://www.antigravity.google/docs/models), [limites des forfaits](https://www.antigravity.google/docs/plans).

### Claude

Par défaut, ProvidersBar lit le fichier local `plan-usage-history.json` de Claude Desktop. Les modifications sont détectées toutes les deux secondes, mais Claude Desktop peut espacer ses propres mesures. Le fichier ne fournit pas les dates de reset ; un relevé ancien est signalé.

**Connexions → Anthropic Claude → Activer la lecture directe (1 min)** autorise l’utilisation de la connexion Claude Code existante pour lire les quotas Anthropic. Les jetons restent dans le processus principal et le fichier officiel Claude Code. Le connecteur renouvelle cette connexion à l’approche de son expiration ; une révocation impose une reconnexion dans Claude Code. L’activation reste explicite, sans migration automatique vers ce mode.

La lecture directe exige l’actualisation automatique. Elle respecte une minute entre lectures, les erreurs temporaires et `Retry-After`. Une erreur conserve le dernier relevé et son heure réelle, sans retour silencieux vers un fichier Desktop plus ancien. [Détails du protocole et de la protection des jetons](docs/architecture.md).

## Abonnements, dates et recommandations

Une échéance dépassée marque l’abonnement **expiré** et le retire du budget et des recommandations. La réactivation demande de confirmer le renouvellement et de fournir une nouvelle échéance future. Ollama continue sous Free à 0 USD avec les ressources réellement lisibles. Une échéance de facturation ne remet jamais un quota à 100 %.

Chaque limite affiche sa prochaine réinitialisation si elle est fournie. Une date passée demande une nouvelle lecture. Dans la fiche → **Réinitialisations**, ajouter une date manquante, avec heure facultative. Les dates fournisseur restent prioritaires ; les compléments manuels sont identifiés et ne créent aucun relevé de consommation.

**Utilise maintenant**, puis **Puis**, proposent uniquement les abonnements actifs dont les ressources sont confirmées et récentes. Les réserves Antigravity sont indépendantes ; les fenêtres d’une même réserve sont cumulatives. Configurer les modèles et exclusions dans **Réglages → Ordre de consommation**.

Les API disponibles sont affichées séparément, par solde USD positif décroissant. Le catalogue de modèles et tarifs embarqué est daté du **12 septembre 2026**, avec ajout d’Argon en octobre ; il ne se met pas à jour automatiquement. [Méthode, hypothèses et sources](docs/ordre-consommation.md).

## Données et confidentialité

| Mode | Dossier |
| --- | --- |
| Portable personnel | `dist/ProvidersBar-win32-x64/data/` |
| Développement | `.local/` |
| Tests isolés et captures | `test-results/` |

`PROVIDERSBAR_DATA_DIR` permet de choisir un autre dossier. Les données incluent l’inventaire, l’historique, les profils de connexion et `credentials.json`. Les clés sont chiffrées avec Electron `safeStorage` et Windows DPAPI, liés à l’utilisateur Windows. L’export contient jusqu’à 5 000 relevés, sans clés ni sessions. La restauration via l’interface n’est pas proposée.

**Ne jamais distribuer le dossier `data/`, `.local/` ou les profils de navigateur.** Ils sont exclus de Git. Les erreurs conservent les dernières valeurs connues ; un format inconnu ne devient jamais une estimation de crédit ou de quota. Les devises ne sont pas converties.

## Développement et vérification

Prérequis : **Windows x64**, **Node.js ≥ 24**, npm. Chrome ou Edge est requis pour les comptes web ; Codex, Claude et Antigravity seulement pour les lecteurs concernés.

```powershell
npm ci
npm start
```

| Commande | Rôle |
| --- | --- |
| `npm test` | Tests unitaires : formats, erreurs, concurrence, migrations, quotas |
| `npm run test:desktop` | Intégration Electron, IPC, chiffrement, persistance et widget |
| `npm run test:resources:desktop` | Couleurs et épuisement de chaque limite dans les deux vues |
| `npm run test:claude:desktop` | Pannes, reprise et persistance du choix de lecture directe |
| `npm run preview` | Aperçu sans comptes ni saisie de clés sur `http://127.0.0.1:4317` |
| `npm run package` | Construire ou actualiser le portable personnel, données conservées |
| `npm run package:release` | Construire un nouveau dossier versionné, sans données personnelles |
| `npm run update:portable` | Remplacer uniquement les ressources du portable personnel |
| `npm run verify:connections` | Lectures réelles via le portable démarré en mode diagnostic |

Les tests automatisés utilisent des comptes simulés et des dossiers isolés. Ils nécessitent une session Windows interactive pour Electron et DPAPI. Une lecture réelle complète ces tests lorsque les services changent ; elle ne garantit pas leur compatibilité future.

Pour le diagnostic réel, quitter le portable puis le lancer avec `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1` et exécuter `npm run verify:connections`. Le script vérifie le chemin exact de l’interface, synchronise les connexions déjà suivies et écrit `test-results/connections-live.json`, sans identité, clé, cookie ni montant de portefeuille. Les services expirés ou en pause sont signalés séparément. Quitter puis relancer normalement pour fermer le port de diagnostic.

## Fabriquer et mettre à jour

```powershell
npm test
npm run test:desktop
npm run test:resources:desktop
npm run test:claude:desktop
npm run package:release
```

La distribution propre se trouve dans `dist/ProvidersBar-0.2.0-win32-x64/`. La commande refuse un dossier de release déjà existant. Le portable personnel reste dans `dist/ProvidersBar-win32-x64/`, à côté de ses données.

Les ressources applicatives sont préparées dans un dossier temporaire, puis remplacées ensemble : les fichiers supprimés des sources ne restent pas dans l’installation. `npm run update:portable` conserve `data/` et les sessions, ferme l’ancien processus s’il est joignable en diagnostic, puis nécessite de relancer l’application. Sinon, la quitter manuellement avant la mise à jour. Le packaging inclut les dépendances de production et leurs notices.

L’exécutable n’est pas signé et conserve les métadonnées binaires Electron. Conserver toutes les licences et notices du dossier distribué.

## Structure et documentation

- `main.cjs` et `preload.cjs` : processus principal et pont IPC limité.
- `lib/` : connecteurs, stockage, migrations, quotas et recommandations.
- `renderer/` : tableau de bord, widget, thèmes et réglages.
- `scripts/` et `tests/` : fabrication, maintenance et validation.
- [Architecture et connecteurs](docs/architecture.md)
- [Maintenance et procédures de validation](docs/maintenance.md)
- [Validation de la version 0.2.0](docs/validation-0.2.0.md)
- [Historique des versions](CHANGELOG.md)
- [Provenance des logos](assets/providers/sources.json)

Les logos appartiennent à leurs fournisseurs. Le concept de suivi dans la zone de notification est inspiré de [CodexBar](https://codexbar.app/).
