# obfuscated 黑盒验证 SOP

**生效日期**: 2026-07-16
**关联 ADR**: [ADR-002-obfuscated-blackbox](../../../.kallax/decisions/2026-07-16-cf-ladder-research/ADR-002-obfuscated-blackbox.md)
**适用场景**: `cfnew/` 部署后, probe 不通 / 行为异常时的定位流程

---

## 前提

- `cfnew/worker.deploy.mjs` 是 obfuscated 1.6MB, **不可白盒审计** (生产约束)
- 审计路径 = 黑盒 + 抓包 + CF worker 日志
- SOP 不尝试 deobfuscate, 只验证"行为是否正确"

---

## 5 步定位流程

### 步骤 1: `wrangler tail` 看 worker 端日志 (5min)

```bash
cd cfnew
npx wrangler tail --format=pretty
# 同时另开终端跑 probe / curl
```

**期望看到**:
- worker 收到请求 (含 path / method / headers)
- 若有 `console.log` / `console.error`, 应出现在 tail 输出
- 若**完全没收到请求** → 入口路由问题 (CF Route 配置 / 自定义域 NS), 不是 worker bug

### 步骤 2: `curl` 烟雾测试 worker 域 (1min)

```bash
curl -vI --max-time 10 "https://<workerDomain>/<uuid>/?ed=2048"
```

**期望看到**:
- `HTTP/2 200` 或 `HTTP/1.1 200` (取决于 CF 边缘协议)
- `server: cloudflare` 头
- `cf-cache-status: ...` / `cf-ray: ...`

**若看到**:
- `404 Not Found` → worker 路由不匹配 (uuid 错 / path 错)
- `521 Web Server Is Down` → origin (本项目无 origin, 极少出现)
- `522 Connection Timed Out` → CF 边缘到 worker 超时, 罕见

### 步骤 3: `websocat` 验 WS 握手 (2min)

```bash
# 安装: brew install websocat
websocat -v "wss://<workerDomain>/<uuid>/?ed=2048"
# 或输入任意字符看回包
```

**期望看到**:
- 客户端: `HTTP/1.1 101 Switching Protocols`
- 响应头: `Sec-WebSocket-Accept: <base64>` (由 Sec-WebSocket-Key + magic GUID 计算)
- 双向通信建立

**若看到**:
- `HTTP/1.1 400 Bad Request` → 缺 `Sec-WebSocket-Key` / `Sec-WebSocket-Version`
- `HTTP/1.1 403 Forbidden` → uuid 校验失败 / IP 黑名单
- `HTTP/1.1 404 Not Found` → worker 路由不匹配

### 步骤 4: `tcpdump` 抓 TLS + WS 握手 (5min, root)

```bash
sudo tcpdump -i any -nn -s 0 -w /tmp/ws.pcap 'host <cf-ip> and tcp port 443'
# 同时跑 probe
tshark -r /tmp/ws.pcap -Y 'tcp.port==443 && tls.handshake.extensions_server_name' -V | head
```

**期望看到**:
- TLS ClientHello 的 SNI = `<workerDomain>` (不是其他域)
- ALPN 包含 `h2` 或 `http/1.1`
- 后续有 WS 握手帧 (0x81 / 0x82 等 opcode)

**若 SNI 不是 `<workerDomain>`** → DNS 污染 / 客户端用了错误 host

### 步骤 5: 二分法定位入口

跑两份 probe, 对比通过率:

```bash
# A. workerDomain (自定义域 fudan.qzz.io)
jq '.workerDomain as $w | .apiDomain = $w | .probeDomain = $w' \
  cfnew-deployer/deploy_result.json > /tmp/cfg-custom.json
./target/release/cfst-rs --deploy-json /tmp/cfg-custom.json ...

# B. workersDevDomain (官方子域)
jq '.workerDomain = .workersDevDomain | .apiDomain = .workersDevDomain | .probeDomain = .workersDevDomain' \
  cfnew-deployer/deploy_result.json > /tmp/cfg-workersdev.json
./target/release/cfst-rs --deploy-json /tmp/cfg-workersdev.json ...
```

**判定**:
- A 通过 / B 不通过 → 自定义域 CF Route 配置问题, 不是 worker bug
- A 不通过 / B 通过 → 自定义域 NS / DNS 解析问题
- A 不通过 / B 不通过 → worker 服务端 bug, 抓包逆向

---

## 工具清单

| 工具 | 用途 | 安装 |
|------|------|------|
| `wrangler tail` | worker 日志 | `npm i -g wrangler` |
| `curl` | HTTP 烟雾测试 | 系统自带 |
| `websocat` | WS 客户端 | `brew install websocat` |
| `tcpdump` + `tshark` | TLS + WS 抓包 | 系统自带 / `brew install wireshark` |
| `wscat` (替代) | WS 客户端 | `npm i -g wscat` |

---

## 已知陷阱 (踩过的坑)

| 陷阱 | 现象 | 解决 |
|------|------|------|
| 测速用了代理 | 延迟/速度全是代理质量, 不是 CF IP | **测速前 `unset HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`**, 验证 `curl ifconfig.me` 是本机 IP |
| `pages.dev` 入口 | WS+VLESS 不通 | 改用 worker + 自定义域 (ADR-001) |
| UUID 错 | probe 全 0 但 ping 通 | 比对 `deploy_result.json.uuid` 和实际 worker 环境变量 |
| VLESS 协议版本 | 服务端 v2, 探针 v1 | 看 obfuscated 不可能, 只能换协议栈探针对比 |

---

## 联动 ticket

- **P0-3** Probe 链路复测 (Q1)
- **P1-1** Rust vs Python 等价性 (Q3) — TLS cipher 差异可能影响 probe 通过率
- **EPIC-056-A** (3 阶段治理)

---

**SOP 维护**: 任何新工具/新陷阱追加到此文档, 保持单一真相源。