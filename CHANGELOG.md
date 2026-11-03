# Historique des versions

## 0.3.0 — 3 novembre 2026

Version de refonte : fiabilité des connexions, sécurité du processus et des sessions, redessin accessible, outillage de diagnostic et passe de documentation. Electron **44.10.2** ; `npm audit` et `npm audit --omit=dev` : **0 vulnérabilité**.

### Sécurité

- `main.cjs` simplifié et durci : socle extrait dans `lib/data-store.cjs`, `lib/window-security.cjs` et `lib/privacy-export.cjs` ; garde IPC inchangée (frame principale et URL exacte de l’interface).
- Fenêtres d’interface : `devTools:false`, `spellcheck:false` ; identité Windows des notifications via `app.setAppUserModelId`.
- Fenêtres de connexion internes : navigation, redirections et popups limitées à une **liste fermée d’origines** (fournisseurs concernés et connexion Google) au lieu de « n’importe quel HTTPS » ; permissions et téléchargements refusés.
- Dossier de données restreint à l’utilisateur courant et à `SYSTEM` (`icacls /inheritance:r`) ; un échec produit un avertissement, jamais un blocage du démarrage.
- Purge au démarrage des fichiers `.tmp` interrompus, du port de diagnostic obsolète (sauf mode diagnostic), des sauvegardes de migration au-delà des deux plus récentes et des profils de navigateur temporaires orphelins.
- Export JSON nettoyé : `{ app, version, exportedAt, inventory, settings, strategy, manualResets, history }`, sans `accountSession`, `claudeSync`, `apiCooldowns` ni identité pseudonyme.
- Nouvelle action **Effacer mes données** (IPC `data:erase`, double confirmation côté interface) : supprime état, identifiants, profils et caches, puis réinitialise l’inventaire ; refusée pendant une synchronisation.
- Nouvel IPC `app:info` (version via `app.getVersion()`, plateforme, dossier de données, mode empaqueté) et `publicState().app` sans chemin absolu. Surface IPC portée à **24 canaux**.
- Sessions de navigateur sans **port TCP de débogage** : les lecteurs de comptes pilotent Chrome/Edge par `--remote-debugging-pipe` ; la première connexion se fait dans un navigateur ordinaire sans port de débogage, et un port local n’existe qu’en mode diagnostic explicite.

### Connexions

- Cooldowns 429 des clés API **persistants** (`state.apiCooldowns`, 100 entrées maximum), respectés après redémarrage, avec erreur `API_RATE_LIMIT` et heure de reprise conservées.
- Claude : instance unique du lecteur avec `fetchImpl = session.defaultSession.fetch` (proxy Windows respecté) ; renouvellement OAuth créé par la même factory, sans `globalThis.fetch` ; cooldown d’échec restauré au démarrage, reprise après rotation des identifiants, sortie de veille et réactivation de l’actualisation.
- Ollama et OrcaRouter : session enregistrée **avant** la première lecture ; une erreur transitoire ou un 429 conserve la session et le dernier relevé, le cycle de 5 minutes réessaie seul ; seule une authentification refusée (`OLLAMA_SIGNIN`, `ORCA_AUTH`) efface la session.
- Erreurs de connecteurs typées et distinctes (`API_RATE_LIMIT`, `OLLAMA_SIGNIN`/`OLLAMA_RATE_LIMIT`/`OLLAMA_TRANSIENT`, `ORCA_AUTH`/`ORCA_RATE_LIMIT`/`ORCA_TRANSIENT`) ; aucune logique de cooldown dupliquée.
- Requêtes API : GET uniquement, redirections refusées, délai de 20 s, reprises bornées et jitterisées, `Retry-After` plafonné ; rejet des réponses incohérentes (soldes négatifs ou incohérents, formats ambigus) plutôt qu’estimation.
- Nouveau diagnostic `npm run doctor` (17 contrôles lecture seule : dossier de données, DPAPI, navigateur, Codex, Claude Desktop, Claude Code, service Antigravity, accès réseau aux API) ; seuls `data-dir` et `encryption` sont bloquants.
- Nettoyage des profils temporaires délégué à `sweepTemporaryProfiles`, appelé au démarrage et lors de l’effacement.

### Interface

- Redessin du tableau de bord et du widget : shell, vues et helpers séparés (`renderer/views.js`, `renderer/ui-core.js`), CSS lisible et thèmes à tokens sémantiques.
- Thèmes **Clair / Sombre / Système (Windows)** : `system` suit `prefers-color-scheme` en direct (y compris changement Windows à chaud) ; les préférences explicites existantes sont conservées par migration.
- Accessibilité : contrastes texte ≥ 4,5:1 et focus ≥ 3:1, navigation jamais masquée (barre supérieure sous 900 px CSS), lien d’évitement, focus restauré après rendu, ARIA (navigation nommée, onglets, jauges avec valeur textuelle, `aria-live`), information jamais portée par la couleur seule, `prefers-reduced-motion` et `forced-colors`, texte ≥ 11 px.
- Widget : fraîcheur par ligne (« à l’instant », « il y a X min », « Relevé ancien ») et statut d’actualisation réel (« Actualisation auto : 5 min · Claude 1 min » ou désactivée).
- Version affichée dynamiquement depuis `app:info` ; marque neutre « Espace local » (plus de nom personnel) ; action **Effacer mes données** avec double confirmation ; mention explicite « Aucune télémétrie ».

### Qualité

- Suite unitaire portée à **226 tests**, 0 échec (un test d’aperçu s’auto-ignore si le port 4317 est déjà occupé), dont nouveaux tests pour `data-store`, `window-security`, `privacy-export`, `diagnostics`, packaging, qualité transverse et extensions de migrations.
- Test qualité réactivé sur la cohérence des versions : `package.json` = dernier titre du CHANGELOG = version annoncée par le README.
- `npm run verify` / `npm run lint` : vérification syntaxique de **68 fichiers** ; `npm run test:coverage` disponible.
- Intégration continue Windows (`.github/workflows/ci.yml`) : job **tests** obligatoire (`npm ci`, `verify`, `lint`, `npm test`, `npm audit --omit=dev`) et job **smoke-electron** best-effort (`continue-on-error`) pour les trois smoke tests, avec artefacts.
- Dé-flake d’un test de reprise réseau (horloge injectée) ; robustesse des timers du processus principal (expiration et actualisation protégées, synchronisations sans rejet non géré).
- Dépendances : Electron **44.10.2**, Playwright 1.63.0, `proper-lockfile` 4.1.2 ; aucune nouvelle dépendance.

### Documentation

- README réécrit pour la 0.3.0 (utilisation, dix fournisseurs, comportement des connexions, interface accessible, confidentialité, commandes réelles, CI, limites honnêtes).
- `docs/architecture.md` mis à jour : stockage et migrations, sécurité des fenêtres, allowlist, ACL, purge, sessions par pipe CDP, cooldowns, sessions Ollama/Orca, 24 canaux IPC, thème système.
- `docs/ordre-consommation.md` corrigé : trois réserves Antigravity (Gemini, Claude/GPT, Argon), priorité Argon, profil de coût aligné sur le cache lu (écriture exclue).
- Nouveau `docs/validation-0.3.0.md` (résultats réels datés, emplacements smoke à compléter) ; `renderer/CONTRAT-UI.md` documente le contrat d’interface de la refonte.

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
