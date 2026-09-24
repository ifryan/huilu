import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// 固定公钥：保证以「加载已解压的扩展程序」方式安装时，无论目录在哪，插件 ID 都不变
// （ID: fddknloecifbbeomieckhnegffdobgni）。对应私钥不需要，也不入库。
const MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsj8VzX2yuTxEz63lrD6A/bG5pRmFGODW11LyqiJXnVaEF/P6CTOzIKHojQ9TmoGQ0T0hgssgGW7HA4ritp9XWjSPX+zbhT7+JpeW/nCMZnxCJe+wVgnG3l6utNWAp6rmCPU73f/G8l1dp3lg8m9yg+61DMu8nJxlSOp9QSLcMHZ+p6fm5cvN94CjP8UrMW4KV4G5KaNTr1N8aa6uncGl7P0HqgYxPOmee8G29bQdI05XYDGMYTH5IuqJ/miZYqEdx1LOwCpCSRLXZwB1ghW20MRku1G9kR/Ds0PJFs6z3OELUa3MHkvTD02cFU0/FS/BaDLIqRCJgLhlXARkPqy/swIDAQAB'

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'zh_CN',
    key: MANIFEST_KEY,
    minimum_chrome_version: '122',
    permissions: [
      'storage',
      'unlimitedStorage',
      'offscreen',
      'tabCapture',
      'desktopCapture',
      'sidePanel',
    ],
    commands: {
      'toggle-recording': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: '__MSG_cmdToggleRecording__',
      },
    },
  },
})
