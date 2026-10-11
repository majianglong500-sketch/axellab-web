# AXEL LAB 网站部署指南

## 当前正式站

- 域名：https://axellab.org
- GitHub：https://github.com/majianglong500-sketch/axellab-web
- 托管：Cloudflare Pages（连接上述仓库）
- 本地源码：`F:\AXEL LAB\axellab-git`（与仓库同步）

## 改内容（推荐）

见根目录 **《怎么换图改字.md》**。

简要流程：

1. 改 `content/某项目/文案.md` 和 `images/`
2. 运行 `python build.py`（会生成页面，并组装可部署目录 `dist/`）
3. `git add -A && git commit -m "..." && git push`

新增项目：复制 `content/_模板_新项目` → 改名 → 改文案与图 → 再 build。

## Cloudflare Pages 构建设置（重要）

不要把仓库根目录当输出目录。根目录含 `.git`，用 `wrangler deploy` 时会把 `.git/objects/pack/*.pack`（常超过 25 MiB）一并上传，导致 Workers 单文件超限失败。

在 Cloudflare Dashboard → Workers & Pages → **axellab-web** → Settings → Builds：

| 项 | 值 |
|----|-----|
| Build command | `python build.py` |
| Build output directory | `dist` |
| Root directory | `/`（默认即可） |

说明：

- `build.py` 会把仅含站点文件的产物写到 `dist/`（html / css / js / `assets/`），**不含** `.git`、`content/` 源图、文档与脚本。
- `dist/` 已加入 `.gitignore`，由 Cloudflare 构建生成，请勿把 Build command 留空。
- 改完设置后点一次 **Retry deployment** 即可；不必删除旧部署。

## wrangler 直传（推荐命令）

仓库含 `wrangler.jsonc`，`assets.directory` 已指向 `./dist`。本机已登录 Cloudflare 时：

```bash
python build.py
npx wrangler pages deploy dist --project-name=axellab-web
```

不要再使用：

```bash
npx wrangler deploy          # 会按旧配置扫整个仓库根
npx wrangler pages deploy .  # 会带上 .git / content 等无关文件
```
