# Validation — Lasmium TOKENS-HUB 0.6.0

**Date :** 4 novembre 2026  
**Version :** 0.6.0 « Maintenance »  
**Branche :** `main`  
**Environnement :** Windows x64, Node.js 24.18.0, Electron 44.10.2,
`node --test`, Playwright Electron.

## Résultats automatisés

| Vérification | Résultat |
| --- | --- |
| `npm test` | **267 tests, 267 réussis, 0 échec** |
| `npm run verify` | **98 fichiers**, syntaxe valide |
| `npm run test:desktop` (source) | **PASS** — dont panneau **Mises à jour** |
| `npm run test:resources:desktop` | **PASS** |
| `npm run test:claude:desktop` | **PASS** |
| Smoke sur le binaire packagé 0.6.0 | **PASS** |
| `npm run connectors:canary` (hors ligne) | **3 packs signés**, 0 erreur |
| Canary live sans clé | Code `2` explicite, aucun faux succès |
| Signature du manifeste `latest.json` | **Valide** (Ed25519, SHA-256 et taille vérifiés) |
| Installation réelle du script PowerShell (dossier temporaire) | **PASS** — application remplacée, `data/state.json` intact, rollback conservé |
| `npm run package:release` | **OK** |
| `npm run release:artifacts` | **OK** |
| `npm run update:portable` | **OK** — ressources 0.6.0, `data/` conservé |

## Artefacts

- Archive : `dist/LasmiumTokensHub-0.6.0-win32-x64.zip`
  (151,9 Mo / **159 291 022 octets**)
- SHA-256 : `af0bbb76b80c56618c87d8f15b7bfd327fcb849d60bd4ffa142d2e5a3446f18d`
- Empreintes : `dist/SHA256SUMS-0.6.0.txt`
- Manifeste signé : `dist/latest.json`
- Exécutable : `dist/LasmiumTokensHub-0.6.0-win32-x64/LasmiumTokensHub.exe`
  — SHA-256 `05e472fd3b2159c8965e7113cbea05ef3c1ca3419f779ea3af4e2da8e40f13be`
- Portable : `dist/ProvidersBar-win32-x64/LasmiumTokensHub.exe`, ressources
  0.6.0 (`lib/updater.cjs`, `lib/updater-public.pem`, `yauzl` inclus).

## Données existantes

- `state.json` du portable : **3 393 995 octets**, inchangé avant/après
  `update:portable`.
- La mise à jour ne copie jamais `data/` : l'archive est refusée si elle en
  contient un, et le script d'installation ne touche qu'à `resources/app` et à
  l'exécutable.
- Test d'installation réel : `data/state.json` sentinelle conservé, ancienne
  application sauvegardée sous `resources/app.rollback-*`.

## Clés et publication

- Canary : renseigner `.local/canary.env` (créé, ignoré par Git), puis
  `npm run connectors:canary:live`. La CI manuelle est dans
  `.github/workflows/canary-live.yml`.
- Signature des mises à jour : clé privée générée dans
  `.local/updater/private-key.pem`, clé publique versionnée
  `lib/updater-public.pem`. Sauvegarder la clé privée hors ligne.
- Publication : joindre le ZIP **et** `latest.json` à la release GitHub
  `v0.6.0`, ou héberger les deux sur un serveur HTTPS. Tant que ce fichier
  n'est pas publié, le bouton de vérification affiche une erreur réseau : c'est
  attendu.

## Limites assumées

- **Canary live non exécuté** : aucune clé de test réelle n'a été fournie. Le
  chargement local, le refus sans clé et le workflow CI sont testés ; les appels
  réels restent à lancer après avoir renseigné `.local/canary.env`.
- **Mise à jour non publiée** : le client, le manifeste signé et le
  remplacement local sont validés, mais aucun serveur GitHub n'a encore reçu
  l'archive pendant cette session (pas de push sans accord).
- Toujours pas de signature Authenticode : l'intégrité Ed25519 ne remplace pas
  la réputation SmartScreen.
- Les lecteurs DOM des abonnements navigateur restent pilotés par le code, pas
  par pack : cette limite 0.5.0 n'était pas dans ce lot.
- Windows x64 uniquement pour le remplacement automatique.

## Revalidation rapide

```powershell
npm test
npm run verify
npm run test:desktop
npm run test:resources:desktop
npm run test:claude:desktop
npm run connectors:canary
npm run updater:sign -- --version 0.6.0
```
