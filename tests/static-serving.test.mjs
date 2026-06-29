import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../functions/api/[[path]].js';

test('GET / serves embedded HTML without ASSETS binding', async () => {
  const response = await worker.fetch(new Request('https://example.com/'), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const body = await response.text();
  assert.match(body, /<title>云端部署器<\/title>/);
});

test('GET /app.js serves embedded JavaScript without ASSETS binding', async () => {
  const response = await worker.fetch(new Request('https://example.com/app.js'), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /javascript/);
  const body = await response.text();
  assert.match(body, /function post\(/);
});

test('GET /styles.css serves embedded CSS without ASSETS binding', async () => {
  const response = await worker.fetch(new Request('https://example.com/styles.css'), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/css/);
  const body = await response.text();
  assert.match(body, /\.shell\s*\{/);
});

test('GET /api/accounts still returns method not allowed', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/accounts'), {}, {});
  assert.equal(response.status, 405);
  const body = await response.json();
  assert.equal(body.error, '只支持 POST');
});
