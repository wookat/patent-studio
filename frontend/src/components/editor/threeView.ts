import { autocompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { codeFolding, foldGutter, foldKeymap, foldService } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { CursorFocusDriver } from '@/lib/focusSync'
import type { Ast } from '@/types/ast'

/**
 * 源码视图 W5 增量（21 §5.5 / R-SRC-06）：
 *  - 片段补全 eq / tbl / claim / fig（@codemirror/autocomplete snippet，Tab 在占位间跳转）；只在英文小写词前缀触发，不打扰中文正文；
 *  - `##` / `###` 折叠 gutter：章节区间 = 标题行到下一同级或更高级标题前一行（与 section.ts 同一正则，不引第二解析器）；
 *  - 光标块变化 → Focus{source:'source'}：鼠标点击（select.pointer）立即广播，键盘移动走对照锁 150ms 去抖（lib/focusSync）。
 */

const HEADING = /^(#{2,3})\s+\S/

export const PATENT_SNIPPETS: readonly Completion[] = [
  snippetCompletion('$$${公式}$$ （${1}）', { label: 'eq', detail: '公式块 $$…$$ （n）', type: 'keyword', boost: 2 }),
  snippetCompletion('表${1} ${表题}\n\n| ${列1} | ${列2} | ${列3} |\n| --- | --- | --- |\n| ${内容} | ${内容} | ${内容} |', {
    label: 'tbl',
    detail: '三线表 + 表题',
    type: 'keyword',
    boost: 2,
  }),
  snippetCompletion('${2}. 根据权利要求${1}所述的${方法}，其特征在于，${}', { label: 'claim', detail: '从属权利要求', type: 'keyword', boost: 2 }),
  snippetCompletion('图${1}为本发明实施例的${示意图}；', { label: 'fig', detail: '附图说明条目', type: 'keyword', boost: 2 }),
]

export function patentSnippetSource(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[a-z]{1,6}/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  return { from: word.from, options: PATENT_SNIPPETS, validFor: /^[a-z]*$/ }
}

export function snippetExtension(): Extension {
  return autocompletion({ override: [patentSnippetSource], icons: false, activateOnTyping: true })
}

/** 第 lineNo 行是 ## / ### 标题时返回其折叠区间（标题行末 → 区间末行末）；否则 null */
export function headingFoldRange(state: EditorState, lineNo: number): { from: number; to: number } | null {
  const line = state.doc.line(lineNo)
  const m = HEADING.exec(line.text)
  if (!m) return null
  const level = m[1].length
  let end = lineNo
  for (let i = lineNo + 1; i <= state.doc.lines; i++) {
    const t = state.doc.line(i).text
    const h = HEADING.exec(t)
    if (h && h[1].length <= level) break
    if (/^#\s+\S/.test(t)) break
    end = i
  }
  if (end === lineNo) return null
  return { from: line.to, to: state.doc.line(end).to }
}

export function headingFoldExtension(): Extension {
  return [
    foldService.of((state, from) => headingFoldRange(state, state.doc.lineAt(from).number)),
    codeFolding({ placeholderText: '…' }),
    foldGutter({ openText: '▾', closedText: '▸' }),
    keymap.of(foldKeymap),
  ]
}

/** 光标块 → Focus{source:'source'}；pointer 选择视为显式动作 */
export function focusDriverExtension(driver: CursorFocusDriver, getAst: () => Ast | null, lineBase: () => number = () => 0): Extension {
  return EditorView.updateListener.of((u) => {
    if (!u.selectionSet) return
    const explicit = u.transactions.some((t) => t.isUserEvent('select.pointer'))
    const line = u.state.doc.lineAt(u.state.selection.main.head).number + lineBase()
    driver.cursor(getAst(), line, explicit)
  })
}
