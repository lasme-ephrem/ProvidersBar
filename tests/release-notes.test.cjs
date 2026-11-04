'use strict';

// Notes de version (scripts/release-notes.cjs) : section du CHANGELOG ou repli.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractChangelogSection, releaseNotes, limitNotes, fallbackNotes, MAX_NOTES_LENGTH } = require('../scripts/release-notes.cjs');

const sample = [
  '# Historique des versions',
  '',
  '## 0.6.5 — 4 novembre 2026',
  '',
  '- Correctif A.',
  '- Correctif B.',
  '',
  '### Détail',
  '',
  'Paragraphe.',
  '',
  '## 0.6.50 — version fictive',
  '',
  '- Ne doit pas être confondue avec 0.6.5.',
  '',
  '## 0.6.4 — 4 novembre 2026',
  '',
  '- Ancien correctif.',
  '',
].join('\n');

test('la section de la version est extraite sans son titre et sans la version suivante', () => {
  assert.equal(extractChangelogSection(sample, '0.6.5'), '- Correctif A.\n- Correctif B.\n\n### Détail\n\nParagraphe.');
  assert.equal(extractChangelogSection(sample, '0.6.4'), '- Ancien correctif.');
  assert.equal(extractChangelogSection(sample, '0.6.50'), '- Ne doit pas être confondue avec 0.6.5.');
  assert.equal(extractChangelogSection(sample.replace(/\n/g, '\r\n'), '0.6.4'), '- Ancien correctif.');
});

test('une version absente ou une section vide donnent null, puis le repli', () => {
  assert.equal(extractChangelogSection(sample, '0.6'), null);
  assert.equal(extractChangelogSection(sample, '1.0.0'), null);
  assert.equal(extractChangelogSection('## 1.0.0\n\n\n## 0.9.0\n- x\n', '1.0.0'), null);
  const { notes, fromChangelog } = releaseNotes(sample, '1.0.0');
  assert.equal(fromChangelog, false);
  assert.equal(notes, fallbackNotes('1.0.0'));
  assert.match(notes, /1\.0\.0/);
  assert.equal(releaseNotes(sample, '0.6.5').fromChangelog, true);
});

test('les notes restent sous la limite acceptée par le manifeste', () => {
  const long = 'x'.repeat(MAX_NOTES_LENGTH * 2);
  const limited = limitNotes(long);
  assert.ok(limited.length <= MAX_NOTES_LENGTH);
  assert.ok(limited.endsWith('[...]'));
  assert.ok(MAX_NOTES_LENGTH < 5000, 'lib/update-manifest.cjs refuse plus de 5000 caractères');
  assert.equal(limitNotes('court'), 'court');
  assert.equal(releaseNotes(`## 2.0.0\n\n${long}\n`, '2.0.0').notes.length <= MAX_NOTES_LENGTH, true);
});

test('le CHANGELOG réel fournit les notes des versions publiées', async () => {
  const changelog = await fs.readFile(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const notes = extractChangelogSection(changelog, '0.6.0');
  assert.ok(notes && notes.includes('Mise à jour automatique'), 'la section 0.6.0 doit être extraite');
  assert.doesNotMatch(notes, /^## /m, 'aucun titre de version dans les notes');
});
