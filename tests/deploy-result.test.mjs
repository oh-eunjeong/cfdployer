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
    deployType: 'worker',
    project: 'proj',
    uuid: 'uuid',
    workerDomain: 'example.workers.dev',
    apiDomain: 'example.workers.dev',
    probeDomain: 'example.workers.dev',
    pagesDomain: 'example.pages.dev',
    workersDevDomain: 'example.workers.dev',
    preferredUrl: 'https://example/pages/api/preferred-ips',
    subUrl: 'https://example/pages/sub',
    pagesPreferredUrl: 'https://example.pages.dev/uuid/api/preferred-ips',
    pagesSubUrl: 'https://example.pages.dev/uuid/sub?target=clash',
    workersPreferredUrl: 'https://example.workers.dev/uuid/api/preferred-ips',
    workersSubUrl: 'https://example.workers.dev/uuid/sub?target=clash',
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
    deployType: 'worker',
    project: 'proj',
    uuid: 'u',
    workerDomain: 'proj.example.workers.dev',
    apiDomain: 'proj.example.workers.dev',
    probeDomain: 'proj.example.workers.dev',
    pagesDomain: 'proj.pages.dev',
    workersDevDomain: 'proj.example.workers.dev',
    preferredUrl: 'https://proj.example.workers.dev/u/api/preferred-ips',
    subUrl: 'https://proj.example.workers.dev/u/sub?target=clash',
    pagesPreferredUrl: 'https://proj.pages.dev/u/api/preferred-ips',
    pagesSubUrl: 'https://proj.pages.dev/u/sub?target=clash',
    workersPreferredUrl: 'https://proj.example.workers.dev/u/api/preferred-ips',
    workersSubUrl: 'https://proj.example.workers.dev/u/sub?target=clash',
    createdAt: '2026-07-03T00:00:00.000Z',
    cleanup: 'skipped'
  });
  assert.equal(obj.workerDomain, 'proj.example.workers.dev');
  assert.equal(obj.apiDomain, 'proj.example.workers.dev');
  assert.equal(obj.probeDomain, 'proj.example.workers.dev');
  assert.equal(obj.uuid, 'u');
  assert.ok(obj.preferredUrl.includes('/u/api/preferred-ips'));
  assert.ok(obj.subUrl.includes('/u/sub'));
});
