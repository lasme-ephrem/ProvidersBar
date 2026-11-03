// Diagnostic local explicite : lit les connexions déjà suivies via le port de
// débogage du portable, sans lancer d'inférence et sans écrire aucun secret.
// Les helpers purs (URL, rapport, code retour) sont exportés pour être testés
// par tests/quality.test.cjs sans Electron ni Playwright.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const portable = path.join(root, 'dist', 'ProvidersBar-win32-x64');
const resultsDirectory = path.join(root, 'test-results');
const reportPath = path.join(resultsDirectory, 'connections-live.json');
const START_HINT = 'Lance le portable avec --remote-debugging-port=0 --remote-debugging-address=127.0.0.1, puis relance ce diagnostic.';

// Normalise une URL pour comparer l'interface attendue et les pages réellement
// exposées : ignorer requête/fragment, slash final, casse des chemins de fichiers
// Windows, et refuser les schémas qui ne sont ni file:, http: ni https:.
function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed;
  try { parsed = new URL(value.trim()); } catch { return null; }
  if (!['file:', 'http:', 'https:'].includes(parsed.protocol)) return null;
  let pathname = parsed.pathname.replace(/\/{2,}/g, '/');
  try { pathname = decodeURIComponent(pathname); } catch { /* encodage partiel : garder tel quel */ }
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  if (parsed.protocol === 'file:') pathname = pathname.toLowerCase();
  const origin = parsed.protocol === 'file:' ? '' : parsed.origin.toLowerCase();
  return origin + pathname;
}

function isQuickWindow(value) {
  let parsed;
  try { parsed = new URL(value); } catch { return false; }
  return parsed.searchParams.get('mode') === 'quick';
}

function isExpectedPage(value, expectedUiUrl) {
  const actual = normalizeUrl(value);
  const expected = normalizeUrl(expectedUiUrl);
  return Boolean(actual && expected && actual === expected);
}

// Une seule fenêtre principale doit exposer exactement l'interface attendue.
// Le widget est une autre fenêtre du même fichier, distinguée par ?mode=quick.
function selectDashboardPages(pages, expectedUiUrl) {
  return pages.filter(page => {
    let url;
    try { url = page.url(); } catch { return false; }
    return isExpectedPage(url, expectedUiUrl) && !isQuickWindow(url);
  });
}

// Lit un fichier DevToolsActivePort de Chrome/Electron : première ligne = port,
// seconde = chemin /devtools/browser/<id>. Toute autre forme est refusée.
function parseDiagnosticPort(content, { maxPort = 65535 } = {}) {
  const lines = String(content ?? '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const [portLine, suffixLine] = lines;
  if (!/^\d+$/.test(portLine)) return null;
  const port = Number(portLine);
  if (!Number.isSafeInteger(port) || port < 1 || port > maxPort) return null;
  if (!/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(suffixLine)) return null;
  return { port, suffix: suffixLine };
}

function providerResult(provider) {
  if (!provider?.active || ['expired', 'paused'].includes(provider.subscriptionStatus)) return 'not-tracked';
  if (provider.error) return 'error';
  if (provider.connected && provider.snapshot) return 'ok';
  return 'not-connected';
}

// Rapport public volontairement fermé : identifiants, états et fenêtres de quota
// uniquement. Aucun message, montant, e-mail, jeton, cookie ou identité.
function buildReport({ providers, checkedInactive = [], now = new Date() }) {
  if (!Array.isArray(providers)) throw new Error('État local illisible : providers doit être un tableau.');
  const inactive = new Set(checkedInactive);
  return {
    checkedAt: now.toISOString(),
    providers: providers.map(provider => {
      const windows = Array.isArray(provider?.snapshot?.quotaWindows) ? provider.snapshot.quotaWindows : [];
      return {
        id: provider.id,
        active: Boolean(provider.active),
        subscriptionStatus: provider.subscriptionStatus || null,
        connected: Boolean(provider.connected),
        attemptedAt: provider.lastAttempt || null,
        measuredAt: provider.snapshot?.updatedAt || null,
        result: providerResult(provider),
        ...(inactive.has(provider.id) ? {
          inactiveConnectionCheck: provider.error ? 'error' : provider.snapshot ? 'ok' : 'unknown',
        } : {}),
        windows: windows.map(window => ({
          label: window.label,
          remaining: window.remaining,
          resetAt: window.resetAt || null,
        })),
      };
    }),
  };
}

function reportNeedsAttention(report) {
  return Array.isArray(report?.providers) && report.providers.some(provider => provider.result === 'error' || provider.result === 'not-connected');
}

function formatReportLine(provider) {
  const extra = provider.inactiveConnectionCheck ? ` · session ${provider.inactiveConnectionCheck}` : '';
  return `${provider.id}: ${provider.result}${extra} · ${provider.measuredAt || 'no measurement'}`;
}

async function readDiagnosticPort(portableDirectory = portable) {
  let content;
  try {
    content = await fs.readFile(path.join(portableDirectory, 'data', 'DevToolsActivePort'), 'utf8');
  } catch {
    throw new Error(`Aucun port de diagnostic local. ${START_HINT}`);
  }
  const parsed = parseDiagnosticPort(content);
  if (!parsed) throw new Error(`Port de diagnostic invalide. ${START_HINT}`);
  return parsed;
}

async function main() {
  const { chromium } = require('playwright');
  const { port } = await readDiagnosticPort();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const expectedUi = pathToFileURL(path.join(portable, 'resources', 'app', 'renderer', 'index.html')).href;
    const pages = browser.contexts().flatMap(context => context.pages());
    const dashboards = selectDashboardPages(pages, expectedUi);
    if (dashboards.length !== 1) throw new Error('Le port local n’expose pas la fenêtre ProvidersBar attendue.');
    const page = dashboards[0];
    await page.evaluate(() => window.providersBar.syncAll());
    const checkedInactive = [];
    if (process.argv.includes('--include-inactive')) {
      const ids = await page.evaluate(async () => (await window.providersBar.getState()).providers
        .filter(provider => provider.connected && provider.connector?.browserAccount && (!provider.active || ['expired', 'paused'].includes(provider.subscriptionStatus)))
        .map(provider => provider.id));
      for (const id of ids) {
        await page.evaluate(id => window.providersBar.verifyAccount(id).catch(() => {}), id);
        checkedInactive.push(id);
      }
    }
    const state = await page.evaluate(() => window.providersBar.getState());
    const report = buildReport({ providers: state.providers, checkedInactive });
    await fs.mkdir(resultsDirectory, { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    for (const provider of report.providers) console.log(formatReportLine(provider));
    process.exitCode = reportNeedsAttention(report) ? 1 : 0;
  } finally { await browser.close(); }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  normalizeUrl,
  isQuickWindow,
  isExpectedPage,
  selectDashboardPages,
  parseDiagnosticPort,
  providerResult,
  buildReport,
  reportNeedsAttention,
  formatReportLine,
  readDiagnosticPort,
  reportPath,
  portable,
};
