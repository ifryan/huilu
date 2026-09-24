// 把 mediabunny 的 ESM 包复制进插件目录：插件以「加载已解压的扩展程序」方式运行，不经过打包
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync(new URL('../extension/vendor/', import.meta.url), { recursive: true })
copyFileSync(
  new URL('../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', import.meta.url),
  new URL('../extension/vendor/mediabunny.min.mjs', import.meta.url),
)
console.log('vendored mediabunny → extension/vendor/')
