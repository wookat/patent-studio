import { AlertTriangle } from 'lucide-react'
import { lineChipLabel } from '@/lib/diagLocation'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { NumeralRow } from '@/types/preflight'
import { LINE_BTN, usePreflightLocate } from './preflightUtils'

export const TABLE = 'w-full min-w-[22rem] border-collapse text-sm'
export const TH = 'sticky top-0 z-sticky h-sm-control border-b bg-surface-1 px-2 text-left text-xs font-semibold text-fg-muted'
export const TD = 'border-b px-2 py-1 align-top in-data-[variant=mobile]:py-1.5'
export const BAD_ROW = 'bg-danger-fg/8 text-danger-fg'

/** 行号按钮组：点一个行号 → 源码行 + 该行所在块 + PDF */
export function LineLinks({ lines, bad, label }: { lines: number[]; bad?: boolean; label: string }) {
  const locate = usePreflightLocate()
  const ast = useStudio((s) => s.ast)
  if (!lines.length) return <span className="text-fg-muted">—</span>
  return (
    <span className="flex flex-wrap gap-x-0.5 gap-y-1">
      {lines.map((l) => (
        <button
          key={l}
          type="button"
          className={cn(LINE_BTN, bad && 'text-danger-fg hover:bg-danger-fg/10')}
          onClick={() => locate(l, null)}
          aria-label={`${label}：${lineChipLabel(l, ast)}`}
          title="定位到此处"
        >
          {lineChipLabel(l, ast)}
        </button>
      ))}
    </span>
  )
}

/**
 * 附图标记表（05 §6.2）：标记号 → 图例名 → 正文名称集合 → 出现行；`consistent=false` 整行红底、
 * 与图例不同的名称加粗红字，并在标记号旁放一个三角图标（不只靠颜色）。
 */
export function NumeralsTable({ rows }: { rows: NumeralRow[] }) {
  const locate = usePreflightLocate()
  const ast = useStudio((s) => s.ast)
  const bad = rows.filter((r) => !r.consistent).length
  return (
    <div className="overflow-x-auto" data-testid="preflight-numerals">
      <table className={TABLE}>
        <caption className="sr-only">附图标记表：共 {rows.length} 个标记{bad ? `，${bad} 个不一致` : ''}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(TH, 'w-16')}>标记</th>
            <th scope="col" className={TH}>图例名称</th>
            <th scope="col" className={TH}>正文名称</th>
            <th scope="col" className={TH}>出现位置</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.num} className={cn(!r.consistent && BAD_ROW)} data-testid="numeral-row" data-num={r.num} data-consistent={r.consistent}>
              <th scope="row" className={cn(TD, 'whitespace-nowrap font-mono font-semibold tabular-nums')}>
                <span className="inline-flex items-center gap-1">
                  {!r.consistent && <AlertTriangle className="size-3.5 shrink-0" role="img" aria-label="不一致" />}
                  {r.num}
                </span>
              </th>
              <td className={TD}>
                {r.legend ?? <span className="text-fg-muted">（无图例）</span>}
                {r.legend_line !== null && (
                  <button
                    type="button"
                    className={cn(LINE_BTN, 'ml-1', !r.consistent && 'text-danger-fg hover:bg-danger-fg/10')}
                    onClick={() => locate(r.legend_line, null)}
                    aria-label={`标记 ${r.num} 图例：${lineChipLabel(r.legend_line, ast)}`}
                    title="定位到图例"
                  >
                    {lineChipLabel(r.legend_line, ast)}
                  </button>
                )}
              </td>
              <td className={TD}>
                {r.names.length ? (
                  <span className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                    {r.names.map((n) => (
                      <span key={n} className={cn(r.legend !== null && n !== r.legend && 'font-semibold text-danger-fg')} data-testid="numeral-name">
                        {n}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </td>
              <td className={TD}>
                <LineLinks lines={r.lines} bad={!r.consistent} label={`标记 ${r.num} 出现`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
