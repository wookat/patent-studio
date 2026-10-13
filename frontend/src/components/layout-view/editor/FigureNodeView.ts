import type { Node as PmNode } from 'prosemirror-model'
import type { NodeView } from 'prosemirror-view'
import { api } from '@/lib/api'
import { useStudio } from '@/store'

const A4_CM = 17 // 纸面正文区宽（CNIPA A4 17cm），与附图书 pct 口径一致

/**
 * 说明书内嵌图节点视图（W18）：description 书里的 `ps_figure` atom。
 * 与附图书 React 渲染不同，此处在 PM doc 内：DOM 直写 figure+img+figcaption；
 * 图件经 store.figures 找 preview 伴生名（emf 等浏览器不可渲格式走后端预览件）。
 */
export class FigureNodeView implements NodeView {
  dom: HTMLElement

  constructor(node: PmNode) {
    const file = String(node.attrs.file ?? '')
    const alt = (node.attrs.alt as string | null) ?? ''
    const width = Number(node.attrs.width) || 15
    this.dom = document.createElement('figure')
    this.dom.className = 'ps-figure ps-figure-inline'
    this.dom.setAttribute('contenteditable', 'false')
    this.dom.dataset.kind = 'figure'
    this.dom.dataset.file = file

    const stage = document.createElement('div')
    stage.className = 'ps-figure-stage'
    stage.style.width = `${Math.min(100, Math.max(5, (width / A4_CM) * 100))}%`
    stage.style.margin = '0 auto'

    const s = useStudio.getState()
    const item = s.figures.find((f) => f.name === file)
    const url = s.pid && item?.preview ? api.figUrl(s.pid, item.preview, s.figsVersion) : null
    if (url) {
      const img = document.createElement('img')
      img.className = 'ps-figure-img'
      img.src = url
      img.alt = alt || file
      img.draggable = false
      stage.append(img)
    } else {
      const miss = document.createElement('div')
      miss.className = 'ps-figure-missing'
      miss.textContent = `${file} 无预览`
      stage.append(miss)
    }
    this.dom.append(stage)

    if (alt) {
      const cap = document.createElement('figcaption')
      cap.className = 'ps-figure-no tabular'
      cap.textContent = alt
      this.dom.append(cap)
    }
  }

  stopEvent() {
    return false
  }
}
