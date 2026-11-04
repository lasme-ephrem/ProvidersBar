'use strict';

// Sauvegardes rotatives de state.json. Elles sont indépendantes des migrations
// historiques : avant chaque écriture, si l'intervalle est écoulé, la version
// durable précédente est copiée dans dataDir/backups/. La restauration vérifie
// la forme du document et sauvegarde l'état courant avant remplacement.

const fsDefault = require('node:fs/promises');
const pathDefault = require('node:path');

const DEFAULT_KEEP = 5;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BACKUP_DIR = 'backups';
const NAME_PATTERN = /^state-\d{8}-\d{6}(?:-\d{3})?\.json$/;

function timestampName(now = Date.now()) {
  const date = new Date(now);
  const pad = value => String(value).padStart(2, '0');
  return `state-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    + `-${String(date.getMilliseconds()).padStart(3, '0')}.json`;
}

function createBackupManager({
  dataDir,
  fs = fsDefault,
  path = pathDefault,
  keep = DEFAULT_KEEP,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = Date.now,
  logger = console,
} = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('Dossier de données invalide.');
  const statePath = path.join(dataDir, 'state.json');
  const backupDir = path.join(dataDir, BACKUP_DIR);
  let lastAt = 0;
  let inFlight = null;

  async function ensureDir() {
    await fs.mkdir(backupDir, { recursive: true });
  }

  async function list() {
    try {
      const names = await fs.readdir(backupDir);
      return names.filter(name => NAME_PATTERN.test(name)).sort().reverse();
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function prune() {
    const names = await list();
    for (const name of names.slice(Math.max(1, keep))) {
      await fs.rm(path.join(backupDir, name), { force: true }).catch(() => {});
    }
  }

  async function maybeBackup(options = {}) {
    if (inFlight) return inFlight;
    inFlight = performBackup(options).finally(() => { inFlight = null; });
    return inFlight;
  }

  async function performBackup({ force = false, reason = 'auto' } = {}) {
    const stamp = now();
    if (!force && lastAt && stamp - lastAt < intervalMs) return null;
    let stat;
    try { stat = await fs.stat(statePath); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.size === 0) return null;
    await ensureDir();
    const name = timestampName(stamp);
    const target = path.join(backupDir, name);
    // Copie, jamais déplacement : l'état durable reste en place.
    await fs.copyFile(statePath, target);
    await fs.chmod(target, 0o600).catch(() => {});
    lastAt = stamp;
    await prune();
    logger?.info?.(`Sauvegarde d'état créée (${reason}) : ${name}`);
    return name;
  }

  function validateState(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Sauvegarde invalide.');
    if (!Array.isArray(document.providers) || !Array.isArray(document.history) || !document.settings || typeof document.settings !== 'object') {
      throw new Error('Sauvegarde incomplète : inventaire, historique ou réglages manquant.');
    }
    return document;
  }

  async function read(name) {
    if (!NAME_PATTERN.test(String(name))) throw new Error('Nom de sauvegarde invalide.');
    const body = await fs.readFile(path.join(backupDir, name), 'utf8');
    let document;
    try { document = JSON.parse(body); } catch { throw new Error('Sauvegarde illisible.'); }
    return validateState(document);
  }

  async function restore(name) {
    const document = await read(name);
    // L'état courant est d'abord sauvegardé : une restauration ne détruit rien.
    await maybeBackup({ force: true, reason: 'before-restore' });
    const temp = `${statePath}.restore.tmp`;
    await fs.writeFile(temp, JSON.stringify(document, null, 2), { mode: 0o600 });
    await fs.rename(temp, statePath);
    return document;
  }

  return { backupDir, maybeBackup, list, read, restore, prune };
}

module.exports = {
  BACKUP_DIR, DEFAULT_KEEP, DEFAULT_INTERVAL_MS, timestampName, createBackupManager,
};
