# Encoded-Only Upstream Geo Name Preservation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep `cfnew-deployer` encoded-only while making `yx-tools` upload canonical geo-prefixed preferred-node names that `cfnew` preserves unless the upstream name is still plain.

**Architecture:** Treat `cfnew-deployer` as a guardrail-only repo, move the actual naming fix into a shared `yx-tools` payload builder used by both interactive and CLI uploads, and keep `cfnew` as a compatibility layer that preserves canonical upstream names while enriching only unprefixed legacy records. This avoids duplicate upload logic and matches the approved rule that upstream naming wins when it already carries a canonical geo prefix.

**Tech Stack:** Cloudflare Workers, plain JavaScript, Node `node:test`, Python 3 standard library, `requests`, `javascript-obfuscator`

---

### Task 1: Reconfirm Encoded-Only Deployer Guardrails

**Files:**
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/public/app.js`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/public/index.html`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/functions/static-assets.js`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/functions/api/[[path]].js`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/server.mjs`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/tests/default-source-mode.test.mjs`
- Optional docs: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/README.md`

**Step 1: Run the existing guardrail test first**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
node --test tests/default-source-mode.test.mjs
```

Expected: PASS, confirming deployer public flows already stay on `encoded`.

**Step 2: If the test fails, restore the minimal encoded-only defaults**

Use the current assertions in `tests/default-source-mode.test.mjs` as the contract:

```js
test('Quick deploy defaults to encoded source', async () => {
  const appJs = await 读取相对文件('public/app.js');
  assert.match(appJs, /sourceMode:\s*'encoded'/);
});

test('Worker API defaults missing sourceMode to encoded', async () => {
  const workerApi = await 读取相对文件('functions/api/[[path]].js');
  assert.match(workerApi, /if\s*\(!输出\.sourceMode\)\s*输出\.sourceMode\s*=\s*'encoded';/);
});

test('Public deploy UI does not expose plain source option', async () => {
  const indexHtml = await 读取相对文件('public/index.html');
  assert.doesNotMatch(indexHtml, /<option value="plain">/);
});
```

The minimal code target is:

```js
sourceMode: 'encoded'
```

and:

```js
if (!输出.sourceMode) 输出.sourceMode = 'encoded';
```

**Step 3: Sync the self-contained Worker asset copy if HTML changed**

Keep `functions/static-assets.js` aligned with `public/index.html` so Worker-hosted static serving matches local public assets.

**Step 4: Re-run the deployer regression suite**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
node --test tests/default-source-mode.test.mjs tests/auth-headers.test.mjs tests/static-serving.test.mjs
```

Expected: PASS.

**Step 5: Commit only if code or docs changed**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
git add public/app.js public/index.html functions/static-assets.js functions/api/[[path]].js server.mjs tests/default-source-mode.test.mjs README.md
git commit -m "fix(deployer): enforce encoded-only deploy guardrails"
```

### Task 2: Add Focused `yx-tools` Payload Tests Around Canonical Geo Names

**Files:**
- Create directory: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/tests/`
- Create: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/tests/test_upload_payload.py`
- Modify if needed: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/cloudflare_speedtest.py`

**Step 1: Write the failing unit test for canonical upload names**

Create `tests/test_upload_payload.py` with standard-library `unittest` so no new dependency is required:

```python
import unittest

from cloudflare_speedtest import build_worker_upload_items


class UploadPayloadTests(unittest.TestCase):
    def test_region_code_builds_geo_prefixed_name(self):
        rows = [{
            "ip": "1.1.1.1",
            "port": 443,
            "region_code": "SIN",
            "region_name": "新加坡",
            "country": "新加坡",
        }]

        items = build_worker_upload_items(rows)

        self.assertEqual(items[0]["name"], "🇸🇬新加坡-优选节点-01")
        self.assertEqual(items[0]["regionCode"], "SIN")
        self.assertEqual(items[0]["country"], "新加坡")
        self.assertEqual(items[0]["sourceType"], "preferred")

    def test_missing_region_keeps_plain_base_name(self):
        rows = [{
            "ip": "1.1.1.1",
            "port": 443,
            "region_code": "",
            "region_name": "",
            "country": "",
        }]

        items = build_worker_upload_items(rows)

        self.assertEqual(items[0]["name"], "优选节点-01")


if __name__ == "__main__":
    unittest.main()
```

**Step 2: Run the new test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
python3 -m unittest discover -s tests -p 'test_upload_payload.py' -v
```

Expected: FAIL because `build_worker_upload_items` does not exist yet and the upload path still builds `地区名-速度MB/s`.

**Step 3: Commit the failing test**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
git add tests/test_upload_payload.py
git commit -m "test(yx-tools): add geo-prefixed upload payload cases"
```

### Task 3: Extract Shared `yx-tools` Helpers For Payload Rows And Canonical Names

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/cloudflare_speedtest.py`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/tests/test_upload_payload.py`

**Step 1: Add small pure helpers above the upload functions**

Add minimal helpers near the `AIRPORT_CODES` section so the naming logic is easy to test:

```python
COUNTRY_CODE_BY_NAME = {
    "新加坡": "SG",
    "中国香港": "HK",
    "香港": "HK",
    "日本": "JP",
    "韩国": "KR",
    "美国": "US",
    "德国": "DE",
    "英国": "GB",
    "荷兰": "NL",
    "芬兰": "FI",
    "瑞典": "SE",
}


def country_code_to_flag(country_code):
    code = (country_code or "").strip().upper()
    if len(code) != 2 or not code.isalpha():
        return ""
    return "".join(chr(127397 + ord(char)) for char in code)


def get_country_code_for_row(row):
    region_code = (row.get("region_code") or "").strip().upper()
    airport_info = AIRPORT_CODES.get(region_code, {})
    country_name = (row.get("country") or airport_info.get("country") or "").strip()
    return COUNTRY_CODE_BY_NAME.get(country_name, "")


def build_geo_prefix_for_row(row):
    region_code = (row.get("region_code") or "").strip().upper()
    airport_info = AIRPORT_CODES.get(region_code, {})
    location_name = (row.get("region_name") or airport_info.get("name") or "").strip()
    country_name = (row.get("country") or airport_info.get("country") or "").strip()
    country_code = get_country_code_for_row(row)
    flag = country_code_to_flag(country_code)
    if not location_name:
        return ""
    if flag:
        return f"{flag}{location_name}"
    return location_name
```

**Step 2: Add one shared payload builder**

Add a builder used by both upload flows:

```python
def build_worker_upload_items(best_ips):
    items = []
    for index, ip_info in enumerate(best_ips, start=1):
        base_name = f"优选节点-{index:02d}"
        prefix = build_geo_prefix_for_row(ip_info)
        name = f"{prefix}-{base_name}" if prefix else base_name
        airport_info = AIRPORT_CODES.get((ip_info.get("region_code") or "").strip().upper(), {})
        items.append({
            "ip": ip_info["ip"],
            "port": ip_info["port"],
            "name": name,
            "regionCode": ip_info.get("region_code", ""),
            "country": ip_info.get("country") or airport_info.get("country", ""),
            "city": ip_info.get("region_name") or airport_info.get("name", ""),
            "sourceType": "preferred",
        })
    return items
```

**Step 3: Make the new unit test pass**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
python3 -m unittest discover -s tests -p 'test_upload_payload.py' -v
```

Expected: PASS.

**Step 4: Commit the helper extraction**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
git add cloudflare_speedtest.py tests/test_upload_payload.py
git commit -m "feat(yx-tools): build canonical geo-prefixed upload names"
```

### Task 4: Switch Both `yx-tools` Upload Paths To The Shared Builder

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/cloudflare_speedtest.py`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/tests/test_upload_payload.py`

**Step 1: Remove the duplicated inline name construction in interactive upload**

Replace this block in `upload_to_cloudflare_api()`:

```python
batch_data = []
for ip_info in best_ips[:upload_count]:
    region_name = ip_info.get('region_name', '未知地区')
    speed = ip_info['speed']
    name = f"{region_name}-{speed:.2f}MB/s"
    batch_data.append({
        "ip": ip_info['ip'],
        "port": ip_info['port'],
        "name": name
    })
```

with:

```python
batch_data = build_worker_upload_items(best_ips[:upload_count])
```

**Step 2: Do the same replacement in CLI upload**

Replace the duplicate block in `upload_to_cloudflare_api_cli()`:

```python
batch_data = []
for ip_info in best_ips[:upload_count]:
    region_name = ip_info.get('region_name', '未知地区')
    speed = ip_info['speed']
    name = f"{region_name}-{speed:.2f}MB/s"
    batch_data.append({
        "ip": ip_info['ip'],
        "port": ip_info['port'],
        "name": name
    })
```

with:

```python
batch_data = build_worker_upload_items(best_ips[:upload_count])
```

**Step 3: Preserve region metadata when rows are parsed**

When each `best_ips.append(...)` row is constructed in both CSV-reading branches, keep enough fields for the payload builder:

```python
best_ips.append({
    "ip": ip,
    "port": int(port),
    "speed": speed_val,
    "latency": latency_val,
    "region_code": region_code,
    "region_name": region_name,
    "country": AIRPORT_CODES.get(region_code, {}).get("country", ""),
})
```

**Step 4: Re-run the focused unit test**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
python3 -m unittest discover -s tests -p 'test_upload_payload.py' -v
```

Expected: PASS.

**Step 5: Commit the upload-path wiring**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
git add cloudflare_speedtest.py
git commit -m "refactor(yx-tools): share worker upload payload builder"
```

### Task 5: Verify `cfnew` Preserves Canonical Upstream Names And Only Fills Missing Prefixes

**Files:**
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew/明文源吗`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew/tests/geo-prefix.test.mjs`

**Step 1: Run the existing `cfnew` naming regression**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: PASS, because the current worker source already contains:

```js
function 是否已带地区前缀名称(名称 = '') {
  const 文本 = String(名称 || '').trim();
  return /^(?:[\u{1F1E6}-\u{1F1FF}]{2}|🇭🇰|🇸🇬|🇯🇵|🇺🇸|🇩🇪|🇬🇧|🇰🇷|🇳🇱|🇫🇮|🇸🇪).+-.+/u.test(文本);
}

if (是否已带地区前缀名称(原始名称)) return 原始名称;
```

**Step 2: If the test fails, apply the minimal compatibility patch**

Keep the preservation rule narrow:

```js
const 原始名称 = String(项目?.name || '').trim();
if (是否已带地区前缀名称(原始名称)) return 原始名称;
```

and preserve optional upstream metadata in the preferred-IP API store:

```js
const 新地址 = {
  ip: 项目44.ip,
  port: 端口43,
  name: 名称,
  regionCode: 项目44.regionCode || '',
  country: 项目44.country || '',
  city: 项目44.city || '',
  sourceType: 项目44.sourceType || '',
  addedAt: new Date().toISOString()
};
```

**Step 3: Re-run the `cfnew` test**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: PASS.

**Step 4: Commit only if `cfnew` changed**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
git add 明文源吗 tests/geo-prefix.test.mjs
git commit -m "fix(cfnew): preserve canonical upstream geo names"
```

### Task 6: Regenerate The Encoded Worker Artifact Only If Plain Source Changed

**Files:**
- Modify if needed: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew/少年你相信光吗`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew/.github/workflows/obfuscate.yml`

**Step 1: Skip this task if `明文源吗` did not change**

Check:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
git diff --name-only -- 明文源吗
```

Expected: empty output means no regeneration is needed.

**Step 2: If `明文源吗` changed, regenerate with the workflow options**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
npx -y -p javascript-obfuscator node - <<'NODE'
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const source = fs.readFileSync('明文源吗', 'utf8');
const output = JavaScriptObfuscator.obfuscate(source, {
  compact: true,
  controlFlowFlattening: false,
  controlFlowFlatteningThreshold: 0,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1.0,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: false,
  stringArrayWrappersParametersMaxCount: 3,
  renameGlobals: true,
  identifierNamesGenerator: 'mangled-shuffled',
  identifierNamesCache: null,
  identifiersPrefix: '',
  renameProperties: false,
  renamePropertiesMode: 'safe',
  ignoreImports: false,
  target: 'browser',
  numbersToExpressions: false,
  simplify: false,
  splitStrings: true,
  splitStringsChunkLength: 1,
  transformObjectKeys: false,
  unicodeEscapeSequence: true,
  selfDefending: false,
  debugProtection: false,
  debugProtectionInterval: 0,
  disableConsoleOutput: false,
  domainLock: []
}).getObfuscatedCode();
fs.writeFileSync('少年你相信光吗', output, 'utf8');
NODE
```

Expected: `少年你相信光吗` updates to match the plain source change.

**Step 3: Commit the regenerated artifact**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
git add 少年你相信光吗
git commit -m "build(cfnew): regenerate encoded worker artifact"
```

### Task 7: Final Cross-Repo Verification

**Files:**
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/tests/default-source-mode.test.mjs`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew/tests/geo-prefix.test.mjs`
- Verify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools/tests/test_upload_payload.py`
- Optional docs: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew/README.md`
- Optional docs: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer/README.md`

**Step 1: Run deployer verification**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
node --test tests/default-source-mode.test.mjs tests/auth-headers.test.mjs tests/static-serving.test.mjs
```

Expected: PASS.

**Step 2: Run `cfnew` verification**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: PASS.

**Step 3: Run `yx-tools` verification**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/yx-tools
python3 -m unittest discover -s tests -p 'test_upload_payload.py' -v
```

Expected: PASS.

**Step 4: Update docs only if behavior text is stale**

Add short clarifications only if missing:

- `cfnew-deployer/README.md`: public deployment stays encoded-only
- `cfnew/README.md`: canonical upstream geo-prefixed names are preserved; plain names still fall back to real-IP geo enrichment

**Step 5: Commit docs or verification-driven touch-ups**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew-deployer
git add README.md
git commit -m "docs(deployer): clarify encoded-only deployment"
```

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/2026_cf_ladder/cfnew
git add README.md
git commit -m "docs(cfnew): clarify upstream geo-name preservation"
```
