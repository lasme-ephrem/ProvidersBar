# Validation 0.6.5

Date : 4 novembre 2026
Commit : `23afb24` — tag `v0.6.5`
Release : https://github.com/lasme-ephrem/ProvidersBar/releases/tag/v0.6.5

## Artefact publié

- Fichier : `LasmiumTokensHub-0.6.5-win32-x64.zip`
- Taille : **159 295 335 octets**
- SHA-256 : `cdc3b80cbce775d1aa14ebcbd43412865ef7840ea92b62cd98cf7e1f6cffc5b3`
- Manifeste : `latest.json`, signé Ed25519, `version: 0.6.5`, `minApp: 0.5.0`

## Contrôles locaux

| Contrôle | Résultat |
| --- | --- |
| `npm test` | **269/269** |
| `npm run verify` | 98 fichiers valides |
| Smoke packagé 0.6.5 | **PASS** |
| Extraction de l'archive publique dans Electron | **220 entrées**, racine `./` et `.asar` acceptés |
| Staging sous `<portable>/data/updates` | accepté |
| Autre sous-dossier du portable | refusé |
| Cible incluse dans le staging | refusée |
| Script d'installation réel (staging `data/updates`) | application remplacée, `data/state.json` conservé |
| `data/state.json` du portable de référence | 3 393 995 octets avant/après |

## Flux réel 0.6.0 → 0.6.5

Application cible : copie de la 0.6.5 dont `resources/app/package.json` annonce
`0.6.0`, avec un fichier sentinelle `data/update-sentinel.txt` contenant
`conserver-ce-fichier`.

1. `checkUpdate()` trouve la 0.6.5 publique.
2. `installUpdate()` télécharge le ZIP public, vérifie taille et SHA-256, extrait
   le staging, écrit le script et reçoit son accusé de démarrage.
3. L'application quitte ; le script détaché attend sa fermeture.
4. Le script sauvegarde `resources/app` et l'exécutable, copie la 0.6.5, puis
   relance l'application.

Résultat vérifié :

- version finale : **0.6.5** ;
- sentinelle : **présente** et inchangée ;
- `data/state.json` : présent ;
- journal de mise à jour :
  - `Attente de l'arrêt du processus …`
  - `Mise à jour copiée ; redémarrage.`
- journal applicatif : `Démarrage 0.6.5 · 3 pack(s) · 10 fournisseurs` ;
- sauvegarde de secours `resources/app.rollback-*` présente.

## Limites connues

- Le redémarrage est journalisé ; le harnais de test Playwright peut terminer
  l'application relancée en fin de scénario. Sur un poste normal, elle reste
  ouverte.
- Windows x64 uniquement, HTTPS obligatoire.
- Aucun certificat Authenticode : SmartScreen peut demander une confirmation.
- Les clients **0.6.0 à 0.6.4** doivent installer la 0.6.5 manuellement une fois.
  À partir de 0.6.5, l'auto-update est opérationnel.

## Clés

La clé privée de signature reste dans `.local/updater/private-key.pem`, ignorée
par Git. La clé publique `lib/updater-public.pem` est versionnée. Aucune clé
privée ni clé de fournisseur n'est publiée.
