# ADR 0005：纯静态会录网页版

- 状态：已实现，等待人工验收
- 日期：2026-10-21（浏览器探测时间 2026-10-20 16:32 UTC）
- 关联：U-101；延续 ADR 0004 的本地存储、录制与权限约束

## 决策与分工

新增 `apps/web`，以 Vite + React 19 + Tailwind 4 + TanStack Router / Query 构建纯静态文件。不包含服务器、账号、托管代理或云存储。采用相对资源地址与 hash 路由，可放在静态站点子路径；公网使用 HTTPS，本机使用 localhost。

插件继续提供现有录制入口、全局快捷键、后台 / 离屏宿主及插件域名权限。网页版使用浏览器原生共享选择框，不提供无选择框的「录当前标签页」，也无法使用 `declarativeNetRequest`。GLM Coding Plan 从网页预设菜单隐藏，导入该配置也不能调用。

沿用现有 Board UI，将平台无关页面、组件与读写逻辑抽到 `packages/app-shell`。通过宿主的 `@/` 模块别名注入设置、消息和平台存储；插件原路径保留显式 re-export。两个宿主都进行类型检查和原有测试，不改变插件的默认行为。契约见该包 README。

## 网页宿主

- 点击开始时同步调用 `getDisplayMedia`，提示 `displaySurface: browser`、`systemAudio: include`、`selfBrowserSurface: exclude`、`surfaceSwitching: include`；实际来源以返回的视频轨设置为准。来源声音开关与麦克风 / 设备、视频画质、会议语言可配置。
- 直接复用 `mixCapturedStream`、`RecorderController`、`RecordingStore`。实际 MIME 探测、每片写入后大小校验、失败停止和停止共享收尾全部保留；无声视频不产生转写音轨，全程数字静音由管线拒绝上传。
- Web Lock `huilu:web-recording` 跨标签互斥，持续到分片收尾完成。选源先保留用户激活，若另一标签占锁，关闭本次新流。恢复 / 丢弃同样持锁，不允许操作其他标签仍在录制的数据。
- 页面内控件与 Document Picture-in-Picture 小窗共用 React 上下文；不支持时只显示页面控件。录制 / 处理时设置 `beforeunload`，用户仍可选择离开；重新打开后恢复 OPFS 未完成录制和 IndexedDB 任务。
- 一页持有 `huilu:web-pipeline` 锁并执行队列；其他页面通过 BroadcastChannel 发送命令，避免多个页面同时恢复、重置正在运行的任务。任务仍存 `huilu-pipeline`；处理需要保持宿主页面打开。此版没有 Service Worker / PWA 离线应用壳。

## 文件夹授权与降级

支持 `showDirectoryPicker` 时继续使用 `LocalFolderStorageAdapter`。选择与重新授权仅由可见页面上的用户点击触发；每次读写前查询 `readwrite` 权限，失效后进入 `waitingFolder`，重新授权再补写。没有文件夹也能先录制和处理，结果留在 OPFS 等待授权。

不支持文件夹选择器时，显著提示「仅浏览器内存储」与清除网站数据风险，并请求 `navigator.storage.persist()`。最终文件直接写入 OPFS `recordings/<id>/`，通过可选 `ProcessingDeps.folderName` 使用会议 id，保留中间结果与录制分片，编辑和归档在同一套会议锁下执行；可以下载原始媒体、TXT、SRT 和 Markdown。持久存储申请可被浏览器拒绝，不能当作备份。

网页源与插件源的 OPFS、IndexedDB、localStorage 相互隔离，协议 / 域名 / 端口变化也形成不同网页源。选择同一个本地文件夹后，共享 `scanMeetings` 路径从 `meeting.json` 重建历史索引；不依赖插件的旧索引。API 配置通过现有 JSON 导入 / 导出迁移（默认不含 Key）。API Key 只写当前源的 localStorage，不进入会议文件夹。

## CORS 实测

在 ryan-ubuntu，用 Playwright 驱动本机 Chromium **156.0.8078.4**，从 **`http://localhost:4178`** 页面执行真实 `fetch`；使用无效 Key `sk-huilu-invalid-cors-probe`，没有关闭浏览器安全检查、没有使用 `no-cors`，没有代理这些业务请求。此版本是已安装的自动化 Chromium，并非人工桌面 Chrome 验收。原始错误与响应头见 [探测记录](../verification/U-101-cors.json)。

`ok` 仅表示本次对应请求的无效 Key 响应在网页中可读，不能证明有效 Key、模型权限、计费或长任务成功；`blocked` 是本次跨域失败，可能随服务商策略变化。不同路径、成功响应、地域与 Origin 需要分别验证，不能用 `/models` 的结果替代推理 / 上传结论。

| 预设 / 路径                                                                         | 实测结果                    | CORS 响应头 / 证据                                 | 网页标记                                |
| ----------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------- | --------------------------------------- |
| 百炼 CN `uploads?action=getPolicy`                                                  | fetch 失败                  | 浏览器明确报告预检缺少 ACAO                        | blocked（完整 Paraformer 链路不能直连） |
| 百炼 Intl getPolicy、任务查询                                                       | fetch 失败                  | 浏览器明确报告预检缺少 ACAO                        | blocked                                 |
| 百炼 CN 任务查询                                                                    | 可读 401                    | ACAO = 当前 localhost Origin                       | 仅该路径通过                            |
| 百炼 CN 转写提交（含两个 DashScope 请求头）                                         | 可读 401                    | ACAO = 当前 localhost Origin                       | 仅该路径通过                            |
| 百炼 OSS multipart 上传候选域名 `dashscope-file-mgr.oss-cn-beijing.aliyuncs.com`    | 可读 403 InvalidAccessKeyId | ACAO = `*`                                         | 候选域名通过，真实签名上传未测          |
| 百炼结果下载候选域名 `dashscope-result-bj.oss-cn-beijing.aliyuncs.com` 的不存在对象 | 可读 403 AccessDenied       | ACAO = `*`                                         | 候选域名通过，真实签名结果 URL 未测     |
| Groq `/models`、`/audio/transcriptions` multipart                                   | 可读 401                    | ACAO = `*`                                         | ok                                      |
| OpenAI `/models`                                                                    | 可读 401                    | ACAO = `*`                                         | 仅连接测试路径通过                      |
| OpenAI `/audio/transcriptions`、`/chat/completions`                                 | fetch 失败                  | 浏览器明确报告缺少 ACAO                            | blocked（转写与纪要预设）               |
| 千问兼容 `/chat/completions`                                                        | 可读 401                    | ACAO = `*`                                         | ok                                      |
| DeepSeek `/chat/completions`                                                        | 可读 401                    | ACAO = 当前 localhost Origin                       | ok                                      |
| 智谱普通 API `/chat/completions`                                                    | 可读 401                    | ACAO = 当前 localhost Origin                       | ok                                      |
| GLM Coding Plan                                                                     | 未发业务请求                | 需要插件请求头适配                                 | 网页不可用                              |
| 本地 Ollama `localhost:11434/v1/models`                                             | 连接失败                    | `ERR_CONNECTION_REFUSED`；本机未安装 / 运行 Ollama | unknown，不能判定 CORS                  |

无效 Key 无法取得合法 getPolicy 返回的上传地址、临时凭据、任务号与签名结果 URL，因此两个 OSS 候选域名的失败响应**不等于真实上传 / 结果链路实测成功**。不得用仓库回放 fixture 宣称这条链路通过。当前网页版百炼整体标为 blocked，保留插件使用路径；网页用户可改用 Groq 或自行提供 OpenAI 兼容网关。

网页设置根据能力标记显示提示，Base URL 同时作为「代理 Base URL」。自建网关必须自行允许实际网页 Origin、方法与请求头；本项目没有托管代理。改到不同 Origin 时沿用清空密钥规则，避免把原服务商 Key 发给另一服务。能力标记描述默认端点，修改后的 Base URL 变为 unknown；允许重新测试，只有 GLM Coding Plan 禁止调用。

网页包装服务商调用，将在线状态下的 `TypeError: Failed to fetch` / `ProviderError(network)` 转成独立 `cors` 错误。浏览器不会向脚本披露 CORS、DNS、TLS 的细节，文案明确是「可能为 CORS」，离线和有 HTTP 状态的鉴权错误保持原分类。插件的请求与错误转换不变。

## 实机授权结论与待验收

本环境无桌面显示器 / 人工目录选择交互，未验证操作系统文件夹选择、Chrome 持久授权与失效后补写；单元测试覆盖既有授权状态与源索引重建。已在真实 Chromium preview 中验证录制入历史、静音拒绝上传；生成 WAV 作为测试麦克风、配合本地固定响应网关验证完整处理、编辑、导出和刷新持久化。后者属于可重复集成测试，不是有效 Key 服务商验收。详细清单见 [U-101 验收说明](../U-101-WEB-APP.md)。

参考：[Chrome Document PiP](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)、[百炼临时文件接口](https://help.aliyun.com/zh/model-studio/get-temporary-file-url/)、[Ollama Origin 配置](https://docs.ollama.com/faq)。
