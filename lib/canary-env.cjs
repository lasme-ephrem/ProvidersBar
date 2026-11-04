'use strict';

// Chargement local des clés de canary. Le fichier est ignoré par Git et ne
// remplace jamais une variable déjà définie dans l'environnement : CI et
// PowerShell restent prioritaires. Aucune valeur n'est journalisée.

const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_NAME = /^LASMIUM_CANARY_[A-Z0-9_]+$/;

function parseCanaryEnv(text) {
  const values = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!ALLOWED_NAME.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Valeur vide : traitée comme absente, jamais comme une clé valide.
    if (value) values[name] = value;
  }
  return values;
}

function loadCanaryEnv({ file = path.join(process.cwd(), '.local', 'canary.env'), env = process.env } = {}) {
  if (!fs.existsSync(file)) return { loaded: false, file, count: 0 };
  const values = parseCanaryEnv(fs.readFileSync(file, 'utf8'));
  let count = 0;
  for (const [name, value] of Object.entries(values)) {
    if (env[name]) continue;
    env[name] = value;
    count++;
  }
  return { loaded: true, file, count };
}

module.exports = { parseCanaryEnv, loadCanaryEnv };
