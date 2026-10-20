## U-99 点插件图标直接在网页上打开会录面板

### 改动

- manifest 不再设 `default_popup`，加 `action.default_title`；后台监听 `action.onClicked`。
- 点图标时：
  - 没在录制、当前网页是 HTTPS / localhost：注入录制内容脚本和**设置面板**（录制画面、麦克风、会议名称、高级选项画质、两个开始按钮、就绪提示、未完成的录制、上次结果、「打开会录」）。
  - 录制中：注入现有的录制面板（计时、暂停 / 继续、结束）。
  - 不能注入（chrome://、应用商店、新标签页）或非 HTTPS：退回工具栏弹窗（`fallback-popup.html`）。后台只给这个标签页临时 `setPopup` 后 `openPopup`，弹窗关闭（端口断开）后清掉，下次点击仍先试网页面板。
- 面板上「选择来源并开始」：在这次点击里直接调用 `getDisplayMedia` 弹出共享选择框，同时请后台嵌存储 iframe、交录制设置（`startRecording` 带 `pagePicker`）；两边都就绪后开始录制。不再出现「网页面板上再点一次选择来源」。
- 面板上「录制当前标签页」：后台用发送方标签页做 `tabCapture.getMediaStreamId`，依赖点图标授予的 activeTab。
- 设置面板录完后回到设置视图并显示结果；快捷键开始的录制仍是录完即收起的录制面板，Alt+Shift+R 行为不变。
- 内容脚本读不到插件的文件夹句柄、域名权限和麦克风授权：新增 `getReadiness`、`getMicrophonePermission`，由后台 / 离屏文档查询。

### 待定项的选择

不能注入的页面选「保留原来的工具栏小弹窗，只在这些页面出现」。按 RH 验收意见，弹窗顶部提示「这个页面不能开始录制，请切换到普通网页后再点图标」，两个开始按钮禁用；录制中仍可在弹窗里暂停 / 结束。`action.openPopup` 从 Chrome 127 起对普通插件开放；`minimum_chrome_version` 仍为 122，更早的版本 openPopup 失败时弹窗设置会保留，用户再点一次图标即可打开。

### 验证

- `pnpm check`、`pnpm build` 通过；后台新增 8 个单测（安全页注入设置面板、chrome:// / http / 应用商店退回弹窗、弹窗关闭后恢复、录制中显示录制面板、面板请求录发送方标签页且不重复注入、pagePicker 不退回采集标签页）。
- 真实浏览器：`scripts/verify-u99-browser.mjs`，Chromium 156、Linux X11 虚拟显示、xdotool 真实点击工具栏图标（CDP `Extensions.triggerAction` 不授予 activeTab，不能用）：
  - 点图标出现设置面板，未打开弹窗 ✅
  - 面板上点一次「选择来源并开始」即开始页面内录制（选择框按标题自动选中），未出现「选择来源」二次提示 ✅
  - 结束后面板回到设置视图并显示「录制已保存」✅
  - 录制中点图标显示录制面板 ✅
  - chrome://version 上点图标打开退路弹窗，关闭后恢复 ✅
  - 「录制当前标签页」：getMediaStreamId 成功（activeTab 有效），取流报本机既有的 `NotFoundError: Requested device not found`（U-64 / U-91 / U-95 已记录），**未算通过**。

运行：`DISPLAY=<1024x768 的 X 显示> PLAYWRIGHT_MODULE=… CHROMIUM_PATH=… node scripts/verify-u99-browser.mjs`；产物在被忽略的 `output/playwright/U-99-*`。

### 未测

- 原生共享选择框的手动选择（脚本用 `--auto-select-tab-capture-source-by-title`）、窗口 / 整个屏幕来源与系统声音。
- 真实 tabCapture 录制当前标签页（见上）。
- 实体麦克风及其授权提示、Windows / macOS、应用商店页面的实机表现（单测覆盖了注入失败分支）、Chrome 122–126 的二次点击退路。
