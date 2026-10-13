import { Fragment, type Mark, type Node as PmNode, type Schema } from 'prosemirror-model'
import { bookSchema } from './bookSchema'

/**
 * 行内格式 ⇄ PM inline fragment（docs/plan/22 INLINE_SPEC；与内核 content.py 行内 tokenizer 逐字一致）。
 *
 *   `**粗体**` → strong        `*斜体*` → em        `<u>下划线</u>` → underline
 *   `_x` / `_{…}` / `_[…]` → subscript（内核既有 builder.py `_SUB_RE`，sub_except 白名单原样保留）
 *   `^x` / `^{…}` / `^[…]` → superscript（与下标同形同规则）
 *
 * 规则：`***x***` = 粗斜体（内核 `bi` 分支，先于 `**`）；`**` 优先于 `*`；`*` / `**` 内侧不得是空白；强调 / 下划线 / 下上标可嵌套（`**a_{2}**`、`**<u>a</u>**`），
 * em 内不再解析 `*` / `**`；下 / 上标内容不再解析（`_{s∈M_t}` 整体是下标）；标记不跨行（parseInline 只接受单行）；
 * 找不到闭合记号的开标记按字面字符保留。调用方负责：`$$` 公式行 / 表格分隔行 / `###` 前缀不进 parseInline，
 * CriticMarkup 先 accept/reject 再 tokenize。
 *
 * 序列化：strong > em > underline 由外到内的**规范嵌套**（PM mark 集合无序，`<u>**a**</u>` 会写成 `**<u>a</u>**`，语义相同）；
 * 粗斜体片段位于粗体跨度边缘时写 `***x***`（`**a*b***` 会被内核 `**` 懒匹配切成 b(a*b)+`*`，故写 `**a*****b***`），
 * 夹在粗体中间时仍写 `**a*b*c**`；
 * 下 / 上标带 `src`（源码原样 token）且与文本一致时原样写回，否则单个字母数字写 `_x`，其余写 `_{…}`。
 * 不变量：serializeInline(parseInline(s)) === s 对规范嵌套的任意单行 s 成立（语料 examples/ 无 `*` / `^` / `<u>`，
 * 下标全部经 src 原样往返 ⇒ 两案四书逐字节）；parseInline(serializeInline(f)) 与 f 逐节点相等（f 为规范形）。
 */
export interface InlineOptions {
  /** studio.json settings.sub_except：这些子串内的 `_` 不作下标 */
  subExcept?: readonly string[]
  schema?: Schema
}

/** 与 builder.py `_SUB_RE` 一致：`_(\{[^}]+\}|\[[^\]]+\]|检索|基线|锚|修|[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)` */
const SCRIPT_TOKEN = /\{[^}]+\}|\[[^\]]+\]|检索|基线|锚|修|[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*/y
const BARE_TOKEN = /^(?:检索|基线|锚|修|[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)$/
const BRACKET_TOKEN = /^\[[^\]]+\]$/
const SINGLE_ALNUM = /^[A-Za-z0-9]$/

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch)

/** 与 `_SUB_RE` 一致：`{…}` 去外层花括号，`[…]` 保留方括号 */
export const scriptText = (src: string) => (src.startsWith('{') && src.endsWith('}') ? src.slice(1, -1) : src)

export function parseInline(text: string, opts: InlineOptions = {}): Fragment {
  const schema = opts.schema ?? bookSchema
  const out: PmNode[] = []
  scan(text, [], schema, opts.subExcept ?? [], out)
  return Fragment.fromArray(out)
}

function scan(text: string, marks: readonly Mark[], schema: Schema, except: readonly string[], out: PmNode[]): void {
  const { strong, em, underline, subscript, superscript } = schema.marks
  const has = (name: string) => marks.some((m) => m.type.name === name)
  let buf = ''
  const flush = () => {
    if (buf) out.push(schema.text(buf, marks))
    buf = ''
  }
  const nested = (inner: string, ...add: Mark[]) => {
    flush()
    scan(inner, add.reduce((ms, m) => m.addToSet(ms), marks), schema, except, out)
  }
  const script = (token: string, mark: Mark) => {
    flush()
    out.push(schema.text(scriptText(token), mark.addToSet(marks)))
  }

  let i = 0
  const n = text.length
  while (i < n) {
    const ex = except.find((e) => e && text.startsWith(e, i))
    if (ex) {
      buf += ex
      i += ex.length
      continue
    }
    const ch = text[i]

    if (ch === '*' && text.startsWith('***', i) && !has('strong') && !has('em')) {
      const j = closingTriple(text, i + 3)
      if (j >= 0) {
        nested(text.slice(i + 3, j), em.create(), strong.create())
        i = j + 3
        continue
      }
    }
    if (ch === '*' && text[i + 1] === '*' && !has('strong') && !has('em')) {
      const j = closingDouble(text, i + 2)
      if (j >= 0) {
        nested(text.slice(i + 2, j), strong.create())
        i = j + 2
      } else {
        buf += '**'
        i += 2
      }
      continue
    }
    if (ch === '*' && text[i + 1] !== '*' && !has('em')) {
      const j = closingSingle(text, i + 1)
      if (j >= 0) {
        nested(text.slice(i + 1, j), em.create())
        i = j + 1
        continue
      }
    }
    if (ch === '<' && text.startsWith('<u>', i) && !has('underline')) {
      const j = text.indexOf('</u>', i + 3)
      if (j > i + 3) {
        nested(text.slice(i + 3, j), underline.create())
        i = j + 4
        continue
      }
    }
    if ((ch === '_' || ch === '^') && !has('subscript') && !has('superscript')) {
      SCRIPT_TOKEN.lastIndex = i + 1
      const m = SCRIPT_TOKEN.exec(text)
      if (m) {
        const token = m[0]
        script(token, (ch === '_' ? subscript : superscript).create({ src: token }))
        i += 1 + token.length
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
}

/** `***` 的闭合（内核 `\*\*\*(?=[^\s*]).+?(?<=[^\s*])\*\*\*`）：内侧非空且首尾不是空白 / `*` */
function closingTriple(text: string, from: number): number {
  if (isSpace(text[from]) || text[from] === '*') return -1
  let j = text.indexOf('***', from)
  while (j >= 0) {
    if (j > from && !isSpace(text[j - 1]) && text[j - 1] !== '*') return j
    j = text.indexOf('***', j + 1)
  }
  return -1
}

/** `**` 的闭合：从 from 起找 `**`，内侧非空且首尾不是空白 */
function closingDouble(text: string, from: number): number {
  let j = text.indexOf('**', from)
  while (j >= 0) {
    if (j > from && !isSpace(text[from]) && !isSpace(text[j - 1])) return j
    j = text.indexOf('**', j + 1)
  }
  return -1
}

/** `*` 的闭合：内侧不含 `*`、非空、首尾不是空白 */
function closingSingle(text: string, from: number): number {
  if (isSpace(text[from])) return -1
  const j = text.indexOf('*', from)
  if (j <= from || isSpace(text[j - 1])) return -1
  return j
}

/* ----------------------------------------------------------------------------------------- */

const WRAPPERS: ReadonlyArray<[name: string, open: string, close: string]> = [
  ['strong_em', '***', '***'],
  ['strong', '**', '**'],
  ['em', '*', '*'],
  ['underline', '<u>', '</u>'],
]

export function serializeInline(fragment: Fragment | readonly PmNode[]): string {
  const nodes: PmNode[] = []
  if (Array.isArray(fragment)) nodes.push(...(fragment as readonly PmNode[]))
  else (fragment as Fragment).forEach((n) => nodes.push(n))

  let out = ''
  const stack: string[] = []
  const closeTo = (k: number) => {
    while (stack.length > k) {
      const top = stack.pop()
      out += WRAPPERS.find(([nm]) => nm === top)![2]
    }
  }
  const nodeText = (n: PmNode) => (n.isText ? (n.text ?? '') : n.textContent)
  const hasStrong = (n: PmNode | undefined) => !!n && n.marks.some((m) => m.type.name === 'strong')
  const wrappersOf = (n: PmNode, idx = -1) => {
    const names = new Set(n.marks.map((m) => m.type.name))
    if (names.has('strong') && names.has('em') && idx >= 0 && !(hasStrong(nodes[idx - 1]) && hasStrong(nodes[idx + 1]))) {
      names.delete('strong')
      names.delete('em')
      names.add('strong_em')
    }
    return WRAPPERS.filter(([nm]) => names.has(nm)).map(([nm]) => nm)
  }
  const scriptOf = (n: PmNode) => n.marks.find((m) => m.type.name === 'subscript' || m.type.name === 'superscript')
  /** 同一包裹跨度内紧随其后的源码文本（下 / 上标节点以记号开头即可截断字母数字串） */
  const restAfter = (idx: number, want: readonly string[]) => {
    let rest = ''
    for (let j = idx + 1; j < nodes.length; j++) {
      const n = nodes[j]!
      const w = wrappersOf(n, j)
      if (w.length !== want.length || w.some((nm, q) => nm !== want[q])) break
      const sc = scriptOf(n)
      rest += (sc ? (sc.type.name === 'subscript' ? '_' : '^') : '') + nodeText(n)
      if (rest.length > 64) break
    }
    return rest
  }
  nodes.forEach((node, idx) => {
    const text = nodeText(node)
    const want = wrappersOf(node, idx)
    let k = 0
    while (k < stack.length && k < want.length && stack[k] === want[k]) k++
    closeTo(k)
    for (const nm of want.slice(k)) {
      out += WRAPPERS.find(([w]) => w === nm)![1]
      stack.push(nm)
    }
    const sub = node.marks.find((m) => m.type.name === 'subscript')
    const sup = node.marks.find((m) => m.type.name === 'superscript')
    if (sub) out += scriptSource('_', text, sub.attrs.src as string | null, restAfter(idx, want))
    else if (sup) out += scriptSource('^', text, sup.attrs.src as string | null, restAfter(idx, want))
    else out += text
  })
  closeTo(0)
  return out
}

/**
 * 下 / 上标文本 → 源码 token：src 仍与文本一致则原样；否则单字母数字 `_x`，其余 `_{…}`。
 * rest = 紧随其后的源码文本：裸 token（`_2` / `_t`）若会被内核 `_SUB_RE` 连同后文一起吞掉（`H_2O` → `<sub>2O</sub>`），
 * 改写为无歧义的 `_{2}O`（与 docx_import._join_pieces 同一判据）。
 */
export function scriptSource(sigil: '_' | '^', text: string, src: string | null, rest = ''): string {
  if (!text) return ''
  const bareOk = (token: string) => {
    if (!rest) return true
    SCRIPT_TOKEN.lastIndex = 1
    const m = SCRIPT_TOKEN.exec(sigil + token + rest)
    return m !== null && m[0] === token
  }
  if (src !== null && scriptText(src) === text) {
    if (src.startsWith('{') || BRACKET_TOKEN.test(src)) return sigil + src
    if (BARE_TOKEN.test(src) && bareOk(src)) return sigil + src
  }
  if (SINGLE_ALNUM.test(text) && bareOk(text)) return sigil + text
  return `${sigil}{${text}}`
}

/** 单行文本 → 文本节点数组（不经 Fragment 合并，供 ps_para.create 等直接使用） */
export const inlineNodes = (text: string, opts?: InlineOptions): PmNode[] => {
  const nodes: PmNode[] = []
  parseInline(text, opts).forEach((n) => nodes.push(n))
  return nodes
}
