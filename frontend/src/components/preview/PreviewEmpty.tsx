import type { ReactNode } from 'react'
import { FileText, FolderOpen, Hammer, RefreshCw, AlertTriangle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useStudio, selectErrorCount } from '@/store'

/**
 * 预览空态（05 §2.7 EmptyState，画布 bg-paper-canvas）：尚无成功构建的 PDF。
 * 按 build.phase 分三种叙事：首构建中（纸面骨架 + 不定进度）/ 构建失败（错误数 + 查看问题）/ 未打开案子或未编辑（引导）。
 * 动作一律 secondary / soft —— PDF 区没有 primary（构建在顶栏）。
 */
export function PreviewEmpty() {
  const phase = useStudio((s) => s.phase)
  const pid = useStudio((s) => s.pid)
  const netError = useStudio((s) => s.netError)
  const netStatus = useStudio((s) => s.netStatus)
  const denied = netStatus === 401 || netStatus === 403
  const errorCount = useStudio(selectErrorCount)
  const enqueue = useStudio((s) => s.enqueue)
  const openBottom = useStudio((s) => s.openBottom)
  const setMobileTab = useStudio((s) => s.setMobileTab)

  if (phase === 'building' || phase === 'queued') {
    return (
      <div data-slot="PreviewEmpty" data-state="building" className="relative h-full overflow-hidden bg-paper-canvas p-4">
        <PreviewLoading label="正在生成首个 PDF…" hint="DOCX → LibreOffice → PDF，首次约需数秒" />
      </div>
    )
  }

  if (phase === 'error' || netError) {
    return (
      <EmptyShell
        data-state="error"
        icon={AlertTriangle}
        tone="danger"
        title={netError ? (denied ? '没有构建权限' : netStatus ? '构建请求失败' : '无法连接构建服务') : '构建失败，尚无可预览的 PDF'}
        desc={
          netError
            ? denied
              ? `${netError}。请联系案子所有者提升角色，或重新登录。`
              : netStatus
                ? netError
                : '请确认后端 :8000 已启动后重试。'
            : `当前 ${errorCount} 个错误。修复后会自动重试，或立即重新构建。`
        }
      >
        {!netError && errorCount > 0 && (
          <Button size="sm" variant="secondary" onClick={() => openBottom('problems')}>
            查看问题
          </Button>
        )}
        <Button size="sm" variant="soft" onClick={() => enqueue('manual', true)}>
          <RefreshCw /> 立即构建
        </Button>
      </EmptyShell>
    )
  }

  if (!pid) {
    return (
      <EmptyShell
        data-state="no-project"
        icon={FolderOpen}
        title="尚未打开案子"
        desc="从左上角「案子」菜单选择 examples/method 或 examples/system，打开后自动生成 PDF 预览。"
      />
    )
  }

  return (
    <EmptyShell data-state="idle" icon={FileText} title="尚无 PDF 预览" desc="开始编辑正文，停顿 0.4 s 后自动构建；也可以现在立即构建一次。">
      <Button size="sm" variant="secondary" className="lg:hidden" onClick={() => setMobileTab('edit')}>
        去编辑
      </Button>
      <Button size="sm" variant="soft" onClick={() => enqueue('manual', true)}>
        <Hammer /> 立即构建
      </Button>
    </EmptyShell>
  )
}

function EmptyShell({
  icon,
  tone,
  title,
  desc,
  children,
  ...rest
}: {
  icon: LucideIcon
  tone?: 'danger'
  title: string
  desc: string
  children?: ReactNode
  'data-state': string
}) {
  return (
    <div data-slot="PreviewEmpty" {...rest} className="flex h-full flex-col items-center justify-center bg-paper-canvas">
      <EmptyState
        size="sm"
        icon={icon}
        title={title}
        reason={desc}
        className={cn(tone === 'danger' && '[&_[data-slot=empty-state-icon]]:bg-danger-bg [&_[data-slot=empty-state-icon]]:text-danger-fg')}
        action={children ? <div className="flex flex-wrap items-center justify-center gap-2">{children}</div> : undefined}
      />
    </div>
  )
}

/**
 * 加载骨架：一张 A4 比例的"纸"（--paper 恒白）占位 + 若干灰条 + 顶部不定进度条，宽度跟随当前缩放，避免 PDF 到达时跳动。
 */
export function PreviewLoading({
  pageWidth,
  label = '正在加载 PDF…',
  hint,
  className,
}: {
  pageWidth?: number
  label?: string
  hint?: string
  className?: string
}) {
  const w = pageWidth ? Math.min(pageWidth, 560) : undefined
  return (
    <div
      data-slot="PreviewLoading"
      role="status"
      aria-live="polite"
      className={cn('mx-auto flex w-full flex-col items-center', className)}
      style={w ? { maxWidth: w } : { maxWidth: 560 }}
    >
      <div className="relative w-full overflow-hidden rounded-xs bg-paper text-paper-fg shadow-paper" style={{ aspectRatio: '210 / 297' }}>
        <Progress label={label} className="absolute inset-x-0 top-0 h-0.5 rounded-none" />
        <div className="absolute inset-0 motion-safe:animate-pulse p-[10%]">
          <div className="mx-auto mb-[8%] h-[3%] w-1/2 rounded-xs bg-paper-fg/10" />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="mb-[3.5%] h-[1.8%] rounded-xs bg-paper-fg/10" style={{ width: `${[100, 96, 88, 100, 92, 70, 100, 94, 60][i]}%` }} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-[8%] flex flex-col items-center gap-1 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2.5 py-1 text-fg shadow-sm">
            <RefreshCw className="size-3 motion-safe:animate-spin" aria-hidden />
            {label}
          </span>
          {hint && <span className="rounded-full bg-elevated px-2 py-0.5 text-2xs text-fg-muted">{hint}</span>}
        </div>
      </div>
    </div>
  )
}
