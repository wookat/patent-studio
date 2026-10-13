import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SupportRow } from '@/types/preflight'
import { BAD_ROW, LineLinks, TABLE, TD, TH } from './NumeralsTable'
import { LINE_BTN, usePreflightLocate } from './preflightUtils'

/**
 * 支持性映射表（05 §6.2）：权项术语 → 出现于哪些权项 → 说明书命中（命中前缀 / 无）→ 说明书位置。
 * `supported=false` 整行红底 + 三角图标；点权项号跳该权项，点说明书位置芯片跳源码行。
 */
export function SupportTable({ rows }: { rows: SupportRow[] }) {
  const locate = usePreflightLocate()
  const bad = rows.filter((r) => !r.supported).length
  return (
    <div className="overflow-x-auto" data-testid="preflight-support">
      <table className={TABLE}>
        <caption className="sr-only">支持性映射表：共 {rows.length} 个术语{bad ? `，${bad} 个无说明书支持` : ''}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>权项术语</th>
            <th scope="col" className={TH}>权项</th>
            <th scope="col" className={TH}>说明书命中</th>
            <th scope="col" className={TH}>说明书位置</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.term} className={cn(!r.supported && BAD_ROW)} data-testid="support-row" data-term={r.term} data-supported={r.supported}>
              <th scope="row" className={cn(TD, 'font-medium')}>
                <span className="inline-flex items-start gap-1">
                  {!r.supported && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" role="img" aria-label="无支持" />}
                  <span className="break-words">{r.term}</span>
                </span>
              </th>
              <td className={cn(TD, 'whitespace-nowrap')}>
                <span className="flex flex-wrap gap-x-0.5 gap-y-1">
                  {r.claims.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cn(LINE_BTN, !r.supported && 'text-danger-fg hover:bg-danger-fg/10')}
                      onClick={() => locate(null, `claims/${c}`)}
                      aria-label={`术语「${r.term}」出现于权利要求 ${c}`}
                      title={`定位到权利要求 ${c}`}
                    >
                      权{c}
                    </button>
                  ))}
                </span>
              </td>
              <td className={TD}>
                {r.matched === null ? (
                  <span className={cn(r.supported ? 'text-fg-muted' : 'font-semibold')}>无</span>
                ) : r.matched === r.term ? (
                  '完全匹配'
                ) : (
                  <>
                    前缀 <span className="font-medium">「{r.matched}」</span>
                  </>
                )}
              </td>
              <td className={TD}>
                <LineLinks lines={r.description_lines} bad={!r.supported} label={`术语「${r.term}」说明书`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
