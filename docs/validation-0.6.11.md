# Validation 0.6.11

Date : 5 novembre 2026
Commit : `348f161` — tag `v0.6.11`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.11

Version « installation et finitions » : installeur Windows par utilisateur,
lancement au démarrage, icône Lasmium sur l'exécutable, barre du haut façon
VS Code. Publication menée depuis le PC de l'utilisateur (tag, téléchargement du
brouillon, signature locale, publication).

## Artefacts publiés

| Fichier | Taille | SHA-256 |
| --- | --- | --- |
| `LasmiumTokensHub-0.6.11-win32-x64.zip` (mises à jour automatiques) | 159 325 697 octets | `5d5772518902d2b884bc013c054a87962d928d28f45cda20e7c2e8dd6f1dffbd` |
| `LasmiumTokensHub-Setup-0.6.11.exe` (installeur) | 115 667 492 octets | `8ecbe0176b4f13fa8e0d2ff972edbd67cdbdbb1383b476252b31d17d9c8e2501` |

- Empreintes recalculées après téléchargement du brouillon : identiques à
  `SHA256SUMS-0.6.11.txt` produit par le runner.
- `LasmiumTokensHub.exe` extrait du ZIP publié : ProductName « Lasmium TOKENS-HUB »,
  CompanyName « Lasmium », FileVersion 0.6.11, icône en 6 tailles (16 à 256 px).
- Installeur : nom de produit, version 0.6.11 et icône Lasmium.
- Manifeste : `latest.json`, signé Ed25519 localement, `version: 0.6.11`,
  `minApp: 0.5.0`.
- Workflow : https://github.com/lasme-ephrem/lasmium-tokens-bar/actions/runs/42062355266
  (Inno Setup installé par Chocolatey sur le runner, `release:verify` : 231
  fichiers, 369,8 Mo, version 0.6.11, aucun `data/`).

## Contrôles locaux (Windows, session interactive)

| Contrôle | Résultat |
| --- | --- |
| `npm run lint` | ESLint : 118 fichiers, 0 erreur, 0 avertissement |
| `npm test` | **365/365** (ressources de l'exécutable, lancement au démarrage, installeur) |
| `npm run test:desktop` | **PASS** en développement et **PASS sur l'exécutable construit** (barre du haut, boutons Windows natifs, recherche, Réglages, lancement au démarrage disponible dans l'exécutable) |
| `npm run test:claude:desktop`, `npm run test:resources:desktop` | **PASS** |
| `npm run package:release`, `release:artifacts`, `release:verify`, `package:installer` | distribution, ZIP vérifié, installeur Inno Setup 6.7.3 (110,3 Mo) |

## CI et manifeste publié

- CI (`ci.yml`, commit de la version) : tests unitaires et smoke Electron **verts**.
- `releases/latest/download/latest.json` : HTTP 200, version 0.6.11, signature
  valide et version reconnue plus récente pour des clients **0.6.10**, **0.6.9**
  et **0.6.8** ; ZIP et installeur accessibles (HTTP 200).

## Installation réelle

À constater par l'utilisateur : installation neuve par
`LasmiumTokensHub-Setup-0.6.11.exe` (l'ancien dossier `Documents\LasmiumTokensHub`
sera supprimé), lancement au démarrage, icône dans l'Explorateur et la barre des
tâches.

## Limites connues

- Installeur et exécutable non signés : Windows SmartScreen demande
  « Informations complémentaires → Exécuter quand même » au premier lancement.
- La désinstallation conserve `data/` sauf réponse « Oui » à sa question.
- `latest.json` reste signé localement (secret CI non configuré, par choix).
- Windows x64 uniquement, HTTPS obligatoire.
