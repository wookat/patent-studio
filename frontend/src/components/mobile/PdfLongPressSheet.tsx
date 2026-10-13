import { useEffect, useRef, useState } from 'react'
import { Code2, LayoutTemplate, MessageSquarePlus, PencilLine } from 'lucide-react'
import { revealView, switchView } from '@/components/editor/ViewTabs'
import { PDF_LONG_PRESS_EVENT, type PdfLongPressDetail } from '@/components/preview/pdfLongPress'
import { Button } from '@/components/ui/button'
import { Field, FieldControl, FieldError, FieldLabel } from '@/components/ui/field'
import { BottomDrawer } from '@/components/ui/sheet'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Textarea } from '@/components/ui/textarea'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { diagLocationLabel } from '@/lib/diagLocation'
import { useStudio, selectReadonly, selectRoleKnown, type PdfLongPress } from '@/store'
import { blockSource, findBlockLines } from '@/store/blocks'
import { LABEL_COMMENT } from '@/lib/copy'

/** 与 ReviewPanel 一致：批注锚点引文取块首行，避免整块入库 */
function quoteOf(text: string): string {
  return (
    text
      .split('\n')
      .find((l) => l.trim())
      ?.trim()
      .slice(0, 120) ?? ''
  )
}

/**
 * PDF 长按选块 Sheet（05 §3.21 / S10c）：订阅 `ui.pdfLongPress`（three-view 单元在 PdfPreview 长按命中块时广播 PDF_LONG_PRESS_EVENT；阈值由 pdfLongPress.ts 定，规格 ≥600ms 见 integration_requests），
 * 底部 Sheet：头部 块标签 · 书 · 页 + 块首行引文，四项（每项 48：--row-h-mobile）：在源码打开 / 在版面打开 / 添加批注 / 编辑此块（只读角色标「只读」）。
 * 定位统一走 `setFocus`（source:'pdf'）；源码另走 gotoLine（切编辑 Tab + 滚行），版面走 预览 Tab + Segmented=版面。
 * 批注在本 Sheet 内二级表单（复用 comments slice addComment；viewer 也可批注，与 ReviewPanel 同）；编辑此块走 blocks slice startBlockEdit（编辑 Tab 的版面 BlockEditor 契约）。
 */
export function PdfLongPressSheet() {
  const target = useStudio((s) => s.pdfLongPress)
  const setPdfLongPress = useStudio((s) => s.setPdfLongPress)
  // 批注表单只对触发它的那次长按有效：换目标 / 关闭后自然回到菜单
  const [commentFor, setCommentFor] = useState<PdfLongPress | null>(null)
  const step = target && commentFor === target ? 'comment' : 'menu'

  const close = () => setPdfLongPress(null)
  // 草稿守卫（批67/68）：批注二级表单脏态时——抽屉隐式关/取消，以及宿主驱动的新长按换目标（替换态绕过子级守卫）——先 DiscardDialog
  const [commentDirty, setCommentDirty] = useState(false)
  const [askDiscard, setAskDiscard] = useState<{ kind: 'close' } | { kind: 'retarget'; next: PdfLongPress } | null>(null)
  const commentDirtyRef = useRef(false)
  useEffect(() => {
    commentDirtyRef.current = commentDirty
  }, [commentDirty])
  useBeforeUnload(() => commentDirty)
  const guardedClose = () => (step === 'comment' && commentDirty ? setAskDiscard({ kind: 'close' }) : close())
  // three-view 的 PdfPreview 长按只广播 window 事件；命中块（blockId）才开 Sheet，未命中（页眉 / 空白）不打扰
  useEffect(() => {
    const onLongPress = (e: Event) => {
      const d = (e as CustomEvent<PdfLongPressDetail>).detail
      if (!d.blockId || !d.book) return
      const next: PdfLongPress = {
        book: d.book,
        blockId: d.blockId,
        line: d.line ?? undefined,
        page: d.page,
      }
      if (useStudio.getState().pdfLongPress && commentDirtyRef.current) setAskDiscard({ kind: 'retarget', next })
      else setPdfLongPress(next)
    }
    window.addEventListener(PDF_LONG_PRESS_EVENT, onLongPress)
    return () => window.removeEventListener(PDF_LONG_PRESS_EVENT, onLongPress)
  }, [setPdfLongPress])
  const ast = useStudio((s) => s.ast)
  if (!target) return null
  const label = diagLocationLabel({ line: target.line ?? null, blockId: target.blockId }, ast)
  const where = target.page ? `第 ${target.page} 页` : ''

  return (
    <BottomDrawer
      open
      onOpenChange={(o) => {
        if (!o) guardedClose()
      }}
      title={step === 'menu' ? label : `批注：${label}`}
      description={where}
      snap={step === 'menu' ? 'half' : 'full'}
      data-testid="pdf-long-press-sheet"
    >
      {step === 'menu' ? (
        <Menu target={target} onComment={() => setCommentFor(target)} onDone={close} />
      ) : (
        <CommentForm target={target} onDone={close} onCancel={guardedClose} onDirty={setCommentDirty} />
      )}
      <DiscardDialog
        open={askDiscard !== null}
        onStay={() => setAskDiscard(null)}
        onDiscard={() => {
          const a = askDiscard
          setAskDiscard(null)
          setCommentDirty(false)
          if (a?.kind === 'retarget') setPdfLongPress(a.next)
          else close()
        }}
      />
    </BottomDrawer>
  )
}

/** 菜单行 48（--row-h-mobile，列表主行档）；菜单 px 8 + 行内 px 8 = 文本贴页边 16 */
const ITEM = 'h-auto min-h-row-mobile w-full justify-start gap-3 rounded-md px-2 text-base font-normal [&_svg]:size-4 [&_svg]:text-fg-muted'

function Menu({ target, onComment, onDone }: { target: PdfLongPress; onComment: () => void; onDone: () => void }) {
  const ast = useStudio((s) => s.ast)
  const content = useStudio((s) => s.content)
  const src = ast ? blockSource(ast, content, target.blockId) : null
  const setMobileTab = useStudio((s) => s.setMobileTab)
  const setMobilePreviewKind = useStudio((s) => s.setMobilePreviewKind)
  const setFocus = useStudio((s) => s.setFocus)
  const setActiveBlock = useStudio((s) => s.setActiveBlock)
  const gotoLine = useStudio((s) => s.gotoLine)
  const startBlockEdit = useStudio((s) => s.startBlockEdit)
  const activeBook = useStudio((s) => s.activeBook)
  const setActiveBook = useStudio((s) => s.setActiveBook)
  const readonly = useStudio(selectReadonly)
  const roleKnown = useStudio(selectRoleKnown)
  const toast = useStudio((s) => s.toast)

  const focus = () => {
    setFocus({
      book: target.book,
      blockId: target.blockId,
      line: target.line,
      page: target.page,
      source: 'pdf',
    })
    setActiveBlock(target.blockId, 'outline')
  }
  const openSource = () => {
    if (activeBook === 'all') switchView('source')
    else revealView('source', target.book)
    setMobileTab('edit')
    if (target.line) gotoLine(target.line)
    focus()
    onDone()
  }
  const openLayout = () => {
    setMobilePreviewKind('layout')
    setMobileTab('preview')
    focus()
    onDone()
  }
  const editBlock = () => {
    if (readonly) {
      toast(roleKnown ? '当前角色只读，不能编辑正文' : '角色确认中，请稍后再试', 'error')
      return
    }
    if (activeBook !== 'all' && activeBook !== target.book) setActiveBook(target.book)
    switchView('layout')
    setMobileTab('edit')
    focus()
    startBlockEdit(target.blockId)
    onDone()
  }

  return (
    <div role="menu" aria-label="定位到此块" className="flex flex-col gap-px px-2 pb-sheet-m pt-sheet-top-m" data-testid="pdf-long-press-menu">
      {src ? (
        <blockquote className="mx-2 mb-2 line-clamp-2 rounded-md bg-paper px-3 py-2 text-sm leading-snug text-paper-fg" data-testid="plp-quote">
          {quoteOf(src)}
        </blockquote>
      ) : null}
      <Button role="menuitem" variant="ghost" className={ITEM} data-testid="plp-open-source" onClick={openSource}>
        <Code2 aria-hidden />
        在源码打开
      </Button>
      <Button role="menuitem" variant="ghost" className={ITEM} data-testid="plp-open-layout" onClick={openLayout}>
        <LayoutTemplate aria-hidden />
        在版面打开
      </Button>
      <Button role="menuitem" variant="ghost" className={ITEM} data-testid="plp-comment" onClick={onComment}>
        <MessageSquarePlus aria-hidden />
        添加批注
      </Button>
      <Button role="menuitem" variant="ghost" className={ITEM} data-testid="plp-edit-block" aria-disabled={readonly || undefined} onClick={editBlock}>
        <PencilLine aria-hidden />
        编辑此块
        {readonly ? <span className="ml-auto text-2xs text-fg-muted">只读</span> : null}
      </Button>
    </div>
  )
}

function CommentForm({ target, onDone, onCancel, onDirty }: { target: PdfLongPress; onDone: () => void; onCancel: () => void; onDirty: (dirty: boolean) => void }) {
  const pid = useStudio((s) => s.pid)
  const ast = useStudio((s) => s.ast)
  const content = useStudio((s) => s.content)
  const addComment = useStudio((s) => s.addComment)
  const toast = useStudio((s) => s.toast)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const dirty = body.trim().length > 0
  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty, onDirty])

  const src = ast ? blockSource(ast, content, target.blockId) : null
  const loc = ast ? findBlockLines(ast, target.blockId) : null
  const line = target.line ?? (loc ? loc.offset + loc.start : 1)

  const submit = async () => {
    const text = body.trim()
    if (!text) {
      setError(`请输入${LABEL_COMMENT}`)
      return
    }
    if (!pid) return
    setBusy(true)
    setError(undefined)
    try {
      await addComment(pid, { block_id: target.blockId, line, quote: quoteOf(src ?? '') }, text)
      toast('批注已添加', 'success')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '批注失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-group-m px-sheet-m pb-sheet-m pt-sheet-top-m"
      data-testid="pdf-long-press-comment"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {src ? <blockquote className="line-clamp-3 border-l-2 border-brand-300 pl-3 text-sm text-fg-muted">{quoteOf(src)}</blockquote> : null}
      <Field error={error}>
        <FieldLabel>批注</FieldLabel>
        <FieldControl>
          <Textarea autoFocus rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="写下对此块的意见…" disabled={busy} data-testid="plp-comment-body" />
        </FieldControl>
        <FieldError />
      </Field>
      <div className="flex justify-end gap-group-m" data-testid="plp-comment-actions">
        <Button type="button" variant="ghost" size="md" onClick={onCancel} disabled={busy}>
          取消
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={busy || !pid} data-testid="plp-comment-submit">
          {busy ? '提交中…' : '添加批注'}
        </Button>
      </div>
    </form>
  )
}
