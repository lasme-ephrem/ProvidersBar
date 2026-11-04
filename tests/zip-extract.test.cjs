'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractZip, safeEntryPath, MAX_FILES, MAX_BYTES } = require('../lib/zip-extract.cjs');
const { writeZip } = require('./helpers/zip-writer.cjs');

// Les archives sont fabriquées en JavaScript pur (tests/helpers/zip-writer.cjs)
// pour que ces tests tournent sur toute plate-forme, pas seulement là où
// `powershell.exe` existe.

function workspace(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // Sous Windows, un descripteur peut se refermer juste après le test : on réessaie.
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}

// Fabrique l'archive dans un dossier de travail nettoyé en fin de test et
// renvoie son chemin ainsi que la destination d'extraction (non créée).
async function archive(t, prefix, entries) {
  const root = workspace(t, prefix);
  const zip = path.join(root, 'update.zip');
  await writeZip(zip, entries);
  return { root, zip, dest: path.join(root, 'dest') };
}

// Liste récursive des fichiers écrits (chemins relatifs POSIX, triés par
// points de code, indépendamment de la locale), pour vérifier précisément ce
// qui a été extrait — ou ce qui ne l'a pas été.
function writtenFiles(directory, prefix = '') {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...writtenFiles(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

test('les chemins ZIP dangereux sont refusés avant écriture', () => {
  const root = path.join(os.tmpdir(), 'lasmium-zip-root');
  assert.throws(() => safeEntryPath(root, '../evil.txt'), /hors du dossier/);
  assert.throws(() => safeEntryPath(root, 'C:\\evil.txt'), /hors du dossier/);
  assert.throws(() => safeEntryPath(root, '/etc/passwd'), /hors du dossier/);
  assert.throws(() => safeEntryPath(root, 'a/../../evil.txt'), /hors du dossier/);
  assert.throws(() => safeEntryPath(root, ''), /invalide/);
  assert.throws(() => safeEntryPath(root, 'app/\0main.cjs'), /invalide/);
  assert.equal(safeEntryPath(root, 'app/resources/main.cjs'), path.join(root, 'app', 'resources', 'main.cjs'));
  assert.equal(safeEntryPath(root, 'app\\resources\\main.cjs'), path.join(root, 'app', 'resources', 'main.cjs'));
});

test('une archive normale est extraite avec ses sous-dossiers', async t => {
  const main = "require('node:path');\n";
  const { zip, dest } = await archive(t, 'lasmium-zip-', [
    { name: 'source/' },
    { name: 'source/resources/' },
    { name: 'source/resources/app/' },
    { name: 'source/resources/app/main.cjs', data: main },
    { name: 'source/README.txt', data: 'lisez-moi' },
    // Fichier sans entrée de dossier parente : les dossiers intermédiaires
    // doivent être créés à la volée.
    { name: 'source/deep/nested/file.bin', data: Buffer.from([0, 1, 2, 3]) },
  ]);
  const result = await extractZip(zip, dest);
  assert.deepEqual(result, { files: 3, bytes: Buffer.byteLength(main) + Buffer.byteLength('lisez-moi') + 4 });
  assert.equal(fs.readFileSync(path.join(dest, 'source', 'resources', 'app', 'main.cjs'), 'utf8'), main);
  assert.deepEqual(fs.readFileSync(path.join(dest, 'source', 'deep', 'nested', 'file.bin')), Buffer.from([0, 1, 2, 3]));
  assert.deepEqual(writtenFiles(dest), ['source/README.txt', 'source/deep/nested/file.bin', 'source/resources/app/main.cjs']);
});

test('une entrée racine ./ produite par tar est ignorée sans bloquer l’extraction', async t => {
  const { zip, dest } = await archive(t, 'lasmium-zip-root-entry-', [
    { name: './' },
    { name: 'app/main.cjs', data: 'ok' },
  ]);
  const result = await extractZip(zip, dest);
  assert.equal(result.files, 1);
  assert.equal(fs.readFileSync(path.join(dest, 'app', 'main.cjs'), 'utf8'), 'ok');
  assert.deepEqual(writtenFiles(dest), ['app/main.cjs']);
});

test('un fichier .asar est extrait sous son nom définitif', async t => {
  const { zip, dest } = await archive(t, 'lasmium-zip-asar-', [
    { name: 'resources/default_app.asar', data: 'asar-content' },
    { name: 'resources/app.ASAR', data: 'majuscules' },
  ]);
  const result = await extractZip(zip, dest);
  assert.equal(result.files, 2);
  assert.equal(fs.readFileSync(path.join(dest, 'resources', 'default_app.asar'), 'utf8'), 'asar-content');
  assert.equal(fs.readFileSync(path.join(dest, 'resources', 'app.ASAR'), 'utf8'), 'majuscules');
  // Le fichier temporaire `.lasmium-download-*` ne doit pas subsister.
  assert.deepEqual(fs.readdirSync(path.join(dest, 'resources')).sort(), ['app.ASAR', 'default_app.asar']);
});

test('un lien symbolique est refusé avant toute écriture', async t => {
  const { zip, dest } = await archive(t, 'lasmium-zip-symlink-', [
    { name: 'app/lien', data: '../../etc/passwd', mode: 0o120777 },
    { name: 'app/main.cjs', data: 'ok' },
  ]);
  await assert.rejects(extractZip(zip, dest), /Lien symbolique refusé/);
  assert.deepEqual(writtenFiles(dest), []);
});

test('une entrée dupliquée est refusée sans écraser la première', async t => {
  const { zip, dest } = await archive(t, 'lasmium-zip-duplicate-', [
    { name: 'app/main.cjs', data: 'première' },
    // Même cible après normalisation du chemin.
    { name: 'app/./main.cjs', data: 'seconde' },
  ]);
  await assert.rejects(extractZip(zip, dest), /dupliquée/);
  assert.equal(fs.readFileSync(path.join(dest, 'app', 'main.cjs'), 'utf8'), 'première');
  assert.deepEqual(writtenFiles(dest), ['app/main.cjs']);
});

test('les plafonds maxFiles et maxBytes sont appliqués avant l’écriture de l’entrée fautive', async t => {
  assert.equal(MAX_FILES, 5000);
  assert.equal(MAX_BYTES, 600 * 1024 * 1024);
  const entries = [
    { name: 'app/' },
    { name: 'app/a.txt', data: '123456' },
    { name: 'app/b.txt', data: '123456' },
    { name: 'app/c.txt', data: '123456' },
  ];
  {
    const { zip, dest } = await archive(t, 'lasmium-zip-max-files-', entries);
    await assert.rejects(extractZip(zip, dest, { maxFiles: 2 }), /Trop de fichiers/);
    // Les entrées de dossier ne comptent pas ; le troisième fichier est refusé.
    assert.deepEqual(writtenFiles(dest), ['app/a.txt', 'app/b.txt']);
  }
  {
    const { zip, dest } = await archive(t, 'lasmium-zip-max-bytes-', entries);
    await assert.rejects(extractZip(zip, dest, { maxBytes: 10 }), /trop volumineuse/);
    // 6 octets passent, 12 dépassent : b.txt n'est jamais écrit.
    assert.deepEqual(writtenFiles(dest), ['app/a.txt']);
  }
  {
    const { zip, dest } = await archive(t, 'lasmium-zip-max-single-', entries);
    await assert.rejects(extractZip(zip, dest, { maxBytes: 5 }), /trop volumineuse/);
    assert.deepEqual(writtenFiles(dest), []);
  }
  {
    const { zip, dest } = await archive(t, 'lasmium-zip-max-default-', entries);
    assert.deepEqual(await extractZip(zip, dest), { files: 3, bytes: 18 });
  }
});

test('un chemin .. ou absolu dans une entrée réelle est refusé avant toute écriture', async t => {
  // yauzl (decodeStrings) rejette déjà ces noms ; safeEntryPath reste une
  // seconde ligne de défense. Dans les deux cas, rien ne doit être écrit.
  for (const name of ['../evil.txt', 'app/../../evil.txt', '/etc/evil.txt', 'C:/evil.txt']) {
    const { root, zip, dest } = await archive(t, 'lasmium-zip-traversal-', [
      { name, data: 'x' },
      { name: 'app/main.cjs', data: 'ok' },
    ]);
    await assert.rejects(extractZip(zip, dest), /hors du dossier|invalid relative path|absolute path/);
    assert.deepEqual(writtenFiles(dest), [], name);
    assert.equal(fs.existsSync(path.join(root, 'evil.txt')), false, name);
  }
});

test('une entrée de dossier est créée sans fichier', async t => {
  const { zip, dest } = await archive(t, 'lasmium-zip-directory-', [
    { name: 'app/' },
    { name: 'app/empty/' },
  ]);
  assert.deepEqual(await extractZip(zip, dest), { files: 0, bytes: 0 });
  assert.ok(fs.statSync(path.join(dest, 'app', 'empty')).isDirectory());
  assert.deepEqual(writtenFiles(dest), []);
});

test('un fichier déjà présent n’est jamais écrasé et une archive illisible est refusée', async t => {
  const { zip, dest } = await archive(t, 'lasmium-zip-exists-', [{ name: 'app/main.cjs', data: 'nouveau' }]);
  fs.mkdirSync(path.join(dest, 'app'), { recursive: true });
  fs.writeFileSync(path.join(dest, 'app', 'main.cjs'), 'ancien');
  await assert.rejects(extractZip(zip, dest), error => error.code === 'EEXIST');
  assert.equal(fs.readFileSync(path.join(dest, 'app', 'main.cjs'), 'utf8'), 'ancien');
  const broken = path.join(dest, 'broken.zip');
  fs.writeFileSync(broken, 'ceci n’est pas une archive');
  await assert.rejects(extractZip(broken, path.join(dest, 'other')), /central directory/i);
  assert.deepEqual(writtenFiles(path.join(dest, 'other')), []);
});
