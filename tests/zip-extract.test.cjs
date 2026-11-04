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

test('une entrée racine ./ produite par tar est ignorée sans bloquer l’extraction', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lasmium-zip-root-entry-'));
  const zip = path.join(root, 'update.zip');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${zip}','Create'); $z.CreateEntry('./') | Out-Null; $e=$z.CreateEntry('app/main.cjs'); $w=New-Object System.IO.StreamWriter($e.Open()); $w.Write('ok'); $w.Dispose(); $z.Dispose()`]);
  const dest = path.join(root, 'dest');
  return extractZip(zip, dest).then(result => {
    assert.equal(result.files, 1);
    assert.equal(fs.readFileSync(path.join(dest, 'app', 'main.cjs'), 'utf8'), 'ok');
  });
});

test('un fichier .asar est extrait sous son nom définitif', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lasmium-zip-asar-'));
  const zip = path.join(root, 'update.zip');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::Open('${zip}','Create'); $e=$z.CreateEntry('resources/default_app.asar'); $w=New-Object System.IO.StreamWriter($e.Open()); $w.Write('asar-content'); $w.Dispose(); $z.Dispose()`]);
  const dest = path.join(root, 'dest');
  return extractZip(zip, dest).then(result => {
    assert.equal(result.files, 1);
    assert.equal(fs.readFileSync(path.join(dest, 'resources', 'default_app.asar'), 'utf8'), 'asar-content');
  });
});
