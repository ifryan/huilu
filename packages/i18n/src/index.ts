import i18next, { type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'zh-CN'

export const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
} as const

/** 根据浏览器语言选择界面语言：中文系 → zh-CN，其余 → en */
export function detectLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    if (lang.toLowerCase().startsWith('zh')) return 'zh-CN'
    if (lang.toLowerCase().startsWith('en')) return 'en'
  }
  return DEFAULT_LOCALE
}

// 翻译 key 有类型检查：写错 key 会在编译时报错。
// 必须放在导出入口里，引用 @huilu/i18n 的使用方（如 apps/extension）才会加载这段类型增强。
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof zhCN }
  }
}

export async function initI18n(locale: Locale): Promise<I18n> {
  const instance = i18next.createInstance()
  await instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
  })
  return instance
}

export { I18nextProvider, useTranslation } from 'react-i18next'
