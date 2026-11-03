// Claude Desktop writes aggregate plan usage to this local history. Read only
// the two percentages: never inspect credentials, conversations or app storage.
const fs = require('node:fs/promises');
const fileEvents = require('node:fs');
const path = require('node:path');

const MAX_AGE_MS = 45 * 60 * 1000;
const MAX_FILE_BYTES = 1024 * 1024;
const CLAUDE_DATA_DIR = 'Claude-Data';
const USAGE_FILE = 'plan-usage-history.json';

// Current Claude Desktop builds keep one profile per instance under
// %LOCALAPPDATA%\Claude-Data\<instance>\. Only the documented aggregate usage
// file is ever selected: never another file from those profiles.
function claudeDataPaths(localAppData) {
  if (!localAppData) return [];
  const root = path.join(localAppData, CLAUDE_DATA_DIR);
  let entries;
  try { entries = fileEvents.readdirSync(root, { withFileTypes: true }); }
  catch { return []; } // absent directory: the older layouts may still apply
  return entries
    .filter(entry => entry && entry.isDirectory() && typeof entry.name === 'string' && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => path.join(root, entry.name, USAGE_FILE));
}

function usagePaths(localAppData = process.env.LOCALAPPDATA, roamingAppData = process.env.APPDATA) {
  const paths = [];
  if (localAppData) {
    // Historical layout kept for older Claude Desktop installations.
    paths.push(path.join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', USAGE_FILE));
    paths.push(...claudeDataPaths(localAppData));
  }
  if (roamingAppData) paths.push(path.join(roamingAppData, 'Claude', USAGE_FILE));
  return [...new Set(paths)];
}

function parseClaudeDesktopUsage(history, previous = null, now = new Date(), { allowStale = false } = {}) {
  const time = now.getTime();
  if (!Number.isFinite(time) || history?.version !== 2 || !Array.isArray(history.samples) || !history.samples.length) {
    throw new Error('Le format du relevé local de Claude Desktop a changé. Aucun quota estimé ne sera affiché.');
  }
  const sample = history.samples.at(-1);
  const used = sample?.u;
  if (!Number.isSafeInteger(sample?.t) || sample.t > time + 120000 || !used ||
      !['fh', 'sd'].every(key => typeof used[key] === 'number' && Number.isFinite(used[key]) && used[key] >= 0 && used[key] <= 100)) {
    throw new Error('Le dernier relevé local de Claude Desktop est incomplet.');
  }
  const stale = time - sample.t > MAX_AGE_MS;
  // Mode Desktop direct : un relevé de plus de 45 minutes reste une erreur.
  // Repli explicite : on peut afficher la dernière mesure honnête, datée et
  // marquée comme ancienne, plutôt que de laisser l'utilisateur sans données.
  if (stale && !allowStale) {
    throw new Error('Relevé Claude Desktop ancien : aucun nouveau quota depuis plus de 45 minutes. Claude peut suspendre ses relevés même ouvert. Ouvre son menu près de l’horloge ou sa page Utilisation pour relancer l’actualisation ; ProvidersBar récupérera le prochain relevé automatiquement.');
  }
  if (previous?.updatedAt && Date.parse(previous.updatedAt) > sample.t) {
    throw new Error('Le relevé local de Claude Desktop est plus ancien que le dernier quota connu.');
  }
  const remaining = value => Math.round((100 - value) * 100) / 100;
  const knownReset = (label, maxMs) => {
    const resetAt = previous?.quotaWindows?.find(window => window.label === label)?.resetAt;
    const resetTime = Date.parse(resetAt);
    return Number.isFinite(resetTime) && resetTime > time && resetTime - time <= maxMs ? new Date(resetTime).toISOString() : null;
  };
  const windows = [
    { label: '5 heures', remaining: remaining(used.fh), resetAt: knownReset('5 heures', 5.5 * 3600000) },
    { label: 'Semaine', remaining: remaining(used.sd), resetAt: knownReset('Semaine', 7 * 86400000) },
  ];
  const tightest = windows.reduce((a, b) => a.remaining <= b.remaining ? a : b);
  return { source: 'api', connectorVersion: 'claude-desktop-local-v1', updatedAt: new Date(sample.t).toISOString(),
    balances: [], quotaRemaining: tightest.remaining, resetAt: tightest.resetAt, quotaWindows: windows,
    ...(stale ? { stale: true } : {}),
    quotaLabel: `Claude · ${tightest.label} · Claude Desktop${stale ? ' (relevé ancien)' : ''}` };
}

async function readClaudeDesktopUsage(previous = null, options = {}) {
  const histories = [];
  let readError;
  for (const candidate of usagePaths(options.localAppData, options.roamingAppData)) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Le relevé local de Claude Desktop est invalide.');
      const history = JSON.parse(await fs.readFile(candidate, 'utf8'));
      histories.push(history);
    } catch (error) {
      if (error.code !== 'ENOENT') readError = error;
    }
  }
  if (!histories.length) throw new Error(readError ? 'Le relevé local de Claude Desktop est illisible.' : 'Aucun relevé local trouvé. Ouvre Claude Desktop et sa page Utilisation (dossier Claude-Data), puis réessaie.');
  histories.sort((a, b) => (b?.samples?.at(-1)?.t || 0) - (a?.samples?.at(-1)?.t || 0));
  const now = options.now || new Date();
  const allowStale = options.allowStale === true;
  // A newer file may be unreadable after a Claude Desktop update. Fall back to
  // the other installed profile instead of declaring the whole source broken.
  let firstError = null;
  for (const history of histories) {
    try { return parseClaudeDesktopUsage(history, previous, now, { allowStale }); }
    catch (error) { firstError ||= error; }
  }
  throw firstError || new Error('Aucun relevé local exploitable. Ouvre Claude Desktop et sa page Utilisation (dossier Claude-Data), puis réessaie.');
}

// Poll every discovered aggregate file, including atomic replacement and
// creation. This does not force Claude's own polling or touch conversations.
function watchClaudeDesktopUsage(onChange, options = {}) {
  const registrations = usagePaths(options.localAppData, options.roamingAppData).map(file => {
    const listener = (current, previous) => {
      if (current.size > 0 && (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size)) onChange();
    };
    fileEvents.watchFile(file, { persistent: false, interval: options.interval || 2000 }, listener);
    return [file, listener];
  });
  return () => { for (const [file, listener] of registrations) fileEvents.unwatchFile(file, listener); };
}

module.exports = { usagePaths, parseClaudeDesktopUsage, readClaudeDesktopUsage, watchClaudeDesktopUsage };
