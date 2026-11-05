'use strict';

// Lancement au démarrage de Windows. Une seule écriture, celle d'Electron
// (valeur de registre HKCU\…\Run nommée d'après l'AppUserModelId) : la case
// des Réglages et l'installeur passent tous deux par ici. L'installeur lance
// `LasmiumTokensHub.exe --autostart=on|off`, qui applique le choix puis quitte.
// Au démarrage de Windows, l'application s'ouvre discrètement (--hidden) dans
// la zone de notification.

const HIDDEN_ARG = '--hidden';
const COMMAND_PREFIX = '--autostart=';

// Valeur demandée en ligne de commande (`on`/`off`), sinon null.
function autostartCommand(argv = process.argv) {
  const arg = argv.find(item => typeof item === 'string' && item.startsWith(COMMAND_PREFIX));
  if (!arg) return null;
  const value = arg.slice(COMMAND_PREFIX.length);
  if (value !== 'on' && value !== 'off') throw new Error(`Valeur de --autostart invalide : ${value}`);
  return value === 'on';
}

function startsHidden(argv = process.argv) {
  return argv.includes(HIDDEN_ARG);
}

function createAutostart({ app, platform = process.platform, execPath = process.execPath }) {
  // En développement, le chemin serait celui d'electron.exe sans l'application.
  const supported = platform === 'win32' && Boolean(app?.isPackaged);
  const options = { path: execPath, args: [HIDDEN_ARG] };

  function info() {
    if (!supported) return { supported: false, enabled: false };
    const settings = app.getLoginItemSettings(options);
    // executableWillLaunchAtLogin tient compte d'une désactivation dans le
    // Gestionnaire des tâches (onglet Démarrage).
    return { supported: true, enabled: Boolean(settings.executableWillLaunchAtLogin ?? settings.openAtLogin) };
  }

  function set(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Valeur de lancement au démarrage invalide.');
    if (!supported) throw new Error('Le lancement au démarrage est disponible dans l’application installée.');
    app.setLoginItemSettings({ ...options, openAtLogin: enabled, enabled });
    return info();
  }

  return { supported, info, set };
}

module.exports = { HIDDEN_ARG, autostartCommand, startsHidden, createAutostart };
