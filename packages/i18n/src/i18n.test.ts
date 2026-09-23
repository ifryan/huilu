import { describe, expect, it } from 'vitest'
import { detectLocale, initI18n, resources } from './index'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('locales', () => {
  it('zh-CN and en have exactly the same keys', () => {
    expect(keys(resources.en.translation).sort()).toEqual(
      keys(resources['zh-CN'].translation).sort(),
    )
  })

  it('detects locale from browser languages', () => {
    expect(detectLocale(['zh-TW'])).toBe('zh-CN')
    expect(detectLocale(['en-US', 'zh-CN'])).toBe('en')
    expect(detectLocale(['fr'])).toBe('zh-CN')
  })

  it('translates', async () => {
    const i18n = await initI18n('en')
    expect(i18n.t('app.name')).toBe('HuiLu')
    await i18n.changeLanguage('zh-CN')
    expect(i18n.t('app.name')).toBe('会录')
  })
})
