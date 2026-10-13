import { Schema, type DOMOutputSpec, type MarkSpec, type Node as PmNode, type NodeSpec } from 'prosemirror-model'
import { schema as blockSchema, type PsSchema } from '@/components/block-model/edit/schema'
import { withTableRoles } from '../table/schema'

/**
 * W9 整书 ProseMirror schema（docs/plan/22 §2 决策 1/2）：`doc: block+` = **一本书**（abstract / claims / description / figures）。
 * 块节点复用 block-model/edit/schema.ts（ps_para / ps_heading / ps_equation / ps_table / ps_row / ps_cell / ps_note / ps_code），
 * 经 layout-view/table/schema.ts `withTableRoles` 接 prosemirror-tables；新增 `ps_claim`（权项容器）与 `ps_figure`（附图 atom）。
 * 每个块级节点带 `blockId`（AST id，W5 单一身份）与 `kind`（BookBlockKind）；权项内的段 / 公式、表格的行列不带 blockId。
 * 不放段号 / 权项号 / 图号文本：由 decoration 渲染（LayoutDecorations）。
 * marks：strong / em / underline / subscript / superscript；subscript 与 superscript 互斥（且各自不叠加）。
 * subscript / superscript 的 `src` = 源码里 `_` / `^` 后的原样 token（`t,c` / `{s∈M_t}` / `[x]`），用于逐字节往返；
 * 用户新打的标记 src=null，序列化按 inline.ts 规则（单字母数字 `_x`，否则 `_{…}`）。
 */
export const BOOK_BLOCK_KINDS = [
  'paragraph',
  'table-caption',
  'figure-caption',
  'section',
  'subsection',
  'claim',
  'equation',
  'table',
  'code',
  'figure',
] as const
export type BookBlockKind = (typeof BOOK_BLOCK_KINDS)[number]

export type BookBlockAttrs = { blockId: string | null; kind: BookBlockKind | null }

const BLOCK_ATTRS = { blockId: { default: null as string | null }, kind: { default: null as BookBlockKind | null } }

const isAttrObject = (v: unknown): v is Record<string, string | null> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 原 toDOM 外加 data-block-id / data-kind（W5：PDF 选块 / 装饰 / 测试都按 block_id 找元素） */
function withDataAttrs(spec: NodeSpec): NodeSpec['toDOM'] {
  const orig = spec.toDOM
  if (!orig) return undefined
  return (n: PmNode) => {
    const out = orig(n)
    if (!Array.isArray(out)) return out
    const [tag, attrs, ...rest] = out as [string, ...unknown[]]
    const data: Record<string, string> = {}
    if (n.attrs.blockId) data['data-block-id'] = String(n.attrs.blockId)
    if (n.attrs.kind) data['data-kind'] = String(n.attrs.kind)
    if (isAttrObject(attrs)) return [tag, { ...attrs, ...data }, ...rest] as DOMOutputSpec
    return [tag, data, attrs, ...rest] as DOMOutputSpec
  }
}

const withBlockAttrs = (spec: NodeSpec): NodeSpec => ({
  ...spec,
  attrs: { ...spec.attrs, ...BLOCK_ATTRS },
  toDOM: withDataAttrs(spec),
})

/** 文本块开放全部 marks（原 schema `marks: ''`）；代码块保持无 mark */
const withMarks = (spec: NodeSpec): NodeSpec => ({ ...spec, marks: '_' })

const base = blockSchema.spec.nodes
const get = (name: string) => base.get(name) as NodeSpec

const nodes = base
  .update('doc', { content: 'block+', attrs: { book: { default: null as string | null }, lead: { default: 1 }, trail: { default: 1 } } })
  .update('ps_para', withBlockAttrs(withMarks(get('ps_para'))))
  .update('ps_heading', withBlockAttrs(withMarks(get('ps_heading'))))
  .update('ps_equation', withBlockAttrs(get('ps_equation')))
  .update('ps_table', withBlockAttrs(get('ps_table')))
  .update('ps_cell', withMarks(get('ps_cell')))
  .update('ps_note', withBlockAttrs(withMarks(get('ps_note'))))
  .update('ps_code', withBlockAttrs(get('ps_code')))
  .addToEnd('ps_claim', {
    group: 'block',
    content: '(ps_para | ps_equation)+',
    defining: true,
    attrs: BLOCK_ATTRS,
    toDOM: (n) => ['div', { class: 'ps-claim', 'data-block-id': n.attrs.blockId ?? '', 'data-kind': 'claim' }, 0],
    parseDOM: [{ tag: 'div.ps-claim', getAttrs: (dom) => ({ blockId: dom.getAttribute('data-block-id') || null, kind: 'claim' }) }],
  })
  .addToEnd('ps_figure', {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    attrs: {
      ...BLOCK_ATTRS,
      file: { default: '' },
      width: { default: 0 },
      alt: { default: null as string | null },
      num: { default: null as number | null },
      caption: { default: null as string | null },
    },
    toDOM: (n) => [
      'figure',
      {
        class: 'ps-figure',
        'data-block-id': n.attrs.blockId ?? '',
        'data-kind': 'figure',
        'data-file': n.attrs.file,
        'data-width': String(n.attrs.width),
      },
    ],
    parseDOM: [
      {
        tag: 'figure.ps-figure',
        getAttrs: (dom) => ({
          blockId: dom.getAttribute('data-block-id') || null,
          kind: 'figure',
          file: dom.getAttribute('data-file') ?? '',
          width: Number(dom.getAttribute('data-width') ?? 0),
        }),
      },
    ],
  })

const scriptAttrs = { src: { default: null as string | null } }

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
    toDOM: () => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }],
    toDOM: () => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }],
    toDOM: () => ['u', 0],
  },
  subscript: {
    attrs: scriptAttrs,
    excludes: 'subscript superscript',
    parseDOM: [{ tag: 'sub' }],
    toDOM: () => ['sub', 0],
  },
  superscript: {
    attrs: scriptAttrs,
    excludes: 'superscript subscript',
    parseDOM: [{ tag: 'sup' }],
    toDOM: () => ['sup', 0],
  },
}

/** withTableRoles 只读 base.spec；这里的 base 是扩展后的 Schema，形状与 PsSchema 相同 */
export const bookSchema = withTableRoles(new Schema({ nodes, marks }) as unknown as PsSchema)

export type BookMarkName = 'strong' | 'em' | 'underline' | 'subscript' | 'superscript'
export const BOOK_MARK_NAMES: readonly BookMarkName[] = ['strong', 'em', 'underline', 'subscript', 'superscript']

/** 顶层块节点的 blockId / kind（非块级或未标注 → null） */
export function blockAttrsOf(n: PmNode): BookBlockAttrs {
  return { blockId: (n.attrs.blockId as string | null) ?? null, kind: (n.attrs.kind as BookBlockKind | null) ?? null }
}
