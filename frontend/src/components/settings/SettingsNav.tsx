import type { ComponentType } from 'react'
import { FileText, Image, LayoutTemplate, Plug, SquareTerminal, Sun, SwatchBook, TriangleAlert, Type } from 'lucide-react'
import { FOCUS_RING, cn } from '@/lib/utils'
import { PAGES, type PageId } from './schema'

const ICONS: Record<PageId, ComponentType<{ className?: string }>> = {
  page: FileText,
  fonts: Type,
  headerfooter: LayoutTemplate,
  figures: Image,
  lint: TriangleAlert,
  build: SquareTerminal,
  appearance: Sun,
  templates: SwatchBook,
  integrations: Plug,
}

export interface SettingsNavProps {
  current: PageId
  onSelect: (id: PageId) => void
  /** 各页已改项数（>0 时显示小计数） */
  counts?: Partial<Record<PageId, number>>
  onImport: () => void
  onExport: () => void
  onResetAll: () => void
  /** 导入/恢复默认写 settings，viewer/reviewer（< editor）禁用 */
  importDisabled?: boolean
  resetDisabled?: boolean
  className?: string
}

/**
 * 设置面板左侧 172px 分组导航（07 §2.1 / prototype-c .mnav）：7 页，当前项 #eaf6ef 底 + 绿字 600；
 * 底部 导入 JSON / 导出 JSON / 全部恢复默认（红）。
 */
export function SettingsNav({ current, onSelect, counts, onImport, onExport, onResetAll, importDisabled, resetDisabled, className }: SettingsNavProps) {
  return (
    <nav data-slot="SettingsNav" aria-label="设置分组" className={cn('flex w-settings-nav shrink-0 flex-col gap-0.5 border-r border-border p-2', className)} data-testid="settings-nav">
      {PAGES.map((p) => {
        const Icon = ICONS[p.id]
        const active = p.id === current
        const n = counts?.[p.id] ?? 0
        return (
          <button
            key={p.id}
            type="button"
            aria-current={active || undefined}
            onClick={() => onSelect(p.id)}
            data-testid={`settings-nav-${p.id}`}
            className={cn(
              'flex h-md-control w-full items-center gap-2 rounded-sm px-2 text-left text-base outline-none transition-colors',
              active ? 'bg-primary-soft font-semibold text-link' : 'text-fg hover:bg-hover',
              FOCUS_RING,
            )}
          >
            <Icon className="size-4 shrink-0 opacity-80" />
            <span className="truncate" title={p.title}>{p.title}</span>
            {n > 0 && (
              <span className={cn('ml-auto rounded-full px-1.5 text-2xs font-medium tabular-nums', active ? 'bg-app/70 text-link' : 'bg-primary-soft text-link')} aria-label={`${n} 项已改`}>{n}</span>
            )}
          </button>
        )
      })}
      <span className="flex-1" />
      <div className="flex flex-col gap-0.5 border-t border-border pt-2">
        <FootButton onClick={onImport} disabled={importDisabled} testId="settings-import">导入 JSON</FootButton>
        <FootButton onClick={onExport} testId="settings-export">导出 JSON</FootButton>
        <FootButton onClick={onResetAll} disabled={resetDisabled} testId="settings-reset-all" className="text-danger-fg hover:text-danger-fg">全部恢复默认</FootButton>
      </div>
    </nav>
  )
}

function FootButton({ children, onClick, disabled, testId, className }: { children: string; onClick: () => void; disabled?: boolean; testId: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'flex h-sm-control w-full items-center rounded-sm px-2 text-left text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-50',
        FOCUS_RING,
        className,
      )}
    >
      {children}
    </button>
  )
}
