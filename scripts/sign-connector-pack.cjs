'use strict';

// Signe un pack de connecteurs avec la clé privée Ed25519 locale. La clé
// publique correspondante est livrée dans lib/connector-packs-public.pem.
// Usage : node scripts/sign-connector-pack.cjs <pack.json> [--key <pem>] [--out <json>]

const fs = require('node:fs/promises');
const path = require('node:path');
const { createPrivateKey, sign } = require('node:crypto');
const { canonicalPayload } = require('../lib/connector-packs.cjs');

async function main(argv = process.argv.slice(2)) {
  const input = argv.find(argument => !argument.startsWith('--'));
  if (!input) throw new Error('Indique le fichier de pack à signer.');
  const keyIndex = argv.indexOf('--key');
  const outIndex = argv.indexOf('--out');
  const keyPath = keyIndex >= 0 ? argv[keyIndex + 1] : path.join(__dirname, '..', '.local', 'connector-packs', 'private-key.pem');
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : input;
  if (!keyPath) throw new Error('Chemin de clé manquant.');
  const pack = JSON.parse(await fs.readFile(input, 'utf8'));
  delete pack.signature;
  const privateKey = createPrivateKey(await fs.readFile(keyPath, 'utf8'));
  const signature = sign(null, Buffer.from(canonicalPayload(pack), 'utf8'), privateKey).toString('base64');
  const signed = { ...pack, signature };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
  console.log(`Pack signé : ${outPath}`);
  return outPath;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
