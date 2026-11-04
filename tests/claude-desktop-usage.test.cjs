const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseClaudeDesktopUsage, usagePaths, readClaudeDesktopUsage, watchClaudeDesktopUsage } = require('../lib/claude-desktop-usage.cjs');
const { shouldFallbackToClaudeDesktop, claudeDesktopGuidance } = require('../lib/provider-flows.cjs');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- Décision de repli Claude (T9/T15) --------------------------------------
// La décision vit dans main.cjs mais ne dépend pas d'Electron : elle est extraite
// de la source et exécutée ici pour couvrir chaque branche sans lancer l'app.
function loadMainHelper(name) {
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `fonction ${name} introuvable dans main.cjs`);
  assert.equal(source.lastIndexOf(marker), start, `fonction ${name} définie plusieurs fois dans main.cjs`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  assert.ok(end > open, `fonction ${name} incomplète dans main.cjs`);
  return new Function(`return (${source.slice(start, end)})`)();
}

const FALLBACK_NOW = Date.parse('2026-11-04T00:40:00.000Z');
const freshSnapshot = { updatedAt: new Date(FALLBACK_NOW - 5 * 60000).toISOString() };
const staleSnapshot = { updatedAt: new Date(FALLBACK_NOW - 11 * 60000).toISOString() };
const sixDayOldSnapshot = { updatedAt: new Date(FALLBACK_NOW - 6 * 86400000).toISOString() };

test('Claude direct fallback triggers on 429/auth failures when the last reading is absent or stale', () => {
  const shouldFallback = shouldFallbackToClaudeDesktop;
  const eligible = ['rate-limit', 'auth-rate-limit', 'auth-required', 'auth-unavailable', 'auth-busy', 'auth-save', 'auth-network', 'auth-refused', 'auth-whatever'];
  const notEligible = ['network', 'service', 'format', 'API_RATE_LIMIT', 'rate_limit', 'auth', '', null, undefined, 429];

  // 1) Relevé absent (null, undefined, objet sans updatedAt valide) : bascule.
  for (const absent of [null, undefined, {}, { updatedAt: 'pas une date' }, { updatedAt: null }]) {
    for (const code of eligible) assert.equal(shouldFallback(code, absent, FALLBACK_NOW), true, `repli attendu ${code} / absent`);
  }
  // 2) Relevé périmé (> 10 min) : bascule, même si un ancien relevé existe.
  for (const stale of [staleSnapshot, sixDayOldSnapshot]) {
    for (const code of eligible) assert.equal(shouldFallback(code, stale, FALLBACK_NOW), true, `repli attendu ${code} / périmé`);
  }
  // 3) Relevé frais (< 10 min) : jamais de bascule (comportement T9 conservé).
  for (const code of [...eligible, ...notEligible]) assert.equal(shouldFallback(code, freshSnapshot, FALLBACK_NOW), false, `pas de bascule si frais (${String(code)})`);
  // 4) Codes non liés à l'authentification/quota : pas de bascule.
  for (const code of notEligible) assert.equal(shouldFallback(code, sixDayOldSnapshot, FALLBACK_NOW), false, `pas de repli pour ${String(code)}`);
  // 5) Seuil exact de 10 minutes.
  assert.equal(shouldFallback('auth-rate-limit', { updatedAt: new Date(FALLBACK_NOW - 10 * 60000).toISOString() }, FALLBACK_NOW), false);
  assert.equal(shouldFallback('auth-rate-limit', { updatedAt: new Date(FALLBACK_NOW - 10 * 60000 - 1).toISOString() }, FALLBACK_NOW), true);
});

test('Claude Desktop stale readings are only returned when allowStale is explicit', async t => {
  const now = new Date('2026-11-04T00:40:00.000Z');
  const sample = { t: Date.parse('2026-11-03T23:54:00.000Z'), u: { fh: 0, sd: 62 } }; // 46 min
  const history = { version: 2, samples: [sample] };
  // Mode Desktop direct : un échantillon de plus de 45 min reste une erreur.
  assert.throws(() => parseClaudeDesktopUsage(history, null, now), /45 minutes/);
  // Repli : la dernière mesure honnête est affichée, datée et marquée ancienne.
  const stale = parseClaudeDesktopUsage(history, null, now, { allowStale: true });
  assert.equal(stale.updatedAt, new Date(sample.t).toISOString());
  assert.equal(stale.stale, true);
  assert.match(stale.quotaLabel, /relevé ancien/);
  assert.deepEqual(stale.quotaWindows.map(window => window.remaining), [100, 38]);
  // Un échantillon frais ne porte pas le drapeau stale.
  const fresh = parseClaudeDesktopUsage({ version: 2, samples: [{ t: now.getTime() - 60000, u: { fh: 5, sd: 40 } }] }, null, now, { allowStale: true });
  assert.equal(Object.hasOwn(fresh, 'stale'), false);
  assert.doesNotMatch(fresh.quotaLabel, /relevé ancien/);

  // Même comportement via le lecteur de fichiers et l'option transmise.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-claude-stale-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = path.join(root, 'local', 'Claude-Data', 'claude_pzs8sxrjxfjjc');
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'plan-usage-history.json'), JSON.stringify(history));
  const options = { localAppData: path.join(root, 'local'), roamingAppData: path.join(root, 'roaming'), now };
  await assert.rejects(readClaudeDesktopUsage(null, options), /45 minutes/);
  const fromFile = await readClaudeDesktopUsage(null, { ...options, allowStale: true });
  assert.equal(fromFile.stale, true);
  assert.deepEqual(fromFile.quotaWindows.map(window => window.remaining), [100, 38]);
});

test('Claude direct fallback announces the switch and keeps an actionable guidance', () => {
  const guidance = claudeDesktopGuidance;
  const message = guidance();
  assert.match(message, /Claude Desktop/);
  assert.match(message, /page Utilisation/);
  assert.match(message, /Claude Code/);
  const source = fsSync.readFileSync(path.join(__dirname, '..', 'lib', 'provider-flows.cjs'), 'utf8');
  assert.ok(
    source.includes('Lecture directe indisponible (renouvellement du jeton Claude Code limité) ; Lasmium TOKENS-HUB utilise le relevé Claude Desktop.'),
    'le message de bascule explicite doit rester câblé dans verifyClaudeDesktop',
  );
  assert.ok(
    source.includes('Lasmium TOKENS-HUB utilise le dernier relevé Claude Desktop connu (relevé ancien).'),
    'la variante « relevé ancien » doit rester annoncée dans verifyClaudeDesktop',
  );
  assert.ok(source.includes('{ allowStale: true }'), 'le repli doit lire le relevé Desktop avec allowStale');
});

test('Claude Desktop history supplies only the two remaining plan quotas and preserves known future resets', () => {
  const now = new Date('2026-09-26T00:55:00.000Z');
  const sample = { t: Date.parse('2026-09-26T00:48:00.000Z'), org: 'private-account-id', u: { fh: 12, sd: 9 } };
  const previous = { updatedAt: '2026-09-26T00:36:00.000Z', quotaWindows: [
    { label: '5 heures', resetAt: '2026-09-26T02:40:00.000Z' },
    { label: 'Semaine', resetAt: '2026-09-30T08:00:00.000Z' },
  ] };
  const snapshot = parseClaudeDesktopUsage({ version: 2, samples: [sample] }, previous, now);
  assert.equal(snapshot.quotaRemaining, 88);
  assert.deepEqual(snapshot.quotaWindows, [
    { label: '5 heures', remaining: 88, resetAt: previous.quotaWindows[0].resetAt },
    { label: 'Semaine', remaining: 91, resetAt: previous.quotaWindows[1].resetAt },
  ]);
  assert.equal(snapshot.updatedAt, new Date(sample.t).toISOString());
  assert.equal(snapshot.connectorVersion, 'claude-desktop-local-v1');
  assert.equal(JSON.stringify(snapshot).includes(sample.org), false);
  assert.match(usagePaths('C:\\Local', 'C:\\Roaming')[0], /Claude_pzs8sxrjxfjjc/);
});

test('Claude Desktop history rejects stale or changed data and does not invent expired reset dates', () => {
  const now = new Date('2026-09-26T00:55:00.000Z');
  const sample = { t: Date.parse('2026-09-26T00:48:00.000Z'), org: 'private', u: { fh: 12, sd: 9 } };
  const history = { version: 2, samples: [sample] };
  const previous = { updatedAt: '2026-09-26T00:36:00.000Z', quotaWindows: [{ label: '5 heures', resetAt: '2026-09-26T00:40:00.000Z' }] };
  assert.equal(parseClaudeDesktopUsage(history, previous, now).quotaWindows[0].resetAt, null);
  assert.throws(() => parseClaudeDesktopUsage({ version: 3, samples: [sample] }, previous, now), /format/);
  assert.throws(() => parseClaudeDesktopUsage({ version: 2, samples: [{ ...sample, u: { fh: 101, sd: 9 } }] }, previous, now), /incomplet/);
  assert.throws(() => parseClaudeDesktopUsage(history, previous, new Date('2026-09-26T02:00:00.000Z')), /45 minutes/);
  assert.throws(() => parseClaudeDesktopUsage(history, previous, new Date('2026-09-26T02:00:00.000Z')), /même ouvert/);
  assert.throws(() => parseClaudeDesktopUsage(history, { updatedAt: '2026-09-26T00:50:00.000Z' }, now), /plus ancien/);
});

test('A newer unreadable profile never hides the other valid Claude Desktop profile', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-claude-fallback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { localAppData: path.join(root, 'local'), roamingAppData: path.join(root, 'roaming'), now: new Date('2026-09-26T00:55:00.000Z') };
  const files = usagePaths(options.localAppData, options.roamingAppData);
  for (const file of files) await fs.mkdir(path.dirname(file), { recursive: true });
  const older = Date.parse('2026-09-26T00:25:00.000Z');
  await fs.writeFile(files[0], JSON.stringify({ version: 2, samples: [{ t: older, u: { fh: 20, sd: 10 } }] }));
  // The newest profile has a format this version cannot read.
  await fs.writeFile(files[1], JSON.stringify({ version: 3, samples: [{ t: Date.parse('2026-09-26T00:48:00.000Z'), u: { fh: 10, sd: 5 } }] }));
  const snapshot = await readClaudeDesktopUsage(null, options);
  assert.deepEqual(snapshot.quotaWindows.map(window => window.remaining), [80, 90]);
  assert.equal(snapshot.updatedAt, new Date(older).toISOString());
  // When no profile is readable, the newest error is the one reported.
  await fs.writeFile(files[0], JSON.stringify({ version: 3, samples: [] }));
  await assert.rejects(readClaudeDesktopUsage(null, options), /format/);
});

test('Claude Desktop discovers the Claude-Data instance profiles and reads the real layout', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-claude-data-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, 'local');
  const roaming = path.join(root, 'roaming');
  const profile = path.join(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
  const sampleTime = Date.parse('2026-09-26T00:48:00.000Z');
  await fs.mkdir(profile, { recursive: true });
  const usageFile = path.join(profile, 'plan-usage-history.json');
  await fs.writeFile(usageFile, JSON.stringify({ version: 2, samples: [{ t: sampleTime, u: { fh: 0, sd: 62 } }] }));
  // Only the documented aggregate file may be selected from the profile.
  await fs.writeFile(path.join(profile, 'other.json'), JSON.stringify({ private: 'never read' }));
  const paths = usagePaths(local, roaming);
  assert.ok(paths.includes(usageFile));
  assert.equal(paths.filter(candidate => candidate.includes('Claude-Data')).length, 1);
  assert.ok(paths.every(candidate => candidate.endsWith('plan-usage-history.json')));
  const options = { localAppData: local, roamingAppData: roaming, now: new Date(sampleTime + 60000) };
  const snapshot = await readClaudeDesktopUsage(null, options);
  assert.deepEqual(snapshot.quotaWindows.map(window => window.remaining), [100, 38]);
  assert.equal(snapshot.updatedAt, new Date(sampleTime).toISOString());
  // A sample older than 45 minutes keeps its actionable message.
  await assert.rejects(readClaudeDesktopUsage(null, { ...options, now: new Date(sampleTime + 46 * 60000) }), /45 minutes/);
});

test('Claude Desktop watcher follows an atomic update written by Claude-Data', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-claude-data-watch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, 'local');
  const profile = path.join(local, 'Claude-Data', 'claude_pzs8sxrjxfjjc');
  await fs.mkdir(profile, { recursive: true });
  const usageFile = path.join(profile, 'plan-usage-history.json');
  const now = Date.parse('2026-09-26T00:48:00.000Z');
  await fs.writeFile(usageFile, JSON.stringify({ version: 2, samples: [{ t: now, u: { fh: 10, sd: 20 } }] }));
  const options = { localAppData: local, roamingAppData: path.join(root, 'roaming'), interval: 20 };
  const changed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Claude-Data quota update was not detected')), 3000);
    const stop = watchClaudeDesktopUsage(() => { clearTimeout(timeout); resolve(); }, options);
    t.after(() => { clearTimeout(timeout); stop(); });
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  const temporary = usageFile + '.tmp';
  await fs.writeFile(temporary, JSON.stringify({ version: 2, samples: [{ t: now + 1, u: { fh: 11, sd: 21 } }] }));
  await fs.rename(temporary, usageFile);
  await changed;
});

test('An absent Claude-Data directory silently keeps the historical layouts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-claude-legacy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const paths = usagePaths(path.join(root, 'local'), path.join(root, 'roaming'));
  assert.equal(paths.length, 2);
  assert.match(paths[0], /Packages[\\/]Claude_pzs8sxrjxfjjc/);
  assert.match(paths[1], /Claude[\\/]plan-usage-history\.json$/);
  await assert.rejects(readClaudeDesktopUsage(null, { localAppData: path.join(root, 'local'), roamingAppData: path.join(root, 'roaming') }), /Aucun relevé local trouvé/);
});

test('Claude uses the newest installed profile and detects an atomic quota update', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-claude-'));
  const options = { localAppData: path.join(root, 'local'), roamingAppData: path.join(root, 'roaming'), interval: 20 };
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = usagePaths(options.localAppData, options.roamingAppData);
  const now = Date.now();
  for (const [i, file] of files.entries()) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ version: 2, samples: [{ t: now - (i ? 0 : 7200000), u: { fh: i ? 20 : 10, sd: 19 } }] }));
  }
  const first = await readClaudeDesktopUsage(null, options);
  assert.equal(first.quotaWindows[0].remaining, 80);
  assert.equal(first.updatedAt, new Date(now).toISOString());
  let stop;
  const changed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Quota file update was not detected')), 3000);
    stop = watchClaudeDesktopUsage(() => { clearTimeout(timeout); resolve(); }, options);
    t.after(() => { clearTimeout(timeout); stop(); });
  });
  // Let watchFile establish its baseline, then replace the file as Claude does.
  await new Promise(resolve => setTimeout(resolve, 60));
  const temporary = files[1] + '.tmp';
  await fs.writeFile(temporary, JSON.stringify({ version: 2, samples: [{ t: now + 1, u: { fh: 21, sd: 20 } }] }));
  await fs.rename(temporary, files[1]);
  await changed;
  const second = await readClaudeDesktopUsage(first, options);
  assert.deepEqual(second.quotaWindows.map(w => w.remaining), [79, 80]);
  assert.equal(second.updatedAt, new Date(now + 1).toISOString());
});
