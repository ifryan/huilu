# U-51 Board UI 样式映射与验证边界

参考来源：U-52 从 RH 的 Board UI 本地包（`boardui-library@1.0.0`，`ifryan/assets` 提交 `61874070`）提取的截图、参考说明与 tokens。只采用色值、尺度与状态规则，在会录现有组件里自行实现；没有复制原库的 TSX、CSS、字体或素材。

## 映射

| Board UI                                                  | 会录实现                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 背景分层 `#FFF / #F7F7F7 / #EBEBEB`                       | `--color-background`、`--color-surface`、`--color-muted`（分组 / 侧栏 / 导读面板）、`--color-field`（输入填充、分段轨道）         |
| 文字 primary / secondary / tertiary                       | `foreground`、`muted-foreground`、`subtle-foreground`。深色次文字从 `#737373` 提到 neutral-400，保证小字号可读                    |
| 描边 default / hover / active                             | `border`、`border-hover`、`border-active`，用于次按钮与输入的内描边                                                               |
| accent-400…700、主按钮竖向渐变                            | `accent-*` 与 `bg-gradient-primary(-hover/-active)`，用于主按钮与侧栏选中项                                                       |
| 状态 lime / rose                                          | `success(-soft)` / `error(-soft)`。Board UI 没有警告色的语义变量，取同级 yellow 作为 `warning(-soft)`                             |
| 字号 Title 2 / Headline / Body / Body 2 / Caption（px）   | `text-title2`、`text-headline`、`text-body`、`text-body2`、`text-caption`。用 px，悬浮面板在网页 Shadow DOM 里也不受网页 rem 影响 |
| 按钮 36 / 圆角 10，small 32 / 圆角 8，按下 0.98           | `buttonVariants`：`default`、`outline`、`ghost`、`danger`，加 `icon` 尺寸                                                         |
| 键盘焦点：2px accent-500 外环、offset 2                   | 按钮、分段控件、选项卡、未单独设焦点样式的元素                                                                                    |
| 输入：灰填充，hover / focus 用 2px 内描边，invalid 浅红底 | `fieldClass`，下拉框自绘箭头                                                                                                      |
| 卡片圆角 16 + 轻投影；侧栏与弹层圆角 24 + 浮动投影        | `Section`、历史列表容器、导出菜单；插件网页侧栏、悬浮录制面板、播放条                                                             |
| SegmentedControl                                          | 弹窗里的录制模式、来源、画质                                                                                                      |
| 下划线 Tabs                                               | 结果页窄屏的逐字稿 / 导读切换                                                                                                     |
| 表格：工具栏 + 浅灰表头 + 状态标签 + 行尾操作             | 历史记录列表、服务商对比表                                                                                                        |
| RadioCard                                                 | 首次引导的步骤卡                                                                                                                  |
| Notification：白卡 + 小型彩色图标                         | 插件网页顶部的就绪提示                                                                                                            |
| Remix 线性图标                                            | 改用依赖里已有的 lucide 线性图标（风格相近），统一从 `@huilu/ui` 引入                                                             |

原库没有播放器、波形、逐字稿时间轴样式，这些沿用会录现有结构，只套用上面的表面、圆角与强调色。

## 验证

- 通过：`pnpm check`（格式、lint、类型、单测）和 `pnpm build`。构建里超过 500 kB 的 chunk 警告在 main 上已经存在。
- 用 Playwright 驱动 Chrome for Testing 加载构建产物，截图对比改造前后：
  - 中文、英文；宽 1280 和窄 390 两种宽度
  - 弹窗、历史、结果页（含窄屏导读选项卡和导出菜单）、设置、引导
  - 深色模式，以及键盘 Tab 焦点
- 截图里的会议是写进 OPFS 模拟数据文件夹的非敏感样例，没有调用转写或模型服务。
- 未实测：
  - 悬浮面板只截到了“开始录制失败”的空闲态。这台 Linux 机器上，用伪造设备开始标签页录制会报 `NotFoundError: Requested device not found`，U-37 的录制冒烟脚本在当前构建上同样失败。录制中状态卡的计时、暂停 / 结束、电平条没有在浏览器里看过。
  - 真实录制、转写和纪要的全流程。
  - macOS / Windows 的字体渲染。Inter 没有打包进插件，系统没有时会回退到系统字体。
