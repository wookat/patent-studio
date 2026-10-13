import type { Node as PmNode } from 'prosemirror-model'
import { Plugin } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { GENERATED_CLASS } from '../blocks'
import { paraLabel } from '../model'
import type { EditableBlock } from '../slots'
import { schema } from './schema'

const { ps_para, ps_table, ps_note, ps_cell } = schema.nodes

/** 与 blocks.tsx Gen 同形：灰、不可选中、读屏前缀 */
function gen(prefix: string, text: string, extra = ''): HTMLElement {
  const span = document.createElement('span')
  span.className = `${GENERATED_CLASS} ps-gen ${extra}`.trim()
  span.title = '由内核生成'
  span.dataset.generated = 'true'
  span.contentEditable = 'false'
  const sr = document.createElement('span')
  sr.className = 'sr-only'
  sr.textContent = `${prefix} `
  span.append(sr, text)
  return span
}

const widget = (pos: number, make: () => HTMLElement, side = -1) =>
  Decoration.widget(pos, make, { side, ignoreSelection: true, key: `gen-${pos}-${side}` })

/**
 * 内核生成物只读呈现（06 §4.3 / §5.2）：段号 / 表题后置 以 widget 装饰画在 doc 上，不进入 doc，因此永远不会被序列化；
 * `^^` 单元格标出"与上格合并"。装饰按 doc 重算（块很小），随编辑实时跟随。
 */
export function generatedDecorations(block: EditableBlock): Plugin<DecorationSet> {
  const build = (doc: PmNode): DecorationSet => {
    const decos: Decoration[] = []
    if (block.kind === 'paragraph' && block.para_no !== null) {
      const first = doc.firstChild
      if (first?.type.name === ps_para.name) decos.push(widget(1, () => gen('生成段号', paraLabel(block.para_no!), 'mr-2 tabular')))
    }
    if (block.kind === 'table') {
      const { para_no, caption_after, note } = block
      doc.forEach((n, pos) => {
        if (n.type.name === ps_table.name) {
          decos.push(widget(pos, () => gen('生成段号', paraLabel(para_no), 'block mb-1 text-sm')))
          if (caption_after) {
            decos.push(
              widget(
                pos + n.nodeSize,
                () => {
                  const cap = document.createElement('div')
                  cap.className = 'ps-caption mt-1 text-center text-sm'
                  cap.contentEditable = 'false'
                  cap.append(gen('生成段号', paraLabel(caption_after.para_no), 'mr-2 tabular'), caption_after.text)
                  cap.title = '表题后置：由表格对话框修改'
                  return cap
                },
                1,
              ),
            )
          }
          n.descendants((c, cpos) => {
            if (c.type.name === ps_cell.name && c.textContent === '^^') {
              const from = pos + 1 + cpos
              decos.push(Decoration.node(from, from + c.nodeSize, { class: 'ps-cell-merge', title: '^^：与上格纵向合并' }))
            }
            return c.type.name !== ps_cell.name
          })
        } else if (n.type.name === ps_note.name && note) {
          decos.push(widget(pos + 1, () => gen('生成段号', paraLabel(note.para_no), 'mr-2 tabular')))
        }
      })
    }
    return DecorationSet.create(doc, decos)
  }
  return new Plugin<DecorationSet>({
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state) ?? null
      },
    },
  })
}
