'use strict';

// Produit le manifeste signé distribué avec l'archive. Le hash et la taille
// sont calculés sur le ZIP réel : aucun champ n'est saisi à la main.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { signManifest, verifyManifest, MAX_ASSET_BYTES } = require('../lib/update-manifest.cjs');

const ROOT = path.resolve(__dirname, '..');
const packageJson = require('../package.json');
const REPOSITORY = 'https://github.com/lasme-ephrem/lasmium-tokens-bar';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const version = arg('--version', packageJson.version);
  const zip = path.resolve(arg('--zip', path.join(ROOT, 'dist', `LasmiumTokensHub-${version}-win32-x64.zip`)));
  const out = path.resolve(arg('--out', path.join(ROOT, 'dist', 'latest.json')));
  const keyPath = path.resolve(arg('--key', path.join(ROOT, '.local', 'updater', 'private-key.pem')));
  const publicPath = path.join(ROOT, 'lib', 'updater-public.pem');
  const name = path.basename(zip);
  const url = arg('--url', `${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(name)}`);
  // `--notes-file` (release.yml, notes multilignes extraites du CHANGELOG) prime
  // sur `--notes` : un argument de ligne de commande ne transporte pas de
  // retour à la ligne de façon fiable sous Windows.
  const notesFile = arg('--notes-file', '');
  const notes = notesFile ? (await fsp.readFile(path.resolve(notesFile), 'utf8')).trim() : arg('--notes', '');
  const minApp = arg('--min-app', '0.5.0');
  const publishedAt = arg('--published-at', new Date().toISOString());
  if (version !== packageJson.version) throw new Error(`La version ${version} ne correspond pas à package.json (${packageJson.version}).`);
  if (!/^LasmiumTokensHub-\d+\.\d+\.\d+-win32-x64\.zip$/.test(name)) throw new Error(`Nom d’archive inattendu : ${name}`);
  const stat = await fsp.stat(zip);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ASSET_BYTES) throw new Error('Archive absente ou taille invalide.');
  const sha256 = crypto.createHash('sha256').update(await fsp.readFile(zip)).digest('hex');
  const manifest = {
    schemaVersion: 1,
    version,
    minApp,
    publishedAt,
    notes,
    asset: { name, url, sha256, size: stat.size },
  };
  const privateKey = fs.readFileSync(keyPath, 'utf8');
  manifest.signature = signManifest(manifest, privateKey);
  const verification = verifyManifest(manifest, fs.readFileSync(publicPath, 'utf8'), { appVersion: packageJson.version });
  if (!verification.valid) throw new Error(`Manifeste invalide : ${verification.issues.join(' ; ')}`);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  console.log(`Manifeste : ${path.relative(ROOT, out)}`);
  console.log(`Version   : ${version}`);
  console.log(`Archive   : ${name} (${stat.size} octets)`);
  console.log(`SHA-256   : ${sha256}`);
  console.log(`URL       : ${url}`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, REPOSITORY };
