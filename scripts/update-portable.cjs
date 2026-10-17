// Updates application resources only, preserving the portable data directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { updateAppResources } = require('./app-resources.cjs');
const root = path.resolve(__dirname, '..');
const portable = path.join(root, 'dist', 'ProvidersBar-win32-x64');
async function closeRunningApp() {
  const data = await fs.readFile(path.join(portable, 'data', 'DevToolsActivePort'), 'utf8').catch(() => '');
  const [port, suffix] = data.trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(suffix)) return;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${suffix}`);
  const expectedUi = pathToFileURL(path.join(portable, 'resources', 'app', 'renderer', 'index.html')).href;
  await new Promise(resolve => {
    const timeout = setTimeout(() => { ws.close(); resolve(); }, 5000);
    ws.addEventListener('error', () => { clearTimeout(timeout); resolve(); });
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' })));
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id === 1) {
        // Electron's user agent may omit the application name. The exact local
        // portable UI is stronger evidence than a product-name substring, and
        // prevents closing another browser reached through an obsolete port.
        if (!message.result?.targetInfos?.some(t => t.type === 'page' && t.url.split('?')[0].toLowerCase() === expectedUi.toLowerCase())) { ws.close(); clearTimeout(timeout); resolve(); return; }
        ws.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
      }
    });
    ws.addEventListener('close', () => { clearTimeout(timeout); resolve(); });
  });
}
async function main() {
  await closeRunningApp();
  await updateAppResources(root, portable);
  console.log('Portable application resources updated. Existing account data preserved.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { closeRunningApp };
