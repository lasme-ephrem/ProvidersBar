'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  compareVersions, canonicalPayload, validateManifest, verifyManifest, signManifest,
} = require('../lib/update-manifest.cjs');

function fixture(version = '0.6.0') {
  return {
    schemaVersion: 1,
    version,
    minApp: '0.5.0',
    publishedAt: '2026-11-05T10:00:00.000Z',
    notes: 'Mise à jour de test.',
    asset: {
      name: `LasmiumTokensHub-${version}-win32-x64.zip`,
      url: `https://github.com/lasme-ephrem/ProvidersBar/releases/download/v${version}/LasmiumTokensHub-${version}-win32-x64.zip`,
      sha256: 'a'.repeat(64),
      size: 123456,
    },
  };
}

test('le manifeste signé se vérifie et toute altération est refusée', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const manifest = fixture();
  manifest.signature = signManifest(manifest, privateKey);
  const result = verifyManifest(manifest, publicPem, { appVersion: '0.5.0', currentVersion: '0.5.0' });
  assert.equal(result.valid, true, result.issues.join(', '));
  const tampered = { ...manifest, version: '9.9.9' };
  assert.equal(verifyManifest(tampered, publicPem, { appVersion: '0.5.0' }).valid, false);
  const other = crypto.generateKeyPairSync('ed25519');
  assert.equal(verifyManifest(manifest, other.publicKey.export({ type: 'spki', format: 'pem' })).valid, false);
});

test('le payload canonique ne dépend pas de l’ordre des clés', () => {
  const a = { z: 1, a: { y: 2, x: [3, { b: 1, a: 2 }] } };
  const b = { a: { x: [3, { a: 2, b: 1 }], y: 2 }, z: 1 };
  assert.deepEqual(canonicalPayload(a), canonicalPayload(b));
});

test('les versions se comparent numériquement et les manifestes dangereux sont rejetés', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const badUrl = fixture();
  badUrl.asset.url = 'http://example.test/update.zip';
  badUrl.signature = signManifest(badUrl, privateKey);
  assert.equal(validateManifest(badUrl, { appVersion: '0.5.0' }).valid, false);
  const traversal = fixture();
  traversal.asset.name = '../../evil.zip';
  traversal.signature = signManifest(traversal, privateKey);
  assert.equal(validateManifest(traversal, { appVersion: '0.5.0' }).valid, false);
  const tooOld = fixture();
  tooOld.minApp = '9.0.0';
  tooOld.signature = signManifest(tooOld, privateKey);
  assert.equal(verifyManifest(tooOld, publicPem, { appVersion: '0.5.0' }).valid, false);
  assert.equal(verifyManifest({ ...fixture(), signature: signManifest(fixture(), privateKey) }, publicPem, { currentVersion: '0.6.0' }).valid, false);
});
