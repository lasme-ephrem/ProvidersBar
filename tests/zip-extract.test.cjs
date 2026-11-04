'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { extractZip, safeEntryPath } = require('../lib/zip-extract.cjs');

test('les chemins ZIP dangereux sont refusés avant écriture', () => {
  const root = path.join(os.tmpdir(), 'lasmium-zip-root');
  assert.throws(() => safeEntryPath(root, '../evil.txt'), /hors du dossier/);
  assert.throws(() => safeEntryPath(root, 'C:\\evil.txt'), /hors du dossier/);
  assert.throws(() => safeEntryPath(root, '/etc/passwd'), /hors du dossier/);
  assert.throws(() => safeEntryPath(root, 'a/../../evil.txt'), /hors du dossier/);
  assert.equal(safeEntryPath(root, 'app/resources/main.cjs'), path.join(root, 'app', 'resources', 'main.cjs'));
});

test('une archive normale est extraite avec ses sous-dossiers', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lasmium-zip-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(source, 'resources', 'app', 'main.cjs'), "require('node:path');\n");
  const zip = path.join(root, 'update.zip');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath '${source}' -DestinationPath '${zip}' -Force`]);
  const dest = path.join(root, 'dest');
  return extractZip(zip, dest).then(result => {
    assert.equal(result.files, 1);
    assert.equal(fs.readFileSync(path.join(dest, 'source', 'resources', 'app', 'main.cjs'), 'utf8'), "require('node:path');\n");
  });
});
