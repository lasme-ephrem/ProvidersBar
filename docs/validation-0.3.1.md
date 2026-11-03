# Validation ProvidersBar 0.3.1

Vérifications réelles du **3 novembre 2026** (Europe/Paris) sur Windows x64, Node.js **v24.18.0**, npm 11.16.0, Electron **44.10.2**, version applicative **0.3.1**, branche `refonte/pro`. Cette validation fait suite à T8 (chemins `Claude-Data` + découverte Antigravity par PID), T8b (`auth-rate-limit`) et T9 (repli explicite Claude Desktop), et à T11 (toast exact en cas de bascule).

**Méthode** : diagnostic local, lectures réelles des services locaux (Antigravity, fichier Claude Desktop), tests unitaires et smoke tests Electron réels. **Aucune inférence, aucun achat, aucune requête authentifiée vers un fournisseur** n'a été effectuée. Les sorties ne contiennent ni jeton, ni cookie, ni identité de compte, ni contenu de conversation : uniquement des états, des pourcentages, des dates et des statuts HTTP.

## 1. `npm run doctor` (exécuté réellement)

```
ProvidersBar 0.3.1 — diagnostic des prérequis

[OK] Dossier de données — Dossier accessible en écriture.
[OK] Chiffrement des clés (DPAPI) — DPAPI Windows disponible.
[OK] Navigateur Chrome ou Edge — Google Chrome détecté.
[OK] Codex (OpenAI) — Codex installé.
[ÉCHEC] Claude Desktop — Relevé Claude Desktop ancien : aucun nouveau quota depuis plus de 45 minutes. Claude peut suspendre ses relevés même ouvert. Ouvre son menu près de l’horloge ou sa page Utilisation pour relancer l’actualisation ; ProvidersBar récupérera le prochain relevé automatiquement.
        → Ouvre la page Utilisation de Claude Desktop pour relancer ses mesures, puis relance le diagnostic.
[OK] Claude Code (lecture directe) — Connexion Claude Code présente, jeton à renouveler.
[OK] Antigravity (service local) — Service local détecté (9 port(s) local(aux)).
[OK] Accès openrouter — HTTP 401 (réponse attendue sans clé)
[OK] Accès deepseek — HTTP 401 (réponse attendue sans clé)
[OK] Accès runinfra — HTTP 401 (réponse attendue sans clé)
[OK] Accès orcarouter — HTTP 401 (réponse attendue sans clé)
[OK] Accès Anthropic (lecture directe) — HTTP 429
[OK] Accès ChatGPT — HTTP 403 (réponse attendue sans clé)
[OK] Accès Claude — HTTP 403 (réponse attendue sans clé)
[OK] Accès Grok — HTTP 200
[OK] Accès Z.AI — HTTP 307
[OK] Accès Ollama — HTTP 303

17 vérifications · 16 OK · 1 échec(s).
Aucun prérequis critique manquant. Les lignes [ÉCHEC] ci-dessus sont des avertissements à corriger.
```

Code de sortie : **0** (aucun prérequis critique manquant). Lecture :

- **Claude Desktop est bien découvert** : le diagnostic a trouvé le relevé dans `%LOCALAPPDATA%\Claude-Data\<profil>\plan-usage-history.json` et l'a lu ; le **[ÉCHEC] est le comportement attendu** d'un échantillon de plus de 45 minutes (message explicite), pas un échec de découverte. Un relevé frais produit `[OK]`.
- **Antigravity est détecté** (`[OK]`, 9 ports loopback au moment du run ; 8 à 10 observés pendant la session, la valeur varie car le service ouvre/ferme des ports). Le service était lancé et le jeton CSRF lisible.
- **Claude Code** est présent avec un jeton à renouveler : c'est cette situation qui déclenche, en lecture directe, le renouvellement OAuth dont le 429 est désormais typé `auth-rate-limit`.
- Les statuts des endpoints peuvent varier entre deux runs sans changer le verdict (`401/403/429/200/307/303`, tous `< 500` : `[OK]`).

## 2. Lectures réelles

### 2.1 Antigravity (service local, lecture réelle)

Commande : `node -e "require('./lib/antigravity-account.cjs').fetchAntigravityQuota()"` (exécutée sur la machine réelle).

```json
{
  "quotaWindows": [
    { "label": "Gemini · Semaine",       "remaining": 91,  "resetAt": "2026-11-08T17:45:23.000Z" },
    { "label": "Gemini · 5 heures",      "remaining": 99,  "resetAt": "2026-11-04T00:56:15.000Z" },
    { "label": "Claude et GPT · Semaine","remaining": 93,  "resetAt": "2026-11-06T01:00:16.000Z" },
    { "label": "Claude et GPT · 5 heures","remaining": 100,"resetAt": "2026-11-04T03:24:22.000Z" }
  ],
  "warnings": []
}
```

Preuve de la découverte par PID : `discoverServers()` a renvoyé 8 serveurs vérifiés (ports loopback `[49985, 53733, 53734, 54651, 59521, 59522, 61570, 64038]`). Une requête ciblée sur **`127.0.0.1:53733`** a répondu **HTTP 200** (1 570 octets) avec les buckets `gemini-weekly`, `gemini-5h`, `3p-weekly`, `3p-5h` ; la lecture ci-dessus retourne **4 fenêtres** (Gemini 5 h/semaine, Claude-GPT 5 h/semaine). **Le bucket Argon (`gemini-argon-wtu-weekly`) n'est pas renvoyé par le service actuellement** (état du compte/version) : il n'est donc pas forcé, aucun quota Argon n'est fabriqué. Le jeton CSRF n'est jamais affiché ni journalisé.

### 2.2 Claude Desktop (fichier local réel)

Commande : lecture via `readClaudeDesktopUsage` sur les chemins réels, avec un `now` injecté car l'échantillon a **93 minutes** (> limite de 45 min) :

- Fichiers détectés : **1**, `%LOCALAPPDATA%\Claude-Data\claude_pzs8sxrjxfjjc\plan-usage-history.json` (nouveau layout T8).
- En production (sans injection), ce relevé affiche le message **« Relevé Claude Desktop ancien : aucun nouveau quota depuis plus de 45 minutes… »** — attendu, le relevé n'est pas corrompu.
- Avec `now = sample.t + 60 s` (pour vérifier le parsing réel sans attendre un nouveau relevé) :

```json
{
  "source": "api",
  "connectorVersion": "claude-desktop-local-v1",
  "updatedAt": "2026-11-03T20:47:20.626Z",
  "quotaWindows": [
    { "label": "5 heures", "remaining": 100, "resetAt": null },
    { "label": "Semaine",  "remaining": 38,  "resetAt": null }
  ],
  "quotaRemaining": 38,
  "quotaLabel": "Claude · Semaine · Claude Desktop"
}
```

Le relevé réel confirme donc **5 h 100 % restants et semaine 38 % restants** ; les dates de reset ne sont pas fournies par le fichier (restent inconnues, jamais inventées). Aucune identité, aucun `org`, aucune conversation n'est lue ni affichée : seuls `samples[].t` et `samples[].u` sont utilisés.

### 2.3 Lecture directe Claude Code

Non exécutée contre Anthropic dans cette validation (le jeton local est à renouveler et l'endpoint a répondu 429 au diagnostic, ce qui est précisément le cas couvert par le repli T9/T8b). Le comportement du renouvellement et du repli est couvert par les tests unitaires et par le smoke Electron décrit au §3.

## 3. Smoke tests Electron (exécutés réellement, session Windows interactive)

| Commande | Résultat | Durée locale | Captures principales |
|---|---|---:|---|
| `npm run test:desktop` | **PASS**, exit 0 | **16,6 s** | dashboard, quick, resource-levels, claude-live-connection, settings-dark/light, erase-data, compact-window… |
| `npm run test:resources:desktop` | **PASS**, exit 0 | **2,0 s** | resource-status-dashboard/widget.png |
| `npm run test:claude:desktop` | **PASS**, exit 0 | **6,1 s** | claude-initial-failure, claude-recovery, claude-recovered, **claude-desktop-fallback** |

Apports de cette validation au `smoke-claude` :

- **Isolation complète des sources Claude** : `USERPROFILE`, `HOME`, **`LOCALAPPDATA` et `APPDATA`** pointent vers des dossiers temporaires ; sans cela, un relevé Claude Desktop réel sur la machine déclencherait le repli T9 et changerait le scénario « auth-required sans snapshot ». Aucun identifiant réel n'est lu.
- **Scénario de repli explicite** (nouveau) : session `claude-live-local` sans snapshot + jeton expiré + renouvellement OAuth en **429** (mode `rate-limit-token` simulé) + relevé Desktop frais dans un `LOCALAPPDATA` isolé (fixture `5 h 100 % / semaine 38 %`).
  Vérifié de bout en bout : bascule `accountSession.kind = claude-desktop-local`, **snapshot Desktop persisté [100, 38]**, `claudeSync.errorCode = auth-rate-limit` avec `nextAttemptAt` futur, message explicite dans la fiche (« Lecture directe indisponible … utilise le relevé Claude Desktop »), et **toast neutre T11** (« Connexion Claude mise à jour : relevé Claude Desktop utilisé. ») avec assertion négative interdisant « Lecture directe Claude activée ». Capture : `test-results/claude-desktop-fallback.png`.
- Scénarios conservés : échec initial `auth-required` sans snapshot, persistance du mode direct après redémarrage, reprise après renouvellement local, panne réseau + backoff + reprise (horloge du processus principal décalée, pas d'attente réelle), pourcentages utilisés/restants, absence de jeton dans `state.json` et dans le renderer.

## 4. Tests unitaires et vérifications

| Commande | Résultat |
|---|---|
| `npm test` | **239 tests, 239 réussis, 0 échec, 0 ignoré** — 4,7 s |
| `npm run verify` (`node scripts/check-syntax.cjs`) | 69 fichiers, exit 0 |
| `npm run doctor` | 17 vérifications, 16 OK, 1 échec attendu (relevé Desktop > 45 min), exit 0 |

Le test de version du CHANGELOG/README est actif (0.3.1 aligné) : aucun test ignoré.

## 5. Limites et points de vigilance

1. **La lecture directe Claude dépend du renouvellement du jeton par Claude Code.** Si Anthropic limite ce renouvellement (`auth-rate-limit`, HTTP 429), ProvidersBar ne force pas de rotation supplémentaire : avec un relevé existant, il conserve le dernier relevé et son horodatage avec une erreur actionnable ; **sans relevé**, il bascule explicitement en lecture Claude Desktop et l'annonce (fiche + toast neutre). Ce repli ne s'applique jamais s'il devait écraser un relevé existant.
2. **Le relevé Claude Desktop est un échantillon périodique.** Au-delà de 45 minutes, l'application et `npm run doctor` signalent « relevé ancien » : c'est un avertissement de fraîcheur, pas une panne de découverte ni un quota inventé. Il suffit d'ouvrir la page Utilisation de Claude Desktop pour provoquer un nouveau relevé.
3. **Antigravity dépend du service local d'Antigravity 2.0.** Les ports loopback changent à chaque lancement (8 à 10 observés) ; la découverte par PID filtre le processus installé et un port y a répondu HTTP 200. **Le bucket Argon n'est pas exposé par le service dans son état actuel** : quatre fenêtres seulement sont affichées, et Argon n'est pas fabriqué. Une future version du service pourra l'ajouter.
4. **Statuts HTTP des endpoints variables** entre runs (`401/403/429/307/303`) selon les protections des sites ; le diagnostic les considère OK tant qu'ils ne sont pas `>= 500`, et n'envoie aucune clé.
5. **Validation locale et datée** : une seule machine, un seul compte par fournisseur, le 3 novembre 2026. Les formats web et services locaux peuvent évoluer ; ces vérifications ne garantissent pas la compatibilité future et ne remplacent pas une lecture réelle après mise à jour.
6. Les smoke tests utilisent des transports simulés et des dossiers isolés ; seules les lectures du §2 touchent les services locaux réels (Antigravity, fichier Claude Desktop). Aucun appel de modèle, aucun achat, aucune donnée de compte publiée.
7. Les smoke tests laissent des dossiers temporaires ignorés par Git dans `test-results/` (`smoke-data-*`, `claude-*`) : nettoyables après les campagnes de validation.

## 6. Conclusion

Sur cette machine et à cette date, Claude Desktop (via le nouveau chemin `Claude-Data`), la lecture directe Claude (échec typé et repli explicite) et Antigravity (4 fenêtres réelles, dont les deux groupes 5 h/semaine) sont fonctionnels. Le repli Desktop est couvert de bout en bout dans Electron, sans identifiants réels. Les limites ci-dessus (jeton Claude Code à renouveler, Argon absent du service, fraîcheur de l'échantillon Desktop) sont documentées et ne bloquent pas la livraison 0.3.1.

## 7. Fabrication et déploiement

- `npm run package:release` exécuté le 3 novembre 2026 : dossier `dist/ProvidersBar-0.3.1-win32-x64/` créé, **sans `data/`**, avec `README.md`, `CHANGELOG.md`, `PRIVACY.md` et `SECURITY.md` embarqués dans `resources/app/`.
- `npm run release:artifacts` : archive `dist/ProvidersBar-0.3.1-win32-x64.zip` (**151,1 Mo**) et `dist/SHA256SUMS-0.3.1.txt` (`sha256 be57126e54b31f08cfa232d6c2408db099fc96e19f0097ae1af3351e6e51d37e`).
- `npm run update:portable` exécuté : le portable personnel `dist/ProvidersBar-win32-x64/` utilise désormais les ressources **0.3.1** et conserve ses données existantes (`data/state.json` intact). L'application 0.3.0 encore ouverte doit être quittée puis relancée pour bénéficier du correctif.
