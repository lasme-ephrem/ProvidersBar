const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let desktop;

async function main() {
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(results, 'resource-status-data-'));
  const env = { ...process.env, PROVIDERSBAR_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({ executablePath: process.env.PROVIDERSBAR_EXECUTABLE || require('electron'), args: process.env.PROVIDERSBAR_EXECUTABLE ? [] : [root], cwd: root, env, timeout: 30000 });
  const dashboard = await desktop.firstWindow();
  await dashboard.waitForSelector('.card');
  const widget = desktop.windows().find(w => w.url().includes('mode=quick'));
  assert.ok(widget);
  await widget.waitForSelector('.quick-row');
  const errors = [];
  for (const surface of [dashboard, widget]) surface.on('pageerror', error => errors.push(error.message));
  const card = id => dashboard.locator(`.card:has([data-open="${id}"])`);
  const row = id => widget.locator(`[data-provider="${id}"]`);
  // Fixtures exist only in the two renderers and never overwrite account data.
  async function fixture(id, snapshot) {
    for (const surface of [dashboard, widget]) await surface.evaluate(({ id, snapshot }) => {
      page = 'overview'; filter = 'all'; query = '';
      const provider = state.providers.find(p => p.id === id);
      Object.assign(provider, { active: true, connected: true, syncing: false, subscriptionStatus: 'active', renewalDate: '2099-12-31', error: null, snapshot: { source: 'api', updatedAt: new Date().toISOString(), balances: [], ...snapshot } });
      render();
    }, { id, snapshot });
  }
  for (const theme of ['light', 'dark']) {
    // Le renderer applique le thème depuis state.settings.theme à chaque rendu :
    // forcer l'état est la seule façon déterministe de tester les deux palettes.
    for (const surface of [dashboard, widget]) await surface.evaluate(theme => { state.settings.theme = theme; document.documentElement.dataset.theme = theme; }, theme);
    for (const currency of ['USD', 'EUR', 'CNY']) {
      for (const id of ['openrouter', 'deepseek', 'runinfra', 'orcarouter']) {
        await fixture(id, { balances: [{ currency, remaining: -0.08 }], quotaRemaining: null });
        for (const container of [card(id), row(id)]) {
          assert.match(await container.getAttribute('class'), /resource-empty/);
          // Le widget 0.3.0 exprime l'épuisement par la pastille textuelle
          // « Épuisé » ; la carte du tableau de bord garde « Solde épuisé ».
          assert.match(await container.innerText(), /Épuisé/);
          const color = await container.locator('.resource-value').first().evaluate(el => getComputedStyle(el).color);
          const [r, g, b] = color.match(/[\d.]+/g).map(Number);
          assert.ok(r > g && r > b, `${id}/${currency}/${theme} should be red: ${color}`);
        }
        assert.match(await card(id).innerText(), /Solde épuisé/);
      }
    }
  }
  const windowSets = {
    claude: [['Semaine', 'Limite hebdo atteinte'], ['Fable · Semaine', 'Limite hebdo Fable atteinte'], ['5 heures', 'Limite 5 h atteinte']],
    zai: [['Semaine', 'Limite hebdo atteinte'], ['5 heures', 'Limite 5 h atteinte']],
    antigravity: [['Gemini · Semaine', 'Limite Gemini · hebdo atteinte'], ['Gemini · 5 heures', 'Limite Gemini · 5 h atteinte'], ['Claude et GPT · Semaine', 'Limite Claude / GPT · hebdo atteinte'], ['Claude et GPT · 5 heures', 'Limite Claude / GPT · 5 h atteinte'], ['Gemini 4 Argon · Semaine', 'Limite Gemini 4 Argon · hebdo atteinte']],
    openai: [['Codex et Work · Semaine', 'Limite Codex et Work · hebdo atteinte']],
    grok: [['Semaine', 'Limite Grok · hebdo atteinte'], ['Grok Bot · Semaine', 'Limite Grok Bot · hebdo atteinte']],
  };
  for (const [id, windows] of Object.entries(windowSets)) {
    for (const [exhausted, expected] of windows) {
      await fixture(id, { quotaRemaining: 0, quotaWindows: windows.map(([label]) => ({ label, remaining: label === exhausted ? 0 : 100 })) });
      assert.deepEqual(await card(id).locator('.quota-period-status').allTextContents(), [expected]);
      assert.deepEqual(await row(id).locator('.quick-period-status').allTextContents(), [expected]);
      if (windows.length > 1) {
        assert.equal(await card(id).locator('.resource-status').count(), 0);
        assert.equal(await row(id).locator('.quick-resource-status').count(), 0);
        assert.doesNotMatch(await card(id).getAttribute('class'), /resource-empty/);
        assert.doesNotMatch(await row(id).getAttribute('class'), /resource-empty/);
      }
    }
    await fixture(id, { quotaWindows: windows.map(([label]) => ({ label, remaining: 0 })) });
    const expected = windows.length > 1 ? 'Toutes les limites atteintes' : 'Limite atteinte';
    assert.equal(await card(id).locator('.resource-status').innerText(), expected);
    // Le widget 0.3.0 n'affiche pas de statut global redondant : chaque fenêtre
    // épuisée porte son statut et la pastille de niveau reste textuelle.
    assert.equal(await row(id).locator('.level-pill.resource-empty').count(), 1);
    assert.equal(await row(id).locator('.quick-period-status').count(), windows.length);
  }
  await fixture('grok', { usageKind: 'x-subscription-shared', quotaWindows: [{ label: 'Semaine', remaining: 40 }] });
  assert.equal(await card('grok').locator('.quota-period').count(), 1);
  assert.equal(await row('grok').locator('.quick-period').count(), 1);
  assert.match(await card('grok').innerText(), /Grok \/ Bot \/ Cursor/);
  // Les deux fenêtres partagées Claude épuisées ne doivent pas étiqueter Fable.
  await fixture('claude', { quotaWindows: [{ label: 'Semaine', remaining: 0 }, { label: '5 heures', remaining: 0 }, { label: 'Fable · Semaine', remaining: 100 }] });
  assert.equal(await card('claude').locator('.resource-status').count(), 0);
  assert.equal(await row('claude').locator('.level-pill.resource-empty').count(), 0);
  assert.match(await row('claude').getAttribute('class'), /resource-healthy/);
  // Situation exacte signalée, conservée dans les captures.
  await fixture('claude', { quotaWindows: [{ label: 'Semaine', remaining: 18 }, { label: 'Fable · Semaine', remaining: 0 }, { label: '5 heures', remaining: 100 }] });
  await fixture('openrouter', { balances: [{ currency: 'USD', remaining: -0.08 }] });
  for (const surface of [dashboard, widget]) await surface.evaluate(() => { state.settings.theme = 'light'; document.documentElement.dataset.theme = 'light'; });
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=quick')).show(); });
  await dashboard.screenshot({ path: path.join(results, 'resource-status-dashboard.png'), fullPage: true });
  await widget.screenshot({ path: path.join(results, 'resource-status-widget.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: negative balances red for all 4 APIs in USD/EUR/CNY and both themes; individual quota statuses for all 5 window-based subscriptions; global status only when every displayed limit is exhausted; dashboard and widget.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
