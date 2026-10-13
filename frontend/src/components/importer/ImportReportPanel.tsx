import { ChevronRight, FileText, Image, ListOrdered, ScrollText } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ImportReport, ImportReportItem } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface ImportReportPanelProps {
  report: ImportReport
  className?: string
  /** 点击未映射项（导入完成后由对话框定位到正文中的对应文本） */
  onItemClick?: (item: ImportReportItem) => void
}

const BOOKS: { key: string; label: string; unit: string; icon: ReactNode }[] = [
  { key: 'abstract', label: '摘要', unit: '段', icon: <ScrollText /> },
  { key: 'claims', label: '权利要求书', unit: '段', icon: <ListOrdered /> },
  { key: 'description', label: '说明书', unit: '段', icon: <FileText /> },
]

/** 后端报告 code → 人话（docs/plan/10 §5.2 / docx_import.ReportItem；`unsupported.<kind>` 按前缀匹配，未知 code 兜底） */
const CODE_LABEL: Record<string, string> = {
  'title.guessed': '发明名称无法判定，已用文件名',
  'book.missing': '缺少该书标题，内容归入说明书',
  'formula.partial': '公式只部分线性化',
  'formula.inline': '行内公式',
}
function codeLabel(code: string): string {
  if (code.startsWith('unsupported.')) return `不支持的元素已丢弃（${code.slice('unsupported.'.length)}）`
  return CODE_LABEL[code] ?? '未能映射'
}

/**
 * Word 导入报告（docs/plan/10 §7.1 步骤 2）：三书切分小卡 · 附图数 · 未映射项可展开列表。
 * 375 时三卡横排为 3 列小卡（每卡只剩数字 + 标签），列表行两行显示。
 */
export function ImportReportPanel({ report, className, onItemClick }: ImportReportPanelProps) {
  const items = report.items
  return (
    <div data-slot="ImportReportPanel" data-testid="import-report" className={cn('space-y-3', className)}>
      <dl className="grid grid-cols-3 gap-2" aria-label="三书切分结果">
        {BOOKS.map((b) => {
          const n = report.books[b.key] ?? 0
          return (
            <div key={b.key} className={cn('rounded-sm border bg-panel px-2.5 py-2', n === 0 && 'border-dashed text-fg-muted')}>
              <dt className="flex items-center gap-1 text-2xs text-fg-muted [&_svg]:size-3.5">
                {b.icon}
                <span className="truncate">{b.label}</span>
              </dt>
              <dd className="pt-0.5 text-base font-semibold tabular-nums">
                {n}
                <span className="pl-0.5 text-xs font-normal text-fg-muted">{b.unit}</span>
              </dd>
            </div>
          )
        })}
      </dl>

      <p className="flex items-center gap-1.5 text-xs text-fg-muted" data-testid="import-report-figures">
        <Image className="size-3.5" aria-hidden />
        附图 {report.figures.length} 张
        {report.figures.length > 0 && <span className="min-w-0 truncate" title={report.figures.join('、')}>· {report.figures.join('、')}</span>}
      </p>

      {items.length === 0 ? (
        <p className="rounded-sm border border-dashed px-3 py-2 text-xs text-fg-muted">所有内容都已映射为内核语法，没有需要复核的项。</p>
      ) : (
        <details className="group rounded-sm border" data-testid="import-report-items">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-xs font-medium marker:content-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 text-fg-muted transition-transform group-open:rotate-90" aria-hidden />
            未映射项 ({items.length})
            <span className="ml-auto font-normal text-fg-muted">原样保留在正文中，导入后可逐条处理</span>
          </summary>
          <ul className="max-h-56 divide-y divide-border overflow-y-auto border-t border-border text-xs" aria-label="未能映射的元素">
            {items.map((it, i) => {
              const body = (
                <>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <code className="rounded-sm bg-sunken px-1 py-px text-2xs">{it.code}</code>
                    <span className="text-fg-muted">{codeLabel(it.code)} · 第 {it.para_index} 段</span>
                  </span>
                  <span className="block truncate pt-0.5 text-fg" title={it.text || '（空段落）'}>{it.text || <em className="text-fg-muted">（空段落）</em>}</span>
                  {it.detail && <span className="block truncate text-fg-muted" title={it.detail}>{it.detail}</span>}
                </>
              )
              return (
                <li key={`${it.para_index}-${i}`}>
                  {onItemClick ? (
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                      onClick={() => onItemClick(it)}
                      title="在正文中定位"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="px-3 py-1.5">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}
