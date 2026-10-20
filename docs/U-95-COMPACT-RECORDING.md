# U-95 精简录制弹窗与统一来源选择

## 本地成果

分支 `feat/U-95-compact-recording`，继承 U-92 已核查 HEAD `7231b50a3c323ba3ff81045526b26300ed698f67`。实现提交 `5a1984a6492b05f7fddb7bd01060f25f954ffd0d`；共同远程基底 `c59f24c008f9d0b0ee283ed0a7abca8d08fda85a`。已确认 remote、fetch 并在独立工作树执行 `git pull --ff-only origin main`，返回 Already up to date。保留主仓库和前项分支；未 push / PR / merge / deploy。

通过官方 CLI 下载并实际查看需求的四张截图。实现包括：

- 默认只保留录制模式、来源声音、麦克风、更多设置摘要及开始操作。画质、预计体积、会议语言、会议名称集中于可键盘展开的“更多设置”；已授权的麦克风设备选择单独渐进展开，仍有电平反馈。
- 默认“选择来源并开始”打开同一个 Chrome 原生选择器，同时提供 Tab / Window / Entire Screen；声音选项随浏览器实际能力提供。用户仍可在开始前明确关闭来源声音或麦克风。
- 选中的三类来源均在可见采集宿主中使用 **desktop** 凭证取流，按视频轨 `getSettings().displaySurface` 映射为真实 tab / window / screen；无法识别时拒绝并释放轨道，绝不使用旧偏好冒充实际来源。
- 已授权流交给现有混音/MediaRecorder/OPFS 管线，桌面选择器选中的标签页不额外回放声音；仅音频仍保留最低规格的视频轨以感知停止共享，但不保存视频文件。
- 缺少所需音频授权时不打开任何媒体设备；授权有音频但实际缺轨时，在打开麦克风之前拒绝并清理。主动关闭来源声音才允许麦克风录音或无声视频。保留并发启动互斥、取消/关闭重试、每片校验、静音转写保护。
- “更多设置”保留显式“快捷录制当前标签页”，仅用户选择时使用原来的 tabCapture → offscreen 路径；快捷键对旧偏好默认使用统一选择器。

官方依据：[Chrome desktopCapture](https://developer.chrome.com/docs/extensions/reference/api/desktopCapture?hl=en) 的 sources 数组可同时包含 tab/window/screen/audio，音轨以 canRequestAudioTrack 授权为准；[Chrome 录音/录屏指南](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture) 区分可见页面采集与 tabCapture/offscreen。未更换为要求新瞬时激活的 getDisplayMedia，因此不增加第二个确认表单。原生内部排版仍由 Chrome/OS 管理，插件 CSS 不控制其列表、预览或分享开关。

## 界面证据

Chromium 156.0.8078.4，Linux X11/Xvfb + xfwm4，隔离 profile，无用户会议/Key。相同未配置文件夹/API、麦克风关闭、320×600 CSS viewport 的前后对比：

| 场景          | U-92 基线 main 高度 | U-95 main 高度 | 默认滚动 |
| ------------- | ------------------: | -------------: | -------- |
| 中文仅音频    |              732 px |         488 px | 无       |
| 中文音视频    |              808 px |         488 px | 无       |
| English audio |              752 px |         508 px | 无       |
| English video |              828 px |         508 px | 无       |

麦克风开启且尚未授权时，英文音视频默认高度 584 px，320×600 仍无需滚动。320×480 的麦克风关闭场景主按钮底部 472 px，可直接操作，快捷键说明可向下滚动查看；没有宣称所有小屏幕、错误/提示组合都完全不滚动。

已验证更多设置可用 Enter 展开；1080p、30fps、自动识别语言、显式当前标签页选项可保存；键盘聚焦开始按钮会滚动到可操作位置。展开表单允许滚动。实际 Chrome 工具栏 popup 的 DOM 高度/scrollHeight 也记录于原生报告；该目标通过 CDP 检查与操作，来源分享通过真实 X11 键鼠完成。

## 采集与保护验证

- 真实原生选择器：同一弹窗三类来源；分享实际 tab/window/screen 后，会话与落盘 manifest 的 videoSource 一致；三类无声视频均保存、没有伪造 audio。取消、关闭宿主后重试、选择中重复启动拒绝、暂停/继续/停止通过。
- 真实标签页音频：localhost 生成 440 Hz 声音，选择原生 Tab 并分享音频，使用桌面凭证成功录制单声道音频；解码测得 440 Hz 振幅约 0.20。没有注入选择器回调或 getUserMedia，没有自动同意分享参数。
- 125% 缩放：1200×900 物理桌面，可用 960×720 逻辑像素，统一宿主适配为 896×656；同样完成三类选择、实际来源保存及音频录制。工具栏弹窗在此缩放下出现 1 CSS px 的整数取整差值（innerHeight 507、scrollHeight 508），主按钮完整可见；报告保留原始数值。
- 边界注入另记：拒绝音频授权时媒体请求数 0；已授权但缺轨时仅开来源、不打开 mic；混录 440 Hz + 880 Hz 两路均约 0.20，mic-only 的 440 Hz 小于 0.002；无声视频没有转写音频；无法识别 surface 时释放轨道并拒绝。全部失败/结束后宿主清零。
- U-64 回归：混音与数字静音保护通过，数字静音不调用 provider。
- U-91 回归：旧窗口路径拒绝授权的中英错误与明确替代路径通过；显式麦克风/无声视频注入验证通过。脚本的默认说明断言已适应统一来源提示。
- `pnpm check`（格式、lint、类型、488 项测试，含 Turbo 缓存）与 `pnpm build` 通过。

仍有明确限制：当前环境下**显式当前标签页快捷路径**的真实 tabCapture → offscreen 仍返回既有 `NotFoundError: Requested device not found`；默认统一选择器的真实标签页音频已成功，两者须区分。没有实体麦克风、多屏幕、Windows/macOS、真实 ASR Key 实测。窗口/全屏系统声音依赖 OS 与 Chrome，不能从注入或标签页录音结果推断其通过；数字静音保护也不覆盖所有噪声幻觉。窗口网格仍可能裁剪较长名称，未承诺复刻参考产品原生样式。

## 复现与验收

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chrome \
XVFB_PATH=/absolute/path/to/Xvfb \
node scripts/verify-u95-browser.mjs
```

需要 `xfwm4`（或 `WM_PATH`）、ffmpeg、xdotool、xwininfo、tesseract；脚本为当前 Chromium 原生界面定位来源缩略图，并根据原生 Cancel 的 OCR 定位相邻 Share，不修改权限结果。真实工具栏弹窗经 CDP 操作。脚本在同一前台执行中收尾自己创建的浏览器、WM、Xvfb、HTTP 服务；产物在忽略的 `output/playwright/U-95-*`。

- 基线 UI：增加 `BASELINE_EXTENSION=/path/to/U-92/apps/extension/.output/chrome-mv3`。
- 缩放/小屏：增加 `SCALE=1.25 SCREEN_SIZE=1200x900x24`。
- 注入回归：增加 `INJECT_CAPTURE=1`，报告明确记录 injected=true，不能当作真实系统采音结果。
- 前项回归：同样提供 PLAYWRIGHT_MODULE、CHROMIUM_PATH，分别运行 `scripts/verify-u64-browser.mjs`、`scripts/verify-u91-browser.mjs`；后者的 desktopCasesPassed=true 与 nativeTab.passed=false 必须分别读取。

人工验收：加载附件解压后的插件目录，打开工具栏弹窗，中英文分别切换仅音频/音视频；默认操作不滚动，更多设置可展开。开始后在同一个原生选择器切换三类来源；需要来源声音时保留上方开关并在原生弹窗勾选音频。测试取消和直接关闭宿主后再次开始；测试来源声音关闭后的麦克风录音/无声视频。使用真实会议来源时核查实际音轨与电平，再录制、暂停、继续、停止并检查历史文件。
