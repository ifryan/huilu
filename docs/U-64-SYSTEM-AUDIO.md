# U-64 来源音频缺失与静音转写

## 实现与基线

- 分支：`feat/U-64-system-audio`；基于 `origin/main@c59f24c`，未继承其他 backlog 分支。
- 修复提交：`b024e39`；后续提交补充浏览器验证、测试及本文档。
- 开始前已 fetch，主仓库 `git pull --ff-only origin main` 成功，无领先提交；主仓库原有未跟踪 `AGENTS.md`、`.multica/` 保留。开发位于独立 U-64 工作树。
- U-64 原滴答图片未上传，无法核对原图；已下载并实际查看 U-91 的补充截图。该图的原生窗口选择器提示改分享标签页或屏幕才能分享音频。

## 行为

1. 勾选「录制来源 / 系统音频」，但浏览器未授权或未提供存活音轨时，抛出 `SourceAudioUnavailableError`，停止启动并释放已打开的流、AudioContext。不会继续录一场只有麦克风的会议。
2. 中英错误提示说明：改选会议标签页，或支持分享音频的屏幕并勾选原生选择器中的选项。只需麦克风或无声视频时，用户可以主动关闭来源音频。
3. 保持来源音频与麦克风分别控制，通过同一混音总线送入单声道转写音轨；关闭任一路时不会包含该路。
4. 转写上传前，使用已有 mediabunny/WebCodecs 在本地流式解码。所有声道全程峰值均不超过 `0.00001`（-100 dBFS）时，以 `silentAudio` 停止处理，不请求 ASR/LLM，不生成逐字稿/纪要；OPFS 原录音保留。
5. 无音频帧、损坏文件或解码失败显示 `audioInspectionFailed`，不会把检查失败当静音，也不会继续上传。取消检查会释放解码资源。

窗口能否提供音频由 OS/Chrome/用户授权决定。代码遵守原生选择器返回的 `canRequestAudioTrack`，不强求系统未授权的声音。参考 [Chrome desktopCapture API](https://developer.chrome.com/docs/extensions/reference/api/desktopCapture) 与 [Chrome 录音/录屏说明](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)。

## 已执行验证

- `pnpm check`：格式、lint、类型检查及全套单元测试通过。录制回归包括三类来源缺失实际音轨、窗口/屏幕未授权音轨、资源释放、主动关闭来源音频；管线回归包括静音、解码失败、正常信号以及阻断 ASR/LLM 调用。
- `pnpm build`：通过，保留现有 bundle 体积提示。
- Chromium 156.0.8078.4：在隔离测试 profile 中实际执行 Web Audio、MediaRecorder Opus 编码与 WebCodecs 解码。**getUserMedia 边界注入合成 MediaStream，不等同原生采集实测。**

| 测试     | 440 Hz 来源振幅 | 880 Hz 麦克风振幅 | 结果               |
| -------- | --------------- | ----------------- | ------------------ |
| 两路开启 | 约 0.20         | 约 0.20           | 单声道输出包含两路 |
| 仅来源   | 约 0.20         | 小于 0.00001      | 麦克风未混入       |
| 仅麦克风 | 小于 0.00001    | 约 0.20           | 来源未混入         |

- 实际 Opus 静音检测：数字静音拦截；0.0001 振幅的低音量信号通过；仅右声道且后半段出现的信号通过；损坏输入拒绝；已取消输入返回 AbortError。
- 已构建插件的完整离屏管线：将合成静音录音放入该测试 profile 的真实 OPFS，经后台 `processMeeting` 执行。实际任务变为 `failed/silentAudio`，录音 590 字节保留，本地测试服务收到的上传调用为 0。实际历史 UI 显示原因，提供中英截图。

## 浏览器验证复现

先执行 `pnpm install --frozen-lockfile`、`pnpm build`。安装有 Playwright Core 与对应 Chromium 的环境执行：

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core/index.mjs \
CHROMIUM_PATH=/absolute/path/to/chromium/chrome \
node scripts/verify-u64-browser.mjs
```

如当前项目可解析 `playwright-core` 且已有匹配浏览器，可省略这两个变量。结果、生成的三段测试录音及截图写入被 Git 忽略的 `output/playwright/U-64-<timestamp>/`。脚本自动关闭浏览器和 HTTP 服务。无真实麦克风、会议文件或收费服务参与。

添加 `REAL_TAB_CAPTURE=1` 可尝试从 localhost 测试音标签页获取真实 tabCapture 流，麦克风仍为合成流。此模式在本机 headless Chromium 已尝试，取流返回 `NotFoundError: Requested device not found`，未把它算成通过；测试使用 allowlisted-extension-id 跳过交互授权，也不能代替真实用户手势验收。

## 桌面人工验收与限制

1. 加载构建的扩展；会议标签页播放声音，开启来源音频和麦克风，分别播放远端声音与对麦克风讲话。结束后回放，确认两路均可听见；分别关闭两路复测开关。
2. 选择不支持音频的窗口，保持来源音频勾选：应停止启动、显示改选来源提示。主动关闭来源音频后，可按用户选择录麦克风或无声视频。
3. 选择支持系统声音的屏幕并勾选原生分享音频选项，回放确认声音；没有此选项的环境不能视为已支持。
4. 录一段全程数字静音文件并处理：应提示全程静音、没有逐字稿/AI 纪要、仍可找到原音频。真实 ASR Key 流程本轮未测。

本机没有完成原生选择器、实体麦克风及 Windows/macOS 跨平台实测。检测只阻断全程接近数字静音，不是语音活动检测；背景噪声、音乐及真实 ASR 幻觉仍可能存在。已有缓存逐字稿不会被本修复覆盖或删除。

本轮仅本地 commit，未 push、创建 PR、merge 或发布。各项截图和日志通过 U-64 评论附件交付。
