import type { Node as PmNode } from 'prosemirror-model'
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { Ast, BookName } from '@/types/ast'
import { blockAttrsOf } from '../doc/bookSchema'
import { CLAIM_PREFIX_RE } from './keymap'
import { paraLabel } from '@/components/block-model/model'

/**
 * 内核生成物装饰（22 §2 决策 1 / 16 §4）：段号 `[0001]`、权项性质（独立 / 从属）、表号、图号 从 AST 按 blockId 取，
 * 以 `Decoration.widget`（contentEditable=false、ignoreSelection、user-select:none）渲染 —— 不进 doc、复制正文不带入；
 * 块的 `.ps-*` 版面类（ps-body / ps-caption / ps-desc-h1 …）以 `Decoration.node` 加在块上，纸面 CSS 不变。
 * AST 更新经 `setAst(view, ast)`（tr.setMeta），没有 blockId 的新块（尚未回填）不出编号。
 */

export const bookDecoKey = new PluginKey<DecoState>('ps-book-decorations')

interface DecoState {
  ast: Ast | null
  book: BookName
  set: DecorationSet
}

export interface GenInfo {
  /** 段号 [0001] */
  paraNo?: number
  /** 表注段号（ps_note 与表格同 blockId） */
  notePara?: number
  /** 权项性质 */
  claimKind?: 'independent' | 'dependent'
  /** 权项位置序号（1-based；文本前缀与之不同时提示） */
  claimNum?: number
}

/** blockId → 生成物 */
export function genIndex(ast: Ast | null, book: BookName): Map<string, GenInfo> {
  const m = new Map<string, GenInfo>()
  if (!ast) return m
  if (book === 'abstract') return m
  if (book === 'claims') {
    ast.claims.forEach((c, i) => m.set(c.id, { claimKind: c.claim_kind === 'independent' ? 'independent' : 'dependent', claimNum: i + 1 }))
    return m
  }
  for (const b of ast.description) {
    if (b.kind === 'paragraph' && b.para_no != null) m.set(b.id, { paraNo: b.para_no })
    else if (b.kind === 'table') m.set(b.id, { paraNo: b.para_no, notePara: b.note?.para_no ?? undefined })
    else if (b.kind === 'code') m.set(b.id, { paraNo: b.para_no })
  }
  return m
}

/** 块节点 → 版面 part 类（与 paper/blocks.tsx 的 LayoutParagraph / LayoutSection 同名） */
export function partClass(node: PmNode, book: BookName): string {
  const { kind } = blockAttrsOf(node)
  switch (node.type.name) {
    case 'ps_para':
      if (kind === 'table-caption') return 'ps-p ps-caption'
      return book === 'abstract' ? 'ps-p ps-abstract' : book === 'claims' ? 'ps-p' : 'ps-p ps-body'
    case 'ps_heading':
      return node.attrs.level === 4 ? 'ps-desc-h ps-desc-h2' : 'ps-desc-h ps-desc-h1'
    case 'ps_note':
      return 'ps-p ps-table-note'
    case 'ps_equation':
      return 'ps-eq'
    default:
      return ''
  }
}

const GEN_CLASS = 'ps-gen'
/** 生成物 DOM 标记：DOMParser 忽略、CSS 不可选 */
export const GEN_ATTR = 'data-generated'

function genWidget(cls: string, text: string, sr: string): HTMLElement {
  const el = document.createElement('span')
  el.className = `${GEN_CLASS} ${cls}`
  el.setAttribute('contenteditable', 'false')
  el.setAttribute(GEN_ATTR, 'true')
  el.title = '由内核生成'
  const srEl = document.createElement('span')
  srEl.className = 'sr-only'
  srEl.textContent = `${sr} `
  el.append(srEl, document.createTextNode(text))
  return el
}

// key 决定重绘：按块身份 + 显示文字，而不是按位置 —— 上文一改所有块位置都变，按位置会让整书生成物每键都销毁重建
const widget = (pos: number, key: string, make: () => HTMLElement, side = -1) =>
  Decoration.widget(pos, make, { side, ignoreSelection: true, key })

export function buildDecorations(doc: PmNode, ast: Ast | null, book: BookName): DecorationSet {
  const gen = genIndex(ast, book)
  const decos: Decoration[] = []
  let claimIdx = 0
  doc.forEach((node, pos) => {
    const cls = partClass(node, book)
    const { blockId } = blockAttrsOf(node)
    const info = blockId ? gen.get(blockId) : undefined
    const attrs: Record<string, string> = {}
    if (cls) attrs.class = cls
    if (blockId) attrs['data-block-id'] = blockId
    if (node.type.name === 'ps_claim') {
      claimIdx += 1
      const num = claimIdx
      const written = CLAIM_PREFIX_RE.exec(node.firstChild?.textContent ?? '')
      const mismatch = written != null && Number(written[1]) !== num
      const kindText = info?.claimKind === 'dependent' ? '从属' : info?.claimKind === 'independent' ? '独立' : `权项 ${num}`
      const text = mismatch ? `${kindText} · 应为 ${num}.` : kindText
      decos.push(widget(pos + 1, `claim-${blockId ?? pos}-${text}`, () => genWidget('ps-claim-kind', text, '权项性质')))
      if (mismatch) attrs['data-claim-mismatch'] = 'true'
    } else if (info?.paraNo != null && node.type.name === 'ps_para') {
      const n = info.paraNo
      decos.push(widget(pos + 1, `pn-${blockId}-${n}`, () => genWidget('ps-para-no', paraLabel(n), '生成段号')))
    } else if (info?.paraNo != null && (node.type.name === 'ps_table' || node.type.name === 'ps_code')) {
      const n = info.paraNo
      decos.push(widget(pos, `tn-${blockId}-${n}`, () => genWidget('ps-para-no ps-table-no', paraLabel(n), '生成段号')))
    } else if (info?.notePara != null && node.type.name === 'ps_note') {
      const n = info.notePara
      decos.push(widget(pos + 1, `nn-${blockId}-${n}`, () => genWidget('ps-para-no', paraLabel(n), '生成段号')))
    }
    if (Object.keys(attrs).length) decos.push(Decoration.node(pos, pos + node.nodeSize, attrs))
  })
  return DecorationSet.create(doc, decos)
}

export function bookDecorations(book: BookName, ast: Ast | null): Plugin<DecoState> {
  return new Plugin<DecoState>({
    key: bookDecoKey,
    state: {
      init: (_, state) => ({ ast, book, set: buildDecorations(state.doc, ast, book) }),
      apply: (tr, prev, _old, state) => {
        const nextAst = tr.getMeta(bookDecoKey) as Ast | undefined
        if (nextAst === undefined && !tr.docChanged) return prev
        const a = nextAst ?? prev.ast
        return { ast: a, book: prev.book, set: buildDecorations(state.doc, a, prev.book) }
      },
    },
    props: {
      decorations: (state) => bookDecoKey.getState(state)?.set,
    },
  })
}

/** AST 到达 → 重算装饰（不进历史） */
export function astTransaction(state: EditorState, ast: Ast | null): Transaction {
  return state.tr.setMeta(bookDecoKey, ast).setMeta('addToHistory', false)
}

