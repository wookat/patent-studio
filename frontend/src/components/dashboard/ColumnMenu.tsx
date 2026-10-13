import { Columns3 } from 'lucide-react'
import type { VisibilityState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DASH_DEFAULT_COLUMNS } from '@/store/dashboard'
import { TOGGLEABLE_COLUMNS } from './caseColumns'

/** 列显隐菜单（R-HOME-10）：Popover + Checkbox 列表，勾选即生效并持久化（store.setDashColumns → localStorage）；位于表格工具行右侧，与「紧凑」同为 ghost 芯片，有隐藏列时 soft 底色 */
export function ColumnMenu({ visibility, onChange }: { visibility: VisibilityState; onChange(next: VisibilityState): void }) {
  const hidden = TOGGLEABLE_COLUMNS.filter((c) => visibility[c.id] === false).length
  /** 与默认显隐不同才算「已调整」（默认就隐藏的申请号 / 申请日 / 协作者不计） */
  const changed = TOGGLEABLE_COLUMNS.some((c) => (visibility[c.id] ?? true) !== (DASH_DEFAULT_COLUMNS[c.id] ?? true))
  return (
    <Popover>
      <PopoverTrigger>
        <Button variant={changed ? 'soft' : 'ghost'} size="sm" aria-label={hidden ? `列显隐，已隐藏 ${hidden} 列` : '列显隐'} data-testid="column-menu">
          <Columns3 aria-hidden />
          列
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1" aria-label="显示的列" data-testid="column-menu-content">
        {TOGGLEABLE_COLUMNS.map((c) => {
          const on = visibility[c.id] !== false
          return (
            <label key={c.id} className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm hover:bg-hover">
              <Checkbox checked={on} onCheckedChange={(v) => onChange({ ...visibility, [c.id]: v })} data-testid={`column-toggle-${c.id}`} />
              <span className="flex-1">{c.label}</span>
            </label>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
