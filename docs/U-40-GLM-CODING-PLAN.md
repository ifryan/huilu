## U-40 实验：纯 Chrome 插件接入 GLM Coding Plan

状态：**实验，未经真实服务验证**。只安装会录插件，不依赖 Pi / Node / 本地代理 / Native Messaging。

### 做了什么

- 大模型「OpenAI 兼容接口」新增两个预设，互不迁移、不互相回退：
  - 智谱 BigModel（普通 API）：`https://open.bigmodel.cn/api/paas/v4`，按量计费 / 资源包。
  - 智谱 GLM Coding Plan（实验）：`https://open.bigmodel.cn/api/coding/paas/v4`。
  - 两个预设都要求 Key；模型名不预填（官方文档各页示例不一致，按套餐页面填写）。
- GLM Coding Plan 预设下多一个「工具请求头适配（实验）」开关（默认开启）。开启时后台用
  `declarativeNetRequest` **会话规则**给请求设置：
  - `User-Agent: claude-cli/2.1.88 (external, cli)`
  - `x-app: cli`

  规则条件：`urlFilter: |https://open.bigmodel.cn/api/coding/paas/v4/`、`initiatorDomains: [插件 ID]`、
  `resourceTypes: [xmlhttprequest]`。规则里没有 Authorization / Key。

- 规则跟随**已保存**的大模型设置：后台启动（含浏览器重启、插件升级 / 重新加载）、设置变化、
  处理管线每一步取设置前都会重新同步；关闭开关、切换预设 / 服务商、改 Base URL 后规则被移除。
- 新权限 `declarativeNetRequestWithHostAccess`：安装时无额外提示，只对已授权域名生效。
  `open.bigmodel.cn` 的域名权限沿用现有流程，点「保存」时申请。
- 错误分类与重试逻辑不变。1113 仍归为 quotaExceeded（不自动重试）；预设说明提示 1113 也可能是套餐未被识别。

### 实际验证（MBP，2026-09-28）

Chrome for Testing 154 临时 profile，本地 HTTPS 模拟端点（`--host-resolver-rules` 把 `open.bigmodel.cn`
映射到 127.0.0.1，`--no-proxy-server` 直连），服务端回显实际收到的请求头；使用假 Key。

| 场景                                                                                                           | 结果                                           |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 保存 Coding Plan 预设后，离屏文档 / Service Worker / 设置页请求 `…/coding/paas/v4/chat/completions`、`/models` | UA 与 `x-app` 已被改写，Authorization 原样透传 |
| 同一插件请求 `/api/paas/v4/…`、`/api/coding/paas/v4x/…`、其他域名的同一路径                                    | 未改写                                         |
| 普通网页（标签页）请求 Coding Plan 端点                                                                        | 未改写                                         |
| 关闭开关 / 切到普通 API 预设                                                                                   | 规则移除，请求未改写                           |
| 切回 Coding Plan、重启浏览器                                                                                   | 规则恢复并生效                                 |
| 原样构建、未授予 `open.bigmodel.cn` 权限                                                                       | 规则存在但不生效（需保存时授权）               |

未验证：智谱服务端是否接受这些请求、是否实际抵扣 Coding Plan 额度、Coding Plan 端点是否支持
`/models`（测试连接用它）、真实会议的纪要生成全流程。

### 手测步骤

1. 在 `chrome://extensions` 刷新会录（插件 ID 不变）。
2. 设置 → 大模型：预设选「智谱 GLM Coding Plan（实验）」，填套餐 Key 与模型名，开关保持开启，点「保存」，
   在弹窗中允许访问 `open.bigmodel.cn`。
3. 可选：点「测试连接」。失败为 404 / notFound 可能只是端点不支持 `/models`，不代表纪要请求会失败。
4. 对一段已转写的短录音生成纪要（历史页手动重试或新录一段）。
5. 区分两个结论：
   - **请求成功**：纪要生成成功只说明服务端接受了请求。
   - **额度确实扣减**：到智谱控制台「费用明细」查看该时间点的抵扣记录是否来自编码套餐；
     若扣的是余额 / 资源包或出现 1113，都不能算作套餐接入成功。
6. 对照：把开关改为「关闭」保存后再试一次，比较服务端响应与扣费来源。
