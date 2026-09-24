import { useTranslation } from '@huilu/i18n'
import { useCallback } from 'react'

/**
 * 翻译运行时才确定的 key（服务商、字段、预设等由 packages/providers 提供）。
 * 这些 key 的存在性由 packages/providers 的单元测试保证。
 */
export function useDynamicT() {
  const { t } = useTranslation()
  return useCallback(
    (key: string, options?: Record<string, unknown>) =>
      (t as unknown as (k: string, o?: Record<string, unknown>) => string)(key, options),
    [t],
  )
}
