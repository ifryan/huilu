/**
 * 输入框 / 下拉框（Board UI Input）：灰色填充、无描边，hover 与聚焦用 2px 内描边，
 * 不是蓝色焦点环；aria-invalid 时浅红底红字。下拉框需同时带 hl-field（自绘箭头）。
 */
export const fieldClass =
  'hl-field bg-field text-foreground text-body placeholder:text-subtle-foreground rounded-control h-9 w-full min-w-0 px-3 outline-none transition-shadow duration-150 hover:shadow-[inset_0_0_0_2px_var(--color-border-hover)] focus-visible:shadow-[inset_0_0_0_2px_var(--color-border-active)] aria-invalid:bg-error-soft aria-invalid:text-error disabled:cursor-not-allowed disabled:opacity-60 read-only:hover:shadow-none'
