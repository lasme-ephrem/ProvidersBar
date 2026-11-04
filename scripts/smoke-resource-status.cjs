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
  // Le widget peut être créé après la fenêtre principale : attendre sa création.
  let widget;
  for (let attempt = 0; attempt < 50 && !widget; attempt++) {
    widget = desktop.windows().find(w => w.url().includes('mode=quick'));
    if (!widget) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(widget, 'fenêtre widget (mode=quick) introuvable');
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
    claude: [['Semaine', 'Limite hebdo atteinte'], ['Fable · Semaine', 'Limite hebdo Fable atteinte'], ['5 heures', 'Limite horaire atteinte']],
    zai: [['Semaine', 'Limite hebdo atteinte'], ['5 heures', 'Limite horaire atteinte']],
    antigravity: [['Gemini · Semaine', 'Limite Gemini · hebdo atteinte'], ['Gemini · 5 heures', 'Limite Gemini · horaire atteinte'], ['Claude et GPT · Semaine', 'Limite Claude / GPT · hebdo atteinte'], ['Claude et GPT · 5 heures', 'Limite Claude / GPT · horaire atteinte'], ['Gemini 4 Argon · Semaine', 'Limite hebdo Argon atteinte']],
    openai: [['Codex et Work · Semaine', 'Limite Codex et Work · hebdo atteinte']],
    grok: [['Semaine', 'Limite Grok · hebdo atteinte'], ['Grok Bot · Semaine', 'Limite Grok Bot · hebdo atteinte']],
  };
  // T19 : .quick-extra compte les segments masqués (2 affichés max, un par
  // libellé agrégé) — Claude et Antigravity ont 3 catégories, les autres ≤ 2.
  const extraSegments = { claude: '+1', antigravity: '+1' };
  const quickLabel = label => label.endsWith('5 heures') ? 'Horaire'
    : label.includes('Argon') ? 'Hebdo Argon'
      : label === 'Fable · Semaine' ? 'Hebdo Fable'
        : 'Hebdo';
  for (const [id, windows] of Object.entries(windowSets)) {
    for (const [exhausted, expected] of windows) {
      await fixture(id, { quotaRemaining: 0, quotaWindows: windows.map(([label]) => ({ label, remaining: label === exhausted ? 0 : 100 })) });
      assert.deepEqual(await card(id).locator('.quota-period-status').allTextContents(), [expected]);
      // Widget compact : un seul résumé par fournisseur (fenêtre la plus contrainte).
      assert.equal(await row(id).locator('.quick-period-status').count(), 0);
      // La classe de ligne reflète le niveau agrégé (les fenêtres non épuisées
      // comptent) ; le résumé .quick-value reflète la fenêtre la plus contrainte.
      const rowClass = await row(id).getAttribute('class');
      if (windows.length === 1) assert.match(rowClass, /resource-empty/);
      else assert.doesNotMatch(rowClass, /resource-empty/);
      assert.match(await row(id).locator('.quick-value').getAttribute('class'), /resource-empty/);
      assert.match(await row(id).locator('.quick-level').innerText(), /Épuisé/);
      assert.match(await row(id).locator('.quick-value-main').innerText(), /0/);
      const expectedLabel = quickLabel(exhausted);
      assert.equal(await row(id).locator('.quick-value-label').innerText(), expectedLabel);
      if (extraSegments[id]) assert.equal(await row(id).locator('.quick-extra').innerText(), extraSegments[id]);
      else assert.equal(await row(id).locator('.quick-extra').count(), 0);
      // Second segment T19 : deux segments affichés dès deux libellés agrégés.
      const categories = new Set(windows.map(([label]) => quickLabel(label))).size;
      assert.equal(await row(id).locator('.quick-segment').count(), categories >= 2 ? 2 : 1);
    }
    await fixture(id, { quotaWindows: windows.map(([label]) => ({ label, remaining: 0 })) });
    const expected = windows.length > 1 ? 'Toutes les limites atteintes' : 'Limite atteinte';
    assert.equal(await card(id).locator('.resource-status').innerText(), expected);
    // Le widget n'affiche pas de statut global redondant : résumé + niveau textuel.
    assert.match(await row(id).getAttribute('class'), /resource-empty/);
    assert.match(await row(id).locator('.quick-level').innerText(), /Épuisé/);
    assert.equal(await row(id).locator('.resource-status, .quick-resource-status').count(), 0);
  }
  await fixture('grok', { usageKind: 'x-subscription-shared', quotaWindows: [{ label: 'Semaine', remaining: 40 }] });
  assert.equal(await card('grok').locator('.quota-period').count(), 1);
  assert.equal(await row('grok').locator('.quick-value-label').innerText(), 'Hebdo');
  assert.match(await row('grok').locator('.quick-level').innerText(), /Suffisant/);
  assert.match(await card('grok').innerText(), /Grok \/ Bot \/ Cursor/);
  // Les deux fenêtres partagées Claude épuisées ne doivent pas étiqueter Fable sur la carte.
  await fixture('claude', { quotaWindows: [{ label: 'Semaine', remaining: 0 }, { label: '5 heures', remaining: 0 }, { label: 'Fable · Semaine', remaining: 100 }] });
  assert.equal(await card('claude').locator('.resource-status').count(), 0);
  // Le widget résume sur la fenêtre la plus contrainte (Semaine 0 %) : « Épuisé »,
  // tandis que la ligne reste au niveau agrégé des fenêtres (Fable 100 %).
  assert.doesNotMatch(await row('claude').getAttribute('class'), /resource-empty/);
  assert.match(await row('claude').locator('.quick-value').getAttribute('class'), /resource-empty/);
  assert.equal(await row('claude').locator('.quick-value-label').innerText(), 'Hebdo');
  assert.equal(await row('claude').locator('.quick-segment-label').innerText(), 'Horaire');
  assert.match(await row('claude').locator('.quick-segment-value').innerText(), /0/);
  assert.match(await row('claude').locator('.quick-level').innerText(), /Épuisé/);
  // Situation exacte signalée, conservée dans les captures.
  await fixture('claude', { quotaWindows: [{ label: 'Semaine', remaining: 18 }, { label: 'Fable · Semaine', remaining: 0 }, { label: '5 heures', remaining: 100 }] });
  await fixture('openrouter', { balances: [{ currency: 'USD', remaining: -0.08 }] });
  for (const surface of [dashboard, widget]) await surface.evaluate(() => { state.settings.theme = 'light'; document.documentElement.dataset.theme = 'light'; });
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('mode=quick')).show(); });
  await dashboard.screenshot({ path: path.join(results, 'resource-status-dashboard.png'), fullPage: true });
  await widget.screenshot({ path: path.join(results, 'resource-status-widget.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: negative balances red for all 4 APIs in USD/EUR/CNY and both themes; per-window quota statuses on dashboard cards (Hebdo/Horaire/Hebdo Argon) ; widget compact segmenté (.quick-value/.quick-value-label/.quick-segment*/.quick-level) sans statut par fenêtre ; global status only when every displayed limit is exhausted ; dashboard and widget.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (desktop) await desktop.close(); });
