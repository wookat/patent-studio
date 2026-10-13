import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDown, Loader2 } from 'lucide-react'
import { DISABLED, FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown'

/**
 * Button（05 §2.1）：5 档高 xs 24 / sm 28 / md 32（默认）/ lg 36 / xl 44（40 档已删）；圆角随尺寸 3 / 4 / 6 / 6 / 8。
 * 变体 primary（= default）/ secondary（描边白底，= outline）/ soft（品牌浅底）/ ghost / danger / link。
 * 字重 500；图标随高 14 / 16 / 18；禁用走 --fg-disabled + --bg-sunken（不用 opacity）；焦点环 2px --ring 外描边。
 * 一屏只允许一个 primary（页面 PageHeader.primary / 工作台顶栏「构建」）。`loading` 保宽 + `loadingLabel`。
 * 触控（06 §2）：视觉 xs 28 / sm 32 / md 36 / lg 44 / xl 44，命中区由 touchHit 伪元素扩到 ≥ 44。
 */
const buttonVariants = cva(
  cn(
    'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium select-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
    touchHit,
    FOCUS_RING,
    TRANSITION_COLOR,
    DISABLED,
  ),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:bg-sunken aria-disabled:bg-sunken',
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:bg-sunken aria-disabled:bg-sunken',
        secondary: 'border border-border-strong bg-panel text-fg shadow-sm hover:bg-hover active:bg-active disabled:border-border disabled:bg-sunken disabled:shadow-none',
        outline: 'border border-border-strong bg-panel text-fg shadow-sm hover:bg-hover active:bg-active disabled:border-border disabled:bg-sunken disabled:shadow-none',
        soft: 'bg-primary-soft text-link hover:bg-selected active:bg-selected disabled:bg-sunken',
        ghost: 'text-fg hover:bg-hover hover:text-fg-strong active:bg-active',
        danger: 'bg-danger-solid text-danger-solid-fg hover:bg-danger-solid-hover active:bg-danger-solid disabled:bg-sunken',
        link: 'h-auto rounded-none px-0 text-link underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-xs-control rounded-xs px-2 text-2xs [&_svg]:size-3.5',
        sm: 'h-sm-control rounded-sm px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-md-control rounded-md px-3 text-base [&_svg]:size-4',
        default: 'h-md-control rounded-md px-3 text-base [&_svg]:size-4',
        lg: 'h-lg-control rounded-md px-4 text-base [&_svg]:size-4',
        xl: 'h-touch rounded-lg px-5 text-lg [&_svg]:size-4.5',
        'icon-xs': 'size-xs-control rounded-xs [&_svg]:size-3.5',
        'icon-sm': 'size-sm-control rounded-sm [&_svg]:size-3.5',
        icon: 'size-md-control rounded-md [&_svg]:size-4',
        'icon-md': 'size-md-control rounded-md [&_svg]:size-4',
        'icon-lg': 'size-lg-control rounded-md [&_svg]:size-4',
        'icon-xl': 'size-touch rounded-lg [&_svg]:size-4.5',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

/** React 19：ref 是普通 prop（ComponentProps<'button'> 已含），直接透传到 <button> / Slot */
export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** 加载中：禁用 + 内容替换为 spinner（保宽），屏幕阅读器读 loadingLabel */
  loading?: boolean
  loadingLabel?: string
}

function Button({ className, variant, size, asChild = false, loading = false, loadingLabel = '处理中', disabled, children, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? 'primary'}
      data-size={size ?? 'md'}
      data-loading={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <span className="invisible inline-flex items-center gap-1.5" aria-hidden>{children}</span>
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <Loader2 className="animate-spin" />
          </span>
          <span className="sr-only">{loadingLabel}</span>
        </>
      ) : (
        children
      )}
    </Comp>
  )
}

/**
 * SplitButton（05 §2.1）：主动作 + 右侧 ▾ 菜单，共用一个视觉体（同色、同高、1px 分隔线）。
 * 一屏一个 primary SplitButton（如 PageHeader 主动作）；工作台顶栏不放「构建」（PDF 卡工具条 BuildButton 承担），其余处用 variant="secondary"。
 * `menu` = DropdownMenuItem 列表（由调用方提供；菜单容器 / 定位由本组件负责）。
 */
export interface SplitButtonProps extends Omit<ButtonProps, 'asChild' | 'children' | 'size'> {
  children: React.ReactNode
  /** 下拉菜单内容（DropdownMenuItem…） */
  menu: React.ReactNode
  menuLabel?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  menuAlign?: 'start' | 'end'
  'data-testid'?: string
}

const SPLIT_TRIGGER_SIZE = { sm: 'icon-sm', md: 'icon', lg: 'icon-lg', xl: 'icon-xl' } as const

function SplitButton({ children, menu, menuLabel = '更多操作', size = 'md', variant = 'primary', menuAlign = 'end', className, loading, disabled, 'data-testid': testId, ...props }: SplitButtonProps) {
  return (
    <div data-slot="split-button" data-variant={variant} className={cn('inline-flex items-stretch', className)} data-testid={testId}>
      <Button
        variant={variant}
        size={size}
        loading={loading}
        disabled={disabled}
        className="rounded-r-none"
        data-slot="split-button-main"
        {...props}
      >
        {children}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={SPLIT_TRIGGER_SIZE[size]}
            disabled={disabled || loading}
            aria-label={menuLabel} title={menuLabel}
            data-slot="split-button-trigger"
            className={cn('rounded-l-none border-l', variant === 'primary' || variant === 'default' ? 'border-l-primary-active' : variant === 'danger' ? 'border-l-danger-dot' : 'border-l-border')}
          >
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={menuAlign} data-slot="split-button-menu">{menu}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export { Button, SplitButton, buttonVariants }
