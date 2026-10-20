# @huilu/app-shell

插件与静态网页版共用的 Board UI 页面、组件和会议读写逻辑。该包不依赖 WXT，也不调用插件 API。

`@/` 是**构建时的宿主注入契约**，不是此包的私有别名：

- `@/platform`、`@/platform/storage`：打开页面、网络访问能力、存储实例与 `localResults`。
- `@/lib/settings`、`@/lib/readiness`、`@/lib/messaging`：设置、授权状态与类型化命令。
- 其他 `@/lib/*`、`@/components/*`：优先使用宿主覆盖，其余使用共享实现。
- 所有宿主提供相同 hash 路由（`/`、`/meeting/$meetingId`、`/settings`、`/onboarding`、`/permissions/microphone`）；web 另有 `/record`。

插件通过保留原路径的显式 re-export 保持现有导入和测试 mock 契约；WXT 将 `@/` 解析到插件宿主。web 的 Vite resolver 和 TypeScript paths 按 `apps/web` → 本包查找。宿主分别运行类型检查，从而验证每种平台适配组合；此包不独立编译一套具有隐含默认平台的产物。

`localResults` 在插件始终为 `false`；在无法选择文件夹的网页为 `true`，表示最终结果直接保存在 OPFS 的录制目录，允许编辑、归档和导出。平台差异默认关闭：`ProviderSection.browserMode` 未传入时沿用插件行为。

设置 schema、就绪订阅和 React 挂载仍由宿主各自装配（约 250 行相似逻辑），未再强行抽象；页面、结果编辑、历史管理、播放器、导出、处理视图及服务商表单没有复制。
