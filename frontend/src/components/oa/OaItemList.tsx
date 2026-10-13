import { useRef, type KeyboardEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FOCUS_RING, cn } from '@/lib/utils'
import type { OaAnswer, OaItem } from '@/types/oa'
import { OA_KIND_LABEL } from '@/types/oa'
import { oaItemSummary } from './oaUtils'

/**
 * W5 R-OA-01 拆条增强字段（oa-import-backend 落地后由 POST …/oa/parse 返回；旧后端无这两个字段 ⇒ 不显示徽章）。
 * integration_requests：types/oa.ts OaItem 增 `refs?: string[]`（对比文件 D1/D2…）与 `confidence?: 'high' | 'low'`。
 */
export type OaItemW5 = OaItem & { refs?: string[]; confidence?: 'high' | 'low' }

interface Props {
  items: OaItemW5[]
  answers: Record<string, OaAnswer>
  activeId: string | null
  onSelect(id: string): void
  className?: string
}

/**
 * 拆条列表：role=listbox，↑↓/Home/End 移动，Enter/空格与点击选中；每项显示编号 · 类型 · 涉及权项 · 对比文件 · 置信度 · 摘要 · 答复状态。
 * option 内不嵌按钮（axe nested-interactive）：「生成争辩稿（AI）」在选中条的详情栏（OaPanel）。低置信条目虚线边框（§1.1 A7）。
 */
export function OaItemList({ items, answers, activeId, onSelect, className }: Props) {
  const refs = useRef<Record<string, HTMLLIElement | null>>({})

  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const idx = Math.max(0, items.findIndex((it) => it.id === activeId))
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))
    const id = items[next]?.id
    if (!id) return
    onSelect(id)
    refs.current[id]?.focus()
  }

  return (
    <ol
      role="listbox"
      aria-label="审查意见条目"
      aria-activedescendant={activeId ? `oa-item-${activeId}` : undefined}
      tabIndex={0}
      onKeyDown={onKey}
      className={cn('min-h-0 flex-1 space-y-1 overflow-auto', FOCUS_RING, className)}
      data-testid="oa-items"
    >
      {items.map((it) => {
        const active = it.id === activeId
        const ans = answers[it.id]
        const low = it.confidence === 'low'
        return (
          <li
            key={it.id}
            id={`oa-item-${it.id}`}
            role="option"
            aria-selected={active}
            tabIndex={-1}
            ref={(el) => {
              refs.current[it.id] = el
            }}
            onClick={() => onSelect(it.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(it.id)
              }
            }}
            className={cn(
              'cursor-pointer rounded border px-2 py-1.5 text-xs transition-colors hover:bg-hover',
              low && 'border-dashed',
              active && 'border-brand-300 bg-selected',
            )}
            data-testid={`oa-item-${it.id}`}
            data-active={active || undefined}
            data-confidence={it.confidence}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{it.id}</span>
              <Badge tone="outline" className="px-1.5 py-0 text-2xs">{OA_KIND_LABEL[it.kind]}</Badge>
              {it.claims.length > 0 && <span className="text-fg-muted">权利要求 {it.claims.join('、')}</span>}
              {it.refs && it.refs.length > 0 && (
                <span className="text-fg-muted" data-testid={`oa-item-${it.id}-refs`}>对比文件 {it.refs.join('、')}</span>
              )}
              {it.confidence && (
                <Badge tone={low ? 'warn' : 'ok'} className="px-1.5 py-0 text-2xs" data-testid={`oa-item-${it.id}-confidence`}>
                  {low ? '低置信' : '高置信'}
                </Badge>
              )}
              {ans && (
                <span className={cn('ml-auto inline-flex items-center gap-0.5', ans.applied ? 'text-ok-fg' : 'text-info-fg')} data-testid={`oa-item-${it.id}-status`}>
                  <CheckCircle2 className="size-3" aria-hidden />
                  {ans.applied ? '已写入' : '已答复'}
                </span>
              )}
            </div>
            <p className="mt-1 text-fg-muted">{oaItemSummary(it)}</p>
          </li>
        )
      })}
    </ol>
  )
}
