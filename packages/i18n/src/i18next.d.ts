import 'i18next'
import type zhCN from './locales/zh-CN.json'

// 翻译 key 有类型检查：写错 key 会在编译时报错
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof zhCN }
  }
}
