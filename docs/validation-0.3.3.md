# Validation de la version 0.3.3 — 4 novembre 2026

Correctif du blocage Claude : la lecture directe inutilisable ne fige plus l'application sur un relevé de plusieurs jours. Ce document ne contient que des résultats réellement exécutés sur cette machine ; l'incident de credentials en §5 est signalé explicitement.

## 1. Cause du blocage restant (signalement utilisateur)

L'application 0.3.2 tournait en lecture directe (`accountSession: claude-live-local`). Le jeton Claude Code était expiré depuis le 29/10 et le renouvellement OAuth limité (`auth-rate-limit`), tandis qu'un relevé Claude Desktop **frais** existait (échantillon écrit à 00:35, 5 h 100 % / semaine 38 %). Deux défauts expliquaient l'écran observé (« Dernier relevé · reprise en attente », « Relevé ancien il y a 6 j ») :

1. Le repli vers Claude Desktop introduit en 0.3.1 ne se déclenchait que si **aucun** snapshot n'existait. Un snapshot périmé de 6 jours bloquait donc la bascule.
2. Le mode restant `claude-live-local`, l'observateur du fichier Claude Desktop n'était pas actif : même un relevé frais n'était jamais lu.

## 2. Correctif livré

- **Règle de repli** (`main.cjs`, fonction pure testée) : si la lecture directe échoue avec `rate-limit`, `auth-rate-limit` ou `auth-*` **et** que le dernier relevé est absent ou périmé (> 10 minutes), une lecture Claude Desktop de secours est tentée. Un relevé frais (< 10 minutes) n'est jamais remplacé.
- **Bascule uniquement sur donnée lisible** : si le relevé Desktop est lu (même ancien), le mode passe explicitement à `claude-desktop-local`, le relevé est enregistré et l'UI l'annonce. Si Desktop est absent/illisible, aucune bascule n'a lieu : mode, snapshot et cooldown sont conservés, avec une consigne actionnable ; le cycle suivant réessaie.
- **`allowStale`** (`lib/claude-desktop-usage.cjs`) : en repli uniquement, un échantillon de plus de 45 minutes est accepté et affiché avec son horodatage réel, `stale: true` et un libellé « relevé ancien ». Le mode Desktop normal continue de rejeter un échantillon de plus de 45 minutes.
- **Documentation** : README et `docs/architecture.md` précisent la règle (bascule sur relevé périmé, gestion du cas Desktop indisponible, aucune oscillation).

## 3. Preuves réelles du correctif

Harnais Playwright Electron sur **copie isolée** de `dist\ProvidersBar-win32-x64\data` (profil Claude Code factice, autoRefresh désactivé ; original non modifié) :

| Scénario | Résultat |
| --- | --- |
| Cas utilisateur exact : mode direct + `auth-rate-limit` + snapshot du 28/10 (97/63) + relevé Desktop réel frais (23:35:16.503) | **succès** : bascule `claude-desktop-local`, snapshot `2026-11-03T23:35:16.503Z`, **5 h 100 % / semaine 38 %**, `error:null`, état persisté |
| Relevé Desktop ancien (2 h) | bascule quand même : `stale:true`, `updatedAt` réel, libellé « relevé ancien », message « dernier relevé connu » |
| Aucun relevé Desktop | erreur avec consigne actionnable ; mode, snapshot et cooldown conservés (aucune bascule sans donnée) |

Sur la machine réelle, le relevé Desktop est frais (00:35) : après redémarrage en 0.3.3, la bascule doit afficher immédiatement ces quotas.

## 4. Validation automatisée

| Commande | Résultat |
| --- | --- |
| `npm test` | **244 tests, 244 réussis, 0 échec, 0 ignoré** (~4,5 s) |
| `npm run verify` | **69 fichiers** validés |
| `npm run test:desktop` | **PASS** |
| `npm run test:resources:desktop` | **PASS** |
| `npm run test:claude:desktop` | **PASS** (échec initial, reprise, redémarrage, repli explicite, aucun jeton persisté) |
| `npm run doctor` | 16 OK / 1 avertissement (relevé Claude Desktop ancien au moment du contrôle) ; Antigravity détecté |

## 5. Incident — fichier de credentials Claude Code écrasé par un harnais de test

- **Fait** : un script de test d'un agent a utilisé la variable PowerShell automatique `$home` (lecture seule, non redéfinissable) et a écrit un profil factice dans le **vrai** dossier utilisateur. Conséquence : `C:\Users\lasme\.claude\.credentials.json` a été remplacé le 04/11 à 00:40:27 par des valeurs de test.
- **État antérieur** : ce jeton était déjà expiré depuis le 29/10 et son renouvellement était refusé/limité (`auth-rate-limit`) ; l'application demandait déjà une reconnexion Claude Code. La perte est donc sans impact sur la lecture Claude Desktop, mais le refresh token d'origine n'est pas récupérable.
- **Remédiation effectuée** : le fichier corrompu a été **déplacé** (et non supprimé) vers `C:\Users\lasme\.claude\.credentials.json.corrupted-fixture-2026-11-04`. Aucun autre fichier utilisateur n'a été modifié (vérifié : le reste de `~/.claude` est inchangé, les données du portable personnel sont intactes).
- **Action requise** : ouvrir Claude Code (ou exécuter `claude auth login`) et se reconnecter pour recréer un jeton valide. La lecture directe Claude redevient ensuite disponible (bouton « Activer la lecture directe »). La lecture Claude Desktop, elle, ne dépend pas de ce fichier.
- **Prévention** : les scénarios suivants utilisent un profil `$HOME`/`CLAUDE_HOME` explicitement isolé dans un dossier temporaire, avec garde anti-écriture hors de ce dossier.

## 6. Fabrication et déploiement

- `npm run package:release` : `dist/ProvidersBar-0.3.3-win32-x64/` créé, **sans `data/`**, avec README/CHANGELOG/PRIVACY/SECURITY embarqués.
- `npm run release:artifacts` : `dist/ProvidersBar-0.3.3-win32-x64.zip` (**151,2 Mo**), SHA-256 `9f27f236108896e60c4d39b9c9623858564e45ea3d5325a02c345f22581159d5` (`dist/SHA256SUMS-0.3.3.txt`).
- `npm run update:portable` : portable personnel `dist/ProvidersBar-win32-x64/` passé en **0.3.3**, données conservées (`data/state.json` intact).

## 7. Limites

1. La lecture directe Claude dépend du renouvellement du jeton par Claude Code (voir §5 pour la reconnexion nécessaire après l'incident).
2. Le relevé Claude Desktop reste un échantillon : au-delà de 45 minutes, il n'est affiché qu'en repli, avec sa date réelle et la mention « relevé ancien » ; ouvrir la page Utilisation de Claude Desktop provoque une mesure fraîche.
3. Un relevé direct frais (< 10 minutes) n'est jamais remplacé par le repli, même si ce dernier est disponible.
4. Validation locale et datée, une machine et un compte ; les autres fournisseurs ne sont pas rejoués dans ce correctif (voir validations 0.3.1 et 0.3.2).

## 8. Conclusion

Le cas signalé est corrigé : l'application ne reste plus figée sur un relevé de 6 jours quand la lecture directe est bloquée et qu'un relevé Desktop existe ; elle bascule explicitement, affiche des quotas réels (100 % / 38 % ici), et ne change pas de mode sans donnée lisible. Le seul impact de l'incident de credentials est la nécessité de reconnecter Claude Code pour la lecture directe, ce qui était de toute façon requis par l'expiration du jeton.
