# Validation ProvidersBar 0.3.0

Résultats réels constatés le **3 novembre 2026** (relevé à 21:18) sur Windows x64, Node.js **24.18.0**, Electron **44.10.2**, branche `refonte/pro`, version `package.json` **0.3.0**.

Ce document ne contient que des résultats exécutés sur cette machine. Les compteurs de tests et de fichiers peuvent évoluer avec les ajouts de la même journée ; les valeurs ci-dessous sont celles constatées à l’heure indiquée. Tout ce qui n’a pas été rejoué est signalé explicitement comme **non vérifié** ou laissé en emplacement « à compléter par le Lead ».

## Tests automatisés

| Commande | Résultat |
| --- | --- |
| `npm test` | **226 tests · 225 réussis · 0 échec · 1 ignoré** (voir ci-dessous) |
| `node --test tests/quality.test.cjs` | **17 tests · 17 réussis · 0 ignoré** — le test de cohérence des versions est **réactivé** : `package.json` = dernier titre du CHANGELOG = version annoncée par le README (0.3.0) |
| `npm run verify` (et `npm run lint`, alias) | **68 fichiers** `.cjs`/`.js` vérifiés par `node --check` : OK |
| `npm run doctor` | **17 vérifications · 15 OK · 2 avertissements · 0 échec critique** (code retour 0) |
| `npm audit` et `npm audit --omit=dev` | **0 vulnérabilité** |

**Unique test ignoré** : `tests/packaging.test.cjs` → « preview.cjs sert l’interface et un état simulé sans compte ». Le test s’auto-ignore lorsque le port 4317 est déjà occupé. Sur cette machine, un serveur d’aperçu externe (`npm run preview`, processus node hors suite de tests) écoutait sur `127.0.0.1:4317` pendant la validation. Ce n’est ni un échec ni un défaut du code : relancer `npm test` après avoir arrêté l’aperçu, ou sur une machine sans aperçu (cas de la CI), exécute le test normalement. Les autres tests du fichier `packaging.test.cjs` sont verts.

La suite est déterministe : pas d’Electron, pas de réseau, pas de compte réel, pas de temporisation réelle (les délais et horloges sont injectés). Elle couvre notamment : validation des entrées, migrations idempotentes et sauvegardes, stockage atomique, sécurité des fenêtres et allowlist d’origines, export nettoyé, diagnostic, connecteurs et cooldowns, renouvellement Claude sous verrous, sessions web, packaging et contrôles transverses (secrets, marqueurs, versions, CI).

### Détail du diagnostic `npm run doctor`

17 contrôles, exécutés en lecture seule, sans secret :

- **OK (15)** : dossier de données accessible en écriture ; DPAPI Windows disponible ; Google Chrome détecté ; Codex installé ; connexion Claude Code présente (jeton à renouveler) ; accès HTTP non authentifié attendu pour OpenRouter, DeepSeek, RunInfra, OrcaRouter, Anthropic (lecture directe), ChatGPT, Claude, Grok, Z.AI, Ollama (401/403/3xx considérés comme normaux sans identifiant).
- **Avertissements (2)** : « Claude Desktop » — aucun relevé local de Claude Desktop sur cette machine ; « Antigravity (service local) » — service local non détecté (application Antigravity 2.0 non ouverte pendant le diagnostic).
- Aucun prérequis **critique** manquant (`data-dir` et `encryption` sont les seuls bloquants).

## Session navigateur (pipe CDP)

- Les lecteurs de comptes utilisent `--remote-debugging-pipe` : plus de port TCP de débogage ouvert par les navigateurs de connexion (`lib/account-browser.cjs`).
- Un port local n’existe qu’en mode diagnostic explicite (`--remote-debugging-port`), requis par `npm run verify:connections` et `npm run update:portable` ; la purge de démarrage préserve alors `DevToolsActivePort`.
- **Validation manuelle du pipe Chrome par le Lead le 3 novembre 2026** : lecture de compte via Chrome effectuée avec succès dans l’application 0.3.0. Ce point est rapporté par le Lead ; il n’a pas été rejoué par l’auteur de ce document.

## Smoke tests Electron — exécutés le 3 novembre 2026

Session Windows graphique interactive, application isolée par test (`test-results/`). Exécutés par l'auteur de T5b puis **rejoués indépendamment par le Lead** : exit 0 sur les trois commandes.

| Commande | Date | Résultat | Captures / artefacts |
| --- | --- | --- | --- |
| `npm test` | 3 nov. 2026 | **227 tests / 227 réussis / 0 échec / 0 ignoré** (~4,5 s) | — |
| `npm run test:desktop` | 3 nov. 2026 | **PASS**, exit 0 (~23 s) | `test-results/dashboard*.png`, `strategy-*.png`, `quick.png`, `subscriptions.png`, `connections*.png`, `provider-details.png`, `expired-subscription.png`, `history.png`, `settings-*.png`, `erase-data.png`, `reset-editor.png`, etc. |
| `npm run test:resources:desktop` | 3 nov. 2026 | **PASS**, exit 0 (~4 s) | `test-results/resource-status-dashboard.png`, `resource-status-widget.png` |
| `npm run test:claude:desktop` | 3 nov. 2026 | **PASS**, exit 0 (~6 s) | `test-results/claude-*.png` |
| `npm run preview` | 3 nov. 2026 | utilisé pour les captures Chromium du Lead (1360×940 clair/sombre, 700 px responsive, widget 400×700) | `test-results/ui-*.png` |

Contrôles visuels effectués sur ces captures (Chromium + Electron réel) : navigation latérale puis barre supérieure sous 900 px sans masquage, thèmes clair/sombre/système, contrastes et focus, badge de fraîcheur et statut d'actualisation réels dans le widget, version dynamique « Version 0.3.0 · Electron 44.10.2 », double confirmation d'effacement, `getAppInfo`/`eraseData` de bout en bout, layout widget sans chevauchement (correction T1b).

## Lectures réelles des fournisseurs

**Non rejouées pour la 0.3.0.** La refonte modifie les sessions Ollama/OrcaRouter, le transport Claude et le pilotage des navigateurs : les lectures réelles de la 0.2.0 (archivées dans [validation-0.2.0.md](validation-0.2.0.md)) ne valent pas validation pour cette version.

Procédure à exécuter après validation des smoke tests : quitter le portable, le lancer avec `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`, exécuter `npm run verify:connections` (ajouter `--include-inactive` pour vérifier aussi les services expirés ou en pause), puis quitter et relancer normalement. Le rapport `test-results/connections-live.json` ne contient ni identité, ni clé, ni cookie, ni montant de portefeuille.

## Fabrication et distribution

- `npm run package:release` exécuté le 3 novembre 2026 : dossier `dist/ProvidersBar-0.3.0-win32-x64/` créé, **sans `data/`**, avec `README.md`, `CHANGELOG.md`, `PRIVACY.md` et `SECURITY.md` embarqués dans `resources/app/`. L'exécutable n'est pas signé (voir [SECURITY.md](../SECURITY.md)).
- `npm run release:artifacts` exécuté le 3 novembre 2026 : archive `dist/ProvidersBar-0.3.0-win32-x64.zip` (**151,1 Mo**) et empreinte dans `dist/SHA256SUMS-0.3.0.txt` (`sha256 a4876621ba1d77d96e91af215da9051327d09ce5e540d8702cc345b6d50c9bb0`). Le script refuse toute archive si un dossier de données personnelles est détecté dans la release.
- Le portable personnel (`npm run package`) n'a pas été reconstruit pendant cette validation : il conserve ses données et reste mis à jour par `npm run update:portable`.
- Audits exécutés : `npm audit` = 0, `npm audit --omit=dev` = 0. Electron verrouillé : **44.10.2** exact (44.x requis par la refonte).

## Limites de cette validation

- Résultats d’une seule machine Windows x64 ; la CI (`windows-latest`, Node 24) rejoue `verify`, `lint`, `npm test` et `npm audit --omit=dev`.
- Le test d’aperçu est ignoré sur cette machine parce qu’un serveur d’aperçu externe occupait le port 4317 ; le code du serveur n’est pas en cause.
- L’accessibilité est auditée statiquement (structure ARIA, contrastes calculés ≥ 4,5:1, focus ≥ 3:1) et doit être confirmée visuellement et, idéalement, avec un lecteur d’écran lors des smoke tests.
- Aucune lecture réelle de fournisseur n’a été effectuée : les formats externes peuvent changer, et un format inconnu est signalé comme erreur, jamais estimé.
- Les résultats ci-dessus décrivent l’état du dépôt au 3 novembre 2026 ; toute modification ultérieure du code ou des dépendances invalide tout ou partie de cette validation.
