'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLogger, cleanMessage } = require('../lib/logger.cjs');

test('le journal local reste borné, rotatif et sans sauts de ligne injectés', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lasmium-log-'));
  try {
    const logger = createLogger({ dataDir: dir, maxBytes: 160, console: null });
    await logger.info('démarrage');
    await logger.warn('ligne\ninjectée');
    await logger.error('x'.repeat(400));
    await logger.flush();
    assert.equal(cleanMessage('a\nb'), 'a b');
    const names = await fs.readdir(logger.logDir);
    assert.ok(names.includes('lasmium.log'));
    assert.ok(names.some(name => name.startsWith('lasmium.log.')));
    const body = (await Promise.all(names.map(name => fs.readFile(path.join(logger.logDir, name), 'utf8')))).join('');
    assert.equal(body.includes('\n\n'), false);
    assert.match(body, /WARN ligne injectée/);
    assert.match(body, /ERROR x{100}/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
