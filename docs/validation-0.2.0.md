# Validation ProvidersBar 0.2.0

Vérifications du 17 octobre 2026 sur Windows x64, Node.js 24.18.0 et Electron 44.2.0. Les modifications locales antérieures ont été intégrées et vérifiées avec cette version.

## Tests automatisés

- 133 tests unitaires réussis : formats, fenêtres de quotas, dates, migrations, chiffrement, renouvellement Claude, sérialisation et annulation des connexions.
- Intégration Electron : inventaire, édition, IPC isolé, stockage chiffré, erreurs, déconnexion, export sans secrets, widget et redémarrage.
- Tests visuels des deux thèmes : soldes négatifs, épuisement de chaque limite, Argon et séparation Grok/Bot, pool partagé affiché une seule fois.
- Injection de pannes Claude : premier échec, choix de mode conservé, redémarrage et reprise automatique.
- Mise à jour des ressources : retrait du code obsolète, préservation octet par octet des données fictives et conservation de l’installation en cas d’échec de préparation.
- `npm audit` : aucune vulnérabilité connue dans les dépendances installées au moment de la validation.

Les tests Electron sont également exécutés sur l’exécutable de distribution avec des données temporaires isolées. La distribution contient les dépendances de production et leurs licences, et aucun dossier de comptes personnels.

## Lectures réelles

Les lecteurs ont effectué des consultations de quotas ou de soldes, sans lancer de modèle ni acheter de crédit. Le rapport détaillé reste dans `test-results/connections-live.json`, hors Git.

| Connexion | Résultat |
| --- | --- |
| OpenAI, via la connexion Codex existante | Lecture réelle réussie |
| Claude, mode direct déjà activé | Lecture réelle réussie |
| Grok SuperGrok | Lecture réelle réussie, semaine et reset propres |
| Grok Bot, limite distincte affichée sur ce compte | Lecture réelle réussie, semaine et reset propres |
| Antigravity | Lecture réelle réussie des groupes Gemini, Claude/GPT et de la semaine Gemini 4 Argon |
| Ollama | Lecture réelle réussie |
| OpenRouter | Lecture réelle réussie |
| DeepSeek | Lecture réelle réussie |
| RunInfra | Lecture réelle réussie |
| OrcaRouter | Lecture réelle réussie |
| Z.ai | Forfait expiré, suivi désactivé ; la vérification séparée confirme une session absente ou expirée |

Z.ai n’est pas présenté comme connecté avec succès. Sa reprise exige une connexion utilisateur valide et, pour réactiver un abonnement expiré, la confirmation de renouvellement avec une nouvelle échéance. Aucune réactivation ni modification de forfait n’a été effectuée.

Le pool partagé du nouveau forfait X Subscription est couvert par les tests de contrat et la documentation officielle ; le compte réel disponible utilise des limites SuperGrok/Bot distinctes. Les formats web et services internes peuvent changer : cette validation porte sur les versions et comptes observés, et ne garantit pas la compatibilité future.

## Nettoyage et livraison

Le lecteur et le logo Gemini web inutilisés ont été retirés ; les migrations historiques restent présentes pour préserver les anciens inventaires. Trois arbres locaux vides issus de fichiers temporaires ont été supprimés. Les comptes, sauvegardes et profils personnels ont été conservés. Les dépendances et résultats générés restent exclus de Git.

Le README décrit les connexions, limites, commandes de validation, données locales et procédures de fabrication. La distribution versionnée est distincte du portable personnel ; ce dernier conserve ses comptes lors de la mise à jour.
