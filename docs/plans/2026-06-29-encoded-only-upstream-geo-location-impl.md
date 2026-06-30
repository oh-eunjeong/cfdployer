# Encoded-Only Deployer And Upstream Geo Metadata Repair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep `cfnew-deployer` encoded-only while repairing the upstream-to-downstream preferred-node metadata chain so preferred nodes and ProxyIP-related labels consistently preserve location-aware names.

**Architecture:** Split the work into three isolated streams. First, restore `cfnew-deployer` to encoded-only behavior and lock it with regression tests. Second, repair upstream `yx-tools` output so upload payloads preserve location semantics instead of flattening them away. Third, make `cfnew` consume enriched upstream names/metadata with backward-compatible fallbacks to its existing geolocation logic, then regenerate the encoded build artifact.

**Tech Stack:** Cloudflare Workers, plain JavaScript, Node `node:test`, Python 3, GitHub-hosted upstream source, `javascript-obfuscator`

---

### Task 1: Restore encoded-only defaults in `cfnew-deployer`

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/public/app.js`
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/public/index.html`
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/functions/static-assets.js`
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/functions/api/[[path]].js`
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/server.mjs`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/tests/default-source-mode.test.mjs`

**Step 1: Write the failing test**

Edit `tests/default-source-mode.test.mjs` so it asserts:

```js
test('Quick deploy defaults to encoded source', async () => {
  const appJs = await 读取相对文件('public/app.js');
  assert.match(appJs, /sourceMode:\s*'encoded'/);
});

test('Worker API defaults missing sourceMode to encoded', async () => {
  const workerApi = await 读取相对文件('functions/api/[[path]].js');
  assert.match(workerApi, /if\s*\(!输出\.sourceMode\)\s*输出\.sourceMode\s*=\s*'encoded';/);
});

test('Local server defaults missing sourceMode to encoded', async () => {
  const serverCode = await 读取相对文件('server.mjs');
  assert.match(serverCode, /if\s*\(!输出\.sourceMode\)\s*输出\.sourceMode\s*=\s*'encoded';/);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
node --test tests/default-source-mode.test.mjs
```

Expected: FAIL because current code still contains `plain`.

**Step 3: Write minimal implementation**

Apply the smallest possible set of edits:

- Change quick deploy payload default back to `sourceMode: 'encoded'`.
- Change Worker runtime default completion back to `encoded`.
- Change local Node server default completion back to `encoded`.
- Update UI text so one-click deploy clearly says encoded is the deploy path.
- Keep `functions/static-assets.js` synchronized with `public/index.html`.

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
node --test tests/default-source-mode.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
git add public/app.js public/index.html functions/static-assets.js functions/api/[[path]].js server.mjs tests/default-source-mode.test.mjs
git commit -m "fix(deployer): restore encoded-only defaults"
```

### Task 2: Remove public `plain` deploy flow from `cfnew-deployer`

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/public/index.html`
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/functions/static-assets.js`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/tests/default-source-mode.test.mjs`

**Step 1: Write the failing test**

Extend `tests/default-source-mode.test.mjs` with a public-UI assertion:

```js
test('Public deploy UI does not expose plain source option', async () => {
  const indexHtml = await 读取相对文件('public/index.html');
  assert.doesNotMatch(indexHtml, /<option value="plain">/);
  assert.match(indexHtml, /<option value="encoded">/);
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
node --test tests/default-source-mode.test.mjs
```

Expected: FAIL because `plain` is still visible in the HTML.

**Step 3: Write minimal implementation**

- Remove the public `plain` option from `public/index.html`.
- Make the same removal in `functions/static-assets.js`.
- Keep copy consistent so self-contained Worker and local static files match.

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
node --test tests/default-source-mode.test.mjs tests/static-serving.test.mjs tests/auth-headers.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
git add public/index.html functions/static-assets.js tests/default-source-mode.test.mjs
git commit -m "fix(deployer): remove plain source from public ui"
```

### Task 3: Materialize and inspect the local `yx-tools` working copy

**Files:**
- Create: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools/`
- Inspect: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools/cloudflare_speedtest.py`
- Create: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools/tests/test_upload_payload.py`

**Step 1: Create the local upstream working copy**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools
git clone https://github.com/byJoey/yx-tools.git
```

If the directory already exists, run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools
git fetch origin
git status --short
```

**Step 2: Write the failing test**

Create `tests/test_upload_payload.py` with a focused payload-level regression:

```python
from cloudflare_speedtest import build_worker_upload_items

def test_worker_upload_items_preserve_location_aware_name():
    rows = [{
        "ip": "1.1.1.1",
        "port": 443,
        "region_code": "SIN",
        "country": "Singapore",
        "name": "优选节点-11",
    }]

    items = build_worker_upload_items(rows)

    assert items[0]["name"] == "🇸🇬新加坡-优选节点-11"
```

**Step 3: Run test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools
python3 -m pytest tests/test_upload_payload.py -q
```

Expected: FAIL because helper does not exist yet or current upload logic does not preserve canonical naming.

**Step 4: Trace the upload path before implementation**

Inspect and note exact functions handling:

- CSV/result row parsing
- API upload payload assembly
- name/comment/location formatting

Do not code yet. Confirm the single upstream choke point.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools
git add tests/test_upload_payload.py
git commit -m "test(yx-tools): add failing upload payload naming case"
```

### Task 4: Repair `yx-tools` upload payload naming and location metadata

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools/cloudflare_speedtest.py`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools/tests/test_upload_payload.py`

**Step 1: Write the minimal implementation**

Add small, isolated helpers in `cloudflare_speedtest.py`:

```python
COUNTRY_FLAG = {"SG": "🇸🇬", "HK": "🇭🇰", "JP": "🇯🇵", "US": "🇺🇸"}
COUNTRY_NAME = {"SG": "新加坡", "HK": "香港", "JP": "日本", "US": "美国"}

def build_geo_prefix(country_code: str, country_name: str = "") -> str:
    code = (country_code or "").upper().strip()
    label = COUNTRY_NAME.get(code) or country_name.strip()
    if not code and not label:
        return ""
    return f"{COUNTRY_FLAG.get(code, '')}{label or code}".strip()

def merge_location_name(prefix: str, base_name: str) -> str:
    if not prefix:
        return base_name
    if base_name.startswith(prefix + "-"):
        return base_name
    return f"{prefix}-{base_name}"
```

Then add one upload-payload assembly function:

```python
def build_worker_upload_items(rows):
    items = []
    for row in rows:
        prefix = build_geo_prefix(row.get("country_code") or row.get("region_code"), row.get("country", ""))
        base_name = row.get("name") or f'优选节点-{len(items) + 1:02d}'
        items.append({
            "ip": row["ip"],
            "port": row.get("port", 443),
            "name": merge_location_name(prefix, base_name),
            "regionCode": row.get("region_code", ""),
            "country": row.get("country", ""),
            "city": row.get("city", ""),
            "sourceType": row.get("source_type", "preferred"),
        })
    return items
```

Connect the real API upload path to this helper instead of directly flattening names.

**Step 2: Run test to verify it passes**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools
python3 -m pytest tests/test_upload_payload.py -q
```

Expected: PASS.

**Step 3: Add one more failure-proof test**

Extend `tests/test_upload_payload.py`:

```python
def test_worker_upload_items_keep_plain_name_when_location_missing():
    rows = [{"ip": "1.1.1.1", "port": 443, "name": "优选节点-11"}]
    items = build_worker_upload_items(rows)
    assert items[0]["name"] == "优选节点-11"
```

**Step 4: Run full upstream test subset**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools
python3 -m pytest tests/test_upload_payload.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools
git add cloudflare_speedtest.py tests/test_upload_payload.py
git commit -m "feat(yx-tools): preserve geo-aware worker upload names"
```

### Task 5: Teach `cfnew` to preserve upstream canonical names and minimal metadata

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew/明文源吗`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew/tests/geo-prefix.test.mjs`

**Step 1: Write the failing tests**

Append to `tests/geo-prefix.test.mjs`:

```js
test('已带地区前缀的上游名称保持原样', async () => {
  const { 创建值节点命名器 } = await 加载明文模块();
  const 制作节点名称 = 创建值节点命名器(false);
  assert.equal(
    制作节点名称({ name: '🇸🇬新加坡-优选节点-11', geoPrefix: '', ip: '1.1.1.1' }),
    '🇸🇬新加坡-优选节点-11'
  );
});

test('带 regionCode 的 ProxyIP 条目优先保留显式地区语义', async () => {
  const { 创建值节点命名器 } = await 加载明文模块();
  const 制作节点名称 = 创建值节点命名器(false);
  assert.match(
    制作节点名称({ name: '🇭🇰香港-ProxyIP-HK-01', regionCode: 'HK', ip: 'proxy.example.com' }),
    /^🇭🇰香港-ProxyIP-HK-01$/
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: FAIL because current naming still rebuilds names too aggressively from `isp`/`name`.

**Step 3: Write minimal implementation**

Add a small precedence guard in `明文源吗`:

```js
function 是否已带地区前缀(名称 = '') {
  return /^[\p{Regional_Indicator}{2}\u{1F1E6}-\u{1F1FF}].*-.+/u.test(String(名称 || '').trim()) ||
    /^(?:🇭🇰|🇸🇬|🇯🇵|🇺🇸|🇩🇪|🇬🇧|🇰🇷|🇳🇱|🇫🇮|🇸🇪).+-.+/u.test(String(名称 || '').trim());
}
```

Then use it before recomputing alias bases:

```js
if (是否已带地区前缀(项目?.name)) return 项目.name;
```

Also preserve minimal upstream metadata fields during preferred-IP API storage:

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

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
git add 明文源吗 tests/geo-prefix.test.mjs
git commit -m "feat(cfnew): preserve upstream geo-aware preferred names"
```

### Task 6: Preserve ProxyIP location markers without breaking fallback logic

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew/明文源吗`
- Test: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew/tests/geo-prefix.test.mjs`

**Step 1: Write the failing test**

Add:

```js
test('ProxyIP 名称缺少显式地区时仍按现有地区回退逻辑命名', async () => {
  const { 创建值节点命名器 } = await 加载明文模块();
  const 制作节点名称 = 创建值节点命名器(false);
  assert.equal(
    制作节点名称({ isp: 'ProxyIP-SG', ip: 'proxy.sg.example.com', geoPrefix: '' }),
    'ProxyIP-SG-01'
  );
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: FAIL only if the previous preservation logic accidentally breaks the old fallback naming path.

**Step 3: Write minimal implementation**

Adjust the naming guard so it only preserves upstream names that are already canonical. Do not bypass existing fallback naming when the record is only partially labeled.

The logic should be:

```js
const 原始名称 = String(项目?.name || '').trim();
if (是否已带地区前缀(原始名称)) return 原始名称;
```

Do not add broader shortcuts than this.

**Step 4: Run test to verify it passes**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
git add 明文源吗 tests/geo-prefix.test.mjs
git commit -m "fix(cfnew): keep proxyip fallback naming intact"
```

### Task 7: Regenerate the encoded artifact from `cfnew` source of truth

**Files:**
- Modify: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew/少年你相信光吗`
- Inspect: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew/.github/workflows/obfuscate.yml`

**Step 1: Re-run the obfuscation script locally**

Use the exact repo obfuscation options from `.github/workflows/obfuscate.yml`.

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
npx -y -p javascript-obfuscator node scripts-or-inline-obfuscate.js
```

If no helper script exists, create a short disposable local command using the exact workflow options and write only `少年你相信光吗`.

**Step 2: Verify the artifact changed**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
git diff -- 明文源吗 少年你相信光吗
```

Expected: `少年你相信光吗` changes consistently with the source modifications.

**Step 3: Commit**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
git add 少年你相信光吗
git commit -m "build(cfnew): regenerate encoded worker artifact"
```

### Task 8: Final verification and documentation sync

**Files:**
- Modify if needed: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew/README.md`
- Modify if needed: `/Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer/README.md`

**Step 1: Run deployer verification**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
node --test tests/default-source-mode.test.mjs tests/auth-headers.test.mjs tests/static-serving.test.mjs
```

Expected: PASS.

**Step 2: Run `cfnew` verification**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
node --test tests/geo-prefix.test.mjs
```

Expected: PASS.

**Step 3: Run `yx-tools` verification**

Run:

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/yx-tools
python3 -m pytest tests/test_upload_payload.py -q
```

Expected: PASS.

**Step 4: Update docs only if behavior text is now outdated**

- `cfnew-deployer/README.md` should clearly state deploy runtime is encoded-only.
- `cfnew/README.md` should mention upstream-enriched names are preserved while old uploads still fall back to real-IP geolocation.

**Step 5: Final commit per repo**

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew-deployer
git add README.md docs/plans/2026-06-29-encoded-only-upstream-geo-location-impl.md
git commit -m "docs(plan): record encoded-only geo repair execution plan"
```

```bash
cd /Users/chenchen/working/sourcecode/tools/cloudflare_tools/cfnew
git add README.md
git commit -m "docs(cfnew): clarify geo-aware preferred naming behavior"
```
