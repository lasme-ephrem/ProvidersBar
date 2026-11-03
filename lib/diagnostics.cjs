// Read-only prerequisite checks used by `npm run doctor` and the app itself.
// No secret, token, cookie or account identity is ever returned or printed:
// details only contain counts, HTTP statuses and static guidance.
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { connectors } = require('./provider-catalog.cjs');
const { usagePaths, readClaudeDesktopUsage } = require('./claude-desktop-usage.cjs');
const { CREDENTIAL_PATH } = require('./claude-connection.cjs');
const { findCodex } = require('./openai-account.cjs');
const { discoverServers } = require('./antigravity-account.cjs');
const { USAGE_URL } = require('./claude-live-usage.cjs');
const { SETTINGS_URL } = require('./ollama-account.cjs');

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 8000;
// Only these two prevent the application from storing and protecting its data.
// Every other item is an actionable warning, not a blocking prerequisite.
const CRITICAL_IDS = Object.freeze(['data-dir', 'encryption']);

const DPAPI_PROBE = String.raw`Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes('providersbar'); $p=[Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); $u=[Security.Cryptography.ProtectedData]::Unprotect($p,$null,'CurrentUser'); if([Text.Encoding]::UTF8.GetString($u) -eq 'providersbar') { 'OK' } else { 'FAIL' }`;

function item(id, label, ok, detail, hint = '') {
  return { id, label, ok: Boolean(ok), detail: String(detail || ''), hint: String(hint || '') };
}

function browserCandidates(env = process.env) {
  return [
    path.join(env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
}

async function checkDataDir({ dataDir, fsImpl = fs } = {}) {
  const target = path.resolve(dataDir);
  try {
    const stat = await fsImpl.stat(target);
    if (!stat.isDirectory()) return item('data-dir', 'Dossier de données', false, 'Le chemin existe mais n’est pas un dossier.', 'Choisis un autre dossier de données.');
    await fsImpl.access(target, constants.W_OK);
    return item('data-dir', 'Dossier de données', true, 'Dossier accessible en écriture.', '');
  } catch (error) {
    if (error && error.code === 'ENOENT') return item('data-dir', 'Dossier de données', false, 'Dossier absent.', 'Il sera créé au premier démarrage de l’application.');
    return item('data-dir', 'Dossier de données', false, 'Dossier inaccessible en écriture.', 'Vérifie les droits Windows du dossier et de son parent.');
  }
}

async function checkEncryption({ platform = process.platform, exec = execFileAsync } = {}) {
  if (platform !== 'win32') return item('encryption', 'Chiffrement des clés (DPAPI)', false, 'Windows requis.', 'Ce diagnostic doit être lancé sous Windows.');
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_PROBE], { windowsHide: true, timeout: 10000, encoding: 'utf8' });
    return String(stdout).includes('OK')
      ? item('encryption', 'Chiffrement des clés (DPAPI)', true, 'DPAPI Windows disponible.', '')
      : item('encryption', 'Chiffrement des clés (DPAPI)', false, 'DPAPI a renvoyé un résultat inattendu.', 'Vérifie la stratégie de chiffrement Windows.');
  } catch {
    return item('encryption', 'Chiffrement des clés (DPAPI)', false, 'DPAPI Windows indisponible.', 'Les clés API ne pourront pas être enregistrées.');
  }
}

async function checkBrowser({ env = process.env, fsImpl = fs } = {}) {
  for (const candidate of browserCandidates(env)) {
    if (!candidate) continue;
    try {
      await fsImpl.access(candidate, constants.X_OK);
      const name = /msedge\.exe$/i.test(candidate) ? 'Microsoft Edge' : 'Google Chrome';
      return item('browser', 'Navigateur Chrome ou Edge', true, `${name} détecté.`, '');
    } catch { /* try the next known location */ }
  }
  return item('browser', 'Navigateur Chrome ou Edge', false, 'Aucun navigateur détecté.', 'Installe Google Chrome ou Microsoft Edge pour connecter les comptes web (Grok, Z.ai, Ollama).');
}

async function checkCodex({ findCodexImpl = findCodex } = {}) {
  try {
    await findCodexImpl();
    return item('codex', 'Codex (OpenAI)', true, 'Codex installé.', '');
  } catch {
    return item('codex', 'Codex (OpenAI)', false, 'Codex introuvable.', 'Installe Codex et connecte ton compte ChatGPT pour lire les quotas OpenAI.');
  }
}

async function checkClaudeDesktop({ paths = usagePaths(), readDesktop = readClaudeDesktopUsage, now = () => new Date(), fsImpl = fs } = {}) {
  const present = [];
  for (const candidate of paths) {
    try {
      const stat = await fsImpl.stat(candidate);
      if (stat.isFile()) present.push(candidate);
    } catch { /* absent profile */ }
  }
  if (!present.length) return item('claude-desktop', 'Claude Desktop', false, 'Aucun relevé local de Claude Desktop.', 'Ouvre Claude Desktop et sa page Utilisation pour créer un relevé.');
  try {
    await readDesktop(null, { now: now() });
    return item('claude-desktop', 'Claude Desktop', true, `Relevé local lisible (${present.length} fichier(s) détecté(s)).`, '');
  } catch (error) {
    return item('claude-desktop', 'Claude Desktop', false, (error && error.message) || 'Relevé local illisible.', 'Ouvre Claude Desktop et sa page Utilisation, puis relance le diagnostic.');
  }
}

async function checkClaudeCode({ credentialPath = CREDENTIAL_PATH, fsImpl = fs, now = () => new Date() } = {}) {
  const label = 'Claude Code (lecture directe)';
  try {
    const stat = await fsImpl.stat(credentialPath);
    if (!stat.isFile() || stat.size > 65536) return item('claude-code', label, false, 'Fichier de connexion Claude Code invalide.', 'Lance `claude auth login` dans un terminal.');
    let document;
    try { document = JSON.parse(await fsImpl.readFile(credentialPath, 'utf8')); }
    catch { return item('claude-code', label, false, 'Fichier de connexion Claude Code illisible.', 'Lance `claude auth login` dans un terminal.'); }
    const account = document && document.claudeAiOauth;
    if (!account || typeof account.accessToken !== 'string' || !account.accessToken || account.accessToken.length > 16384 || /[\r\n]/.test(account.accessToken)) {
      return item('claude-code', label, false, 'Aucune connexion Claude Code.', 'Lance `claude auth login` pour activer la lecture directe.');
    }
    const expiresAt = Number(account.expiresAt);
    const remainingMinutes = Number.isFinite(expiresAt) ? Math.round((expiresAt - now().getTime()) / 60000) : null;
    const detail = remainingMinutes === null ? 'Connexion Claude Code présente.'
      : remainingMinutes > 0 ? `Connexion Claude Code présente (jeton valide ~${remainingMinutes} min).`
        : 'Connexion Claude Code présente, jeton à renouveler.';
    return item('claude-code', label, true, detail, 'Le jeton sera renouvelé automatiquement par ProvidersBar.');
  } catch (error) {
    if (error && error.code === 'ENOENT') return item('claude-code', label, false, 'Aucune connexion Claude Code.', 'Lance `claude auth login` pour activer la lecture directe.');
    return item('claude-code', label, false, 'Fichier de connexion Claude Code inaccessible.', 'Vérifie les droits du dossier ~/.claude.');
  }
}

async function checkAntigravity({ discover = discoverServers } = {}) {
  const label = 'Antigravity (service local)';
  try {
    const servers = await discover();
    if (!servers.length) return item('antigravity', label, false, 'Service local non détecté.', 'Ouvre Antigravity 2.0 et connecte ton compte Google.');
    const ports = new Set(servers.map(server => server && server.port).filter(Number.isInteger));
    return item('antigravity', label, true, `Service local détecté (${servers.length} processus, ${ports.size} port(s)).`, '');
  } catch {
    return item('antigravity', label, false, 'Service local non détecté.', 'Ouvre Antigravity 2.0 et connecte ton compte Google.');
  }
}

async function checkEndpoint(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    const response = await fetchImpl(endpoint.url, { method: 'GET', redirect: 'manual', cache: 'no-store', headers: { Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
    const status = Number(response && response.status);
    if (!Number.isFinite(status) || status <= 0) return item(endpoint.id, endpoint.label, false, 'Réponse HTTP invalide.', 'Réessaie plus tard.');
    const authRequired = status === 401 || status === 403;
    const ok = status < 500;
    return item(endpoint.id, endpoint.label, ok,
      authRequired ? `HTTP ${status} (réponse attendue sans clé)` : `HTTP ${status}`,
      ok ? '' : 'Le service répond mais signale une erreur ; réessaie plus tard.');
  } catch {
    return item(endpoint.id, endpoint.label, false, 'Connexion impossible.', 'Vérifie Internet, le proxy Windows ou le pare-feu.');
  }
}

function defaultEndpoints() {
  const found = new Map();
  const add = (id, label, url) => {
    if (typeof url !== 'string') return;
    try { new URL(url); } catch { return; }
    if (found.has(url)) return;
    found.set(url, { id: `endpoint:${id}`, label: `Accès ${label}`, url });
  };
  for (const [id, descriptor] of Object.entries(connectors)) {
    if (descriptor && typeof descriptor.endpoint === 'string') add(id, id, descriptor.endpoint);
  }
  add('anthropic', 'Anthropic (lecture directe)', USAGE_URL);
  add('chatgpt', 'ChatGPT', 'https://chatgpt.com/');
  add('claude', 'Claude', 'https://claude.ai/');
  add('grok', 'Grok', 'https://grok.com/');
  add('zai', 'Z.AI', 'https://z.ai/');
  add('ollama', 'Ollama', SETTINGS_URL);
  return [...found.values()];
}

async function safeCheck(id, label, run) {
  try { return await run(); }
  catch { return item(id, label, false, 'Vérification impossible.', 'Relance le diagnostic ou consulte les journaux de l’application.'); }
}

async function collectDiagnostics({
  dataDir = process.env.PROVIDERSBAR_DATA_DIR || path.join(process.cwd(), '.local'),
  env = process.env,
  platform = process.platform,
  fsImpl = fs,
  fetchImpl = globalThis.fetch,
  findCodexImpl = findCodex,
  discover = discoverServers,
  paths = usagePaths(),
  readDesktop = readClaudeDesktopUsage,
  credentialPath = CREDENTIAL_PATH,
  exec = execFileAsync,
  endpoints = defaultEndpoints(),
  timeoutMs = TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const tasks = [
    () => checkDataDir({ dataDir, fsImpl }),
    () => checkEncryption({ platform, exec }),
    () => checkBrowser({ env, fsImpl }),
    () => checkCodex({ findCodexImpl }),
    () => checkClaudeDesktop({ paths, readDesktop, now, fsImpl }),
    () => checkClaudeCode({ credentialPath, fsImpl, now }),
    () => checkAntigravity({ discover }),
    ...endpoints.map(endpoint => () => checkEndpoint(endpoint, { fetchImpl, timeoutMs })),
  ];
  const labels = ['Dossier de données', 'Chiffrement des clés (DPAPI)', 'Navigateur Chrome ou Edge', 'Codex (OpenAI)', 'Claude Desktop', 'Claude Code (lecture directe)', 'Antigravity (service local)', ...endpoints.map(endpoint => endpoint.label)];
  const ids = ['data-dir', 'encryption', 'browser', 'codex', 'claude-desktop', 'claude-code', 'antigravity', ...endpoints.map(endpoint => endpoint.id)];
  // Run every check concurrently, then keep a stable, deterministic order.
  return Promise.all(tasks.map((task, index) => safeCheck(ids[index], labels[index], task)));
}

module.exports = {
  CRITICAL_IDS, TIMEOUT_MS, collectDiagnostics, defaultEndpoints,
  checkDataDir, checkEncryption, checkBrowser, checkCodex, checkClaudeDesktop, checkClaudeCode, checkAntigravity, checkEndpoint,
};
