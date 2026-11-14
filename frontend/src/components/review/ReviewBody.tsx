import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, MessageSquarePlus, MessagesSquare, UserCheck, X } from 'lucide-react'
import { useStudio, selectOpenCommentCount, selectReadonly } from '@/store'
import { commentAuthorKey, matchesCommentFilter } from '@/store/comments'
import { blockAtLine } from '@/types/ast'
import { bookAtLine, splitBooks } from '@/lib/docset'
import { makePanelId } from '@/store/layout'
import { useCommentsViewLifecycle } from '@/hooks/useCommentsPoll'
import { pdfQueryForBlock } from '@/components/preview/locate'
import { FOCUS_RING, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { editorSelection, revealMark } from './criticExtension'
import { blockLabel, bookForAnchor, clusterMarks, groupComments, groupMarks, type MarkCluster } from './reviewUtils'
import { AssignReviewDialog } from './AssignReviewDialog'
import { MarkCard, READONLY_TIP } from './MarkCard'
import { CommentGroups } from './CommentGroups'
import { CommentFilters } from './CommentFilters'
import { CommentDraftForm } from './CommentDraftForm'
import { MSG_COMMENT_FAIL } from '@/lib/copy'

const UNANCHORED_TIP = '批注要挂在某一段上：请先把光标放到摘要、权利要求或说明书的段落里再添加'



/**
 * 「定位」动作（R-REV-03）：每条修订 / 批注 → setFocus{source:'review', book, blockId, line}，三视图各自订阅滚动；
 * 兼容旧路径（源码 gotoLine / 大纲 activeBlock / PDF 文本定位）；375 时关掉导航抽屉与全屏 Sheet，切到编辑（预览 Tab 保持预览）。
 */
export function useReviewLocate() {
  const desktop = useIsDesktop()
  return (blockId: string, line: number) => {
    const s = useStudio.getState()
    const bid = blockId || (s.ast ? blockAtLine(s.ast, line)?.block.id ?? '' : '')
    const book = bid ? bookForAnchor(s.ast, bid, line) : bookAtLine(splitBooks(s.content), line)
    if (bid) {
      s.setFocus({ source: 'review', book: book ?? 'description', blockId: bid, line })
      s.setActiveBlock(bid, 'outline')
      const q = s.ast ? pdfQueryForBlock(s.ast, bid) : null
      if (q) s.locateInPdf(q)
    }
    // 单书宿主不随 Focus 换书：dock 下的版面卡只渲当前书——换/开目标书的版面卡再滚行；
    // 源码视图照旧 gotoLine（内部开源码卡 + requestScroll）；无 dock 壳按 activeBook 渲染，只切书不动 Tab。
    if (s.dockHandle && s.editorView === 'layout' && book) {
      s.openPanel(makePanelId('layout', book))
      s.requestScroll(line)
    } else {
      s.gotoLine(line)
      if (book && !s.dockHandle) s.setActiveBook(book)
    }
    if (!desktop) {
      s.closeReviewDrawer()
      s.closeMobileNav()
      if (s.mobileTab !== 'preview') s.setMobileTab('edit')
    }
  }
}

export type ReviewSection = 'marks' | 'comments'

export interface ReviewBodyProps {
  pid: string | null
  /** 顶部是否显示「指派审阅」（Drawer / Sheet 顶栏已放时传 false） */
  showAssign?: boolean
  /** 只渲染哪几节（ReviewRail 按 Tab 传单节；默认修订 + 批注）；同一实例切 sections，回复草稿跨 Tab 保留 */
  sections?: readonly ReviewSection[]
  className?: string
}

const ALL_SECTIONS: readonly ReviewSection[] = ['marks', 'comments']

/**
 * 审阅内容（Drawer / 全屏 Sheet / 侧栏面板共用）。
 * 上半：修订逐条（后端 /critic 解析的 CriticMark；逐条 / 全部 接受·拒绝 → review slice 显式写回，绝不静默改源）；
 * 下半：批注线程（筛选 状态 / 来源 human|ai|client / 人；按块分组；回复可 @；解决 / 重开；删除）。
 * 501 → EmptyState「功能开发中」（prep 契约）。375 按钮 44px（U12）。
 */
export function ReviewBody({ pid, showAssign = true, sections = ALL_SECTIONS, className }: ReviewBodyProps) {
  const desktop = useIsDesktop()
  const showMarks = sections.includes('marks')
  const showComments = sections.includes('comments')
  /** 单节嵌在 ReviewRail 页签里时，计数已在页签上，节标题不再重复（仍保留给读屏器） */
  const tabbed = sections.length === 1
  const activeMarkId = useStudio((s) => s.activeMarkId)
  const setActiveMark = useStudio((s) => s.setActiveMark)
  const setReviewRailTab = useStudio((s) => s.setReviewRailTab)
  const replyDraft = useStudio((s) => s.replyDraft)
  const setReplyDraft = useStudio((s) => s.setReplyDraft)
  const setCommentDraft = useStudio((s) => s.setCommentDraft)
  const comments = useStudio((s) => s.comments)
  const commentsLoading = useStudio((s) => s.commentsLoading)
  const commentsError = useStudio((s) => s.commentsError)
  const unavailable = useStudio((s) => s.commentsUnavailable || s.marksUnavailable)
  const marks = useStudio((s) => s.marks)
  const open = useStudio(selectOpenCommentCount)
  const activeCommentId = useStudio((s) => s.activeCommentId)
  const pendingCommentId = useStudio((s) => s.pendingCommentId)
  const consumePendingComment = useStudio((s) => s.consumePendingComment)
  const filter = useStudio((s) => s.commentFilter)
  const setCommentFilter = useStudio((s) => s.setCommentFilter)
  const ast = useStudio((s) => s.ast)
  const cursorLine = useStudio((s) => s.cursor.line)
  const loadComments = useStudio((s) => s.loadComments)
  const addComment = useStudio((s) => s.addComment)
  const gotoLine = useStudio((s) => s.gotoLine)
  const acceptMarks = useStudio((s) => s.acceptMarks)
  const readonly = useStudio(selectReadonly)
  const rejectMarks = useStudio((s) => s.rejectMarks)
  const content = useStudio((s) => s.content)
  const acceptAll = useStudio((s) => s.acceptAll)
  const rejectAll = useStudio((s) => s.rejectAll)
  const toast = useStudio((s) => s.toast)
  const authed = useStudio((s) => s.authStatus === 'authed')
  const locate = useReviewLocate()

  // 批70：草稿存 store——ReviewBody 实例随 Tab/宿主卸载，本地态会在切换时静默丢稿
  const draft = useStudio((s) => s.commentDraft)
  const setDraft = setCommentDraft
  const addBtn = useRef<HTMLButtonElement>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmReject, setConfirmReject] = useState(false)

  useEffect(() => {
    if (pid) void loadComments(pid)
  }, [pid, loadComments])

  /* 挂载期间 30s 轮询批注（协作方 / 客户新增在会话内回流） */
  useCommentsViewLifecycle()

  /* 修订卡片「回复」（可能来自另一 Tab 的实例）→ 批注节开草稿 */
  useEffect(() => {
    if (!replyDraft || !showComments) return
    setDraft({ line: replyDraft.line, quote: replyDraft.quote, body: '' })
    setReplyDraft(null)
  }, [replyDraft, showComments, setReplyDraft, setDraft])

  /* ?c=<cid> / 通知点击 → 滚到该批注（已解决时自动展开「已解决」）。
     列表是挂载时快照——找不到先强刷一次再判；仍无 ⇒ toast 并清 pending，不再静默丢参数 */
  const pendingRetry = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingCommentId || commentsLoading) return
    const target = comments.find((c) => c.id === pendingCommentId)
    if (!target) {
      if (!pid) {
        consumePendingComment()
        return
      }
      if (pendingRetry.current !== pendingCommentId) {
        pendingRetry.current = pendingCommentId
        void loadComments(pid)
        return
      }
      toast('该批注不存在或已被删除', 'info')
      consumePendingComment()
      return
    }
    if (target.resolved && filter.status === 'open') setShowResolved(true)
    const el = document.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(target.id)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.querySelector<HTMLElement>('[data-testid="review-locate"]')?.focus({ preventScroll: true })
    consumePendingComment()
  }, [pendingCommentId, comments, commentsLoading, filter.status, pid, consumePendingComment, loadComments, toast])

  const authors = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of comments) {
      const k = commentAuthorKey(c)
      if (!m.has(k)) m.set(k, c.author.name)
    }
    return Array.from(m, ([key, name]) => ({ key, name }))
  }, [comments])

  const lines = useMemo(() => content.split('\n'), [content])
  const markGroups = useMemo(() => groupMarks(ast, clusterMarks(marks, (n) => lines[n - 1])), [ast, marks, lines])

  const filtered = useMemo(() => comments.filter((c) => matchesCommentFilter(c, { ...filter, status: 'all' })), [comments, filter])
  const openGroups = useMemo(() => groupComments(filtered.filter((c) => !c.resolved)), [filtered])
  const resolvedGroups = useMemo(() => groupComments(filtered.filter((c) => c.resolved)), [filtered])
  const allGroups = useMemo(() => groupComments(filtered), [filtered])
  const resolvedCount = filtered.filter((c) => c.resolved).length
  // 触控：控件 md 36（命中区由 touch-hit 扩到 44）；标题 13/500；section 间距 24；左右留白按 Sheet 16
  const ctlSize = desktop ? 'xs' : 'md'
  const padX = desktop ? 'px-3' : 'px-sheet-m'
  const headingCls = cn('flex items-center gap-1.5 whitespace-nowrap text-fg-strong', desktop ? 'text-xs font-semibold' : 'text-sm font-medium')
  const headerRowCls = cn('flex min-h-panel-header flex-wrap items-center justify-between gap-x-2 gap-y-1', padX)
  const actionsCls = cn('flex items-center', desktop ? 'gap-1' : 'w-full gap-group-m pb-2 [&>*]:flex-1')

  const run = async (fn: () => Promise<unknown>, fail: string) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(`${fail}：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 草稿行 → 锚点块 id；不在摘要 / 权利要求 / 说明书任何块内（标题行、空行、附图书、AST 未就绪）为 '' */
  const draftBlockId = (line: number) => (ast ? blockAtLine(ast, line)?.block.id ?? '' : '')

  // 批69：批注草稿脏态守卫——已输入正文时取消/换锚先弹 DiscardDialog，不再静默丢稿
  const draftDirty = !!draft?.body.trim()
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)
  const guardDraft = (act: () => void) => (draftDirty ? setPendingDiscard(() => act) : act())
  useBeforeUnload(() => draftDirty)

  const startDraft = () => {
    const sel = editorSelection()
    if (!sel) {
      toast('请先打开编辑器并选中要批注的文字', 'info')
      return
    }
    if (!draftBlockId(sel.line)) {
      toast(UNANCHORED_TIP, 'info')
      return
    }
    setDraft({ line: sel.line, quote: sel.quote, body: '' })
  }

  /** 修订卡片「回复」：以该行 + 改动文字为锚点开批注草稿（锚点 block_id 由 submitDraft 按行推导）；已输入草稿先问 */
  const replyMark = (c: MarkCluster) => {
    guardDraft(() => {
      setActiveMark(c.id)
      setReplyDraft({ line: c.line, quote: (c.kind === 'ins' ? c.b : c.kind === 'comment' || c.kind === 'mark' ? c.marks[0]?.a ?? '' : c.a).slice(0, 80) })
      if (!showComments) setReviewRailTab('comments')
    })
  }

  /** 取消 = 丢弃草稿并把焦点还给「添加批注」；Esc 在表单内同此，宿主 Sheet 由 data-esc-local 留住（docs/plan/31） */
  const cancelDraft = () => {
    setDraft(null)
    requestAnimationFrame(() => addBtn.current?.focus())
  }

  const submitDraft = () => {
    if (!pid || !draft || !draft.body.trim()) return
    const blockId = draftBlockId(draft.line)
    if (!blockId) return
    void run(async () => {
      await addComment(pid, { block_id: blockId, line: draft.line, quote: draft.quote }, draft.body.trim())
      setDraft(null)
    }, MSG_COMMENT_FAIL)
  }

  if (unavailable) {
    return (
      <div data-slot="ReviewPanel" data-testid="review-panel" className={cn('flex h-full min-h-0 flex-col', className)}>
        <EmptyState
          size="sm"
          icon={MessagesSquare}
          title={NOT_IMPLEMENTED_TITLE}
          reason="批注与修订线程的后端接口尚未上线（返回 501）。审阅模式下的改动仍会记为修订建议。"
          data-testid="review-unavailable"
        />
        <div className="px-3 pb-3 text-xs text-fg-muted">
          <CriticHint />
        </div>
      </div>
    )
  }

  const renderGroups = (groups: ReturnType<typeof groupComments>) => (
    <CommentGroups
      groups={groups}
      ast={ast}
      pid={pid}
      activeCommentId={activeCommentId}
      cursorLine={cursorLine}
      desktop={desktop}
      busy={busy}
      padX={padX}
      run={run}
      onLocate={(cm) => {
        useStudio.getState().setActiveComment(cm.id)
        locate(cm.anchor.block_id, cm.anchor.line)
      }}
    />
  )

  return (
    <div data-slot="ReviewPanel" data-testid="review-panel" className={cn('flex h-full min-h-0 flex-col text-sm', className)}>
      <div className={cn('min-h-0 flex-1 overflow-auto', !desktop && 'flex flex-col gap-section-m pb-sheet-m')} tabIndex={0} data-testid="review-sections">
        {/* ---------- 修订 ---------- */}
        {showMarks && (
        <section aria-labelledby="review-marks-title" className={cn(showComments && 'border-b border-border')}>
          <div className={cn(headerRowCls, 'sticky top-0 z-sticky bg-panel')} data-testid="review-marks-header">
            <h3 id="review-marks-title" className={headingCls}>
              修订 <span className={cn('font-mono tabular-nums', tabbed && 'sr-only')} data-testid="review-mark-count">{marks.length}</span> <span className={cn(tabbed && 'sr-only')}>处</span>
            </h3>
            {/* T7：单条修订只留逐项决定，≥2 处才出现全部接受/拒绝 */}
            {marks.length >= 2 && (
              <div className={actionsCls}>
                <Button size={ctlSize} variant="ghost" className="text-ok-fg" onClick={acceptAll} disabled={readonly} title={readonly ? READONLY_TIP : undefined} data-testid="review-accept-all">
                  <CheckCheck aria-hidden />全部接受
                </Button>
                {confirmReject ? (
                  <span className="flex items-center gap-1" role="group" aria-label="确认拒绝全部修订">
                    <span className="text-xs text-danger-fg">拒绝全部 {marks.length} 处修订？丢弃后需重跑体检找回。</span>
                    <Button size="xs" variant="danger" onClick={() => { setConfirmReject(false); rejectAll() }} data-testid="review-reject-all-confirm">确认</Button>
                    <Button size="icon-xs" variant="ghost" aria-label="取消" onClick={() => setConfirmReject(false)} data-testid="review-reject-all-cancel">
                      <X aria-hidden />
                    </Button>
                  </span>
                ) : (
                  <Button size={ctlSize} variant="ghost" className="text-danger-fg" onClick={() => setConfirmReject(true)} disabled={readonly} title={readonly ? READONLY_TIP : undefined} data-testid="review-reject-all">
                    <X aria-hidden />全部拒绝
                  </Button>
                )}
              </div>
            )}
          </div>
          {marks.length === 0 ? (
            <div className={cn('pb-3 text-xs text-fg-muted', padX)} data-testid="review-marks-empty">
              <p>无修订标记。</p>
              <CriticHint />
            </div>
          ) : (
            <div className={cn('flex flex-col gap-2 pb-3', padX)} data-testid="review-mark-list">
              {markGroups.map((g) => (
                <div key={g.blockId || `line-${g.line}`} className="flex flex-col gap-1.5" role="group" aria-label={blockLabel(ast, g.blockId)} data-testid="review-mark-group">
                  <p className="truncate pt-1 text-2xs font-medium uppercase tracking-wide text-fg-muted" data-testid="review-mark-group-label"
                    title={blockLabel(ast, g.blockId)}>
                    {blockLabel(ast, g.blockId)}
                  </p>
                  <ul aria-label={`${blockLabel(ast, g.blockId)}的修订`} className="flex flex-col gap-1.5">
                    {g.items.map((c) => {
                      return (
                        <MarkCard
                          key={c.id}
                          c={c}
                          ast={ast}
                          blockId={g.blockId}
                          lineText={lines[c.line - 1]}
                          activeMarkId={activeMarkId}
                          cursorLine={cursorLine}
                          desktop={desktop}
                          ctlSize={ctlSize}
                          readonly={readonly}
                          pid={pid}
                          onLocate={(cl) => {
                            setActiveMark(cl.id)
                            locate(g.blockId, cl.line)
                            const first = cl.marks[0]
                            if (desktop && first && !revealMark(first)) gotoLine(cl.line)
                          }}
                          onReply={replyMark}
                          acceptMarks={acceptMarks}
                          rejectMarks={rejectMarks}
                        />
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
        )}

        {/* ---------- 批注 ---------- */}
        {showComments && (
        <section aria-labelledby="review-comments-title">
          <div className={cn(headerRowCls, 'sticky top-0 z-sticky bg-panel')}>
            <h3 id="review-comments-title" className={headingCls}>
              未解决批注 <span className="font-mono tabular-nums" data-testid="review-open-count">{open}</span> 条
              {commentsLoading && <span className="font-normal text-fg-muted">…</span>}
            </h3>
            <div className={actionsCls} data-testid="review-comment-actions">
              {showAssign && authed && (
                <Button size={ctlSize} variant="ghost" onClick={() => setAssignOpen(true)} disabled={!pid} data-testid="review-assign-open">
                  <UserCheck aria-hidden />指派审阅
                </Button>
              )}
              <Button ref={addBtn} size={ctlSize} variant="secondary" onClick={startDraft} disabled={!pid || !!draft} data-testid="review-add-comment">
                <MessageSquarePlus aria-hidden />添加批注
              </Button>
            </div>
          </div>

          {comments.length > 0 && (
            <CommentFilters filter={filter} setCommentFilter={setCommentFilter} authors={authors} desktop={desktop} padX={padX} />
          )}

          {draft && (
            <CommentDraftForm
              draft={draft}
              setDraft={setDraft}
              blockName={blockLabel(ast, draftBlockId(draft.line))}
              anchored={!!draftBlockId(draft.line)}
              busy={busy}
              ctlSize={ctlSize}
              desktop={desktop}
              onCancel={() => guardDraft(cancelDraft)}
              onSubmit={submitDraft}
              unanchoredTip={UNANCHORED_TIP}
            />
          )}

          {commentsError && (
            <Alert variant="danger" className="mx-3 mb-2" data-testid="review-error">
              <AlertDescription>
                批注加载失败：{commentsError}
                <Button size="xs" variant="link" className="px-1" onClick={() => pid && void loadComments(pid)}>重试</Button>
              </AlertDescription>
            </Alert>
          )}

          {commentsLoading && comments.length === 0 && (
            <div className="flex flex-col gap-2 px-3 pb-3" data-testid="review-loading" aria-busy>
              <Skeleton className="h-row-mobile w-full rounded-md" />
              <Skeleton className="h-row-mobile w-full rounded-md" />
            </div>
          )}

          {comments.length === 0 && !commentsLoading && !commentsError && (
            <EmptyState size="sm" icon={MessagesSquare} title="暂无批注" reason="在编辑器中选中文字后点「添加批注」。" />
          )}

          {comments.length > 0 && filtered.length === 0 && (
            <p className="px-3 pb-3 text-xs text-fg-muted" data-testid="review-filter-empty">
              没有符合筛选条件的批注。
            </p>
          )}

          {filter.status === 'all' && renderGroups(allGroups)}
          {filter.status === 'resolved' && renderGroups(resolvedGroups)}
          {filter.status === 'open' && (
            <>
              {renderGroups(openGroups)}
              {resolvedCount > 0 && (
                <div className="border-t border-border">
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between px-3 text-xs text-fg-muted hover:bg-sunken', FOCUS_RING,
                      desktop ? 'min-h-md-control' : 'min-h-touch',
                    )}
                    aria-expanded={showResolved}
                    onClick={() => setShowResolved((v) => !v)}
                    data-testid="review-toggle-resolved"
                  >
                    <span className="flex items-center gap-1.5">
                      <CheckCheck className="size-3.5 text-ok-fg" aria-hidden />
                      已解决 <span className="font-mono tabular-nums">{resolvedCount}</span> 条
                    </span>
                    <span aria-hidden>{showResolved ? '收起' : '展开'}</span>
                  </button>
                  {showResolved && renderGroups(resolvedGroups)}
                </div>
              )}
            </>
          )}
        </section>
        )}
      </div>
      {showAssign && authed && <AssignReviewDialog open={assignOpen} onOpenChange={setAssignOpen} />}
      <DiscardDialog
        open={pendingDiscard !== null}
        onStay={() => setPendingDiscard(null)}
        onDiscard={() => {
          const act = pendingDiscard
          setPendingDiscard(null)
          act?.()
        }}
      />
    </div>
  )
}

/** 修订产生方式提示（W9 ux-09：面向代理师，不列 CriticMarkup 语法）；桌面 leading-5 与 W7 一致，触控 leading-7 拉开行距 */
export function CriticHint() {
  const desktop = useIsDesktop()
  return (
    <p className={desktop ? 'leading-5' : 'leading-7'} data-testid="critic-hint" data-density={desktop ? 'desktop' : 'touch'}>
      切到审阅模式后，在版面里直接增删改正文即生成修订建议；源码视图里的修订记号也会汇总到这里。
    </p>
  )
}
