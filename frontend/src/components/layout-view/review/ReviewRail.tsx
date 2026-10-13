import { useEffect } from 'react'
import { fmtFull } from '@/lib/format'
import { History, MessagesSquare, PenLine, RefreshCw } from 'lucide-react'
import { useStudio, selectEditorMode } from '@/store'
import type { ReviewRailTab } from '@/store/review'
import { FOCUS_RING, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsDesktop } from '@/hooks/useMisc'
import { ReviewBody, useReviewLocate } from '@/components/review/ReviewBody'
import { blockLabel } from '@/components/review/reviewUtils'
import { MARKUP_LEVELS, MARKUP_LEVEL_LABEL, type MarkupLevel } from './markupLevel'
import type { BlockChange, BlockChangeKind } from '@/lib/api'

/**
 * Word 式审阅伴随栏（docs/plan/22 决策 5）：三 Tab 修订 / 批注 / 已修改 + 四档标记（同一状态驱动 PDF 卡 reviewMode）。
 * 宿主：≥1280 由 LayoutViewSlots.rightRail 挂在版面右侧 320（integration_requests）；本单元内由 ReviewDrawer 承载
 * （≥1280 右侧 320 非模态 Sheet / <1280 与 375 底部 Sheet）。修订 / 批注复用 ReviewBody；
 * 批70：页签 forceMount + 草稿上提 store——切 Tab / 关栏重开都不丢输入中的草稿。
 */
export interface ReviewRailProps {
  pid: string
  className?: string
  /** 顶部是否显示「指派审阅」（Sheet 顶栏已放时传 false） */
  showAssign?: boolean
}

const LEVEL_OPTIONS = MARKUP_LEVELS.map((v) => ({ value: v, label: MARKUP_LEVEL_LABEL[v], 'data-testid': `markup-level-${v}` }))

const KIND_LABEL: Record<BlockChangeKind, string> = { added: '新增', removed: '删除', changed: '修改' }
const KIND_TONE: Record<BlockChangeKind, 'ok' | 'danger' | 'info'> = { added: 'ok', removed: 'danger', changed: 'info' }
const KIND_BORDER: Record<BlockChangeKind, string> = { added: 'border-l-ok-dot', removed: 'border-l-danger-dot', changed: 'border-l-info-dot' }


export function ReviewRail({ pid, className, showAssign = true }: ReviewRailProps) {
  const desktop = useIsDesktop()
  const tab = useStudio((s) => s.reviewRailTab)
  const setTab = useStudio((s) => s.setReviewRailTab)
  const level = useStudio((s) => s.markupLevel)
  const setLevel = useStudio((s) => s.setMarkupLevel)
  const markCount = useStudio((s) => s.marks.length)
  const changeCount = useStudio((s) => s.historyBlocks?.length ?? 0)
  const editorMode = useStudio(selectEditorMode)
  const padX = desktop ? 'px-3' : 'px-sheet-m'

  return (
    <div data-slot="ReviewRail" data-testid="review-rail" className={cn('flex h-full min-h-0 flex-col text-sm', className)}>
      <div className={cn('flex flex-col gap-1 py-2', padX)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs font-medium uppercase tracking-wide text-fg-muted">
            标记显示
          </span>
          {editorMode === 'review' && (
            <span role="status" className="inline-flex items-center gap-1 text-2xs text-info-fg" data-testid="review-mode-indicator">
              <span className="size-1.5 rounded-full bg-info-dot" aria-hidden />
              审阅模式
            </span>
          )}
        </div>
        <Segmented<MarkupLevel>
          size={desktop ? 'sm' : 'md'}
          aria-label="标记显示"
          className="w-full"
          options={LEVEL_OPTIONS}
          value={level}
          onValueChange={setLevel}
          data-testid="markup-level"
        />
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewRailTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="审阅栏" size={desktop ? 'md' : 'xl'} className={cn('shrink-0', !desktop && 'px-sheet-m')}>
          <TabsTrigger value="marks" data-testid="review-rail-tab-marks">
            <PenLine aria-hidden />
            修订{markCount > 0 && <span className="font-mono text-2xs tabular-nums text-fg-muted">{markCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="comments" data-testid="review-rail-tab-comments">
            <MessagesSquare aria-hidden />
            批注
          </TabsTrigger>
          <TabsTrigger value="changes" data-testid="review-rail-tab-changes">
            <History aria-hidden />
            已修改{changeCount > 0 && <span className="font-mono text-2xs tabular-nums text-fg-muted">{changeCount}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="marks" forceMount className="min-h-0 flex-1 flex-col data-[state=active]:flex">
          <ReviewBody pid={pid} showAssign={false} sections={['marks']} className="min-h-0 flex-1" />
        </TabsContent>
        <TabsContent value="comments" forceMount className="min-h-0 flex-1 flex-col data-[state=active]:flex">
          <ReviewBody pid={pid} showAssign={showAssign} sections={['comments']} className="min-h-0 flex-1" />
        </TabsContent>
        <TabsContent value="changes" className="min-h-0 flex-1 flex-col data-[state=active]:flex">
          <ChangesTab pid={pid} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** 已修改：上一版快照 → 工作区 的块级差异（GET /history/diff?format=blocks），点击定位 */
function ChangesTab({ pid }: { pid: string }) {
  const desktop = useIsDesktop()
  const blocks = useStudio((s) => s.historyBlocks)
  const base = useStudio((s) => s.historyBlocksBase)
  const loading = useStudio((s) => s.historyBlocksLoading)
  const error = useStudio((s) => s.historyBlocksError)
  const unavailable = useStudio((s) => s.historyUnavailable)
  const load = useStudio((s) => s.loadBlockChanges)
  const saved = useStudio((s) => s.saved)
  const ast = useStudio((s) => s.ast)
  const locate = useReviewLocate()
  const padX = desktop ? 'px-3' : 'px-sheet-m'

  useEffect(() => {
    void load(pid)
  }, [pid, load, saved])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="review-changes">
      <div className={cn('flex min-h-panel-header items-center justify-between gap-2', padX)}>
        <p className="min-w-0 truncate text-xs text-fg-muted" data-testid="review-changes-base"
          title={base ? `相对上一版 · ${base.author || '未知'} · ${fmtFull(base.at)}` : undefined}>
          {base ? (
            <>
              相对上一版 · {base.author || '未知'} · {fmtFull(base.at)}
            </>
          ) : (
            '尚无历史版本'
          )}
        </p>
        <Button size={desktop ? 'icon-xs' : 'icon-md'} variant="ghost" aria-label="刷新已修改列表" onClick={() => void load(pid)} disabled={loading} data-testid="review-changes-refresh">
          <RefreshCw aria-hidden className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
        </Button>
      </div>
      {error && (
        <Alert variant="danger" className="mx-3 mb-2" data-testid="review-changes-error">
          <AlertDescription>块级差异不可用：{error}</AlertDescription>
        </Alert>
      )}
      {loading && !blocks && !error && (
        <div className={cn('flex flex-col gap-2 pb-3', padX)} aria-busy data-testid="review-changes-skeleton">
          <Skeleton className="h-row-mobile w-full rounded-md" />
          <Skeleton className="h-row-mobile w-full rounded-md" />
        </div>
      )}
      {blocks && blocks.length === 0 && !error && (
        <EmptyState
          size="sm"
          icon={History}
          title={base ? '没有改动' : '还没有可对比的版本'}
          reason={
            base
              ? '当前正文与上一版快照一致。'
              : unavailable
                ? '本案未开启版本历史，无法列出改过的块。'
                : '正文每次保存（含协同自动保存）都会生成一版快照；有了快照后，这里列出相对上一版改过的块，点卡片可定位。'
          }
          action={
            base || unavailable ? undefined : (
              <Button size="sm" variant="outline" onClick={() => void load(pid)} disabled={loading} data-testid="review-changes-retry">
                <RefreshCw aria-hidden />
                刷新
              </Button>
            )
          }
          data-testid="review-changes-empty"
        />
      )}
      {blocks && blocks.length > 0 && (
        <ul aria-label="已修改的块" className={cn('flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto pb-3', padX)} data-testid="review-change-list">
          {blocks.map((b) => (
            <ChangeCard key={`${b.block_id}:${b.kind}:${b.lines[0]}`} change={b} label={blockLabel(ast, b.block_id)} desktop={desktop} onLocate={() => locate(b.kind === 'removed' ? '' : b.block_id, Math.max(1, b.lines[0]))} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ChangeCard({ change: b, label, desktop, onLocate }: { change: BlockChange; label: string; desktop: boolean; onLocate: () => void }) {
  return (
    <li data-testid="review-change" data-block-id={b.block_id} data-kind={b.kind} className={cn('rounded-md border border-border border-l-2 bg-panel transition-colors hover:bg-sunken motion-reduce:transition-none', KIND_BORDER[b.kind])}>
      <button
        type="button"
        className={cn('flex w-full min-w-0 flex-col gap-1 rounded-md p-2 text-left', !desktop && 'min-h-touch justify-center', FOCUS_RING)}
        title={b.kind === 'removed' ? `原块已删除（${label}处）` : `定位到${label}`}
        onClick={onLocate}
        data-testid="review-change-locate"
      >
        <span className="flex items-center gap-1.5">
          <Badge tone={KIND_TONE[b.kind]}>{KIND_LABEL[b.kind]}</Badge>
          <span className="truncate text-xs leading-5 text-fg" title={label}>{label}</span>
        </span>
      </button>
    </li>
  )
}
