# 注册 GitHub OAuth App（Decap 登录用）

## 为什么需要？

Decap CMS 用 GitHub 后端写仓库。浏览器不能拿着 `client_secret` 换 token，所以由 Cloudflare Worker 提供：

- `https://axellab.org/api/auth` → 跳转 GitHub 授权  
- `https://axellab.org/api/callback` → 用 code 换 access_token，再交回 CMS 弹窗  

## 注册步骤

1. https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**
2. 字段：

```
Application name:     AXEL LAB CMS
Homepage URL:         https://axellab.org
Authorization callback URL:  https://axellab.org/api/callback
```

3. 创建后复制 **Client ID**，生成 **Client Secret**
4. Cloudflare 项目 Secrets：

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

或：

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

5. 重新 `npx wrangler deploy`（若 Secrets 在 Dashboard 添加，一般立即生效，仍建议确认 Worker 已是带 `main = ./worker/oauth.js` 的版本）

## 本地调试 OAuth（可选）

OAuth 回调必须是公网 HTTPS。本地可用临时隧道把本机 8787 映到公网，并把 OAuth App 回调改成隧道 URL（测完改回生产）。

```bash
npx wrangler dev
```

## 安全

- 不要把 Client Secret 写进仓库或 `config.yml`
- 仅仓库协作者应能完成授权并写入 `main`
