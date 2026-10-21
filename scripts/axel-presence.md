# AXEL 在线汇报（Presence）

官网管理页看「当前在线人数 + 用户基本信息」。软件激活后约每 5 分钟心跳一次。

## 路径

| 用途 | 路径 |
|------|------|
| 心跳 / 列表 API | `https://axellab.org/api/axel-presence` |
| 管理页 | `https://axellab.org/axel/admin.html` |

- **POST**：软件上报（无需口令）
- **GET**：管理列表，需 `Authorization: Bearer <AXEL_ADMIN_TOKEN>`

「在线」定义：服务器最近 **12 分钟**内收到过心跳。`lastSeenAt` 一律用服务器时间；
软件上报的 `lastActiveAt` 单独保存为参考（比服务器时间还晚的值会被丢掉），不影响在线判断。

同一台机器 1 分钟内重复上报、内容没变时不重复写 KV。
记录同时写进 KV 的 metadata，管理页一次 list 就能拿全，几千台也不会超出单次请求 1000 次 KV 操作的上限。

## Cloudflare 配置

### 1. 创建 KV

```bash
npx wrangler kv namespace create AXEL_PRESENCE
npx wrangler kv namespace create AXEL_PRESENCE --preview
```

把返回的 id 填进 `wrangler.toml` 的 `[[kv_namespaces]]`（`id` / `preview_id`）。

### 2. 管理口令（勿写入仓库）

```bash
npx wrangler secret put AXEL_ADMIN_TOKEN
# 输入一长串随机口令
```

本地开发：复制 `.dev.vars.example` → `.dev.vars`，填同一口令。

### 3. 部署

```bash
python build.py          # 会把 axel/ 拷到 public/axel/
npx wrangler deploy
```

管理页源文件：`axel/admin.html`（构建进 `public/axel/admin.html`）。

## 隐私

软件上报字段仅限：

- `machineHash`：本机指纹再哈希，**不是**路径明文
- `version`、`activated`
- 可选 `companyShort`（取设置里公司简称，可关）
- `lastActiveAt`、`timezone`

**不上报**：报价明细、客户电话、文件内容、API Key。

用户可在软件「设置 → 关于」关闭「向官网汇报在线状态」。

## 本地 mock

软件仓库：`node scripts/mock-presence-server.js`（默认 `http://127.0.0.1:8788/api/axel-presence`）。
