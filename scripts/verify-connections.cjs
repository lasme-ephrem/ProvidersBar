// Explicit live diagnostics. Uses existing connections without invoking inference.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const portable = path.join(root, 'dist', 'ProvidersBar-win32-x64');
  const [port] = (await fs.readFile(path.join(portable, 'data', 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || Number(port) > 65535) throw new Error('No local diagnostic port. Start the portable with --remote-debugging-port=0 --remote-debugging-address=127.0.0.1.');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const expected = pathToFileURL(path.join(portable, 'resources', 'app', 'renderer', 'index.html')).href.toLowerCase();
    const pages = browser.contexts().flatMap(c => c.pages()).filter(p => p.url().split('?')[0].toLowerCase() === expected && !p.url().includes('mode=quick'));
    if (pages.length !== 1) throw new Error('The local port does not expose the expected ProvidersBar window.');
    const page = pages[0];
    await page.evaluate(() => window.providersBar.syncAll());
    const checkedInactive = [];
    if (process.argv.includes('--include-inactive')) {
      const ids = await page.evaluate(async () => (await window.providersBar.getState()).providers.filter(p => p.connected && p.connector?.browserAccount && (!p.active || ['expired', 'paused'].includes(p.subscriptionStatus))).map(p => p.id));
      for (const id of ids) {
        await page.evaluate(id => window.providersBar.verifyAccount(id).catch(() => {}), id);
        checkedInactive.push(id);
      }
    }
    const report = await page.evaluate(async checkedInactive => {
      const state = await window.providersBar.getState();
      return { checkedAt: new Date().toISOString(), providers: state.providers.map(p => ({
        id: p.id, active: p.active, subscriptionStatus: p.subscriptionStatus || null,
        connected: p.connected, attemptedAt: p.lastAttempt, measuredAt: p.snapshot?.updatedAt || null,
        result: !p.active || ['expired', 'paused'].includes(p.subscriptionStatus) ? 'not-tracked' : p.error ? 'error' : p.connected && p.snapshot ? 'ok' : 'not-connected',
        ...(checkedInactive.includes(p.id) ? { inactiveConnectionCheck: p.error ? 'error' : p.snapshot ? 'ok' : 'unknown' } : {}),
        // Do not include messages, identity, tokens, billing amounts or balances.
        windows: (p.snapshot?.quotaWindows || []).map(w => ({ label: w.label, remaining: w.remaining, resetAt: w.resetAt || null })),
      })) };
    }, checkedInactive);
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await fs.writeFile(path.join(root, 'test-results', 'connections-live.json'), JSON.stringify(report, null, 2));
    for (const p of report.providers) console.log(`${p.id}: ${p.result}${p.inactiveConnectionCheck ? ' · session ' + p.inactiveConnectionCheck : ''} · ${p.measuredAt || 'no measurement'}`);
    if (report.providers.some(p => p.result === 'error' || p.result === 'not-connected')) process.exitCode = 1;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
