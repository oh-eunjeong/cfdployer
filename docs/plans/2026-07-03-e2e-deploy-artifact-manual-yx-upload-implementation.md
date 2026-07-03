# Deploy Artifact Contract + Manual Local Probe/Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `cfnew-deployer` emit a machine-readable `deploy_result.json`, and make `yx-tools` accept `--deploy-json` so the user can run local probe+upload without copying `workerDomain/uuid`.

**Architecture:** Keep deployment and local speedtest/upload split. `cfnew-deployer` produces a stable artifact (`deploy_result.json`). `yx-tools` consumes it (when `--worker-domain/--uuid` not provided) to target the correct deployment.

**Tech Stack:** Node.js (ESM, `node:test`), Python (argparse, unittest).

---

## Preconditions

- `cfnew-deployer` deploy script uses Cloudflare token via env vars.
- Local speedtest/probe/upload must run on the user’s machine/network (出口 A).
- No secrets are ever written into `deploy_result.json`.

---

### Task 1: Add a pure deploy-result helper module in cfnew-deployer

**Files:**
- Create: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/scripts/lib/deploy-result.mjs`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/tests/deploy-result.test.mjs`

**Step 1: Write the failing test**

Create `tests/deploy-result.test.mjs`:

```js
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
    cleanup: 'skipped',
  });

  await writeDeployResult(out, obj);
  const text = await readFile(out, 'utf8');
  assert.ok(text.includes('"workerDomain"'));
  assert.ok(!text.toLowerCase().includes('token'));
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
node --test tests/deploy-result.test.mjs
```

Expected: FAIL because `../scripts/lib/deploy-result.mjs` does not exist.

**Step 3: Implement minimal helper module**

Create `scripts/lib/deploy-result.mjs`:

- `parseEmitJsonArg(argv: string[]) -> string`:
  - Supports `--emit-json <path>` and `--emit-json=<path>`
  - Returns empty string if not present
- `buildDeployResult(input) -> object`:
  - Returns the canonical JSON object (no secrets)
- `writeDeployResult(path, object) -> Promise<void>`:
  - Writes pretty JSON (2-space indent) + trailing newline

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
node --test tests/deploy-result.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
git add scripts/lib/deploy-result.mjs tests/deploy-result.test.mjs
git commit -m "feat(cfnew-deployer): add deploy_result helper module"
```

---

### Task 2: Teach cf-regress-geo-pages.mjs to emit deploy_result.json

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/scripts/cf-regress-geo-pages.mjs`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/tests/deploy-result.test.mjs`

**Step 1: Write the failing test case for wiring**

Extend `tests/deploy-result.test.mjs` with a light integration test that builds the object with realistic URLs:

```js
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
    cleanup: 'skipped',
  });
  assert.equal(obj.workerDomain, 'proj.pages.dev');
  assert.equal(obj.uuid, 'u');
  assert.ok(obj.preferredUrl.includes('/u/api/preferred-ips'));
  assert.ok(obj.subUrl.includes('/u/sub'));
});
```

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
node --test tests/deploy-result.test.mjs
```

Expected: PASS (this is a guardrail for later changes).

**Step 2: Implement `--emit-json` in the deploy script**

In `scripts/cf-regress-geo-pages.mjs`:

- Replace `const args = new Set(process.argv.slice(2));` with a small argv list:
  - Keep `--keep` behavior identical
  - Parse `--emit-json` via `parseEmitJsonArg(process.argv.slice(2))`
- After successful validation (right after printing `ok/preferred/sub`, and after printing `cleanup=...`), write the JSON file if `emitJsonPath` is set:
  - `createdAt`: use `new Date().toISOString()` near the end of the script (after deployment)
  - `deployType`: `"pages"` (this script is Pages-only)
  - `workerDomain`: `${project}.pages.dev`
  - `preferredUrl/subUrl`: use the existing URLs already computed
  - `cleanup`: `"done"` if cleanup ran, else `"skipped"`

**Step 3: Manual verification command**

Run (requires Cloudflare env vars in your terminal):

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
npm run regress:geo:pages -- --keep --emit-json ./deploy_result.json
```

Expected:

- Script still prints `ok/preferred/sub/cleanup=skipped`
- `deploy_result.json` exists and contains `workerDomain/uuid/preferredUrl/subUrl`

**Step 4: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
git add scripts/cf-regress-geo-pages.mjs
git commit -m "feat(cfnew-deployer): emit deploy_result.json from regress script"
```

---

### Task 3: Add --deploy-json support in yx-tools

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/cloudflare_speedtest.py`
- Create: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/tests/test_deploy_json.py`

**Step 1: Write the failing unit test**

Create `tests/test_deploy_json.py`:

```py
import json
import tempfile
import unittest
from pathlib import Path

from cloudflare_speedtest import load_deploy_json

class DeployJsonTests(unittest.TestCase):
    def test_load_deploy_json_returns_worker_domain_and_uuid(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "deploy_result.json"
            p.write_text(json.dumps({
                "workerDomain": "example.pages.dev",
                "uuid": "abc",
            }), encoding="utf-8")

            worker_domain, uuid = load_deploy_json(str(p))
            self.assertEqual(worker_domain, "example.pages.dev")
            self.assertEqual(uuid, "abc")
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
python3 -m unittest discover -s tests -p 'test_deploy_json.py' -v
```

Expected: FAIL because `load_deploy_json` does not exist.

**Step 3: Implement minimal load_deploy_json + argparse**

In `cloudflare_speedtest.py`:

- Add `--deploy-json` (string path)
- Implement:
  - `def load_deploy_json(path) -> tuple[str, str]`:
    - reads JSON
    - accepts either `{ workerDomain, uuid }` or `{ worker_domain, uuid }` for compatibility
    - validates non-empty strings
- Apply precedence rules during API upload:
  1) if CLI provides `--worker-domain` and `--uuid`, use them
  2) else if `--deploy-json` is provided, fill `worker_domain/uuid` from it
  3) else keep current behavior (interactive / saved config)

**Step 4: Run tests**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
python3 -m unittest discover -s tests -p 'test_deploy_json.py' -v
python3 -m unittest discover -s tests -p 'test_upload_payload.py' -v
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
git add cloudflare_speedtest.py tests/test_deploy_json.py
git commit -m "feat(yx-tools): accept --deploy-json for worker upload"
git push origin main
```

---

### Task 4: Update docs and provide a ready-to-run local command

**Files:**
- Modify (optional): `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/README.md` (if exists)
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/README.md` (optional)
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/docs/superpowers/specs/2026-07-03-e2e-deploy-artifact-manual-yx-upload-design.md` (only if any behavior changed)

**Step 1: Add an example**

Example local command:

```bash
python3 cloudflare_speedtest.py \
  --mode beginner \
  --count 200 --speed 1 --delay 1000 \
  --upload api \
  --deploy-json ./deploy_result.json \
  --upload-count 50 \
  --clear \
  --probe
```

**Step 2: Commit docs (if changed)**

```bash
git add README.md docs/superpowers/specs/2026-07-03-e2e-deploy-artifact-manual-yx-upload-design.md
git commit -m "docs: add deploy_result + deploy-json usage example"
```

---

## Final Verification (manual end-to-end)

1) Deploy:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
npm run regress:geo:pages -- --keep --emit-json ./deploy_result.json
```

2) Local upload:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
python3 cloudflare_speedtest.py --mode beginner --count 200 --speed 1 --delay 1000 --upload api --deploy-json ../cfnew-deployer/deploy_result.json --upload-count 50 --clear --probe
```

3) Validate:

- `preferredUrl` count increases (>= upload count minus skips)
- `subUrl` includes multiple nodes and geo-prefixed names, no duplicate-node-name conflicts

