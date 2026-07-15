import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function 读取相对文件(路径) {
  return await readFile(new URL(路径, root), 'utf8');
}

test('Quick deploy defaults to encoded source', async () => {
  const appJs = await 读取相对文件('public/app.js');
  assert.match(appJs, /sourceMode:\s*'encoded'/);
});

test('Quick deploy defaults to Worker create flow', async () => {
  const appJs = await 读取相对文件('public/app.js');
  assert.match(appJs, /deployType:\s*'worker'/);
  assert.match(appJs, /enableWorkersDev:\s*true/);
});

test('Worker API defaults missing sourceMode to encoded', async () => {
  const workerApi = await 读取相对文件('functions/api/[[path]].js');
  assert.match(workerApi, /if\s*\(!输出\.sourceMode\)\s*输出\.sourceMode\s*=\s*'encoded';/);
});

test('Worker API defaults missing deployType to worker', async () => {
  const workerApi = await 读取相对文件('functions/api/[[path]].js');
  assert.match(workerApi, /if\s*\(!输出\.deployType\)\s*输出\.deployType\s*=\s*'worker';/);
});

test('Local server defaults missing sourceMode to encoded', async () => {
  const serverCode = await 读取相对文件('server.mjs');
  assert.match(serverCode, /if\s*\(!输出\.sourceMode\)\s*输出\.sourceMode\s*=\s*'encoded';/);
});

test('Local server defaults missing deployType to worker', async () => {
  const serverCode = await 读取相对文件('server.mjs');
  assert.match(serverCode, /if\s*\(!输出\.deployType\)\s*输出\.deployType\s*=\s*'worker';/);
});

test('Public deploy UI does not expose plain source option', async () => {
  const indexHtml = await 读取相对文件('public/index.html');
  assert.doesNotMatch(indexHtml, /<option value="plain">/);
  assert.match(indexHtml, /<option value="encoded">/);
});

test('Public deploy UI lists worker before pages fallback option', async () => {
  const indexHtml = await 读取相对文件('public/index.html');
  assert.match(indexHtml, /<option value="worker">Worker<\/option>/);
  assert.match(indexHtml, /<option value="pages">Pages（仅更新旧项目）<\/option>/);
});
