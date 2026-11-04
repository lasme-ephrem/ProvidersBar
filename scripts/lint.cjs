#!/usr/bin/env node
// Lint du dépôt : vérification syntaxique (scripts/check-syntax.cjs, node --check)
// puis ESLint (eslint.config.cjs) via son API Node. `--fix` applique les
// corrections automatiques. Utilisé par `npm run lint` / `npm run lint:fix`.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function runSyntaxCheck() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'check-syntax.cjs')], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) {
    console.error(`[ERREUR] check-syntax : exécution impossible (${result.error.code || result.error.message})`);
    return false;
  }
  return result.status === 0;
}

async function runEslint({ fix }) {
  const { ESLint } = require('eslint');
  const eslint = new ESLint({ cwd: root, fix });
  const results = await eslint.lintFiles(['.']);
  if (fix) await ESLint.outputFixes(results);
  const formatter = await eslint.loadFormatter('stylish');
  const output = await formatter.format(results);
  if (output.trim()) console.log(output);
  const errors = results.reduce((total, result) => total + result.errorCount + result.fatalErrorCount, 0);
  const warnings = results.reduce((total, result) => total + result.warningCount, 0);
  const fixed = fix ? results.filter(result => typeof result.output === 'string').length : 0;
  const summary = `${results.length} fichier(s) analysé(s) · ${errors} erreur(s) · ${warnings} avertissement(s)${fix ? ` · ${fixed} fichier(s) corrigé(s)` : ''}`;
  if (errors) console.error(`Échec ESLint : ${summary}.`);
  else console.log(`[ok] ESLint : ${summary}.`);
  return errors === 0;
}

async function main() {
  const fix = process.argv.includes('--fix');
  if (!runSyntaxCheck()) {
    process.exitCode = 1;
    return;
  }
  console.log(`Lasmium TOKENS-HUB — ESLint${fix ? ' (--fix)' : ''}`);
  if (!await runEslint({ fix })) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[ERREUR] lint : ${error.message}`);
    process.exitCode = 1;
  });
}
module.exports = { runSyntaxCheck, runEslint };
