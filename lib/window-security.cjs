// Durcissement des fenêtres Electron et hygiène du dossier de données.
// Ce module n'importe pas Electron : il n'utilise que l'API des objets fenêtre et
// du système de fichiers, ce qui le rend testable sous `node --test` sans session
// graphique et sans processus principal.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

// Seule origine tierce tolérée par défaut : la connexion Google commune aux
// comptes web. Toute liste réellement utilisée est fournie par main.cjs.
const DEFAULT_ACCOUNT_ORIGINS = Object.freeze(['https://accounts.google.com']);

function originOf(value) {
  try { return new URL(String(value)).origin; } catch { return null; }
}

function normalizeAllowlist(origins) {
  const allowlist = new Set();
  for (const value of origins || []) {
    const origin = originOf(value);
    if (origin && origin.startsWith('https://')) allowlist.add(origin);
  }
  return allowlist;
}

function isAllowedOrigin(value, allowlist) {
  const origin = originOf(value);
  return Boolean(origin && origin.startsWith('https://') && allowlist instanceof Set && allowlist.has(origin));
}

// Fenêtres applicatives : aucune navigation, aucune popup, aucune permission.
function secureWindow(win) {
  if (!win || typeof win !== 'object' || !win.webContents) return win;
  const contents = win.webContents;
  contents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  contents.on?.('will-navigate', event => event?.preventDefault?.());
  const webSession = contents.session;
  webSession?.setPermissionRequestHandler?.((_contents, _permission, callback) => callback(false));
  webSession?.setPermissionCheckHandler?.(() => false);
  // Les fenêtres UI sont créées avec devTools:false ; ce garde-fou couvre les
  // fenêtres ouvertes par un autre chemin dans le futur.
  contents.on?.('devtools-opened', () => contents.closeDevTools?.());
  return win;
}

// Fenêtres de connexion aux fournisseurs : navigation, redirections et popups
// limitées à une liste d'origines explicite (et jamais à « n'importe quel HTTPS »).
function secureAccountWindow(win, allowedOrigins = DEFAULT_ACCOUNT_ORIGINS) {
  const allowlist = normalizeAllowlist(allowedOrigins instanceof Set ? [...allowedOrigins] : allowedOrigins);
  const secured = new WeakSet();
  const apply = target => {
    if (!target || typeof target !== 'object' || !target.webContents || secured.has(target)) return;
    secured.add(target);
    const contents = target.webContents;
    contents.on?.('will-navigate', (event, url) => { if (!isAllowedOrigin(url, allowlist)) event?.preventDefault?.(); });
    contents.on?.('will-redirect', (event, url) => { if (!isAllowedOrigin(url, allowlist)) event?.preventDefault?.(); });
    contents.setWindowOpenHandler?.(({ url }) => (isAllowedOrigin(url, allowlist)
      ? {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            session: contents.session, nodeIntegration: false, contextIsolation: true,
            sandbox: true, webSecurity: true, devTools: false,
          },
        },
      }
      : { action: 'deny' }));
    contents.on?.('did-create-window', child => apply(child));
  };
  apply(win);
  return win;
}

function currentWindowsAccount() {
  const user = process.env.USERNAME || os.userInfo().username;
  const domain = process.env.USERDOMAIN;
  return domain && domain !== os.hostname() ? `${domain}\\${user}` : user;
}

function runIcacls(args) {
  return new Promise((resolve, reject) => {
    execFile('icacls', args, { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

// Restreint l'héritage ACL du dossier de données à l'utilisateur courant et à
// SYSTEM. Un échec est un avertissement : il ne bloque jamais le démarrage.
async function applyDataDirAcl(dataDir, {
  platform = process.platform, run = runIcacls, account = currentWindowsAccount(), logger = console,
} = {}) {
  if (platform !== 'win32') return { ok: false, skipped: true, dataDir, reason: 'hors Windows' };
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('Dossier de données invalide.');
  const grants = [`${account}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'];
  const args = [dataDir, '/inheritance:r', '/grant:r', ...grants];
  try {
    await run(args);
    return { ok: true, dataDir, account, grants };
  } catch (error) {
    const warning = `ACL du dossier de données non restreinte (${error.message.trim?.() || error.message}).`;
    logger?.warn?.(warning);
    return { ok: false, dataDir, account, warning };
  }
}

async function fileTime(file) {
  try { return (await fs.stat(file)).mtimeMs; } catch { return null; }
}

const BACKUP_PATTERN = /^state\.before-.*\.json$/;

// Nettoie les restes d'exécutions précédentes : fichiers `.tmp` interrompus,
// port de diagnostic obsolète, sauvegardes de migration en surnombre et profils
// de navigateur temporaires. Ne supprime jamais l'état ni les identifiants.
async function purgeLeftovers(dataDir, {
  keepBackups = 2, preserveDevToolsPort = false, sweepTemporaryProfiles = null, logger = console,
} = {}) {
  const summary = { removed: [], keptBackups: 0, warnings: [] };
  if (typeof dataDir !== 'string' || !dataDir) return summary;

  let entries;
  try { entries = await fs.readdir(dataDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code !== 'ENOENT') summary.warnings.push(`Dossier de données illisible : ${error.message}`);
    return summary;
  }

  const removeEntry = async name => {
    try {
      await fs.rm(path.join(dataDir, name), { recursive: true, force: true });
      summary.removed.push(name);
    } catch (error) {
      summary.warnings.push(`${name} non supprimé : ${error.message}`);
    }
  };

  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile?.()) continue;
    if (entry.name.endsWith('.tmp')) await removeEntry(entry.name);
    else if (entry.name === 'DevToolsActivePort' && !preserveDevToolsPort) await removeEntry(entry.name);
    else if (BACKUP_PATTERN.test(entry.name)) backups.push(entry.name);
  }

  const limit = Math.max(0, Number.isInteger(keepBackups) ? keepBackups : 2);
  const dated = [];
  for (const name of backups) {
    const time = await fileTime(path.join(dataDir, name));
    if (time !== null) dated.push({ name, time });
  }
  dated.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  summary.keptBackups = Math.min(limit, dated.length);
  for (const item of dated.slice(limit)) await removeEntry(item.name);

  // Les profils temporaires relèvent du module de session quand il les expose
  // (contrat §3.4) ; à défaut, le dossier orphelin est supprimé ici.
  if (typeof sweepTemporaryProfiles === 'function') {
    try { await sweepTemporaryProfiles(dataDir); }
    catch (error) { summary.warnings.push(`Profils temporaires non purgés : ${error.message}`); }
  } else {
    const temporary = path.join(dataDir, 'temporary-account-browsers');
    try {
      if ((await fs.stat(temporary)).isDirectory()) await removeEntry('temporary-account-browsers');
    } catch (error) {
      if (error.code !== 'ENOENT') summary.warnings.push(`Profils temporaires non purgés : ${error.message}`);
    }
  }

  for (const warning of summary.warnings) logger?.warn?.(warning);
  return summary;
}

module.exports = {
  DEFAULT_ACCOUNT_ORIGINS, originOf, normalizeAllowlist, isAllowedOrigin,
  secureWindow, secureAccountWindow, applyDataDirAcl, purgeLeftovers,
};
