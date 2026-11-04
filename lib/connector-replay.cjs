'use strict';

// Replay de fixtures de connecteurs : les réponses HTTP réellement observées
// (anonymisées, sans clé ni identité) sont rejouées dans les parseurs et
// validées par le contrat. Un changement de schéma fournisseur se voit donc en
// test avant d'atteindre l'application.

const fsDefault = require('node:fs/promises');
const pathDefault = require('node:path');
const { validateSnapshot } = require('./connector-contract.cjs');

async function loadFixtures(dir, { fs = fsDefault, path = pathDefault } = {}) {
  let names;
  try { names = (await fs.readdir(dir)).filter(name => name.endsWith('.json')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const fixtures = [];
  for (const name of names) {
    const raw = await fs.readFile(path.join(dir, name), 'utf8');
    let fixture;
    try { fixture = JSON.parse(raw); }
    catch { throw new Error(`Fixture illisible : ${name}`); }
    if (!fixture || typeof fixture.provider !== 'string' || !fixture.body || !fixture.expect) {
      throw new Error(`Fixture incomplète : ${name}`);
    }
    fixtures.push({ name, ...fixture });
  }
  return fixtures;
}

function replayFixture(fixture, parseResponse) {
  const snapshot = parseResponse(fixture.provider, fixture.body);
  validateSnapshot(fixture.provider, snapshot);
  return snapshot;
}

function compareFixture(snapshot, expect) {
  for (const [key, value] of Object.entries(expect || {})) {
    const actual = snapshot[key];
    if (JSON.stringify(actual) !== JSON.stringify(value)) {
      throw new Error(`Champ « ${key} » différent : attendu ${JSON.stringify(value)}, obtenu ${JSON.stringify(actual)}`);
    }
  }
}

module.exports = { loadFixtures, replayFixture, compareFixture };
