'use strict';

// Mini-écrivain ZIP pour les tests, en JavaScript pur : méthode « store »
// (aucune compression), CRC-32 calculé localement, en-têtes locaux, répertoire
// central et enregistrement de fin (EOCD). Les fixtures PowerShell de
// tests/zip-extract.test.cjs ne fonctionnent que sous Windows ; ce helper permet
// d'exercer lib/zip-extract.cjs et les scripts de release sur toute plateforme.
//
//   writeZip(zipPath, [{ name: 'app/main.cjs', data: 'ok' }, { name: 'docs/' }])
//
// `data` est un Buffer ou une chaîne (UTF-8). Une entrée dont le nom finit par
// `/` est un dossier (sans données). `mode` (facultatif) fixe les bits de mode
// Unix stockés dans les attributs externes, par exemple 0o120777 pour simuler
// un lien symbolique.

const fs = require('node:fs/promises');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const FLAG_UTF8 = 0x0800;
const VERSION_MADE_BY = 0x031E; // Unix (3), spécification 3.0 : attributs externes = mode Unix << 16
const VERSION_NEEDED = 20;
const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01

function normalizeEntry(entry) {
  if (!entry || typeof entry.name !== 'string' || !entry.name) throw new Error('Entrée ZIP sans nom.');
  const directory = entry.name.endsWith('/');
  const data = entry.data === undefined || entry.data === null ? Buffer.alloc(0)
    : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
  if (directory && data.length) throw new Error(`Un dossier ne porte pas de données : ${entry.name}`);
  const mode = Number.isInteger(entry.mode) ? entry.mode : directory ? 0o40755 : 0o100644;
  const externalAttributes = ((mode << 16) | (directory ? 0x10 : 0)) >>> 0;
  return { name: Buffer.from(entry.name, 'utf8'), data, crc: crc32(data), externalAttributes };
}

function buildZip(entries) {
  if (!Array.isArray(entries)) throw new Error('entries doit être une liste.');
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const raw of entries) {
    const entry = normalizeEntry(raw);
    const local = Buffer.alloc(30 + entry.name.length);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // méthode store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(entry.name.length, 26);
    local.writeUInt16LE(0, 28);
    entry.name.copy(local, 30);

    const central = Buffer.alloc(46 + entry.name.length);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // commentaire
    central.writeUInt16LE(0, 34); // disque
    central.writeUInt16LE(0, 36); // attributs internes
    central.writeUInt32LE(entry.externalAttributes, 38);
    central.writeUInt32LE(offset, 42);
    entry.name.copy(central, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }
  const centralSize = centrals.reduce((total, buffer) => total + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

async function writeZip(zipPath, entries) {
  const archive = buildZip(entries);
  await fs.writeFile(zipPath, archive);
  return archive;
}

module.exports = { writeZip, buildZip, crc32 };
