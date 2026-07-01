import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

function pickEnv(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : '';
}

function requireEnv(name) {
  const v = pickEnv(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function run(cmd, args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = {
    ...process.env,
    ...options.env
  };

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const err = new Error(`${cmd} ${args.join(' ')} exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
      }
    });
  });
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseKvNamespaceId(output) {
  const combined = output || '';
  const m = combined.match(/[0-9a-f]{32}/i);
  if (!m) throw new Error(`Failed to parse KV namespace id from output:\n${combined}`);
  return m[0].toLowerCase();
}

async function fetchText(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  return { status: res.status, text };
}

async function retry(fn, { retries = 10, delayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

const args = new Set(process.argv.slice(2));
const keep = args.has('--keep');
const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
const apiToken = pickEnv('CLOUDFLARE_API_TOKEN') || pickEnv('CF_API_TOKEN');
if (!apiToken) throw new Error('Missing env: CLOUDFLARE_API_TOKEN (or CF_API_TOKEN)');

const compatDate = pickEnv('CF_COMPATIBILITY_DATE') || '2026-01-20';
const uuid = pickEnv('CF_UUID') || crypto.randomUUID();
const suffix = slugify(new Date().toISOString().replace(/[:.]/g, '-')).slice(0, 32);
const project = slugify(pickEnv('CF_PAGES_PROJECT') || `cfnew-geo-regress-${suffix}`);
const kvTitle = slugify(pickEnv('CF_KV_TITLE') || `kv-geo-regress-${suffix}`);
const envForWrangler = {
  CLOUDFLARE_ACCOUNT_ID: accountId,
  CLOUDFLARE_API_TOKEN: apiToken
};

const selfRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const cfnewDir = join(repoRoot, 'cfnew');
const encodedPath = join(cfnewDir, '少年你相信光吗');

const workDir = await mkdtemp(join(tmpdir(), 'cfnew-geo-regress-'));
const pagesDir = join(workDir, 'pages');
await mkdir(pagesDir, { recursive: true });
await copyFile(encodedPath, join(pagesDir, '_worker.js'));
await writeFile(join(pagesDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>cfnew-geo-regress</title>', 'utf8');

process.stdout.write(`account=${accountId}\n`);
process.stdout.write(`project=${project}\n`);
process.stdout.write(`kvTitle=${kvTitle}\n`);
process.stdout.write(`uuid=${uuid}\n`);

await run('npx', ['-y', 'wrangler', 'pages', 'project', 'create', project, '--production-branch', 'main', '--compatibility-date', compatDate], {
  cwd: selfRoot,
  env: envForWrangler
});

const kvCreate = await run('npx', ['-y', 'wrangler', 'kv', 'namespace', 'create', kvTitle], {
  cwd: selfRoot,
  env: envForWrangler
});
const kvId = parseKvNamespaceId((kvCreate.stdout || '') + (kvCreate.stderr || ''));

await run('npx', ['-y', 'wrangler', 'kv', 'key', 'put', '--remote', '--namespace-id', kvId, 'c', '{}'], {
  cwd: selfRoot,
  env: envForWrangler
});
await run('npx', ['-y', 'wrangler', 'kv', 'key', 'put', '--remote', '--namespace-id', kvId, 'c_ver', String(Date.now())], {
  cwd: selfRoot,
  env: envForWrangler
});

await writeFile(
  join(pagesDir, 'wrangler.toml'),
  [
    `name = "${project}"`,
    `compatibility_date = "${compatDate}"`,
    'pages_build_output_dir = "."',
    '',
    '[vars]',
    `u = "${uuid}"`,
    '',
    '[[kv_namespaces]]',
    'binding = "C"',
    `id = "${kvId}"`
  ].join('\n') + '\n',
  'utf8'
);

await run('npx', ['-y', 'wrangler', 'pages', 'deploy', '.', '--project-name', project, '--branch', 'main', '--commit-dirty', 'true', '--no-bundle'], {
  cwd: pagesDir,
  env: envForWrangler
});

const base = `https://${project}.pages.dev/${uuid}`;
const configUrl = `${base}/api/config`;
const preferredUrl = `${base}/api/preferred-ips`;
const subUrl = `${base}/sub?target=clash`;

await retry(async () => {
  const r = await fetchText(configUrl);
  if (r.status >= 500) throw new Error(`config not ready: ${r.status}`);
  return r;
}, { retries: 20, delayMs: 1500 });

await fetchText(configUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ae: 'yes', ena: 'no', epd: 'no', epi: 'yes', egi: 'no' })
});

await fetchText(preferredUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([{
    ip: '1.1.1.1',
    port: 443,
    name: '🇸🇬新加坡-优选节点-11',
    regionCode: 'SG',
    country: '新加坡',
    city: '新加坡',
    sourceType: 'preferred'
  }])
});

const preferred = await fetchText(preferredUrl);
if (!preferred.text.includes('🇸🇬新加坡-优选节点-11')) {
  throw new Error(`preferred-ips missing expected name. body=${preferred.text}`);
}

const sub = await fetchText(subUrl);
let decoded = '';
try {
  decoded = Buffer.from(sub.text.trim(), 'base64').toString('utf8');
} catch {
  decoded = sub.text;
}
if (!decoded.includes('🇸🇬新加坡-优选节点-11')) {
  throw new Error('sub missing expected name');
}
if (decoded.includes('所有节点获取失败')) {
  throw new Error('sub contains failure marker: 所有节点获取失败');
}

process.stdout.write(`ok\n`);
process.stdout.write(`preferred=${preferredUrl}\n`);
process.stdout.write(`sub=${subUrl}\n`);

if (!keep) {
  await run('npx', ['-y', 'wrangler', 'pages', 'project', 'delete', project, '--yes'], {
    cwd: selfRoot,
    env: envForWrangler
  });
  await run('npx', ['-y', 'wrangler', 'kv', 'namespace', 'delete', '--namespace-id', kvId, '--skip-confirmation'], {
    cwd: selfRoot,
    env: envForWrangler
  });
  await rm(workDir, { recursive: true, force: true });
}
