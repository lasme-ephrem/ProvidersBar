// Smoke Claude 0.3.1 — injection de pannes dans Electron, sans identifiants
// réels : USERPROFILE, LOCALAPPDATA et APPDATA pointent vers des dossiers isolés
// (profil Claude Code et relevé Claude Desktop factices), et le transport HTTP
// du processus principal (session.defaultSession.fetch) est simulé.
// Couvre : échec initial, persistance du mode direct après redémarrage, panne
// puis reprise après backoff, repli explicite en lecture Claude Desktop quand le
// renouvellement du jeton est limité et qu'aucun relevé n'existe, affichage
// utilisé/restant, absence de jeton dans les données Lasmium TOKENS-HUB.
const { _electron: electron } = require(process.env.PROVIDERSBAR_PLAYWRIGHT || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSeed } = require('../lib/seed.cjs');

const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
let desktop;

async function launch(dataDir, home, extraEnv = {}) {
  const env = { ...process.env, PROVIDERSBAR_DATA_DIR: dataDir, USERPROFILE: home, HOME: home, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({
    executablePath: process.env.PROVIDERSBAR_EXECUTABLE || require('electron'),
    args: [...(process.env.PROVIDERSBAR_EXECUTABLE ? [] : [root]), '--no-sandbox', '--disable-gpu'],
    cwd: root, env, timeout: 30000,
  });
}

function credentialDocument(overrides = {}) {
  return {
    otherAccount: { preserve: true },
    claudeAiOauth: {
      accessToken: 'fixture-live-access',
      refreshToken: 'fixture-refresh',
      expiresAt: Date.now() + 8 * 3600000,
      scopes: ['user:profile', 'user:inference'],
      subscriptionType: 'max', rateLimitTier: 'default',
      ...overrides,
    },
  };
}

async function writeCredentials(home, document) {
  const directory = path.join(home, '.claude');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, '.credentials.json'), JSON.stringify(document));
}

async function patchFetch(mode) {
  await desktop.evaluate(({ session }, data) => {
    globalThis.__claudeRequests = globalThis.__claudeRequests || { token: 0, usage: 0 };
    session.defaultSession.fetch = async (url, _options) => {
      const target = String(url);
      if (target === data.tokenUrl) {
        globalThis.__claudeRequests.token++;
        if (data.mode === 'deny-token') return { ok: false, status: 400, headers: new Headers(), json: async () => { throw new Error('hidden'); } };
        if (data.mode === 'rate-limit-token') return { ok: false, status: 429, headers: new Headers({ 'retry-after': '7200' }), json: async () => { throw new Error('hidden'); } };
        return {
          ok: true, status: 200,
          json: async () => ({ access_token: 'fixture-live-access', refresh_token: 'fixture-rotated-refresh', expires_in: 28800, scope: 'user:profile user:inference' }),
        };
      }
      if (target === data.usageUrl) {
        globalThis.__claudeRequests.usage++;
        if (data.mode === 'offline') throw new Error('Claude smoke offline');
        return {
          ok: true, status: 200,
          json: async () => ({
            five_hour: { utilization: 9, resets_at: '2099-09-30T11:00:00Z' },
            seven_day: { utilization: 42, resets_at: '2099-10-07T08:00:00Z' },
            limits: [{ display_name: 'Fable', percent: 31, resets_at: '2099-10-07T08:00:00Z' }],
          }),
        };
      }
      throw new Error(`Unexpected Claude endpoint: ${target}`);
    };
  }, { mode, tokenUrl: TOKEN_URL, usageUrl: USAGE_URL });
}

// Horloge décalée dans le processus principal pour franchir le backoff de 60 s
// sans attente réelle ; le renderer et les captures restent inchangés.
async function setMainClockOffset(offsetMs) {
  await desktop.evaluate((_electron, offset) => {
    const RealDate = globalThis.__lasmiumRealDate || Date;
    globalThis.__lasmiumRealDate = RealDate;
    globalThis.Date = class extends RealDate {
      constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
      static now() { return RealDate.now() + offset; }
    };
  }, offsetMs);
}

async function resetMainClock() {
  await desktop.evaluate(() => {
    if (globalThis.__lasmiumRealDate) {
      globalThis.Date = globalThis.__lasmiumRealDate;
      delete globalThis.__lasmiumRealDate;
    }
  });
}

async function main() {
  await fs.mkdir(results, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(results, 'claude-smoke-'));
  const home = await fs.mkdtemp(path.join(results, 'claude-home-'));
  // Isolation complète des sources Claude Desktop : sans cela, un relevé réel
  // dans %LOCALAPPDATA% déclencherait le repli T9 et changerait le scénario
  // « auth-required sans snapshot ».
  const isolatedEnv = {
    LOCALAPPDATA: await fs.mkdtemp(path.join(results, 'claude-localappdata-')),
    APPDATA: await fs.mkdtemp(path.join(results, 'claude-appdata-')),
  };
  const initial = createSeed();
  initial.settings.autoRefresh = false;
  await fs.writeFile(path.join(dataDir, 'state.json'), JSON.stringify(initial));
  // Jetons expirés et renouvellement refusé : reproduit une connexion Claude Code
  // à renouveler, sans jamais toucher au vrai profil de l'utilisateur.
  await writeCredentials(home, credentialDocument({ accessToken: 'fixture-old-access', refreshToken: 'fixture-old-refresh', expiresAt: Date.now() - 60000 }));

  desktop = await launch(dataDir, home, isolatedEnv);
  let page = await desktop.firstWindow();
  await page.waitForSelector('.cards .card');
  await patchFetch('deny-token');
  await assert.rejects(page.evaluate(() => window.lasmium.enableClaudeLive()), /renouveler/);
  const failed = (await page.evaluate(() => window.lasmium.getState())).providers.find(p => p.id === 'claude');
  assert.equal(failed.accountSession.kind, 'claude-live-local');
  assert.equal(failed.snapshot, null);
  assert.equal(failed.claudeSync.errorCode, 'auth-required');
  assert.ok(Number.isFinite(Date.parse(failed.claudeSync.nextAttemptAt)));
  await page.evaluate(() => openDetail('claude', 'connection'));
  await page.waitForFunction(() => document.querySelector('dialog')?.open);
  assert.equal(await page.locator('.connection-success').count(), 0);
  assert.match(await page.locator('.dialog-body').innerText(), /Prochaine tentative/);
  await page.screenshot({ path: path.join(results, 'claude-initial-failure.png') });
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.providers.find(p => p.id === 'claude').accountSession.kind, 'claude-live-local');
  assert.equal(saved.providers.find(p => p.id === 'claude').snapshot, null);
  const firstProcessRequests = await desktop.evaluate(() => globalThis.__claudeRequests);
  assert.ok(firstProcessRequests.token >= 1, 'le renouvellement initial doit avoir été tenté');
  await desktop.close(); desktop = null;

  // Redémarrage : le mode choisi est conservé, le cooldown d'échec est restauré.
  desktop = await launch(dataDir, home, isolatedEnv);
  page = await desktop.firstWindow();
  await page.waitForSelector('.cards .card');
  assert.equal((await page.evaluate(() => window.lasmium.getState())).providers.find(p => p.id === 'claude').accountSession.kind, 'claude-live-local');

  // Changement de connexion Claude Code (fichier local) : le cooldown d'auth est
  // levé immédiatement, comme le fait le veilleur de credentials de main.cjs.
  // Le transport simulé est installé AVANT le changement de credentials pour
  // qu'aucune lecture déclenchée pendant l'attente n'utilise le réseau réel.
  await patchFetch('success');
  await writeCredentials(home, credentialDocument());
  await page.waitForTimeout(3000);
  let claudeState, lastVerifyError;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { claudeState = await page.evaluate(() => window.lasmium.verifyAccount('claude')); break; }
    catch (error) { lastVerifyError = error; await page.waitForTimeout(500); }
  }
  if (!claudeState) {
    const pageDebug = await page.evaluate(() => {
      const claude = state.providers.find(p => p.id === 'claude');
      return { session: claude.accountSession, error: claude.error, claudeSync: claude.claudeSync };
    });
    const mainDebug = await desktop.evaluate(() => {
      const req = process.mainModule.require;
      const cc = req('./lib/claude-connection.cjs');
      const fs = req('node:fs');
      const doc = JSON.parse(fs.readFileSync(cc.CREDENTIAL_PATH, 'utf8'));
      return { path: cc.CREDENTIAL_PATH, expiresAt: doc.claudeAiOauth.expiresAt, now: Date.now(), hasClientId: doc.claudeAiOauth.clientId != null, scopes: doc.claudeAiOauth.scopes };
    });
    console.log('DEBUG CLAUDE', JSON.stringify({ pageDebug, mainDebug }));
  }
  assert.ok(claudeState, 'la vérification Claude doit réussir après le renouvellement local'
    + (lastVerifyError ? ` (dernière erreur : ${lastVerifyError.message})` : ' (aucune erreur retournée)'));
  const first = claudeState.providers.find(p => p.id === 'claude');
  assert.equal(first.accountSession.kind, 'claude-live-local');
  assert.equal(first.error, null);
  assert.deepEqual(first.snapshot.quotaWindows.map(w => w.remaining), [91, 58, 69]);
  await page.evaluate(() => openDetail('claude', 'connection'));
  await page.waitForFunction(() => document.querySelector('dialog')?.open);
  assert.equal(await page.locator('.connection-success').count(), 1);
  assert.match(await page.locator('.connection-success').innerText(), /chaque minute/);
  assert.match(await page.locator('.dialog-body').innerText(), /91 % restants/);
  assert.match(await page.locator('.dialog-body').innerText(), /9 % utilisés/);
  await page.screenshot({ path: path.join(results, 'claude-recovery.png') });

  // Panne : dernier relevé conservé, puis reprise après le backoff de 60 s.
  await patchFetch('offline');
  await setMainClockOffset(61000);
  await page.evaluate(() => window.lasmium.verifyAccount('claude')).catch(() => {});
  const failedAgain = (await page.evaluate(() => window.lasmium.getState())).providers.find(p => p.id === 'claude');
  assert.equal(failedAgain.snapshot.updatedAt, first.snapshot.updatedAt);
  assert.deepEqual(failedAgain.snapshot.quotaWindows.map(w => w.remaining), [91, 58, 69]);
  assert.ok(failedAgain.error, 'une panne doit être signalée sans effacer le relevé');
  assert.equal(await page.locator('.connection-success').count(), 0);
  await setMainClockOffset(122000);
  await patchFetch('success');
  const recovered = await page.evaluate(() => window.lasmium.verifyAccount('claude'));
  const recoveredClaude = recovered.providers.find(p => p.id === 'claude');
  assert.equal(recoveredClaude.error, null);
  assert.notEqual(recoveredClaude.snapshot.updatedAt, first.snapshot.updatedAt);
  await resetMainClock();

  // Aucun jeton ni contenu privé dans les données Lasmium TOKENS-HUB.
  const persisted = await fs.readFile(path.join(dataDir, 'state.json'), 'utf8');
  for (const forbidden of ['fixture-live-access', 'fixture-rotated-refresh', 'fixture-old-access', 'fixture-old-refresh']) {
    assert.ok(!persisted.includes(forbidden), `state.json ne doit pas contenir ${forbidden}`);
  }
  assert.equal(await page.evaluate(() => JSON.stringify(state).includes('fixture-live-access')), false);
  const requests = await desktop.evaluate(() => globalThis.__claudeRequests);
  assert.ok(requests.usage >= 3, 'lecture initiale, panne et reprise doivent avoir appelé le service');
  await page.evaluate(() => openDetail('claude', 'connection'));
  assert.equal(await page.locator('.connection-success').count(), 1);
  await page.screenshot({ path: path.join(results, 'claude-recovered.png') });
  await desktop.close(); desktop = null;

  // ------------------------------------------------------------------ *
  // Repli explicite Claude Desktop (T9) : session live sans snapshot, jeton
  // expiré dont le renouvellement est limité (auth-rate-limit), relevé Desktop
  // frais dans un LOCALAPPDATA isolé → bascule Desktop annoncée, sans écraser
  // de relevé existant, et toast neutre (T11) au lieu de « lecture directe active ».
  // ------------------------------------------------------------------ *
  const fallbackDataDir = await fs.mkdtemp(path.join(results, 'claude-fallback-data-'));
  const fallbackHome = await fs.mkdtemp(path.join(results, 'claude-fallback-home-'));
  const fallbackEnv = {
    LOCALAPPDATA: await fs.mkdtemp(path.join(results, 'claude-fallback-localappdata-')),
    APPDATA: await fs.mkdtemp(path.join(results, 'claude-fallback-appdata-')),
  };
  const profileDirectory = path.join(fallbackEnv.LOCALAPPDATA, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
  await fs.mkdir(profileDirectory, { recursive: true });
  const desktopSampleAt = Date.now() - 60000;
  // Fixture alignée sur le relevé réel observé sur cette machine : 5 h 100 %, semaine 38 %.
  await fs.writeFile(path.join(profileDirectory, 'plan-usage-history.json'), JSON.stringify({
    version: 2,
    samples: [{ t: desktopSampleAt, u: { fh: 0, sd: 62 } }],
  }));
  const fallbackInitial = createSeed();
  fallbackInitial.settings.autoRefresh = false;
  await fs.writeFile(path.join(fallbackDataDir, 'state.json'), JSON.stringify(fallbackInitial));
  await writeCredentials(fallbackHome, credentialDocument({ accessToken: 'fixture-expired-access', refreshToken: 'fixture-expired-refresh', expiresAt: Date.now() - 60000 }));

  desktop = await launch(fallbackDataDir, fallbackHome, fallbackEnv);
  page = await desktop.firstWindow();
  await page.waitForSelector('.cards .card');
  await patchFetch('rate-limit-token');
  await page.evaluate(() => openDetail('claude', 'connection'));
  await page.waitForFunction(() => document.querySelector('dialog')?.open);
  assert.equal(await page.locator('[data-action="claude-enable-live"]').count(), 1);
  await page.locator('[data-action="claude-enable-live"]').click();
  await page.waitForFunction(() => state.providers.find(p => p.id === 'claude').accountSession?.kind === 'claude-desktop-local');
  const fallback = (await page.evaluate(() => window.lasmium.getState())).providers.find(p => p.id === 'claude');
  assert.equal(fallback.error, null);
  assert.equal(fallback.snapshot.source, 'api');
  assert.deepEqual(fallback.snapshot.quotaWindows.map(window => [window.label, window.remaining]), [['5 heures', 100], ['Semaine', 38]]);
  assert.equal(fallback.claudeSync.errorCode, 'auth-rate-limit');
  assert.ok(Number.isFinite(Date.parse(fallback.claudeSync.nextAttemptAt)));
  // La fiche montre le message de bascule explicite, et le toast est neutre :
  // jamais « Lecture directe Claude activée » pour un mode Desktop (contrat T11).
  await page.waitForFunction(() => document.querySelector('.dialog-body')?.innerText.includes('relevé Claude Desktop'));
  assert.match(await page.locator('.dialog-body').innerText(), /Lecture directe indisponible/);
  assert.match(await page.locator('.dialog-body').innerText(), /Claude Desktop/);
  const fallbackToast = await page.locator('#toast').innerText();
  assert.match(fallbackToast, /Connexion Claude mise à jour|relevé Claude Desktop|Desktop/);
  assert.doesNotMatch(fallbackToast, /Lecture directe Claude activée/);
  await page.screenshot({ path: path.join(results, 'claude-desktop-fallback.png') });
  const fallbackSaved = JSON.parse(await fs.readFile(path.join(fallbackDataDir, 'state.json'), 'utf8')).providers.find(p => p.id === 'claude');
  assert.equal(fallbackSaved.accountSession.kind, 'claude-desktop-local');
  assert.deepEqual(fallbackSaved.snapshot.quotaWindows.map(window => window.remaining), [100, 38]);
  assert.equal(fallbackSaved.claudeSync.errorCode, 'auth-rate-limit');
  assert.ok(!JSON.stringify(fallbackSaved).includes('fixture-expired'));
  await desktop.close(); desktop = null;
  console.log('PASS: échec initial auth-required (Desktop isolé absent), mode direct persisté, redémarrage, reprise après renouvellement local, panne + backoff + reprise, rendu utilisé/restant, repli explicite auth-rate-limit → Claude Desktop (snapshot 100/38, message fiche, toast neutre, claudeSync auth-rate-limit persistant), aucun jeton persisté dans Lasmium TOKENS-HUB.');
}

main().catch(async error => { console.error(error); if (desktop) await desktop.close().catch(() => {}); process.exitCode = 1; });
