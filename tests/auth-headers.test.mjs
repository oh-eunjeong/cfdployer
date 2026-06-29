import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/[[path]].js';

test('API Token credentials use Authorization header', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, result: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const request = new Request('https://example.com/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentials: {
          email: 'user@example.com',
          key: 'cfk_example_api_token'
        }
      })
    });

    const response = await onRequestPost({ request });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer cfk_example_api_token');
    assert.equal(calls[0].init.headers['X-Auth-Key'], undefined);
    assert.equal(calls[0].init.headers['X-Auth-Email'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Global API Key credentials keep X-Auth headers', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, result: [] }), {
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const request = new Request('https://example.com/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentials: {
          email: 'user@example.com',
          key: 'global-api-key-value'
        }
      })
    });

    const response = await onRequestPost({ request });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers['X-Auth-Email'], 'user@example.com');
    assert.equal(calls[0].init.headers['X-Auth-Key'], 'global-api-key-value');
    assert.equal(calls[0].init.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
