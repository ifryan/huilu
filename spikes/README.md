# v0.1 技术验证（spikes）

对应 PRD 8.1「技术验证项」，结论见 [ADR 0004](../docs/adr/0004-spike-results-v0.1.md)。本目录是一次性验证代码，**不属于 pnpm workspace**，也不参与主工程的 lint / 类型检查 / 构建，正式实现完成后可整体删除。

## 内容

| 路径                                 | 作用                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `extension/`                         | 不经打包、可直接「加载已解压的扩展程序」的 MV3 插件：后台 + 离屏文档 + `lab.html` 验证页面                    |
| `extension/lib/recorder.js`          | 录制引擎：tabCapture / 合成画面 → Web Audio 混音（+ 麦克风）→ 两路 MediaRecorder → 每 5 秒一个分片写入 OPFS   |
| `extension/lib/media.js`             | 播放 / 拖动检查、mediabunny 解析、fMP4 → 普通 MP4 流式转封装                                                  |
| `extension/lib/dashscope.js`         | 百炼 Paraformer：临时文件上传 → 提交任务（发言人区分）→ 轮询 → 结果转成 `core` 的 `Transcript`                |
| `extension/lib/openai-compatible.js` | Groq / OpenAI 兼容转写，按切片偏移合并                                                                        |
| `extension/lib/split.js`             | 超过单文件上限时按静音点切片（只解码切点附近的窗口，不整段解码）                                              |
| `scripts/run-media.mjs`              | 验证项 2、3 自动化：无头 Chrome 中录合成画面（每秒整点闪白 + 哔声），采样内存 / CPU，结束后校验与 ffmpeg 分析 |
| `scripts/avsync.mjs`                 | ffprobe 容器信息 + 闪白 / 哔声配对测音画偏移，可单独对任意录制文件运行                                        |
| `scripts/run-split.mjs`              | 验证 Groq 25MB 切片：切点是否落在静音里、每片是否不超限、时长是否守恒                                         |
| `scripts/transcribe.mjs`             | 验证项 4：在插件页面（`chrome-extension://` 源）里跑百炼 / Groq 全流程                                        |

## 准备

```bash
cd spikes
npm install              # 安装 playwright-core、mediabunny，并把 mediabunny 复制到 extension/vendor/
```

自动化脚本默认使用 Playwright 缓存中的 Chrome for Testing（`npx playwright install chromium`），也可以用 `CHROME_PATH` 指定。
注意：正式版 Google Chrome 137+ 已不再支持 `--load-extension`，自动化请用 Chrome for Testing / Chromium。

## 自动化验证（无需人工）

```bash
npm run test:mp4                                   # 1080p 录 3 分钟：分片校验、播放拖动、转封装、音画同步
node scripts/run-media.mjs --minutes 120 --height 1080   # 2 小时长时录制
node scripts/run-media.mjs --minutes 1 --mic       # 混入（假）麦克风
npm run test:split                                 # 40 分钟音频按 2MB 上限强制切片
DASHSCOPE_API_KEY=sk-... node scripts/transcribe.mjs --provider paraformer --file 会议.webm
GROQ_API_KEY=gsk_...     node scripts/transcribe.mjs --provider groq --file 会议.webm
```

结果写在 `out/<运行 id>/report.json`（`out/` 不入库）。不设置 Key 时 `transcribe.mjs` 用无效 Key 做连通性检查，预期拿到服务端 401 JSON（证明插件源下没有 CORS 问题）。

## 人工验证（在自己的桌面 Chrome 上）

1. `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `spikes/extension`
2. 加载后会自动打开验证页 `lab.html`（之后可在地址栏输入 `chrome-extension://<插件 ID>/lab.html` 再次打开）

### 验证项 1：文件夹授权持久性（清单）

| #   | 操作                                                                               | 记录                                                              |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | 点「选择数据文件夹」，选一个普通文件夹                                             | 授权弹窗文案；表格最新一行 `permission`                           |
| 2   | 点「本页写入测试」「离屏文档写入测试」                                             | 离屏文档的 `queryPermission` / `write` / `requestPermission` 结果 |
| 3   | 关闭 lab 页再打开（浏览器不重启）                                                  | `page-load` 行的 `permission`                                     |
| 4   | 完全退出 Chrome 再打开 lab 页                                                      | `permission` 是否变为 `prompt`                                    |
| 5   | 点「重新授权」                                                                     | 是否出现三选项（「每次访问时都允许」）；选它                      |
| 6   | 再次完全重启 Chrome，打开 lab 页，**不点「重新授权」**，直接点「离屏文档写入测试」 | 是否仍为 `granted`、离屏文档能否直接写                            |
| 7   | 在 `chrome://extensions` 点「重新加载」插件后打开 lab 页                           | 授权是否保留（模拟插件升级）                                      |

### 验证项 2 / 3：真实标签页录制

1. lab 页选好分辨率、是否混入麦克风（先点「授予麦克风权限」），选项会保存
2. 切到一个会议 / 视频标签页，点工具栏插件图标开始录制（图标显示 REC），再点一次结束
3. 录制期间用 Chrome 任务管理器（Shift+Esc）观察「扩展程序：HuiLu Spikes」的内存与 CPU
4. 回到 lab 页「刷新录制列表」→「校验分片」「播放/拖动」「转封装 MP4」「导出到文件夹」
5. 在 lab 页顶部的视频格式下拉框里可以看到本机支持的 MIME（Windows / macOS 预期支持 `avc1 + mp4a` 即 AAC）
