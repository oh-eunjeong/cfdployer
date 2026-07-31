import { writeFile } from 'node:fs/promises';

export function parseEmitJsonArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--emit-json') {
      const next = argv[i + 1] || '';
      return next && !next.startsWith('--') ? next : '';
    }
    if (arg.startsWith('--emit-json=')) {
      return arg.slice('--emit-json='.length).trim();
    }
  }
  return '';
}

// 2026-07-16 ADR-001: 入口仅 worker + 自定义域, pages.dev 已确认不适用
// (cf-regress-geo-pages.mjs:341 hard guard: pages.dev 不支持 WS+VLESS)
export const ALLOWED_DEPLOY_TYPES = new Set(['worker']);
export const ALLOWED_DOMAIN_SUFFIXES = ['.pages.dev']; // 反向: 任何 deployType='worker' 的 workerDomain/apiDomain/probeDomain 不得以此结尾

function assertEntryContract(input) {
  const dt = String(input.deployType || '');
  if (!ALLOWED_DEPLOY_TYPES.has(dt)) {
    throw new Error(
      `buildDeployResult: deployType must be one of ${[...ALLOWED_DEPLOY_TYPES].join(', ')}, got '${dt}' (ADR-001)`
    );
  }
  for (const field of ['workerDomain', 'apiDomain', 'probeDomain']) {
    const v = String(input[field] || '').trim().toLowerCase();
    if (v && v.endsWith('.pages.dev')) {
      throw new Error(
        `buildDeployResult: ${field}='${v}' ends with .pages.dev, but pages.dev 已被 ADR-001 排除 (WS+VLESS 协议层不兼容)`
      );
    }
  }
}

export function buildDeployResult(input) {
  assertEntryContract(input);
  return {
    accountId: String(input.accountId || ''),
    deployType: String(input.deployType || ''),
    project: String(input.project || ''),
    uuid: String(input.uuid || ''),
    workerDomain: String(input.workerDomain || ''),
    apiDomain: String(input.apiDomain || input.workerDomain || ''),
    probeDomain: String(input.probeDomain || input.workerDomain || ''),
    pagesDomain: String(input.pagesDomain || ''),
    workersDevDomain: String(input.workersDevDomain || ''),
    preferredUrl: String(input.preferredUrl || ''),
    subUrl: String(input.subUrl || ''),
    pagesPreferredUrl: String(input.pagesPreferredUrl || ''),
    pagesSubUrl: String(input.pagesSubUrl || ''),
    workersPreferredUrl: String(input.workersPreferredUrl || ''),
    workersSubUrl: String(input.workersSubUrl || ''),
    createdAt: String(input.createdAt || ''),
    cleanup: String(input.cleanup || '')
  };
}

export async function writeDeployResult(path, obj) {
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
