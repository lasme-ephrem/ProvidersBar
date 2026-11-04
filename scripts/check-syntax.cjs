#!/usr/bin/env node
// Vérification syntaxique du dépôt, sans dépendance ni exécution de code.
// Utilisé par `npm run verify` / `npm run lint` et par la CI Windows.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const TIMEOUT_MS = 30000;

// Les fichiers attendus sont explicites : un fichier racine supprimé par erreur
// doit être signalé, pas silencieusement ignoré.
const requiredRootFiles = ['main.cjs', 'preload.cjs'];
const groups = [
  { directory: 'lib', extensions: ['.cjs', '.js'] },
  { directory: 'scripts', extensions: ['.cjs'] },
  { directory: 'renderer', extensions: ['.js'] },
  { directory: 'tests', extensions: ['.cjs'] },
];

// Parcours récursif trié : les sous-dossiers (ex. tests/helpers/) contiennent
// aussi du code à vérifier. `node_modules` n'est jamais traversé.
function collect(directory, extensions, files) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collect(absolute, extensions, files);
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
}

function listFiles() {
  const files = [];
  const missing = [];
  for (const name of requiredRootFiles) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) missing.push(name);
    else files.push(file);
  }
  for (const { directory, extensions } of groups) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) {
      missing.push(`${directory}/`);
      continue;
    }
    collect(absolute, extensions, files);
  }
  return { files, missing };
}

function checkFile(file) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: TIMEOUT_MS });
  if (result.error) return `exécution impossible (${result.error.code || result.error.message})`;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(0, 6).join('\n    ');
    return detail || `code de sortie ${result.status}`;
  }
  return null;
}

function main() {
  const { files, missing } = listFiles();
  console.log('Lasmium TOKENS-HUB — vérification syntaxique (node --check)');
  console.log(`${process.version} · ${files.length} fichier(s) · ${path.relative(process.cwd(), root) || '.'}`);
  const failures = [];
  for (const file of files) {
    const error = checkFile(file);
    if (error) failures.push({ file, error });
  }
  if (missing.length) for (const name of missing) failures.push({ file: name, error: 'fichier ou dossier requis introuvable' });

  const relative = file => path.relative(root, file).split(path.sep).join('/');
  for (const failure of failures) {
    console.error(`[ERREUR] ${relative(failure.file)}`);
    for (const line of failure.error.split('\n')) console.error(`    ${line}`);
  }
  if (failures.length) {
    console.error(`Échec : ${failures.length} problème(s) de syntaxe ou de structure.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[ok] Syntaxe valide : ${files.length} fichier(s) vérifié(s).`);
}

if (require.main === module) main();
module.exports = { listFiles, checkFile, groups, requiredRootFiles };
