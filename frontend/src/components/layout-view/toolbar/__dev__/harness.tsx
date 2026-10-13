/**
 * W9 format-toolbar 单元的浏览器验证挂架（dev-only，应用不 import）。
 *
 * U1 BookEditor 尚未落地时，在真实工作台页面的 DevTools 里：
 *   const h = await import('/src/components/layout-view/toolbar/__dev__/harness.tsx'); h.mount('description')
 * 会在页面底部浮出一张 .ps-layout/.ps-paper 纸面，用 bookSchema + toBookDoc 把当前案的一书装进真实 EditorView，
 * 上方挂 <FormatBar view/>，选区挂 <SelectionPopover view/>，并挂 <HeadingStylePanel/>；
 * 编辑后 600ms 经 store.saveBook(book, fromBookDoc(doc)) 落回 Markdown（块补丁 / 整书 PUT），与集成后的数据路径一致。
 * 集成时 tech-lead 用 BookEditor 替换本挂架；挂点见结构化输出 integration_requests。
 */
import { createRoot, type Root } from 'react-dom/client'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { useStudio } from '@/store'
import type { BookName } from '@/types/ast'
import { useStyleCss } from '../../styleCss'
import { toBookDoc } from '../../doc/toBookDoc'
import { fromBookDoc } from '../../doc/fromBookDoc'
import { FORMAT_KEYS } from '../commands'
import { FormatBar } from '../FormatBar'
import { SelectionPopover } from '../SelectionPopover'
import { HeadingStylePanel } from '../../style-panel/HeadingStylePanel'
import '../../layout-view.css'

export { TextSelection }

/** 与 LayoutView 同源：GET /style.css → <style>，styleCssVersion / 构建成功后重取 */
function StyleCssMount() {
  const pid = useStudio((s) => s.pid)
  const css = useStyleCss(pid)
  return css ? <style data-testid="w9-harness-style">{css}</style> : null
}

let current: { root: Root; view: EditorView; host: HTMLElement } | null = null

export function unmount(): void {
  if (!current) return
  current.root.unmount()
  current.view.destroy()
  current.host.remove()
  current = null
}

export function mount(book: BookName = 'description'): EditorView {
  unmount()
  const s = useStudio.getState()
  if (!s.ast) throw new Error('store.ast 为空：先打开一个案子')
  const doc = toBookDoc(s.ast, book, s.content, { subExcept: s.settings?.sub_except ?? [] })

  const host = document.createElement('div')
  host.className = 'ps-layout ps-w9-harness'
  host.dataset.testid = 'w9-harness'
  host.style.position = 'fixed'
  host.style.inset = 'auto 0 0 0'
  host.style.height = '70vh'
  host.style.overflow = 'auto'
  host.style.zIndex = '40'
  host.style.background = 'var(--color-background)'
  host.style.borderTop = '1px solid var(--color-border)'
  document.body.appendChild(host)

  const barHost = document.createElement('div')
  const paperWrap = document.createElement('div')
  paperWrap.style.display = 'flex'
  paperWrap.style.justifyContent = 'center'
  paperWrap.style.padding = '16px'
  const paper = document.createElement('div')
  paper.className = 'ps-paper'
  paper.style.position = 'relative'
  paper.style.minHeight = '0'
  const editorMount = document.createElement('div')
  paper.appendChild(editorMount)
  paperWrap.appendChild(paper)
  host.append(barHost, paperWrap)

  let timer: ReturnType<typeof setTimeout> | null = null
  const view = new EditorView(editorMount, {
    state: EditorState.create({
      doc,
      plugins: [history(), keymap({ ...FORMAT_KEYS, 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }), keymap(baseKeymap)],
    }),
    dispatchTransaction(tr) {
      const st = view.state.apply(tr)
      view.updateState(st)
      if (tr.docChanged) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          void useStudio.getState().saveBook(book, fromBookDoc(view.state.doc))
        }, 600)
      }
    },
  })

  const root = createRoot(barHost)
  root.render(
    <>
      <StyleCssMount />
      <FormatBar view={view} />
      <SelectionPopover view={view} container={paper} />
      <HeadingStylePanel previewRoots={() => [host]} />
    </>,
  )
  current = { root, view, host }
  return view
}
