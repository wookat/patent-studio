import { useShallow } from 'zustand/react/shallow'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio, selectAbstractLive, selectBookDirty, selectDirty, selectSummary } from '@/store'
import { BOOK_FILES } from '@/lib/docset'
import { useOutlineModel } from '@/components/outline/useOutline'

/**
 * 编辑器区顶部文件 tab 条（07 §2.1 / prototype-c `.tabs`，32px）：
 * 左：唯一 tab：全文 = `content.md`，移动端选中单书（layout.activeBook）= `docs/<book>.md`（未保存时前置 6px 黄点 ●，单书只看该书脏）；右：12px 灰统计「摘要 298/300 · 权项 11 · 段号 [0088]」。
 * 统计全部来自现有 selector / 大纲解析：摘要 = selectAbstractLive（live，超限变红），权项 = 大纲权项数（无则回落 build summary），
 * 段号 = 说明书末段号（大纲 paragraphs，无则回落 build summary.paragraphs）。
 */
export function EditorTabs() {
  const activeBook = useStudio((s) => s.activeBook)
  const dirty = useStudio(activeBook === 'all' ? selectDirty : selectBookDirty(activeBook))
  const file = activeBook === 'all' ? 'content.md' : BOOK_FILES[activeBook]
  const abstract = useStudio(useShallow(selectAbstractLive))
  const summary = useStudio(selectSummary)
  const outline = useOutlineModel()
  const claims = outline.claims?.items.length ?? summary?.claims ?? null
  const paragraphs = outline.description?.paragraphs ?? summary?.paragraphs ?? null

  return (
    <div
      data-slot="EditorTabs"
      data-testid="editor-tabs"
      role="tablist"
      aria-label="打开的文件"
      className="flex h-panel-header shrink-0 items-stretch border-b border-border bg-app pl-2 pr-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected="true"
        data-testid="editor-tab-content"
        data-dirty={dirty || undefined}
        className={cn('-mb-px inline-flex items-center gap-1.5 border-b-2 border-fg-strong px-2 text-sm font-medium text-fg-strong', FOCUS_RING)}
      >
        {dirty && <span aria-label="未保存" className="size-1.5 rounded-full bg-warn-dot" data-testid="editor-tab-dirty" />}
        {file}
      </button>
      <div data-testid="editor-stats" className="ml-auto flex items-center gap-1.5 self-center whitespace-nowrap px-2 text-xs text-fg-muted tabular">
        <span
          className={cn(abstract.near && 'text-warn-fg')}
          title={abstract.near ? `摘要接近 ${abstract.limit} 字上限，还可写 ${abstract.limit - abstract.chars} 字` : undefined}
          data-tone={abstract.over ? 'error' : abstract.near ? 'warning' : undefined}
        >
          摘要 <b className={cn('font-medium', abstract.over ? 'text-danger-fg' : abstract.near ? 'text-warn-fg' : 'text-fg')}>{abstract.chars}</b>/{abstract.limit}
        </span>
        {claims != null && (
          <>
            <span aria-hidden="true" className="text-fg-subtle">
              ·
            </span>
            <span>
              权项 <b className="font-medium text-fg">{claims}</b>
            </span>
          </>
        )}
        {paragraphs != null && paragraphs > 0 && (
          <>
            <span aria-hidden="true" className="text-fg-subtle">
              ·
            </span>
            <span>
              段号 <b className="font-medium text-fg">[{String(paragraphs).padStart(4, '0')}]</b>
            </span>
          </>
        )}
      </div>
    </div>
  )
}
