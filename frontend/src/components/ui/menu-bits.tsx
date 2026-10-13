import type { ComponentProps, ReactNode } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown'
import { cn } from '@/lib/utils'

/**
 * Overleaf 式菜单原子（原型 .menu：min-width 240 · 项高 36 · 14px · hover n2 · 快捷键 12px 灰字右对齐）。
 * 基于 ui/dropdown 的 Radix DropdownMenu 加壳：MenuContent/MenuRow/MenuCheckRow/MenuSub*；R106-b1 由 shell/MenuBits 归入 ui/（dashboard/cards/templates 也消费）。
 */

export const MENU_W = 'min-w-[240px]'

/** 下拉容器：无内边距圆角项，改为原型的 4px 上下留白 + 通栏 hover；宽度不超出视口可用宽（375 移动端） */
export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      className={cn(
        MENU_W,
        'max-w-[var(--radix-dropdown-menu-content-available-width)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto py-1 px-0 rounded-sm shadow-md',
        className,
      )}
      {...props}
    />
  )
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuSeparator>) {
  return <DropdownMenuSeparator className={cn('mx-0 my-1', className)} {...props} />
}

/** 菜单分组小标题（原型 .menu .lb） */
export function MenuLabel({ children, className, ...props }: { children: ReactNode; className?: string } & ComponentProps<'div'>) {
  return (
    <div className={cn('px-4 pb-1 pt-1.5 text-xs leading-4 text-fg-muted select-none', className)} {...props}>
      {children}
    </div>
  )
}

interface RowProps extends ComponentProps<typeof DropdownMenuItem> {
  icon?: ReactNode
  /** 右侧副文案（快捷键 / 时间 / 备注） */
  sub?: ReactNode
  /** 右侧附加标记（如未保存 ●） */
  mark?: ReactNode
  /** 隐藏左侧图标槽（纯文字菜单，原型顶栏菜单风格） */
  noIcon?: boolean
}

const ROW = 'h-9 gap-2 rounded-none px-4 py-0 text-base focus:bg-active data-[highlighted]:bg-active data-[state=open]:bg-active'

/** 图标 · 文案 · 右侧副文案 的标准菜单行（36px） */
export function MenuRow({ icon, sub, mark, noIcon, className, children, ...props }: RowProps) {
  return (
    <DropdownMenuItem className={cn(ROW, className)} {...props}>
      {!noIcon && <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate" title={typeof children === 'string' ? children : undefined}>{children}</span>
      {sub != null && <span className="ml-3 shrink-0 text-xs text-fg-muted">{sub}</span>}
      {mark}
    </DropdownMenuItem>
  )
}

interface CheckProps extends Omit<RowProps, 'icon'> {
  checked: boolean
  /** menuitemradio（互斥）或 menuitemcheckbox（开关） */
  kind?: 'radio' | 'checkbox'
  icon?: ReactNode
}

/**
 * 带选中标记的菜单行：有图标槽时选中 ✓ 占左侧图标位；`noIcon`（原型顶栏菜单风格）时 ✓ 在右侧（原型 .menu .it .chk）。
 */
export function MenuCheckRow({ checked, kind = 'radio', icon, noIcon, mark, ...props }: CheckProps) {
  const chk = <Check className="size-4 shrink-0 text-fg" aria-hidden />
  return (
    <MenuRow
      role={kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
      aria-checked={checked}
      noIcon={noIcon}
      icon={!noIcon && checked ? chk : icon}
      mark={noIcon ? (checked ? chk : <span className="size-4 shrink-0" aria-hidden />) : mark}
      {...props}
    />
  )
}

export const MenuSub = DropdownMenuPrimitive.Sub

interface SubTriggerProps extends ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> {
  icon?: ReactNode
  noIcon?: boolean
}

/** 子菜单入口行：文案 + 右侧 ▸ */
export function MenuSubTrigger({ icon, noIcon, className, children, ...props }: SubTriggerProps) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        'relative flex cursor-default select-none items-center outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:shrink-0',
        ROW,
        className,
      )}
      {...props}
    >
      {!noIcon && <span className="flex size-4 shrink-0 items-center justify-center text-fg-muted [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate" title={typeof children === 'string' ? children : undefined}>{children}</span>
      <ChevronRight className="ml-3 size-4 text-fg-muted" aria-hidden />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

export function MenuSubContent({ className, sideOffset = 2, alignOffset = -5, collisionPadding = 8, ...props }: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-popover overflow-hidden rounded-sm border bg-popover py-1 text-popover-foreground shadow-md',
          'max-w-[var(--radix-dropdown-menu-content-available-width)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          MENU_W,
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}
