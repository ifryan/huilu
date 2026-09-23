# ADR 0003：通过 manifest key 固定插件 ID

- 状态：已接受（2026-09-24）

## 背景

会录以「加载已解压的扩展程序」方式分发。未指定 `key` 时，Chrome 根据目录路径生成插件 ID；用户换目录或更新方式不同就会得到新 ID，导致 `chrome.storage`、IndexedDB、OPFS 和文件夹授权全部丢失。

## 决定

在 `wxt.config.ts` 中写入固定公钥 `key`，插件 ID 固定为 `fddknloecifbbeomieckhnegffdobgni`。对应私钥不需要（仅在上架商店、自行打包 .crx 时才用得到），不入库。

## 影响

- 以后若上架 Chrome 应用商店，商店分配的 ID 会不同，需要提供数据迁移（数据文件夹本身不受影响，重新选择即可）
