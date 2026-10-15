import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ClipboardEvent, type CSSProperties } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileCheck2,
  FileText,
  Highlighter,
  LayoutTemplate,
  Link2Off,
  MessageSquarePlus,
  MessageSquareText,
  RefreshCw,
} from 'lucide-react'
import { Toasts } from '@/components/shell/Toasts'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { Countdown } from '@/components/ui/countdown'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import { useIsDesktop } from '@/hooks/useMisc'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { PublicView } from '@/store/publicShare'
import type { PublicShareMeta } from '@/types/public-share'
import { anchorForBlock, anchorForQuote, type PublicAnchor } from './anchor'
import { ClientPdfView } from './ClientPdfView'
import { CommentSheet } from './CommentSheet'
import { CommentThreads } from './CommentThreads'
import { ConfirmDialog } from './ConfirmDialog'
import { fmtDateTime } from '@/lib/format'

/** 版面只读视图拖 ProseMirror/structure 重依赖——按需在打开时才拉（免登录页主包不该背它） */
const ClientLayoutView = lazy(() => import('./ClientLayoutView').then((m) => ({ default: m.ClientLayoutView })))

interface Pending {
  anchor: PublicAnchor
  /** 相对 <main> 的气泡位置 */
  top: number
  left: number
}

const BUBBLE_HALF = 72
/** 选区 / 块矩形 → 气泡位置：顶部不高于容器 44px（免遮工具条），左右不出容器 */
function bubbleAt(main: HTMLElement, r: DOMRect): Pick<Pending, 'top' | 'left'> {
  const m = main.getBoundingClientRect()
  return {
    top: Math.max(r.top - m.top, 44),
    left: Math.min(Math.max(r.left - m.left + r.width / 2, BUBBLE_HALF), main.clientWidth - BUBBLE_HALF),
  }
}

const VIEW_OPTIONS = [
  {
    value: 'pdf' as const,
    label: 'PDF',
    icon: <FileText aria-hidden />,
    'data-testid': 'client-view-pdf',
  },
  {
    value: 'layout' as const,
    label: '版面',
    icon: <LayoutTemplate aria-hidden />,
    'data-testid': 'client-view-layout',
  },
]

const DAY = 86400

function daysLeft(expiresAt: number | null): number | null {
  if (!expiresAt) return null
  return Math.ceil((expiresAt - Date.now() / 1000) / DAY)
}

function fmtDate(sec: number): string {
  return fmtDateTime(sec).slice(0, 10)
}

const XML_ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESC[c])

/** 水印文案（同时写到 data-text，供测试 / 排查） */
const watermarkText = (meta: PublicShareMeta) => `审阅版 · ${meta.org_name} · v${meta.version} · 仅供确认，请勿外传`

/**
 * qa-03：水印不再是 DOM 文字，而是一块空图层 —— SVG data-URI 只当 mask（对角 -30° 文字的形状，平铺），
 * 颜色由 `bg-fg-subtle/40` token 提供（亮暗自动跟随，SVG 内不写任何色值）；axe 不再把它当文本算对比度。
 * 瓦片 420×240，字号 12（≥ 11 下限）。
 */
function watermarkMask(text: string): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240" viewBox="0 0 420 240">' +
    '<text x="210" y="120" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="12" fill="currentColor" transform="rotate(-30 210 120)">' +
    escapeXml(text) +
    '</text></svg>'
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function permissionText(meta: PublicShareMeta): string {
  const parts = [meta.scope === 'read' ? '仅阅读' : meta.allow_comment ? '可批注' : '不可批注']
  if (meta.allow_download) parts.push('可下载')
  if (!meta.allow_copy) parts.push('禁复制')
  if (meta.scope === 'confirm') parts.push('需确认定稿')
  return parts.join(' · ')
}

/**
 * `#/c/<token>` 免登录客户审阅页（S9 s9-client-review.html / S10f s10-m-client.html；21 §4.5；R-REV-05、R-MOB-03）。
 * 顶栏（logo · 案名 · 案号 · 机构 · 审阅版 vN · 截止 Countdown；≥ md 右侧 Segmented「PDF / 版面」+ 下载）
 * → 文稿区（PDF 工具条 32：页码 · 提示 · 批注数）+ 纸面恒白 + 对角水印；≥ lg 右栏 360 常驻信息 dl + 批注线程
 * → 固定底部动作条 64（左说明 · 「有意见」secondary · 「确认定稿」唯一 primary，safe-area）。
 * < md（06 §4 屏 6）：顶栏 44（logo 28 · 标题 + 信息两行 · 图标按钮 md 36 + touch-hit）→ 「PDF / 版面」Segmented md 36 居中、上下 12
 *   → 页码 / 截止 / 批注 信息行 12 muted 单行 → 纸面页边 16 → 动作条 64：「有意见」lg 44（无确认动作时为唯一 primary）· 「确认定稿」xl 44。
 * 状态：加载骨架 / 410「链接已过期，请联系代理师」/ 404「链接失效」/ 501「功能开发中」/ 其他错误可重试；审阅中遇 410 / 404（批注 / 确认被拒）也切到对应空态。
 */
export function ClientReviewPage({ token }: { token: string }) {
  const desktop = useIsDesktop()
  const meta = useStudio((s) => s.publicMeta)
  const ast = useStudio((s) => s.publicAst)
  const css = useStudio((s) => s.publicCss)
  const comments = useStudio((s) => s.publicComments)
  const view = useStudio((s) => s.publicView)
  const loading = useStudio((s) => s.publicLoading)
  const expired = useStudio((s) => s.publicExpired)
  const invalid = useStudio((s) => s.publicInvalid)
  const unavailable = useStudio((s) => s.publicUnavailable)
  const error = useStudio((s) => s.publicError)
  const guestName = useStudio((s) => s.guestName)
  const toast = useStudio((s) => s.toast)
  const st = useStudio.getState

  const mainRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [composer, setComposer] = useState<{
    open: boolean
    anchor: PublicAnchor | null
  }>({ open: false, anchor: null })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [page, setPage] = useState<{ current: number; total: number }>({
    current: 1,
    total: 0,
  })
  const onPage = useCallback((current: number, total: number) => setPage({ current, total }), [])

  useEffect(() => {
    void st().openPublic(token)
    return () => st().resetPublic()
  }, [token, st])

  useEffect(() => {
    /* meta 加载期先落通用名——否则标签页残留上一页标题（批14 auth 页同族） */
    document.title = meta ? `${meta.title} · 客户审阅` : '客户审阅 · 知撰'
  }, [meta])

  const clearPick = useCallback(() => {
    setPending(null)
    setPickedId(null)
  }, [])

  /* 拖选 / 长按：选区落在 <main> 内 → 气泡「有意见」 */
  useEffect(() => {
    if (!ast || meta?.scope === 'read') return
    let timer = 0
    const onChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const sel = document.getSelection()
        const main = mainRef.current
        if (!sel || !main || sel.isCollapsed || sel.rangeCount === 0) return
        const range = sel.getRangeAt(0)
        if (!main.contains(range.commonAncestorContainer)) return
        const text = sel.toString().trim()
        if (!text) return
        setPickedId(null)
        setPending({
          anchor: anchorForQuote(ast, text),
          ...bubbleAt(main, range.getBoundingClientRect()),
        })
      }, 180)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [ast, meta?.scope])

  const onPickBlock = useCallback(
    (blockId: string, el: HTMLElement | null) => {
      if (!ast || meta?.scope === 'read') return
      const anchor = anchorForBlock(ast, blockId)
      if (!anchor) return
      const main = mainRef.current
      if (!main || !el) {
        setComposer({ open: true, anchor })
        return
      }
      setPickedId(blockId)
      setPending({ anchor, ...bubbleAt(main, el.getBoundingClientRect()) })
    },
    [ast, meta?.scope],
  )

  const openComposer = (anchor: PublicAnchor | null) => {
    setComposer({ open: true, anchor })
    setPending(null)
  }

  const setView = (v: PublicView) => {
    clearPick()
    st().setPublicView(v)
  }

  const allowCopy = meta?.allow_copy ?? true
  const onCopy = (e: ClipboardEvent) => {
    if (allowCopy) return
    e.preventDefault()
    toast('此链接不允许复制内容', 'info')
  }

  const pdfUrl = api.publicPdfUrl(token)
  const canComment = meta != null && meta.scope !== 'read' && meta.allow_comment
  const canConfirm = meta?.scope === 'confirm'
  const confirmedThis = meta?.confirmation != null && meta.confirmation.version === meta.version
  const left = daysLeft(meta?.expires_at ?? null)
  const openCount = comments.filter((c) => !c.resolved).length
  const ready = meta != null && ast != null && !expired && !invalid

  const viewSwitch = ready && (
    <div data-testid="client-viewbar" className={cn(!desktop && 'flex shrink-0 items-center justify-center bg-app px-page-m py-3')}>
      <Segmented value={view} onValueChange={setView} options={VIEW_OPTIONS} aria-label="查看方式" size="md" className={cn(!desktop && 'w-full')} />
    </div>
  )

  const watermark = meta && (
    <div
      role="presentation"
      data-testid="client-watermark"
      data-text={watermarkText(meta)}
      className="pointer-events-none absolute inset-0 z-base bg-fg-subtle/40 [-webkit-mask-image:var(--client-watermark)] [mask-image:var(--client-watermark)] [print-color-adjust:exact]"
      style={
        {
          '--client-watermark': watermarkMask(watermarkText(meta)),
        } as CSSProperties
      }
    />
  )

  return (
    <div data-slot="page" data-testid="page-client" className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] bg-app text-fg" onCopy={onCopy} onCut={onCopy}>
      <span hidden data-testid="client-token">{token}</span>

      <header className="flex h-mobile-topbar shrink-0 items-center gap-group-m border-b border-border bg-app px-page-m md:h-14 md:gap-3 md:px-4" data-testid="client-header">
        <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground md:size-8 md:rounded-md">
          <FileCheck2 className="size-4" strokeWidth={2.2} />
        </span>
        {meta ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="truncate text-sm font-semibold text-fg-strong md:text-base" data-testid="client-title" title={meta.title}>{meta.title}</h1>
            <p className="flex min-w-0 items-center gap-1 truncate text-xs text-fg-muted" title={`${meta.case_no} · ${meta.org_name} · 审阅版 v${meta.version}`}>
              <span className="font-mono tabular-nums">{meta.case_no}</span>
              <span aria-hidden>·</span>
              <span data-testid="client-org">{meta.org_name}</span>
              <span aria-hidden>·</span>
              <span>
                审阅版 <span className="tabular-nums" data-testid="client-version">v{meta.version}</span>
              </span>
            </p>
          </div>
        ) : (
          <h1 className="flex-1 text-sm font-semibold text-fg-strong">客户审阅</h1>
        )}
        {desktop && viewSwitch}
        {ready && meta.allow_download && (
          <Button asChild variant="ghost" size={desktop ? 'md' : 'icon-md'} aria-label="下载 PDF" title="下载 PDF" data-testid="client-download">
            <a href={pdfUrl} download>
              <Download aria-hidden />
              {desktop && '下载 PDF'}
            </a>
          </Button>
        )}
        {ready && !desktop && canComment && (
          <Button variant="ghost" size="icon-md" aria-label={`批注 ${comments.length} 条`} title={`批注 ${comments.length} 条`} onClick={() => openComposer(null)} data-testid="client-comments-toggle" className="relative">
            <MessageSquareText aria-hidden />
            <Count value={comments.length} tone="brand" className="absolute top-0 right-0" />
          </Button>
        )}
      </header>

      {ready ? (
        <>
          <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_var(--w-companion)]">
            <main aria-label="文稿" className="flex min-h-0 min-w-0 flex-col">
              {!desktop && viewSwitch}
              <div
                className={cn(
                  'flex shrink-0 items-center whitespace-nowrap bg-app text-xs text-fg-muted',
                  desktop ? 'h-pdftb gap-2 border-b border-border px-3' : 'min-h-xs-control gap-card-m px-page-m pb-3',
                )}
                data-testid="client-doctb"
              >
                {view === 'pdf' ? (
                  page.total > 0 ? (
                    <span className="tabular-nums">
                      第 {page.current} / {page.total} 页
                    </span>
                  ) : (
                    <span>PDF</span>
                  )
                ) : (
                  <span>版面</span>
                )}
                <span className="flex-1" />
                {!desktop && meta.expires_at && (
                  <span className={cn('inline-flex items-center gap-inline-m tabular-nums', left != null && left <= 3 ? 'text-danger-fg' : 'text-fg-muted')} data-testid="client-deadline">
                    <Clock className="size-3.5" aria-hidden />
                    {fmtDate(meta.expires_at)} 前{canConfirm ? '确认' : '查看'}
                  </span>
                )}
                {canComment && (
                  <span className="hidden items-center gap-1 lg:inline-flex">
                    <Highlighter className="size-3.5" aria-hidden />
                    选中文字即可批注
                  </span>
                )}
                {!desktop && (
                  <span className="inline-flex items-center gap-inline-m tabular-nums">
                    <MessageSquareText className="size-3.5" aria-hidden />
                    批注 {comments.length}
                  </span>
                )}
              </div>
              {meta.pending_revisions > 0 && (
                <p
                  role="status"
                  className={cn('flex shrink-0 items-start gap-1.5 bg-warn-bg text-xs leading-5 text-warn-fg', desktop ? 'border-b border-border px-3 py-1.5' : 'px-page-m py-2')}
                  data-testid="client-pending-notice"
                  data-baseline={meta.baseline}
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    {meta.baseline === 'final'
                      ? `本审阅版含 ${meta.pending_revisions} 处代理师尚未确定的修改建议（已按接受显示）；确认前请以代理师最终定稿为准。`
                      : `代理师尚有 ${meta.pending_revisions} 处修改建议待处理；本审阅版只显示已确定的正文。`}
                  </span>
                </p>
              )}

              <div ref={mainRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-paper-canvas" data-testid="client-main" data-view={view}>
                <div className="mx-auto h-full w-full max-w-page">
                  {view === 'pdf' ? (
                    <ClientPdfView url={pdfUrl} ready={meta.pdf_ready} onPage={onPage} />
                  ) : (
                    <Suspense fallback={<Skeleton className="mx-auto mt-8 h-[60vh] w-full max-w-page" />}>
                      <ClientLayoutView ast={ast} css={css} onPickBlock={onPickBlock} pickedId={pickedId} subExcept={meta.sub_except} />
                    </Suspense>
                  )}
                </div>
                {watermark}
                {pending && (
                  <div className="absolute z-panel -translate-x-1/2 -translate-y-full pb-2" style={{ top: pending.top, left: pending.left }}>
                    <Button size={desktop ? 'sm' : 'lg'} className="shadow-lg" onClick={() => openComposer(pending.anchor)} data-testid="client-selection-comment">
                      <MessageSquarePlus aria-hidden />
                      有意见
                    </Button>
                  </div>
                )}
              </div>
            </main>

            <aside aria-label="批注" className="hidden min-h-0 flex-col border-l border-border bg-panel lg:flex" data-testid="client-side">
              <div className="flex h-row shrink-0 items-center gap-2 border-b border-border px-4 text-sm font-medium text-fg-strong">
                <MessageSquareText className="size-4 text-fg-icon" aria-hidden />
                批注
                <span className="text-xs font-normal text-fg-muted tabular-nums">{comments.length} 条 · {openCount} 待处理</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-xs" data-testid="client-side-meta">
                <dt className="text-fg-subtle">状态</dt>
                <dd className="text-fg">
                  <StatusDot status={meta.status} size="sm" />
                </dd>
                <dt className="text-fg-subtle">截止</dt>
                <dd className="text-fg">
                  {meta.expires_at ? (
                    <Countdown daysLeft={left} size="md" date={`${fmtDate(meta.expires_at)} 前${canConfirm ? '确认定稿' : '查看'}`} className="[&>[data-slot=countdown-value]]:text-sm" />
                  ) : (
                    '长期有效'
                  )}
                </dd>
                <dt className="text-fg-subtle">权限</dt>
                <dd className="text-fg">{permissionText(meta)}</dd>
              </dl>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <CommentThreads comments={comments} canComment={canComment} />
              </div>
            </aside>
          </div>

          <footer aria-label="确认操作" className="z-sticky shrink-0 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)]" data-testid="client-actionbar">
            <div className="flex h-action-bar items-center gap-group-m px-page-m md:gap-3 md:px-4">
              {confirmedThis && meta.confirmation ? (
                <p className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg" data-testid="client-confirmed">
                  <CheckCircle2 className="size-4 shrink-0 text-ok-dot" aria-hidden />
                  <span className="flex min-w-0 flex-col md:flex-row md:items-baseline md:gap-1">
                    <span className="truncate font-medium text-fg-strong" title={meta.confirmation.name}>{meta.confirmation.name}</span>
                    <span className="truncate text-xs text-fg-muted md:text-sm md:text-fg">
                      已于 {fmtDateTime(meta.confirmation.confirmed_at)} 确认 v{meta.confirmation.version}
                    </span>
                  </span>
                </p>
              ) : meta.scope === 'read' ? (
                <p className="flex-1 text-sm text-fg-muted" data-testid="client-readonly-hint">此链接仅供阅读；如有意见请直接联系代理师。</p>
              ) : meta.confirmation ? (
                <p className="hidden min-w-0 flex-1 truncate text-xs text-fg-muted md:block" data-testid="client-confirmed-old">
                  v{meta.confirmation.version} 已于 {fmtDateTime(meta.confirmation.confirmed_at)} 确认，本版 v{meta.version} 有更新
                </p>
              ) : (
                <p className="hidden min-w-0 flex-1 truncate text-xs text-fg-muted md:block">
                  {!desktop && openCount > 0 ? `${openCount} 条批注待代理师处理 · ` : ''}
                  {canConfirm ? '确认定稿后代理师将进入递交流程；仍可继续批注。' : '意见会实时同步给代理师。'}
                </p>
              )}
              {canComment && (
                <Button
                  variant={!desktop && !(canConfirm && !confirmedThis) ? 'default' : 'secondary'}
                  size="lg"
                  className={cn(!desktop && (confirmedThis ? 'shrink-0' : 'flex-1'))}
                  onClick={() => openComposer(null)}
                  data-testid="client-comment"
                >
                  <MessageSquarePlus aria-hidden />
                  有意见
                  {!desktop && comments.length > 0 && <span className="tabular-nums">({comments.length})</span>}
                </Button>
              )}
              {canConfirm && !confirmedThis && (
                <Button size="lg" className={cn('md:min-w-40', !desktop && 'flex-1')} onClick={() => setConfirmOpen(true)} data-testid="client-confirm">
                  <CheckCircle2 aria-hidden />
                  确认定稿
                </Button>
              )}
            </div>
          </footer>

          <CommentSheet
            open={composer.open}
            onOpenChange={(open) => setComposer((c) => ({ ...c, open }))}
            anchor={composer.anchor}
            comments={comments}
            guestName={guestName}
            onGuestName={(n) => st().setGuestName(n)}
            onSubmit={async (body) => {
              const whole = anchorForBlock(ast, 'title')
              const anchor = composer.anchor ?? (whole && { ...whole, quote: '' })
              if (!anchor) return false
              const ok = await st().addPublicComment({ anchor, body })
              if (ok) {
                toast('意见已发送给代理师', 'success')
                clearPick()
              }
              return ok
            }}
          />
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            version={meta.version}
            guestName={guestName}
            onGuestName={(n) => st().setGuestName(n)}
            onConfirm={async (note) => {
              const ok = await st().confirmPublic(note)
              if (ok) toast(`已确认定稿 v${meta.version}`, 'success')
              return ok
            }}
          />
        </>
      ) : (
        <main className="row-span-2 flex min-h-0 items-start justify-center overflow-y-auto bg-paper-canvas p-4" data-testid="client-main">
          {loading || (!error && !meta) ? (
            <div className="flex w-full max-w-sm flex-col gap-4 pt-6" data-testid="client-loading" role="status" aria-label="正在打开审阅链接">
              <Skeleton className="h-8 w-40 self-center" />
              <Skeleton className="aspect-[210/297] w-full bg-paper shadow-paper" />
            </div>
          ) : expired ? (
            <EmptyState icon={Clock} title="链接已过期，请联系代理师" reason="审阅链接已过期或已被撤销；如需继续查看，请让代理师重新发送链接。" className="pt-10" data-testid="client-expired" />
          ) : invalid ? (
            <EmptyState icon={Link2Off} title="链接失效" reason="这个审阅链接不存在或已被删除；请核对链接是否完整，或让代理师重新发送。" className="pt-10" data-testid="client-invalid" />
          ) : unavailable ? (
            <EmptyState icon={FileCheck2} title={NOT_IMPLEMENTED_TITLE} reason="客户审阅链接尚未在此部署开放，请联系代理师获取文件。" className="pt-10" data-testid="client-unavailable" />
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title="无法打开审阅链接"
              reason={error ?? '请检查链接是否完整，或联系代理师。'}
              className="pt-10"
              data-testid="client-error"
              action={
                <Button variant="secondary" size={desktop ? 'md' : 'xl'} onClick={() => void st().openPublic(token)} data-testid="client-retry">
                  <RefreshCw aria-hidden />
                  重试
                </Button>
              }
            />
          )}
        </main>
      )}
      <Toasts />
    </div>
  )
}
