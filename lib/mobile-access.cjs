const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { PORT, validateOrigin, startMobileServer } = require('./mobile-server.cjs');

function createMobileAccess({ root, dataDir, safeStorage, getState, sync, port = PORT }) {
  let config = { enabled: false, origin: '', encryptedToken: '' }, server, error = '', queue = Promise.resolve();
  const file = path.join(dataDir, 'mobile-access.json');
  const code = () => config.encryptedToken ? safeStorage.decryptString(Buffer.from(config.encryptedToken, 'base64')) : '';
  const info = () => ({ enabled: Boolean(server), requested: config.enabled, origin: config.origin, code: code(), localUrl: `http://127.0.0.1:${server?.port || port}`, error });
  const save = async () => { await fs.writeFile(file + '.tmp', JSON.stringify(config), {mode:0o600}); await fs.rename(file + '.tmp', file); };
  const start = async () => { server = await startMobileServer({ root, token: code(), origin: config.origin, getState, sync, port }); };
  const serial = fn => { const result = queue.then(fn); queue = result.catch(()=>{}); return result; };
  return {
    info,
    load: async () => {
      try {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        const origin = validateOrigin(saved.origin);
        if (typeof saved.enabled !== 'boolean' || typeof saved.encryptedToken !== 'string') throw Error('Invalid configuration');
        config = { enabled: saved.enabled, origin, encryptedToken: saved.encryptedToken };
        if (!/^[a-f0-9]{48}$/.test(code())) throw Error('Invalid token');
        if (config.enabled) await start();
      } catch (e) {
        if (e.code !== 'ENOENT') error = 'Accès mobile indisponible. Vérifie que le port 4318 est libre, puis réactive l’accès.';
        if (!server) config = {enabled:false,origin:'',encryptedToken:''};
      }
    },
    update: patch => serial(async () => {
      if (!patch || typeof patch.enabled !== 'boolean' || typeof patch.origin !== 'string' || typeof patch.rotate !== 'boolean') throw Error('Configuration mobile invalide.');
      const origin = validateOrigin(patch.origin);
      if (!safeStorage.isEncryptionAvailable()) throw Error('Le chiffrement Windows est indisponible.');
      if (server) { await server.close(); server = null; }
      config = { enabled: patch.enabled, origin, encryptedToken: !config.encryptedToken || patch.rotate ? safeStorage.encryptString(randomBytes(24).toString('hex')).toString('base64') : config.encryptedToken };
      error = '';
      try { if (config.enabled) await start(); await save(); }
      catch (e) { if(server){await server.close();server=null;} config.enabled=false; error='Impossible d’activer le serveur mobile. Vérifie le port 4318 et réessaie.'; throw Error(error); }
      return info();
    }),
    close: () => serial(async()=>{if(server){await server.close();server=null;}}),
  };
}
module.exports = { createMobileAccess };
