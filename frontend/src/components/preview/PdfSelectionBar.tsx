import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Copy, LayoutTemplate, LocateFixed, MessageSquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { revealView } from '@/components/editor/ViewTabs'
import { diagLocationLabel } from '@/lib/diagLocation'
import { BOOK_LABELS } from '@/lib/docset'
import { useStudio } from '@/store'
import type { Ast } from '@/types/ast'
import type { Focus } from '@/types/focus'
import { locatePdfHit, type PdfHit } from './pdfFocus'
import { copyText } from '@/lib/download'
import { LABEL_COMMENT, MSG_COMMENT_FAIL } from '@/lib/copy'

export interface SelectionBarState {
  /** 相对 PdfPreview 滚动容器的坐标（选区顶部中点；浮岛画在其上方 8px） */
  x: number
  y: number
  text: string
  hit: PdfHit
}

interface Props {
  sel: SelectionBarState
  url: string | null
  onClose(): void
  /** 批注草稿脏态上报（宿主守卫宿主驱动的替换/卸载用，批68） */
  onDirty?(dirty: boolean): void
}

/** 浮岛与容器边缘的最小内距（05 §3.6 / ux-05：right ≥ 8 不被裁切） */
const INSET = 8
/** 选区与浮岛之间的间距 */
const GAP = 8
/** 上方放不下时落到选区下方的偏移（约一行 PDF 文字） */
const BELOW = 20

/**
 * 将浮岛限制在滚动容器可视区内：水平以 x 居中后 clamp 到 [scrollLeft+8, scrollLeft+clientWidth-w-8]；
 * 垂直优先放选区上方 8px，顶部空间不足则落到选区下方。
 */
export function clampIsland(
  sel: { x: number; y: number },
  size: { w: number; h: number },
  box: { scrollLeft: number; scrollTop: number; clientWidth: number; clientHeight: number },
): { left: number; top: number } {
  const minLeft = box.scrollLeft + INSET
  const maxLeft = box.scrollLeft + box.clientWidth - size.w - INSET
  const left = Math.max(minLeft, Math.min(sel.x - size.w / 2, maxLeft))
  let top = sel.y - size.h - GAP
  if (top < box.scrollTop + INSET) top = Math.min(sel.y + BELOW, box.scrollTop + box.clientHeight - size.h - INSET)
  return { left, top: Math.max(box.scrollTop + INSET, top) }
}

/** 选区所在块的用户可读位置（权利要求 N / 说明书 · 段落）；AST 未就位时退到书名 */
function focusLabel(f: Focus, ast: Ast | null): string {
  const label = diagLocationLabel({ line: f.line ?? null, blockId: f.blockId }, ast)
  return label === '全文' ? BOOK_LABELS[f.book] : label
}

/**
 * PDF 拖选浮岛（05 §3.6；原型 `.float-tb`）：bg-elevated · r-md · sh-md · p-1；
 * 左 = 定位信息（权利要求 N / 说明书 · 段落 · 第 N 页），右 = ghost xs 动作：定位源码 / 在版面打开 / 批注 / 复制。
 * 定位失败时前三项禁用并带失败码文案，复制始终可用。Esc 关闭；批注框 Ctrl/⌘+Enter 提交。
 * 位置：clampIsland() 保证距容器右缘 ≥ 8px、不被裁切（ux-05）。
 */
export function PdfSelectionBar({ sel, url, onClose, onDirty }: Props) {
  const pid = useStudio((s) => s.pid)
  const addComment = useStudio((s) => s.addComment)
  const toast = useStudio((s) => s.toast)
  const setFocus = useStudio((s) => s.setFocus)
  const ast = useStudio((s) => s.ast)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 草稿守卫（批67/68）：已输入批注时一切带「离开当前草稿」语义的动作——Esc/取消/收起/定位跳转/复制——先 DiscardDialog，pending 记待执行动作
  const dirty = draft !== null && draft.trim().length > 0
  const [pending, setPending] = useState<(() => void) | null>(null)
  useBeforeUnload(() => dirty)
  useEffect(() => {
    onDirty?.(dirty)
    return () => onDirty?.(false)
  }, [dirty, onDirty])
  const guard = (act: () => void) => (dirty ? setPending(() => act) : act())
  const requestClose = () => guard(onClose)
  const collapseDraft = () => guard(() => setDraft(null))
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // 只算不写：判定可否定位（stale / 无索引 / 附图页…），成功才启用批注 / 跳转
  const outcome = locatePdfHit(sel.hit, url, false)
  const focus = outcome.focus ?? null
  const can = !!focus

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
  }, [])

  useLayoutEffect(() => {
    const el = root.current
    const box = el?.offsetParent as HTMLElement | null
    if (!el || !box) return
    setPos(clampIsland(sel, { w: el.offsetWidth, h: el.offsetHeight }, box))
  }, [sel, draft])

  const jump = (view: 'source' | 'layout', f: Focus) => {
    guard(() => {
      revealView(view, f.book)
      setFocus({ book: f.book, blockId: f.blockId, line: f.line, page: f.page, source: 'pdf' })
      onClose()
    })
  }

  const copy = async () => {
    if (await copyText(sel.text)) {
      toast('已复制', 'success')
    } else {
      toast('复制失败，请用 Ctrl/⌘+C', 'info')
    }
    guard(onClose)
  }

  const submit = async () => {
    if (!pid || !focus || !draft?.trim()) return
    setBusy(true)
    const c = await addComment(pid, { block_id: focus.blockId, line: focus.line ?? 0, quote: sel.text }, draft.trim()).catch(() => null)
    setBusy(false)
    if (c) {
      toast('批注已添加', 'success')
      onClose()
    } else toast(MSG_COMMENT_FAIL, 'error')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      requestClose()
    }
  }

  const failTip = outcome.fail ? `无法定位：${outcome.fail === 'stale' ? 'PDF 已过期，请重新构建' : '这段文字不对应源码块'}` : undefined
  const where = focus
    ? [focusLabel(focus, ast), `第 ${sel.hit.page} 页`].join(' · ')
    : `第 ${sel.hit.page} 页 · 未定位`

  const style: CSSProperties = pos ? { left: pos.left, top: pos.top } : { left: sel.x, top: sel.y, visibility: 'hidden' }

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label="PDF 选区操作"
      data-testid="pdf-selection-bar"
      className="pdf-sel-bar flex max-w-[calc(100%-1rem)] flex-col gap-1 rounded-md bg-elevated p-1 text-fg shadow-md"
      style={style}
      onKeyDown={onKey}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-0.5">
        <span className="px-1.5 font-mono text-2xs text-fg-muted tabular" data-testid="pdf-sel-where" title={failTip ?? where}>
          {where}
        </span>
        <Separator orientation="vertical" className="mx-0.5 h-4 self-center" />
        <Button variant="ghost" size="xs" disabled={!can} title={failTip ?? '在源码中定位并高亮该块'} onClick={() => focus && jump('source', focus)} data-testid="pdf-sel-source">
          <LocateFixed /> 定位源码
        </Button>
        <Button variant="ghost" size="xs" disabled={!can} title={failTip ?? '在版面视图打开该块'} onClick={() => focus && jump('layout', focus)} data-testid="pdf-sel-layout">
          <LayoutTemplate /> 版面
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={!can || !pid}
          title={failTip ?? '对选中文字添加批注'}
          aria-expanded={draft !== null}
          className={draft !== null ? 'bg-active text-fg-strong' : undefined}
          onClick={() => (draft === null ? setDraft('') : collapseDraft())}
          data-testid="pdf-sel-comment"
        >
          <MessageSquarePlus /> 批注
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void copy()} data-testid="pdf-sel-copy">
          <Copy /> 复制
        </Button>
      </div>
      {draft !== null && (
        <div className="flex w-72 max-w-full flex-col gap-1.5 border-t border-border px-1 pb-1 pt-1.5">
          <blockquote className="line-clamp-2 border-l-2 border-border-strong pl-2 text-xs text-fg-muted">{sel.text}</blockquote>
          <Textarea
            autoFocus
            rows={2}
            value={draft}
            placeholder={LABEL_COMMENT}
            aria-label={LABEL_COMMENT}
            className="min-h-14"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div className="flex items-center gap-1">
            <span className="text-2xs text-fg-subtle">
              <Kbd keys={['Mod', 'Enter']} /> 提交
            </span>
            <Button variant="ghost" size="xs" className="ml-auto" onClick={collapseDraft}>
              取消
            </Button>
            <Button variant="soft" size="xs" loading={busy} disabled={!draft.trim()} onClick={() => void submit()} data-testid="pdf-sel-comment-submit">
              提交
            </Button>
          </div>
        </div>
      )}
      <DiscardDialog
        open={pending !== null}
        onStay={() => setPending(null)}
        onDiscard={() => {
          const act = pending
          setPending(null)
          act?.()
        }}
      />
    </div>
  )
}
