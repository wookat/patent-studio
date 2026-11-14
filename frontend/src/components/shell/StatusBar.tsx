import { useMemo, type HTMLAttributes, type ReactNode } from 'react'
import { fmtMs } from '@/lib/format'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'
import { AlertTriangle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { OutlineNode } from '@/lib/types'
import { splitBooks , BOOK_LABELS } from '@/lib/docset'
import { currentView } from '@/components/workbench/viewSwitchPlan'
import { useStudio, selectDirty, selectSummary, selectAbstractLive, selectErrorCount, selectWarningCount, selectOnlineCount, selectCursorPara, selectReadonly, selectRoleKnown } from '@/store'


/** 光标在 `## 书名` 标题行上 → 该书（空书没有大纲节点，只能按标题行判） */
function bookHeadingAt(content: string, line: number): string | null {
  const split = splitBooks(content)
  for (const b of split.order) if (split.books[b]?.offset === line) return BOOK_LABELS[b]
  return null
}

/** 大纲（F2 写入）→ 光标所在路径；大纲为空时退化为扫描 content 的标题行 */
function sectionPath(outline: OutlineNode[], content: string, line: number): string[] {
  const heading = bookHeadingAt(content, line)
  if (heading) return [heading]
  if (outline.length) {
    const path: string[] = []
    const walk = (nodes: OutlineNode[], trail: string[]) => {
      for (const n of nodes) {
        if (n.line > line) break
        const t = [...trail, n.kind === 'claim' ? `权利要求 ${n.label}` : n.label]
        if (n.kind !== 'title') path.splice(0, path.length, ...t)
        if (n.children?.length) walk(n.children, n.kind === 'title' ? trail : t)
      }
    }
    walk(outline, [])
    return path
  }
  const lines = content.split('\n', line)
  const trail: string[] = []
  let claim: string | null = null
  for (const raw of lines) {
    const m = /^(#{1,4})\s+(.+?)\s*$/.exec(raw)
    if (m) {
      const depth = m[1].length
      if (depth === 1) continue
      trail.splice(depth - 2)
      trail[depth - 2] = m[2]
      claim = null
      continue
    }
    const c = /^(\d+)\s*[.、．]/.exec(raw)
    if (c && trail[0]?.includes('权利要求')) claim = c[1]
  }
  const out = trail.filter(Boolean)
  if (claim) out.push(`权利要求 ${claim}`)
  return out
}

/** 摘要标题行（`## 摘要`），供「摘要」段点击定位 */
function abstractLine(outline: OutlineNode[], content: string): number | null {
  const node = outline.find((n) => n.kind === 'abstract')
  if (node) return node.line
  const i = content.split('\n').findIndex((l) => /^#{1,3}\s*摘要\s*$/.test(l))
  return i >= 0 ? i + 1 : null
}

/** 原型 .status-bar .seg：16px 高、左右 10px、右侧 1px 分隔线 */
function Seg({
  children,
  className,
  title,
  testId,
  onClick,
  last,
  ...rest
}: {
  children: ReactNode
  className?: string
  title?: string
  testId?: string
  onClick?: () => void
  last?: boolean
} & Pick<HTMLAttributes<HTMLElement>, 'aria-live' | 'aria-label' | 'role'>) {
  const cls = cn(
    'inline-flex h-statusbar shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xs px-1.5 leading-none',
    last && 'ml-auto',
    onClick && cn('cursor-pointer hover:bg-hover hover:text-fg', FOCUS_RING_INSET),
    className,
  )
  if (onClick)
    return (
      <button type="button" className={cls} title={title} onClick={onClick} data-testid={testId} {...rest}>
        {children}
      </button>
    )
  return (
    <span className={cls} title={title} data-testid={testId} {...rest}>
      {children}
    </span>
  )
}

const Sep = () => <span className="text-fg-subtle" aria-hidden>·</span>
const Num = ({ children, className }: { children: ReactNode; className?: string }) => <b className={cn('font-medium text-fg', className)}>{children}</b>

type Tone = 'idle' | 'busy' | 'ok' | 'warn' | 'error'
/** 状态点 6px（05 §3.7：点 + 文字，无实底）：语义 --*-dot */
const DOT: Record<Tone, string> = {
  idle: 'bg-fg-subtle',
  busy: 'bg-info-dot motion-safe:animate-pulse-dot',
  ok: 'bg-ok-dot',
  warn: 'bg-warn-dot',
  error: 'bg-danger-dot',
}
const DOT_TEXT: Record<Tone, string> = {
  idle: '',
  busy: 'text-info-fg',
  ok: 'text-ok-fg',
  warn: 'text-warn-fg',
  error: 'text-danger-fg',
}
/** 6px 圆点 */
export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone], className)} aria-hidden data-testid="status-dot" data-tone={tone} />
}

/**
 * 构建状态：就绪 / 构建中 x s / 排队中 / PDF 已就绪 / 构建失败 / 请求失败。
 * 错误与警告的个数只由左邻的体检段（status-health）显示，这里不再重复。
 */
export function useBuildStatus(): { tone: Tone; text: string } {
  const phase = useStudio((s) => s.phase)
  const elapsedMs = useStudio((s) => s.elapsedMs)
  const netError = useStudio((s) => s.netError)
  const netStatus = useStudio((s) => s.netStatus)
  const hasOk = useStudio((s) => s.lastOk !== null)
  const errors = useStudio(selectErrorCount)
  const ok = (): { tone: Tone; text: string } => ({ tone: errors > 0 ? 'warn' : 'ok', text: 'PDF 已就绪' })
  switch (phase) {
    case 'building':
      return { tone: 'busy', text: `构建中 ${fmtMs(elapsedMs)}` }
    case 'queued':
      return { tone: 'busy', text: '排队中' }
    case 'error':
      return { tone: 'error', text: netError ? (netStatus === 401 || netStatus === 403 ? '权限不足' : '请求失败') : '构建失败' }
    case 'ok':
      return ok()
    default:
      return hasOk ? ok() : { tone: 'idle', text: '就绪' }
  }
}

/**
 * 状态栏 24px（05 §3.7；原型 s3 .statusbar）：`--bg-app` 上 1px；11px `--fg-muted` mono 数字；**只有点 + 文字，无实底按钮、无 primary**。
 *   左：光标 `权 3 · L42` → 摘要 `286/300` → 段号 `[0042]` → 页数 · 耗时 · 后端
 *   右：体检 `● 2 错误 · 3 警告`（点 → 伴随栏控制台）→ 协作 `● 2 人在线`（仅顶栏无「分享 · N 在线」时，即 auth=off）→ 构建 `● PDF 已就绪 2.3s` → 保存态
 * 数据源沿用：selectDirty / cursor / selectAbstractLive / selectSummary / lastOk.timings / previewMs / pageInfo / health。
 */
export function StatusBar({ showPage = true }: { showPage?: boolean }) {
  const dirty = useStudio(selectDirty)
  const collabStatus = useStudio((s) => s.collabStatus)
  const readonly = useStudio(selectReadonly)
  const roleKnown = useStudio(selectRoleKnown)
  const reviewer = useStudio((s) => s.project?.role === 'reviewer')
  const cursor = useStudio((s) => s.cursor)
  const outline = useStudio((s) => s.outline)
  const content = useStudio((s) => s.content)
  const abstract = useStudio(useShallow(selectAbstractLive))
  const summary = useStudio(selectSummary)
  const cursorPara = useStudio(selectCursorPara)
  const soffice = useStudio((s) => s.health?.soffice ?? null)
  const view = useStudio((s) => currentView(s).view)
  const phase = useStudio((s) => s.phase)
  const previewMs = useStudio((s) => s.previewMs)
  const page = useStudio((s) => s.pageInfo)
  const pid = useStudio((s) => s.pid)
  const gotoLine = useStudio((s) => s.gotoLine)
  const errors = useStudio(selectErrorCount)
  const warnings = useStudio(selectWarningCount)
  const online = useStudio(selectOnlineCount)
  const authed = useStudio((s) => s.authStatus === 'authed')
  const openCollabCenter = useStudio((s) => s.openCollabCenter)
  const openCompanion = useStudio((s) => s.openCompanion)
  const setConsoleTab = useStudio((s) => s.setConsoleTab)
  const status = useBuildStatus()
  /* 批74：另一页签也在编辑此案（观察器在 shell/DupTabWatch 全局挂） */
  const dupTabOther = useStudio((s) => s.dupTabOther)
  const savedSha = useStudio((s) => s.savedSha)
  const caseContext = useStudio((s) => s.caseContext)

  const section = useMemo(() => sectionPath(outline, content, cursor.line), [outline, content, cursor.line])
  const absLine = useMemo(() => abstractLine(outline, content), [outline, content])
  // 构建失败时留在屏上的 PDF 是上一次成功的旧产物，页数与「构建错误」并列会误导 ⇒ 失败态不显示任何页数
  const pageStale = phase === 'error'
  const showCurrentPage = showPage && !pageStale && page !== null && page.total > 0
  // 页数单源：右侧已显「第 x / y 页」时左侧不再重复总页数；未渲染 PDF 时才用构建摘要的页数
  const pages = showCurrentPage || pageStale ? null : page && page.total > 0 ? page.total : summary?.pages ?? null
  const showPreviewMs = previewMs != null && phase === 'ok'
  const openConsole = (tab: 'error' | 'warning' | 'all') => {
    setConsoleTab(tab)
    openCompanion('console')
  }
  const healthTone: Tone = errors > 0 ? 'error' : warnings > 0 ? 'warn' : 'ok'
  const healthText =
    errors > 0 || warnings > 0 ? [errors > 0 && `${errors} 错误`, warnings > 0 && `${warnings} 警告`].filter(Boolean).join(' · ') : '无问题'
  const claimLabel = section.find((t) => t.startsWith('权利要求 '))

  return (
    <footer
      className="flex h-statusbar min-w-0 items-center gap-0.5 overflow-hidden border-t border-border bg-app px-1.5 text-2xs leading-none text-fg-muted tabular-nums"
      data-slot="StatusBar"
      data-testid="status-bar"
      aria-label="状态栏"
    >
      {pid && view === 'source' && (
        <Seg testId="status-cursor" title={section.length ? `光标所在：${section.join(' › ')}` : '光标位置'}>
          {claimLabel ? <>{claimLabel} <Sep /> </> : section[0] ? <span className="hidden lg:inline">{section[section.length - 1]} <Sep /> </span> : null}
          行 <Num>{cursor.line}</Num><span className="hidden xl:inline">，列 <Num>{cursor.col}</Num></span>
        </Seg>
      )}
      {pid && view !== 'source' && section.length > 0 && (
        <Seg testId="status-section" title={`光标所在：${section.join(' › ')}`}>
          {claimLabel ?? section[section.length - 1]}
        </Seg>
      )}
      {pid && (
        <Seg
          className={cn('font-mono', abstract.over && 'text-danger-fg', abstract.near && 'text-warn-fg')}
          title={
            abstract.over
              ? `摘要超过 ${abstract.limit} 字上限（点击定位到摘要）`
              : abstract.near
                ? `摘要接近 ${abstract.limit} 字上限，还可写 ${abstract.limit - abstract.chars} 字（点击定位到摘要）`
                : '摘要字数（实时，含标点不含空白）；点击定位到摘要'
          }
          testId="status-abstract"
          onClick={absLine ? () => gotoLine(absLine) : undefined}
          aria-live="polite"
        >
          <span className="font-sans">摘要</span> <Num className={cn(abstract.over && 'text-danger-fg', abstract.near && 'text-warn-fg')}>{abstract.chars}</Num>/{abstract.limit}
          {(abstract.over || abstract.near) && <AlertTriangle className="size-3" aria-label={abstract.over ? '超限' : '接近上限'} />}
        </Seg>
      )}
      {summary && (
        <>
          <Seg testId="status-claims" title="权利要求项数（最近一次构建）" className="hidden md:inline-flex">
            权项 <Num>{summary.claims}</Num>
          </Seg>
          <Seg
            testId="status-paragraphs"
            title={cursorPara != null ? `光标所在说明书段号（共 ${summary.paragraphs} 段）` : '说明书末段号（最近一次构建）'}
            className="hidden font-mono md:inline-flex"
            data-cursor-para={cursorPara ?? undefined}
          >
            <Num>[{String(cursorPara ?? summary.paragraphs).padStart(4, '0')}]</Num>
          </Seg>
        </>
      )}
      {pages != null && (
        <Seg testId="status-pages" title="PDF 页数" className="hidden lg:inline-flex">
          <Num>{pages}</Num> 页
        </Seg>
      )}
      {soffice === false && (
        <Seg className="text-danger-fg" testId="status-no-soffice">
          <AlertTriangle className="size-3" />
          未检测到 LibreOffice
        </Seg>
      )}

      <span className="ml-auto" />
      {showCurrentPage && page && (
        <Seg testId="status-page" className="hidden font-mono md:inline-flex">
          第 {page.page} / {page.total} 页
        </Seg>
      )}
      {pid && (
        <Seg
          testId="status-health"
          title={errors > 0 || warnings > 0 ? '体检：点击打开控制台' : '体检：无错误 / 警告'}
          onClick={errors > 0 || warnings > 0 ? () => openConsole(errors > 0 ? 'error' : 'warning') : undefined}
          className={DOT_TEXT[healthTone]}
          aria-live="polite"
        >
          <Dot tone={healthTone} />
          {healthText}
        </Seg>
      )}
      {online !== null && collabStatus !== 'off' && !authed && (
        <Seg testId="status-online" title={`${collabStatus === 'connected' ? '协同已连接' : collabStatus === 'reconnecting' ? '重连中' : '连接协同…'}：点击打开协同中心`} onClick={() => openCollabCenter('members')}>
          <Dot tone={collabStatus === 'connected' ? 'ok' : collabStatus === 'reconnecting' ? 'warn' : 'busy'} />
          {online} 人在线
        </Seg>
      )}
      {/* 批74：协同连接时 Yjs 合并无冲突不告警；未连时双端各 PUT 互相覆盖——明示关一签 */}
      {dupTabOther && collabStatus !== 'connected' && (
        <Seg testId="status-duptab" title="此案卷在另一个浏览器页签打开——协同未连接时双端保存会互相覆盖，请关闭其一" className="text-warn-fg">
          <Dot tone="warn" />
          另一页签也在编辑
        </Seg>
      )}
      <Seg
        testId="status-build"
        title={status.tone === 'error' ? '构建失败：点击打开控制台' : showPreviewMs ? '停止输入 → 预览画完（含防抖、网络、渲染）' : undefined}
        onClick={status.tone === 'error' || status.tone === 'warn' ? () => openConsole(status.tone === 'error' ? 'error' : 'all') : undefined}
        className={DOT_TEXT[status.tone]}
        aria-live="polite"
      >
        <Dot tone={status.tone} />
        {status.text}
        {showPreviewMs && (
          <span className="hidden font-mono xl:inline" data-testid="preview-e2e">
            {fmtMs(previewMs)}
          </span>
        )}
      </Seg>
      {pid && savedSha && (
        <Seg
          testId="status-version"
          className="hidden md:inline-flex"
          title={
            caseContext?.binding === 'bound'
              ? `稿件内容版本（sha256 前缀）；已绑定平台案 ${caseContext.case_id}（${caseContext.organization?.name ?? ''}）`
              : caseContext?.binding === 'ambiguous'
                ? `稿件内容版本；案号在平台命中 ${caseContext.candidates ?? '多'} 个机构同号案——已按歧义拒绝绑定`
                : caseContext?.binding === 'denied'
                  ? '稿件内容版本；平台绑定被拒绝（当前身份无权访问该案）'
                  : '稿件内容版本（sha256 前缀）；本地案卷，未绑定平台案'
          }
        >
          {caseContext?.binding === 'bound' && <span className="hidden xl:inline text-fg-subtle">平台·</span>}
          {caseContext?.binding === 'ambiguous' && <span className="text-warn-fg" data-testid="status-binding-ambiguous">歧义·</span>}
          {caseContext?.binding === 'denied' && <span className="text-danger-fg" data-testid="status-binding-denied">拒·</span>}
          <span className="font-mono">稿 {savedSha.slice(0, 8)}</span>
        </Seg>
      )}
      <Seg testId="status-right">
        {pid && readonly && !roleKnown ? (
          <span data-testid="status-loading">加载中…</span>
        ) : pid && readonly ? (
          <span data-testid="status-readonly">
            {reviewer ? '审阅 · 版面视图键入即建议' : collabStatus === 'connected' ? '只读 · 实时跟随' : '只读'}
          </span>
        ) : collabStatus === 'connected' ? (
          // R8（11 §6.3）：协同中写盘由服务端去抖完成，本地 dirty 只表示“构建待跑”
          <span data-testid="status-saved">协同自动保存</span>
        ) : collabStatus === 'reconnecting' ? (
          <span className="inline-flex items-center gap-1.5 text-warn-fg" data-testid="status-dirty">
            <Dot tone="warn" />
            重连中，本地暂存
          </span>
        ) : dirty ? (
          <span className="inline-flex items-center gap-1.5 text-warn-fg" data-testid="status-dirty">
            <Dot tone="warn" />
            未保存
          </span>
        ) : (
          <span data-testid="status-saved">已保存</span>
        )}
      </Seg>
    </footer>
  )
}
