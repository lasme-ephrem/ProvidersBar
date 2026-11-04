#!/usr/bin/env node
// `npm run doctor` — préflight des prérequis Lasmium TOKENS-HUB.
// Lecture seule, aucun secret, aucun service authentifié interrogé.
const path = require('node:path');
const { collectDiagnostics, CRITICAL_IDS } = require('../lib/diagnostics.cjs');
const { version } = require('../package.json');

function criticalFailures(items) {
  return items.filter(item => !item.ok && CRITICAL_IDS.includes(item.id));
}
function exitCode(items) {
  return criticalFailures(items).length ? 1 : 0;
}
function formatReport(items) {
  const failures = items.filter(item => !item.ok);
  const critical = criticalFailures(items);
  const lines = [`Lasmium TOKENS-HUB ${version} — diagnostic des prérequis`, ''];
  for (const item of items) {
    lines.push(`[${item.ok ? 'OK' : 'ÉCHEC'}] ${item.label} — ${item.detail}`);
    if (!item.ok && item.hint) lines.push(`        → ${item.hint}`);
  }
  lines.push('');
  lines.push(`${items.length} vérifications · ${items.length - failures.length} OK · ${failures.length} échec(s).`);
  if (critical.length) lines.push(`Prérequis critique(s) manquant(s) : ${critical.map(item => item.label).join(', ')}.`);
  else if (failures.length) lines.push('Aucun prérequis critique manquant. Les lignes [ÉCHEC] ci-dessus sont des avertissements à corriger.');
  else lines.push('Tous les prérequis sont présents.');
  return lines.join('\n');
}
async function runDoctor(options = {}) {
  const dataDir = options.dataDir || (process.env.LASMIUM_DATA_DIR || process.env.PROVIDERSBAR_DATA_DIR) || path.join(process.cwd(), '.local');
  return collectDiagnostics({ ...options, dataDir });
}
async function main(argv = process.argv.slice(2)) {
  const items = await runDoctor();
  if (argv.includes('--json')) process.stdout.write(JSON.stringify(items, null, 2) + '\n');
  else process.stdout.write(formatReport(items) + '\n');
  process.exitCode = exitCode(items);
  return items;
}
if (require.main === module) {
  main().catch(error => {
    // Never echo an exception body that could contain a path or a token.
    process.stderr.write(`Diagnostic impossible : ${error && error.message ? error.message : 'erreur inconnue'}\n`);
    process.exitCode = 2;
  });
}
module.exports = { runDoctor, formatReport, exitCode, criticalFailures, main };
