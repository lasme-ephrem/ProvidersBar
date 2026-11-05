# Validation 0.6.10

Date : 5 novembre 2026
Commit : `b2a790e` — tag `v0.6.10`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.10

Version corrective : Ollama suit le forfait lu sur son site, carte d'un abonnement
terminé harmonisée, smoke Claude fiable en CI. Publication menée depuis le PC de
l'utilisateur (tag, téléchargement du brouillon, signature locale, publication).

## Origine

- Remarque de l'utilisateur : un Ollama payant renouvelé devait rester compté.
  Simulation confirmée avec le code 0.6.9 : Pro à 20 $/mois compté avant
  l'échéance, puis basculé en Free et retiré des coûts le lendemain.
- Cartes Z.ai : « Expiré · désactivé » et « Suivi et recommandations arrêtés »
  contredisaient le titre « Abonnement terminé ».
- CI 0.6.9 : smoke Claude en échec (course de démarrage) puis bloqué 24 minutes.

## Artefact publié

- Fichier : `LasmiumTokensHub-0.6.10-win32-x64.zip`
- Taille : **159 330 793 octets**
- SHA-256 : `b200c1dea525f98323091de59fe6eebb331acafc0f716d2cb52799c10b46e3b9`
  (identique à `SHA256SUMS-0.6.10.txt` du runner, recalculé après téléchargement)
- Manifeste : `latest.json`, signé Ed25519 localement, `version: 0.6.10`,
  `minApp: 0.5.0`
- Workflow : https://github.com/lasme-ephrem/lasmium-tokens-bar/actions/runs/42056986700
  (jobs **Construire et vérifier** et **Brouillon de release** verts)

## Contrôles locaux (Windows, session interactive)

| Contrôle | Résultat |
| --- | --- |
| `npm run lint` | ESLint : 112 fichiers, 0 erreur, 0 avertissement |
| `npm test` | **357/357** (forfait Ollama, arrêt choisi, conversion Claude au chargement) |
| `npm run test:desktop` | **PASS** (Ollama payant compté après son échéance, puis Free lu sur la page → 0 $) ; ce smoke a aussi détecté une régression introduite pendant la correction (« Je n'ai plus cet abonnement » mettait en pause), corrigée avant le commit |
| `npm run test:claude:desktop` | **PASS** |
| `npm run test:resources:desktop` | **PASS** |
| Copie du `state.json` réel | Ollama (Free lu) passe en suivi Free compté 0 € ; totaux inchangés (230,99 €/mois, 35 € en paiement unique) ; session Claude inchangée |

## CI et manifeste publié

- CI (`ci.yml`, commit de la version) : tests unitaires **verts** ; smoke Electron
  **vert**, les trois scénarios en **PASS** (1 min 37 s ; la 0.6.9 avait bloqué
  24 minutes).
- `releases/latest/download/latest.json` : HTTP 200, version 0.6.10, signature
  valide et version reconnue plus récente pour des clients **0.6.9**, **0.6.8** et
  **0.6.7** (comparaison numérique : 0.6.10 > 0.6.9) ; archive accessible.

## Flux réel 0.6.9 → 0.6.10

À constater sur l'installation de l'utilisateur.

## Limites connues

- Ollama : un forfait payant sans nom explicite sur la page (`paid`) réactive
  l'abonnement sans renommer le forfait.
- `latest.json` reste signé localement (secret CI non configuré, par choix).
- Windows x64 uniquement, HTTPS obligatoire, aucun certificat Authenticode.
