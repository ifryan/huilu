# U-91 指定窗口的来源音频

## 基线与实现

- 分支 `feat/U-91-window-audio`，独立工作树 `U-91`；继承 Chief 已核查的 U-64 HEAD `abcc2f1b0e074af1b48de3d8773aad55b67d77df`（含修复 `b024e394de43cfb55df54d1e06d782403e8d39c0`）。共同远程基底 `c59f24c008f9d0b0ee283ed0a7abca8d08fda85a`。
- 开始前核对 remote、fetch，U-91 工作树执行 `git pull --ff-only origin main`，返回 Already up to date；main 及 U-64 未改动，原有未跟踪文件保留。
- 本项修复提交 `f4ff8b8e2494957dae34fbedd3f5395982e31d27`，后续提交补本文档和可复现浏览器脚本。仅本地提交，未 push / PR / merge / deploy。
- 已通过 Multica CLI 下载并查看原截图。原生选择器显示 “To share audio, share a tab or screen instead”；不能据此声称所有 Chrome / OS 都支持窗口音频。

窗口来源的实际链路是：后台保存 `sourceAudioRequested` → 可见 `recorder.html` 调用原生选择器 → 将 `canRequestAudioTrack` 转成 `sourceAudio` → 同一可见页面的 RecorderController / browserMediaBackend。**窗口采集不走 offscreen**；离屏文档负责标签页采集及会后处理。

本项在 U-64 缺音轨保护上补充：

1. 用户要求音频，但原生选择器未授予时，在打开任何媒体设备 / AudioContext 前拒绝启动；不会先打开窗口画面再关闭。
2. 窗口拒绝授权或实际缺少存活音轨时使用 `WindowAudioUnavailableError`，经真实扩展消息传给后台，转为专用中英提示。提示说明改选会议标签页或支持分享音频的屏幕，也说明保留此窗口、仅录麦克风或无声视频的方法。
3. 设置中选择窗口时显示窗口专用能力说明；保持来源音频与麦克风独立，不自动关闭音频或静默改录麦克风。
4. 保留后置音轨检查：即使授权允许，实际没有音轨仍会停止并释放已打开的源流 / AudioContext。

Chrome 官方契约：`canRequestAudioTrack=false` 时不能请求音频；未使用的 streamId 数秒后过期。参考 [desktopCapture API](https://developer.chrome.com/docs/extensions/reference/api/desktopCapture)。此修复尊重返回授权，没有增加系统权限或绕过原生选择器。

## 自动验证

`pnpm check`（格式、lint、类型、470 项单元测试）与 `pnpm build` 均通过。新增/扩展回归覆盖窗口/屏幕实际授权、拒绝授权不打开设备、失败后主动关闭来源音频重试、窗口专用错误序列化。继承 U-64 的实际音轨缺失释放、混音开关和静音管线回归继续通过。

浏览器 Chromium 156.0.8078.4，隔离 profile，已构建插件的真实后台、可见采集页面、弹窗 UI、Web Audio / MediaRecorder / OPFS：

| 场景                           | 证据与结果                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 窗口选择器返回不允许音频       | 注入回调 `canRequestAudioTrack=false`，保留所有应用代码；UI 显示中英窗口错误，状态 idle，采集窗口数 0，getUserMedia 调用 0；可重试                        |
| 关闭来源音频，只录麦克风       | 注入 canvas 来源和 880 Hz 麦克风；真实编码/落盘/解码为单声道，880 Hz 振幅约 0.20，440 Hz 小于 0.002；停止时源视频与麦克风轨均调用 stop                    |
| 来源音频和麦克风都关闭，录视频 | 真实 MP4 落盘，manifest 只有 video，meeting.media.audio 缺失；源视频轨调用 stop，无转写音轨                                                               |
| 真正的 tabCapture → offscreen  | localhost 440 Hz 测试音；后台取得真实 token，真实 `/offscreen.html` 使用原始 getUserMedia；仍返回 `NotFoundError: Requested device not found`，**未通过** |

桌面来源的选择器和 getUserMedia 边界为注入测试，不能当作原生选择器或实体麦克风实测。两种可用录制均在同一浏览器生命周期、窗口失败之后完成，证明应用重试与互斥锁恢复。截图显示的是实际构建 UI。

标签页补证使用与 U-64 先前“扩展测试页消费 token”不同的真实离屏路径；脚本仅在测试副本的 offscreen HTML 插入观测脚本，包装 getUserMedia 记录约束/结果，不替换实际调用。结果证明更换消费页面后仍失败，**不能据此认定 OS 是原因，也不能认定真实标签页录音通过**。测试通过 allowlisted extension 跳过交互授权，仍需桌面手势实测。本项没有扩大范围修复 headless 音频环境。

## 复现

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chromium/chrome \
node scripts/verify-u91-browser.mjs
```

脚本关闭浏览器和 HTTP 服务，产物在被 Git 忽略的 `output/playwright/U-91-<timestamp>/`。`desktopCasesPassed=true` 只表示上述桌面边界注入场景通过；另看 `cases.nativeTab.passed`，该项失败会保留真实探针结果，不冒充整个浏览器验收通过。未使用私人录音、用户数据或付费 API。

桌面人工复现：

1. 加载构建插件，在可注入的普通网页选择“指定窗口”，开启来源音频。先看到窗口能力提示；在无法分享音频的原生选择器选窗口，预期启动失败、明确原因、无录制继续运行。
2. 重新打开插件，关闭来源音频、开启麦克风再开始，预期可录此窗口的麦克风声音；播放回录音核对。关闭麦克风后选择“音频 + 视频”，预期可录无声视频且没有转写入口。
3. 另选会议标签页，或当前系统支持分享音频的屏幕并勾选“分享音频”，实际播放远端声音与对麦克风讲话，结束回放核对两路。没有原生分享音频选项时不可视作该来源支持音频。

尚未实测：交互式原生窗口/屏幕选择器、实体麦克风、真实标签页音频成功路径、Windows/macOS、真实 ASR Key。继承 U-64 的静音保护不能拦截所有噪声识别幻觉。
