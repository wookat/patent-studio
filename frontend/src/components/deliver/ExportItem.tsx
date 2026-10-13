import { CircleCheck, Download, FileCode2, FileImage, FileText, Loader2, Package, RefreshCw, XCircle } from 'lucide-react'
import { fmtBytes, fmtDateTimeIso } from '@/lib/format'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EXPORT_LABEL, type ExportEntry, type ExportKind } from '@/types/deliver'

const ICON: Record<ExportKind, ReactNode> = {
  docx: <FileText aria-hidden />,
  pdf: <FileText aria-hidden />,
  xml: <FileCode2 aria-hidden />,
  tracked: <FileText aria-hidden />,
  figures: <FileImage aria-hidden />,
  bundle: <Package aria-hidden />,
}

const HINT: Record<ExportKind, string> = {
  docx: '上次成功构建的 Word 文件',
  pdf: 'LibreOffice 转换的 PDF',
  xml: '五书 XML + 本地 DTD 校验（通过 ≠ 受理）',
  tracked: '审阅修订以 Word 修订形式导出；每次下载按当前正文重新生成',
  figures: '全部附图；下载时打包',
  bundle: '以上全部 + manifest.json，一个 zip',
}

/** 21 §1.3 A12：XML 与递交包只经本地 DTD 校验，未经 CNIPA CPC 客户端验证，角标常显，不随状态变 */
export const CPC_UNVERIFIED = '未经 CPC 客户端验证'
export const CPC_BADGE_KINDS: ReadonlySet<ExportKind> = new Set<ExportKind>(['xml', 'bundle'])

/** 重新生成动作（无 ⇒ 该项没有独立的生成步骤：修订版 / 附图下载即生成）；run 缺省 ⇒ 只反映状态不出按钮（bundle 的按钮在网格头部） */
export interface Regen {
  run?(): void
  running: boolean
  /** 上次生成失败的原因；有值时格子进入 error 态 */
  error?: string | null
  /** 失败原因右侧的动作（如 XML 内容错误的「定位」按钮） */
  errorAction?: ReactNode
}

export type ExportItemState = 'missing' | 'ready' | 'running' | 'error'

/** 导出项状态机：running（生成中）> error（上次失败）> ready（有可下载地址）> missing */
export function itemState(href: string | null, regen?: Regen): ExportItemState {
  if (regen?.running) return 'running'
  if (regen?.error) return 'error'
  return href !== null ? 'ready' : 'missing'
}

export interface ExportItemProps {
  entry: ExportEntry
  /** 有产物可下载时的 URL（清单 url 或前端现成 URL） */
  href: string | null
  onDownload(href: string): void
  /** 正在下载的 href；命中本项时按钮转圈 */
  downloading?: string | null
  regen?: Regen
  /** 展开区（XML 卡片放交付报告） */
  detail?: ReactNode
  mobile?: boolean
  /** 三主行 / 递交包：标题 14px 500 + 图标底色随就绪态 */
  emphasis?: boolean
  className?: string
}

const STATE_LABEL: Record<ExportItemState, string> = { missing: '尚未生成', ready: '就绪', running: '正在生成…', error: '生成失败' }

/**
 * 导出产物一行（05 §4 S7）：图标 32 + 名称 / 说明 + 状态（点 + 文字：就绪 / 尚未生成 / 生成中 / 失败）+ 时间 · 大小 + 「重新生成」ghost「下载」secondary。
 * 一行 56 高；375 `mobile`（06 §3.1）= 一张 p-card-m 16 卡，卡内行间 gap-group-m 8，动作行两个 md 36 等宽。行内永不出现 primary。无产物 ⇒ 下载禁用；
 * 生成中 ⇒ 两个按钮都禁用并转圈；失败 ⇒ 行内 danger 原因（不弹层），上次成功的旧产物仍可下载（时间·大小标明是旧的）。
 */
export function ExportItem({ entry, href, onDownload, downloading = null, regen, detail, mobile = false, emphasis = false, className }: ExportItemProps) {
  const state = itemState(href, regen)
  const ready = href !== null && state !== 'running'
  const isDownloading = downloading !== null && downloading === href
  const label = entry.label || EXPORT_LABEL[entry.kind]
  const btnSize = mobile ? 'md' : 'sm'
  return (
    <li
      data-slot="ExportItem"
      data-testid={`export-item-${entry.kind}`}
      data-kind={entry.kind}
      data-ready={href !== null}
      data-state={state}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2',
        mobile ? 'rounded-md border border-border bg-panel p-card-m' : 'min-h-14 px-4 py-2',
        detail && 'col-span-full',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-md-control shrink-0 items-center justify-center rounded-sm [&_svg]:size-4',
          state === 'ready' ? 'bg-primary-soft text-link' : state === 'error' ? 'bg-danger-bg text-danger-fg' : 'bg-sunken text-fg-muted',
        )}
        aria-hidden
      >
        {state === 'running' ? <Loader2 className="animate-spin" /> : ICON[entry.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('flex flex-wrap items-center text-sm', mobile ? 'gap-2' : 'gap-1.5')}>
          <span className={cn('truncate', emphasis ? 'font-medium text-fg-strong' : 'text-fg')} title={label}>{label}</span>
          {CPC_BADGE_KINDS.has(entry.kind) && (
            <Badge tone="warn" data-testid={`export-cpc-${entry.kind}`}>
              {CPC_UNVERIFIED}
            </Badge>
          )}
        </div>
        <div className="truncate text-xs text-fg-muted">{HINT[entry.kind]}</div>
      </div>
      <div className={cn('flex items-center gap-x-2 text-xs tabular-nums text-fg-muted', mobile ? 'basis-full' : 'shrink-0')} data-testid="export-item-meta">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap font-medium',
            state === 'ready' ? 'text-ok-fg' : state === 'error' ? 'text-danger-fg' : 'text-fg-muted',
          )}
          data-testid="export-item-state"
        >
          {state === 'ready' ? <CircleCheck className="size-3.5" aria-hidden /> : <span className={cn('size-2 rounded-full', state === 'error' ? 'bg-danger-dot' : 'bg-fg-disabled')} aria-hidden />}
          {STATE_LABEL[state]}
        </span>
        {state !== 'running' && entry.at && <span className="whitespace-nowrap">· {fmtDateTimeIso(entry.at)}</span>}
        {entry.size != null && <span className="whitespace-nowrap">· {fmtBytes(entry.size)}</span>}
      </div>
      <div className={cn('flex items-center gap-2', mobile ? 'basis-full [&>*]:flex-1' : 'shrink-0')} data-testid="export-item-actions">
        {regen?.run && (
          <Button
            variant="ghost"
            size={btnSize}
            disabled={state === 'running'}
            onClick={regen.run}
            aria-label={`重新生成 ${label}`}
            title="重新生成"
            data-testid={`export-regen-${entry.kind}`}
          >
            <RefreshCw className={cn(state === 'running' && 'animate-spin')} aria-hidden />
            {mobile && '重新生成'}
          </Button>
        )}
        <Button
          variant="secondary"
          size={btnSize}
          disabled={!ready || (downloading !== null && !isDownloading)}
          loading={isDownloading}
          loadingLabel="正在下载"
          onClick={() => href && onDownload(href)}
          aria-label={`下载 ${label}`}
          data-testid={`export-download-${entry.kind}`}
        >
          <Download aria-hidden /> 下载
        </Button>
      </div>
      {state === 'error' && regen?.error && (
        <p className="flex basis-full items-start gap-1.5 text-xs text-danger-fg" role="alert" data-testid="export-item-error">
          <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{regen.error}</span>
          {regen.errorAction && <span className="shrink-0">{regen.errorAction}</span>}
        </p>
      )}
      {detail && (
        <div className="basis-full" data-testid="export-item-detail">
          {detail}
        </div>
      )}
    </li>
  )
}
