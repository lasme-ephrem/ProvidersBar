'use strict';

// Packs de connecteurs : données signées (endpoints, version de parseur,
// stratégies) que l'on peut corriger sans reconstruire l'application. Le pack
// embarqué reste le repli ; un pack local signé peut le remplacer. Toute
// signature invalide, tout downgrade ou toute version d'application
// incompatible est refusé sans casser les connecteurs intégrés.

const fsDefault = require('node:fs/promises');
const pathDefault = require('node:path');
const { verify } = require('node:crypto');

const PACK_SCHEMA_VERSION = 1;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(value) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) return null;
  return value.split('.').map(Number);
}

function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

function canonicalPayload(pack) {
  const { signature, ...body } = pack || {};
  return JSON.stringify(canonicalValue(body));
}

function verifyPackSignature(pack, publicKey) {
  if (!pack || typeof pack !== 'object') return false;
  if (typeof pack.signature !== 'string' || !pack.signature) return false;
  try {
    return verify(null, Buffer.from(canonicalPayload(pack), 'utf8'), publicKey, Buffer.from(pack.signature, 'base64'));
  } catch {
    return false;
  }
}

function validatePack(pack, { appVersion, knownProviders } = {}) {
  const issues = [];
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return ['pack non objet'];
  if (pack.schemaVersion !== PACK_SCHEMA_VERSION) issues.push('schéma de pack inconnu');
  if (typeof pack.provider !== 'string' || !knownProviders?.has?.(pack.provider)) issues.push('fournisseur inconnu');
  if (!versionParts(pack.version)) issues.push('version de pack invalide');
  if (!versionParts(pack.minApp)) issues.push('version minimale invalide');
  else if (appVersion && compareVersions(pack.minApp, appVersion) > 0) issues.push('application trop ancienne pour ce pack');
  if (pack.expiresAt !== undefined && pack.expiresAt !== null) {
    const expires = Date.parse(pack.expiresAt);
    if (!Number.isFinite(expires)) issues.push('date d’expiration invalide');
    else if (expires <= Date.now()) issues.push('pack expiré');
  }
  if (pack.endpoint !== undefined) {
    try {
      const url = new URL(pack.endpoint);
      if (url.protocol !== 'https:' || url.username || url.password) issues.push('endpoint non HTTPS ou avec identifiants');
    } catch { issues.push('endpoint invalide'); }
  }
  if (pack.strategies !== undefined) {
    if (!Array.isArray(pack.strategies) || pack.strategies.some(item => typeof item !== 'string' || !item.trim())) {
      issues.push('stratégies invalides');
    }
  }
  if (pack.parserVersion !== undefined && (typeof pack.parserVersion !== 'string' || !pack.parserVersion.trim())) {
    issues.push('version de parseur invalide');
  }
  return issues;
}

async function readPackFile(file, fs) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    return { __readError: error.code === 'ENOENT' ? 'fichier absent' : 'JSON illisible' };
  }
}

async function loadPacks({
  dirs = [],
  publicKey,
  appVersion,
  providers = [],
  fs = fsDefault,
  path = pathDefault,
  allowUnsigned = false,
} = {}) {
  const knownProviders = new Set(providers);
  const packs = new Map();
  const errors = [];
  for (const dir of dirs) {
    if (!dir) continue;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (error.code !== 'ENOENT') errors.push({ file: path.basename(dir), reason: 'dossier illisible' });
      continue;
    }
    for (const entry of entries.filter(item => item.isFile() && item.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      const pack = await readPackFile(file, fs);
      const base = { file: entry.name };
      if (pack.__readError) { errors.push({ ...base, reason: pack.__readError }); continue; }
      const issues = validatePack(pack, { appVersion, knownProviders });
      if (issues.length) { errors.push({ ...base, provider: pack.provider || null, reason: issues.join(' ; ') }); continue; }
      if (!allowUnsigned && !verifyPackSignature(pack, publicKey)) {
        errors.push({ ...base, provider: pack.provider, reason: 'signature invalide' });
        continue;
      }
      const current = packs.get(pack.provider);
      // Le dernier dossier (local) gagne à version égale ; une version plus
      // ancienne ne peut jamais remplacer une version plus récente.
      if (current && compareVersions(pack.version, current.version) < 0) {
        errors.push({ ...base, provider: pack.provider, reason: 'version plus ancienne ignorée' });
        continue;
      }
      packs.set(pack.provider, pack);
    }
  }
  return { packs, errors };
}

function packFor(packs, provider) {
  return packs instanceof Map ? packs.get(provider) || null : null;
}

function packSummary(packs) {
  if (!(packs instanceof Map)) return [];
  return [...packs.values()].map(pack => ({
    provider: pack.provider,
    version: pack.version,
    parserVersion: pack.parserVersion || null,
    endpoint: pack.endpoint || null,
  }));
}

module.exports = {
  PACK_SCHEMA_VERSION,
  canonicalPayload,
  verifyPackSignature,
  validatePack,
  loadPacks,
  packFor,
  packSummary,
  compareVersions,
  versionParts,
};
