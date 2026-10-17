const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseClaudeDesktopUsage, usagePaths, readClaudeDesktopUsage, watchClaudeDesktopUsage } = require('../lib/claude-desktop-usage.cjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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

test('Claude uses the newest installed profile and detects an atomic quota update', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'providersbar-claude-'));
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
