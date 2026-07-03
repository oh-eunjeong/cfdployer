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

export function buildDeployResult(input) {
  return {
    accountId: String(input.accountId || ''),
    deployType: String(input.deployType || ''),
    project: String(input.project || ''),
    uuid: String(input.uuid || ''),
    workerDomain: String(input.workerDomain || ''),
    preferredUrl: String(input.preferredUrl || ''),
    subUrl: String(input.subUrl || ''),
    createdAt: String(input.createdAt || ''),
    cleanup: String(input.cleanup || '')
  };
}

export async function writeDeployResult(path, obj) {
  await writeFile(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

