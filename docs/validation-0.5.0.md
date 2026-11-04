# Validation — Lasmium TOKENS-HUB 0.5.0

**Date :** 4 novembre 2026  
**Version :** 0.5.0 « Robustesse »  
**Branche :** `main` — commit fonctionnel `3cfdb9d` (la mise à jour de ce
document suit).  
**Environnement :** Windows x64, Node.js 24.18.0, Electron 44.10.2,
`node --test`, Playwright Electron.

## Résultats automatisés

| Vérification | Résultat |
| --- | --- |
| `npm test` | **252 tests, 252 réussis, 0 échec** |
| `npm run verify` | **86 fichiers**, syntaxe valide |
| `npm run test:desktop` (source) | **PASS** — santé, dérive `SCHEMA_DRIFT`, packs, UI, widget, tray, redémarrage |
| `npm run test:resources:desktop` | **PASS** — soldes négatifs, fenêtres de quota, widget complet |
| `npm run test:claude:desktop` | **PASS** — direct/Desktop, backoff, reprise, aucun jeton persisté |
| Smoke sur le binaire packagé 0.5.0 | **PASS** (même parcours complet, `PROVIDERSBAR_EXECUTABLE`) |
| `npm run connectors:canary` (hors ligne) | **3 packs signés**, 0 erreur |
| `npm run package:release` | **OK** — dossier `dist/LasmiumTokensHub-0.5.0-win32-x64` |
| `npm run release:artifacts` | **OK** — ZIP + SHA-256 |
| `npm run update:portable` | **OK** — ressources 0.5.0, `data/` conservé |

## Artefacts

- Archive : `dist/LasmiumTokensHub-0.5.0-win32-x64.zip` (151,9 Mo / 159 237 581 octets)
- SHA-256 : `a2e7e44e4569fb72027777cb1427abb56bff62ef304c30ccb727ac1fb44844be`
- Empreintes : `dist/SHA256SUMS-0.5.0.txt`
- Exécutable packagé : `dist/LasmiumTokensHub-0.5.0-win32-x64/LasmiumTokensHub.exe`
  — SHA-256 `05e472fd3b2159c8965e7113cbea05ef3c1ca3419f779ea3af4e2da8e40f13be`
- Portable : `dist/ProvidersBar-win32-x64/LasmiumTokensHub.exe`, ressources
  `resources/app` à jour (version 0.5.0, `lib/provider-flows.cjs`,
  `lib/connector-sync.cjs`).

## Architecture livrée

- `lib/connector-contract.cjs` : contrat pur, erreurs typées, validation,
  santé, disjoncteur, chaînes de stratégies.
- `lib/connector-sync.cjs` : orchestration des lectures (API, OpenAI,
  Antigravity, Claude, OrcaRouter, Ollama, navigateur), stale-while-revalidate,
  reprise forcée. Testé par `tests/connector-sync.test.cjs`.
- `lib/provider-flows.cjs` : fenêtres, timers et états des parcours Claude,
  Antigravity, OrcaRouter et Ollama, injectés par `main.cjs` ; décisions pures
  exportées (`shouldFallbackToClaudeDesktop`, `chooseOrcaAccountRef`).
- `lib/connector-replay.cjs` + `fixtures/connectors/` : réponses HTTP
  enregistrées rejouées dans les parseurs et validées par le contrat.
- `lib/connector-packs.cjs` : packs Ed25519, override local, refus des
  downgrades/endpoints HTTP/signatures invalides.
- `lib/state-backups.cjs`, `lib/diagnostic-bundle.cjs`, `lib/logger.cjs` :
  sauvegardes rotatives, restauration validée, bundle sans secret, journal
  rotatif.

## Données existantes

- `state.json` du portable : **3 393 995 octets**, conservé tel quel par
  `update:portable` (mise à jour des ressources uniquement).
- Sauvegarde de démarrage dans le portable :
  `data/backups/state-20261104-035950-849.json` (3 386 041 octets).
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
