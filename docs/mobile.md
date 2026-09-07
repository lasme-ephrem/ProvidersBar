# ProvidersBar sur iPhone

Le PC récupère les quotas ; l’iPhone consulte les mêmes relevés et peut demander leur actualisation. Les connexions aux fournisseurs restent gérées sur Windows.

## Première connexion

1. Installer [Tailscale pour Windows](https://tailscale.com/download/windows) sur le PC et [Tailscale pour iPhone](https://tailscale.com/download/ios) sur le téléphone. Connecter les deux appareils au même compte Tailscale.
2. Dans ProvidersBar sur le PC, ouvrir **Réglages → Accès mobile**, cocher **Activer le tableau de bord mobile**, puis enregistrer. Le serveur démarre uniquement sur `127.0.0.1:4318`.
3. Ouvrir PowerShell en administrateur et exécuter :

```powershell
& "$env:ProgramFiles\Tailscale\tailscale.exe" serve --bg --https=443 http://127.0.0.1:4318
```

4. Si Tailscale le demande, suivre son lien pour autoriser HTTPS. Copier l’adresse privée affichée, de la forme `https://mon-pc.mon-reseau.ts.net`.
5. Coller cette adresse dans le champ **Adresse privée Tailscale** de ProvidersBar et enregistrer. L’adresse est validée avant son utilisation.
6. Sur l’iPhone, garder Tailscale connecté et ouvrir cette adresse dans Safari. Saisir le **code d’accès personnel** affiché dans ProvidersBar sur le PC.
7. Dans Safari, **Partager → Sur l’écran d’accueil** pour ajouter ProvidersBar. iOS peut demander un nouvel appairage dans la vue installée.

Le service est privé au réseau Tailscale : ne pas utiliser `tailscale funnel`, ni ouvrir le port sur la box. Si un autre service utilise déjà Tailscale Serve sur le port HTTPS 443, conserver sa configuration et adapter le déploiement avant de poursuivre.

## Au quotidien

- Le PC reste allumé, connecté et sans mise en veille ; ProvidersBar reste actif près de l’horloge.
- Antigravity 2.0 doit rester ouvert pour ses quatre quotas.
- Le mobile relit l’état du PC toutes les 15 secondes tant que la page est visible. L’actualisation des fournisseurs reste celle de ProvidersBar, toutes les cinq minutes si activée.
- **Actualiser** demande une nouvelle lecture au PC, au maximum une fois par minute depuis le mobile.
- Les filtres Tous, Abonnements, API et Favoris ne modifient pas les comptes.
- Si le PC est injoignable, la dernière copie locale reste affichée avec un avertissement. Elle n’est pas présentée comme une lecture en direct.
- Le bouton en haut à droite oublie l’appareil et efface les relevés stockés dans ce navigateur.

## Protection des données

Le serveur mobile ne transmet ni clés API, ni cookies de fournisseurs, ni identité de compte, ni notes personnelles, ni historique complet. Il expose seulement les compteurs, noms des services, dates de relevé et états de connexion nécessaires au tableau de bord. Les messages techniques d’erreur sont remplacés par des messages génériques.

Un code aléatoire protège l’appairage. Il est chiffré avec Windows DPAPI dans `mobile-access.json`, à côté des données de l’application. Le téléphone reçoit un cookie HttpOnly, SameSite Strict et Secure sur l’adresse HTTPS. Le code ne figure pas dans l’URL.

**Renouveler le code et révoquer les accès** invalide les anciens cookies pour tous les téléphones. **Désactiver le tableau de bord mobile** arrête le serveur. Ces actions ne suppriment pas à distance une copie hors ligne déjà conservée sur un téléphone : utiliser aussi le bouton d’oubli sur cet appareil, ou effacer ses données Safari.

Le navigateur conserve les derniers relevés localement pour les afficher hors connexion. Le service worker conserve uniquement l’interface et les logos, jamais les réponses API. Ne pas associer un appareil partagé avec une personne qui ne doit pas voir ces relevés.

## Développement et tests

`lib/mobile-server.cjs` contient le serveur HTTP et la projection explicite des champs autorisés. `lib/mobile-access.cjs` gère le démarrage, la persistance et la révocation. `mobile/` contient l’interface installable et son cache hors ligne.

```powershell
npm test
npm run test:mobile
npm run test:desktop
```

Le test mobile utilise Microsoft Edge en mode sans fenêtre avec un viewport iPhone, des données simulées et un port éphémère. Il vérifie l’appairage, les quotas, les logos, les filtres, l’actualisation, la perte de connexion et le retour en ligne. Ce test ne remplace pas une validation sur Safari iOS et sur le réseau mobile réel.

Le mode **Tester sur ce PC** utilise HTTP local sans Tailscale ; il n’est pas accessible depuis l’iPhone. L’accès extérieur nécessite que l’appairage Tailscale et l’autorisation HTTPS aient été effectués.

Références : [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [commande Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).
