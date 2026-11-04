'use strict';

// Génère un bundle de diagnostic hors application.
// Usage : node scripts/diagnostic-bundle.cjs [--out <fichier>] [--data <dossier>]

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDataStore } = require('../lib/data-store.cjs');
const { createBackupManager } = require('../lib/state-backups.cjs');
const { buildDiagnosticBundle } = require('../lib/diagnostic-bundle.cjs');
const { publicHealth } = require('../lib/connector-contract.cjs');
const { loadPacks, packSummary } = require('../lib/connector-packs.cjs');
const packageJson = require('../package.json');

const ROOT = path.join(__dirname, '..');

async function main(argv = process.argv.slice(2)) {
  const dataIndex = argv.indexOf('--data');
  const outIndex = argv.indexOf('--out');
  const dataDir = path.resolve(dataIndex >= 0 && argv[dataIndex + 1]
    ? argv[dataIndex + 1]
    : (process.env.LASMIUM_DATA_DIR || process.env.PROVIDERSBAR_DATA_DIR
      || path.join(ROOT, 'dist', 'ProvidersBar-win32-x64', 'data')));
  const out = outIndex >= 0 && argv[outIndex + 1]
    ? path.resolve(argv[outIndex + 1])
    : path.join(dataDir, 'diagnostic-lasmium.json');
  const store = createDataStore({ dataDir });
  const loaded = await store.load();
  const publicKey = await fs.readFile(path.join(ROOT, 'lib', 'connector-packs-public.pem'), 'utf8');
  const packs = await loadPacks({
    dirs: [path.join(ROOT, 'assets', 'connector-packs'), path.join(dataDir, 'connector-packs')],
    publicKey,
    appVersion: packageJson.version,
    providers: loaded.state.providers.map(provider => provider.id),
  });
  const backups = await createBackupManager({ dataDir }).list();
  const providers = loaded.state.providers.map(provider => ({
    ...provider,
    connected: Boolean(provider.accountSession),
    health: publicHealth(loaded.state.connectorHealth?.[provider.id], provider.snapshot),
  }));
  const bundle = buildDiagnosticBundle({
    app: { name: 'Lasmium TOKENS-HUB', version: packageJson.version, electron: null, packaged: null },
    state: { ...loaded.state, providers },
    packs: packSummary(packs.packs),
    packErrors: packs.errors,
    backups,
    versions: { node: process.version },
    platform: process.platform,
  });
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  console.log(`Diagnostic écrit : ${out}`);
  return out;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
