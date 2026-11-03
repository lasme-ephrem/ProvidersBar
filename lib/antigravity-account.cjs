const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const https = require('node:https');

const execFileAsync = promisify(execFile);

// Inspect only the installed desktop app's service. Its ephemeral CSRF token
// stays in memory and is sent only to ports owned by that verified process.
// The executable path filter is evaluated inside PowerShell (UTF-16 internally):
// forcing UTF-8 on the output pipe avoids comparing a path that JSON decoding
// may have mangled for non-ASCII Windows user profiles. Node therefore never
// re-validates a decoded path; only the already-filtered list is used.
const DISCOVERY_COMMAND = String.raw`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding; $items = @(Get-CimInstance Win32_Process -Filter "name = 'language_server.exe'" | Where-Object { $_.ExecutablePath -eq "$env:LOCALAPPDATA\Programs\antigravity\resources\bin\language_server.exe" }); $listeners = @(Get-NetTCPConnection -State Listen); @($items | ForEach-Object { $server = $_; [pscustomobject]@{ args=$server.CommandLine; ports=@($listeners | Where-Object { $_.OwningProcess -eq $server.ProcessId -and $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::') } | Select-Object -ExpandProperty LocalPort -Unique) } }) | ConvertTo-Json -Depth 4 -Compress`;
const closedMessage = 'Ouvre Antigravity 2.0 et connecte ton compte Google, puis clique sur Vérifier maintenant. Aucune CLI n’est nécessaire.';

async function runDiscovery({ exec = execFileAsync, command = DISCOVERY_COMMAND } = {}) {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 12000, maxBuffer: 256 * 1024, encoding: 'utf8' });
  return stdout;
}

async function discoverServers({ run = runDiscovery } = {}) {
  let stdout;
  try { stdout = await run(); }
  catch { throw new Error('Le service local Antigravity ne peut pas être détecté. ' + closedMessage); }
  let entries;
  try { entries = JSON.parse(String(stdout).trim() || '[]'); }
  catch { throw new Error('Le service local Antigravity ne peut pas être détecté. ' + closedMessage); }
  if (!Array.isArray(entries)) entries = [entries];
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return [];
    const csrf = typeof entry.args === 'string' ? entry.args.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1] : null;
    if (!csrf || !/^[a-zA-Z0-9-]{16,128}$/.test(csrf)) return [];
    // ConvertTo-Json may serialize a single port as a scalar instead of an array.
    const rawPorts = Array.isArray(entry.ports) ? entry.ports : entry.ports == null ? [] : [entry.ports];
    return [...new Set(rawPorts)].filter(port => Number.isInteger(port) && port > 0 && port <= 65535).slice(0, 8).map(port => ({ port, csrf }));
  });
}

function readQuotaSummary({ port, csrf }) {
  return new Promise((resolve, reject) => {
    // Antigravity generates its own localhost certificate. This exception is
    // restricted to loopback (127.0.0.1) and to a port owned by the verified
    // installed service, discovered just before this request.
    const request = https.request({ hostname: '127.0.0.1', port,
      path: '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', method: 'POST', rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': csrf }, timeout: 4000,
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 512 * 1024) request.destroy(); });
      response.on('error', () => reject(new Error('Réponse locale Antigravity interrompue.')));
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error('Antigravity ne peut pas lire les quotas du compte.'));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Réponse de quota Antigravity illisible.')); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => reject(new Error('Le service local Antigravity ne répond pas.')));
    // Same refresh operation as Models & Usage; no inference, credit use or reset.
    request.end(JSON.stringify({ forceRefresh: true }));
  });
}

function quotaDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function parseAntigravityQuota(data, now = new Date()) {
  const groups = data?.response?.groups;
  if (!Array.isArray(groups)) throw new Error('Les quotas Antigravity sont indisponibles. Vérifie le compte dans Models & Usage.');
  const windows = [];
  const warnings = [];
  const labels = { 'gemini-weekly': ['Gemini · Semaine','weekly'], 'gemini-5h': ['Gemini · 5 heures','5h'], 'gemini-argon-wtu-weekly': ['Gemini 4 Argon · Semaine','weekly'], '3p-weekly': ['Claude et GPT · Semaine','weekly'], '3p-5h': ['Claude et GPT · 5 heures','5h'] };
  for (const group of groups) for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
    if (!Object.hasOwn(labels, bucket?.bucketId || '') || bucket.disabled === true) continue;
    const [label, period] = labels[bucket.bucketId];
    // A known bucket whose period changed is a provider-side evolution: ignore
    // it with an explicit warning instead of failing the whole reading.
    if (bucket.window !== period) {
      warnings.push(`Fenêtre inattendue pour « ${label} » : « ${String(bucket.window).slice(0, 40)} » ignorée.`);
      continue;
    }
    if (typeof bucket.remainingFraction !== 'number' || !Number.isFinite(bucket.remainingFraction) || bucket.remainingFraction < 0 || bucket.remainingFraction > 1) throw new Error('Quota Antigravity invalide. Le dernier relevé est conservé.');
    const reset = bucket.resetTime;
    if (reset != null && !quotaDate(reset)) throw new Error('Date de quota Antigravity invalide : un fuseau horaire est requis.');
    if (windows.some(w => w.label === label)) throw new Error('Quotas Antigravity contradictoires.');
    // Match the rounding displayed by Antigravity's Models & Usage panel.
    windows.push({ label, remaining: Math.round(bucket.remainingFraction * 100), resetAt: reset ? new Date(reset).toISOString() : null });
  }
  if (!windows.length) throw new Error('Aucun quota Antigravity lisible. Vérifie la connexion dans Models & Usage.');
  const minimum = windows.reduce((a,b) => a.remaining <= b.remaining ? a : b);
  const snapshot = { source: 'api', connectorVersion: 'antigravity-local-v1', updatedAt: now.toISOString(), balances: [], quotaWindows: windows, quotaRemaining: minimum.remaining, resetAt: minimum.resetAt, quotaLabel: `Antigravity · ${minimum.label}` };
  if (warnings.length) snapshot.warnings = warnings;
  return snapshot;
}

async function fetchAntigravityQuota({ discover = discoverServers, request = readQuotaSummary } = {}) {
  const servers = await discover();
  if (!servers.length) throw new Error(closedMessage);
  for (const server of servers) {
    let data;
    try { data = await request(server); } catch { continue; }
    return parseAntigravityQuota(data);
  }
  throw new Error('Lecture Antigravity impossible. ' + closedMessage);
}
module.exports = { fetchAntigravityQuota, parseAntigravityQuota, discoverServers, runDiscovery, DISCOVERY_COMMAND };
