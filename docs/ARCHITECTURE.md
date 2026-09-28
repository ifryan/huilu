# 会录 HuiLu 架构设计

## 1. 设计目标

1. **现代**：用 2026 年主流、仍在活跃维护的工具链，开发时改代码能即时生效（热更新），TypeScript 全程强类型
2. **可扩展**：转写服务商、大模型、存储方式、处理步骤、导出格式、纪要模板都可以插拔，**新增一种只需加一个模块，不改主流程**
3. **能长出服务端**：核心逻辑不依赖 Chrome API，将来做 Docker / 桌面版时可以直接复用
4. **稳**：录制和处理任务可以断点恢复；数据格式有版本号，可以向前迁移

## 2. 技术选型

| 层              | 选型（当前版本）                                              | 选它的理由                                                                                                                                                 |
| --------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 插件框架        | **WXT 0.21**（基于 Vite）                                     | 目前最活跃的插件框架：按目录约定生成入口和 manifest、开发时热更新、同时支持 Chrome / Edge / Firefox；Plasmo 已停滞，CRXJS 只是一个 Vite 插件，结构要自己搭 |
| 语言            | TypeScript 6.0（strict）                                      | typescript-eslint 目前只支持到 TS 6.0，等它支持 TS 7 后再升级                                                                                              |
| UI              | React 19 + Tailwind CSS 4 + shadcn/ui（Radix）                | 生态最大；shadcn 组件代码直接放进仓库，可以随意改，适合做自己的设计系统                                                                                    |
| 插件内网页路由  | TanStack Router（hash 模式）                                  | 路由参数有类型检查，适合插件页面                                                                                                                           |
| 数据请求 / 缓存 | TanStack Query 5                                              | 统一处理加载、缓存、重试；任务进度实时刷新                                                                                                                 |
| 界面状态        | Zustand 5                                                     | 轻量，不需要样板代码                                                                                                                                       |
| 数据校验        | Zod 4                                                         | 数据格式、配置、模型输出、跨模块消息，全部用同一套 schema 描述和校验                                                                                       |
| 大模型调用      | Vercel AI SDK 7 + `@ai-sdk/openai-compatible`                 | 统一接口，支持结构化输出（直接按 Zod schema 返回纪要 JSON）和流式输出；以后加 Claude、Gemini 等只要换一个包                                                |
| 本地索引        | 原生 IndexedDB（独立可重建缓存；Dexie 全文索引留待后续）      | 历史列表、全文搜索（规划）；U-34 任务队列使用原生 IndexedDB                                                                                                |
| 跨模块通信      | 类型安全的消息层（`@webext-core/messaging` 或自己封装 + Zod） | 后台、离屏文档、侧边栏、网页之间调用像调函数一样，并且有类型检查                                                                                           |
| 国际化          | i18next + react-i18next                                       | **MVP 同时支持简体中文和英文**；翻译 key 有类型检查，测试保证两种语言的 key 完全一致                                                                       |
| 工程            | pnpm workspace + Turborepo                                    | 多个包按依赖顺序构建，有构建缓存                                                                                                                           |
| 代码规范        | ESLint 10（flat config + typescript-eslint）+ Prettier 3      | 生态最成熟、兼容性最好；ESLint 同时负责强制分层规则                                                                                                        |
| 测试            | Vitest 5（单元）+ Playwright（加载真实插件做端到端测试）      | 转写 / 大模型服务商用录好的请求回放来测，不花钱                                                                                                            |
| CI / 发布       | GitHub Actions                                                | 每次提交：检查 + 类型 + 测试 + 构建；打 tag 时自动把插件 zip 发布到 Release                                                                                |

## 3. 仓库结构

```
huilu/
├── apps/
│   └── extension/                # WXT 插件（唯一的“外壳”）
│       ├── entrypoints/
│       │   ├── background.ts     # 后台：调度、消息中心、任务队列唤醒
│       │   ├── offscreen/        # 离屏文档：采集、混音、录制、写盘、执行处理任务
│       │   ├── popup/            # 弹窗：录制设置
│       │   ├── recorder/         # 录制窗口：承载窗口 / 屏幕采集（选源后最小化）
│       │   ├── app/              # 插件内网页：历史、结果页、设置、首次引导
│       │   └── overlay.content/  # 页面内悬浮录制面板：计时、暂停 / 继续、结束、错误提示
│       ├── platform/             # Chrome 平台适配：把 chrome.* 注入到下面各包
│       └── wxt.config.ts
├── packages/
│   ├── core/                     # 领域模型 + 数据格式 + 插件注册中心（无任何浏览器 API）
│   ├── recorder/                 # 录制管线：来源 → 混音 → 编码 → 输出
│   ├── storage/                  # 存储适配器：本地文件夹、OPFS（将来：服务端、WebDAV）
│   ├── providers/                # 转写 / 大模型服务商：百炼 Paraformer、OpenAI 兼容（Groq、OpenAI 预设）
│   ├── pipeline/                 # 会后处理：任务队列 + 可插拔步骤（转写 → 纪要 → 关键帧 …）
│   ├── exporters/                # 导出：MP4、SRT、TXT、Markdown、DOCX …
│   ├── ui/                       # 设计系统：shadcn 组件、主题、图标
│   └── i18n/                     # 多语言文案
├── docs/                         # PRD、架构、ADR（架构决策记录）
├── .github/workflows/            # CI、发布
└── turbo.json / eslint.config.js / .prettierrc.json / pnpm-workspace.yaml
```

**分层规则（保证扩展性的关键）**

- `packages/*` **禁止直接调用 `chrome.*` / 依赖 WXT**（ESLint 规则强制），需要平台能力时通过接口注入，由 `apps/extension/platform` 实现
- 依赖只能从上往下：`extension → pipeline / recorder / exporters → providers / storage → core`
- 以后加 `apps/server`（Docker）或 `apps/desktop`，只需要写一层新的平台适配，其余包直接复用

## 4. 运行时结构

```
 弹窗 / 悬浮面板 / 插件网页 ──(类型安全消息)──▶ 后台 Service Worker（调度中心，随时可能被浏览器回收，不做重活）
                                                  │ 创建 / 唤醒
                                                  ▼
                                    离屏文档（长时间运行）
                                    ├─ 录制：tabCapture / getDisplayMedia / 麦克风 → Web Audio 混音 → MediaRecorder
                                    │        → 每 5 秒一个分片写入 OPFS（崩溃最多丢 5 秒）
                                    └─ 处理任务：转写 → 纪要 → 关键帧 → 整理写入用户文件夹
                                                  │
                        IndexedDB（任务队列、进度） + 用户数据文件夹（最终文件）
```

- Service Worker 会被浏览器随时回收，所以**所有耗时工作都放在离屏文档里**，任务状态持久化在 IndexedDB，被打断后可以从上次完成的步骤继续
- 写入用户文件夹需要授权；如果授权失效，任务会停在「待写入」状态，等用户打开插件网页重新授权后自动补写
- **录制宿主**：标签页录制在离屏文档；窗口 / 屏幕录制在一个可见的小「录制窗口」（`entrypoints/recorder`）里进行。`desktopCapture` 选择框不能从 Service Worker 或离屏文档弹出，得到的 streamId 也只能在请求它的页面里取流。后台把暂停 / 继续 / 结束转给实际宿主，快捷键同理
- **录制界面分工**：弹窗只负责开始前的设置，开始成功后自动关闭；录制中再打开只显示简短状态和「显示录制面板」。页面内悬浮录制面板是唯一的计时、暂停 / 继续、结束和错误提示入口，悬浮在网页之上、不改变网页布局，可拖动、收起、关闭。录制窗口选好来源后自动最小化、不显示进度，结束后自动关闭；它不能被关闭，关闭会中断录制（数据可在「未完成的录制」中恢复）
- **悬浮面板的注入**：不在 manifest 声明 content script、不申请「所有网站」权限，由后台在用户点击弹窗 / 按快捷键后借 `activeTab` 用 `scripting.executeScript` 注入当前标签页；样式编译进脚本放入 Shadow DOM（不设 web_accessible_resources）。`chrome://` 等不允许注入的页面，弹窗保留并直接提供控制。最近一次结果（已保存 / 部分保存 / 未能保存）和开始失败原因存在后台 session 存储里，悬浮面板和空闲时的弹窗都显示，直到用户关掉（弹窗「知道了」、空闲时关闭面板）或开始新的录制。标签页「音频 + 视频」录制会录下网页画面，展开的面板也会出现在视频里

### Recording → processing integration (U-34)

- **输入**：录制结束后 OPFS 中有 `recordings/<id>/`，含 `manifest.json`（分片数 / 各片大小 / 实际 MIME）、`meeting.json`（`status: 'processing'`）、`audio/` 与 `video/` 分片。用 `RecordingStore.open(id)` → `readTrack('audio', manifest.tracks.audio.chunks, mimeType)` 得到惰性拼接的 Blob，可直接作为 `AudioInput.blob`；`opfs.listMeetingDirs()`（`apps/extension/platform/storage.ts`，根目录即 `recordings/`）列出所有已结束的录制
- **媒体格式**：`meeting.media.audio.mimeType` 是 MediaRecorder 实际输出的类型（当前 Chrome 为 `audio/webm;codecs=opus`，约 10 MB/小时）；视频轨按平台探测，Linux 为 `video/mp4;codecs=avc1…,opus`，Windows / macOS 预期为 AAC。转写只用纯音频轨
- **本地解码验证**：`spikes/scripts/avsync.mjs` 的 `decodeErrors` 统计每条流的包数 / 解码帧数，本机已验证的 FFmpeg 8.0.1 Opus 解析器在 WebM 文件末尾的误报（其他版本未验证）单独列在 `ignored`，不计为错误（`npm run test:decode` 回归）。这只证明文件能被本地解码，**服务商能否接受要用真实 Key 实测**
- **服务配置**：`transcriptionSetting` / `llmSetting`（`chrome.storage.local`，含 API Key）。离屏文档没有 `chrome.storage`，需由后台读取后随消息传入，或由后台转发 `storage.watch` 的变化；`dataFolderAuthorizedSetting` 同理
- **数据文件夹**：`dataFolder`（句柄在 IndexedDB，离屏文档同源可读）。离屏文档只能在 `isReady()` 为 true 时写入，不能申请授权；未授权时停在「待写入」，由插件网页重新授权后（`dataFolderAuthorizedSetting` 变化）补写
- **Offscreen lifecycle**: cleanup now checks recorder activity, temporary offscreen operations, and queued/running processing jobs. Reasons include `USER_MEDIA`, `AUDIO_PLAYBACK`, and `BLOBS`; delayed retries keep the document alive. The offscreen document is the single queue writer. Browser startup resumes interrupted jobs.
- **Processing contract**: native IndexedDB (`huilu-pipeline`) persists jobs; OPFS holds intermediate transcripts, summaries, and slice results. Folder authorization is requested only in a visible page. See the [pipeline README](../packages/pipeline/README.md) for states, retry behavior, ownership reservations, and the U-35 file contract, and [U-34 verification](U-34-VERIFICATION.md) for measured coverage and acceptance gaps.

## 5. 扩展点设计

所有可扩展的能力都用同一种模式：**在 `core` 定义接口 → 各实现单独成模块 → 在注册中心登记**。界面（比如设置页的服务商列表、配置表单）根据登记信息自动生成。

```ts
// packages/core —— 转写服务商接口（示意）
export interface TranscriptionProvider {
  id: string // 'dashscope-paraformer' | 'openai-compatible' | ...
  name: string
  configSchema: z.ZodType // 设置页根据它自动生成表单并校验
  capabilities: {
    diarization: boolean // 能否区分发言人
    maxFileBytes?: number // 超出时由管线自动切片
    languages: string[]
  }
  testConnection(config): Promise<void>
  transcribe(input: AudioInput, config, ctx: { signal; onProgress }): Promise<Transcript>
}
registry.transcription.register(paraformer)
registry.transcription.register(openaiCompatible) // 内置 Groq / OpenAI 预设
```

| 扩展点       | MVP 内置实现                                       | 以后加一种要做什么                                       |
| ------------ | -------------------------------------------------- | -------------------------------------------------------- |
| 转写服务商   | 百炼 Paraformer、OpenAI 兼容（Groq / OpenAI 预设） | 新写一个 Provider 模块并登记，比如 Deepgram              |
| 大模型服务商 | OpenAI 兼容（千问、DeepSeek、Ollama …）            | 加一个 AI SDK 的服务商包                                 |
| 存储后端     | 本地文件夹（File System Access）、OPFS             | 实现 `StorageAdapter`，比如服务端 API、WebDAV            |
| 处理步骤     | 转写、纪要、关键帧                                 | 实现 `PipelineStep`，比如翻译、脑图、说话人命名          |
| 纪要模板     | 通用                                               | 新建一个「Prompt + 输出 Zod schema」文件，比如周会、面试 |
| 导出格式     | MP4、SRT、TXT、Markdown                            | 实现 `Exporter`，比如 DOCX、离线 HTML                    |
| 录制来源     | 标签页、窗口 / 屏幕、麦克风                        | 新增一个来源，比如摄像头画中画                           |

## 6. 数据格式（对外契约）

- 每场会议的文件夹里，`meeting.json` 带 `schemaVersion`；`core` 内置按版本逐级迁移的逻辑，老数据打开时自动升级
- Transcript and Summary use the core Zod schemas. Exported JSON Schema files are not implemented yet.
- The user folder is authoritative for completed meetings and edits. OPFS retains recordings and intermediate results until they can be written. In-flight IndexedDB jobs contain operational checkpoints that cannot be rebuilt from the final folder alone; they are not disposable index data.

## 7. 工程规范

- Conventional Commits；PR 必须通过 CI（Prettier、ESLint、类型检查、单元测试、构建）
- 重要技术决定写成 ADR 放进 `docs/adr/`，比如「为什么选 WXT」「为什么所有耗时工作都放在离屏文档」
- 版本号用 Changesets 管理，打 tag 后 GitHub Actions 自动构建 zip 并发布 Release

## 8. 当前进度

| 包                   | 状态                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/extension`     | ✅ 框架已搭好：弹窗、侧边栏、插件网页（历史 / 设置 / 首次引导，hash 路由）、后台、离屏文档录制、类型安全消息、中英文切换、固定插件 ID |
| `packages/core`      | ✅ 数据格式（Meeting / Transcript / Summary）、版本迁移、全部扩展点接口、注册中心                                                     |
| `packages/i18n`      | ✅ 中英文文案、语言检测、key 一致性测试                                                                                               |
| `packages/ui`        | ✅ Tailwind 4 主题（含深色模式）、Button 组件                                                                                         |
| `packages/recorder`  | ✅ 两路录制 → OPFS 分片：写后校验、失败即停、开始互斥、崩溃恢复（见包内 README）                                                      |
| `packages/storage`   | ✅ 本地文件夹（File System Access，句柄存 IndexedDB，读写前检查授权）、OPFS；每次写入回读校验大小                                     |
| `packages/providers` | ✅ U-34: Paraformer upload/polling/diarization, compatible ASR, and AI SDK summaries; mock/browser validated, real APIs pending       |
| `packages/pipeline`  | ✅ U-34: persistent queue, splitting, retry/recovery, folder writes, History processing controls; see verification limits             |
| `packages/exporters` | ✅ U-35: TXT / SRT / Markdown, verified MP4 download, AAC/M4A conversion when supported                                               |

## 9. 已确认的决策（2026-09-24）

WXT、React + Tailwind + shadcn/ui、Vercel AI SDK、ESLint + Prettier、MVP 同时支持中英文。
