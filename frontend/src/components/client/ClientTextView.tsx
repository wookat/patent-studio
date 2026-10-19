import { cn } from '@/lib/utils'
import type { Ast, DescriptionBlock } from '@/types/ast'

interface Props {
  ast: Ast
  /** 单击某块 → 页面弹「有意见」（与版面视图同一通道） */
  onPickBlock: (blockId: string, el: HTMLElement | null) => void
  pickedId: string | null
  className?: string
}

/**
 * 客户审阅页「正文」（R-MOB-03 补）：手机可读视图——不按 A4 缩放，把三书 AST 铺成连续可读文本流；
 * 只读、无纸面装饰，块仍带 data-block-id 供单击批注。
 */
export function ClientTextView({ ast, onPickBlock, pickedId, className }: Props) {
  const pick = (id: string) => (e: React.MouseEvent<HTMLElement>) => onPickBlock(id, e.currentTarget)
  const cls = (id: string, base: string) =>
    cn(base, 'cursor-pointer rounded-sm px-1 transition-colors', pickedId === id ? 'bg-accent' : 'hover:bg-accent/50')

  const desc = (b: DescriptionBlock) => {
    switch (b.kind) {
      case 'section':
        return (
          <h2 key={b.id} data-block-id={b.id} onClick={pick(b.id)} className={cls(b.id, 'mt-6 text-base font-semibold text-fg-strong')}>
            {b.title}
          </h2>
        )
      case 'subsection':
        return (
          <h3 key={b.id} data-block-id={b.id} onClick={pick(b.id)} className={cls(b.id, 'mt-4 text-sm font-semibold text-fg-strong')}>
            {b.title}
          </h3>
        )
      case 'paragraph':
        return (
          <p key={b.id} data-block-id={b.id} onClick={pick(b.id)} className={cls(b.id, 'mt-3 leading-relaxed')}>
            {b.para_no != null && <span className="mr-1 text-fg-muted">[{String(b.para_no).padStart(4, '0')}]</span>}
            {b.text}
          </p>
        )
      case 'equation':
        return (
          <p key={b.id} data-block-id={b.id} onClick={pick(b.id)} className={cls(b.id, 'mt-3 break-all rounded-sm bg-sunken px-2 py-1.5 font-mono text-2xs leading-relaxed')}>
            {b.source}
            {b.label && <span className="ml-2 text-fg-muted">{b.label}</span>}
          </p>
        )
      case 'table':
        return (
          <div key={b.id} data-block-id={b.id} onClick={pick(b.id)} className={cls(b.id, 'mt-3 overflow-x-auto')}>
            {b.caption_after == null && b.para_no != null && <span className="text-fg-muted">[{String(b.para_no).padStart(4, '0')}]</span>}
            <table className="w-full border-collapse text-2xs">
              <tbody>
                {b.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="border border-border px-1.5 py-0.5 align-top">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {b.caption_after && <p className="mt-1 text-2xs text-fg-muted">{b.caption_after.text}</p>}
            {b.note && <p className="mt-0.5 text-2xs text-fg-muted">{b.note.text}</p>}
          </div>
        )
      case 'code':
        return (
          <pre key={b.id} data-block-id={b.id} onClick={pick(b.id)} className={cls(b.id, 'mt-3 overflow-x-auto rounded-sm bg-sunken px-2 py-1.5 font-mono text-2xs leading-relaxed')}>
            {b.code_lines.join('\n')}
          </pre>
        )
      case 'figure':
        return (
          <p key={b.id} data-block-id={b.id} onClick={pick(b.id)} className={cls(b.id, 'mt-3 rounded-sm border border-dashed border-border px-2 py-1.5 text-2xs text-fg-muted')}>
            {b.alt ? `[内嵌附图：${b.alt}]` : `[内嵌附图 ${b.file}]`}
          </p>
        )
      default:
        return null
    }
  }

  return (
    <div className={cn('mx-auto max-w-2xl px-page-m py-4 text-sm text-fg', className)} data-testid="client-text-view">
      <h1 data-block-id="title" onClick={pick('title')} className={cls('title', 'text-lg font-bold leading-snug text-fg-strong')}>
        {ast.title.text}
      </h1>
      {ast.abstract.paragraphs.length > 0 && (
        <section aria-label="摘要">
          <h2 className="mt-6 text-base font-semibold text-fg-strong">摘要</h2>
          {ast.abstract.paragraphs.map((p) => (
            <p key={p.id} data-block-id={p.id} onClick={pick(p.id)} className={cls(p.id, 'mt-3 leading-relaxed')}>
              {p.text}
            </p>
          ))}
        </section>
      )}
      {ast.claims.length > 0 && (
        <section aria-label="权利要求书">
          <h2 className="mt-6 text-base font-semibold text-fg-strong">权利要求书</h2>
          {ast.claims.map((c) => (
            <p key={c.id} data-block-id={c.id} onClick={pick(c.id)} className={cls(c.id, 'mt-3 leading-relaxed')}>
              {c.segments.map((s) => s.text).join('')}
            </p>
          ))}
        </section>
      )}
      {ast.description.length > 0 && <section aria-label="说明书">{ast.description.map(desc)}</section>}
    </div>
  )
}
