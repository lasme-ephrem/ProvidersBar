'use strict';

// Canary des connecteurs. Par défaut (sans réseau) : vérifie les packs signés
// embarqués et leurs invariants. Avec --live : lecture réelle en lecture seule
// des APIs pour lesquelles une clé de test est fournie par l'environnement :
//   LASMIUM_CANARY_OPENROUTER_KEY, LASMIUM_CANARY_DEEPSEEK_KEY,
//   LASMIUM_CANARY_RUNINFRA_KEY
// Aucune clé n'est écrite, journalisée ou incluse dans le rapport.

const fs = require('node:fs/promises');
const path = require('node:path');
const { loadPacks } = require('../lib/connector-packs.cjs');
const { fetchUsage } = require('../lib/connectors.cjs');
const packageJson = require('../package.json');

const ROOT = path.join(__dirname, '..');
const LIVE_KEYS = {
  openrouter: 'LASMIUM_CANARY_OPENROUTER_KEY',
  deepseek: 'LASMIUM_CANARY_DEEPSEEK_KEY',
  runinfra: 'LASMIUM_CANARY_RUNINFRA_KEY',
};

async function main(argv = process.argv.slice(2)) {
  const live = argv.includes('--live');
  const publicKey = await fs.readFile(path.join(ROOT, 'lib', 'connector-packs-public.pem'), 'utf8');
  const result = await loadPacks({
    dirs: [path.join(ROOT, 'assets', 'connector-packs')],
    publicKey,
    appVersion: packageJson.version,
    providers: ['openrouter', 'deepseek', 'runinfra', 'orcarouter'],
  });
  const report = { mode: live ? 'live' : 'fixtures', appVersion: packageJson.version, packs: [], errors: result.errors, checks: [] };
  for (const pack of result.packs.values()) {
    report.packs.push({ provider: pack.provider, version: pack.version, parserVersion: pack.parserVersion || null });
    if (!live) {
      report.checks.push({ provider: pack.provider, ok: Boolean(pack.endpoint && pack.parserVersion), endpoint: pack.endpoint || null });
      continue;
    }
    const envKey = LIVE_KEYS[pack.provider];
    const key = envKey ? process.env[envKey] : '';
    if (!key) { report.checks.push({ provider: pack.provider, skipped: 'clé de test absente' }); continue; }
    const started = Date.now();
    try {
      const snapshot = await fetchUsage(pack.provider, key, fetch, { endpoint: pack.endpoint });
      report.checks.push({
        provider: pack.provider,
        ok: true,
        durationMs: Date.now() - started,
        balances: (snapshot.balances || []).map(balance => ({ currency: balance.currency, remaining: balance.remaining })),
      });
    } catch (error) {
      report.checks.push({ provider: pack.provider, ok: false, durationMs: Date.now() - started, error: error.message });
    }
  }
  console.log(JSON.stringify(report, null, 2));
  const failed = report.errors.length > 0 || report.checks.some(check => check.ok === false);
  return failed ? 1 : 0;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
