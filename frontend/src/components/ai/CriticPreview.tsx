import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** CriticMarkup 片段：与 review/criticExtension.ts 的 CriticKind 同名；text = 纯文本 */
export type CriticSeg =
  | { kind: 'text'; text: string }
  | { kind: 'ins' | 'del' | 'comment' | 'mark'; text: string }
  | { kind: 'sub'; a: string; b: string }

const OPENERS: { open: string; close: string; kind: 'ins' | 'del' | 'sub' | 'comment' | 'mark' }[] = [
  { open: '{++', close: '++}', kind: 'ins' },
  { open: '{--', close: '--}', kind: 'del' },
  { open: '{~~', close: '~~}', kind: 'sub' },
  { open: '{>>', close: '<<}', kind: 'comment' },
  { open: '{==', close: '==}', kind: 'mark' },
]

/** 线性切分（不嵌套；未闭合的标记按纯文本保留） */
export function splitCritic(md: string): CriticSeg[] {
  const out: CriticSeg[] = []
  let i = 0
  let plain = ''
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain })
    plain = ''
  }
  while (i < md.length) {
    const op = md[i] === '{' ? OPENERS.find((o) => md.startsWith(o.open, i)) : undefined
    if (!op) {
      plain += md[i++]
      continue
    }
    const end = md.indexOf(op.close, i + 3)
    if (end < 0) {
      plain += md[i++]
      continue
    }
    flush()
    const inner = md.slice(i + 3, end)
    if (op.kind === 'sub') {
      const k = inner.indexOf('~>')
      out.push(k < 0 ? { kind: 'sub', a: inner, b: '' } : { kind: 'sub', a: inner.slice(0, k), b: inner.slice(k + 2) })
    } else out.push({ kind: op.kind, text: inner })
    i = end + 3
  }
  flush()
  return out
}

/** diff 配色走语义族 token（05 §3.11）：add `--ok-bg/--ok-fg`，del `--danger-bg/--danger-fg` 删除线，comment / mark `--warn-bg/--warn-fg`；亮暗各自独立层 */
// +/− 前缀兜底：不依赖色觉区分 ins/del（色弱可读）
const INS = "rounded-xs bg-ok-bg px-0.5 text-ok-fg no-underline before:content-['+']"
const DEL = "rounded-xs bg-danger-bg px-0.5 text-danger-fg line-through before:content-['−']"

/**
 * CriticMarkup 预览（建议卡 / 版面块旁卡）：mono 13/20；与编辑器 criticExtension 同一套语义色
 * （ins ok 底 / del danger 底删除线 / sub = del→ins / comment warn 斜体 / mark warn 底）。
 */
export function CriticPreview({ markdown, className, maxLines }: { markdown: string; className?: string; maxLines?: number }) {
  const segs = splitCritic(markdown)
  return (
    <p
      className={cn('whitespace-pre-wrap break-words font-mono text-sm leading-5 text-fg', maxLines != null && 'overflow-hidden', className)}
      style={maxLines != null ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxLines } : undefined}
      data-testid="critic-preview"
    >
      {segs.map((s, i) => (
        <Fragment key={i}>{renderSeg(s)}</Fragment>
      ))}
    </p>
  )
}

function renderSeg(s: CriticSeg): ReactNode {
  switch (s.kind) {
    case 'text':
      return s.text
    case 'ins':
      return <ins className={INS} data-critic="ins">{s.text}</ins>
    case 'del':
      return <del className={DEL} data-critic="del">{s.text}</del>
    case 'sub':
      return (
        <span data-critic="sub">
          <del className={DEL}>{s.a}</del>
          <span aria-hidden className="mx-0.5 text-fg-muted">→</span>
          <ins className={INS}>{s.b}</ins>
        </span>
      )
    case 'comment':
      return (
        <span className="rounded-xs bg-warn-bg px-0.5 italic text-warn-fg" data-critic="comment">
          <span className="sr-only">批注：</span>
          {s.text}
        </span>
      )
    case 'mark':
      return <mark className="rounded-xs bg-warn-bg text-warn-fg" data-critic="mark">{s.text}</mark>
  }
}
