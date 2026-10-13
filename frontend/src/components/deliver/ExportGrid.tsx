import type { ReactNode } from 'react'
import { Package } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { gridEntries } from '@/store/deliver'
import type { DeliverManifest, ExportEntry, ExportKind } from '@/types/deliver'
import { ExportItem, itemState, type Regen } from './ExportItem'

export { gridEntries }

export interface ExportGridProps {
  manifest: DeliverManifest | null
  loading: boolean
  /** 后端 501（E1 未落地）：六行仍渲染，生成按钮禁用 */
  unavailable: boolean
  error: string | null
  bundleRunning: boolean
  /** 独立使用（无 PageHeader 的容器）时把「生成递交包」放在卡头；递交页不传，primary 由 PageHeader / 底栏持有 */
  onBundle?(): void
  /** 不依赖清单也能给出的下载地址（DOCX / PDF / 修订版 / 附图 zip）；清单 url 优先 */
  fallbackHref: Partial<Record<ExportKind, string | null>>
  /** 各项「重新生成」：docx/pdf → 构建；xml → 导出 XML；bundle → 全部打包；修订版 / 附图下载即生成，无此项 */
  regen?: Partial<Record<ExportKind, Regen>>
  /** 各项展开区（XML 行放交付报告） */
  detail?: Partial<Record<ExportKind, ReactNode>>
  onDownload(href: string): void
  /** 正在下载的 href（一次只下一个） */
  downloading?: string | null
  mobile?: boolean
  className?: string
}

const MAIN: readonly ExportKind[] = ['docx', 'pdf', 'xml']

/**
 * S7 导出产物（05 §4 S7 / prototype s7-deliver）：一张卡，DOCX · PDF · XML 三主行（56 高）+ 修订版 / 附图两辅行 + 递交包一行；
 * 行内只有 secondary「下载」与 ghost「重新生成」，页面唯一 primary「生成递交包」在 PageHeader / 移动底栏（不在这里）。
 * 顶部进度条 = 已就绪产物 / 全部；清单 501 ⇒ info Alert；请求失败 ⇒ danger Alert。
 * 375 `mobile`（06 §3.1 / prototype-w8-mobile 04）：区块头（标题 · 就绪数 · 进度）+ 每产物一张 p-card-m 16 卡，卡间 gap-cards-m 12。
 */
export function ExportGrid({ manifest, loading, unavailable, error, bundleRunning, onBundle, fallbackHref, regen = {}, detail = {}, onDownload, downloading = null, mobile = false, className }: ExportGridProps) {
  const entries = gridEntries(manifest)
  const bundle = entries.find((e) => e.kind === 'bundle')!
  const main = MAIN.map((k) => entries.find((e) => e.kind === k)!)
  const aux = entries.filter((e) => e.kind !== 'bundle' && !MAIN.includes(e.kind))
  const hrefOf = (e: ExportEntry) => e.url ?? fallbackHref[e.kind] ?? null
  const bundleRegen: Regen = regen.bundle ?? { running: bundleRunning }
  const ready = entries.filter((e) => e.kind !== 'bundle' && itemState(hrefOf(e), regen[e.kind]) === 'ready').length
  const total = entries.length - 1

  return (
    <section
      data-slot="ExportGrid"
      data-testid="export-grid"
      aria-label="导出产物"
      aria-busy={loading || bundleRunning || undefined}
      className={cn(mobile ? 'grid gap-cards-m' : 'rounded-md border border-border bg-panel', className)}
    >
      <header className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', mobile ? 'min-h-sm-control' : 'border-b border-border px-4 py-3')}>
        <h2 className="text-sm font-semibold text-fg-strong">导出产物</h2>
        <span className="text-xs tabular-nums text-fg-muted" data-testid="export-ready-count">
          {ready}/{total} 就绪
        </span>
        <Progress value={total ? (ready / total) * 100 : 0} label="产物就绪进度" className="ml-auto w-24" />
        {onBundle && (
          <Button size={mobile ? 'md' : 'sm'} onClick={onBundle} disabled={unavailable} loading={bundleRunning} loadingLabel="正在生成递交包" data-testid="export-bundle-run">
            <Package aria-hidden /> 生成递交包
          </Button>
        )}
      </header>
      {unavailable && (
        <Alert variant="info" className={mobile ? undefined : 'm-4 mb-0'} data-testid="export-grid-unavailable">
          <AlertDescription>递交包清单暂不可用（{error ?? '501'}）；DOCX / PDF / 修订版 / 附图 zip 仍可在下方或工作台下载。</AlertDescription>
        </Alert>
      )}
      {!unavailable && error && (
        <Alert variant="danger" className={mobile ? undefined : 'm-4 mb-0'} data-testid="export-grid-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <ul className={cn('grid grid-cols-1', mobile ? 'gap-cards-m' : 'divide-y divide-border')} data-testid="export-grid-items">
        {main.map((e) => (
          <ExportItem key={e.kind} entry={e} href={hrefOf(e)} onDownload={onDownload} downloading={downloading} regen={regen[e.kind]} detail={detail[e.kind]} mobile={mobile} emphasis />
        ))}
        {aux.map((e) => (
          <ExportItem key={e.kind} entry={e} href={hrefOf(e)} onDownload={onDownload} downloading={downloading} regen={regen[e.kind]} detail={detail[e.kind]} mobile={mobile} />
        ))}
      </ul>
      <ul className={mobile ? 'grid' : 'border-t border-border bg-sunken/60'} data-testid="export-grid-bundle">
        <ExportItem entry={bundle} href={hrefOf(bundle)} onDownload={onDownload} downloading={downloading} regen={unavailable ? undefined : bundleRegen} detail={detail.bundle} mobile={mobile} emphasis />
      </ul>
    </section>
  )
}
