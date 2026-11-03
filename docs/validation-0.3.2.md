# Validation de la version 0.3.2 — 4 novembre 2026

Correctif des connexions **Ollama**, **OrcaRouter** et **OpenRouter**, après la 0.3.0 et les correctifs 0.3.1 (Claude, Antigravity). Ce document ne contient que des résultats réellement exécutés sur cette machine ; les points non rejoués sont signalés comme tels.

## 1. Ollama — nouveau portail

**Cause** : `ollama.com/settings` a changé de structure. La page réelle authentifiée ne contient plus les libellés « Monthly usage / Included usage / Cloud usage / Current balance » ; elle présente « Usage credits Pay as you go $1.05 … », « Usage breakdown » et « Free usage 0 % used ». L'ancien parseur levait donc « Crédits mensuels Ollama non reconnus » et aucun relevé n'était affiché.

**Correctif** (`lib/ollama-account.cjs`) : lecture du compteur `Free usage N % used`, de l'en-tête « Usage credits » avec badge `Pay as you go` (Free/Pro/Max/Team conservés), et des anciennes pages payantes. Aucun crédit mensuel inclus n'est inventé quand la page ne le fournit pas.

**Vérifications réelles** (lecture du profil Chrome existant via le transport CDP pipe, aucun cookie affiché) :
```
cookies lus : 2
snapshot = { planTier: 'free', quotaRemaining: 100,
             usageCredits: { currency: 'USD', remaining: 1.05 },
             balances: [], resetAt: null, connectorVersion: 'ollama-monthly-credits-v1' }
```
Fixture versionnée (sanitisée) : `tests/fixtures/ollama-settings-2026-11-03.html` (e-mail remplacé par `user@example.test`).

## 2. OrcaRouter — vérification sans fenêtre et perte de session

**Cause** : `verifyOrcaAccount` exigeait la fenêtre de connexion ouverte via `readOrcaAccountRef()`. Sans fenêtre, la référence valait `null` → fausse erreur `ORCA_AUTH` qui, de surcroît, **supprimait la session persistée valide**. La lecture automatique (`syncOne`) n'était pas touchée, ce qui explique un relevé frais (27,26 USD) malgré un bouton « Vérifier maintenant » en échec.

**Correctif** (`main.cjs`) : la référence de compte persistée suffit pour vérifier sans fenêtre ; la fenêtre ne fait foi que pour une connexion neuve ou un changement de compte/espace ; origines `www`/non-`www` acceptées ; erreurs `ORCA_AUTH`/`ORCA_RATE_LIMIT`/`ORCA_TRANSIENT` remontées avec message actionnable et dernier relevé conservé ; les commandes génériques routent OrcaRouter et Ollama vers leurs handlers dédiés.

**Reproduction et vérification sur copie isolée** (original `dist/…/data` non modifié, revérifié après coup) :
- Avant : session `{userId:102647, workspaceId:102238}`, solde 27,258416 USD ; clic « Vérifier » sans fenêtre → erreur « Session OrcaRouter absente ou expirée », `connected:false`, `accountSession:null`.
- Après : même clic → nouveau snapshot **27,258416 USD**, session intacte, message de connexion ; sans session → message de reconnexion clair, dernier relevé conservé.
- « Ouvrir mon compte » : fenêtre `https://www.orcarouter.ai/console` → `…/console/overview` (allowlist OK), localStorage inchangé (`user` id 102647, `active_workspace_id` 102238, `quota_per_unit` 500000), vérification automatique OK.

## 3. OpenRouter — découvert réel

**Cause** : la clé de gestion enregistrée répond bien (`GET /api/v1/credits`, HTTP 200) mais le compte est légèrement à découvert : `total_credits = 45`, `total_usage = 45.08283509` → reste **−0,08283509 USD**. La garde « solde restant négatif = incohérence » (introduite en 0.3.0) rejetait cette réponse ; comme la connexion valide la clé avant de l'enregistrer, la clé n'était jamais sauvegardée.

**Correctif** (`lib/connectors.cjs`) : le découvert réel est conservé et affiché comme épuisé (le renderer et `resource-levels` traitent déjà un USD négatif comme « Épuisé »). Restent refusés : montants non finis/négatifs, formats invalides, et découvert invraisemblable (`used - total > max(total, 1)`).

**Vérification réelle** (déchiffrement DPAPI local avec le `userData` de l'application, clé jamais affichée) :
```
HTTP 200 · { total_credits: 45, total_usage: 45.08283509 }
fetchUsage('openrouter', clé) → remaining = -0.08283509000000322 USD
```
La clé peut désormais être enregistrée par l'application.

## 4. Validation automatisée

| Commande | Résultat |
| --- | --- |
| `npm test` | **243 tests, 243 réussis, 0 échec, 0 ignoré** (~4,6 s) |
| `npm run verify` | **69 fichiers** validés (`node --check`) |
| `npm run test:desktop` | **PASS** (inventaire, IPC, chiffrement, persistance, widget, connexions simulées) |
| `npm run test:resources:desktop` | **PASS** (5 fenêtres par abonnement, soldes négatifs « épuisé », deux thèmes) |
| `npm run test:claude:desktop` | **PASS** (mode direct, pannes, reprise, repli Desktop) |
| `npm run doctor` | **17 vérifications · 16 OK · 1 avertissement** : Claude Desktop trouvé mais relevé de plus de 45 min (ouvrir sa page Utilisation) ; Antigravity détecté (10 ports) ; Claude Code « jeton à renouveler » |

## 5. Limites et points de vigilance

1. **Ollama** : un compte pay-as-you-go dont la page n'exposerait ni section « Free usage » ni compteur resterait en erreur explicite (aucune estimation) ; les libellés localisés (« Paiement à l'usage ») ne sont pas reconnus.
2. **OrcaRouter** : la fenêtre « Ouvrir mon compte » se referme automatiquement après vérification si la session est déjà valide (comportement existant) ; les origines autorisées restent limitées à `www.orcarouter.ai`, `orcarouter.ai` et la connexion Google.
3. **OpenRouter** : la borne de découvert (`max(total, 1)`) est une heuristique documentée ; un découvert structurel supérieur serait signalé comme incohérent plutôt qu'estimé.
4. **Lecture directe Claude** : dépend toujours du renouvellement du jeton par Claude Code (429 de renouvellement typé `auth-rate-limit` ; repli Desktop annoncé, voir validation 0.3.1).
5. Les smokes utilisent des transports simulés et des dossiers isolés ; seules les vérifications des §1 à §3 touchent les services locaux réels (portail Ollama, service Antigravity, fichiers Claude Desktop) et les API OpenRouter/OrcaRouter avec la session déjà enregistrée. Aucune clé, aucun cookie et aucune identité ne sont publiés.
6. Validation locale et datée (une machine, un compte par fournisseur) ; elle ne garantit pas la compatibilité future des portails.

## 6. Fabrication et déploiement

- `npm run package:release` : dossier `dist/ProvidersBar-0.3.2-win32-x64/` créé, **sans `data/`**, avec `README.md`, `CHANGELOG.md`, `PRIVACY.md`, `SECURITY.md` embarqués.
- `npm run release:artifacts` : `dist/ProvidersBar-0.3.2-win32-x64.zip` (**151,2 Mo**), empreinte `dist/SHA256SUMS-0.3.2.txt` : `b528fa04499a016eb3aa68772934d7fdf67515079817a6b6dbfd26e18f4d2b5c`.
- `npm run update:portable` : le portable personnel `dist/ProvidersBar-win32-x64/` est passé en **0.3.2** en conservant ses données (`data/state.json` intact). L'ancienne application 0.3.0 encore ouverte doit être quittée puis relancée.

## 7. Conclusion

Ollama (page réelle : Free 100 %, crédits achetés 1,05 USD), OrcaRouter (vérification sans fenêtre, portefeuille 27,26 USD, session conservée) et OpenRouter (découvert −0,08 USD accepté, clé enregistrable) fonctionnent sur cette machine avec la version 0.3.2, sans régression sur les autres fournisseurs ni sur le rendu. Les limites ci-dessus sont documentées et n'empêchent pas la livraison.
