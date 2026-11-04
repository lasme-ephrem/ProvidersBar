'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, sign } = require('node:crypto');
const {
  canonicalPayload, verifyPackSignature, validatePack, loadPacks, compareVersions,
} = require('../lib/connector-packs.cjs');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

function pack(overrides = {}) {
  return {
    schemaVersion: 1,
    provider: 'openrouter',
    version: '2026.11.1',
    minApp: '0.4.0',
    parserVersion: 'openrouter-api-v1',
    strategies: ['api-key'],
    endpoint: 'https://openrouter.ai/api/v1/credits',
    ...overrides,
  };
}
function signed(value) {
  const { signature, ...body } = value;
  return { ...body, signature: sign(null, Buffer.from(canonicalPayload(body), 'utf8'), privateKey).toString('base64') };
}
async function writePack(dir, name, value) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), JSON.stringify(value, null, 2));
}
async function withDirs(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-pack-'));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('un pack signé valide est chargé et sa signature est vérifiable', () => {
  const value = signed(pack());
  assert.equal(verifyPackSignature(value, publicPem), true);
  assert.deepEqual(validatePack(value, { appVersion: '0.4.0', knownProviders: new Set(['openrouter']) }), []);
  assert.equal(compareVersions('2026.11.1', '2026.11.0'), 1);
});

test('tamper, signature absente, endpoint non HTTPS et minApp futur sont refusés', async () => withDirs(async root => {
  const bundled = path.join(root, 'bundled');
  const valid = signed(pack());
  await writePack(bundled, 'valid.json', valid);
  const tampered = { ...valid, endpoint: 'https://evil.example/credits' };
  await writePack(bundled, 'tampered.json', tampered);
  await writePack(bundled, 'unsigned.json', pack());
  await writePack(bundled, 'http.json', signed(pack({ provider: 'deepseek', endpoint: 'http://api.deepseek.com/user/balance' })));
  await writePack(bundled, 'future.json', signed(pack({ provider: 'runinfra', minApp: '9.0.0' })));
  const result = await loadPacks({
    dirs: [bundled], publicKey: publicPem, appVersion: '0.4.0',
    providers: ['openrouter', 'deepseek', 'runinfra'],
  });
  assert.deepEqual([...result.packs.keys()], ['openrouter']);
  assert.equal(result.errors.length, 4);
  assert.ok(result.errors.some(error => /signature/.test(error.reason)));
  assert.ok(result.errors.some(error => /HTTPS/.test(error.reason)));
  assert.ok(result.errors.some(error => /trop ancienne/.test(error.reason)));
}));

test('le pack local signé gagne à version égale et un downgrade est ignoré', async () => withDirs(async root => {
  const bundled = path.join(root, 'bundled');
  const local = path.join(root, 'local');
  await writePack(bundled, 'openrouter.json', signed(pack({ endpoint: 'https://bundled.example/credits' })));
  await writePack(local, 'openrouter.json', signed(pack({ endpoint: 'https://local.example/credits' })));
  await writePack(bundled, 'deepseek.json', signed(pack({ provider: 'deepseek', version: '2026.11.2' })));
  await writePack(local, 'deepseek.json', signed(pack({ provider: 'deepseek', version: '2026.11.1' })));
  const result = await loadPacks({
    dirs: [bundled, local], publicKey: publicPem, appVersion: '0.4.0',
    providers: ['openrouter', 'deepseek'],
  });
  assert.equal(result.packs.get('openrouter').endpoint, 'https://local.example/credits');
  assert.equal(result.packs.get('deepseek').version, '2026.11.2');
  assert.ok(result.errors.some(error => /plus ancienne/.test(error.reason)));
}));

test('le mode développement peut charger un pack non signé, jamais par défaut', async () => withDirs(async root => {
  await writePack(root, 'openrouter.json', pack());
  const strict = await loadPacks({ dirs: [root], publicKey: publicPem, appVersion: '0.4.0', providers: ['openrouter'] });
  assert.equal(strict.packs.size, 0);
  const dev = await loadPacks({ dirs: [root], publicKey: publicPem, appVersion: '0.4.0', providers: ['openrouter'], allowUnsigned: true });
  assert.equal(dev.packs.size, 1);
}));
