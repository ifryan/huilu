import { cn } from '@huilu/ui'
import { describe, expect, it } from 'vitest'

// U-51：主题自定义的字号 / 圆角 / 渐变不能被 tailwind-merge 误判成其他分组而丢掉
describe('cn with HuiLu theme utilities', () => {
  it('keeps custom font sizes next to text colors', () => {
    expect(cn('text-body text-foreground', 'text-caption')).toBe('text-foreground text-caption')
  })
  it('merges custom radius and gradient utilities', () => {
    expect(cn('rounded-control w-full', 'w-auto rounded-lg')).toBe('w-auto rounded-lg')
    expect(cn('bg-gradient-primary text-primary-foreground', 'bg-gradient-disabled')).toBe(
      'text-primary-foreground bg-gradient-disabled',
    )
  })
})
