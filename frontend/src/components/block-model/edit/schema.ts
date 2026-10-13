import { Schema, type NodeSpec } from 'prosemirror-model'

/**
 * 块编辑器 ProseMirror schema（docs/plan/06-r3-structure-edit-design.md §4.1）。
 * 只覆盖单个块的内联内容：无 mark、无嵌套；每个顶层节点序列化为内核 Markdown 的一行（表格 / 代码块除外）。
 * 节点名前缀 ps_，与 serialize.ts 的 toDoc / fromDoc 一一对应；解析器仍只有后端一份——这里不解析任何 Markdown 文本。
 */
const textblock = (spec: Partial<NodeSpec> & Pick<NodeSpec, 'toDOM' | 'parseDOM'>): NodeSpec => ({
  content: 'text*',
  marks: '',
  ...spec,
})

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    /** 说明书段 / 摘要段 / 权项段：1 行 = 文本 */
    ps_para: textblock({
      group: 'block',
      toDOM: () => ['p', { class: 'ps-para' }, 0],
      parseDOM: [{ tag: 'p' }],
    }),
    /** ### 章节 / #### 小节 */
    ps_heading: textblock({
      group: 'block',
      attrs: { level: { default: 3 } },
      defining: true,
      toDOM: (n) => [n.attrs.level === 4 ? 'h4' : 'h3', { class: 'ps-heading' }, 0],
      parseDOM: [
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 4 } },
      ],
    }),
    /** $$source$$ label?；叶节点，不可打字，双击走公式对话框。mathml 只用于呈现，不序列化 */
    ps_equation: {
      group: 'block',
      atom: true,
      selectable: true,
      draggable: false,
      attrs: { source: { default: '' }, label: { default: '' }, mathml: { default: null as string | null } },
      toDOM: (n) => ['div', { class: 'ps-equation', 'data-source': n.attrs.source, 'data-label': n.attrs.label }],
      parseDOM: [
        {
          tag: 'div.ps-equation',
          getAttrs: (dom) => ({ source: dom.getAttribute('data-source') ?? '', label: dom.getAttribute('data-label') ?? '' }),
        },
      ],
    },
    /** 表格：选项 token 与表题后置作为属性保留，单元格文本可编辑（^^ = 与上格纵向合并，原样保留） */
    ps_table: {
      group: 'block',
      content: 'ps_row+',
      isolating: true,
      attrs: {
        three_line: { default: false },
        repeat_header: { default: false },
        num_left: { default: false },
        col_widths: { default: null as number[] | null },
        caption_after: { default: null as string | null },
      },
      toDOM: () => ['table', { class: 'ps-table' }, ['tbody', 0]],
      parseDOM: [{ tag: 'table' }],
    },
    ps_row: {
      content: 'ps_cell+',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }],
    },
    ps_cell: textblock({
      isolating: true,
      toDOM: () => ['td', { class: 'ps-cell' }, 0],
      parseDOM: [{ tag: 'td' }, { tag: 'th' }],
    }),
    /** 表注：序列化时前置一空行（内核语法） */
    ps_note: textblock({
      group: 'block',
      toDOM: () => ['p', { class: 'ps-note' }, 0],
      parseDOM: [{ tag: 'p.ps-note', priority: 60 }],
    }),
    /** ``` 代码块：一整块文本，行以 \n 分隔（R3 不做代码编辑器，仅保证往返） */
    ps_code: textblock({
      group: 'block',
      code: true,
      whitespace: 'pre',
      toDOM: () => ['pre', { class: 'ps-code' }, ['code', 0]],
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    }),
  },
  marks: {},
})

export type PsSchema = typeof schema
