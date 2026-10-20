# 会录 HuiLu

> 开源的本地会议记录工具（Chrome 插件 / 静态网页版）：一键录制音频 / 视频 → 会后自动转写 → AI 纪要与待办。数据只存在你自己的电脑上。

**状态：开发中（v0.1 MVP）**。需求见 [docs/PRD.md](docs/PRD.md)，架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 特性（规划）

- 🎙️ 录制标签页 / 窗口 / 全屏的音频或视频，可同时录制麦克风
- 📝 会后整体转写，区分发言人，逐字稿与视频时间轴联动
- 🤖 AI 导读：关键词、全文概要、章节速览、发言总结、要点回顾、待办事项
- 🔑 自带 API Key：转写支持阿里云百炼 Paraformer、任意 OpenAI 兼容接口（内置 Groq 免费、OpenAI 预设）；纪要支持任意 OpenAI 兼容大模型（通义千问、DeepSeek、Ollama 等）
- 🌐 界面支持简体中文与英文
- 📁 全本地：免登录、无服务端，所有记录以普通文件（mp4 / json / md）保存在你选择的本地文件夹

## 安装（计划中）

本项目暂不上架 Chrome 应用商店，以本地插件形式安装：

1. 从 [Releases](https://github.com/ifryan/huilu/releases) 下载最新版本 zip 并解压到固定目录
2. 打开 `chrome://extensions`，开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压后的目录

## 本地开发

```bash
corepack enable
pnpm install
pnpm dev     # 自动打开加载了插件的 Chrome
pnpm build   # 产物在 apps/extension/.output/chrome-mv3，可直接「加载已解压的扩展程序」
```

技术栈：WXT · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · TanStack Router / Query · Zod · Vercel AI SDK · i18next · pnpm + Turborepo · ESLint + Prettier · Vitest。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 静态网页版

```bash
pnpm install
pnpm --filter @huilu/web dev       # http://127.0.0.1:5173
pnpm --filter @huilu/web build
pnpm --filter @huilu/web preview   # 预览 apps/web/dist
```

将 `apps/web/dist/` 的全部文件放到 HTTPS 静态站点即可部署，无需 Node 服务器或 API 后端。资源地址相对、页面使用 hash 路由，支持子路径托管，不需要路由重写。开发 / 预览支持 localhost；`file://` 和普通内网 HTTP 不具备录制、OPFS、文件夹授权所需的安全上下文。需要远程访问开发服务器时自行明确绑定地址，并使用 HTTPS。

首次进入可从引导配置转写与纪要、选择数据文件夹和授权麦克风，然后在「新建录制」中选择音频 / 视频、来源声音、麦克风设备、画质与语言。开始时由浏览器选择标签页 / 窗口 / 屏幕，需要来源声音时务必勾选共享音频。录制可在页面或支持的 Document PiP 小窗中暂停、继续、结束。录制与处理中请保持宿主页面打开；意外中断可重新打开后恢复。

桌面 Chrome 为推荐验收环境。不支持本地文件夹选择器时使用「仅浏览器内存储（OPFS）」：仍可处理、编辑、归档、下载，清除网站数据会丢失这些会议，请定期导出；持久存储申请不能代替备份。不支持屏幕共享 API 的浏览器仍可查看 / 导出本源已有数据。此版没有离线应用壳缓存。

网页版请求受 **CORS** 约束，不能继承插件的域名权限。Groq / 千问 / DeepSeek 等有无效 Key 响应可读的实测，百炼 getPolicy、OpenAI 部分调用被本次跨域探测拦截；GLM Coding Plan 仅供插件使用。设置页显示能力提示；无法直连时可在「Base URL / 代理 Base URL」填写自己维护的 OpenAI 兼容网关。本项目不提供托管代理。测试连接成功也不能证明录音上传与模型调用全部成功，详见 [ADR 0005 的逐路径实测](docs/adr/0005-web-app.md)。

网页与插件的浏览器存储互不相通；支持文件夹选择的环境可选择同一个数据文件夹，从文件重建历史。配置可通过 JSON 导入 / 导出迁移，默认不导出 Key。更换网页协议、域名或端口同样会换一个浏览器存储空间。

验收范围、实测与未测项见 [U-101 网页版验收说明](docs/U-101-WEB-APP.md)。

## 数据目录结构

```
HuiLu/
└── 2026-09-24_1430_需求评审/
    ├── meeting.json      # 元数据
    ├── video.mp4         # 视频（仅音频模式时无）
    ├── audio.webm        # 用于转写的音频
    ├── transcript.json   # 逐字稿
    ├── summary.md        # AI 纪要
    ├── notes.md          # 笔记
    └── frames/           # 画面关键帧
```

## License

[AGPL-3.0](LICENSE)
