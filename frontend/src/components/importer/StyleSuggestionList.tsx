import { useMemo } from 'react'
import { ALL_ROWS } from '@/components/settings/schema'
import type { StyleSuggestion } from '@/lib/types'
import { cn } from '@/lib/utils'
import { flattenStyle } from './styleLeaves'

const LABEL: Record<string, string> = Object.fromEntries(ALL_ROWS.flatMap((r) => r.items.map((it) => [it.id, it.label])))
const UNIT: Record<string, string> = Object.fromEntries(
  ALL_ROWS.flatMap((r) => r.items.flatMap((it) => (it.kind === 'number' ? [[it.id, it.unit]] : []))),
)

function fmtValue(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? '开' : '关'
  if (typeof v === 'number') return `${v}${UNIT[key] ? ` ${UNIT[key]}` : ''}`
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

export interface StyleSuggestionListProps {
  suggestion: StyleSuggestion
  selected: Set<string>
  onChange: (next: Set<string>) => void
  className?: string
}

/**
 * 样式建议逐项勾选（docs/plan/10 §7.1 步骤 2）：每行 = 设置项标签 · 建议值 · 依据（evidence，来自 DOCX 哪个样式）。
 * 默认全选由父组件初始化；全选/全不选由列表头控制。
 */
export function StyleSuggestionList({ suggestion, selected, onChange, className }: StyleSuggestionListProps) {
  const leaves = useMemo(() => flattenStyle(suggestion.style), [suggestion])
  if (leaves.length === 0) return null
  const all = leaves.every((l) => selected.has(l.key))
  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }
  return (
    <fieldset data-slot="StyleSuggestionList" data-testid="import-style-suggestions" className={cn('min-w-0 rounded-sm border', className)}>
      <legend className="sr-only">从 Word 提取的样式建议</legend>
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
        <label className="flex cursor-pointer items-center gap-2 font-medium">
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={all}
            onChange={() => onChange(all ? new Set() : new Set(leaves.map((l) => l.key)))}
            aria-label="全选样式建议"
          />
          样式建议
        </label>
        <span className="ml-auto text-fg-muted">
          已选 {selected.size}/{leaves.length}
        </span>
      </div>
      <ul className="max-h-48 divide-y overflow-y-auto text-xs">
        {leaves.map((l) => {
          const evidence = suggestion.evidence[l.key] ?? suggestion.evidence[l.path[0]]
          return (
            <li key={l.key}>
              <label className="flex cursor-pointer items-start gap-2 px-3 py-1.5 hover:bg-hover/60">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5 shrink-0 accent-primary"
                  checked={selected.has(l.key)}
                  onChange={() => toggle(l.key)}
                  data-testid={`style-suggest-${l.key}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{LABEL[l.key] ?? l.key}</span>
                    <span className="tabular-nums">{fmtValue(l.key, l.value)}</span>
                  </span>
                  {evidence && <span className="block truncate text-fg-muted" title={evidence}>{evidence}</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
