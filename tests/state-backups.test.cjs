'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSeed } = require('../lib/seed.cjs');
const { createBackupManager, timestampName } = require('../lib/state-backups.cjs');

async function withDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-backup-'));
  try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
async function writeState(dir, state) {
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
}

test('les sauvegardes sont rotatives, nommées et conservent l’état durable', async () => withDir(async dir => {
  const state = createSeed();
  await writeState(dir, state);
  let clock = Date.parse('2026-11-04T01:00:00.000Z');
  const manager = createBackupManager({ dataDir: dir, now: () => clock, intervalMs: 1000, keep: 3 });
  assert.match(await manager.maybeBackup(), /^state-\d{8}-\d{6}-\d{3}\.json$/);
  assert.equal(await fs.readFile(path.join(dir, 'state.json'), 'utf8'), JSON.stringify(state, null, 2));
  assert.equal(await manager.maybeBackup(), null);
  clock += 2000;
  await manager.maybeBackup({ force: true });
  clock += 2000;
  await manager.maybeBackup({ force: true });
  clock += 2000;
  await manager.maybeBackup({ force: true });
  const names = await manager.list();
  assert.equal(names.length, 3);
  assert.ok(names.every(name => /^state-\d{8}-\d{6}-\d{3}\.json$/.test(name)));
  assert.match(timestampName(Date.parse('2026-11-04T01:00:00.000Z')), /^state-\d{8}-\d{6}-\d{3}\.json$/);
}));

test('la restauration valide, sauvegarde l’état courant et refuse un nom traversant', async () => withDir(async dir => {
  const first = createSeed();
  first.providers[0].notes = 'version restaurée';
  await writeState(dir, first);
  const manager = createBackupManager({ dataDir: dir, keep: 5 });
  const name = await manager.maybeBackup({ force: true });
  await writeState(dir, { ...createSeed(), providers: [] });
  const restored = await manager.restore(name);
  assert.equal(restored.providers[0].notes, 'version restaurée');
  assert.equal((await manager.list()).length, 2, 'la restauration crée une sauvegarde de l’état courant');
  await assert.rejects(manager.restore('../state.json'), /Nom de sauvegarde invalide/);
  await assert.rejects(manager.restore('state-20990101-000000-000.json'), /ENOENT|illisible/);
}));

test('une sauvegarde incomplète est refusée sans toucher à l’état', async () => withDir(async dir => {
  await writeState(dir, createSeed());
  const manager = createBackupManager({ dataDir: dir });
  await fs.mkdir(manager.backupDir, { recursive: true });
  await fs.writeFile(path.join(manager.backupDir, 'state-20261104-000000-000.json'), JSON.stringify({ providers: [] }));
  await assert.rejects(manager.restore('state-20261104-000000-000.json'), /Sauvegarde incomplète/);
  assert.equal((await manager.list()).length, 1);
}));
