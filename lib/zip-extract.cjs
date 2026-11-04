'use strict';

// Extraction ZIP défensive : refuse les chemins absolus, les `..`, les liens
// symboliques et les tailles anormales. Utilisée uniquement pour une archive
// préalablement authentifiée par le manifeste signé.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

const MAX_FILES = 5000;
const MAX_BYTES = 600 * 1024 * 1024;

function safeEntryPath(root, entryName) {
  if (typeof entryName !== 'string' || !entryName || entryName.includes('\0')) throw new Error('Entrée ZIP invalide.');
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(part => part === '..')) {
    throw new Error('Entrée ZIP hors du dossier de destination.');
  }
  const target = path.resolve(root, normalized);
  const prefix = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(prefix)) throw new Error('Entrée ZIP hors du dossier de destination.');
  return target;
}

function isSymlink(entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  return mode === 0o120000;
}

async function extractZip(zipPath, destination, { maxFiles = MAX_FILES, maxBytes = MAX_BYTES } = {}) {
  const root = path.resolve(destination);
  await fsp.mkdir(root, { recursive: true });
  return new Promise((resolve, reject) => {
    let settled = false;
    let files = 0;
    let bytes = 0;
    const seen = new Set();
    const finish = error => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve({ files, bytes });
    };
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true }, (openError, zipfile) => {
      if (openError) { finish(openError); return; }
      zipfile.on('error', finish);
      zipfile.on('end', () => finish());
      zipfile.on('entry', entry => {
        (async () => {
          if (isSymlink(entry)) throw new Error('Lien symbolique refusé dans l’archive.');
          const target = safeEntryPath(root, entry.fileName);
          const relative = path.relative(root, target);
          // `tar -C dossier .` ajoute une entrée racine `./` : elle ne doit pas
          // être rejetée, mais elle ne correspond à aucun fichier à écrire.
          if (!relative) {
            zipfile.readEntry();
            return;
          }
          if (seen.has(relative)) throw new Error('Entrée ZIP dupliquée.');
          seen.add(relative);
          if (/\/$/.test(entry.fileName)) {
            await fsp.mkdir(target, { recursive: true });
            zipfile.readEntry();
            return;
          }
          if (++files > maxFiles) throw new Error('Trop de fichiers dans l’archive.');
          bytes += entry.uncompressedSize;
          if (bytes > maxBytes) throw new Error('Archive décompressée trop volumineuse.');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await new Promise((streamResolve, streamReject) => {
            zipfile.openReadStream(entry, (streamError, stream) => {
              if (streamError) { streamReject(streamError); return; }
              pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o644 }))
                .then(streamResolve, streamReject);
            });
          });
          zipfile.readEntry();
        })().catch(error => {
          try { zipfile.close(); } catch { /* déjà fermé */ }
          finish(error);
        });
      });
      zipfile.readEntry();
    });
  });
}

module.exports = { extractZip, safeEntryPath, MAX_FILES, MAX_BYTES };
