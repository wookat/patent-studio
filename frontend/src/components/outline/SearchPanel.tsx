import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Replace, Search, X } from 'lucide-react'
import { useStudio } from '@/store'
import { hotkeyLabel } from '@/lib/hotkeys'
import { FOCUS_RING, cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { editorCommands } from '@/components/editor/commands'
import { SEARCH_MAX_HITS as MAX_HITS, searchContent } from '@/lib/search'

/**
 * 侧栏下块「全文搜索」（Rail 🔍 → railTab='search'）：输入即搜 content.md，命中行列表（行号 + 前后文），
 * Enter / 点击 → doc.gotoLine 定位；「在编辑器中查找替换」交给 CodeMirror 自带面板（Mod-f / Mod-h）。
 */
export function SearchPanel() {
  const content = useStudio((s) => s.content)
  const gotoLine = useStudio((s) => s.gotoLine)
  const cursorLine = useStudio((s) => s.cursor.line)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const hits = useMemo(() => searchContent(content, query), [content, query])
  const changeQuery = (q: string) => {
    setQuery(q)
    setActive(0)
  }
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (i: number) => {
    const h = hits[i]
    if (h) gotoLine(h.line)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hits.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(hits.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(active)
    }
  }

  // R48-02/03：当前没有已注册的编辑器视图（版面卡 / 空态）时先 gotoLine 激活/打开光标点所在书卡（聚焦即注册），
  // 然后重试开查找框；rail 里的查询词一并带进 CM find。
  const openInEditor = () => {
    const q = query.trim() || undefined
    const tryOpen = () => editorCommands.openSearch(q)
    if (tryOpen()) return
    gotoLine(useStudio.getState().cursor.line || 1)
    let tries = 0
    const tick = () => {
      if (tryOpen() || ++tries > 20) return
      setTimeout(tick, 50)
    }
    setTimeout(tick, 50)
  }

  const trimmed = query.trim()
  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="SearchPanel" data-testid="search-panel">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="搜索全文…"
            aria-label="全文搜索"
            className="h-7 pl-7 pr-6 text-xs"
            data-testid="search-input"
          />
          {query && (
            <button
              type="button"
              aria-label="清空搜索"
              className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg-strong"
              onClick={() => {
                changeQuery('')
                inputRef.current?.focus()
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          title={`在编辑器中查找替换（${hotkeyLabel('replace')}）`}
          aria-label="在编辑器中查找替换"
          className={cn('flex h-7 w-7.5 shrink-0 items-center justify-center rounded text-fg-muted transition-colors hover:bg-hover hover:text-fg-strong [&_svg]:size-4', FOCUS_RING)}
          onClick={openInEditor}
          data-testid="search-open-editor"
        >
          <Replace />
        </button>
      </div>
      <div className="shrink-0 px-2.5 pb-1 text-2xs leading-none text-fg-muted tabular-nums" aria-live="polite" data-testid="search-count">
        {trimmed ? (hits.length ? `${hits.length >= MAX_HITS ? `${MAX_HITS}+` : hits.length} 处匹配` : '无匹配') : '输入关键词，Enter 定位到匹配行'}
      </div>
      <div ref={listRef} role="listbox" aria-label="搜索结果" className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" data-testid="search-results">
        {hits.map((h, i) => (
          <div
            key={`${h.line}:${h.col}`}
            role="option"
            aria-selected={i === active}
            data-index={i}
            tabIndex={-1}
            onClick={() => {
              setActive(i)
              go(i)
            }}
            className={cn(
              'flex cursor-pointer items-baseline gap-1.5 rounded px-1.5 py-1 text-xs leading-4',
              i === active ? 'bg-selected' : 'hover:bg-hover',
              h.line === cursorLine && 'font-semibold',
            )}
            data-testid="search-hit"
          >
            <span className="shrink-0 font-mono text-2xs text-fg-muted tabular-nums">{h.line}</span>
            <span className="min-w-0 flex-1 truncate" title={h.before + h.match + h.after}>
              {h.before}
              <mark className="rounded-sm bg-warn-bg px-px text-fg">{h.match}</mark>
              {h.after}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
