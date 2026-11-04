'use strict';

// Gestion hors application des sauvegardes d'état.
// Usage :
//   node scripts/state-backup.cjs list
//   node scripts/state-backup.cjs create [--data <dossier>]
//   node scripts/state-backup.cjs restore <state-...json> [--data <dossier>]
// L'application doit être quittée avant une restauration.

const path = require('node:path');
const { createBackupManager } = require('../lib/state-backups.cjs');

function dataDirFrom(argv) {
  const index = argv.indexOf('--data');
  if (index >= 0 && argv[index + 1]) return path.resolve(argv[index + 1]);
  return path.resolve(process.env.LASMIUM_DATA_DIR || process.env.PROVIDERSBAR_DATA_DIR
    || path.join(__dirname, '..', 'dist', 'ProvidersBar-win32-x64', 'data'));
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'list';
  const dataDir = dataDirFrom(argv);
  const manager = createBackupManager({ dataDir });
  if (command === 'list') {
    const names = await manager.list();
    console.log(names.length ? names.join('\n') : 'Aucune sauvegarde.');
    return 0;
  }
  if (command === 'create') {
    const name = await manager.maybeBackup({ force: true, reason: 'cli' });
    console.log(name ? `Sauvegarde créée : ${name}` : 'Aucun état à sauvegarder.');
    return 0;
  }
  if (command === 'restore') {
    const name = argv[1];
    if (!name) throw new Error('Indique le nom de la sauvegarde à restaurer.');
    await manager.restore(name);
    console.log(`État restauré depuis ${name}. Relance Lasmium TOKENS-HUB.`);
    return 0;
  }
  throw new Error(`Commande inconnue : ${command}`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, dataDirFrom };
