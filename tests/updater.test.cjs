'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cryptoModule = crypto;
const { createUpdater } = require('../lib/updater.cjs');
const { signManifest } = require('../lib/update-manifest.cjs');

function setup() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const manifest = {
    schemaVersion: 1,
    version: '0.6.0',
    minApp: '0.5.0',
    publishedAt: '2026-11-05T10:00:00.000Z',
    notes: 'Nouveautés.',
    asset: {
      name: 'LasmiumTokensHub-0.6.0-win32-x64.zip',
      url: 'https://example.test/LasmiumTokensHub-0.6.0-win32-x64.zip',
      sha256: 'b'.repeat(64),
      size: 100,
    },
  };
  manifest.signature = signManifest(manifest, privateKey);
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  return { manifest, publicPem, privateKey };
}

function fakeFetch(manifest) {
  return async url => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => null },
    arrayBuffer: async () => Buffer.from(JSON.stringify(manifest)),
  });
}

function updater(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lasmium-update-'));
  return createUpdater({
    currentVersion: '0.5.0',
    manifestUrl: 'https://example.test/latest.json',
    publicKey: overrides.publicKey,
    dataDir,
    targetRoot: dataDir,
    fetchImpl: fakeFetch(overrides.manifest),
    ...overrides,
  });
}

test('une mise à jour plus récente et signée devient disponible', async () => {
  const { manifest, publicPem } = setup();
  const controller = updater({ manifest, publicKey: publicPem });
  const result = await controller.check();
  assert.equal(result.state, 'available');
  assert.equal(result.available.version, '0.6.0');
  assert.equal(result.available.notes, 'Nouveautés.');
});

test('une version identique est signalée à jour', async () => {
  const { manifest, publicPem, privateKey } = setup();
  manifest.version = '0.5.0';
  manifest.asset.name = 'LasmiumTokensHub-0.5.0-win32-x64.zip';
  manifest.signature = signManifest(manifest, privateKey);
  const controller = updater({ manifest, publicKey: publicPem });
  const result = await controller.check();
  assert.equal(result.state, 'up-to-date');
});

test('une signature altérée bloque la mise à jour', async () => {
  const { manifest, publicPem } = setup();
  manifest.notes = 'altéré';
  const controller = updater({ manifest, publicKey: publicPem });
  const result = await controller.check();
  assert.equal(result.state, 'error');
  assert.match(result.error, /signature|refusée/i);
});

test('une source HTTP est refusée avant toute requête', async () => {
  const { manifest, publicPem } = setup();
  let called = false;
  const controller = updater({
    manifest, publicKey: publicPem,
    manifestUrl: 'http://example.test/latest.json',
    fetchImpl: async () => { called = true; return fakeFetch(manifest)(); },
  });
  const result = await controller.check();
  assert.equal(result.state, 'error');
  assert.match(result.error, /HTTPS/);
  assert.equal(called, false);
});


test('une archive signée est téléchargée, vérifiée et préparée sans toucher à data/', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lasmium-update-zip-'));
  const pkg = path.join(root, 'LasmiumTokensHub-0.6.0-win32-x64');
  fs.mkdirSync(path.join(pkg, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'LasmiumTokensHub.exe'), 'exe');
  fs.writeFileSync(path.join(pkg, 'resources', 'app', 'main.cjs'), 'main');
  const zip = path.join(root, 'update.zip');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -LiteralPath '${pkg}' -DestinationPath '${zip}' -Force`]);
  const bytes = fs.readFileSync(zip);
  const { manifest, publicPem, privateKey } = setup();
  manifest.asset.sha256 = cryptoModule.createHash('sha256').update(bytes).digest('hex');
  manifest.asset.size = bytes.length;
  manifest.signature = signManifest(manifest, privateKey);
  const dataDir = path.join(root, 'data');
  const controller = createUpdater({
    currentVersion: '0.5.0',
    manifestUrl: 'https://example.test/latest.json',
    publicKey: publicPem,
    dataDir,
    targetRoot: path.join(root, 'target'),
    manifest,
    platform: 'win32',
    fetchImpl: async url => String(url).endsWith('latest.json')
      ? new Response(JSON.stringify(manifest), { status: 200, headers: { 'content-length': String(Buffer.byteLength(JSON.stringify(manifest))) } })
      : new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } }),
  });
  // check() passe par le manifeste simulé, puis prepare() télécharge l'archive.
  const checked = await controller.check();
  assert.equal(checked.state, 'available', checked.error);
  const prepared = await controller.prepare();
  assert.equal(prepared.size, bytes.length);
  assert.equal(fs.readFileSync(path.join(prepared.staged, 'resources', 'app', 'main.cjs'), 'utf8'), 'main');
  assert.equal(fs.existsSync(path.join(root, 'target', 'data')), false);
});
