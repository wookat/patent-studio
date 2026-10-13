import type { Node as PmNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { blockAttrsOf } from '../doc/bookSchema'

/**
 * 过宽公式的横向滚动位置按公式身份保存：ProseMirror 整块重绘（外部工具批量改块属性、合并远端改动等）
 * 会销毁并重建 NodeView，重建后从这里恢复，读者滑到的位置不回弹。
 * 写入时机是 scroll 事件，而非 destroy()：ProseMirror 先构造新 NodeView 再销毁旧的，销毁时写已经来不及。
 */
const scrollMemo = new Map<string, number>()

const eqKey = (node: PmNode): string => blockAttrsOf(node).blockId ?? `src:${String(node.attrs.source)}`

/**
 * 整书编辑器里的 ps_equation 节点视图（atom，不可直接打字）：
 * DOM 与 style.css 的 `.ps-eq` 三列 grid 一致（ps-eq-side | ps-eq-math | ps-eq-label 为直接子元素），后端 MathML 有则渲染、无则显示线性源码；
 * 双击 → 公式对话框（权项内嵌公式同）；只读时双击由回调决定定位或提示。单击由 LayoutView 决定是否弹公式 Sheet。
 */
export class EquationNodeView implements NodeView {
  dom: HTMLElement
  private node: PmNode
  private math: HTMLElement
  private label: HTMLElement

  constructor(node: PmNode, view: EditorView, getPos: () => number | undefined, onEdit: (pos: number, node: PmNode) => void) {
    this.node = node
    const pos = getPos()
    const inClaim = pos !== undefined && view.state.doc.resolve(pos).depth > 0
    this.dom = document.createElement('div')
    this.dom.className = inClaim ? 'ps-eq ps-claim-eq' : 'ps-eq'
    this.dom.setAttribute('contenteditable', 'false')
    this.dom.title = '双击编辑公式'
    this.math = document.createElement('div')
    this.math.className = 'ps-eq-math'
    // 过宽公式横向滚动：可聚焦才能用键盘滚（axe scrollable-region-focusable）
    this.math.tabIndex = 0
    this.math.addEventListener(
      'scroll',
      () => {
        const left = this.math.scrollLeft
        if (left > 0) scrollMemo.set(eqKey(this.node), left)
        else scrollMemo.delete(eqKey(this.node))
      },
      { passive: true },
    )
    this.label = document.createElement('span')
    this.label.className = 'ps-eq-side ps-eq-label tabular'
    if (inClaim) {
      this.dom.setAttribute('role', 'group')
      this.dom.append(this.math)
    } else {
      const lead = document.createElement('span')
      lead.className = 'ps-eq-side'
      lead.setAttribute('aria-hidden', 'true')
      this.dom.append(lead, this.math, this.label)
    }
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault()
      e.stopPropagation()
      // 可写与否交给回调：权项 eq 无 blockId 时只读要给提示、顶层 eq 只读要回落定位，双击不可静默吞掉
      const pos = getPos()
      if (pos !== undefined) onEdit(pos, this.node)
    })
    this.render(node)
    const saved = scrollMemo.get(eqKey(node))
    // 构造时 dom 尚未挂进文档，等本轮重绘结束再恢复
    if (saved) queueMicrotask(() => {
      if (this.dom.isConnected) this.math.scrollLeft = saved
    })
  }

  private render(node: PmNode) {
    const { source, label, mathml } = node.attrs as { source: string; label: string; mathml: string | null }
    this.math.replaceChildren()
    if (mathml) {
      this.math.innerHTML = mathml
      this.math.setAttribute('role', 'math')
      this.math.setAttribute('aria-label', source)
    } else {
      this.math.removeAttribute('role')
      this.math.removeAttribute('aria-label')
      const code = document.createElement('code')
      code.className = 'sv-math-src whitespace-pre-wrap break-all font-mono text-[0.9em]'
      code.textContent = source
      this.math.append(code)
    }
    this.label.textContent = label
    this.dom.setAttribute('aria-label', `公式${label ? ` ${label}` : ''}：${source}`)
    this.dom.dataset.source = source
  }

  update(node: PmNode) {
    if (node.type !== this.node.type) return false
    const same = node.sameMarkup(this.node)
    this.node = node
    if (!same) this.render(node)
    return true
  }

  stopEvent(e: Event) {
    return e.type === 'dblclick'
  }

  ignoreMutation() {
    return true
  }
}
