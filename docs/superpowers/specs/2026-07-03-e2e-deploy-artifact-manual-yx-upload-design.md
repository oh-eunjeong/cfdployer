# 部署产物契约 + 本机手动嗅探回灌（A 出口）设计

## 背景与目标

用户选择的优化目标为 **A：以本机/家宽出口为准**。因此测速、嗅探（探测可用性）与回灌必须在本机执行，避免 GitHub Runner 出口污染结果。

本设计的目标是把三仓库链路“串起来”，让“部署输出 = 回灌输入”，减少复制粘贴与人为出错：

- `cfnew-deployer` 自动完成 Pages 部署并输出机器可读产物
- `yx-tools` 提供从产物读取 `workerDomain/uuid` 的能力，用户本机一条命令完成“嗅探 + 回灌”
- `cfnew` 作为服务端无需为串联做功能性改动（保持现有 API 管理与订阅输出）

非目标：

- 不将测速/嗅探放到 GitHub Hosted Runner（不符合出口要求）
- 不强制将回灌完全无人值守（用户明确“最终嗅探+上传手动运行”）

## 总览：端到端数据流

1. `cfnew-deployer` 运行部署回归脚本（Pages），生成临时项目与 uuid，保持资源不清理（`--keep`）
2. `cfnew-deployer` 写出 `deploy_result.json`（机器可读）并在终端输出关键信息
3. 用户将 `deploy_result.json` 下载到本机（或在仓库中得到该文件）
4. 用户在本机执行 `yx-tools` 一条命令：
   - 生成 `result.csv`
   - 对候选做可用性嗅探（SNI 探测 worker-domain / uuid 路径）
   - 清空旧 preferred-ips（可选，推荐开启）
   - 批量回灌写入 `/{uuid}/api/preferred-ips`
5. 用户访问 `preferredUrl/subUrl` 验证节点数量与命名

## 产物契约：deploy_result.json

由 `cfnew-deployer` 在部署成功后生成，作为后续本机回灌的唯一输入。

字段（建议）：

```json
{
  "accountId": "2c771ffbdfff43d25c6fc92e694b71b5",
  "deployType": "pages",
  "project": "cfnew-geo-regress-2026-07-03t04-25-45-286z",
  "uuid": "e5b036e7-f804-479e-81d6-161bf23046ab",
  "workerDomain": "cfnew-geo-regress-2026-07-03t04-25-45-286z.pages.dev",
  "preferredUrl": "https://.../api/preferred-ips",
  "subUrl": "https://.../sub?target=clash",
  "createdAt": "2026-07-03T04:25:45.286Z",
  "cleanup": "skipped"
}
```

约束：

- 严禁写入 Cloudflare Token、GitHub Token 等敏感信息
- `workerDomain` 与 `uuid` 必须可直接拼装 API：`https://{workerDomain}/{uuid}/api/preferred-ips`
- `preferredUrl/subUrl` 与 `workerDomain/uuid` 必须一致，避免“回灌写入 A，但验证看的是 B”

## 组件改动

### 1) cfnew-deployer（自动化部署侧）

对脚本 `npm run regress:geo:pages -- --keep` 增强：

- 新增参数：`--emit-json <path>`
  - 部署成功后写出 `deploy_result.json` 到指定路径
  - stdout 仍输出 `account/project/uuid/preferred/sub/cleanup`，方便肉眼复制

可选：GitHub Actions 增强

- 通过 `workflow_dispatch` 触发部署
- 产出并上传 `deploy_result.json` 作为 artifact

### 2) yx-tools（本机回灌侧）

新增参数：`--deploy-json <path>`

- 从 `deploy_result.json` 读取 `workerDomain/uuid`
- 兼容现有手动参数（`--worker-domain/--uuid`），优先级：
  1) CLI 显式传入 `--worker-domain/--uuid`
  2) `--deploy-json`
  3) 其它交互/缓存（若已有）

推荐的手动执行命令（示意）：

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

其中：

- `--upload-count` 控制最终写入数量（推荐 50~200）
- `--probe` 在上传前进行 SNI 级别探测，避免“测速能跑但工具里不通”
- `--clear` 让每次回灌是覆盖式写入，便于回归与排障

### 3) cfnew（服务端）

不为串联做功能改动：

- 保持现有 `/api/preferred-ips` 去重（按 `ip:port`）与写入
- 保持订阅输出 `/sub?target=clash`

## 成功标准（验收）

- `cfnew-deployer` 单次运行能稳定生成可用的 `deploy_result.json`
- 本机执行 `yx-tools --deploy-json ... --probe --upload api` 可完成回灌
- `preferredUrl` 返回 `count >= uploadCount`（考虑重复跳过）
- `subUrl` 输出节点数量合理（不再只剩 1 个），且命名符合既定规则（含地区前缀与重名去重）

## 安全与权限

- Cloudflare Token 仅用于 `cfnew-deployer` 部署侧，通过环境变量或 GitHub Secrets 注入
- `deploy_result.json` 不包含任何密钥，可安全上传为 artifact
- `yx-tools` 回灌侧只访问部署出来的 `preferred-ips` API，不需要 Cloudflare Token

## 资源清理策略

默认 `--keep` 用于可见性与后续回灌验证。

建议：

- 部署与回灌验证完成后，由用户或脚本运行清理（Pages 项目/KV/Worker 域名等）
- 清理需幂等，遇到已删除（404/100114）跳过

