# AXEL LAB 网站部署指南

## 当前正式站

- 域名：https://axellab.org
- GitHub：https://github.com/majianglong500-sketch/axellab-web
- 托管：Cloudflare Pages / Workers（连接上述仓库）
- 本地源码：`F:\AXEL LAB\axellab-git`（与仓库同步）

## 改内容（推荐）

见根目录 **《怎么换图改字.md》**。

简要流程：

1. 改 `content/某项目/文案.md` 和 `images/`
2. 运行 `python build.py`（会生成页面，并组装可部署目录 `public/`）
3. `git add -A && git commit -m "..." && git push`

新增项目：复制 `content/_模板_新项目` → 改名 → 改文案与图 → 再 build。

## 为什么是 public/（重要）

不要把仓库根目录当 assets 目录。根目录含 `.git`，用 `wrangler deploy` 时会把 `.git/objects/pack/*.pack`（常超过 25 MiB）一并上传，导致 Workers 单文件超限失败。

`wrangler.toml` 里 `[assets] directory = "./public"`，构建/部署只扫 `public/`，`.git` 再大也碰不到。

`public/` **已提交进仓库**（由 `build.py` 组装：html / css / js / `assets/`）。因此 Cloudflare 部署命令只需：

```bash
npx wrangler deploy
```

不必改 Dashboard 的 Build command / output directory；点 **Retry deployment** 即可。不必删除旧部署。

本地改完内容后请先 `python build.py` 再 push，保证 `public/` 与源内容一致。

## wrangler 直传

仓库含 `wrangler.toml`，`[assets] directory = "./public"`。本机已登录 Cloudflare 时：

```bash
python build.py
npx wrangler deploy
```

不要再使用：

```bash
npx wrangler pages deploy .  # 会带上 .git / content 等无关文件
npx wrangler deploy          # 若 assets 仍指向仓库根，同样会扫到 .git
```

（在本仓库当前配置下，`npx wrangler deploy` 已安全，因为只读 `./public`。）


## 内容后台（Decap CMS）

- 地址：https://axellab.org/admin/
- 说明：仓库根目录《怎么用后台.md》
- OAuth：Worker `worker/oauth.js` 处理 `/api/auth` 与 `/api/callback`
- Cloudflare Secrets：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`
- 注册 OAuth App 步骤：`scripts/oauth-setup.md`
- 保存内容后由 `.github/workflows/build-site.yml` 跑 `python build.py` 更新 `public/`

`wrangler.toml` 现含 `main = "./worker/oauth.js"`，静态资源仍来自 `./public`。部署：

```bash
python build.py   # 或 .venv/bin/python build.py
npx wrangler deploy
```

首次上线后台前务必配置好两个 Secrets，否则登录会失败。
