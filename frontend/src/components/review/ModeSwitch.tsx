import { Check, ChevronDown, FileCheck2, FileDiff, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { REVIEW_MODE_LABEL, type ReviewMode } from '@/lib/types'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'

const ORDER: ReviewMode[] = ['original', 'final', 'markup']
const HINT: Record<ReviewMode, string> = {
  original: '拒绝全部修订后的文本（审阅前原文）',
  final: '接受全部修订后的文本（交付稿）',
  markup: '所有标记：Word 式修订（插入下划线 / 删除删除线 / 页边改动竖线）',
}
const ICON: Record<ReviewMode, typeof FileText> = { original: FileText, final: FileCheck2, markup: FileDiff }

/**
 * PDF 工具条「原文 / 修订后 / 标记」分段切换（C5-review-ui；docs/plan/07 §5.4 / §7.1）。
 * 借鉴 Word「审阅 › 显示标记 ▾（原始 / 无标记 / 所有标记）」——专利代理人与发明人核对修改时需要看"改前 / 改后 / 带痕迹"三种 PDF。
 * 改变 store.reviewMode 即触发重建（review.ts setReviewMode）。
 * 无标记且处于 final 时隐藏（工具条不为无修订的案子占位）；一旦切到非 final 模式即常显，便于切回。
 * `responsive`（桌面工具条）三档：容器 ≥ 640 文字分段；400–640 图标分段（每段最小 24 宽，文字进 aria-label / title）；
 * < 400 收进溢出菜单（`review-mode-menu`，菜单项带勾选）。三档共用一个 radiogroup DOM（菜单不是 radiogroup），可访问名称一致。
 */
export function ModeSwitch({ mobile = false, responsive = false, className }: { mobile?: boolean; responsive?: boolean; className?: string }) {
  const mode = useStudio((s) => s.reviewMode)
  const setMode = useStudio((s) => s.setReviewMode)
  const hasMarks = useStudio((s) => s.marks.length > 0)
  if (!hasMarks && mode === 'final') return null
  const compact = responsive && !mobile
  const Current = ICON[mode]
  return (
    <>
      <div
        role="radiogroup"
        aria-label="修订显示模式"
        data-slot="ModeSwitch"
        data-testid="review-mode-switch"
        data-responsive={responsive || undefined}
        className={cn(
          'inline-flex shrink-0 items-center rounded-sm border border-border-strong bg-panel p-0.5 text-xs',
          compact && 'hidden @[400px]/pdftb:inline-flex',
          className,
        )}
      >
        {ORDER.map((m) => {
          const Icon = ICON[m]
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              aria-label={REVIEW_MODE_LABEL[m]}
              className={cn(
                'inline-flex items-center justify-center gap-1 rounded-[5px] transition-colors',
                FOCUS_RING,
                mobile ? 'h-8 px-2' : 'h-5',
                !mobile && (compact ? 'min-w-6 px-1 @[640px]/pdftb:px-2' : 'px-2'),
                mode === m ? 'bg-primary-soft font-semibold text-primary-text' : 'text-fg-muted hover:bg-hover',
              )}
              onClick={() => setMode(m)}
              title={HINT[m]}
              data-testid={`review-mode-${m}`}
            >
              {compact && <Icon className="size-3.5 @[640px]/pdftb:hidden" aria-hidden />}
              <span className={cn(compact && 'hidden @[640px]/pdftb:inline')}>{REVIEW_MODE_LABEL[m]}</span>
            </button>
          )
        })}
      </div>
      {compact && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className={cn('shrink-0 gap-0.5 px-1 @[400px]/pdftb:hidden', className)}
              aria-label={`修订显示模式：${REVIEW_MODE_LABEL[mode]}`}
              title={`修订显示模式：${REVIEW_MODE_LABEL[mode]}`}
              data-testid="review-mode-menu"
            >
              <Current aria-hidden />
              <ChevronDown className="text-fg-subtle" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40 py-1">
            {ORDER.map((m) => {
              const Icon = ICON[m]
              return (
                <DropdownMenuItem key={m} onSelect={() => setMode(m)} title={HINT[m]} data-testid={`review-mode-menu-${m}`}>
                  <Icon aria-hidden />
                  {REVIEW_MODE_LABEL[m]}
                  {mode === m && <Check className="ml-auto size-4" />}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
