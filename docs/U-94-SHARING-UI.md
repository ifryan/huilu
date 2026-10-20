# U-94 录制浮窗层次与 Chrome 原生共享提示

## 交付范围与阻塞

需求原图已通过 Multica 官方 CLI 下载并实际查看。图中的 `HuiLu is sharing a window.`、`Stop sharing`、`Hide` 属于 Chrome 原生共享提示条。插件没有修改该窗口外框、阴影或样式的公开 API。因此，“由插件消除原图外框叠层”仍然受浏览器边界阻塞，不能把以下网页面板优化当作原图已修复。需由 RH 确认是否接受保留原生提示条、需要时手动 Hide 的验收边界。

独立完成的可控改动：网页录制控制的状态内容直接嵌入外层白色浮层，移除内部灰色圆角卡片及其额外内边距；暂停、继续、结束确认、收起、关闭、拖动、恢复和音量信息保留。工具栏、侧边栏及采集页仍使用原来的状态卡样式。

## Git 基线

- 运行于 ryan-ubuntu / Linux，独立工作树 U-94，分支 `feat/U-94-sharing-ui`。
- 精确继承 U-93 已核查 HEAD `2ce504ad99a6ee3405a8a4b1c3adf8c314cdfe05`，包含 U-64 / U-91 / U-92 / U-95 的累积提交。
- 原生采集宿主不再创建独立 popup 的修复复用 U-93 实现 `915c15f3f008bd50a77a03f081031903d03644af`；本项独立验证，不把继承当新实现。
- 本项网页样式实现 `d90eaa524ce2814f6fb86f02f603349cdb217788`。
- 开工确认 remote 为 `https://github.com/ifryan/huilu.git`；fetch 后远程 main 仍为 `c59f24c008f9d0b0ee283ed0a7abca8d08fda85a`，工作树 `git pull --ff-only origin main` 返回 Already up to date。没有覆盖用户改动，没有 push、PR、merge 或 deploy。
- 按多机协作 skill 扫描既有代码根，发现 33 个仓库/工作树，无扫描错误；仍有 1 处 symlink 限制，不宣称全盘覆盖。仅刷新本机清单，并经官方 CLI 读回核对。

## 原生、宿主与网页的证据边界

本次使用 Chromium 156.0.8078.4、X11/Xvfb 与 xfwm4（关闭合成器）的隔离桌面。原生选源、共享提示条 Hide 都由真实 X11 键鼠操作，没有媒体 API 注入或自动授权参数。截图中的橙色按钮与用户原图蓝色按钮受浏览器主题影响，不作逐像素相同的声明。原图未提供 Chrome 版本/OS，不能据此判断其 OS 阴影的具体贡献。

原图单张截图也不足以回溯当时是否有多路分享。本次检查当前代码与 U-93 基线的实际窗口数，不将本机未复现重复实例表述为已排除原机所有成因。

审计复用 `scripts/verify-u93-browser.mjs` 的实际构建与生命周期流程，增加 `AUDIT_SHARING_UI=1`：

- 用 CDP 穿透检查封闭 Shadow DOM，记录宿主、Shadow root、popover layer、面板数量和计算样式。
- 用 `xwininfo` 保存原生窗口树、窗口位置/尺寸及 Map State，和同一时刻的完整桌面截图交叉检查。
- 关闭网页面板后，Shadow DOM/面板归零，共享提示条仍在；两者属于不同的 UI。
- 页面 DOM 内没有原生共享提示文字。原生提示条的窗口管理器父框及其子句柄不等于重复的插件实例。
- 点击 Chrome 的 Hide 后检查原生窗口不再 IsViewable、录制仍进行，再暂停/继续、结束保存；保留前后截图。
- 网页外层只有一处浮层阴影，透明 popover layer 无背景/边框/阴影。改动前内部状态卡有灰色背景，改动后该内部背景透明。

原生条的文字颜色使 OCR 常漏掉 Hide。脚本保存原生条的真实裁剪图；OCR 失败时使用已查看截图验证的 Chromium 156 最右侧 Hide 位置，坐标相对于实际 X11 窗口尺寸计算，并以“提示条最小化且录制继续”验证点击效果。该行为仅在验证脚本中，没有加入产品自动隐藏逻辑。脚本也修复了先发起录制再监听新标签页导致的测试竞争；先前驱动失败的运行不作为通过证据。

官方依据（2026-10-20 查阅）：

- [Chromium Media Capture 文档](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/media/capture/README.md) 将 screen capture indicator 明确列为浏览器 UI。
- [Chromium 共享提示条实现](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/browser/ui/views/screen_capture_notification_ui_views.cc)（页面 blob `b1ad7c7dcb8cd2da72d0e0dac79c6714314b37e1`）：独立 Views widget 绘制 frame 和标准阴影；Hide 最小化该 widget，Stop 则执行停止回调。这支持“原生外框不属于网页卡片”的归属判断，不能据此证明用户原机的合成器行为。
- [Chrome desktopCapture API](https://developer.chrome.com/docs/extensions/reference/api/desktopCapture) 提供选源和取消选源等接口，没有共享提示条的 CSS/边框/阴影设置。

## 本次实际验证结果

以下为最终完整通过的报告，均包含在审查包 `evidence/` 中。早期驱动调试失败不列作通过证据。

| 报告目录                        | 结果                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `U-94-u93-before-1792494643489` | U-93 实际构建基线，`passed=true`                                |
| `U-94-native-1792494642738`     | 本项构建、1600×1000 原生桌面，`passed=true`                     |
| `U-94-small-125-1792494644538`  | 本项构建、1200×900 物理屏 / 960×720 逻辑屏、125%，`passed=true` |
| `U-94-injected-1792494602043`   | 独立标记的媒体边界注入，`passed=true`                           |

前后基线与 125% 两组桌面都确认：窗口/全屏共享各只有 1 个原生共享提示窗口；网页有 1 个宿主、1 个 closed Shadow root、1 个透明 popover layer、1 个面板。关闭网页控制后这四项归零，原生条仍为 1。主动 Hide 后原生窗口 Map State 从 IsViewable 变为 IsUnMapped，录制保持 recording。最终面板内部状态内容从 `rgb(247, 247, 247)` / 16px 顶部内边距变为透明 / 0px，独立证明网页视觉优化。

原生标签页、窗口和全屏无声视频均保存；另有真实标签页音频保存 53,718 字节、5 片，440 Hz 解码幅值 0.19991。125% 标签页音频为 54,531 字节，幅值 0.20015。窗口/全屏 Hide 后仍有录制字节增长，随后暂停/继续、结束保存及采集页/浮层清理通过。中英工具栏实际恢复、网页刷新/导航后恢复、收起/展开、取消/关闭选源及并发启动拒绝通过。无声视频没有 audio 字段，其后处理失败不能当转写通过。

注入组单独验证缺少授权/缺轨拒绝、不提前打开 mic、440/880 Hz 混音、mic-only、无声视频、未知来源拒绝，以及全部宿主/轨道清理；强关采集页后恢复 OPFS 已写入音频 15,487 字节。注入不代表实体设备或系统音频通过。

`pnpm check`（格式、lint、类型和 490 项测试）及 `pnpm build` 通过；最终调用复用 Turbo 缓存。`git diff --check` 通过。此次为样式调整，未增加镜像实现的单元测试，使用实际构建的计算样式、截图与控制交互作验证。

## 复现与交付

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
AUDIT_SHARING_UI=1 \
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chrome \
XVFB_PATH=/absolute/path/to/Xvfb \
node scripts/verify-u93-browser.mjs
```

还需 xfwm4、ffmpeg、xdotool、xwininfo、tesseract。`EVIDENCE_LABEL` 可指定报告标签。`EXTENSION_BUILD=/path/to/U-93/build` 用于前后对照，保留 U-93 的新生命周期断言；旧的 `BASELINE_EXTENSION` 专用于 U-95 旧生命周期基线，不用于本项。`SCALE=1.25 SCREEN_SIZE=1200x900x24` 验证小屏缩放。`INJECT_CAPTURE=1` 是明确注入的故障/混音/OPFS 恢复验证，不能作真实系统音频证据。所有子进程均在当前前台脚本的 finally 中清理。

解压交付的插件包，在 Chrome 扩展页开启开发者模式，加载含 manifest.json 的目录。选择窗口或全屏开始录制，对照原生共享条和网页控制面板；关闭/恢复及收起/展开网页控制，再主动点击原生 Hide。录制应继续，随后结束并确认保存与采集标签页、网页浮层清理。英文重复同组操作，导航/刷新后可从插件图标恢复控制。

限制仍保留：Linux 虚拟桌面不是原机实测；未测实体麦克风、多屏、Windows/macOS、真实 ASR。窗口/全屏视频成功不等于系统音频成功。显式快捷 tabCapture → offscreen 路径的既有 NotFoundError 未在此修复。U-64 的静音保护、缺轨拒绝、显式授权、互斥与释放约束不变；原 ADR 的文件夹授权及跨平台 AAC/CPU 等未测项不因此通过。
