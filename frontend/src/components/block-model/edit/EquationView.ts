import type { Node as PmNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'

/**
 * ps_equation 节点视图：源码不可直接打字（atom），显示后端 MathML（有则用，无则显示线性源码）+ 同行标号；
 * 双击 / 选中后 Enter → 公式对话框（B3 useFormulaDialog）。
 */
export class EquationView implements NodeView {
  dom: HTMLElement
  private node: PmNode
  private math: HTMLElement
  private label: HTMLElement

  constructor(node: PmNode, view: EditorView, getPos: () => number | undefined, onEdit: (pos: number) => void) {
    this.node = node
    this.dom = document.createElement('div')
    this.dom.className = 'ps-equation'
    this.dom.contentEditable = 'false'
    this.dom.title = '双击编辑公式'
    this.math = document.createElement('div')
    this.math.className = 'ps-equation-math'
    this.label = document.createElement('span')
    this.label.className = 'ps-equation-label tabular'
    this.dom.append(this.math, this.label)
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = getPos()
      if (pos !== undefined && view.editable) onEdit(pos)
    })
    this.render(node)
  }

  private render(node: PmNode) {
    const { source, label, mathml } = node.attrs as { source: string; label: string; mathml: string | null }
    if (mathml) {
      this.math.innerHTML = mathml
      this.math.setAttribute('role', 'math')
      this.math.setAttribute('aria-label', source)
    } else {
      this.math.textContent = ''
      this.math.removeAttribute('role')
      this.math.removeAttribute('aria-label')
      const code = document.createElement('code')
      code.className = 'ps-equation-src font-mono'
      code.textContent = source
      this.math.append(code)
    }
    this.label.textContent = label
    this.label.hidden = !label
    this.dom.dataset.source = source
  }

  update(node: PmNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.render(node)
    return true
  }

  stopEvent(e: Event) {
    return e.type === 'dblclick'
  }

  ignoreMutation() {
    return true
  }
}
