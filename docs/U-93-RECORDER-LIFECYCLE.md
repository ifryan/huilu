# U-93 去除常驻全局弹窗

## 本地交付与继承

- 分支：`feat/U-93-recorder-lifecycle`；实现提交 `915c15f3f008bd50a77a03f081031903d03644af`。
- 继承已核查 U-95 HEAD `5808a9a173d60e46af03502317bdf25d41558f65`，包含 U-64 / U-91 / U-92 / U-95 的全部累积提交。共同远程基底为 `c59f24c008f9d0b0ee283ed0a7abca8d08fda85a`。
- 开工确认 GitHub remote，fetch 后 `git pull --ff-only origin main` 返回 Already up to date；独立工作树开发，主仓库及前项改动保留。未 push、PR、merge 或 deploy。
- 已通过官方 CLI 下载并查看需求截图：图中前景是 macOS 原生来源选择器，后面是独立 HuiLu 采集窗口。浏览器必要授权选择器仍然保留。

## 结果

1. 统一来源选择直接使用原浏览器内的可见采集标签页，不再创建独立 HuiLu popup 窗口；选源后切回发起网页，采集标签页保留在后台。原生选择器仍提供标签页、窗口和全屏。
2. 所有状态路由、异常关闭识别和正常结束清理改为跟踪采集 **tab ID**。正常结束只关闭采集标签页，不关闭用户原浏览器窗口。采集页自身也提供暂停、继续、结束入口，避免源网页关闭时失去控制。
3. 开始失败、取消和录制结果只在用户主动打开工具栏时显示；不会再自动注入闲置网页浮层。活动录制仍有可拖动、收起、关闭的必要控制，关闭后回收完整 Shadow DOM、top layer 和监听器。
4. 录制结束后自动移除网页浮层及采集标签页。网页导航/刷新后不自动重建浮层；可从工具栏“显示录制面板”恢复，媒体采集保持运行。
5. 普通浏览器窗口由 Chrome 自己居中原生选择器，不调整用户浏览器尺寸。U-92 的独立窗口布局兼容代码保留，但新流程不再创建该独立宿主；小屏与缩放另外验证，不把旧宿主尺寸当新流程结果。
6. 保留 U-95 的简洁默认页、实际来源元数据、显式快捷 tabCapture，以及 U-64 / U-91 的缺轨拒绝、显式音频授权、静音保护、互斥、取消/重试和资源释放。

## 浏览器前后对照

隔离 profile，Chromium 156.0.8078.4，Linux X11/Xvfb + xfwm4。HTTP 测试页仅播放自生成 440 Hz 测试音；没有真实会议或 API Key。原生选择通过 X11 真实键鼠操作，没有注入媒体 API 或自动同意分享参数。报告同时记录 windows/tabs、实际录制状态、页面截图和桌面截图。

| 状态              | U-95 基线                      | U-93                                  |
| ----------------- | ------------------------------ | ------------------------------------- |
| 未录制            | 无窗口、无浮层                 | 无窗口、无浮层                        |
| 原生来源选择中    | 额外 HuiLu popup               | 原浏览器内采集标签页，无额外窗口      |
| 取消 / 关闭选择页 | 网页留下错误浮层               | 无浮层，工具栏可查看错误              |
| 录制 / 暂停       | 独立最小化 popup + 网页控制    | 后台采集标签页 + 网页控制，无独立窗口 |
| 关闭网页控制      | 隐藏内容，保留注入宿主         | 完整移除注入宿主；录制继续            |
| 网页导航 / 刷新   | 浮层消失，可恢复               | 浮层消失，可从工具栏恢复，录制继续    |
| 正常结束          | 独立窗口关闭，网页结果浮层常驻 | 采集标签页和浮层均清零，原网页保留    |

中文及英文都实际打开 Chrome 工具栏 popup，点击“显示录制面板 / Show recording panel”恢复面板，再通过网页面板暂停、继续、确认结束。不是只调用后台消息替代此交互。实际工具栏截图、文字及 AX 树驱动的 Shadow DOM 控件操作均由脚本记录。

真实标签页 / 窗口 / 全屏无声视频均保存，session 与 manifest 的实际来源一致。真实标签页音频保存 53,629 字节、5 片，单声道；解码 440 Hz 振幅约 0.200，证实采集标签页处于后台仍保留有效声音。原生三类来源都验证暂停、继续、停止及宿主清理。未把窗口或全屏视频成功表述为系统声音成功。

125% 缩放 / 1200×900 物理桌面（960×720 逻辑可用屏）同组真实验证也通过；原生三类来源、取消重试、中英实际工具栏恢复、导航及保存都成功。该流程不调整用户浏览器尺寸，原生选择器居中于原浏览器；未把旧版 896×656 的 popup 宿主尺寸当作新流程结果。

完整通过的报告：

- 基线 `U-93-baseline-1792493807146/report.json`，`passed=true`。
- 修改后 `U-93-native-1792493805979/report.json`，`passed=true`。
- 125% `U-93-native-1792493886944/report.json`，`passed=true`。
- 注入 `U-93-injected-1792493757191/report.json`，`passed=true`。

早期脚本运行暴露 OCR 对原生选择器识别不稳定，已改为 OCR 加截图验证过的 Chromium 156 按钮位置兜底。早期“选源后移动宿主”的试验还暴露自选宿主窗口时来源结束，最终实现改为从一开始就使用标签页。以上试验不作为最终通过证据。

## 注入与回归，单独记载

注入模式替换来源选择回调和 getUserMedia，使用真实 canvas/AudioContext MediaStream、MediaRecorder 及 OPFS；它验证调度、清理、混音和恢复，不代表真实设备/系统音频授权通过：

- 缺少授权时媒体请求为 0；已授权却缺轨时不打开 mic；混录 440 Hz 与 880 Hz 均可解码。
- mic-only 不含来源声音；无声视频无 audio 文件；未知实际来源拒绝并释放轨道。
- 全部失败 / 正常结束后采集标签页为 0。
- 强制关闭活跃采集标签页后状态变为 idle、记录中断，网页浮层清理。OPFS 中已写入的音频片可通过“未完成的录制”恢复，实测恢复文件 15,487 字节。此场景不会承诺保留尚未写出的最后一片。
- U-64 浏览器回归 `passed=true`；数字静音不调用 provider。U-91 桌面边界注入 `desktopCasesPassed=true`，包含中英文提示和明确替代路径。
- `pnpm check`（格式、lint、类型、490 项测试，含 Turbo 缓存）及 `pnpm build` 通过；新增后台回归覆盖无窗口创建/缩放、源页恢复、采集页异常关闭、结束后再开始和失败不注入浮层。

仍未解决/未测：显式快捷 tabCapture → offscreen 的既有真实 `NotFoundError: Requested device not found`；默认统一选择器标签页音频已真实成功，两条路径不能混同。没有实体麦克风、多屏、Windows/macOS、真实 ASR 实测。原生来源选择器内部布局、长名称裁剪与系统音频能力仍受 Chrome/OS 管理。原始 ADR 的文件夹授权、跨平台 AAC/CPU 等待补测项不因此通过。U-94 的录制面板双层样式仍属下一项，不在这里提前处理。

## 复现

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chrome \
XVFB_PATH=/absolute/path/to/Xvfb \
node scripts/verify-u93-browser.mjs
```

需要 xfwm4（或 `WM_PATH`）、ffmpeg、xdotool、tesseract。原生点击位置为 Chromium 156 的截图验证值；Chrome 原生布局改变时应检查截图并调整测试驱动，不修改授权结果。脚本在同一前台执行中关闭自身浏览器、HTTP 服务、WM 和 Xvfb。

- 基线：增加 `BASELINE_EXTENSION=/path/to/U-95/apps/extension/.output/chrome-mv3`。
- 125%/小屏：增加 `SCALE=1.25 SCREEN_SIZE=1200x900x24`。
- 注入：增加 `INJECT_CAPTURE=1`；报告明确标记 `injected=true`。
- 累积回归：同样提供 PLAYWRIGHT_MODULE、CHROMIUM_PATH，运行 `scripts/verify-u64-browser.mjs` 与 `scripts/verify-u91-browser.mjs`，分别读取结果及限制。

人工加载附件插件包：先解压，在 Chrome 扩展页打开开发者模式，加载含 manifest.json 的目录。依次测试取消、重新开始、三类来源、录制/暂停时关闭面板、中英工具栏恢复、网页刷新/导航、结束保存；观察无独立 HuiLu 窗口，结束无网页浮层。采集标签页在录制期间需要保留；主动关闭它会中断，应从工具栏恢复已经写入的内容。
