# 会录 HuiLu

> 开源的本地会议记录 Chrome 插件：一键录制音频 / 视频 → 会后自动转写 → AI 纪要与待办。数据只存在你自己的电脑上。

**状态：规划中（v0.1 MVP 开发前）**。完整需求见 [docs/PRD.md](docs/PRD.md)。

## 特性（规划）

- 🎙️ 录制标签页 / 窗口 / 全屏的音频或视频，可同时录制麦克风
- 📝 会后整体转写，区分发言人，逐字稿与视频时间轴联动
- 🤖 AI 导读：关键词、全文概要、章节速览、发言总结、要点回顾、待办事项
- 🔑 自带 API Key：转写支持阿里云百炼 Paraformer、任意 OpenAI 兼容接口（内置 Groq 免费、OpenAI 预设）；纪要支持任意 OpenAI 兼容大模型（通义千问、DeepSeek、Ollama 等）
- 📁 全本地：免登录、无服务端，所有记录以普通文件（mp4 / json / md）保存在你选择的本地文件夹

## 安装（计划中）

本项目暂不上架 Chrome 应用商店，以本地插件形式安装：

1. 从 [Releases](https://github.com/ifryan/huilu/releases) 下载最新版本 zip 并解压到固定目录
2. 打开 `chrome://extensions`，开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压后的目录

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
