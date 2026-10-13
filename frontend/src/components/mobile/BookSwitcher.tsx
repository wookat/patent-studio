import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'
import { BOOK_LABELS } from '@/lib/docset'
import { selectBookDirty, useStudio, type BookView } from '@/store'
import { BOOK_NAMES } from '@/types/ast'

const VIEWS: readonly BookView[] = ['all', ...BOOK_NAMES]
const bookViewLabel = (b: BookView) => (b === 'all' ? '全文' : BOOK_LABELS[b])
const OPTIONS: readonly SegmentedOption<BookView>[] = VIEWS.map((b) => ({
  value: b,
  label: bookViewLabel(b),
  'data-testid': `book-switcher-${b}`,
}))

/**
 * 编辑 Tab 首行（06-w8 §4 工作台）：Segmented md（触控视觉 36，item touch-hit 命中 44）全文 / 摘要 / 权利要求书 / 说明书，
 * 装在 ScrollRow 里——375 放不下时横滑不裁切；Segmented 自带 ← → Home End 漫游。
 * ScrollRow 纵向出血收到 4（-my-1 py-1）：32 项在 36 容器里，容器外只需 4 就能放下 44 热区，行 box 恰等于 44 bar，
 * 不再上探盖住 MobileEditChrome 里 ViewSwitch 向下伸出的热区（docs/plan/28）。
 * 选中单书时右侧 icon-md「保存本书」（doc.saveBook → PUT /docs/{book}）；全文时保存仍是全局 Ctrl+S / MoreSheet。
 */
export function BookSwitcher({ className }: { className?: string }) {
  const activeBook = useStudio((s) => s.activeBook)
  const setActiveBook = useStudio((s) => s.setActiveBook)
  const saveBook = useStudio((s) => s.saveBook)
  const saving = useStudio((s) => s.saving)
  const pid = useStudio((s) => s.pid)
  const dirty = useStudio((s) => (activeBook === 'all' ? false : selectBookDirty(activeBook)(s)))

  return (
    <div
      data-slot="BookSwitcher"
      data-testid="book-switcher"
      className={cn('flex shrink-0 items-center gap-group-m bg-app px-page-m py-1', className)}
    >
      <ScrollRow bleed={false} role="group" aria-label="书切换" className="-my-1 min-w-0 flex-1 px-0 py-1 [&>*]:min-w-full">
        <Segmented
          size="md"
          options={OPTIONS}
          value={activeBook}
          onValueChange={setActiveBook}
          aria-label="书"
          className="[&_[data-slot=segmented-item]]:flex-1 [&_[data-slot=segmented-item]]:px-2"
        />
      </ScrollRow>
      {activeBook !== 'all' && (
        <Button
          size="icon-md"
          variant="ghost"
          onClick={() => void saveBook(activeBook)}
          disabled={!pid || !dirty || saving}
          aria-label={`保存${BOOK_LABELS[activeBook]}`}
          aria-busy={saving}
          title={`保存 ${BOOK_LABELS[activeBook]}（只写 docs/${activeBook}.md）`}
          className={cn('relative shrink-0', dirty ? 'text-link' : 'text-fg-muted')}
          data-testid="book-switcher-save"
          data-dirty={dirty || undefined}
        >
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          {dirty && !saving && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warn-dot" aria-hidden />}
        </Button>
      )}
    </div>
  )
}
