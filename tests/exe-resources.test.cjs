'use strict';
// L'exécutable livré porte l'icône et le nom de Lasmium TOKENS-HUB, pas ceux
// d'Electron (Explorateur, barre des tâches, Gestionnaire des tâches).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { brandExecutable, readExecutableInfo, versionParts, PRODUCT_NAME } = require('../scripts/exe-resources.cjs');

const root = path.resolve(__dirname, '..');

test('versionParts refuse une version non numérique', () => {
  assert.deepEqual(versionParts('0.6.11'), [0, 6, 11]);
  for (const bad of ['0.6', '1.2.x', '1.2.3.4', '70000.0.0']) assert.throws(() => versionParts(bad), /Version invalide/);
});

test('brandExecutable remplace l’icône et le nom d’Electron dans l’exécutable', { skip: process.platform !== 'win32' && 'exécutable Windows requis' }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-exe-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'LasmiumTokensHub.exe');
  await fs.copyFile(path.join(path.dirname(require('electron')), 'electron.exe'), exe);
  const before = await readExecutableInfo(exe);
  assert.match(before.strings.ProductName, /Electron/);
  await brandExecutable(exe, { iconPath: path.join(root, 'assets', 'icon.ico'), version: '0.6.11', year: 2026 });
  const after = await readExecutableInfo(exe);
  assert.equal(after.strings.ProductName, PRODUCT_NAME);
  assert.equal(after.strings.FileDescription, PRODUCT_NAME);
  assert.equal(after.strings.CompanyName, 'Lasmium');
  assert.equal(after.strings.OriginalFilename, 'LasmiumTokensHub.exe');
  assert.equal(after.strings.FileVersion, '0.6.11');
  assert.equal(after.strings.LegalCopyright, '© 2026 Lasmium');
  assert.deepEqual(after.iconSizes, [16, 32, 48, 64, 128, 256], 'les six tailles de assets/icon.ico');
});
