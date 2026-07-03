import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEmitJsonArg, buildDeployResult, writeDeployResult } from '../scripts/lib/deploy-result.mjs';

test('parseEmitJsonArg parses --emit-json path (separate arg)', () => {
  assert.equal(parseEmitJsonArg(['--emit-json', 'out.json']), 'out.json');
});

test('parseEmitJsonArg parses --emit-json=path', () => {
  assert.equal(parseEmitJsonArg(['--emit-json=out.json']), 'out.json');
});

test('writeDeployResult writes JSON without secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deploy-result-test-'));
  const out = join(dir, 'deploy_result.json');
  const obj = buildDeployResult({
    accountId: 'acc',
    deployType: 'pages',
    project: 'proj',
    uuid: 'uuid',
    workerDomain: 'example.pages.dev',
    preferredUrl: 'https://example/pages/api/preferred-ips',
    subUrl: 'https://example/pages/sub',
    createdAt: '2026-07-03T00:00:00.000Z',
    cleanup: 'skipped'
  });

  await writeDeployResult(out, obj);
  const text = await readFile(out, 'utf8');
  assert.ok(text.includes('"workerDomain"'));
  assert.ok(!text.toLowerCase().includes('token'));
});

test('buildDeployResult produces preferred/sub URLs consistent with workerDomain+uuid', () => {
  const obj = buildDeployResult({
    accountId: 'acc',
    deployType: 'pages',
    project: 'proj',
    uuid: 'u',
    workerDomain: 'proj.pages.dev',
    preferredUrl: 'https://proj.pages.dev/u/api/preferred-ips',
    subUrl: 'https://proj.pages.dev/u/sub?target=clash',
    createdAt: '2026-07-03T00:00:00.000Z',
    cleanup: 'skipped'
  });
  assert.equal(obj.workerDomain, 'proj.pages.dev');
  assert.equal(obj.uuid, 'u');
  assert.ok(obj.preferredUrl.includes('/u/api/preferred-ips'));
  assert.ok(obj.subUrl.includes('/u/sub'));
});

