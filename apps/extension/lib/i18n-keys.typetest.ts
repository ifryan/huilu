// 类型回归测试（仅参与 typecheck，不会被打包）：确保使用方也能检查翻译 key
import type { useTranslation } from '@huilu/i18n'

declare const t: ReturnType<typeof useTranslation>['t']

t('nav.history')
// @ts-expect-error 写错的 key 必须在编译时报错
t('nav.historyTYPO')
