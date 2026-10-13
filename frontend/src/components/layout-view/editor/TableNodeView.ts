import { DOMSerializer, type Node } from 'prosemirror-model'
import type { NodeView, ViewMutationRecord } from 'prosemirror-view'

/**
 * ps_table 的 NodeView：<table> 外包一层 `.ps-table-scroll`，过宽的表在纸面内横向滚动而不撑破页面（375 尤其）；
 * 三线表 / 编号左置按属性打到包裹层，与静态纸面（paper/blocks.tsx LayoutTable）同一套样式类。
 * contentDOM 仍是 <tbody>，单元格编辑 / prosemirror-tables 选区不受影响。
 */
export class TableNodeView implements NodeView {
  dom: HTMLDivElement
  contentDOM: HTMLElement
  private table: HTMLElement
  private node: Node

  constructor(node: Node) {
    this.node = node
    this.dom = document.createElement('div')
    const spec = node.type.spec.toDOM!(node)
    const { dom, contentDOM } = DOMSerializer.renderSpec(document, spec)
    this.table = dom as HTMLElement
    this.contentDOM = contentDOM as HTMLElement
    this.dom.append(this.table)
    this.sync()
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false
    this.node = node
    const spec = node.type.spec.toDOM!(node)
    const { dom } = DOMSerializer.renderSpec(document, spec)
    const fresh = dom as HTMLElement
    for (const name of this.table.getAttributeNames()) {
      if (!fresh.hasAttribute(name)) this.table.removeAttribute(name)
    }
    for (const name of fresh.getAttributeNames()) {
      const v = fresh.getAttribute(name)!
      if (this.table.getAttribute(name) !== v) this.table.setAttribute(name, v)
    }
    this.sync()
    return true
  }

  ignoreMutation(m: ViewMutationRecord) {
    return m.type === 'attributes' && (m.target === this.dom || m.target === this.table)
  }

  private sync() {
    const { three_line, num_left } = this.node.attrs as { three_line: boolean; num_left: boolean }
    this.dom.className = [
      'ps-table-scroll',
      three_line && 'ps-table-three-line',
      num_left && 'ps-table-num-left',
    ]
      .filter(Boolean)
      .join(' ')
  }
}
