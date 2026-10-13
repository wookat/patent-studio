import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import type { Mark } from 'prosemirror-model'
import type { BookMarkName } from '../doc/bookSchema'
import { parseInline } from '../doc/inline'

const TAG: Record<BookMarkName, 'strong' | 'em' | 'u' | 'sub' | 'sup'> = { strong: 'strong', em: 'em', underline: 'u', subscript: 'sub', superscript: 'sup' }
/** 由外到内的包裹顺序（与 bookSchema toDOM 同一套标签） */
const ORDER: readonly BookMarkName[] = ['strong', 'em', 'underline', 'subscript', 'superscript']

function wrap(text: string, marks: readonly Mark[], key: number): ReactNode {
  const names = new Set(marks.map((m) => m.type.name))
  const chain = ORDER.filter((n) => names.has(n))
  let node: ReactNode = text
  for (let i = chain.length - 1; i >= 0; i--) node = createElement(TAG[chain[i]], i === 0 ? { key } : null, node)
  return node
}

/** 只读纸面的 settings.sub_except（studio.json）：这些子串内的 `_` 不作下标 */
export const SubExceptContext = createContext<readonly string[] | undefined>(undefined)

/**
 * 只读纸面的行内格式（`**` / `*` / `<u>` / `_x` / `^x`）→ strong / em / u / sub / sup，
 * 与 BookEditor（bookSchema toDOM）、DOCX、CNIPA XML 同一份 inline 语法；无记号时原样输出字符串。
 */
export function InlineText({ text }: { text: string }) {
  const subExcept = useContext(SubExceptContext)
  const nodes = useMemo(() => {
    if (!/[*_^<]/.test(text)) return text
    const out: ReactNode[] = []
    parseInline(text, { subExcept }).forEach((n, _off, i) => {
      out.push(n.marks.length ? wrap(n.text ?? '', n.marks, i) : n.text)
    })
    return out
  }, [text, subExcept])
  return <>{nodes}</>
}
