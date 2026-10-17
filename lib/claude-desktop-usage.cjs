// Claude Desktop writes aggregate plan usage to this local history. Read only
// the two percentages: never inspect credentials, conversations or app storage.
const fs = require('node:fs/promises');
const fileEvents = require('node:fs');
const path = require('node:path');

const MAX_AGE_MS = 45 * 60 * 1000;
const MAX_FILE_BYTES = 1024 * 1024;

function usagePaths(localAppData = process.env.LOCALAPPDATA, roamingAppData = process.env.APPDATA) {
  return [
    localAppData && path.join(localAppData, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'plan-usage-history.json'),
    roamingAppData && path.join(roamingAppData, 'Claude', 'plan-usage-history.json'),
  ].filter(Boolean);
}

function parseClaudeDesktopUsage(history, previous = null, now = new Date()) {
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
  if (time - sample.t > MAX_AGE_MS) {
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
    quotaLabel: `Claude · ${tightest.label} · Claude Desktop` };
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
  if (!histories.length) throw new Error(readError ? 'Le relevé local de Claude Desktop est illisible.' : 'Aucun relevé local trouvé. Ouvre Claude Desktop et sa page Utilisation, puis réessaie.');
  histories.sort((a, b) => (b?.samples?.at(-1)?.t || 0) - (a?.samples?.at(-1)?.t || 0));
  return parseClaudeDesktopUsage(histories[0], previous, options.now || new Date());
}

// Poll only the two aggregate files, including atomic replacement and creation.
// This does not force Claude's own polling or touch its active conversations.
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
