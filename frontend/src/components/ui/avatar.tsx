import * as React from 'react'
import { PEER_COLORS, labelText } from '@/collab/colors'
import { cn } from '@/lib/utils'

/** Avatar 24 / 32 / 40；AvatarGroup ≤max（默认 5）+ 溢出计数。fallback 取 name 首字；底色为用户色盘时首字自动取可读前景 */
const SIZE = { sm: 'size-6 text-2xs', md: 'size-8 text-xs', lg: 'size-10 text-sm' } as const

export interface AvatarProps extends React.ComponentProps<'span'> {
  size?: keyof typeof SIZE
  src?: string | null
  /** 名字：用于 alt / fallback 首字 */
  name: string
  /** 背景色（语义 token / CSS 变量），默认 --accent */
  color?: string
}

function Avatar({ className, size = 'md', src, name, color, style, ...props }: AvatarProps) {
  const [failed, setFailed] = React.useState(false)
  const showImg = src && !failed
  const fg = color && (PEER_COLORS as readonly string[]).includes(color) ? labelText(color) : undefined
  return (
    <span
      data-slot="avatar"
      data-size={size}
      role="img"
      aria-label={name}
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-semibold text-accent-foreground select-none', SIZE[size], className)}
      style={color ? { backgroundColor: color, ...(fg ? { color: fg } : null), ...style } : style}
      {...props}
    >
      {showImg ? (
        <img data-slot="avatar-image" src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span data-slot="avatar-fallback" aria-hidden>{(name || '?').slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  )
}

export interface AvatarGroupProps extends React.ComponentProps<'div'> {
  size?: keyof typeof SIZE
  max?: number
  items: Array<Pick<AvatarProps, 'src' | 'name' | 'color'>>
}

function AvatarGroup({ className, size = 'sm', max = 5, items, ...props }: AvatarGroupProps) {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length
  return (
    <div data-slot="avatar-group" className={cn('flex items-center -space-x-1.5', className)} {...props}>
      {shown.map((it, i) => (
        <Avatar key={`${it.name}-${i}`} size={size} className="ring-2 ring-background" {...it} />
      ))}
      {rest > 0 && (
        <span data-slot="avatar-overflow" className={cn('inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-background', SIZE[size])} aria-label={`还有 ${rest} 人`}>
          +{rest}
        </span>
      )}
    </div>
  )
}

export { Avatar, AvatarGroup }
