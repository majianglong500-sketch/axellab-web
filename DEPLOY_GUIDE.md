# AXEL LAB 部署与更新指南

## 1. 首次部署到 GitHub
1. 在您的 GitHub `axellab-web` 仓库页面，点击 **"uploading an existing file"**。
2. 将此压缩包解压后的所有文件拖入。
3. 点击 **"Commit changes"**。

## 2. 关联 Cloudflare Pages (自动化部署)
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 进入 **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
3. 选择您的 `axellab-web` 仓库。
4. **构建设置**：框架预设选 `None`，构建命令留空，输出目录填 `/` (或者留空，取决于您的根目录)。
5. 点击 **Save and Deploy**。

## 3. 如何更新内容 (AI 驱动模式)
以后您想增加新项目或修改文字，只需：
1. 打开 `data.js` 文件。
2. 让 AI (Manus/Claude) 根据您的新素材生成一段 JSON 代码。
3. 替换或增加到 `AXEL_DATA` 对象中。
4. 提交修改到 GitHub，网站会在 1 分钟内自动更新。

## 4. 图片处理建议
*   **大图**：放在 `bw-primary` 容器中，会自动适配宽度，建议宽度 1200px 以上。
*   **细节图**：放在 `bw-thumbs` 中，点击会自动弹出高清大图预览。
*   **3D 模型**：将 `.glb` 文件放入 `assets/models/`，在 HTML 中使用 `<model-viewer>` 标签引用。
