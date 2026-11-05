'use strict';
// Lancement au démarrage : une seule écriture (Electron), partagée par les
// Réglages et l'installeur ; démarrage discret dans la zone de notification.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HIDDEN_ARG, autostartCommand, startsHidden, createAutostart } = require('../lib/autostart.cjs');

function fakeApp({ packaged = true, willLaunch } = {}) {
  const calls = [];
  let registered = false;
  return {
    calls,
    isPackaged: packaged,
    getLoginItemSettings: options => {
      calls.push(['get', options]);
      return { openAtLogin: registered, executableWillLaunchAtLogin: willLaunch ?? registered };
    },
    setLoginItemSettings: options => { calls.push(['set', options]); registered = options.openAtLogin; },
  };
}

test('la ligne de commande de l’installeur active ou retire le lancement au démarrage', () => {
  assert.equal(autostartCommand(['exe', '--autostart=on']), true);
  assert.equal(autostartCommand(['exe', '--autostart=off']), false);
  assert.equal(autostartCommand(['exe', '--hidden']), null);
  assert.throws(() => autostartCommand(['exe', '--autostart=peut-être']), /invalide/);
  assert.equal(startsHidden(['exe', HIDDEN_ARG]), true);
  assert.equal(startsHidden(['exe']), false);
});

test('l’application installée s’inscrit avec --hidden et relit l’état réel de Windows', () => {
  const app = fakeApp();
  const autostart = createAutostart({ app, platform: 'win32', execPath: 'C:/Apps/LasmiumTokensHub.exe' });
  assert.deepEqual(autostart.info(), { supported: true, enabled: false });
  assert.deepEqual(autostart.set(true), { supported: true, enabled: true });
  assert.deepEqual(app.calls.find(call => call[0] === 'set')[1],
    { path: 'C:/Apps/LasmiumTokensHub.exe', args: ['--hidden'], openAtLogin: true, enabled: true });
  assert.deepEqual(autostart.set(false), { supported: true, enabled: false });
  assert.throws(() => autostart.set('oui'), /invalide/);
  // Désactivé dans le Gestionnaire des tâches : affiché comme désactivé.
  const disabled = createAutostart({ app: fakeApp({ willLaunch: false }), platform: 'win32', execPath: 'x.exe' });
  disabled.set(true);
  assert.equal(disabled.info().enabled, false);
});

test('en développement ou hors Windows, rien n’est écrit', () => {
  for (const [packaged, platform] of [[false, 'win32'], [true, 'linux']]) {
    const app = fakeApp({ packaged });
    const autostart = createAutostart({ app, platform });
    assert.deepEqual(autostart.info(), { supported: false, enabled: false });
    assert.throws(() => autostart.set(true), /application installée/);
    assert.deepEqual(app.calls, []);
  }
});
