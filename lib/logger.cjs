'use strict';

// Journal local et rotatif. Il ne reçoit que des messages applicatifs : jamais
// de clé, de jeton, de session ni de contenu de page fournisseur.

const fsDefault = require('node:fs/promises');
const pathDefault = require('node:path');

const MAX_BYTES = 256 * 1024;
const KEEP = 3;

function cleanMessage(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function createLogger({
  dataDir,
  fs = fsDefault,
  path = pathDefault,
  now = Date.now,
  maxBytes = MAX_BYTES,
  keep = KEEP,
  console: consoleTarget = console,
} = {}) {
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('Dossier de journal invalide.');
  const logDir = path.join(dataDir, 'logs');
  const logPath = path.join(logDir, 'lasmium.log');
  let chain = Promise.resolve();

  async function rotateIfNeeded(incoming) {
    let size = 0;
    try { size = (await fs.stat(logPath)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (size + incoming > maxBytes && size > 0) {
      for (let index = keep; index >= 1; index -= 1) {
        const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
        const target = `${logPath}.${index}`;
        await fs.rm(target, { force: true }).catch(() => {});
        await fs.rename(source, target).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
    }
  }

  function write(level, message) {
    const line = `${new Date(now()).toISOString()} ${level.toUpperCase()} ${cleanMessage(message)}\n`;
    chain = chain.then(async () => {
      await fs.mkdir(logDir, { recursive: true });
      await rotateIfNeeded(Buffer.byteLength(line));
      await fs.appendFile(logPath, line, { mode: 0o600 });
    }).catch(error => {
      // Le journal ne doit jamais faire échouer une synchronisation.
      consoleTarget?.warn?.('Journal local indisponible :', error.message);
    });
    return chain;
  }

  return {
    logDir,
    logPath,
    info: message => { consoleTarget?.info?.(message); return write('info', message); },
    warn: message => { consoleTarget?.warn?.(message); return write('warn', message); },
    error: message => { consoleTarget?.error?.(message); return write('error', message); },
    flush: () => chain,
  };
}

module.exports = { createLogger, cleanMessage };
