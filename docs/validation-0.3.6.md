# Validation de la version 0.3.6 — 4 novembre 2026

Widget vertical complet : toutes les informations de chaque abonnement et de chaque API sont visibles, sans agrégation ni compteur « +N ».

## 1. Demande utilisateur

« La widget n'est toujours pas correcte pour chaque abonnement, toutes les informations n'apparaissent pas, par exemple pour Claude ; si la place ne tient pas, passer en vertical propre bien stylé. Aussi Ollama, tu ne l'affiches pas. » La vidéo jointe n'a pas pu être décodée (fichier MP4 temporaire incomplet, 79 Ko), mais les constats ont été reproduits dans le code et avec des données réalistes.

## 2. Widget vertical complet

- **Une ligne par information** : en-tête (logo 20 px, nom, chip de niveau) puis une ligne label/valeur par fenêtre ; plus aucun résumé plafonné à deux segments ni `+N`.
- **Claude** : `Hebdo 40 %`, `Horaire 80 %`, `Hebdo Fable 30 %` — les trois visibles.
- **Antigravity** : `Gemini · Hebdo 88 %`, `Gemini · Horaire 95 %`, `Claude / GPT · Hebdo 70 %`, `Claude / GPT · Horaire 90 %`, `Hebdo Argon 60 %` — les cinq visibles.
- **Ollama** : `Limite Free 100 %` et `Crédits achetés 1,05 $US` (avant : « — » muet) ; si le compteur Free est absent, « Limite Free non communiquée » ; la réserve est lue dès qu'un montant USD valide existe.
- **API** : tous les soldes, devise par devise (`USD`, `CNY`), avec la couleur de niveau — DeepSeek USD + CNY, OpenRouter, RunInfra, OrcaRouter.
- **Compacité** : une information unique (OpenAI, Grok, API mono-solde) reste sur la ligne d'en-tête (`.quick-fact-inline`) ; fenêtre **360 × 660**, lignes de 28 à 115 px, icônes 18 px, dix fournisseurs visibles **sans défilement** (mesure `scrollHeight = clientHeight = 561` à 660 px), footer visible, aucun débordement horizontal ; barre fine de 5 px uniquement si la fenêtre est réduite (vérifié à 360 × 320).
- **Accessibilité** : boutons `[data-provider]`, chip `.level-pill` avec `title` explicite, valeurs colorées avec texte, détail complet dans `title` et `.sr-only`, focus restauré.

Captures : `test-results/widget-vertical-complete.png` (360×660 @2x), `test-results/quick.png` (smoke), `widget-scroll-360x320.png` (défilement fin), `after-claude-card.png`, `after-antigravity-card.png`.

## 3. Correctif annexe Claude (découvert pendant la validation)

Le bouton **Vérifier maintenant** pouvait rester bloqué par un cooldown d'authentification (`auth-required`) alors que Claude Code venait d'être reconnecté, l'observateur de credentials n'ayant pas toujours le temps de lever le délai. Une vérification **manuelle** (bouton Vérifier, Connexion, activation de la lecture directe) lève désormais explicitement ce cooldown avant la lecture, comme l'attend l'utilisateur ; une nouvelle erreur réarme le délai. Le smoke Claude a été stabilisé (transport simulé installé avant l'écriture des credentials, 20 tentatives) et passe de façon répétée.

## 4. Validation automatisée

| Commande | Résultat |
| --- | --- |
| `npm test` | **227 tests, 227 réussis, 0 échec, 0 ignoré** (~4,3 s) |
| `npm run verify` | **66 fichiers** validés |
| `npm run test:desktop` | **PASS** (widget 360×660, toutes fenêtres, Ollama Free + crédits, soldes multi-devises, aucun `+N`, scroll fin à 320) |
| `npm run test:resources:desktop` | **PASS** (statuts par fenêtre, fact-values colorées, chip agrégé, deux thèmes) |
| `npm run test:claude:desktop` | **PASS** (reprise après reconnexion, panne/backoff, repli Desktop) |

## 5. Fabrication et déploiement

- `npm run package:release` : `dist/Lasmium TOKENS-HUB-0.3.6-win32-x64/`, **sans `data/`**, README/CHANGELOG/PRIVACY/SECURITY et police Inter + licence embarqués.
- `npm run release:artifacts` : `dist/Lasmium TOKENS-HUB-0.3.6-win32-x64.zip` (**151,5 Mo**), SHA-256 `cda0fd4c6343d400c15bab4650968ddaa3722bf7a6031b97cb3dfd2229a007f4` (`dist/SHA256SUMS-0.3.6.txt`).
- `npm run update:portable` : portable personnel en **0.3.6**, données conservées (`data/state.json` intact). Quitter l'application ouverte puis la relancer pour charger la nouvelle version.

## 6. Limites

1. **Hauteur fixe 660 px** : au zoom Windows important ou avec une police système agrandie, la liste défile avec la barre fine (comportement voulu). Aucun auto-dimensionnement.
2. **Pas d'âge permanent** : la fraîcheur reste dans l'infobulle ; seul l'indicateur « Relevé à vérifier » apparaît si nécessaire.
3. **Fournisseurs non suivis** (expirés non-Ollama, en pause) absents du widget, comme avant.
4. **Libellés agrégés par groupe** : `Gemini · Hebdo`, `Claude / GPT · Hebdo`, `Grok / Bot / Cursor · Hebdo` — chaque fenêtre reste une ligne distincte.
5. Validation locale et datée, données de fixtures pour les fenêtres (les valeurs réelles Ollama/Antigravity/Claude ont par ailleurs été vérifiées dans les validations 0.3.1 à 0.3.3).

## 7. Conclusion

Le widget affiche désormais **toutes** les informations par abonnement, y compris Ollama (limite Free + crédits achetés) et tous les soldes API, dans une mise en page verticale propre, sans masquage `+N`, à 360 × 660. La suite unitaire et les trois smokes Electron passent, la release 0.3.6 est construite et le portable personnel mis à jour.
