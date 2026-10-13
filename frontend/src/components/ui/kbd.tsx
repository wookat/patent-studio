import * as React from 'react'
import { cn } from '@/lib/utils'

/** Kbd（05 §2.10）：快捷键键帽 —— 18 高 / 11px 500 / r3 / 1px --border-strong / --bg-sunken；传 keys 自动按平台渲染 Mod→⌘/Ctrl */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const LABEL: Record<string, string> = { Mod: IS_MAC ? '⌘' : 'Ctrl', Alt: IS_MAC ? '⌥' : 'Alt', Shift: IS_MAC ? '⇧' : 'Shift', Enter: '⏎', Escape: 'Esc' }

export interface KbdProps extends React.ComponentProps<'kbd'> {
  /** 如 ['Mod','Shift','L']；省略则渲染 children */
  keys?: string[]
}

function Kbd({ className, keys, children, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn('inline-flex h-4.5 min-w-4.5 items-center justify-center gap-0.5 rounded-xs border border-border-strong bg-sunken px-1 font-sans text-2xs font-medium leading-none text-fg-muted', className)}
      {...props}
    >
      {keys ? keys.map((k) => LABEL[k] ?? k).join(IS_MAC ? '' : '+') : children}
    </kbd>
  )
}

export { Kbd }
