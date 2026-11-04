'use strict';

// Manifeste de mise à jour signé. Le payload signé est le JSON canonique
// (clés d'objet triées) privé de son champ `signature`. Aucune donnée non
// vérifiée ne doit être utilisée pour télécharger ou remplacer l'application.

const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const MAX_ASSET_BYTES = 600 * 1024 * 1024;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function versionParts(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) return null;
  return value.split('.').map(Number);
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) throw new Error('Version invalide.');
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function isNewer(candidate, current) {
  try { return compareVersions(candidate, current) > 0; } catch { return false; }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

function canonicalPayload(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Manifeste invalide.');
  const { signature: _signature, ...payload } = manifest;
  return Buffer.from(JSON.stringify(canonicalize(payload)), 'utf8');
}

function validateManifest(manifest, { appVersion } = {}) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, issues: ['manifeste absent ou non objet'] };
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) issues.push('schéma de manifeste inconnu');
  if (!versionParts(manifest.version)) issues.push('version invalide');
  if (!versionParts(manifest.minApp)) issues.push('version minimale invalide');
  else if (appVersion && versionParts(appVersion) && compareVersions(manifest.minApp, appVersion) > 0) {
    issues.push('application trop ancienne pour cette mise à jour');
  }
  if (Number.isNaN(Date.parse(manifest.publishedAt))) issues.push('date de publication invalide');
  if (manifest.notes !== undefined && (typeof manifest.notes !== 'string' || manifest.notes.length > 5000)) {
    issues.push('notes invalides');
  }
  if (!manifest.asset || typeof manifest.asset !== 'object' || Array.isArray(manifest.asset)) issues.push('asset absent');
  else {
    const asset = manifest.asset;
    try {
      const url = new URL(asset.url);
      if (url.protocol !== 'https:' || url.username || url.password) issues.push('URL d’archive non HTTPS ou avec identifiants');
    } catch { issues.push('URL d’archive invalide'); }
    if (typeof asset.sha256 !== 'string' || !SHA256_PATTERN.test(asset.sha256.toLowerCase())) issues.push('SHA-256 invalide');
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES) issues.push('taille d’archive invalide');
    if (typeof asset.name !== 'string' || asset.name !== require('node:path').basename(asset.name)
      || !/\.zip$/i.test(asset.name) || asset.name.length > 200) issues.push('nom d’archive invalide');
  }
  if (typeof manifest.signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(manifest.signature)) issues.push('signature absente ou invalide');
  return { valid: issues.length === 0, issues };
}

function verifyManifest(manifest, publicKey, options = {}) {
  const validation = validateManifest(manifest, options);
  if (!validation.valid) return { valid: false, issues: validation.issues };
  let verified = false;
  try {
    verified = crypto.verify(null, canonicalPayload(manifest), publicKey, Buffer.from(manifest.signature, 'base64'));
  } catch {
    verified = false;
  }
  if (!verified) return { valid: false, issues: ['signature Ed25519 invalide'] };
  if (options.currentVersion && !isNewer(manifest.version, options.currentVersion)) {
    return { valid: false, issues: ['version déjà installée ou plus récente que la version proposée'] };
  }
  return { valid: true, issues: [] };
}

function signManifest(manifest, privateKey) {
  const payload = canonicalPayload(manifest);
  return crypto.sign(null, payload, privateKey).toString('base64');
}

module.exports = {
  SCHEMA_VERSION,
  MAX_ASSET_BYTES,
  versionParts,
  compareVersions,
  isNewer,
  canonicalize,
  canonicalPayload,
  validateManifest,
  verifyManifest,
  signManifest,
};
