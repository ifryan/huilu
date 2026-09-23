# 贡献指南

## 环境

- Node.js ≥ 22（见 `.nvmrc`）
- pnpm 10（`corepack enable` 后自动使用 `package.json` 中声明的版本）

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 启动开发模式：自动打开一个加载了插件的 Chrome，改代码即时生效
pnpm build          # 构建到 apps/extension/.output/chrome-mv3
pnpm zip            # 打包发布用的 zip
pnpm check          # 格式 + ESLint + 类型检查 + 单元测试（提交前请运行）
pnpm format         # 自动格式化
```

## 目录与分层

见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。关键规则：

- `packages/*` 不得直接使用 `chrome.*` / `browser.*`，也不得依赖 WXT（ESLint 会报错）
- 新增服务商、处理步骤、导出格式等：在 `@huilu/core` 的扩展点接口下实现，并登记到 `registries`
- 新增界面文案：同时修改 `packages/i18n/src/locales/zh-CN.json` 和 `en.json`（测试会检查两边 key 一致）
- 重要技术决定写入 `docs/adr/`

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat:`、`fix:`、`docs:`、`chore:` 等。
