# Validation 0.6.9

Date : 5 novembre 2026
Commit : `83ac94b` — tag `v0.6.9`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.9

Version « coûts en clair » : fiche d'abonnement à quatre champs, coût mensuel et
paiements uniques distingués, suivi des dépenses API, fiche API réduite à la clé.
Publication menée depuis le PC de l'utilisateur (tag, téléchargement du brouillon,
signature locale, publication).

## Artefact publié

- Fichier : `LasmiumTokensHub-0.6.9-win32-x64.zip`
- Taille : **159 327 197 octets**
- SHA-256 : `c7c9218d3d05c303aa2343eb6ca61f987b86e81bef6d10a55348cce98df6827a`
  (identique à `SHA256SUMS-0.6.9.txt` du runner, recalculé après téléchargement)
- Manifeste : `latest.json`, signé Ed25519 localement (`npm run updater:sign`) sur
  l'archive du brouillon, `version: 0.6.9`, `minApp: 0.5.0`
- Workflow : https://github.com/lasme-ephrem/lasmium-tokens-bar/actions/runs/42040770463
  (jobs **Construire et vérifier** et **Brouillon de release** verts ;
  `release:verify` : 228 fichiers, 369,8 Mo extraits, version 0.6.9, aucun `data/`)

## Contrôles locaux (Windows, session interactive)

| Contrôle | Résultat |
| --- | --- |
| `npm run verify` | 112 fichiers valides |
| `npm run lint` | ESLint : 112 fichiers, 0 erreur, 0 avertissement |
| `npm test` | **355/355**, 0 ignoré |
| `npm run test:desktop` | **PASS** : fiche à quatre champs, fin et réactivation, échéance « à vérifier », paiement unique, recharge API de 20 $ détectée puis marquée offerte |
| `npm run test:claude:desktop` | **PASS** |
| `npm run test:resources:desktop` | **PASS** |
| Migration sur une **copie** du `state.json` réel | seuls les champs retirés disparaissent ; 6 sessions et 1 780 relevés conservés ; copie `state.before-0.6.9-simplification.json` créée ; coût mensuel 219,99 $ |

## Contrôle du manifeste publié

`releases/latest/download/latest.json` : HTTP 200, version 0.6.9, signature valide
pour des clients **0.6.8**, **0.6.7** et **0.6.6** ; archive accessible (HTTP 200,
159 327 197 octets).

## CI sur le commit de la version

- Job « Tests unitaires et vérifications (Windows) » : **vert**.
- Job « Smoke Electron (best-effort) » : `test:desktop` et `test:resources:desktop`
  **PASS** ; `test:claude:desktop` **échoue** à l'étape de migration : sur le runner,
  l'état est lu avant que `main.cjs` ne convertisse l'ancienne session
  `claude-desktop-local` (conversion faite en fin de démarrage, après l'ouverture des
  fenêtres). Electron ne se ferme pas ensuite et le job atteint son délai de
  25 minutes. Course de démarrage propre au scénario ; sans effet sur les
  installations déjà en mode `claude-live-local`. Correction prévue : effectuer la
  conversion pendant le chargement de l'état (migration de `data-store`) et forcer
  la sortie d'un smoke en échec.

## Flux réel 0.6.8 → 0.6.9

À constater sur l'installation de l'utilisateur : mise à jour, version 0.6.9,
copie `state.before-0.6.9-simplification.json`, fiches simplifiées et coûts.

## Limites connues

- Le montant d'une recharge API est la hausse du solde entre deux lectures : une
  consommation entre-temps le sous-estime légèrement.
- `latest.json` reste signé localement (secret CI non configuré, par choix).
- Windows x64 uniquement, HTTPS obligatoire, aucun certificat Authenticode.
