const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const https = require('node:https');
const path = require('node:path');

// Inspect only the installed desktop app's service. Its ephemeral CSRF token
// stays in memory and is sent only to ports owned by that verified process.
const discoveryCommand = String.raw`$items = @(Get-CimInstance Win32_Process -Filter "name = 'language_server.exe'" | Where-Object { $_.ExecutablePath -eq "$env:LOCALAPPDATA\Programs\antigravity\resources\bin\language_server.exe" }); $listeners = @(Get-NetTCPConnection -State Listen); @($items | ForEach-Object { $server = $_; [pscustomobject]@{ path=$server.ExecutablePath; args=$server.CommandLine; ports=@($listeners | Where-Object { $_.OwningProcess -eq $server.ProcessId -and $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::') } | Select-Object -ExpandProperty LocalPort -Unique) } }) | ConvertTo-Json -Depth 4 -Compress`;
const closedMessage = 'Ouvre Antigravity 2.0 et connecte ton compte Google, puis clique sur Vérifier maintenant. Aucune CLI n’est nécessaire.';

async function discoverServers() {
  let entries;
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', discoveryCommand], { windowsHide: true, timeout: 12000, maxBuffer: 256 * 1024 });
    entries = JSON.parse(stdout.trim() || '[]');
  } catch { throw new Error('Le service local Antigravity ne peut pas être détecté. ' + closedMessage); }
  if (!Array.isArray(entries)) entries = [entries];
  const expected = path.resolve(process.env.LOCALAPPDATA || '', 'Programs/antigravity/resources/bin/language_server.exe').toLowerCase();
  return entries.filter(e => e && typeof e.path === 'string' && path.resolve(e.path).toLowerCase() === expected).flatMap(e => {
    const csrf = typeof e.args === 'string' ? e.args.match(/--csrf_token(?:=|\s+)"?([^\s"]+)/)?.[1] : null;
    if (!csrf || !/^[a-zA-Z0-9-]{16,128}$/.test(csrf)) return [];
    return [...new Set(e.ports || [])].filter(p => Number.isInteger(p) && p > 0 && p <= 65535).slice(0,8).map(port => ({ port, csrf }));
  });
}

function readQuotaSummary({ port, csrf }) {
  return new Promise((resolve, reject) => {
    // Antigravity generates its own localhost certificate. This exception is
    // restricted to loopback and a port owned by the verified installed service.
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

function parseAntigravityQuota(data, now = new Date()) {
  const groups = data?.response?.groups;
  if (!Array.isArray(groups)) throw new Error('Les quotas Antigravity sont indisponibles. Vérifie le compte dans Models & Usage.');
  const windows = [];
  const labels = { 'gemini-weekly': ['Gemini · Semaine','weekly'], 'gemini-5h': ['Gemini · 5 heures','5h'], '3p-weekly': ['Claude et GPT · Semaine','weekly'], '3p-5h': ['Claude et GPT · 5 heures','5h'] };
  for (const group of groups) for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
    if (!Object.hasOwn(labels, bucket?.bucketId || '') || bucket.disabled === true) continue;
    const [label, period] = labels[bucket.bucketId];
    if (bucket.window !== period || typeof bucket.remainingFraction !== 'number' || !Number.isFinite(bucket.remainingFraction) || bucket.remainingFraction < 0 || bucket.remainingFraction > 1) throw new Error('Quota Antigravity invalide. Le dernier relevé est conservé.');
    const reset = bucket.resetTime;
    if (reset != null && (typeof reset !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(reset) || !Number.isFinite(Date.parse(reset)))) throw new Error('Date de quota Antigravity invalide.');
    if (windows.some(w => w.label === label)) throw new Error('Quotas Antigravity contradictoires.');
    // Match the rounding displayed by Antigravity's Models & Usage panel.
    windows.push({ label, remaining: Math.round(bucket.remainingFraction * 100), resetAt: reset ? new Date(reset).toISOString() : null });
  }
  if (!windows.length) throw new Error('Aucun quota Antigravity lisible. Vérifie la connexion dans Models & Usage.');
  const minimum = windows.reduce((a,b) => a.remaining <= b.remaining ? a : b);
  return { source: 'api', connectorVersion: 'antigravity-local-v1', updatedAt: now.toISOString(), balances: [], quotaWindows: windows, quotaRemaining: minimum.remaining, resetAt: minimum.resetAt, quotaLabel: `Antigravity · ${minimum.label}` };
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
module.exports = { fetchAntigravityQuota, parseAntigravityQuota };
