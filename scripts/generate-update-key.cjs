'use strict';

// Génère la paire de clés de mise à jour. La clé privée reste dans .local/,
// ignoré par Git ; seule la clé publique est versionnée pour que l'application
// puisse vérifier les manifestes.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const privatePath = process.argv.includes('--private')
  ? path.resolve(process.argv[process.argv.indexOf('--private') + 1])
  : path.join(ROOT, '.local', 'updater', 'private-key.pem');
const publicPath = process.argv.includes('--public')
  ? path.resolve(process.argv[process.argv.indexOf('--public') + 1])
  : path.join(ROOT, 'lib', 'updater-public.pem');

if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) {
  console.error('Une clé de mise à jour existe déjà. Refus d’écraser une clé existante.');
  process.exitCode = 1;
} else {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(privatePath), { recursive: true });
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
  console.log(`Clé privée : ${path.relative(ROOT, privatePath)} (non versionnée)`);
  console.log(`Clé publique : ${path.relative(ROOT, publicPath)}`);
  console.log('Conserve la clé privée hors du dépôt et sauvegarde-la : sans elle, tu ne peux plus signer de mise à jour.');
}
