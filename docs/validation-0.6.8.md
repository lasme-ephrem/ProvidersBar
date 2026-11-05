# Validation 0.6.8

Date : 5 novembre 2026
Commit : `a2f86b4` — tag `v0.6.8`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.8

Version « connexion Claude simplifiée » : Claude se connecte comme Codex, par le
Claude Code officiel, toujours sur l'abonnement ; le relevé Claude Desktop est
retiré. Publication menée depuis le PC de l'utilisateur (tag, téléchargement du
brouillon, signature locale, publication).

## Origine

Constat sur l'installation réelle (0.6.7) : connexion Claude bloquée malgré un
abonnement Max actif.

- Le journal `data/logs/lasmium.log` montre des refus `RATE_LIMITED` de la lecture
  des quotas toutes les 5 minutes pendant toute la nuit (23 h → 5 h) : une lecture
  par minute était trop fréquente pour le service de quotas d'Anthropic.
- Les variables d'environnement utilisateur `ANTHROPIC_API_KEY` et
  `CLAUDE_CODE_OAUTH_TOKEN` faisaient utiliser à Claude Code une autre connexion :
  le fichier `~/.claude/.credentials.json` lu par Lasmium n'était jamais renouvelé.
- Le jeton longue durée (`claude setup-token`) a été testé contre le service de
  quotas : HTTP 403, scope `user:profile` manquant. Il ne peut pas servir.
- `claude auth status` ne renouvelle pas le jeton (vérifié dans le code de Claude
  Code 2.1.316) ; `claude auth login --claudeai` fonctionne sans terminal et se
  termine seul quand le navigateur est déjà connecté à claude.ai.

## Artefact publié

- Fichier : `LasmiumTokensHub-0.6.8-win32-x64.zip`
- Taille : **159 319 560 octets**
- SHA-256 : `53d5bdec60b486e225a4e82e29186e0fa5f6d8377e011beeb6246b017376ea72`
  (identique à `SHA256SUMS-0.6.8.txt` du runner, recalculé après téléchargement)
- Manifeste : `latest.json`, signé Ed25519 localement (`npm run updater:sign`) sur
  l'archive du brouillon, `version: 0.6.8`, `minApp: 0.5.0`
- Workflow : https://github.com/lasme-ephrem/lasmium-tokens-bar/actions/runs/42037037961
  (jobs **Construire et vérifier** et **Brouillon de release** verts)

## Contrôles locaux (Windows, session interactive)

| Contrôle | Résultat |
| --- | --- |
| `npm run verify` | 110 fichiers valides |
| `npm run lint` | ESLint : 110 fichiers, 0 erreur, 0 avertissement |
| `npm test` | **348/348**, 0 ignoré (module `claude-cli` et flux Claude réécrits) |
| `npm run test:claude:desktop` | **PASS** : connexion en un clic, clé API leurre jamais transmise, migration Desktop, panne et reprise, `auth-rate-limit`, connexion non aboutie |
| `npm run test:desktop` | **PASS** |
| `npm run test:resources:desktop` | **PASS** |

## Contrôles du workflow et du manifeste publié

| Contrôle | Résultat |
| --- | --- |
| Concordance tag / `package.json` | `v0.6.8` ↔ `0.6.8` |
| `npm run release:verify` | archive contrôlée par réextraction, SHA-256 conforme |
| CI (`ci.yml` sur le commit de la version) | verte |
| `latest.json` servi par `releases/latest/download` | HTTP 200, version 0.6.8 |
| Signature | valide pour des clients **0.6.7** et **0.6.6** |
| Archive | accessible (HTTP 200, 159 319 560 octets) |

## Flux réel 0.6.7 → 0.6.8

À constater sur l'installation de l'utilisateur (`Documents\LasmiumTokensHub`) :
mise à jour, version 0.6.8, `data/` conservé, session Claude convertie et quotas
lus avec Hebdo Fable.

## Limites connues

- Claude Code doit être installé sur le PC ; « Connecter Claude » l'indique sinon.
- Tant que `CLAUDE_CODE_OAUTH_TOKEN` reste défini, Claude Code lancé dans un
  terminal ne renouvelle pas le fichier de connexion : Lasmium le renouvelle seul ;
  en cas de refus prolongé d'Anthropic, « Connecter Claude » relance la connexion.
- `latest.json` reste signé localement (secret CI non configuré, par choix).
- Windows x64 uniquement, HTTPS obligatoire, aucun certificat Authenticode.
