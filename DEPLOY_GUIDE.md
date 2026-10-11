# AXEL LAB 网站部署指南

## 当前正式站

- 域名：https://axellab.org
- GitHub：https://github.com/majianglong500-sketch/axellab-web
- 托管：Cloudflare Pages（连接上述仓库，构建命令留空，输出目录 `/`）
- 本地源码：`F:\AXEL LAB\axellab-git`（与仓库同步）

## 改内容（推荐）

见根目录 **《怎么换图改字.md》**。

简要流程：

1. 改 `content/某项目/文案.md` 和 `images/`
2. 运行 `python build.py`
3. `git add -A && git commit -m "..." && git push`

新增项目：复制 `content/_模板_新项目` → 改名 → 改文案与图 → 再 build。

## 首次 / 重新连接 Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. 选择 `axellab-web`
3. 构建命令：空；输出目录：`/`（或留空）
4. Save and Deploy，并绑定自定义域 `axellab.org`

## wrangler 直传（可选）

仓库含 `wrangler.jsonc`。若本机已登录 Cloudflare：

```bash
npx wrangler pages deploy . --project-name=axellab-web
```

（具体项目名以 Dashboard 为准。）
