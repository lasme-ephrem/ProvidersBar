# Validation 0.6.6

Date : 5 novembre 2026
Commit : `396cb89` — tag `v0.6.6`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.6

Première version livrée par le workflow `release.yml` (tag → fabrication sur un
runner Windows → brouillon de release) avec signature locale du manifeste.

## Artefact publié

- Fichier : `LasmiumTokensHub-0.6.6-win32-x64.zip`
- Taille : **159 311 954 octets**
- SHA-256 : `4e0e5854695d82938d2c89c26c888aa6bec8d43a6b929069ecdce943d805c59d`
- Manifeste : `latest.json`, signé Ed25519 localement (`npm run updater:sign`) sur
  l'archive construite par le runner, `version: 0.6.6`, `minApp: 0.5.0`
- Workflow : https://github.com/lasme-ephrem/lasmium-tokens-bar/actions/runs/41965930558
  (job **build** et job **publish** verts ; brouillon créé par le workflow, `latest.json`
  joint à la main, puis publication)

## Contrôles locaux (Windows, session interactive)

| Contrôle | Résultat |
| --- | --- |
| `npm run verify` | 110 fichiers valides |
| `npm run lint` | ESLint : 110 fichiers, 0 erreur, 0 avertissement |
| `npm test` | **352/352**, 0 ignoré |
| `npm run test:desktop` | **PASS** |
| `npm run test:resources:desktop` | **PASS** |
| `npm run test:claude:desktop` | **PASS** |

## Contrôles du workflow de release (runner `windows-latest`)

| Étape | Résultat |
| --- | --- |
| Concordance tag / `package.json` | `v0.6.6` ↔ `0.6.6` |
| `npm run package:release` puis `npm run release:artifacts` | archive 151,9 Mo, `SHA256SUMS-0.6.6.txt` |
| `npm run release:verify` | **224 entrées**, 369,8 Mo extraits, version 0.6.6, aucun dossier `data/`, SHA-256 conforme |
| Notes de version (`scripts/release-notes.cjs`) | section `## 0.6.6` du CHANGELOG, 2 691 caractères |
| Signature en CI | ignorée (secret absent, notice affichée) |
| Smoke sur le binaire construit | **PASS** |
| CI (`ci.yml`, run 11 sur le commit de la version) | verte |

## Flux réel 0.6.5 → 0.6.6

Installation 0.6.5 **téléchargée depuis la release GitHub** (dossier Documents de
l'utilisateur, utilisée au quotidien), donc le parcours exact d'un utilisateur final,
et non le portable de développement `dist/ProvidersBar-win32-x64`.

1. **Réglages → Mises à jour** : la 0.6.6 est détectée automatiquement
   (« Mise à jour disponible », 151,9 Mo, publiée le 2026-11-05, notes du
   manifeste affichées). Le client 0.6.5 interroge l'ancienne URL du dépôt
   (`ProvidersBar`) : la redirection GitHub vers `lasmium-tokens-bar` est suivie
   en HTTPS et acceptée.
2. **Installer 0.6.6 et redémarrer** : téléchargement, contrôle de la taille et du
   SHA-256, extraction, script d'installation, arrêt de l'application.
3. Le script remplace l'application et la relance.

Résultat vérifié :

- version finale : **0.6.6** (À propos et panneau Mises à jour, état « Prête à
  vérifier ») ;
- `data/` conservé : inventaire de 10 fournisseurs et 6 abonnements et réglages
  personnalisés (actualisation automatique, seuil USD) intacts ;
- aucune reconnexion de compte ni ressaisie de clé nécessaire ;
- journal `data/updates/update.log` :
  - `Attente de l'arrêt du processus 33148`
  - `Mise à jour copiée ; redémarrage.`
- sauvegarde de secours `resources/app.rollback-20261105051921` présente.

## Limites connues

- `update.log` est écrit en UTF-8 sans BOM : lu avec `Get-Content` sous Windows
  PowerShell 5.1, les accents s'affichent déformés ; ajouter `-Encoding UTF8` ou
  utiliser PowerShell 7. Le fichier lui-même est correct.
- Une installation placée dans un dossier synchronisé (OneDrive, Documents
  synchronisés) expose son `data/` à la synchronisation : à éviter, voir
  [`SECURITY.md`](../SECURITY.md) §8.
- `latest.json` reste signé localement : le secret `LASMIUM_UPDATER_PRIVATE_KEY`
  n'est pas configuré, par choix (voir `docs/updates.md`).
- Windows x64 uniquement, HTTPS obligatoire, aucun certificat Authenticode.

## Clés

La clé privée de signature reste dans `.local/updater/private-key.pem`, ignorée
par Git. La clé publique `lib/updater-public.pem` est versionnée. Aucune clé
privée ni clé de fournisseur n'est publiée.
