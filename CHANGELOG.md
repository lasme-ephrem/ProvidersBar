# Historique des versions

## 0.2.1 — 17 octobre 2026

- L’actualisation automatique Grok utilise un navigateur sans fenêtre, sans ouvrir ni réduire une fenêtre à chaque relevé.
- Si le dashboard redirige vers une authentification externe, le lecteur essaie une seule fois le panneau officiel Grok. Il ne lit pas la page d’authentification externe et conserve les quotas SuperGrok et Grok Bot distincts.
- Test de régression sur les actualisations répétées et vérification réelle des deux quotas sans fenêtre. La connexion et la vérification manuelles restent visibles.
- Le lecteur attend le rendu de la limite Grok Bot déjà connue pour éviter de la faire disparaître pendant le chargement du panneau.

## 0.2.0 — 17 octobre 2026

- Connexion au nouveau dashboard Grok, avec lecture du pool hebdomadaire partagé Grok/Grok Bot/Cursor et compatibilité du panneau Usage historique.
- Quota hebdomadaire Gemini 4 Argon dans le lecteur Antigravity, les cartes, le widget, les réinitialisations et les recommandations.
- Protection des connexions : tests des erreurs réseau, délais, renouvellement Claude, concurrence et conservation des derniers relevés.
- Intégration des changements locaux existants : lecture directe Claude, réserve Ollama, thèmes, dates et stratégie de consommation.
- Suppression du lecteur et du logo Gemini web devenus inutilisés ; correction du logo Claude dans l’aperçu.
- Remplacement complet des ressources lors des mises à jour, sans toucher aux comptes, et construction séparée d’une distribution sans données personnelles.
- README réorganisé et diagnostic réel des connexions explicite, avec rapport local sans secrets.
