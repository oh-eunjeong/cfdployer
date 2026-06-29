# Deploy Panel

可直接部署到 Cloudflare Pages 的部署器，支持自动创建或更新 Cloudflare Worker / Pages。

## 部署部署器

```bash
npm install
npm run deploy
```

默认部署方式已切换为 Cloudflare Workers 静态资源模式：`wrangler deploy` 会同时上传 `functions/api/[[path]].js` 和 `public/`。

GitHub / Cloudflare 自动构建如果存在自定义部署命令，请使用：

```bash
npx wrangler deploy
```

如果目标账号要自动发布，需要准备：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Cloudflare 本地上传

不要直接上传 GitHub 自动生成的源码 zip，也不要只上传 `public/` 目录；那样 `/api/*` 会 404。

本地生成可上传资产包：

```bash
npm install
npm run pack:upload
```

然后在 Cloudflare Pages 控制台上传 `deploy-panel-upload.zip`。这个 zip 根目录包含 `index.html`、`app.js`、`styles.css` 和 `_worker.js`，适配控制台本地上传。

GitHub 自动部署需要在仓库 Secrets 配置：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

本地调试仍可使用：

```bash
npm start
```

## 支持能力

- 用户填写 Cloudflare 邮箱和 Global API Key
- 自动读取账户和可绑定域名
- 默认随机生成项目名称、KV 名称和可选子域名，不使用固定业务前缀
- 自动生成 UUID
- 自动创建或复用 KV，并绑定为 `C`
- 支持读取现有 Worker / Pages / KV 后更新部署
- 更新部署只同步代码，不修改 UUID、KV、域名或项目配置
- Worker 部署
- Pages 部署
- 部署时实时从 `oh-eunjeong/cfnew` 的 `main` 分支拉取明文源或混淆源
- Worker 自定义域名或 Route 绑定
- Pages 自定义域名绑定

密钥不会写入文件或浏览器 localStorage；托管部署时只在当前请求内转发给 Cloudflare API。
