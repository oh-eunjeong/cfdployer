import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { buildDeployResult, parseEmitJsonArg, writeDeployResult } from './lib/deploy-result.mjs';

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

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 20000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(timeoutId);
  const text = await res.text();
  return {
    status: res.status,
    text,
    contentType: res.headers.get('content-type') || ''
  };
}

async function cfApi(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    ...options.headers
  };
  let body = options.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body && typeof body === 'object' && !(body instanceof Uint8Array) && !isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 20000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers,
    body,
    signal: controller.signal
  });
  clearTimeout(timeoutId);
  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';
  let data = text;
  if (contentType.includes('application/json')) {
    data = JSON.parse(text);
    if (!res.ok || data.success === false) {
      throw new Error(`Cloudflare API ${method} ${path} failed: ${JSON.stringify(data)}`);
    }
    return data.result;
  }
  if (!res.ok) {
    throw new Error(`Cloudflare API ${method} ${path} failed: ${text}`);
  }
  return data;
}

function isNetworkishError(err) {
  const msg = String(err?.message || '');
  const causeMsg = String(err?.cause?.message || '');
  const code = String(err?.code || err?.cause?.code || '').toLowerCase();
  return /fetch failed/i.test(msg) ||
    /connect timeout/i.test(msg) ||
    /disconnected before secure tls/i.test(msg) ||
    code === 'econnreset' ||
    code === 'und_err_connect_timeout' ||
    /epipe/i.test(msg) ||
    /epipe/i.test(causeMsg);
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

async function cfApiWithRetry(path, options = {}) {
  const retries = options.retries || 6;
  const delayMs = options.delayMs || 1500;
  return await retry(async () => {
    try {
      return await cfApi(path, options);
    } catch (err) {
      if (isNetworkishError(err)) throw err;
      throw err;
    }
  }, { retries, delayMs });
}

function buildServiceUrls(domain, uuid) {
  const base = `https://${domain}/${uuid}`;
  return {
    domain,
    base,
    configUrl: `${base}/api/config`,
    preferredUrl: `${base}/api/preferred-ips`,
    subUrl: `${base}/sub?target=clash`
  };
}

async function ensureWorkersDevEnabled(accountId, scriptName) {
  try {
    await cfApiWithRetry(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`, {
      method: 'POST',
      body: { enabled: true }
    });
  } catch {
    await cfApiWithRetry(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(scriptName)}/subdomain`, {
      method: 'PUT',
      body: { enabled: true }
    });
  }
}

async function tryDeployWorkersMirror({ accountId, project, uuid, kvId, encodedPath }) {
  const code = await readFile(encodedPath, 'utf8');
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    main_module: 'worker.js',
    compatibility_date: compatDate,
    bindings: [
      { type: 'plain_text', name: 'u', text: uuid },
      { type: 'kv_namespace', name: 'C', namespace_id: kvId }
    ]
  })], { type: 'application/json' }), 'metadata.json');
  form.append('worker.js', new Blob([code], { type: 'application/javascript+module' }), 'worker.js');

  await cfApiWithRetry(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(project)}`, {
    method: 'PUT',
    body: form
  });
  await ensureWorkersDevEnabled(accountId, project);

  const subdomainResult = await cfApiWithRetry(`/accounts/${accountId}/workers/subdomain`);
  const accountSubdomain = String(subdomainResult?.subdomain || '').trim();
  if (!accountSubdomain) {
    throw new Error('workers.dev subdomain is empty for this account');
  }
  return `${project}.${accountSubdomain}.workers.dev`;
}

const argv = process.argv.slice(2);
const args = new Set(argv);
const keep = args.has('--keep');
const emitJsonPath = parseEmitJsonArg(argv);
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

const repoRoot = fileURLToPath(new URL('..', new URL('..', import.meta.url)));
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

await cfApiWithRetry(`/accounts/${accountId}/pages/projects`, {
  method: 'POST',
  body: {
    name: project,
    production_branch: 'main'
  }
});

const kvCreate = await cfApiWithRetry(`/accounts/${accountId}/storage/kv/namespaces`, {
  method: 'POST',
  body: {
    title: kvTitle
  }
});
const kvId = kvCreate.id.toLowerCase();

await cfApiWithRetry(`/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/c`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'text/plain;charset=UTF-8'
  },
  body: '{}'
});
await cfApiWithRetry(`/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/c_ver`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'text/plain;charset=UTF-8'
  },
  body: String(Date.now())
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

{
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await run('npx', ['-y', 'wrangler@4.106.0', 'pages', 'deploy', '.', '--project-name', project, '--branch', 'main', '--commit-dirty', 'true', '--no-bundle'], {
        cwd: pagesDir,
        env: envForWrangler
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const stderr = String(err?.stderr || '');
      const isFetchFailed = /fetch failed/i.test(stderr) || /connectivity issue/i.test(stderr);
      if (!isFetchFailed) throw err;

      const m = stderr.match(/Logs were written to "([^"]+)"/);
      const logPath = m ? m[1] : '';
      if (logPath) {
        try {
          const logText = await readFile(logPath, 'utf8');
          const tail = logText.split('\n').slice(-120).join('\n');
          process.stdout.write(`wrangler_log_tail_attempt_${attempt}=${logPath}\n${tail}\n`);
        } catch {}
      }
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  if (lastErr) throw lastErr;
}

const pagesService = buildServiceUrls(`${project}.pages.dev`, uuid);
let workersDevDomain = '';
let workersService = null;

try {
  workersDevDomain = await tryDeployWorkersMirror({
    accountId,
    project,
    uuid,
    kvId,
    encodedPath
  });
  workersService = buildServiceUrls(workersDevDomain, uuid);
  process.stdout.write(`workers_dev=${workersDevDomain}\n`);
} catch (err) {
  process.stdout.write(`workers_dev=unavailable:${String(err?.message || err)}\n`);
}

if (!workersService) {
  throw new Error('workers.dev mirror deploy failed; pages.dev 已确认不适合作为当前 WS+VLESS 入口，停止生成 deploy_result.json');
}

const publicService = workersService;
const configUrl = publicService.configUrl;
const preferredUrl = publicService.preferredUrl;
const subUrl = publicService.subUrl;

await retry(async () => {
  const r = await fetchText(configUrl, { timeoutMs: 20000 });
  if (r.status >= 500) throw new Error(`config not ready: ${r.status}`);
  return r;
}, { retries: 20, delayMs: 1500 });

await retry(async () => {
  return await fetchText(configUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ae: 'yes', ena: 'no', epd: 'no', epi: 'yes', egi: 'no' }),
    timeoutMs: 20000
  });
}, { retries: 6, delayMs: 1500 });

await retry(async () => {
  return await fetchText(preferredUrl, {
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
    }]),
    timeoutMs: 20000
  });
}, { retries: 6, delayMs: 1500 });

const preferred = await retry(async () => {
  return await fetchText(preferredUrl, { timeoutMs: 20000 });
}, { retries: 6, delayMs: 1500 });
if (!preferred.text.includes('🇸🇬新加坡-优选节点-11')) {
  throw new Error(`preferred-ips missing expected name. body=${preferred.text}`);
}

const sub = await retry(async () => {
  return await fetchText(subUrl, { timeoutMs: 20000 });
}, { retries: 6, delayMs: 1500 });
let decoded = '';
if (sub.contentType.includes('yaml') || sub.contentType.includes('text/plain')) {
  decoded = sub.text;
} else {
  try {
    decoded = Buffer.from(sub.text.trim(), 'base64').toString('utf8');
  } catch {
    decoded = sub.text;
  }
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
  process.stdout.write('cleanup=started\n');
  try {
    await cfApiWithRetry(`/accounts/${accountId}/pages/projects/${project}`, {
      method: 'DELETE'
    });
  } catch {}
  try {
    await cfApiWithRetry(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(project)}`, {
      method: 'DELETE'
    });
  } catch {}
  try {
    await cfApiWithRetry(`/accounts/${accountId}/storage/kv/namespaces/${kvId}`, {
      method: 'DELETE'
    });
  } catch {}
  await rm(workDir, { recursive: true, force: true });
  process.stdout.write('cleanup=done\n');
  process.stdout.write('note=links may become invalid after cleanup\n');
} else {
  process.stdout.write('cleanup=skipped\n');
}

if (emitJsonPath) {
  const obj = buildDeployResult({
    accountId,
    deployType: 'worker',
    project,
    uuid,
    workerDomain: publicService.domain,
    apiDomain: publicService.domain,
    probeDomain: publicService.domain,
    pagesDomain: pagesService.domain,
    workersDevDomain,
    preferredUrl,
    subUrl,
    pagesPreferredUrl: pagesService.preferredUrl,
    pagesSubUrl: pagesService.subUrl,
    workersPreferredUrl: workersService?.preferredUrl || '',
    workersSubUrl: workersService?.subUrl || '',
    createdAt: new Date().toISOString(),
    cleanup: keep ? 'skipped' : 'done'
  });
  await writeDeployResult(emitJsonPath, obj);
  process.stdout.write(`deploy_result=${emitJsonPath}\n`);
}
