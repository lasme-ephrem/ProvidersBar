# ProvidersBar

Application Windows portable pour suivre les quotas, crédits et abonnements de dix fournisseurs IA, avec un tableau de bord et un widget près de l’horloge.

## Lancer l’application

Double-cliquer sur **Lancer ProvidersBar.cmd**, ou ouvrir **dist/ProvidersBar-win32-x64/ProvidersBar.exe**. Conserver tous les fichiers du portable ensemble. Cette version fonctionne sans Node.js installé.

Le dossier `dist/` est généré localement et exclu de Git. Après un clonage, suivre les instructions de développement ci-dessous.

- **Connexions** : connecter un compte ou renseigner une clé API.
- **Vue d’ensemble** : consulter les quotas et ouvrir les fiches.
- **Abonnements** : renseigner les tarifs et échéances facultatifs.
- **Historique** : consulter les relevés enregistrés.
- **Réglages** : gérer l’actualisation toutes les cinq minutes, les notifications et l’export JSON.

Fermer la fenêtre laisse ProvidersBar dans la zone de notification. Cliquer sur son icône pour ouvrir le widget ; clic droit puis **Quitter** pour arrêter l’application.

## Fournisseurs

| Fournisseur | Connexion | Données affichées |
| --- | --- | --- |
| OpenAI | Compte ChatGPT de Codex installé sur le PC | Quota hebdomadaire Codex et Work |
| Gemini web | Session Chrome ou Edge dédiée | Quotas hebdomadaire et de cinq heures |
| Antigravity | Antigravity 2.0 ouvert et connecté | Gemini et Claude / GPT, chacun sur la semaine et cinq heures |
| Z.ai Token Plan | Session Chrome ou Edge dédiée | Quotas hebdomadaire et de cinq heures |
| Ollama | Session de compte | Crédits mensuels en dollars restants |
| Grok | Session Chrome ou Edge dédiée | Quota hebdomadaire |
| OpenRouter | Clé de gestion | Crédits restants |
| DeepSeek Platform | Clé API | Solde disponible |
| RunInfra | Clé d’espace de travail non restreinte | Crédits disponibles |
| OrcaRouter | Session de compte et espace de travail | Solde du portefeuille |

Pour Gemini web, Grok et Z.ai, se connecter dans la fenêtre dédiée puis **la fermer** : ProvidersBar vérifie alors la session et lit les quotas. **Vérifier maintenant** renouvelle cette lecture.

OpenAI utilise la session de Codex ; arrêter son suivi ne déconnecte pas Codex. Antigravity ne nécessite aucune CLI supplémentaire, mais **Antigravity 2.0 doit rester ouvert** pour actualiser les quotas. L’IDE seul n’est pas pris en charge. Gemini web et Antigravity sont deux suivis distincts.

Les limites sont présentées en lignes **Hebdo**, puis **5 h**, quand ces périodes sont disponibles. Antigravity distingue **Gemini** et **Claude / GPT**. OpenAI affiche seulement la semaine dans les cartes et le widget. Les pourcentages affichés sont des **quotas restants**.

## Données et confidentialité

Aucun fichier Excel ni inventaire externe n’est nécessaire. Aucun compte n’est connecté par défaut.

| Mode | Emplacement des données |
| --- | --- |
| Portable | `dist/ProvidersBar-win32-x64/data/`, à côté de l’exécutable |
| Développement | `.local/`, à la racine du projet |
| Tests | Dossier isolé sous `test-results/` |

`PROVIDERSBAR_DATA_DIR` permet de choisir un autre dossier. Les données incluent `state.json`, `credentials.json`, les sauvegardes de migration et les profils de navigateur. **Ne pas publier ces données ni distribuer une copie du portable qui les contient.**

Les clés sont chiffrées avec Electron `safeStorage` et Windows DPAPI, et liées à l’utilisateur Windows. L’inventaire et l’historique restent en JSON local. L’export contient les fiches, les réglages et jusqu’à 5 000 relevés, sans clés ni sessions. La restauration depuis l’interface n’est pas encore proposée.

Les connecteurs ne lancent aucun modèle. Une erreur conserve le dernier relevé et affiche un avertissement ; une valeur inconnue ne devient jamais 100 %. Les tarifs ne servent pas à inventer des crédits. Les devises ne sont pas converties. Les lecteurs web peuvent nécessiter une adaptation lorsque les sites des fournisseurs changent.

## Développement

Prérequis : **Windows x64**, **Node.js 24 ou supérieur** et npm. Chrome ou Edge est nécessaire aux connexions web ; Codex et Antigravity sont requis seulement pour leurs connecteurs respectifs.

```powershell
npm ci
npm start
```

`npm ci` installe les versions verrouillées et Electron ; un accès réseau est nécessaire lors de l’installation.

| Commande | Rôle |
| --- | --- |
| `npm start` | Lancer Electron avec les données de développement |
| `npm test` | Tester la logique et les connecteurs avec des réponses simulées |
| `npm run test:desktop` | Tester Electron, le stockage et le widget avec Playwright |
| `npm run preview` | Servir l’aperçu en lecture seule sur `http://127.0.0.1:4317` |
| `npm run package` | Fabriquer le dossier portable Windows x64 |
| `npm run update:portable` | Mettre à jour les ressources d’un portable existant |

Les tests Electron nécessitent une session Windows interactive et DPAPI. Leurs captures et profils sont générés dans `test-results/` et exclus de Git. L’aperçu web ne contient aucun compte connecté et ne permet pas de saisir de clés.

## Fabrication et mise à jour

Quitter le portable avant de le reconstruire, puis exécuter :

```powershell
npm test
npm run test:desktop
npm run package
```

Le packaging copie Electron et les ressources applicatives dans `dist/ProvidersBar-win32-x64/`. Il n’efface pas un éventuel dossier `data/` déjà présent : **pour distribuer l’application, construire depuis un checkout neuf**, sans données personnelles.

Pour actualiser uniquement les sources d’un portable existant, quitter l’application, exécuter `npm run update:portable`, puis relancer le lanceur. Les comptes existants sont conservés.

L’exécutable n’est pas signé ; ses métadonnées binaires restent celles d’Electron. Conserver ses licences et notices avec le portable.

## Organisation

```text
assets/       Icône de l’application et logos des fournisseurs
lib/          Modèle de données, migrations et connecteurs
renderer/     Interface du tableau de bord et du widget
scripts/      Tests Electron, aperçu, packaging et mise à jour
tests/       Tests unitaires et tests de connecteurs
docs/        Documentation technique et maintenance
main.cjs      Processus principal Electron
preload.cjs   Pont IPC limité pour l’interface
```

- [Architecture et connecteurs](docs/architecture.md)
- [Maintenance et validation](docs/maintenance.md)
- [Provenance des logos](assets/providers/sources.json)

Les logos restent les marques de leurs fournisseurs respectifs. Le concept de suivi dans la zone de notification est inspiré de [CodexBar](https://codexbar.app/).
