// Fabrique les artefacts de distribution d'une release déjà construite par
// `npm run package:release` : archive ZIP + empreinte SHA-256.
// Aucune donnée personnelle ne doit se trouver dans le dossier distribué.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const FORBIDDEN = new Set(['data', '.local', 'test-results', 'account-browsers', 'temporary-account-browsers', 'Partitions', 'credentials.json', 'state.json']);

async function main() {
  const force = process.argv.includes('--force');
  const pkg = require('../package.json');
  const name = `LasmiumTokensHub-${pkg.version}-win32-x64`;
  const distDir = path.join(root, 'dist', name);
  const zipPath = path.join(root, 'dist', `${name}.zip`);
  const sumPath = path.join(root, 'dist', `SHA256SUMS-${pkg.version}.txt`);

  for (const required of ['LasmiumTokensHub.exe', 'resources/app/main.cjs', 'resources/app/preload.cjs']) {
    try { await fs.access(path.join(distDir, required)); }
    catch { throw new Error(`Release incomplète : ${required} manque dans dist/${name}. Lance d'abord « npm run package:release ».`); }
  }
  const entries = await fs.readdir(distDir);
  const leaked = entries.filter(entry => FORBIDDEN.has(entry));
  if (leaked.length) throw new Error(`Données personnelles détectées dans dist/${name} : ${leaked.join(', ')}. La distribution est refusée.`);
  for (const doc of ['PRIVACY.md', 'SECURITY.md']) {
    try { await fs.access(path.join(distDir, 'resources', 'app', doc)); }
    catch { throw new Error(`${doc} n'est pas embarqué dans resources/app : relance « npm run package:release ».`); }
  }

  if (!force) {
    try { await fs.access(zipPath); throw new Error(`L'archive existe déjà : ${path.relative(root, zipPath)}. Utilise --force pour la remplacer.`); }
    catch (error) { if (!/existe déjà/.test(error.message) && error.code !== 'ENOENT') throw error; if (/existe déjà/.test(error.message)) throw error; }
  } else { await fs.rm(zipPath, { force: true }); }

  console.log(`Archive de ${name}…`);
  const result = spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', distDir, '.'], { stdio: 'inherit' });
  if (result.error) throw new Error(`Archive impossible (tar indisponible ?) : ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Archive impossible (tar a retourné ${result.status}).`);

  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    require('node:fs').createReadStream(zipPath).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject);
  });
  const digest = hash.digest('hex');
  await fs.writeFile(sumPath, `${digest}  ${name}.zip\n`, 'utf8');

  const size = (await fs.stat(zipPath)).size;
  console.log(`Archive   : ${path.relative(root, zipPath)} (${(size / 1024 / 1024).toFixed(1)} Mo)`);
  console.log(`SHA-256   : ${digest}`);
  console.log(`Empreintes: ${path.relative(root, sumPath)}`);
}

main().catch(error => { console.error(`Artefacts de release : ${error.message}`); process.exitCode = 1; });
