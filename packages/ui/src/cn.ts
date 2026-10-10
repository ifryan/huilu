import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// 主题里自定义的字号 / 圆角 / 投影 / 渐变名称要告诉 tailwind-merge，
// 否则 text-body 会被当成文字颜色，与 text-foreground 互相覆盖
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['title1', 'title2', 'headline', 'body', 'body2', 'caption'],
      radius: ['control'],
      shadow: ['card', 'menu', 'float'],
    },
    classGroups: {
      'bg-image': [{ 'bg-gradient': ['primary', 'primary-hover', 'primary-active', 'disabled'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
