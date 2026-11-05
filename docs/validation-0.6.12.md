# Validation 0.6.12

Date : 5 novembre 2026
Commit : `1628157` — tag `v0.6.12`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.12

Version corrective : la marque Lasmium « L » sur l'exécutable, la barre des
tâches, le menu Démarrer et l'installeur.

## Origine

Capture de l'utilisateur après la 0.6.11 : la barre des tâches affichait encore
l'ancienne icône ProvidersBar (barres vertes) alors que la zone de notification
montrait le « L ». `assets/icon.ico` (septembre, ProvidersBar) n'avait jamais été
régénéré lors de la nouvelle identité ; `assets/icon.png` était à jour. La 0.6.11
avait écrit ce `.ico` dans l'exécutable et l'installeur.

## Correction

- `scripts/generate-icon.py` construit `icon.ico` (16, 32, 48, 64, 128, 256 px,
  Lanczos) depuis `icon.png`, source unique ; il ne dessine plus l'ancienne icône.
- `tests/exe-resources.test.cjs` refuse l'ancien fichier (empreinte
  `6db8e7c6…`) et un générateur qui dessinerait lui-même.

## Artefacts publiés

| Fichier | SHA-256 |
| --- | --- |
| `LasmiumTokensHub-0.6.12-win32-x64.zip` (159 443 948 octets) | `de7b4e8b2d45aa1cc3372e2e2a426f801a437788eaca0d7ebca7e09fae0384f6` |
| `LasmiumTokensHub-Setup-0.6.12.exe` (115 887 926 octets) | `d7fc6fd39579909f0c47781320623601875deb92bd36422852ff1adaa94cfb5d` |

- Empreintes recalculées après téléchargement du brouillon : identiques à
  `SHA256SUMS-0.6.12.txt` du runner.
- Icône affichée par Windows (`System.Drawing.Icon.ExtractAssociatedIcon`) pour
  l'exécutable extrait du ZIP publié et pour l'installeur : marque Lasmium « L ».
  Ressources de l'exécutable : « Lasmium TOKENS-HUB », version 0.6.12, 6 tailles.
- `latest.json` signé localement ; valide et reconnu plus récent pour des clients
  0.6.11, 0.6.10 et 0.6.9 ; ZIP et installeur accessibles (HTTP 200).
- Workflow : https://github.com/lasme-ephrem/lasmium-tokens-bar/actions/runs/42064335888
  (vert) ; CI du commit de la version verte (tests et smoke Electron).

## Contrôles locaux

`npm run lint` (0 erreur) et `npm test` (**366/366**) ; exécutable et installeur
construits localement : icône « L » extraite par Windows.

## Limites connues

- Windows peut garder l'ancienne icône en cache pour un raccourci déjà épinglé :
  désépingler puis réépingler, ou rouvrir la session.
- Installeur et exécutable non signés (SmartScreen au premier lancement).
