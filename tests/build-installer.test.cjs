'use strict';
// Installeur Windows : recherche d'Inno Setup et empreinte ajoutée à SHA256SUMS
// sans écraser celle du ZIP (lue par release:verify et par l'utilisateur).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findIscc, isccCandidates, upsertSum } = require('../scripts/build-installer.cjs');

const root = path.resolve(__dirname, '..');

test('findIscc cherche ISCC, Program Files, l’installation par utilisateur puis le PATH', () => {
  const env = { ISCC: 'D:/outils/ISCC.exe', 'ProgramFiles(x86)': 'C:/PF86', ProgramFiles: 'C:/PF', LOCALAPPDATA: 'C:/Users/moi/AppData/Local', PATH: 'C:/bin' };
  assert.deepEqual(isccCandidates(env), ['D:/outils/ISCC.exe', path.join('C:/PF86', 'Inno Setup 6', 'ISCC.exe'),
    path.join('C:/PF', 'Inno Setup 6', 'ISCC.exe'), path.join('C:/Users/moi/AppData/Local', 'Programs', 'Inno Setup 6', 'ISCC.exe'), path.join('C:/bin', 'ISCC.exe')]);
  const perUser = path.join('C:/Users/moi/AppData/Local', 'Programs', 'Inno Setup 6', 'ISCC.exe');
  assert.equal(findIscc({ ...env, ISCC: undefined }, file => file === perUser), perUser);
  assert.throws(() => findIscc({}, () => false), /Inno Setup 6 introuvable.*winget install JRSoftware\.InnoSetup/);
});

test('upsertSum ajoute ou remplace la ligne de l’installeur et garde celle du ZIP', () => {
  const zip = `${'a'.repeat(64)}  LasmiumTokensHub-1.2.3-win32-x64.zip\n`;
  const once = upsertSum(zip, 'b'.repeat(64), 'LasmiumTokensHub-Setup-1.2.3.exe');
  assert.equal(once, `${'a'.repeat(64)}  LasmiumTokensHub-1.2.3-win32-x64.zip\n${'b'.repeat(64)}  LasmiumTokensHub-Setup-1.2.3.exe\n`);
  assert.equal(upsertSum(once, 'c'.repeat(64), 'LasmiumTokensHub-Setup-1.2.3.exe').split('\n').filter(Boolean).length, 2, 'reconstruction : une seule ligne par fichier');
  assert.equal(upsertSum('', 'd'.repeat(64), 'x.exe'), `${'d'.repeat(64)}  x.exe\n`);
});

test('le script Inno Setup installe par utilisateur, sans administrateur, avec le lancement au démarrage optionnel', () => {
  const iss = fs.readFileSync(path.join(root, 'installer', 'LasmiumTokensHub.iss'), 'utf8');
  for (const line of ['PrivilegesRequired=lowest', String.raw`DefaultDirName={localappdata}\Programs\LasmiumTokensHub`,
    'Parameters: "--autostart=on"; Tasks: autostart', 'Parameters: "--autostart=off"; Flags: runhidden waituntilterminated; RunOnceId',
    'AppUserModelID: "com.lasmium.tokenshub"', String.raw`MessagesFile: "compiler:Languages\French.isl"`, 'CloseApplications=force']) {
    assert.ok(iss.includes(line), line);
  }
  assert.doesNotMatch(iss, /[\u2018\u2019\u201C\u201D\t]/, 'aucun guillemet typographique ni tabulation');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  assert.match(main, /setAppUserModelId\('com\.lasmium\.tokenshub'\)/, 'même identifiant que les raccourcis de l’installeur');
});
