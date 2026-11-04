'use strict';

// Mini-écrivain ZIP pour les tests, sans dépendance ni outil externe : les
// archives étaient auparavant fabriquées avec `powershell.exe`, ce qui
// confinait les tests d'extraction et de mise à jour à Windows.
//
// Format produit : méthode « store » (0), CRC-32 calculé ici, en-tête local,
// répertoire central et EOCD, sans ZIP64. Les dates sont fixes pour que deux
// archives bâties à partir des mêmes entrées soient identiques octet pour octet.
//
// API :
//   buildZip(entries) -> Buffer
//   writeZip(zipPath, entries) -> Buffer (écrit le fichier, crée le dossier parent)
// où `entries` est une liste de `{ name, data?, mode? }` :
//   - `name` : chemin dans l'archive, séparateur `/` ; un nom terminé par `/`
//     décrit une entrée de dossier (taille 0, sans données) ;
//   - `data` : Buffer ou chaîne (UTF-8) ; absent pour un dossier ;
//   - `mode` : mode Unix optionnel posé dans les bits 16-31 des attributs
//     externes (ex. `0o120777` pour simuler un lien symbolique) ; par défaut
//     `0o100644` pour un fichier et `0o040755` pour un dossier.

const fs = require('node:fs');
const path = require('node:path');

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20;
const HOST_UNIX = 3;
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;
const DOS_ATTRIBUTE_DIRECTORY = 0x10;
// 1er janvier 2026, 00:00:00 : année sur 7 bits depuis 1980, mois, jour.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function toBuffer(data, name) {
  if (data === undefined || data === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof Uint8Array) return Buffer.from(data);
  throw new TypeError(`Données invalides pour l'entrée ZIP « ${name} » : Buffer ou chaîne attendus.`);
}

function normalizeEntry(entry, index) {
  if (!entry || typeof entry !== 'object') throw new TypeError(`Entrée ZIP n°${index} invalide : objet { name, data?, mode? } attendu.`);
  if (typeof entry.name !== 'string' || !entry.name) throw new TypeError(`Entrée ZIP n°${index} sans nom.`);
  const name = Buffer.from(entry.name, 'utf8');
  if (name.length > MAX_UINT16) throw new RangeError(`Nom d'entrée ZIP trop long : ${entry.name.slice(0, 40)}…`);
  const isDirectory = entry.name.endsWith('/');
  const data = toBuffer(entry.data, entry.name);
  if (isDirectory && data.length) throw new Error(`Une entrée de dossier ne porte pas de données : ${entry.name}`);
  if (data.length > MAX_UINT32) throw new RangeError(`Entrée ZIP trop volumineuse (ZIP64 non géré) : ${entry.name}`);
  let mode = null;
  if (entry.mode !== undefined && entry.mode !== null) {
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > MAX_UINT16) {
      throw new RangeError(`Mode Unix invalide pour ${entry.name} : entier entre 0 et 0o177777 attendu.`);
    }
    mode = entry.mode;
  }
  return { name, data, isDirectory, mode };
}

// Bits 0-7 : attributs MS-DOS (0x10 = dossier) ; bits 16-31 : mode Unix.
// Sans `mode` explicite, un fichier ordinaire (0o100644) ou un dossier
// (0o040755) est décrit, comme le ferait `zip` sous Unix. `>>> 0` conserve une
// valeur non signée exploitable par writeUInt32LE.
function externalAttributes({ isDirectory, mode }) {
  const dos = isDirectory ? DOS_ATTRIBUTE_DIRECTORY : 0;
  const unix = mode === null ? (isDirectory ? 0o040755 : 0o100644) : mode;
  return ((unix << 16) | dos) >>> 0;
}

function localHeader(entry, crc) {
  const header = Buffer.alloc(30 + entry.name.length);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(FLAG_UTF8_NAMES, 6);
  header.writeUInt16LE(METHOD_STORE, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  entry.name.copy(header, 30);
  return header;
}

function centralHeader(entry, crc, offset) {
  const header = Buffer.alloc(46 + entry.name.length);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE((HOST_UNIX << 8) | VERSION_NEEDED, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(FLAG_UTF8_NAMES, 8);
  header.writeUInt16LE(METHOD_STORE, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30); // champ extra
  header.writeUInt16LE(0, 32); // commentaire
  header.writeUInt16LE(0, 34); // numéro de disque
  header.writeUInt16LE(0, 36); // attributs internes
  header.writeUInt32LE(externalAttributes(entry), 38);
  header.writeUInt32LE(offset, 42);
  entry.name.copy(header, 46);
  return header;
}

function endOfCentralDirectory(count, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(EOCD_SIGNATURE, 0);
  record.writeUInt16LE(0, 4); // disque courant
  record.writeUInt16LE(0, 6); // disque du répertoire central
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20); // commentaire d'archive
  return record;
}

function buildZip(entries) {
  if (!Array.isArray(entries)) throw new TypeError('buildZip attend une liste d’entrées.');
  const normalized = entries.map(normalizeEntry);
  if (normalized.length > MAX_UINT16) throw new RangeError('Trop d’entrées pour une archive sans ZIP64.');
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of normalized) {
    const crc = crc32(entry.data);
    const header = localHeader(entry, crc);
    central.push(centralHeader(entry, crc, offset));
    parts.push(header, entry.data);
    offset += header.length + entry.data.length;
    if (offset > MAX_UINT32) throw new RangeError('Archive trop volumineuse (ZIP64 non géré).');
  }
  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  return Buffer.concat([...parts, ...central, endOfCentralDirectory(normalized.length, centralSize, offset)]);
}

function writeZip(zipPath, entries) {
  const archive = buildZip(entries);
  fs.mkdirSync(path.dirname(path.resolve(zipPath)), { recursive: true });
  fs.writeFileSync(zipPath, archive);
  return archive;
}

module.exports = { buildZip, writeZip, crc32 };
