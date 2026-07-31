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

function parseArgs(argv) {
  const args = new Set(argv);
  const prefixes = [];
  for (const a of argv) {
    if (a.startsWith('--prefix=')) prefixes.push(a.slice('--prefix='.length));
  }
  const apply = args.has('--apply') || args.has('--yes');
  const keepUnknown = args.has('--keep-unknown');
  const workerDomains = !args.has('--no-worker-domains');
  const workerScripts = !args.has('--no-worker-scripts');
  const pages = !args.has('--no-pages');
  const kv = !args.has('--no-kv');
  return {
    apply,
    keepUnknown,
    workerDomains,
    workerScripts,
    pages,
    kv,
    prefixes
  };
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

async function retry(fn, { retries = 8, delayMs = 1200 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isNetworkishError(err)) throw err;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

async function cfFetch(path, { method = 'GET', token, body, headers, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers
    },
    body,
    signal: controller.signal
  });
  clearTimeout(timeoutId);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    const msg = json ? JSON.stringify(json) : `${res.status} ${res.statusText}`;
    const err = new Error(`Cloudflare API ${method} ${path} failed: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json.result;
}

async function cfFetchJson(path, { method = 'GET', token, body, headers, timeoutMs } = {}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return await cfFetch(path, {
    method,
    token,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: payload,
    timeoutMs
  });
}

async function listAllPagesProjects(accountId, token) {
  const out = await retry(async () => {
    return await cfFetch(`/accounts/${accountId}/pages/projects`, { token });
  });
  if (Array.isArray(out)) return out;
  if (Array.isArray(out?.projects)) return out.projects;
  if (Array.isArray(out?.items)) return out.items;
  return [];
}

async function listAllKvNamespaces(accountId, token) {
  const results = [];
  let page = 1;
  while (true) {
    const out = await retry(async () => {
      return await cfFetch(`/accounts/${accountId}/storage/kv/namespaces?page=${page}&per_page=100`, { token });
    });
    const arr = Array.isArray(out) ? out : [];
    results.push(...arr);
    if (arr.length < 100) break;
    page += 1;
  }
  return results;
}

async function listAllWorkerScripts(accountId, token) {
  try {
    const out = await retry(async () => {
      return await cfFetch(`/accounts/${accountId}/workers/scripts`, { token });
    });
    return Array.isArray(out) ? out : [];
  } catch (err) {
    const status = err?.status;
    if (status === 404) return [];
    return [];
  }
}

async function listAllWorkerDomains(accountId, token) {
  try {
    const out = await retry(async () => {
      return await cfFetch(`/accounts/${accountId}/workers/domains`, { token });
    });
    return Array.isArray(out) ? out : [];
  } catch (err) {
    const status = err?.status;
    if (status === 404) return [];
    return [];
  }
}

function matchesPrefix(name, prefixes) {
  const n = String(name || '');
  return prefixes.some(p => n.startsWith(p));
}

function defaultPrefixes() {
  return [
    'edge-',
    'cf-',
    'cfnew-',
    'cfnew-geo-regress-',
    'kv-geo-regress-',
    'edgepggeo-',
    'storepggeo-',
    'edgegeo-',
    'storegeo-',
    'edgepagesmoke-'
  ];
}

const runId = crypto.randomUUID().slice(0, 8);
const parsed = parseArgs(process.argv.slice(2));
const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
const apiToken = pickEnv('CLOUDFLARE_API_TOKEN') || pickEnv('CF_API_TOKEN');
if (!apiToken) throw new Error('Missing env: CLOUDFLARE_API_TOKEN (or CF_API_TOKEN)');

const prefixes = parsed.prefixes.length ? parsed.prefixes : defaultPrefixes();

process.stdout.write(`run=${runId}\n`);
process.stdout.write(`account=${accountId}\n`);
process.stdout.write(`apply=${parsed.apply ? 'yes' : 'no'}\n`);
process.stdout.write(`prefixes=${prefixes.join(',')}\n`);

const plan = {
  pages: [],
  kv: [],
  workerScripts: [],
  workerDomains: []
};

if (parsed.pages) {
  const projects = await listAllPagesProjects(accountId, apiToken);
  for (const p of projects) {
    const name = p?.name || '';
    if (matchesPrefix(name, prefixes)) plan.pages.push({ name });
    else if (!parsed.keepUnknown && name.startsWith('cfnew-geo-regress-')) plan.pages.push({ name });
  }
}

if (parsed.kv) {
  const namespaces = await listAllKvNamespaces(accountId, apiToken);
  for (const ns of namespaces) {
    const title = ns?.title || '';
    const id = ns?.id || '';
    if (matchesPrefix(title, prefixes)) plan.kv.push({ id, title });
    else if (!parsed.keepUnknown && title.startsWith('kv-geo-regress-')) plan.kv.push({ id, title });
  }
}

if (parsed.workerScripts) {
  const scripts = await listAllWorkerScripts(accountId, apiToken);
  for (const s of scripts) {
    const name = s?.id || s?.name || '';
    if (matchesPrefix(name, prefixes)) plan.workerScripts.push({ name });
  }
}

if (parsed.workerDomains) {
  const domains = await listAllWorkerDomains(accountId, apiToken);
  for (const d of domains) {
    const host = d?.hostname || '';
    const service = d?.service || '';
    if (matchesPrefix(service, prefixes) || matchesPrefix(host, prefixes)) plan.workerDomains.push({ hostname: host, service });
  }
}

process.stdout.write(`plan_pages=${plan.pages.length}\n`);
for (const p of plan.pages) process.stdout.write(`pages=${p.name}\n`);
process.stdout.write(`plan_kv=${plan.kv.length}\n`);
for (const ns of plan.kv) process.stdout.write(`kv=${ns.title} id=${ns.id}\n`);
process.stdout.write(`plan_worker_scripts=${plan.workerScripts.length}\n`);
for (const s of plan.workerScripts) process.stdout.write(`worker_script=${s.name}\n`);
process.stdout.write(`plan_worker_domains=${plan.workerDomains.length}\n`);
for (const d of plan.workerDomains) process.stdout.write(`worker_domain=${d.hostname} service=${d.service}\n`);

if (!parsed.apply) {
  process.stdout.write('done=dry-run\n');
  process.stdout.write('hint=rerun with --apply to delete\n');
  process.exit(0);
}

for (const p of plan.pages) {
  await retry(async () => {
    try {
      await cfFetchJson(`/accounts/${accountId}/pages/projects/${p.name}`, { method: 'DELETE', token: apiToken });
    } catch (err) {
      if (err?.status === 404) return;
      throw err;
    }
  });
  process.stdout.write(`deleted_pages=${p.name}\n`);
}

for (const ns of plan.kv) {
  await retry(async () => {
    try {
      await cfFetchJson(`/accounts/${accountId}/storage/kv/namespaces/${ns.id}`, { method: 'DELETE', token: apiToken });
    } catch (err) {
      if (err?.status === 404) return;
      throw err;
    }
  });
  process.stdout.write(`deleted_kv=${ns.title} id=${ns.id}\n`);
}

for (const d of plan.workerDomains) {
  if (!d.hostname) continue;
  await retry(async () => {
    try {
      await cfFetchJson(`/accounts/${accountId}/workers/domains/${encodeURIComponent(d.hostname)}`, { method: 'DELETE', token: apiToken });
    } catch (err) {
      const code = err?.body?.errors?.[0]?.code;
      if (err?.status === 404 || code === 100114) return;
      throw err;
    }
  });
  process.stdout.write(`deleted_worker_domain=${d.hostname}\n`);
}

for (const s of plan.workerScripts) {
  if (!s.name) continue;
  await retry(async () => {
    try {
      await cfFetchJson(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(s.name)}`, { method: 'DELETE', token: apiToken });
    } catch (err) {
      if (err?.status === 404) return;
      throw err;
    }
  });
  process.stdout.write(`deleted_worker_script=${s.name}\n`);
}

process.stdout.write('done=deleted\n');
