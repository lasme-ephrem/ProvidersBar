'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findPackageRoot, buildWindowsInstallScript } = require('../lib/update-install.cjs');
const { execFileSync } = require('node:child_process');

test('la racine du paquet est trouvée et une archive avec data/ est refusée', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lasmium-stage-'));
  const pkg = path.join(root, 'LasmiumTokensHub-0.6.0-win32-x64');
  fs.mkdirSync(path.join(pkg, 'resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'LasmiumTokensHub.exe'), 'exe');
  fs.writeFileSync(path.join(pkg, 'resources', 'app', 'main.cjs'), 'main');
  assert.equal(await findPackageRoot(root), pkg);
  fs.mkdirSync(path.join(pkg, 'data'));
  await assert.rejects(findPackageRoot(root), /data interdit/);
});

test('le script PowerShell échappe les chemins et refuse une cible incluse dans le staging', () => {
  const script = buildWindowsInstallScript({
    stagedRoot: path.join(os.tmpdir(), "stage-l'été"),
    targetRoot: path.join(os.tmpdir(), 'target'),
    appPid: 1234,
    logPath: path.join(os.tmpdir(), 'update.log'),
  });
  assert.match(script, /\$appPid = 1234/);
  assert.match(script, /stage-l''été/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /Start-Process/);
  // PowerShell traite les guillemets typographiques comme des délimiteurs de chaîne.
  assert.doesNotMatch(script, /[\u2018\u2019\u201C\u201D]/);
  assert.throws(() => buildWindowsInstallScript({
    stagedRoot: path.join(os.tmpdir(), 'target', 'stage'),
    targetRoot: path.join(os.tmpdir(), 'target'),
    appPid: 1,
    logPath: 'log',
  }), /hors du dossier portable/);
  const portable = path.join(os.tmpdir(), 'portable-data');
  assert.match(buildWindowsInstallScript({
    stagedRoot: path.join(portable, 'data', 'updates', '0.6.2', 'staging'),
    targetRoot: portable,
    appPid: 1,
    logPath: path.join(portable, 'data', 'update.log'),
  }), /Copy-Item/);
  assert.throws(() => buildWindowsInstallScript({
    stagedRoot: path.join(os.tmpdir(), 'staging-parent'),
    targetRoot: path.join(os.tmpdir(), 'staging-parent', 'portable'),
    appPid: 1,
    logPath: 'log',
  }), /incluse dans le dossier préparé/);
});


test('le script d’installation remplace l’application et préserve data/', { skip: process.platform !== 'win32', timeout: 30000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lasmium-install-'));
  const target = path.join(root, 'portable');
  const staged = path.join(root, 'staged');
  fs.mkdirSync(path.join(target, 'resources', 'app'), { recursive: true });
  fs.mkdirSync(path.join(target, 'data'), { recursive: true });
  fs.writeFileSync(path.join(target, 'LasmiumTokensHub.exe'), 'old-exe');
  fs.writeFileSync(path.join(target, 'resources', 'app', 'main.cjs'), 'old-main');
  fs.writeFileSync(path.join(target, 'data', 'state.json'), 'précieux');
  fs.mkdirSync(path.join(staged, 'resources', 'app'), { recursive: true });
  fs.copyFileSync('C:\\Windows\\System32\\where.exe', path.join(staged, 'LasmiumTokensHub.exe'));
  fs.writeFileSync(path.join(staged, 'resources', 'app', 'main.cjs'), 'new-main');
  const scriptPath = path.join(root, 'install.ps1');
  fs.writeFileSync(scriptPath, buildWindowsInstallScript({
    stagedRoot: staged,
    targetRoot: target,
    appPid: 2147483647,
    logPath: path.join(target, 'data', 'updates', 'update.log'),
  }));
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { timeout: 20000 });
  assert.equal(fs.readFileSync(path.join(target, 'resources', 'app', 'main.cjs'), 'utf8'), 'new-main');
  assert.equal(fs.readFileSync(path.join(target, 'data', 'state.json'), 'utf8'), 'précieux');
  assert.ok(fs.existsSync(path.join(target, 'data', 'updates', 'install.started')));
  assert.ok(fs.readdirSync(path.join(target, 'resources')).some(name => name.startsWith('app.rollback-')));
});
