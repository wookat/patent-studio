import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { FOCUS_RING, cn } from '@/lib/utils'

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        FOCUS_RING,
        'peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        // 触控密度：视觉 36×20 不变；after 以 padding box（32×16，border 2）为基准外扩 14 → 60×44 热区（05 §2 ⑥）
        "in-data-[density=touch]:after:absolute in-data-[density=touch]:after:-inset-3.5 in-data-[density=touch]:after:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
