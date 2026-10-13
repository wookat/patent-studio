import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogTitle } from './dialog'

/** Command（cmdk）：命令面板 / 可搜索列表。CommandDialog 包 Dialog(size=md)；项高桌面 32、移动 44 */
function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

interface CommandDialogProps extends React.ComponentProps<typeof Dialog> {
  title?: string
  children: React.ReactNode
}

function CommandDialog({ title = '命令面板', children, ...props }: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent size="md" className="overflow-hidden p-0" hideClose>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-item]]:px-2">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="flex items-center border-b px-3" cmdk-input-wrapper="">
      <Search className="mr-2 size-4 shrink-0 opacity-50" aria-hidden />
      <CommandPrimitive.Input
        data-slot="command-input"
        /* 批77：搜索词非自然语言——拼写红线/移动端自动大写只添噪音 */
        spellCheck={false}
        autoCapitalize="none"
        className={cn('flex h-lg-control w-full bg-transparent py-2 text-sm outline-none placeholder:text-placeholder disabled:cursor-not-allowed disabled:opacity-50', className)}
        {...props}
      />
    </div>
  )
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list" className={cn('max-h-75 overflow-y-auto overflow-x-hidden p-1', className)} {...props} />
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className="py-6 text-center text-sm text-muted-foreground" {...props} />
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group data-slot="command-group" className={cn('overflow-hidden text-foreground [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground', className)} {...props} />
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator data-slot="command-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex h-md-control cursor-default select-none items-center gap-2 rounded-sm px-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 max-lg:h-touch',
        className,
      )}
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="command-shortcut" className={cn('ml-auto text-2xs tracking-widest text-muted-foreground', className)} {...props} />
}

export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator }
