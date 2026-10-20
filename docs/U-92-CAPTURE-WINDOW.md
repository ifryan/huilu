# U-92 来源选择器位置与裁剪

## 本地交付

分支 `feat/U-92-capture-window`，独立工作树 U-92；继承 U-91 已核查 HEAD `bf99b561afe4e210d652b0a03f89009968c5661b`，共同远程基底 `c59f24c008f9d0b0ee283ed0a7abca8d08fda85a`。已核对 remote、fetch，在新工作树执行 `git pull --ff-only origin main`，返回 Already up to date。保留主仓库和前项分支，没有 push / PR / merge / deploy。

已通过 Multica CLI 实际下载并查看两张原截图。HuiLu 从小型 `recorder.html` 窗口打开窗口来源选择器；千问参考展示的是 Chrome 标签页选择器，两者原生内容布局不同。

修复前创建宿主固定 420×340，不设置 left/top，由浏览器自然偏移放置。修复后：

- 以发起录制的 tab 所在窗口为锚点，避免插件弹窗改变焦点后定位到错误窗口；初始窗口居中落在该显示器。
- 在可见采集页面中读取该显示器的 `screen.availLeft/Top/Width/Height`，在打开原生选择器前扩展至 960×720；小屏幕按可用区域缩小，四周预留 32 逻辑像素，包含窗口装饰余量。保留负坐标，不乘 devicePixelRatio，不申请多屏枚举权限。
- 等待 `windows.update` 完成再调用 `chooseDesktopMedia`。仍由原页面取流和录制；选择完成后继续最小化宿主。创建/加载失败会关闭已创建的窗口并清理就绪计时器。

产品 API 没有提供原生选择器内部宽高、CSS 或标题列表样式的控制选项；本项调整宿主空间与锚点，**没有自绘授权界面，也没有将窗口来源伪装成标签页来源**。Linux 156 原生窗口网格底部仍会滚动/部分裁剪窗口名称；不能声称已复刻千问列表与独立预览样式。屏幕来源的完整预览、标题和按钮已实际验证。

官方契约：[Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows)、[desktopCapture API](https://developer.chrome.com/docs/extensions/reference/api/desktopCapture?hl=en)、[W3C Window Management](https://www.w3.org/TR/window-management/)。原生选择器本身的排版与位置最终由 Chrome/OS 决定。

## 实际验证

`pnpm check`（格式、lint、类型、477 项单元测试，含 Turbo 缓存）及 `pnpm build` 通过。新增 7 项测试覆盖定位发起窗口、负坐标、工作区限位、小窗口扩展及逻辑像素缩放。

Chromium 156.0.8078.4，Linux X11 / Xvfb + xfwm4，隔离 profile。原生验证没有替换选择器回调、没有替换 getUserMedia、没有自动授权分享：通过真实 X11 键鼠操作 Chrome 界面。

| 场景                                   | 结果                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1600×1000 桌面、父窗 (100,50) 1400×900 | 基线宿主 (110,60) 420×340；修复后 (320,140) 960×720。实际前后整桌面截图和 X11 窗口树已保存                                          |
| 原生窗口选择 → Escape 取消             | CaptureCancelledError；idle，宿主 0 个；选择期间再次启动返回 RecorderBusyError                                                      |
| 紧接着重试屏幕选择 → 关闭宿主          | 原生屏幕选择器可打开；关闭按取消处理，idle，宿主 0 个；互斥锁恢复                                                                   |
| 再次重试 → 原生点击屏幕和 Share        | 真实屏幕采集成功；暂停、继续、停止均通过，保存 29,084 字节、2,266 ms；无来源音频/麦克风请求。此例证明真实画面采集，不证明系统采音   |
| 1200×900 物理桌面、125% 缩放、小父窗   | 可用区域 960×720 逻辑像素；实际父窗经 Chrome 最小尺寸约束为 508×342；宿主扩展并限位至 (32,32) 896×656，窗口和屏幕选择/取消/关闭通过 |
| U-91 浏览器回归（边界注入）            | 拒绝窗口音频时不打开媒体设备，中英错误、同生命周期重试麦克风和无声视频均通过；不是原生音频授权或实体麦克风实测                      |
| U-64 浏览器回归（边界注入）            | 混音及数字静音管线保护通过；静音不调用 provider，保留录音                                                                           |

U-91 回归脚本改用 `viewport: null`：Playwright 的 viewport 屏幕仿真曾将逻辑屏幕虚构为 1100×950，与 headless 真实 800×600 桌面不一致，导致 Chrome 的窗口边界校验拒绝。修正验证环境后桌面回归通过，没有为测试绕过应用定位逻辑。

仍未通过/未测：真正 tabCapture → offscreen 取流仍返回既有 `NotFoundError: Requested device not found`；没有把它算作采音成功。macOS 原截图问题、Windows、实体多显示器及跨显示器拖动、实体麦克风、真实 ASR Key 尚未实测。负坐标为单元验证；125% 为实际 Chromium 缩放参数下的 X11 原生选择器验证。噪声幻觉不在数字静音保护的完整覆盖范围。

## 复现

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chrome \
XVFB_PATH=/absolute/path/to/Xvfb \
NATIVE_SHARE=1 node scripts/verify-u92-native-picker.mjs
```

需要 `xfwm4`（或用 WM_PATH 指定）、`ffmpeg`、`xdotool`、`xwininfo`。脚本创建并收尾自身的 Xvfb/WM/浏览器，产物在忽略的 `output/playwright/U-92-<before|after>-<timestamp>/`。`NATIVE_SHARE=1` 的原生鼠标坐标适用于此 Chromium 屏幕选择器版本；默认仅验证取消/关闭，不使用自动同意授权参数。

- 基线对比：设置 `BASELINE_EXTENSION` 为 U-91 已构建插件目录；同一桌面几何条件下运行脚本。
- 小窗口/缩放：`SMALL_PARENT=1 SCALE=1.25 SCREEN_SIZE=1200x900x24`，不启用 NATIVE_SHARE；查看 report.json 的逻辑尺寸与 PNG 的物理尺寸。
- U-64/U-91 回归：同样传 PLAYWRIGHT_MODULE、CHROMIUM_PATH，分别运行 `scripts/verify-u64-browser.mjs` 与 `scripts/verify-u91-browser.mjs`；U-91 要分别检查 desktopCasesPassed 和 cases.nativeTab.passed。

人工验收：加载构建插件，在普通会议页选择“指定窗口”或“整个屏幕”后开始；核对宿主在当前浏览器所在显示器内居中、预览与底部按钮可操作。取消后再次开始，选择期间直接关闭宿主后再次开始；分别以小浏览器窗、高系统缩放、左侧/上方负坐标显示器复验。实际窗口无音频授权时应保留 U-91 提示，不静默改录麦克风。
