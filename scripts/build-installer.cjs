'use strict';

// Construit l'installeur Windows (Inno Setup 6) à partir de la distribution
// versionnée (`npm run package:release`) et ajoute son empreinte SHA-256 au
// fichier SHA256SUMS de la version. Usage : npm run package:installer.

const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function isccCandidates(env = process.env) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'ISCC.exe'));
  return [
    env.ISCC,
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    ...dirs,
  ].filter(Boolean);
}

function findIscc(env = process.env, exists = fss.existsSync) {
  const found = isccCandidates(env).find(candidate => exists(candidate));
  if (!found) throw new Error('Inno Setup 6 introuvable (ISCC.exe). Installe-le (winget install JRSoftware.InnoSetup) ou indique son chemin dans ISCC.');
  return found;
}

function upsertSum(content, digest, name) {
  const lines = String(content || '').split(/\r?\n/).filter(line => line.trim() && !line.trim().endsWith(` ${name}`) && !line.trim().endsWith(`*${name}`));
  return `${[...lines, `${digest}  ${name}`].join('\n')}\n`;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('L’installeur se construit sous Windows.');
  const version = require('../package.json').version;
  const sourceDir = path.join(root, 'dist', `LasmiumTokensHub-${version}-win32-x64`);
  try { await fs.access(path.join(sourceDir, 'LasmiumTokensHub.exe')); }
  catch { throw new Error(`Distribution absente : lance d'abord « npm run package:release » (dist/LasmiumTokensHub-${version}-win32-x64).`); }
  const outputDir = path.join(root, 'dist');
  const name = `LasmiumTokensHub-Setup-${version}.exe`;
  await fs.rm(path.join(outputDir, name), { force: true });
  const iscc = findIscc();
  const result = spawnSync(iscc, ['/Qp', `/DAppVersion=${version}`, `/DSourceDir=${sourceDir}`, `/DOutputDir=${outputDir}`,
    `/DRootDir=${root}`, path.join(root, 'installer', 'LasmiumTokensHub.iss')], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`Inno Setup n’a pas pu être lancé : ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Inno Setup a échoué (code ${result.status}).`);
  const installer = path.join(outputDir, name);
  const digest = crypto.createHash('sha256').update(await fs.readFile(installer)).digest('hex');
  const sumsPath = path.join(outputDir, `SHA256SUMS-${version}.txt`);
  await fs.writeFile(sumsPath, upsertSum(await fs.readFile(sumsPath, 'utf8').catch(() => ''), digest, name), 'utf8');
  const size = (await fs.stat(installer)).size;
  console.log(`Installeur : ${path.relative(root, installer)} (${(size / 1024 / 1024).toFixed(1)} Mo)`);
  console.log(`SHA-256    : ${digest}`);
}

if (require.main === module) main().catch(error => { console.error(`Installeur : ${error.message}`); process.exitCode = 1; });
module.exports = { findIscc, isccCandidates, upsertSum };
