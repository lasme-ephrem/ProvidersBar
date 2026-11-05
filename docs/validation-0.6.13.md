# Validation 0.6.13

Date : 5 novembre 2026
Commit : `a30eb8c` — tag `v0.6.13`
Release : https://github.com/lasme-ephrem/lasmium-tokens-bar/releases/tag/v0.6.13

Version corrective : l'icône de la barre des tâches ne dépend plus du cache
d'icônes de Windows.

## Origine

Captures de l'utilisateur après installation de la 0.6.12 : dans l'Explorateur,
`LasmiumTokensHub.exe` affiche le « L » Lasmium, mais `unins000.exe` et la barre
des tâches affichent encore l'ancienne icône ProvidersBar. Contrôles sur le PC :
version installée 0.6.12, ressources de l'exécutable correctes, icône extraite par
Windows correcte, raccourci du menu Démarrer pointant sur l'exécutable. Windows
réutilisait l'icône mise en cache pour ces chemins lors de l'installation 0.6.11.

## Correction

- `main.cjs` : `mainWindow.setAppDetails({ appId, appIconPath: assets/icon.ico,
  appIconIndex: 0, relaunchCommand, relaunchDisplayName })` ; la barre des tâches
  reçoit l'icône d'un fichier que Windows n'a jamais mis en cache.
- Installeur : `IconFilename: "{app}\resources\app\assets\icon.ico"` pour les
  raccourcis du menu Démarrer et du Bureau.

## Artefacts publiés

| Fichier | SHA-256 |
| --- | --- |
| `LasmiumTokensHub-0.6.13-win32-x64.zip` | `bea3445481781e487c1d2511b365b42183d0332a4e6c68fe9658050651414c7c` |
| `LasmiumTokensHub-Setup-0.6.13.exe` | `4d2ee3e0aa95b9ec0a518192f17c282690e9315d99c2134bbf4340918ad9c78d` |

- Empreintes identiques à `SHA256SUMS-0.6.13.txt` après téléchargement du brouillon.
- ZIP publié : `resources/app/assets/icon.ico` identique à la source (marque
  Lasmium), `main.cjs` avec `setAppDetails`, exécutable « Lasmium TOKENS-HUB » 0.6.13.
- `latest.json` signé localement ; valide et plus récent pour des clients 0.6.12 et
  0.6.11 ; ZIP et installeur accessibles (HTTP 200).
- Workflow Release vert ; CI du commit de la version verte (tests et smoke Electron).

## Contrôles locaux

`npm run lint` (0 erreur), `npm test` (**366/366**), smoke en développement
**PASS**. Smoke sur l'exécutable construit : le tout premier lancement a échoué
sans message, puis trois lancements consécutifs ont réussi ; échec non reproduit
(probablement le premier démarrage d'un exécutable neuf).

## À constater chez l'utilisateur

Mise à jour 0.6.12 → 0.6.13 puis icône « L » dans la barre des tâches. Pour un
raccourci déjà épinglé ou `unins000.exe`, le cache peut persister jusqu'à
`ie4uinit.exe -show` ou une nouvelle session Windows.
