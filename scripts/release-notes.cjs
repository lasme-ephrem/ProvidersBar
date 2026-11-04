'use strict';

// Notes de version d'une release : la section `## <version>` de CHANGELOG.md,
// ou une phrase simple si elle manque. Le texte sert de corps à la release
// GitHub (brouillon créé par release.yml) et de champ `notes` au manifeste
// latest.json (`npm run updater:sign -- --notes-file ...`). Jamais bloquant :
// une section absente produit le repli, pas une erreur.

const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// lib/update-manifest.cjs refuse des notes de plus de 5000 caractères.
const MAX_NOTES_LENGTH = 4000;
const TRUNCATION_MARK = '\n[...]';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Contenu de la section `## <version>` jusqu'au titre `## ` suivant, sans le
// titre lui-même ; null si la version n'est pas documentée.
function extractChangelogSection(markdown, version) {
  const lines = String(markdown).split(/\r?\n/);
  const heading = new RegExp(`^##\\s+${escapeRegExp(version)}(?![\\d.])`);
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || null;
}

function fallbackNotes(version) {
  return `Lasmium TOKENS-HUB ${version}. Détails dans CHANGELOG.md.`;
}

function limitNotes(notes, max = MAX_NOTES_LENGTH) {
  const text = String(notes);
  if (text.length <= max) return text;
  return `${text.slice(0, max - TRUNCATION_MARK.length).trimEnd()}${TRUNCATION_MARK}`;
}

function releaseNotes(markdown, version) {
  const section = extractChangelogSection(markdown, version);
  return { notes: limitNotes(section || fallbackNotes(version)), fromChangelog: Boolean(section) };
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const version = arg('--version', require('../package.json').version);
  const changelog = path.resolve(arg('--changelog', path.join(ROOT, 'CHANGELOG.md')));
  const out = path.resolve(arg('--out', path.join(ROOT, 'dist', `release-notes-${version}.md`)));
  const markdown = await fs.readFile(changelog, 'utf8').catch(() => '');
  const { notes, fromChangelog } = releaseNotes(markdown, version);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${notes}\n`, 'utf8');
  if (!fromChangelog) console.log(`::notice::CHANGELOG.md ne documente pas la version ${version} : notes de repli utilisées.`);
  console.log(`Notes     : ${path.relative(ROOT, out)} (${notes.length} caractère(s), ${fromChangelog ? 'section du CHANGELOG' : 'repli'})`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Notes de version : ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { extractChangelogSection, releaseNotes, limitNotes, fallbackNotes, MAX_NOTES_LENGTH };
