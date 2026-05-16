# 自定义生图 Web 版

这是一个独立的 Web 生图工作台，面向浏览器使用。前端只负责输入 API Key、选择模型、上传参考图、填写提示词、提交生成、展示结果和展示本地历史记录。

线上版本部署为 Vercel 静态前端，Provider 请求通过 `vercel.json` 转发到中转站：

```text
https://api.lts4ai.com
```

额度余额、生成记录、任务状态、图片结果、Key 校验等服务端数据由中转站负责。

## 本地开发

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5174/
```

开发模式会同时启动：

- 前端：`http://127.0.0.1:5174`
- 本地 API：`http://127.0.0.1:8787`

本地开发会通过 Vite 代理把 `/v1/*` 和 `/v1beta/*` 转发到 `https://api.lts4ai.com`。Vercel 部署时不会使用本地 Express 服务。

## 生产构建

```bash
npm run build
```

构建产物输出到 `dist/`。本地如需预览静态产物：

```bash
npm run preview
```

## Vercel 部署

在 Vercel 导入 GitHub 仓库后使用默认 Vite 设置即可：

- Framework Preset：`Vite`
- Install Command：`npm install`
- Build Command：`npm run build:web`
- Output Directory：`dist`

`vercel.json` 已配置：

- Vercel 只构建前端：`npm run build:web`
- 输出目录：`dist`
- `/v1/:path*` → `https://api.lts4ai.com/v1/:path*`
- `/v1beta/:path*` → `https://api.lts4ai.com/v1beta/:path*`
- 其他路径回退到 `/index.html`，用于前端单页应用刷新

## GitHub 上传

首次上传可以按下面的流程执行：

```bash
git init
git add .
git commit -m "chore: prepare web app for vercel deployment"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

上传前请确认 `.gitignore` 已排除：

- `node_modules/`
- `dist/`
- `dist-server/`
- `.vercel/`
- `.env*`
- `*.log`

## Provider

模型列表会根据 `Base URL` 自动获取，前端不会要求用户选择调用协议。程序会在后台尝试：

- Gemini 风格：`/v1beta/models`
- OpenAI 兼容风格：`/v1/models`

上线推荐 Base URL：

```text
https://api.lts4ai.com
```

不同模型对应的调用方式会自动同步，不显示给普通用户。
