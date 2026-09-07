// Updates application resources only, preserving the portable data directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const portable = path.join(root, 'dist', 'ProvidersBar-win32-x64');
async function closeRunningApp() {
  const data = await fs.readFile(path.join(portable, 'data', 'DevToolsActivePort'), 'utf8').catch(() => '');
  const [port, suffix] = data.trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(suffix)) return;
  const ws = new WebSocket(`ws://127.0.0.1:${port}${suffix}`);
  await new Promise(resolve => {
    const timeout = setTimeout(() => { ws.close(); resolve(); }, 5000);
    ws.addEventListener('error', () => { clearTimeout(timeout); resolve(); });
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' })));
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id === 1) {
        if (!message.result?.userAgent?.includes('ProvidersBar/')) { ws.close(); clearTimeout(timeout); resolve(); return; }
        ws.send(JSON.stringify({ id: 2, method: 'Browser.close' }));
      }
    });
    ws.addEventListener('close', () => { clearTimeout(timeout); resolve(); });
  });
}
(async () => {
  await closeRunningApp();
  const appDir = path.join(portable, 'resources', 'app');
  await fs.mkdir(appDir, { recursive: true });
  for (const name of ['main.cjs', 'preload.cjs', 'lib', 'renderer', 'mobile', 'assets', 'docs', 'README.md']) await fs.cp(path.join(root, name), path.join(appDir, name), { recursive: true });
  console.log('Portable application resources updated. Existing account data preserved.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
