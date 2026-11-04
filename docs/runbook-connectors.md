# Runbook connecteurs, packs et données

## 1. Triage d'une connexion en échec

1. Ouvrir **Connexions** : le panneau **Santé des connexions** indique l'état,
   la stratégie, l'âge du relevé et le bouton **Tester**.
2. Lire le code : `auth` → reconnecter ; `rate` → attendre la prochaine
   tentative ; `drift` → le dernier relevé sain est conservé, vérifier le
   parseur ; `down` → réseau/proxy ou service indisponible.
3. **Tester** force une tentative immédiate. L'actualisation automatique, elle,
   respecte le disjoncteur.
4. Si plusieurs fournisseurs sont en `down`, vérifier le proxy Windows et la
   connexion Internet avant de toucher au code.

## 2. Modifier un endpoint API sans reconstruire l'application

Les packs sont des JSON signés **Ed25519**. Le pack embarqué est le repli ; un
pack local signé, plus récent ou de même version, le remplace.

1. Copier un pack de `assets/connector-packs/` et modifier `endpoint`,
   `parserVersion`, `version` (semver) ou `minApp`.
2. Signer avec la clé privée locale :

   ```powershell
   npm run connectors:sign -- .\mon-pack.json
   ```

3. Placer le fichier signé dans
   `dist/ProvidersBar-win32-x64/data/connector-packs/` (ou dans le dossier de
   données `LASMIUM_DATA_DIR`), puis relancer l'application.
4. Vérifier dans **Connexions** la ligne « Packs signés actifs » et lancer
   `npm run connectors:canary` (hors réseau) ou avec `--live` et les variables
   `LASMIUM_CANARY_<PROVIDER>_KEY`.

Un pack non signé, une signature invalide, un endpoint HTTP, un `minApp` futur
ou un downgrade sont refusés et listés dans le diagnostic. En développement
uniquement, `LASMIUM_ALLOW_UNSIGNED_PACKS=1` autorise un pack non signé.

### Clé de signature

- Clé publique versionnée : `lib/connector-packs-public.pem`.
- Clé privée : `.local/connector-packs/private-key.pem`, **jamais versionnée**.
  La sauvegarder hors du dépôt : sans elle, aucun nouveau pack ne peut être
  signé.
- Régénérer une paire (nouveau départ, invalide les anciens packs) :
  `npm run connectors:key` après avoir retiré l'ancienne clé privée.
- Le fichier `*.pem` est ignoré par Git, sauf la clé publique explicitement
  autorisée.

## 3. Sauvegardes et restauration

- Avant chaque écriture, au plus toutes les 6 h, `state.json` est copié dans
  `data/backups/` (5 dernières). Un redémarrage crée aussi une sauvegarde.
- Lister : `npm run state:backup -- list`
- Créer : `npm run state:backup -- create`
- Restaurer (application **quittée**) :
  `npm run state:backup -- restore state-20261104-010000-000.json`
- La restauration valide le document et sauvegarde l'état courant avant de le
  remplacer. Aucune clé n'est dans `state.json` : les identifiants restent dans
  le fichier chiffré séparé.

## 4. Diagnostic

- Dans **Réglages → Tes données**, bouton **Diagnostic** : JSON sans clés, sans
  soldes, sans chemins absolus (versions, santé, packs, erreurs, sauvegardes).
- Hors application : `npm run diagnostic` (écrit dans le dossier de données).
- Le diagnostic ne remplace pas l'export de données : ce dernier contient
  l'inventaire et l'historique pour une réinstallation.

## 5. Ajouter ou réparer un fournisseur

1. Déclarer les métadonnées dans `lib/provider-catalog.cjs` / `lib/connectors.cjs`.
2. Ajouter la stratégie dans `STRATEGY_CHAINS`
   (`lib/connector-contract.cjs`) — ne jamais annoncer un repli non codé.
3. Brancher la lecture dans `main.cjs` (ou dans le module dédié), valider le
   relevé avec `assertSnapshot` avant `record`, et enregistrer la santé via
   `healthSuccess` / `healthFailure`.
4. Ajouter le cas au smoke et aux tests de parseur, puis vérifier
   `npm test`, `npm run test:desktop`.
5. Pour un endpoint API modifiable à chaud, ajouter le pack signé et le passer
   à `fetchUsage` via `endpoint`.

## 6. Release

`npm test` → `npm run verify` → les trois smokes → `npm run package` →
`npm run release:artifacts` → `npm run update:portable`. Documenter les
SHA-256 dans `docs/validation-<version>.md` et ne jamais réinitialiser les
données du dossier portable.
