# Validation — Lasmium TOKENS-HUB 0.5.0

**Date :** 4 novembre 2026  
**Version :** 0.5.0 « Robustesse »  
**Branche :** `chantier/robustesse-0.5` — commit fonctionnel `2c2ea57` (les
ajustements de smoke et cette validation suivent).  
**Environnement :** Windows x64, Node.js 24.18.0, Electron 44.10.2,
`node --test`, Playwright Electron.

## Résultats automatisés

| Vérification | Résultat |
| --- | --- |
| `npm test` | **247 tests, 247 réussis, 0 échec** |
| `npm run verify` | **81 fichiers**, syntaxe valide |
| `npm run test:desktop` (source) | **PASS** — santé, dérive `SCHEMA_DRIFT`, packs, UI, widget, tray, redémarrage |
| `npm run test:resources:desktop` | **PASS** — soldes négatifs, fenêtres de quota, widget complet |
| `npm run test:claude:desktop` | **PASS** — direct/Desktop, backoff, reprise, aucun jeton persisté |
| Smoke sur le binaire packagé 0.5.0 | **PASS** (même parcours complet, `PROVIDERSBAR_EXECUTABLE`) |
| `npm run connectors:canary` (hors ligne) | **3 packs signés**, 0 erreur |
| `npm run package:release` | **OK** — dossier `dist/LasmiumTokensHub-0.5.0-win32-x64` |
| `npm run release:artifacts` | **OK** — ZIP + SHA-256 |
| `npm run update:portable` | **OK** — ressources 0.5.0, `data/` conservé |

## Artefacts

- Archive : `dist/LasmiumTokensHub-0.5.0-win32-x64.zip` (151,9 Mo)
- SHA-256 : `702d0f716ab5f00bee005774b3f0f8ab0a1437bdd1521fdf241f498f9575bf0d`
- Empreintes : `dist/SHA256SUMS-0.5.0.txt`
- Exécutable packagé : `dist/LasmiumTokensHub-0.5.0-win32-x64/LasmiumTokensHub.exe`
  — SHA-256 `05e472fd3b2159c8965e7113cbea05ef3c1ca3419f779ea3af4e2da8e40f13be`

## Données existantes

- `state.json` du portable : **3 386 016 octets**, conservé tel quel par
  `update:portable` (mise à jour des ressources uniquement).
- Sauvegarde utilisateur antérieure :
  `.local/backups/state-before-0.5.0-20261104-032904.json` (3 376 527 octets).
- Les tests Electron utilisent des dossiers temporaires : aucune donnée réelle
  n'a été modifiée.

## Points vérifiés manuellement / par smoke

- Panneau **Santé des connexions** : 10 lignes, états `ok`, `stale`, `drift`,
  `idle`, bouton **Tester**, stratégie et âge du relevé.
- Une réponse Grok invalide est classée `SCHEMA_DRIFT`, le relevé précédent
  reste affiché et une nouvelle tentative est programmée.
- Les packs embarqués sont chargés (3), affichés dans l'UI et absents des
  erreurs ; un pack local altéré serait refusé (test unitaire).
- Thèmes clair/sombre/système, polices Sora/Inter, widget 360×660, export
  nettoyé et effacement restent fonctionnels.

## Limites assumées de cette validation

- **Aucun canary `--live`** : aucune clé de test réelle n'a été fournie. Le
  chemin `--live` est codé et testé hors ligne, mais non exécuté contre les
  fournisseurs.
- Les lecteurs DOM des abonnements navigateur ne sont pas encore pilotés par
  pack : un changement de sélecteur nécessite une version de l'application.
- Pas de mise à jour automatique, d'installateur signé ni de signature de code
  Windows (certificat et hébergement à décider).
- Le smoke packagé utilise `--no-sandbox --disable-gpu` uniquement pour
  Playwright ; l'application distribuée conserve le sandbox renderer.

## Revalidation rapide

```powershell
npm test
npm run verify
npm run test:desktop
npm run test:resources:desktop
npm run test:claude:desktop
npm run connectors:canary
npm run package:release
npm run release:artifacts
npm run update:portable
```
