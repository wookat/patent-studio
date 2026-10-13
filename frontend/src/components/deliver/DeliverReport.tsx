import { AlertTriangle, CheckCircle2, Download, ExternalLink, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { diagLocationLabel } from '@/lib/diagLocation'
import { cn } from '@/lib/utils'
import type { XmlBook, XmlExportResult } from '@/lib/types'
import { useStudio } from '@/store'
import { XML_BOOK_NAMES } from './books'

const BOOK_CODES = ['100001', '100002', '100003', '100004', '100005'] as const

function fmtTime(ts: number) {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 常驻警示：DTD 校验通过 ≠ 受理（03 §1.4 / §3.9） */
function DtdNotice() {
  return (
    <p className="flex items-start gap-2 rounded-sm border border-warn-dot/40 bg-warn-bg px-3 py-2 text-xs text-fg" role="note" data-testid="dtd-notice">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn-fg" />
      <span><b>DTD 校验通过 ≠ 已被专利业务办理系统（CPOnline）受理</b>；是否受理以官方系统上传预览为准。本工具仅按官方 DTD 检查结构合法性。</span>
    </p>
  )
}

function BookRow({ book }: { book: XmlBook }) {
  return (
    <>
      <tr className="border-t align-top" data-testid={`xml-book-${book.code}`}>
        <td className="px-2 py-1.5 font-mono tabular text-fg-muted">{book.code}</td>
        <td className="px-2 py-1.5">{book.name || XML_BOOK_NAMES[book.code] || book.file}</td>
        <td className="px-2 py-1.5">
          {book.valid ? (
            <span className="inline-flex items-center gap-1 text-ok-fg"><CheckCircle2 className="size-3.5" /> 通过</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-danger-fg"><XCircle className="size-3.5" /> 未通过 · {book.errors.length} 处</span>
          )}
        </td>
        <td className="px-2 py-1.5 tabular text-fg-muted">{book.images.length}</td>
        <td className="px-2 py-1.5">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <a href={book.xml_url} download className="inline-flex items-center gap-1 text-primary hover:underline" title={`下载 ${book.file}`}><Download className="size-3" />XML</a>
            <a href={book.preview_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" title="用官方 XSL 样式表在新标签页预览"><ExternalLink className="size-3" />官方样式预览</a>
          </span>
        </td>
      </tr>
      {book.errors.length > 0 && (
        <tr className="bg-danger-bg">
          <td />
          <td colSpan={4} className="px-2 pb-2 text-xs text-danger-fg">
            <ul className="list-disc space-y-0.5 pl-4">
              {book.errors.map((e, i) => <li key={i} className="break-all font-mono">{e}</li>)}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
}

/** 导出失败带行号时的「定位 · 语义位置」按钮；递交页 XML 格子失败态与报告面板共用 */
export function FailureLocate({ line, onGotoLine }: { line: number; onGotoLine: (line: number) => void }) {
  const ast = useStudio((s) => s.ast)
  const where = diagLocationLabel({ line }, ast)
  return (
    <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => onGotoLine(line)} aria-label={`在源码中定位到${where}`} data-testid="xml-error-locate">
      定位 · {where}
    </Button>
  )
}

export interface XmlReportProps {
  res: XmlExportResult | null
  err: string | null
  /** 导出完成时间戳 */
  at: number | null
  /** 头部右侧动作（递交页卡片内嵌时为空） */
  actions?: ReactNode
  /** 导出失败带行号时的「定位」；缺省不出按钮 */
  onGotoLine?(line: number): void
  /** 递交页卡片内嵌：去掉外边距与 DTD 常驻警示（卡片副文案已说） */
  embedded?: boolean
  className?: string
}

/**
 * CNIPA 五书 XML 导出结果（原底部面板「交付报告」tab，W4-E 起只在递交页 XML 卡片展开区使用，17 §2.2）。
 * 导出由 DeliverPage「重新生成」→ deliver.runXmlExport 触发；结果在 store 的 deliver slice（xmlResult / xmlRunning / xmlError / xmlAt）。
 */
export function XmlReport({ res, err, at, actions, onGotoLine, embedded = false, className }: XmlReportProps) {
  const books = res?.books ?? []
  const byCode = new Map(books.map((b) => [b.code, b]))
  const orderedBooks = [...BOOK_CODES.map((c) => byCode.get(c)).filter((b): b is XmlBook => b != null), ...books.filter((b) => !BOOK_CODES.includes(b.code as (typeof BOOK_CODES)[number]))]
  const invalid = books.filter((b) => !b.valid).length
  const c = res?.counts
  const failure = err ? { message: err, line: null as number | null, detail: null as string | null } : res?.status === 'error' ? { message: res.error?.message ?? '导出失败', line: res.error?.line ?? null, detail: res.error?.detail ?? null } : null

  return (
    <div data-slot="DeliverReport" className={cn('flex flex-col gap-3 text-sm', !embedded && 'p-3', className)} data-testid="deliver-report">
      {!embedded && <DtdNotice />}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-xs font-medium">
          CNIPA 五书 XML
          {at != null && <span className="text-fg-muted"> · 导出于 {fmtTime(at)}</span>}
          {res?.ms != null && <span className="tabular text-fg-muted"> · {(res.ms / 1000).toFixed(1)} s</span>}
        </h3>
        {res?.status === 'ok' && (
          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', res.valid ? 'border-ok-dot/40 text-ok-fg' : 'border-danger-dot/40 text-danger-fg')} data-testid="xml-valid">
            {res.valid ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            {res.valid ? `DTD 校验：${books.length}/${books.length} 通过` : `DTD 校验：${invalid}/${books.length} 书未通过`}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {!embedded && res?.status === 'ok' && res.zip_url && (
            <Button size="sm" asChild>
              <a href={res.zip_url} download data-testid="xml-zip"><Download />下载 zip</a>
            </Button>
          )}
          {actions}
        </span>
      </div>

      {failure && (
        <div className="rounded-sm border border-danger-dot/40 bg-danger-bg p-2 text-xs" role="alert" data-testid="xml-error">
          <p className="flex items-center gap-2 text-danger-fg">
            <XCircle className="size-3.5 shrink-0" />
            <span className="flex-1">导出失败：{failure.message}</span>
            {failure.line != null && onGotoLine && (
              <FailureLocate line={failure.line} onGotoLine={onGotoLine} />
            )}
          </p>
          {failure.detail && (
            <details className="mt-1">
              <summary className="cursor-pointer text-fg-muted">详情</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs text-fg-muted">{failure.detail}</pre>
            </details>
          )}
        </div>
      )}

      {c && (
        <p className="text-xs text-fg-muted tabular" data-testid="xml-counts">
          权项 {c.claims} · 段落 {c.paragraphs} · 附图 {c.figures} · 公式 {c.equations} · 表格 {c.tables} · 摘要 {c.abstract_chars} 字
        </p>
      )}

      {orderedBooks.length > 0 && (
        <div className="overflow-x-auto rounded-sm border">
          <table className="w-full text-xs" data-testid="xml-books">
            <thead className="bg-sunken/50 text-left text-fg-muted">
              <tr>
                <th className="px-2 py-1.5 font-medium">编码</th>
                <th className="px-2 py-1.5 font-medium">文书</th>
                <th className="px-2 py-1.5 font-medium">DTD</th>
                <th className="px-2 py-1.5 font-medium">图片</th>
                <th className="px-2 py-1.5 font-medium">文件</th>
              </tr>
            </thead>
            <tbody>
              {orderedBooks.map((b) => <BookRow key={b.code} book={b} />)}
            </tbody>
          </table>
        </div>
      )}

      {res?.warnings && res.warnings.length > 0 && (
        <div className="text-xs" data-testid="xml-warnings">
          <h4 className="mb-1 font-medium text-fg-muted">警告 {res.warnings.length} 条</h4>
          <ul className="list-disc space-y-0.5 pl-4 text-fg-muted">
            {res.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
