// Tests de packaging sur des chemins simulés : aucune copie de 160 Mo, aucun
// Electron lancé, aucun accès aux données réelles. Les scripts réels
// (package.cjs, app-resources.cjs, runtime-dependencies.cjs, update-portable.cjs)
// sont copiés dans un dépôt temporaire minimal avec un faux module Electron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const scriptsDirectory = path.join(root, 'scripts');
const FIXTURE_VERSION = '9.8.7';
const RELEASE_DIRECTORY = `LasmiumTokensHub-${FIXTURE_VERSION}-win32-x64`;
const PORTABLE_DIRECTORY = 'ProvidersBar-win32-x64';
const fakeElectronBytes = Buffer.from('fake-electron-binary\n');
const FIXTURE_MAIN = 'module.exports = "fixture-main-v1";\n';
const FIXTURE_PRELOAD = 'module.exports = "fixture-preload-v1";\n';
const FIXTURE_RENDERER = '<main>fixture renderer v1</main>\n';

async function runNode(cwd, args) {
  try {
    // Faux Electron (quelques octets) : l'icône de l'exécutable n'est pas écrite.
    const env = { ...process.env, LASMIUM_FAKE_ELECTRON: '1' };
    const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd, env, windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout || '', stderr: error.stderr || String(error.message) };
  }
}

async function writeTree(base, files) {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(base, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
}

// Dépôt temporaire minimal : scripts réels + lib réelle (petite) + faux Electron
// et faux module de production, pour exercer le vrai code de packaging.
async function createFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-package-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.mkdir(path.join(base, 'scripts'), { recursive: true });
  for (const name of await fs.readdir(scriptsDirectory)) {
    if (name.endsWith('.cjs')) await fs.copyFile(path.join(scriptsDirectory, name), path.join(base, 'scripts', name));
  }
  await fs.cp(path.join(root, 'lib'), path.join(base, 'lib'), { recursive: true });
  await writeTree(base, {
    'package.json': JSON.stringify({ name: 'lasmium-fixture', version: FIXTURE_VERSION, private: true, main: 'main.cjs', dependencies: { 'proper-lockfile': '4.1.2' } }),
    'main.cjs': FIXTURE_MAIN,
    'preload.cjs': FIXTURE_PRELOAD,
    'renderer/index.html': FIXTURE_RENDERER,
    'assets/providers/marker.svg': '<svg>fixture</svg>\n',
    'docs/guide.md': '# Guide fixture\n',
    'README.md': '# README fixture\n',
    'CHANGELOG.md': '# CHANGELOG fixture\n',
    'node_modules/electron/package.json': JSON.stringify({ name: 'electron', version: '44.10.2', main: 'index.js' }),
    'node_modules/electron/index.js': "module.exports = require('node:path').join(__dirname, 'electron.exe');\n",
    'node_modules/electron/electron.exe': fakeElectronBytes,
    'node_modules/proper-lockfile/package.json': JSON.stringify({ name: 'proper-lockfile', version: '4.1.2', main: 'index.js', dependencies: { 'fake-child': '1.0.0' } }),
    'node_modules/proper-lockfile/index.js': 'module.exports = {};\n',
    'node_modules/proper-lockfile/node_modules/fake-child/package.json': JSON.stringify({ name: 'fake-child', version: '1.0.0', main: 'index.js' }),
    'node_modules/proper-lockfile/node_modules/fake-child/index.js': 'module.exports = {};\n',
  });
  return base;
}

const portablePath = base => path.join(base, 'dist', PORTABLE_DIRECTORY);

// ---------------------------------------------------------------------------
// package.cjs --release
// ---------------------------------------------------------------------------

test('package.cjs --release construit une distribution versionnée complète sans données', { timeout: 120000 }, async t => {
  const base = await createFixture(t);
  const result = await runNode(base, ['scripts/package.cjs', '--release']);
  assert.equal(result.code, 0, `Échec du packaging :\n${result.stderr}`);
  const out = path.join(base, 'dist', RELEASE_DIRECTORY);
  const app = path.join(out, 'resources', 'app');

  assert.ok(fss.existsSync(path.join(out, 'LasmiumTokensHub.exe')), 'Lasmium TOKENS-HUB.exe doit exister.');
  assert.equal(fss.existsSync(path.join(out, 'electron.exe')), false, 'electron.exe doit être renommé.');
  assert.deepEqual(await fs.readFile(path.join(out, 'LasmiumTokensHub.exe')), fakeElectronBytes);

  assert.equal(await fs.readFile(path.join(app, 'main.cjs'), 'utf8'), FIXTURE_MAIN);
  assert.equal(await fs.readFile(path.join(app, 'preload.cjs'), 'utf8'), FIXTURE_PRELOAD);
  assert.equal(await fs.readFile(path.join(app, 'renderer', 'index.html'), 'utf8'), FIXTURE_RENDERER);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8')), {
    name: 'lasmium-tokens-hub', productName: 'Lasmium TOKENS-HUB', version: FIXTURE_VERSION, main: 'main.cjs',
  });

  // Dépendances de production copiées, y compris imbriquées.
  assert.ok(fss.existsSync(path.join(app, 'node_modules', 'proper-lockfile', 'index.js')), 'proper-lockfile doit être embarqué.');
  assert.ok(fss.existsSync(path.join(app, 'node_modules', 'proper-lockfile', 'node_modules', 'fake-child', 'index.js')), 'Les dépendances imbriquées doivent être copiées.');
  assert.equal(fss.existsSync(path.join(app, 'node_modules', 'electron')), false, 'Les dépendances de développement ne doivent pas être embarquées.');
  assert.equal(fss.existsSync(path.join(app, 'data')), false, 'Une release ne doit contenir aucune donnée personnelle.');

  // Aucun dossier de staging résiduel.
  const resourcesEntries = await fs.readdir(path.join(out, 'resources'));
  assert.deepEqual(resourcesEntries, ['app'], `Dossiers de staging résiduels : ${resourcesEntries.join(', ')}`);
});

test('package.cjs refuse d’écraser une release déjà construite', { timeout: 120000 }, async t => {
  const base = await createFixture(t);
  const out = path.join(base, 'dist', RELEASE_DIRECTORY);
  await writeTree(out, {
    'keep.txt': 'release existante\n',
    'resources/app/main.cjs': 'module.exports = "release-existante";\n',
  });
  const result = await runNode(base, ['scripts/package.cjs', '--release']);
  assert.notEqual(result.code, 0, 'Un second packaging --release doit échouer.');
  assert.match(`${result.stderr}${result.stdout}`, /EEXIST|existe déjà|already exists/i);
  assert.equal(await fs.readFile(path.join(out, 'keep.txt'), 'utf8'), 'release existante\n');
  assert.equal(await fs.readFile(path.join(out, 'resources', 'app', 'main.cjs'), 'utf8'), 'module.exports = "release-existante";\n');
  assert.equal(fss.existsSync(path.join(out, 'LasmiumTokensHub.exe')), false);
});

// ---------------------------------------------------------------------------
// package.cjs (portable personnel)
// ---------------------------------------------------------------------------

test('package.cjs met à jour le portable en préservant data/ et en retirant les fichiers obsolètes', { timeout: 120000 }, async t => {
  const base = await createFixture(t);
  const portable = portablePath(base);
  const dataFiles = {
    'data/state.json': Buffer.from('{"fixture":"state"}\n'),
    'data/credentials.json': Buffer.from('{"fixture":"credentials"}\n'),
    'data/account-browsers/claude/session.bin': Buffer.from([0, 1, 2, 255, 0, 42]),
    'data/DevToolsActivePort': Buffer.from('not-a-port\n'),
  };
  for (const [relative, contents] of Object.entries(dataFiles)) {
    const target = path.join(portable, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  await writeTree(portable, {
    'resources/app/main.cjs': 'module.exports = "old-main";\n',
    'resources/app/obsolete-module.cjs': 'doit disparaître\n',
  });
  const before = new Map();
  for (const relative of Object.keys(dataFiles)) before.set(relative, await fs.readFile(path.join(portable, relative)));

  const result = await runNode(base, ['scripts/package.cjs']);
  assert.equal(result.code, 0, `Échec de la mise à jour portable :\n${result.stderr}`);
  const app = path.join(portable, 'resources', 'app');
  assert.equal(await fs.readFile(path.join(app, 'main.cjs'), 'utf8'), FIXTURE_MAIN);
  assert.equal(fss.existsSync(path.join(app, 'obsolete-module.cjs')), false, 'Les fichiers supprimés des sources doivent disparaître.');
  assert.ok(fss.existsSync(path.join(portable, 'LasmiumTokensHub.exe')));
  assert.equal(fss.existsSync(path.join(portable, 'electron.exe')), false);

  for (const [relative, expected] of Object.entries(dataFiles)) {
    assert.deepEqual(await fs.readFile(path.join(portable, relative)), expected, `${relative} doit être préservé octet par octet.`);
    assert.deepEqual(before.get(relative), expected, `${relative} ne doit pas être modifié pendant le test.`);
  }
  assert.equal(fss.existsSync(path.join(app, 'data')), false, 'Les données ne doivent jamais être copiées dans resources/app.');
});

// ---------------------------------------------------------------------------
// app-resources.cjs (refus de cible hors dist)
// ---------------------------------------------------------------------------

test('app-resources refuse une cible hors du dossier dist et ne crée rien', async t => {
  const { updateAppResources } = require('../scripts/app-resources.cjs');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-resources-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const outside = path.join(base, 'portable-outside-dist');
  await assert.rejects(updateAppResources(base, outside));
  await assert.rejects(fs.access(outside), { code: 'ENOENT' });
});

// ---------------------------------------------------------------------------
// update-portable.cjs (fermeture de l'ancien processus)
// ---------------------------------------------------------------------------

test('update-portable ignore un état de diagnostic absent ou invalide sans bloquer', { timeout: 20000 }, async t => {
  const base = await createFixture(t);
  const portable = portablePath(base);
  const { closeRunningApp } = require(path.join(base, 'scripts', 'update-portable.cjs'));

  // Fichier absent : aucune lecture de port ne doit échouer bruyamment.
  await fs.mkdir(path.join(portable, 'data'), { recursive: true });
  await closeRunningApp();

  // Contenu non conforme : refus silencieux (pas de WebSocket créé).
  await fs.writeFile(path.join(portable, 'data', 'DevToolsActivePort'), 'garbage\n');
  await closeRunningApp();

  // Port valide en forme mais fermé : la connexion échoue proprement et se résout.
  await fs.writeFile(path.join(portable, 'data', 'DevToolsActivePort'), '1\n/devtools/browser/fixture-id\n');
  await closeRunningApp();
});

// ---------------------------------------------------------------------------
// preview.cjs (serveur d'aperçu)
// ---------------------------------------------------------------------------

function portAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

test('preview.cjs sert l’interface et un état simulé sans compte', { timeout: 30000 }, async t => {
  const port = 4317;
  if (!await portAvailable(port)) {
    t.skip(`Port ${port} déjà occupé (aperçu lancé ?) : test ignoré.`);
    return;
  }
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'preview.cjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Le serveur d’aperçu n’a pas démarré : ${stderr}`)), 10000);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('Aperçu')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Aperçu terminé prématurément (${code}) : ${stderr}`)); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });

  const base = `http://127.0.0.1:${port}`;
  const stateResponse = await fetch(`${base}/preview-state`);
  assert.equal(stateResponse.status, 200);
  assert.match(stateResponse.headers.get('content-type') || '', /application\/json/);
  const state = await stateResponse.json();
  assert.ok(Array.isArray(state.providers) && state.providers.length > 0, 'L’état d’aperçu doit exposer des fournisseurs.');
  assert.equal(state.desktop, false);
  assert.equal(typeof state.summary, 'object');
  assert.ok(state.providers.every(provider => provider.connector && typeof provider.connector === 'object'), 'Chaque fournisseur doit exposer ses informations de connexion.');

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') || '', /text\/html/);
  assert.match(await index.text(), /<html/i);

  const missing = await fetch(`${base}/route-inconnue`);
  assert.equal(missing.status, 404);
});
