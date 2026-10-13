import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'

/**
 * Tabs（05 §2.3）：下划线式（2px --primary 指示条）替代胶囊；List 32 高、下 1px --border；Trigger 14/500，未选 --fg-muted。
 * 面板头（伴随栏 / 控制台 / 侦听）统一用它，不用 Segmented；`variant="pill"` 仅保留给旧调用一轮。
 */
const Tabs = TabsPrimitive.Root

interface TabsListProps extends React.ComponentProps<typeof TabsPrimitive.List> {
  variant?: 'underline' | 'pill'
  size?: 'md' | 'xl'
}

function TabsList({ className, variant = 'underline', size = 'md', ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-size={size}
      className={cn(
        'inline-flex items-stretch text-fg-muted',
        variant === 'underline' ? 'h-panel-header w-full justify-start gap-1 border-b border-border px-1' : 'h-md-control justify-center rounded-md bg-sunken p-0.5 in-data-[density=touch]:box-content',
        size === 'xl' && 'h-touch',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-2.5 text-base font-medium disabled:pointer-events-none disabled:text-fg-disabled [&_svg]:size-4 [&_svg]:shrink-0',
        touchHit,
        'hover:text-fg data-[state=active]:text-fg-strong',
        // 下划线：2px 指示条贴 List 底边（-mb-px 盖住 1px 边）
        'group-data-[variant=underline]/tabs:after:absolute',
        '[[data-variant=underline]_&]:-mb-px [[data-variant=underline]_&]:border-b-2 [[data-variant=underline]_&]:border-transparent [[data-variant=underline]_&]:data-[state=active]:border-primary',
        '[[data-variant=pill]_&]:rounded-sm [[data-variant=pill]_&]:data-[state=active]:bg-panel [[data-variant=pill]_&]:data-[state=active]:shadow-sm',
        FOCUS_RING,
        TRANSITION_COLOR,
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('outline-none data-[state=inactive]:hidden', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
