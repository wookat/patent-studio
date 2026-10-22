import { Check, ChevronLeft, ChevronRight, Copy, Download, Eraser, FileCode2, FileText, Trash2 } from 'lucide-react'
import { CheckPanel } from '@/components/problems/CheckPanel'
import { useNamedLandmarkHost } from '@/components/ui/landmark-host'
import { OaPanel } from '@/components/oa/OaPanel'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { api } from '@/lib/api'
import { FOCUS_RING, cn, touchHit } from '@/lib/utils'
import { selectDevUser, useStudio } from '@/store'
import { ConsoleEntry } from './ConsoleEntry'
import { ConsoleSummary } from './ConsoleSummary'
import { ConsoleTabs } from './ConsoleTabs'
import { fmtClock } from '@/lib/format'
import { filterItems } from './consoleUtils'
import { formatDiagnostics } from './fixParser'
import { useCopied } from '@/hooks/useMisc'
import { copyText } from '@/lib/download'

const ICON_BTN = cn(
  'inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg-strong disabled:pointer-events-none disabled:opacity-40',
  FOCUS_RING,
)

/** 右侧 24px 图标：复制全部 / 清空客户端诊断（伴随栏面板头 actions 槽复用；触控视觉 sm 32、touch-hit 命中 44，相邻间距 12） */
export function ConsoleHeaderActions({ mobile = false }: { mobile?: boolean }) {
  const iconBtn = cn(ICON_BTN, touchHit, 'in-data-[density=touch]:size-sm-control', mobile && 'size-sm-control [&_svg]:size-4')
  const consoleTab = useStudio((s) => s.consoleTab)
  const items = useStudio((s) => s.items)
  const clientItems = useStudio((s) => s.clientItems)
  const setClient = useStudio((s) => s.setClient)
  const toast = useStudio((s) => s.toast)
  const [copied, markCopied] = useCopied()
  const visible = filterItems(items, consoleTab)

  const copyAll = async () => {
    if (await copyText(formatDiagnostics(visible))) {
      markCopied(true)
      toast(`已复制 ${visible.length} 条诊断`, 'success')
    } else {
      toast('复制失败：浏览器未授予剪贴板权限', 'error')
    }
  }

  return (
    <div className={cn('ml-auto flex items-center gap-0.5 in-data-[density=touch]:gap-3', mobile && 'gap-3')}>
      <button type="button" className={iconBtn} onClick={() => void copyAll()} disabled={visible.length === 0} aria-label="复制全部诊断" title="复制全部" data-testid="console-copy-all">
        {copied ? <Check className="size-3.5 text-ok-fg" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      <button
        type="button"
        className={iconBtn}
        onClick={() => {
          setClient([])
          toast('已清空编辑器即时诊断', 'info')
        }}
        disabled={clientItems.length === 0}
        aria-label="清空客户端诊断"
        title="清空客户端诊断（编辑器即时规则）"
        data-testid="console-clear-client"
      >
        <Eraser className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** 顶部 32px：← 返回预览（桌面）· 右侧图标动作；移动端 44px 高 */
export function ConsoleHeader({ variant }: { variant: 'desktop' | 'mobile' }) {
  const mobile = variant === 'mobile'
  const setPdfView = useStudio((s) => s.setPdfView)
  return (
    <div className={cn('flex shrink-0 items-center gap-1 border-b border-border px-1.5 text-xs', mobile ? 'h-11' : 'h-panel-header')} data-testid="console-header">
      {!mobile ? (
        <button
          type="button"
          className={cn('inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-sm font-medium text-fg hover:bg-hover', FOCUS_RING)}
          onClick={() => setPdfView('pdf')}
          title="返回 PDF 预览 (Ctrl+J)"
          data-testid="console-back"
        >
          <ChevronLeft className="size-4" aria-hidden /> 返回预览
        </button>
      ) : (
        <span className="px-1.5 text-sm font-medium">控制台</span>
      )}
      <ConsoleHeaderActions mobile={mobile} />
    </div>
  )
}

function EmptyState() {
  const pid = useStudio((s) => s.pid)
  const netError = useStudio((s) => s.netError)
  const netStatus = useStudio((s) => s.netStatus)
  const lastOkAt = useStudio((s) => s.lastOkAt)
  const hasContent = useStudio((s) => s.content.trim().length > 0)
  const consoleTab = useStudio((s) => s.consoleTab)
  const total = useStudio((s) => s.items.length)
  const label: Record<string, string> = { error: '错误', warning: '警告', info: '提示' }
  let text: string
  if (!pid) text = '尚未打开案卷'
  else if (netError) text = netStatus === 401 || netStatus === 403 ? `权限不足：${netError}` : netStatus ? `请求失败：${netError}` : `无法连接后端：${netError}`
  else if (!hasContent) text = '正文为空 · 从「## 权利要求书」开始撰写'
  else if (total > 0 && consoleTab in label) text = `0 个${label[consoleTab]} · 共 ${total} 个问题`
  else text = `0 个问题 · ${lastOkAt != null ? `上次构建 ${fmtClock(lastOkAt)}` : '尚未构建'}`
  return (
    <p className="px-4 py-6 text-center text-sm text-fg-muted" data-testid="console-empty">
      {text}
    </p>
  )
}

/** tab 内容：诊断列表（含状态横幅）/ 回归检查（CheckPanel）/ OA 答复（OaPanel，轨道 E）；体检与 XML 校验在递交页（W4-E） */
export function ConsoleBody({ className, ...rest }: { className?: string; 'data-bottom-tab'?: string }) {
  const consoleTab = useStudio((s) => s.consoleTab)
  const items = useStudio((s) => s.items)
  const visible = filterItems(items, consoleTab)
  return (
    <div
      {...rest}
      id="console-tabpanel"
      role="tabpanel"
      aria-labelledby={`console-tab-${consoleTab}`}
      className={cn('min-h-0 flex-1 overflow-auto', className)}
      data-testid={`console-body-${consoleTab}`}
    >
      {consoleTab === 'checks' ? (
        <CheckPanel />
      ) : consoleTab === 'oa' ? (
        <OaPanel />
      ) : (
        <>
          <ConsoleSummary />
          {visible.length === 0 ? (
            <EmptyState />
          ) : (
            <ul data-testid="console-list" aria-label="诊断列表">
              {visible.map((d) => <ConsoleEntry key={d.id} item={d} />)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** 底部 28px：清除构建缓存 · 其他输出文件 ▸（DOCX / PDF / XML zip 直链）；移动端 52px 高，次级按钮视觉 md 36 + touch-hit 44（06 §2） */
export function ConsoleFooter({ variant = 'desktop' }: { variant?: 'desktop' | 'mobile' }) {
  const mobile = variant === 'mobile'
  const btnSize = mobile ? cn(touchHit, 'h-md-control px-3 text-sm') : 'h-xs px-2'
  const pid = useStudio((s) => s.pid)
  const lastOk = useStudio((s) => s.lastOk)
  const xml = useStudio((s) => s.xmlResult)
  const phase = useStudio((s) => s.phase)
  const resetBuild = useStudio((s) => s.resetBuild)
  const devUser = useStudio(selectDevUser)
  const enqueue = useStudio((s) => s.enqueue)
  const toast = useStudio((s) => s.toast)
  const buildId = lastOk?.build_id ?? null
  const busy = phase === 'building' || phase === 'queued'
  const zip = xml?.status === 'ok' ? xml.zip_url : null

  const clearCache = () => {
    resetBuild()
    toast('已清除构建缓存，正在重新构建', 'info')
    enqueue('manual', true)
  }

  return (
    <div className={cn('flex shrink-0 items-center justify-end gap-2 border-t border-border px-2 text-xs', mobile ? 'h-13' : 'h-panel-header')} data-testid="console-footer">
      {devUser && (
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border border-border text-danger-fg hover:bg-danger-bg disabled:opacity-50',
            FOCUS_RING,
            btnSize,
          )}
          onClick={clearCache}
          disabled={!pid || busy}
          title="丢弃缓存的 DOCX / PDF 并重新构建（维护向）"
          data-testid="console-clear-cache"
        >
          <Trash2 className="size-3" aria-hidden /> 清除构建缓存
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn('inline-flex items-center gap-1 rounded-sm border border-border text-fg hover:bg-hover disabled:opacity-50', FOCUS_RING, btnSize)}
            disabled={!pid}
            data-testid="console-outputs"
          >
            其他输出文件 <ChevronRight className="size-3" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem asChild disabled={!buildId}>
            <a href={buildId && pid ? api.exportUrl(pid, 'docx', buildId) : undefined} download data-testid="console-out-docx">
              <FileText className="size-3.5" /> DOCX
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild disabled={!buildId}>
            <a href={buildId && pid ? api.exportUrl(pid, 'pdf', buildId) : undefined} download data-testid="console-out-pdf">
              <Download className="size-3.5" /> PDF
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild disabled={!zip}>
            <a href={zip ?? undefined} download data-testid="console-out-xml">
              <FileCode2 className="size-3.5" /> XML zip{!zip && <span className="ml-auto text-2xs text-fg-muted">未导出</span>}
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * 控制台（05 §3.5；prototype-c s3 伴随栏 console）：
 *   [32] ← 返回预览 ……… 复制全部 · 清空客户端诊断（variant='companion' 时由 CompanionPanel 面板头 + actions 槽承担，本行不渲染）
 *   [32] 全部 N / 错误 N / 警告 N / 提示 N ｜ 回归检查 / OA 答复 ……… 递交页 ↗（下划线 Tabs）
 *   [1fr] ConsoleSummary + ConsoleEntry 列表 / CheckPanel / OaPanel
 *   [32] 清除构建缓存 · 其他输出文件 ▸
 * variant='mobile'：去掉「返回预览」，tabs 横向可滚（MobileConsole 全屏复用，它自己的首行已带复制 / 清空 → header={false}）。
 */
export function ConsolePanel({
  variant = 'desktop',
  header = true,
  className,
}: {
  variant?: 'desktop' | 'mobile' | 'companion'
  header?: boolean
  className?: string
}) {
  const footerVariant = variant === 'mobile' ? 'mobile' : 'desktop'
  const hosted = useNamedLandmarkHost()
  return (
    <section
      data-slot="ConsolePanel"
      data-testid="console-panel"
      data-variant={variant}
      className={cn('flex h-full min-h-0 flex-col bg-panel text-fg', className)}
      aria-label={hosted ? undefined : variant === 'desktop' ? '控制台' : '问题与诊断'}
    >
      {variant !== 'companion' && header && <ConsoleHeader variant={variant} />}
      <div
        className={cn(
          'shrink-0 border-b border-border',
          variant === 'mobile' ? 'h-touch' : 'h-panel-header in-data-[density=touch]:h-auto in-data-[density=touch]:min-h-touch',
          variant === 'mobile' &&
            'overflow-x-auto overflow-y-hidden pl-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_[role=tab]]:min-h-touch [&_[role=tab]]:px-3 [&_[role=tab]]:text-sm',
        )}
        data-testid={variant === 'mobile' ? 'mobile-console-tabs' : undefined}
      >
        <ConsoleTabs className="h-full" scroll={variant === 'mobile' ? 'bar' : 'tabs'} />
      </div>
      <ConsoleBody className={variant === 'mobile' ? '[&_[data-testid=console-entry]]:py-2.5' : undefined} />
      <ConsoleFooter variant={footerVariant} />
    </section>
  )
}
