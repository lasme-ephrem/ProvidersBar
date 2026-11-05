# Validation 0.6.7

Date : 5 novembre 2026
Commit : `4f9ae00` — tag `v0.6.7`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.7

Version corrective : reprise automatique de la lecture directe Claude (seule source
d'Hebdo Fable) après un repli vers Claude Desktop, et séparation des dates de
réinitialisation et de la réserve Ollama. Publication entièrement menée depuis le
PC de l'utilisateur (tag, téléchargement du brouillon, signature locale, publication).

## Origine

Sur l'installation réelle (`Documents\LasmiumTokensHub`), la carte Claude affichait
Hebdo et Horaire mais jamais Hebdo Fable. État constaté dans `data/state.json` :
`accountSession.kind = claude-desktop-local`, `claudeSync.errorCode = auth-rate-limit`.
Le jeton Claude Code avait expiré (durée de vie d'environ 8 h), son renouvellement
avait été refusé par Anthropic (HTTP 429), et le repli vers le relevé Claude
Desktop (qui ne contient que les limites 5 heures et semaine) avait remplacé
définitivement le mode direct.

## Artefact publié

- Fichier : `LasmiumTokensHub-0.6.7-win32-x64.zip`
- Taille : **159 317 058 octets**
- SHA-256 : `3d661da36429db63b08b832ad6ac9b210dc244d10047de50b5eae6f23dc4b3c1`
  (identique à `SHA256SUMS-0.6.7.txt` produit par le runner, recalculé après
  téléchargement du brouillon)
- Manifeste : `latest.json`, signé Ed25519 localement (`npm run updater:sign`) sur
  l'archive du brouillon, `version: 0.6.7`, `minApp: 0.5.0`
- Workflow : https://github.com/lasme-ephrem/lasmium-tokens-bar/actions/runs/42030899431
  (job **Construire et vérifier** et job **Brouillon de release** verts)

## Contrôles locaux (Windows, session interactive)

| Contrôle | Résultat |
| --- | --- |
| `npm run verify` | 110 fichiers valides |
| `npm run lint` | ESLint : 110 fichiers, 0 erreur, 0 avertissement |
| `npm test` | **355/355**, 0 ignoré (3 nouveaux tests de reprise après repli) |
| `npm run test:desktop` | **PASS** |
| `npm run test:resources:desktop` | **PASS** |
| `npm run test:claude:desktop` | **PASS** (repli avec reprise planifiée et persistée) |
| Aperçu du renderer | séparateurs « · dans … » et « Réserve supplémentaire : » vérifiés |

## Contrôles du workflow de release (runner `windows-latest`)

| Étape | Résultat |
| --- | --- |
| Concordance tag / `package.json` | `v0.6.7` ↔ `0.6.7` |
| `npm run package:release` puis `npm run release:artifacts` | archive 151,9 Mo, `SHA256SUMS-0.6.7.txt` |
| `npm run release:verify` | **225 fichiers**, 369,8 Mo extraits, version 0.6.7, aucun dossier `data/`, SHA-256 conforme |
| Notes de version (`scripts/release-notes.cjs`) | section `## 0.6.7` du CHANGELOG |
| Signature en CI | ignorée (secret absent, par choix) |
| CI (`ci.yml`, run 18 sur le commit de la version) | verte |

## Contrôle du manifeste publié

Lu à l'URL utilisée par l'application
(`releases/latest/download/latest.json`) et vérifié avec `lib/update-manifest.cjs`
et la clé publique versionnée :

- HTTP 200, version **0.6.7**, SHA-256 `3d661da36429…` ;
- signature valide pour un client **0.6.6** et pour un client **0.6.5** ;
- archive accessible (HTTP 200, 159 317 058 octets).

## Flux réel 0.6.6 → 0.6.7

Installation de l'utilisateur, téléchargée depuis une release GitHub
(`Documents\LasmiumTokensHub`, utilisée au quotidien).

1. 13:57:53 (heure locale) : la 0.6.7 est détectée (« Mise à jour 0.6.7
   disponible » dans `data/logs/lasmium.log`), installée depuis **Réglages → Mises à
   jour**.
2. Le script remplace l'application et la relance ; journal `data/updates/update.log` :
   - `Attente de l'arrêt du processus 37628`
   - `Mise à jour copiée ; redémarrage.`
3. 13:58:00 : `Démarrage 0.6.7`, sauvegarde d'état de démarrage créée.

Résultat vérifié :

- version finale : **0.6.7** (`resources/app/package.json`, confirmée par
  l'utilisateur) ;
- `data/` conservé : 10 fournisseurs, 6 abonnements, actualisation automatique
  active ;
- sauvegardes de secours `resources/app.rollback-20261105135758` et
  `LasmiumTokensHub.exe.rollback-20261105135758` présentes.

### Défaut constaté sur Claude après la mise à jour

L'installation avait basculé vers Claude Desktop **sous 0.6.6** : sa session
(`{ kind: 'claude-desktop-local' }`, sans `resumeLiveAfter`) n'est donc pas
reconnue comme un repli à reprendre. Le jeton Claude Code était toujours expiré.

- 13:58:30, 13:58:47, 13:58:50 : trois clics « Activer la lecture directe »
  aboutissent à `AUTH_RATE_LIMITED`. Le relevé Desktop ayant moins de 10 minutes,
  `shouldFallbackToClaudeDesktop` refuse le repli : Claude passe en mode direct avec
  une erreur, et le suivi du relevé Desktop s'arrête.
- Le message d'erreur conseille « Déconnecter puis Connecter » ; le suivi Claude a
  ensuite été arrêté (`accountSession` absente dans l'état de 13:58:59).

Correction à prévoir : un échec de « Activer la lecture directe » depuis le mode
Claude Desktop doit retomber sur le repli avec reprise planifiée, quel que soit
l'âge du relevé ; une session Desktop issue d'un repli 0.6.6 (`claudeSync` avec un
code `auth-*`) doit être reconnue comme reprenable ; le message ne doit plus
conseiller de déconnecter.

### Cause du jeton jamais renouvelé, et résolution

Les variables d'environnement utilisateur `CLAUDE_CODE_OAUTH_TOKEN` et
`ANTHROPIC_API_KEY` sont définies sur le PC. Claude Code en ligne de commande s'en
sert et ne lit ni ne renouvelle `~/.claude/.credentials.json`. L'application Claude
de bureau ne le renouvelle pas non plus. Le fichier lu par Lasmium restait donc
bloqué sur un jeton expiré (`claude -p "ok"` réussissait sans le modifier).

Résolution à 14:04 (heure locale) : `claude` lancé dans un PowerShell où les deux
variables étaient masquées, puis `/login`. Le fichier a reçu un jeton valable jusqu'à
22:04. Lasmium (mode direct, surveillance du fichier) a relu les quotas à 14:05:27 :
`5 heures 85 %`, `Semaine 76 %`, **`Fable · Semaine 65 %`**, sans erreur.

Tant que ces variables restent définies, seul Lasmium renouvelle ce fichier ; un
nouveau refus d'Anthropic ramènerait le repli Claude Desktop.

## Limites connues

- Tant que Claude Code n'a pas renouvelé son jeton et qu'Anthropic refuse le
  renouvellement par Lasmium, la carte reste sur le relevé Claude Desktop, sans
  Hebdo Fable ; elle l'annonce et reprend seule ensuite.
- `update.log` est écrit en UTF-8 sans BOM : lire avec `Get-Content -Encoding UTF8`
  sous Windows PowerShell 5.1.
- `latest.json` reste signé localement : le secret `LASMIUM_UPDATER_PRIVATE_KEY`
  n'est pas configuré, par choix (voir `docs/updates.md`).
- Windows x64 uniquement, HTTPS obligatoire, aucun certificat Authenticode.

## Clés

La clé privée de signature reste dans `.local/updater/private-key.pem`, ignorée
par Git. La clé publique `lib/updater-public.pem` est versionnée. Aucune clé
privée ni clé de fournisseur n'est publiée.
