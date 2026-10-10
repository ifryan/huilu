import { cva } from 'class-variance-authority'

/**
 * 按钮尺度与状态参考 Board UI：medium 高 36 / 圆角 10，small 高 32 / 圆角 8；
 * 主按钮蓝色竖向渐变，次按钮白底细描边；按下轻微缩放；键盘焦点为 2px 蓝色外环。
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-primary hover:bg-gradient-primary-hover active:bg-gradient-primary-active text-primary-foreground shadow-xs disabled:bg-gradient-disabled disabled:text-subtle-foreground disabled:shadow-none',
        outline:
          'border-border bg-surface text-foreground hover:border-border-hover hover:bg-muted active:border-border-active border shadow-xs disabled:text-subtle-foreground disabled:shadow-none',
        ghost: 'text-foreground hover:bg-muted active:bg-field disabled:text-subtle-foreground',
        danger:
          'bg-red-600 text-white shadow-xs hover:bg-red-500 active:bg-red-700 disabled:opacity-50',
      },
      size: {
        default: 'text-body rounded-control h-9 px-3 [&_svg]:size-5',
        sm: 'text-body h-8 rounded-lg px-2.5 [&_svg]:size-[18px]',
        lg: 'text-body rounded-control h-10 px-4 [&_svg]:size-5',
        icon: 'rounded-control size-9 [&_svg]:size-5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)
