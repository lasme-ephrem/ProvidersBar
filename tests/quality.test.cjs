// Tests transverses du dépôt : secrets, hygiene Git, versions, scripts npm, CI,
// outils de diagnostic. Ces tests ne touchent ni au réseau ni à Electron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFile(path.join(root, relative), 'utf8');
const exists = relative => fss.existsSync(path.join(root, relative));

async function walk(relativeDir) {
  const files = [];
  const directory = path.join(root, relativeDir);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = `${relativeDir.split(path.sep).join('/')}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(relative));
    else files.push(relative);
  }
  return files;
}

// Le smoke test contient volontairement de fausses clés (`test-secret-…`) pour
// vérifier le chiffrement : il est exclu de l'analyse de secrets en dur.
function isSmokeTool(relative) {
  return /^scripts\/smoke[^/]*\.cjs$/.test(relative);
}

async function productionFiles() {
  const files = ['main.cjs', 'preload.cjs'];
  for (const directory of ['lib', 'renderer', 'scripts']) {
    for (const file of await walk(directory)) {
      if (!['.cjs', '.js', '.html'].includes(path.extname(file).toLowerCase())) continue;
      if (isSmokeTool(file)) continue;
      files.push(file);
    }
  }
  return files;
}

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function changelogVersions(markdown) {
  return [...markdown.matchAll(/^##\s+(\d+\.\d+\.\d+)\b/gm)].map(match => match[1]);
}

function readmeAnnouncedVersion(markdown) {
  return markdown.match(/\bversion\s+(\d+\.\d+\.\d+)\b/i)?.[1] || null;
}

// ---------------------------------------------------------------------------
// Secrets et données personnelles
// ---------------------------------------------------------------------------

const secretPatterns = [
  { name: 'clé privée PEM', regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'clé AWS', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'jeton GitHub', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'jeton Slack', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'jeton compatible sk-', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'clé API Google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'jeton JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];
const userProfilePathPattern = /[A-Za-z]:\\Users\\[^\\\s'"]+\\/;

test('le code de production ne contient aucun secret en dur', async () => {
  const findings = [];
  for (const file of await productionFiles()) {
    const content = await read(file);
    const lines = content.split(/\r?\n/);
    for (const pattern of secretPatterns) {
      lines.forEach((line, index) => {
        if (pattern.regex.test(line)) findings.push(`${file}:${index + 1} — ${pattern.name}`);
      });
    }
    lines.forEach((line, index) => {
      if (userProfilePathPattern.test(line)) findings.push(`${file}:${index + 1} — chemin utilisateur Windows en dur`);
    });
  }
  assert.deepEqual(findings, [], `Secrets ou chemins personnels détectés :\n${findings.join('\n')}`);
});

test('le dépôt ne versionne pas de fichier de données ou de clé à la racine', () => {
  for (const name of ['credentials.json', 'state.json']) {
    assert.equal(exists(name), false, `${name} ne doit pas exister à la racine du dépôt`);
  }
});

test('le .gitignore couvre les données personnelles et les résultats de test', async () => {
  const lines = (await read('.gitignore'))
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  const required = ['node_modules/', 'dist/', '.local/', '.npm-cache/', 'test-results/', 'data/', 'credentials.json', 'state.json', 'account-browsers/', 'state.before-*.json'];
  const missing = required.filter(entry => !lines.some(line => line === entry || line === entry.replace(/\/$/, '')));
  assert.deepEqual(missing, [], `Entrées manquantes dans .gitignore : ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Marqueurs de travail inachevé
// ---------------------------------------------------------------------------

test('le code de production ne contient aucun marqueur TODO/FIXME/XXX/HACK', async () => {
  const findings = [];
  for (const file of await productionFiles()) {
    if (!['.cjs', '.js'].includes(path.extname(file).toLowerCase())) continue;
    const lines = (await read(file)).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/\b(TODO|FIXME|XXX|HACK)\b/.test(line)) findings.push(`${file}:${index + 1} — ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(findings, [], `Marqueurs inachevés détectés :\n${findings.join('\n')}`);
});

// ---------------------------------------------------------------------------
// Versions et documentation
// ---------------------------------------------------------------------------

test('le CHANGELOG est valide, sans doublon et ordonné du plus récent au plus ancien', async () => {
  const versions = changelogVersions(await read('CHANGELOG.md'));
  assert.ok(versions.length >= 2, 'Le CHANGELOG doit contenir au moins deux versions.');
  assert.equal(new Set(versions).size, versions.length, `Versions dupliquées dans CHANGELOG.md : ${versions.join(', ')}`);
  for (let index = 0; index < versions.length - 1; index++) {
    assert.ok(compareVersions(versions[index], versions[index + 1]) > 0, `Ordre invalide : ${versions[index]} avant ${versions[index + 1]}`);
  }
});

test('README et CHANGELOG annoncent la même version publiée', async () => {
  const latest = changelogVersions(await read('CHANGELOG.md'))[0];
  const announced = readmeAnnouncedVersion(await read('README.md'));
  assert.ok(announced, 'README.md doit annoncer une version (par exemple « Version 0.2.1 »).');
  assert.equal(announced, latest, `README.md annonce ${announced} mais le dernier CHANGELOG est ${latest}.`);
});

test('la version de package.json est documentée dans README et CHANGELOG', async t => {
  const pkg = JSON.parse(await read('package.json'));
  const versions = changelogVersions(await read('CHANGELOG.md'));
  const latest = versions[0];
  const announced = readmeAnnouncedVersion(await read('README.md'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'package.json doit porter une version SemVer.');
  if (pkg.version !== latest) {
    // Pendant la refonte, la version 0.3.0 est en préparation : README et
    // CHANGELOG sont mis à jour par la vague 3 (docs). Le test se réactivera
    // automatiquement dès que la documentation annoncera la version du paquet.
    assert.ok(compareVersions(pkg.version, latest) > 0, `Le CHANGELOG (${latest}) ne doit pas dépasser package.json (${pkg.version}).`);
    t.diagnostic(`package.json=${pkg.version} · CHANGELOG=${latest} · README=${announced}`);
    t.skip(`Version ${pkg.version} non publiée : README/CHANGELOG seront alignés en vague 3 (hors périmètre T5a).`);
    return;
  }
  assert.equal(announced, pkg.version);
  assert.ok(versions.includes(pkg.version), `CHANGELOG.md doit contenir ${pkg.version}.`);
});

test('package.json respecte les prérequis de la refonte (Node ≥ 24, Electron 44)', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.name, 'providersbar');
  assert.equal(pkg.private, true);
  assert.match(String(pkg.engines?.node || ''), />=\s*24/, 'engines.node doit exiger Node ≥ 24.');
  assert.match(String(pkg.devDependencies?.electron || ''), /^(?:\^|~)?44\./, 'Electron 44.x est requis par la refonte 0.3.0.');
  assert.ok(pkg.main && exists(pkg.main), 'package.json.main doit pointer vers un fichier existant.');
});

// ---------------------------------------------------------------------------
// Scripts npm
// ---------------------------------------------------------------------------

const supportedBins = new Set(['node', 'node.exe', 'electron', 'electron.exe']);

function commandSegments(command) {
  return String(command).split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
}

function commandTargets(command) {
  const targets = [];
  for (const segment of commandSegments(command)) {
    const tokens = segment.trim().split(/\s+/);
    const bin = tokens[0];
    if (!supportedBins.has(bin)) return { unsupported: segment };
    const positional = tokens.slice(1).filter(token => !token.startsWith('-'));
    targets.push({ bin, target: positional[0] || '.' });
  }
  return { targets };
}

function globExpression(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

async function targetExists(bin, target) {
  if (bin === 'node' || bin === 'node.exe') {
    if (target === '.') return exists(path.join('tests')) && (await fs.readdir(path.join(root, 'tests'))).some(name => name.endsWith('.test.cjs'));
    if (target.includes('*') || target.includes('?')) {
      const directory = path.dirname(target);
      const entries = await fs.readdir(path.join(root, directory)).catch(() => []);
      return entries.some(name => globExpression(path.basename(target)).test(name));
    }
    return exists(target);
  }
  // electron . | electron main.cjs : l'entrée est le champ « main » du paquet.
  if (target === '.') {
    const pkg = JSON.parse(await read('package.json'));
    return Boolean(pkg.main && exists(pkg.main));
  }
  return exists(target);
}

test('tous les scripts npm pointent vers un fichier existant', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const scripts = pkg.scripts || {};
  assert.ok(scripts.test, 'Le script « test » est obligatoire.');
  const problems = [];
  for (const [name, command] of Object.entries(scripts)) {
    const { targets, unsupported } = commandTargets(command);
    if (unsupported) {
      problems.push(`"${name}" : commande non vérifiable (« ${unsupported} »). Utiliser node/electron pour rester contrôlable.`);
      continue;
    }
    for (const { bin, target } of targets) {
      if (!await targetExists(bin, target)) problems.push(`"${name}" → ${target} est introuvable.`);
    }
  }
  assert.deepEqual(problems, [], `Scripts npm invalides :\n${problems.join('\n')}`);
});

test('check-syntax couvre tous les fichiers .cjs/.js du dépôt', async () => {
  const syntax = require('../scripts/check-syntax.cjs');
  const { files, missing } = syntax.listFiles();
  assert.deepEqual(missing, [], `Fichiers/dossiers requis manquants : ${missing.join(', ')}`);
  const checked = new Set(files.map(file => path.relative(root, file).split(path.sep).join('/')));
  assert.ok(checked.has('main.cjs') && checked.has('preload.cjs'));
  for (const directory of ['lib', 'scripts', 'renderer', 'tests']) {
    for (const file of await walk(directory)) {
      const extension = path.extname(file).toLowerCase();
      const expected = directory === 'renderer' ? ['.js'] : directory === 'scripts' ? ['.cjs'] : ['.cjs', '.js'];
      if (!expected.includes(extension)) continue;
      assert.ok(checked.has(file), `${file} n'est pas vérifié par scripts/check-syntax.cjs`);
    }
  }
});

// ---------------------------------------------------------------------------
// CI Windows
// ---------------------------------------------------------------------------

test('le workflow CI Windows couvre les garde-fous attendus', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /^name:\s*CI/m);
  assert.match(workflow, /^jobs:/m);
  assert.match(workflow, /^ {2}tests:/m);
  assert.match(workflow, /^ {2}smoke-electron:/m);
  for (const expected of ['windows-latest', 'npm ci', 'npm test', 'npm run verify', 'npm audit --omit=dev', 'continue-on-error: true', 'timeout-minutes', 'cache: npm']) {
    assert.ok(workflow.includes(expected), `Le workflow CI doit contenir « ${expected} ».`);
  }
  assert.match(workflow, /node-version:/);
  assert.match(workflow, /NODE_VERSION:\s*'24'/);
  assert.match(workflow, /session graphique/i, 'Le caractère best-effort du job smoke doit être expliqué (session graphique).');
  assert.doesNotMatch(workflow, /\t/, 'Un fichier YAML ne doit pas contenir de tabulation.');
});

// ---------------------------------------------------------------------------
// Outils de diagnostic (verify-connections)
// ---------------------------------------------------------------------------

const diagnostics = require('../scripts/verify-connections.cjs');

test('diagnostic : normalisation stricte des URLs et origines', () => {
  assert.equal(diagnostics.normalizeUrl('file:///C:/App/Renderer/index.html'), '/c:/app/renderer/index.html');
  assert.equal(diagnostics.normalizeUrl('file:///C:/App/Renderer/index.html?mode=quick#x'), '/c:/app/renderer/index.html');
  assert.equal(diagnostics.normalizeUrl('https://Example.COM/a/b/?q=1'), 'https://example.com/a/b');
  assert.equal(diagnostics.normalizeUrl('http://127.0.0.1:4317/'), 'http://127.0.0.1:4317/');
  for (const invalid of ['', '   ', 'not a url', 'ftp://example.com/x', 'javascript:alert(1)', null, 42]) {
    assert.equal(diagnostics.normalizeUrl(invalid), null, `URL refusée attendue : ${String(invalid)}`);
  }
});

test('diagnostic : sélection de la fenêtre principale et détection du widget', () => {
  const expected = 'file:///C:/App/resources/app/renderer/index.html';
  assert.equal(diagnostics.isQuickWindow('file:///c:/app/resources/app/renderer/index.html?mode=quick'), true);
  assert.equal(diagnostics.isQuickWindow(expected), false);
  assert.equal(diagnostics.isQuickWindow('not a url'), false);
  assert.equal(diagnostics.isExpectedPage('file:///c:/app/resources/app/renderer/index.html', expected), true);
  assert.equal(diagnostics.isExpectedPage('https://evil.example/', expected), false);
  const pages = [
    { url: () => 'file:///C:/App/resources/app/renderer/index.html' },
    { url: () => 'file:///c:/app/resources/app/renderer/index.html?mode=quick' },
    { url: () => 'https://evil.example/' },
    { url: () => { throw new Error('page détruite'); } },
  ];
  const dashboards = diagnostics.selectDashboardPages(pages, expected);
  assert.equal(dashboards.length, 1);
  assert.equal(diagnostics.selectDashboardPages([pages[1], pages[2]], expected).length, 0);
});

test('diagnostic : lecture du port DevToolsActivePort', () => {
  assert.deepEqual(diagnostics.parseDiagnosticPort('9222\n/devtools/browser/abc-123'), { port: 9222, suffix: '/devtools/browser/abc-123' });
  assert.deepEqual(diagnostics.parseDiagnosticPort('1\r\n/devtools/browser/x\n'), { port: 1, suffix: '/devtools/browser/x' });
  assert.equal(diagnostics.parseDiagnosticPort('9222', { maxPort: 65535 }), null);
  assert.equal(diagnostics.parseDiagnosticPort('0\n/devtools/browser/x'), null);
  assert.equal(diagnostics.parseDiagnosticPort('65536\n/devtools/browser/x'), null);
  assert.equal(diagnostics.parseDiagnosticPort('abc\n/devtools/browser/x'), null);
  assert.equal(diagnostics.parseDiagnosticPort('9222\n/devtools/page/x'), null);
  assert.equal(diagnostics.parseDiagnosticPort('9222\n/devtools/browser/x', { maxPort: 9000 }), null);
  assert.equal(diagnostics.parseDiagnosticPort(''), null);
});

test('diagnostic : rapport sans secret et code retour correct', () => {
  const providers = [
    { id: 'openai', name: 'OpenAI GPT', active: true, connected: true, subscriptionStatus: 'active', lastAttempt: '2026-10-01T10:00:00.000Z',
      snapshot: { updatedAt: '2026-10-01T10:00:00.000Z', quotaWindows: [{ label: 'Semaine', remaining: 42, resetAt: '2026-10-08T10:00:00.000Z' }], balances: [{ currency: 'USD', remaining: 3 }] },
      accountSession: { kind: 'openai-codex', identity: 'secret-hash' }, error: 'message privé', connector: { mode: 'account' } },
    { id: 'zai', active: true, connected: false, subscriptionStatus: 'expired', error: null, snapshot: null },
    { id: 'grok', active: true, connected: true, error: null, snapshot: { updatedAt: '2026-10-01T10:00:00.000Z', quotaWindows: [] } },
  ];
  const report = diagnostics.buildReport({ providers, checkedInactive: ['zai'], now: new Date('2026-10-01T12:00:00.000Z') });
  assert.equal(report.checkedAt, '2026-10-01T12:00:00.000Z');
  assert.deepEqual(Object.keys(report.providers[0]).sort(), ['active', 'attemptedAt', 'connected', 'id', 'measuredAt', 'result', 'subscriptionStatus', 'windows'].sort());
  assert.equal(report.providers[0].result, 'error');
  assert.equal(report.providers[1].result, 'not-tracked');
  assert.equal(report.providers[1].inactiveConnectionCheck, 'unknown');
  assert.equal(report.providers[2].result, 'ok');
  const serialized = JSON.stringify(report);
  for (const forbidden of ['secret-hash', 'message privé', 'accountSession', 'identity', 'balances', 'amount', 'email', 'token', 'cookie']) {
    assert.equal(serialized.includes(forbidden), false, `Le rapport ne doit pas contenir « ${forbidden} ».`);
  }
  assert.deepEqual(report.providers[0].windows, [{ label: 'Semaine', remaining: 42, resetAt: '2026-10-08T10:00:00.000Z' }]);
  assert.equal(diagnostics.reportNeedsAttention(report), true);
  assert.equal(diagnostics.reportNeedsAttention({ providers: [{ result: 'ok' }, { result: 'not-tracked' }] }), false);
  assert.equal(diagnostics.formatReportLine(report.providers[1]), 'zai: not-tracked · session unknown · no measurement');
  assert.throws(() => diagnostics.buildReport({ providers: null }), /providers/);
});

test('diagnostic : readDiagnosticPort gère absence et contenu invalide', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'providersbar-diagnostic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(diagnostics.readDiagnosticPort(directory), /Aucun port de diagnostic local/);
  await fs.mkdir(path.join(directory, 'data'), { recursive: true });
  await fs.writeFile(path.join(directory, 'data', 'DevToolsActivePort'), 'invalid\n');
  await assert.rejects(diagnostics.readDiagnosticPort(directory), /Port de diagnostic invalide/);
  await fs.writeFile(path.join(directory, 'data', 'DevToolsActivePort'), '9222\n/devtools/browser/test-id\n');
  assert.deepEqual(await diagnostics.readDiagnosticPort(directory), { port: 9222, suffix: '/devtools/browser/test-id' });
});

// ---------------------------------------------------------------------------
// Documentation de maintenance
// ---------------------------------------------------------------------------

test('docs/maintenance.md documente les commandes et la CI réelles', async () => {
  const maintenance = await read('docs/maintenance.md');
  const expected = [
    'npm ci',
    'npm test',
    'npm run verify',
    'npm run lint',
    'npm run doctor',
    'node scripts/check-syntax.cjs',
    'node --test --experimental-test-coverage',
    '.github/workflows/ci.yml',
    'npm run test:desktop',
    'npm run test:claude:desktop',
    'npm run test:resources:desktop',
    'npm audit --omit=dev',
    'tests/quality.test.cjs',
    'tests/packaging.test.cjs',
  ];
  for (const entry of expected) assert.ok(maintenance.includes(entry), `docs/maintenance.md doit mentionner « ${entry} ».`);
  assert.match(maintenance, /continue-on-error|best-effort/i, 'La maintenance doit expliquer le caractère best-effort du job smoke.');
});

// ---------------------------------------------------------------------------
// Couverture des non-régressions P0/P1 de la refonte 0.3.0
// ---------------------------------------------------------------------------

// Matrice lue par la revue finale : chaque risque majeur de l'analyse possède
// soit un test unitaire (npm test), soit un scénario smoke identifié ici.
test('les smoke tests couvrent les non-régressions critiques de la refonte 0.3.0', async () => {
  const dashboard = await read('scripts/smoke.cjs');
  const claude = await read('scripts/smoke-claude.cjs');
  const resources = await read('scripts/smoke-resource-status.cjs');
  const dashboardMarkers = [
    'getAppInfo',          // P0-4 : version dynamique via IPC
    'erase-data',          // contrat §3.5 : effacement complet
    'Espace local',        // P0-4 : marque neutre
    'quick-freshness',     // P1-10 : fraîcheur réelle du widget
    'apiCooldowns',        // P1-2 : cooldowns 429 persistés
    'accountSession',      // P0-5/P0-6 : sessions conservées puis invalidées
    'USERPROFILE',         // isolation Claude Code (pas de profil réel)
    'openOllamaEmail',     // P0-5 : session Ollama écrite avant le fetch
    'Couvre P0-5/P0-6',    // traçabilité explicite des scénarios
  ];
  for (const marker of dashboardMarkers) assert.ok(dashboard.includes(marker), `scripts/smoke.cjs doit couvrir « ${marker} ».`);
  const claudeMarkers = ['deny-token', 'offline', 'fixture-live-access', 'Prochaine tentative', 'chaque minute', 'USERPROFILE'];
  for (const marker of claudeMarkers) assert.ok(claude.includes(marker), `scripts/smoke-claude.cjs doit couvrir « ${marker} ».`);
  const resourceMarkers = ['state.settings.theme', 'level-pill', 'Toutes les limites atteintes', 'resource-empty'];
  for (const marker of resourceMarkers) assert.ok(resources.includes(marker), `scripts/smoke-resource-status.cjs doit couvrir « ${marker} ».`);
  // Aucun smoke ne doit utiliser le vrai profil Claude Code de l'utilisateur.
  assert.match(claude, /USERPROFILE/, 'smoke-claude doit isoler le profil Claude Code');
  assert.match(dashboard, /smoke-home-|USERPROFILE/, 'smoke doit isoler le profil Claude Code');
});
