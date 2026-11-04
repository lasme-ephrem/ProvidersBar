'use strict';

// Contrôle de l'archive de release (scripts/verify-release-archive.cjs) sur des
// archives construites en JavaScript pur par tests/helpers/zip-writer.cjs :
// aucune dépendance à PowerShell, les tests tournent aussi hors Windows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeZip, buildZip, crc32 } = require('./helpers/zip-writer.cjs');
const { extractZip } = require('../lib/zip-extract.cjs');
const { verifyReleaseArchive, parseSums, archiveName, REQUIRED_FILES } = require('../scripts/verify-release-archive.cjs');

const VERSION = '9.8.7';

// Même forme que l'archive réelle produite par `tar -a -c -f ... -C dossier .` :
// entrée racine `./`, dossiers explicites, chemins préfixés par `./`.
function releaseEntries({ version = VERSION, extra = [], omit = [] } = {}) {
  const entries = [
    { name: './' },
    { name: './LasmiumTokensHub.exe', data: Buffer.from('fake-electron-binary\n') },
    { name: './resources/' },
    { name: './resources/app/' },
    { name: './resources/app/main.cjs', data: 'module.exports = "main";\n' },
    { name: './resources/app/preload.cjs', data: 'module.exports = "preload";\n' },
    { name: './resources/app/package.json', data: JSON.stringify({ name: 'lasmium-tokens-hub', version, main: 'main.cjs' }) },
    { name: './resources/app/PRIVACY.md', data: '# Confidentialité\n' },
    ...extra,
  ];
  return entries.filter(entry => !omit.includes(entry.name));
}

async function fixture(t, { version = VERSION, entries = releaseEntries(), sums, name } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-release-archive-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const zipPath = path.join(base, name || archiveName(version));
  const archive = await writeZip(zipPath, entries);
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const sumsPath = path.join(base, `SHA256SUMS-${version}.txt`);
  await fs.writeFile(sumsPath, sums === undefined ? `${digest}  ${archiveName(version)}\n` : sums, 'utf8');
  return { base, zipPath, sumsPath, digest };
}

async function leftovers(base) {
  return (await fs.readdir(base)).filter(entry => entry.startsWith('lasmium-release-verify-'));
}

// ---------------------------------------------------------------------------
// Helper ZIP
// ---------------------------------------------------------------------------

test('zip-writer : le CRC-32 correspond aux valeurs de référence', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(crc32(Buffer.from('a')), 0xE8B7BE43);
});

test('zip-writer : l’archive produite est lue par extractZip (dossiers, UTF-8, entrée racine)', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-zip-writer-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const zipPath = path.join(base, 'test.zip');
  const payload = Buffer.from([0, 1, 2, 255, 0, 42]);
  await writeZip(zipPath, [
    { name: './' },
    { name: 'docs/' },
    { name: 'docs/résumé.md', data: '# Résumé\n' },
    { name: 'app/main.cjs', data: 'ok' },
    { name: 'binaire.bin', data: payload },
  ]);
  const archive = await fs.readFile(zipPath);
  assert.deepEqual(archive.subarray(0, 4), Buffer.from([0x50, 0x4B, 0x03, 0x04]), 'signature d’en-tête local');
  assert.deepEqual(archive.subarray(-22, -18), Buffer.from([0x50, 0x4B, 0x05, 0x06]), 'signature EOCD');
  const dest = path.join(base, 'dest');
  const result = await extractZip(zipPath, dest);
  assert.equal(result.files, 3);
  assert.equal(result.bytes, Buffer.byteLength('# Résumé\n') + 2 + payload.length);
  assert.equal(await fs.readFile(path.join(dest, 'docs', 'résumé.md'), 'utf8'), '# Résumé\n');
  assert.equal(await fs.readFile(path.join(dest, 'app', 'main.cjs'), 'utf8'), 'ok');
  assert.deepEqual(await fs.readFile(path.join(dest, 'binaire.bin')), payload);
  assert.ok((await fs.stat(path.join(dest, 'docs'))).isDirectory());
});

test('zip-writer : un lien symbolique simulé par son mode est refusé par extractZip', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-zip-symlink-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const zipPath = path.join(base, 'symlink.zip');
  await writeZip(zipPath, [{ name: 'lien', data: '../cible', mode: 0o120777 }]);
  await assert.rejects(extractZip(zipPath, path.join(base, 'dest')), /Lien symbolique/);
  assert.throws(() => buildZip([{ name: 'dossier/', data: 'x' }]), /dossier ne porte pas de données/);
  assert.throws(() => buildZip([{ data: 'x' }]), /sans nom/);
});

// ---------------------------------------------------------------------------
// verifyReleaseArchive
// ---------------------------------------------------------------------------

test('une archive de release conforme est acceptée et le dossier temporaire est nettoyé', async t => {
  const { base, zipPath, sumsPath, digest } = await fixture(t);
  const report = await verifyReleaseArchive({ zipPath, sumsPath, version: VERSION, workDir: base });
  assert.equal(report.name, archiveName(VERSION));
  assert.equal(report.version, VERSION);
  assert.equal(report.sha256, digest);
  assert.equal(report.files, 5, 'exe, main, preload, package.json et PRIVACY.md');
  assert.ok(report.size > 0 && report.bytes > 0);
  assert.deepEqual(await leftovers(base), []);
  assert.deepEqual(REQUIRED_FILES, ['LasmiumTokensHub.exe', 'resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/package.json']);
});

test('un fichier indispensable manquant est signalé et le dossier temporaire nettoyé', async t => {
  const { base, zipPath, sumsPath } = await fixture(t, { entries: releaseEntries({ omit: ['./resources/app/preload.cjs'] }) });
  await assert.rejects(verifyReleaseArchive({ zipPath, sumsPath, version: VERSION, workDir: base }), /Fichiers manquants.*resources\/app\/preload\.cjs/);
  assert.deepEqual(await leftovers(base), []);
  const noExe = await fixture(t, { entries: releaseEntries({ omit: ['./LasmiumTokensHub.exe'] }) });
  await assert.rejects(verifyReleaseArchive({ zipPath: noExe.zipPath, sumsPath: noExe.sumsPath, version: VERSION }), /LasmiumTokensHub\.exe/);
});

test('une version différente dans resources/app/package.json est refusée', async t => {
  const { zipPath, sumsPath } = await fixture(t, { entries: releaseEntries({ version: '9.8.6' }) });
  await assert.rejects(verifyReleaseArchive({ zipPath, sumsPath, version: VERSION }), /annonce la version 9\.8\.6, attendu 9\.8\.7/);
  await assert.rejects(verifyReleaseArchive({ zipPath, sumsPath, version: 'v9.8.7' }), /Version invalide/);
});

test('un dossier data/ est refusé à toute profondeur', async t => {
  const root = await fixture(t, { entries: releaseEntries({ extra: [{ name: './data/' }, { name: './data/state.json', data: '{}' }] }) });
  await assert.rejects(verifyReleaseArchive({ zipPath: root.zipPath, sumsPath: root.sumsPath, version: VERSION }), /Données personnelles.*data\//);
  const nested = await fixture(t, { entries: releaseEntries({ extra: [{ name: './resources/app/data/credentials.json', data: '{}' }] }) });
  await assert.rejects(verifyReleaseArchive({ zipPath: nested.zipPath, sumsPath: nested.sumsPath, version: VERSION }), /resources\/app\/data\//);
  const file = await fixture(t, { entries: releaseEntries({ extra: [{ name: './credentials.json', data: '{}' }] }) });
  await assert.rejects(verifyReleaseArchive({ zipPath: file.zipPath, sumsPath: file.sumsPath, version: VERSION }), /credentials\.json/);
});

test('une empreinte SHA-256 différente ou absente est refusée', async t => {
  const wrong = await fixture(t, { sums: `${'a'.repeat(64)}  ${archiveName(VERSION)}\n` });
  await assert.rejects(verifyReleaseArchive({ zipPath: wrong.zipPath, sumsPath: wrong.sumsPath, version: VERSION }), /SHA-256 différent/);
  const other = await fixture(t, { sums: `${'b'.repeat(64)}  autre-archive.zip\n` });
  await assert.rejects(verifyReleaseArchive({ zipPath: other.zipPath, sumsPath: other.sumsPath, version: VERSION }), /Aucune empreinte SHA-256/);
  const missing = await fixture(t);
  await assert.rejects(verifyReleaseArchive({ zipPath: missing.zipPath, sumsPath: path.join(missing.base, 'absent.txt'), version: VERSION }), /empreintes introuvable/);
});

test('parseSums lit le format sha256sum, y compris le mode binaire', () => {
  const name = archiveName(VERSION);
  const digest = 'c'.repeat(64);
  assert.equal(parseSums(`${digest}  ${name}\n`, name), digest);
  assert.equal(parseSums(`${digest.toUpperCase()} *${name}\r\n`, name), digest);
  assert.equal(parseSums(`${digest}  ${name}.bak\n`, name), null);
  assert.equal(parseSums('', name), null);
  assert.equal(parseSums(`pas-une-empreinte  ${name}\n`, name), null);
});

test('un nom d’archive inattendu ou une archive absente sont signalés', async t => {
  const renamed = await fixture(t, { name: 'LasmiumTokensHub-win32-x64.zip' });
  await assert.rejects(verifyReleaseArchive({ zipPath: renamed.zipPath, sumsPath: renamed.sumsPath, version: VERSION }), /Nom d'archive inattendu/);
  const { base, sumsPath } = await fixture(t);
  await assert.rejects(verifyReleaseArchive({ zipPath: path.join(base, 'absent', archiveName(VERSION)), sumsPath, version: VERSION }), /Archive absente/);
  await assert.rejects(verifyReleaseArchive({ zipPath: '', sumsPath, version: VERSION }), /obligatoires/);
});
