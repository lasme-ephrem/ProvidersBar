# Sécurité — ProvidersBar

ProvidersBar est une application de bureau **Windows x64** (Electron 44) qui
affiche des quotas et des soldes de services d'IA. Ce document décrit le
périmètre de sécurité, les surfaces exposées, les pratiques du projet et la
manière de signaler une vulnérabilité.

## 1. Versions prises en charge

| Version | Support sécurité |
| --- | --- |
| 0.3.x (branche `refonte/pro`) | oui, dernière version publiée |
| 0.2.x et antérieures | non — mettre à jour vers la dernière version |

Les correctifs de sécurité sont livrés dans la dernière version ; il n'existe
pas de branche de maintenance séparée.

## 2. Périmètre

Couvert :

- le processus principal Electron (`main.cjs`), le pont `preload.cjs` et les
  fenêtres du tableau de bord et du widget ;
- les bibliothèques `lib/` : stockage local, chiffrement des clés, export
  nettoyé, durcissement des fenêtres, connecteurs, lecteurs de sessions ;
- les profils de navigateur et partitions de session gérés par l'application ;
- la chaîne de fabrication et de livraison du portable (`scripts/`, CI Windows).

Non couvert : voir [Hors périmètre](#6-hors-périmètre).

## 3. Modèle de menace résumé

L'application est conçue pour un poste Windows personnel, mono-utilisateur, avec
un utilisateur légitime qui contrôle sa session et son dossier de données.

**Protégé par construction**

- les clés API sont chiffrées au repos par Electron `safeStorage` / Windows
  DPAPI, liées au compte Windows ; l'application refuse d'enregistrer une clé si
  le chiffrement est indisponible ;
- le dossier de données est restreint par ACL (`icacls /inheritance:r`) à
  l'utilisateur courant et à `SYSTEM` ; un échec produit un avertissement, jamais
  un blocage ;
- le contenu distant des pages de connexion n'a ni Node.js, ni isolation de
  contexte désactivée, ni accès au pont IPC : l'IPC filtre la frame émettrice et
  l'URL exacte de l'interface ;
- les fenêtres de connexion limitent navigation, redirections et popups à une
  allowlist d'origines HTTPS (`ollama.com`, `orcarouter.ai`/`www`,
  `accounts.google.com`) ; les fenêtres de l'interface refusent navigation,
  popups et permissions ;
- les lecteurs de comptes utilisent un pipe CDP local (`--remote-debugging-pipe`)
  et n'ouvrent **aucun port TCP de débogage** ;
- l'export de données est nettoyé : aucune session, identité pseudonyme,
  empreinte de clé ou jeton ;
- aucune télémétrie et aucun serveur ProvidersBar : seules les lectures vers les
  services configurés par l'utilisateur sortent du poste.

**Non protégé**

- un compte Windows compromis, un malware s'exécutant **sous le même compte**,
  un accès physique à une session déverrouillée : ces acteurs peuvent lire les
  fichiers de l'utilisateur et les secrets que DPAPI peut déchiffrer ;
- un navigateur personnel compromis, des extensions malveillantes ou un profil
  Chrome/Edge déjà infecté (l'application ne garantit pas la sécurité de
  l'environnement navigateur) ;
- la compromission d'un fournisseur, de ses API, de son certificat TLS ou de la
  connexion réseau (proxy d'entreprise, antivirus TLS) ;
- les composants tiers : Claude Code, Claude Desktop, Codex/Antigravity, dont les
  fichiers et sessions restent gérés par leurs éditeurs.

## 4. Surfaces sensibles et mesures associées

| Surface | Risque | Mesure |
| --- | --- | --- |
| `credentials.json` | fuite de clés API | chiffrement DPAPI, fichier séparé de l'état, jamais exporté ni renvoyé au renderer, ACL du dossier de données |
| `state.json` / historique | lecture d'habitudes d'usage | ACL du dossier, pas de secret, purge des sauvegardes et plafond de 20 000 relevés |
| Fenêtres de connexion | injection de contenu distant, hameçonnage | `sandbox`, `contextIsolation`, pas de `nodeIntegration`, `devTools:false`, allowlist d'origines, popups limités, permissions refusées |
| Renderer de l'interface | XSS par donnée de fournisseur | CSP sans `unsafe-eval` ni script inline, échappement HTML centralisé, échappement des libellés distants, `connect-src 'self'` |
| IPC (`preload.cjs` → `main.cjs`) | appel d'actions privilégiées | surface explicite de 25 méthodes, canaux littéraux, filtre frame principale + URL exacte, validation des charges utiles dans `lib/domain.cjs` et `lib/usage-strategy.js` |
| Sessions navigateur | vol de cookies | profils/partitions isolés par fournisseur, pipe local, pas de port TCP, `clearStorageData` à la déconnexion et à l'effacement |
| Jetons Claude Code | copie ou journalisation | lus en mémoire seulement, jamais persistés par ProvidersBar, erreurs expurgées, verrous et écriture atomique du fichier officiel |
| Réseau sortant | exfiltration, mauvaise destination | liste fermée d'endpoints officiels, `redirect: 'error'`, validation stricte des réponses, aucune télémétrie |
| Export / effacement | fuite ou suppression incomplète | export nettoyé et documenté, double confirmation, refus pendant synchronisation, purge des caches et profils |
| Dossier portable | altération locale du code | ACL du dossier de données, procédure de mise à jour qui remplace les ressources ensemble ; l'exécutable n'est pas encore signé (voir §5) |

## 5. Pratiques du projet

- **Dépendances verrouillées** : `package-lock.json` versionné, installation par
  `npm ci` en CI ; une seule dépendance de production (`proper-lockfile`).
  Electron est une dépendance de développement mais fournit le runtime du
  portable : sa version est vérifiée par les tests.
- **Audit** : `npm audit --omit=dev` en CI sur les dépendances de production ;
  `npm audit` complet est attendu avant chaque release, car le runtime Electron
  livré ne fait pas partie de l'audit de production.
- **CI Windows** : jobs déterministes (syntaxe, tests unitaires, audit) et job
  Electron best-effort nécessitant une session graphique interactive.
- **Tests de sécurité** : `tests/security.test.cjs`, `tests/window-security.test.cjs`,
  `tests/privacy-export.test.cjs` et `tests/quality.test.cjs` couvrent
  l'absence de port de débogage, l'allowlist, la CSP, l'export nettoyé, l'ACL,
  la purge conditionnelle, l'absence de télémétrie et l'absence de secrets.
- **Revue** : les changements touchant `main.cjs`, `preload.cjs`, `lib/`, le
  renderer, la fabrication ou les dépendances sont relus avant fusion (voir
  `REFONTE-CONTRATS.md` et `analysis/06-revue-securite-finale.md`).
- **Hygiène du dépôt** : `.gitignore` exclut données, sessions, clés, `.env` et
  résultats de tests ; un test vérifie l'absence de secrets et de chemins
  personnels dans le code livré.
- **Transparence** : [`PRIVACY.md`](PRIVACY.md) décrit les données et leur
  effacement ; `docs/architecture.md` décrit les flux ; `analysis/` contient les
  revues de sécurité.

## 6. Hors périmètre

- La sécurité des services tiers (fournisseurs d'IA, Google, Ollama, OrcaRouter,
  Anthropic, OpenAI), de leurs API et de leurs certificats.
- La sécurité de Chrome, Edge, de leurs extensions et du profil personnel de
  l'utilisateur.
- Claude Code, Claude Desktop, Codex et Antigravity, y compris leurs fichiers de
  jetons et leurs mises à jour.
- Windows, les antivirus, proxys TLS d'entreprise, pilotes et périphériques.
- Un attaquant qui exécute du code avec les privilèges de l'utilisateur, obtient
  un accès physique déverrouillé ou qui obtient une copie du dossier de données
  ou de l'export.
- Les dénis de service locaux, l'ingénierie sociale et les contenus affichés par
  les fournisseurs.
- La signature Authenticode et l'intégrité du binaire portable : **le
  `ProvidersBar.exe` n'est pas signé** à ce jour ; vérifier la source de
  téléchargement (dépôt officiel, dossier de release) avant exécution.

## 7. Signalement d'une vulnérabilité

Merci de signaler toute vulnérabilité **en privé** :

1. utiliser l'onglet **Security → Report a vulnerability** (Security Advisories)
   du dépôt GitHub officiel : `https://github.com/lasme-ephrem/ProvidersBar` ;
2. à défaut d'accès à cet outil, contacter le mainteneur du dépôt par un canal
   privé déjà établi ;
3. ne **pas** ouvrir d'issue publique contenant des détails exploitables, des
   données personnelles ou des secrets.

Merci d'inclure : version de ProvidersBar (`app:info`), version de Windows,
description du problème, étapes de reproduction avec données fictives, impact
estimé et, si possible, preuve de concept minimale. N'incluez **jamais** de
clés API, jetons, cookies ou copies du dossier `data/`.

Le traitement se fait au mieux, sans engagement de délai contractuel : accusé de
réception, évaluation, correctif dans la dernière version si la vulnérabilité est
confirmée. Aucun programme de prime (bug bounty) n'est proposé. Les signalements
légitimes et les bonnes pratiques de divulgation responsable sont appréciés ;
les tests destructifs contre des services tiers ne sont pas autorisés.

## 8. Durcissement opérationnel recommandé

- Ne jamais partager, synchroniser, archiver sur un service distant ou joindre le
  dossier `data/`, `account-browsers/` ou un export JSON à un ticket.
- Activer le chiffrement du disque (BitLocker) et utiliser un compte Windows
  personnel protégé.
- Installer le portable dans un dossier lisible seulement par l'utilisateur ;
  éviter un partage réseau ou une clé USB non chiffrée.
- Vérifier la provenance du dossier de release (dépôt officiel) ; aucun binaire
  n'est signé actuellement.
- En cas de doute : **Réglages → Effacer mes données**, quitter l'application,
  supprimer le dossier de données résiduel, puis révoquer les clés API et les
  connexions de comptes auprès des fournisseurs.
- Pour le diagnostic réel, le mode `--remote-debugging-port` est un mode
  développeur explicite : ne pas laisser l'application lancée avec cette option
  et la relancer normalement après usage (la purge de démarrage retire le
  fichier de port obsolète hors mode diagnostic).

## 9. historique

- 2026-11 (version 0.3.0) : suppression de tout port CDP TCP pour les lecteurs de
  comptes (`--remote-debugging-pipe`), allowlist d'origines pour les fenêtres de
  connexion, ACL du dossier de données, export nettoyé, effacement des données,
  `devTools:false`, CSP et échappement durcis, Electron 44.10.2 (audit des
  dépendances sans vulnérabilité connue). Détail et résiduels :
  [`analysis/06-revue-securite-finale.md`](analysis/06-revue-securite-finale.md).
