'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseResponse } = require('../lib/connectors.cjs');
const { validateSnapshot } = require('../lib/connector-contract.cjs');
const { loadFixtures, replayFixture, compareFixture } = require('../lib/connector-replay.cjs');

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'connectors');

test('les réponses HTTP enregistrées sont rejouées et validées par le contrat', async () => {
  const fixtures = await loadFixtures(FIXTURES);
  assert.ok(fixtures.length >= 3);
  const providers = new Set();
  for (const fixture of fixtures) {
    const snapshot = replayFixture(fixture, parseResponse);
    providers.add(fixture.provider);
    assert.equal(snapshot.source, 'api', fixture.name);
    assert.equal(snapshot.connectorVersion, `${fixture.provider}-api-v1`, fixture.name);
    compareFixture(snapshot, fixture.expect);
    assert.doesNotThrow(() => validateSnapshot(fixture.provider, snapshot), fixture.name);
  }
  assert.deepEqual([...providers].sort(), ['deepseek', 'openrouter', 'runinfra']);
});

test('une fixture de dérive est refusée avant de remplacer un relevé', () => {
  const fixture = { provider: 'openrouter', body: { data: { total_credits: 10, total_usage: 1000 } } };
  assert.throws(() => replayFixture(fixture, parseResponse), /incohérent|invalide/i);
  assert.doesNotThrow(() => validateSnapshot('openrouter', parseResponse('openrouter', { data: { total_credits: 10, total_usage: 3 } })));
});
