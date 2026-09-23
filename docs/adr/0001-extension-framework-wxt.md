# ADR 0001：插件框架选用 WXT

- 状态：已接受（2026-09-24）

## 背景

会录是纯 Chrome 插件，需要弹窗、侧边栏、插件内网页、后台、离屏文档等多个入口，并希望保留支持 Edge / Firefox 的可能。

## 候选

- **WXT**：基于 Vite，按目录约定生成入口和 manifest，开发时热更新，原生支持多浏览器，维护活跃
- **Plasmo**：基于 Parcel，仓库仍标注 alpha，核心版本自 2025-05 后未更新
- **CRXJS**：只是一个 Vite 插件，入口组织、多浏览器构建都要自己处理

## 决定

选用 WXT。

## 影响

- 入口放在 `apps/extension/entrypoints/`，manifest 在 `wxt.config.ts` 中声明
- 共享包（`packages/*`）不依赖 WXT，由 ESLint 规则保证，便于将来复用到服务端或桌面端
