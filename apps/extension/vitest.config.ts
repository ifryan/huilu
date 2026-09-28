import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

// WxtVitest：解析 #imports / @/ 别名，并把 browser 换成内存里的 fakeBrowser（后台脚本测试用）
export default defineConfig({
  plugins: [WxtVitest()],
})
