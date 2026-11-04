'use strict';

// Contrôle d'intégrité de l'archive produite par `npm run release:artifacts`,
// avant publication : extraction dans un dossier temporaire avec la même
// fonction `extractZip` que l'application (lib/zip-extract.cjs), présence des
// fichiers indispensables, version annoncée par resources/app/package.json,
// absence de tout dossier `data/` et concordance du SHA-256 avec
// SHA256SUMS-<version>.txt. Utilisé par `npm run release:verify` et release.yml.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractZip } = require('../lib/zip-extract.cjs');

const ROOT = path.resolve(__dirname, '..');
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REQUIRED_FILES = ['LasmiumTokensHub.exe', 'resources/app/main.cjs', 'resources/app/preload.cjs', 'resources/app/package.json'];
// Un dossier `data` est refusé à toute profondeur (l'application refuse aussi
// une mise à jour qui en contient un) ; les autres noms sont ceux que
// scripts/release-artifacts.cjs interdit à la racine de la distribution.
const FORBIDDEN_DIRECTORIES = new Set(['data', '.local', 'test-results', 'account-browsers', 'temporary-account-browsers', 'Partitions']);
const FORBIDDEN_FILES = new Set(['credentials.json', 'state.json', 'DevToolsActivePort']);

function archiveName(version) {
  return `LasmiumTokensHub-${version}-win32-x64.zip`;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

// Format `sha256sum` : `<empreinte>  <nom>` (ou ` *<nom>` en mode binaire).
function parseSums(content, name) {
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(/^([A-Fa-f0-9]{64})\s+\*?(.+?)\s*$/);
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  return null;
}

async function findForbidden(root) {
  const findings = [];
  async function walk(directory, relative) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (FORBIDDEN_DIRECTORIES.has(entry.name)) findings.push(`${entryRelative}/`);
        else await walk(path.join(directory, entry.name), entryRelative);
      } else if (FORBIDDEN_FILES.has(entry.name)) {
        findings.push(entryRelative);
      }
    }
  }
  await walk(root, '');
  return findings;
}

async function isFile(file) {
  return fsp.stat(file).then(stat => stat.isFile()).catch(() => false);
}

async function verifyReleaseArchive({ zipPath, sumsPath, version, workDir = os.tmpdir() }) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) throw new Error(`Version invalide : ${String(version)}`);
  if (!zipPath || !sumsPath) throw new Error('zipPath et sumsPath sont obligatoires.');
  const name = archiveName(version);
  if (path.basename(zipPath) !== name) throw new Error(`Nom d'archive inattendu : ${path.basename(zipPath)} (attendu : ${name}).`);
  const stat = await fsp.stat(zipPath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size <= 0) throw new Error(`Archive absente ou vide : ${zipPath}`);

  const sums = await fsp.readFile(sumsPath, 'utf8').catch(() => null);
  if (sums === null) throw new Error(`Fichier d'empreintes introuvable : ${sumsPath}`);
  const expected = parseSums(sums, name);
  if (!expected) throw new Error(`Aucune empreinte SHA-256 pour ${name} dans ${path.basename(sumsPath)}.`);
  const sha256 = await hashFile(zipPath);
  if (sha256 !== expected) throw new Error(`SHA-256 différent : ${path.basename(sumsPath)} annonce ${expected}, l'archive donne ${sha256}.`);

  const directory = await fsp.mkdtemp(path.join(workDir, 'lasmium-release-verify-'));
  try {
    const { files, bytes } = await extractZip(zipPath, directory);
    const missing = [];
    for (const required of REQUIRED_FILES) if (!await isFile(path.join(directory, required))) missing.push(required);
    if (missing.length) throw new Error(`Fichiers manquants dans l'archive : ${missing.join(', ')}.`);
    let manifest;
    try { manifest = JSON.parse(await fsp.readFile(path.join(directory, 'resources', 'app', 'package.json'), 'utf8')); }
    catch (error) { throw new Error(`resources/app/package.json illisible : ${error.message}`); }
    if (manifest.version !== version) throw new Error(`resources/app/package.json annonce la version ${manifest.version}, attendu ${version}.`);
    const forbidden = await findForbidden(directory);
    if (forbidden.length) throw new Error(`Données personnelles dans l'archive : ${forbidden.join(', ')}.`);
    return { name, size: stat.size, sha256, files, bytes, version };
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function display(file) {
  const relative = path.relative(ROOT, file);
  return relative && !relative.startsWith('..') ? relative : file;
}

async function main() {
  const version = arg('--version', require('../package.json').version);
  const zipPath = path.resolve(arg('--zip', path.join(ROOT, 'dist', archiveName(version))));
  const sumsPath = path.resolve(arg('--sums', path.join(ROOT, 'dist', `SHA256SUMS-${version}.txt`)));
  console.log('Lasmium TOKENS-HUB — contrôle de l\'archive de release');
  const report = await verifyReleaseArchive({ zipPath, sumsPath, version });
  console.log(`Archive   : ${display(zipPath)} (${megabytes(report.size)})`);
  console.log(`SHA-256   : ${report.sha256} (conforme à ${display(sumsPath)})`);
  console.log(`Contenu   : ${report.files} fichier(s), ${megabytes(report.bytes)} extraits, version ${report.version}, aucun dossier data/`);
  console.log('[ok] Archive de release valide.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Contrôle de l'archive : ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { verifyReleaseArchive, parseSums, archiveName, REQUIRED_FILES };
