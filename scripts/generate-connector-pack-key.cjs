'use strict';

// Génère la paire Ed25519 de signature des packs. La clé privée reste dans
// .local/connector-packs/ (ignorée par Git, ACL utilisateur) ; la clé publique
// est versionnée dans lib/connector-packs-public.pem. Sauvegarde la clé privée :
// sans elle, aucun nouveau pack ne peut être signé.

const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');

const root = path.join(__dirname, '..');
const privatePath = path.join(root, '.local', 'connector-packs', 'private-key.pem');
const publicPath = path.join(root, 'lib', 'connector-packs-public.pem');
if (fs.existsSync(privatePath)) {
  console.error(`Une clé privée existe déjà : ${privatePath}`);
  process.exitCode = 1;
} else {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(privatePath), { recursive: true });
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), 'utf8');
  console.log(`Clé privée : ${privatePath}`);
  console.log(`Clé publique : ${publicPath}`);
}
