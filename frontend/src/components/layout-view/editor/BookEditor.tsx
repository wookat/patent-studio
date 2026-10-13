import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { history } from 'prosemirror-history'
import type { Node as PmNode } from 'prosemirror-model'
import { EditorState, Selection, type Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { EquationNodeView } from './EquationNodeView'
import { FigureNodeView } from './FigureNodeView'
import { TableNodeView } from './TableNodeView'
import { cn } from '@/lib/utils'
import type { Ast, BookName } from '@/types/ast'
import type { EditorMode } from '@/types/collab-center'
import { blockAttrsOf } from '../doc/bookSchema'
import { fromBookDoc } from '../doc/fromBookDoc'
import { toBookDoc } from '../doc/toBookDoc'
import { tablePlugins } from '../table'
import { demotePmView, promotePmView } from './activeView'
import { astTransaction, bookDecoKey, bookDecorations } from './decorations'
import { bookKeymap } from './keymap'
import { planIncoming } from './mergeDoc'
import { useBookSave } from './useBookSave'
import { bookDomParser, bookText } from './bookView'
import { openFormulaDialog } from '@/components/block-model/dialogs/state'
import { api } from '@/lib/api'
import { useStudio } from '@/store'

/**
 * 整书 ProseMirror 编辑器（22 §2 决策 1）：一本书一个 EditorView，挂在 A4 纸面内（.ps-paper 子元素）。
 * - doc = toBookDoc(ast, book, content)；Markdown 仍是唯一真源：改动经 useBookSave → fromBookDoc → store.saveBook（bookDiff 决定块补丁 / 整书 PUT）。
 * - 服务端 / 协同新 content 到达：本地序列化 ≠ 新正文 且 没有未落盘输入 → mergeBookDoc 按块合并（光标 blockId+偏移恢复）；
 *   等于（我们自己的回写）→ 只合并块属性（blockId 回填）与装饰；组字中不重建。
 * - readonly：editable=false 仍可选取复制；review：saveBook({review:true})，裸 CriticMarkup 不在版面出现（渲染交给 plugins 注入的 review-rail 装饰）。
 * - 段号 / 权项性质 / 版面类 由 decorations 插件渲染，不进 doc。
 */
export interface BookEditorProps {
  book: BookName
  ast: Ast
  content: string
  /** store.selectAstStale：AST 落后于 content 时不重建 doc（等新 AST 到再合并） */
  astStale?: boolean
  mode: EditorMode
  subExcept?: readonly string[]
  /** 外部插件注入口（review-rail 装饰、工具条 command 等） */
  plugins?: readonly Plugin[]
  /** 落盘：LayoutView 绑定 store.saveBook(book, md, {review}) */
  onSave: (md: string) => Promise<boolean>
  onView?: (view: EditorView | null) => void
  /** 光标进入某块（blockId 为 null = 尚未回填的新块）；explicit = 鼠标点击 */
  onCursorBlock?: (blockId: string | null, explicit: boolean) => void
  /** 只读模式下敲了会改文本的键（宿主用于 toast 提示） */
  onReadonlyInput?: () => void
  /** 双击公式块（说明书）→ 公式编辑器 */
  onOpenEquation?: (blockId: string) => void
  className?: string
  'data-testid'?: string
}

/** 三书保存串行化（store.saveBookDoc 一次只接一个） */
let saveChain: Promise<unknown> = Promise.resolve()
const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
  const p = saveChain.then(fn, fn)
  saveChain = p.catch(() => undefined)
  return p
}

export function BookEditor({ book, ast, content, astStale = false, mode, subExcept, plugins, onSave, onView, onCursorBlock, onReadonlyInput, onOpenEquation, className, ...rest }: BookEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const composing = useRef(false)
  const pendingMerge = useRef(false)
  /** 上一次与服务端 / 房间同步时的 doc（三方合并的 base）与它对应的本书文本（本地保存成功也推进它） */
  const baseDoc = useRef<PmNode | null>(null)
  const baseText = useRef<string | null>(null)
  /** store.content 里已有还没合进本地 doc 的远端文本（AST 尚未跟上）：idle 保存先等一等，不要拿旧块盖它 */
  const remoteHeld = useRef(false)
  const latest = useRef({ mode, onSave, onCursorBlock, onReadonlyInput, onOpenEquation, ast, content, subExcept, astStale })
  latest.current = { mode, onSave, onCursorBlock, onReadonlyInput, onOpenEquation, ast, content, subExcept, astStale }
  const editable = mode !== 'readonly'
  const opts = useMemo(() => ({ subExcept }), [subExcept])
  /** 挂载时的案卷 id（BookEditor 以 key={pid} 翻案重挂）：saveChain 排队中的迟发保存若遇换案则丢弃 */
  const mountPid = useRef<string | null>(useStudio.getState().pid)

  const sched = useBookSave({
    view: () => viewRef.current,
    save: (md) =>
      enqueue(() => (useStudio.getState().pid === mountPid.current ? latest.current.onSave(md) : Promise.resolve(false))).then((ok) => {
        if (ok) baseText.current = md
        // 保存回来后再对一次 props（服务端可能规范化了文本）；等调度器清掉 inflight 后再做
        window.setTimeout(() => viewRef.current && syncRef.current(viewRef.current), 0)
        return ok
      }),
    composing: () => composing.current,
    holding: () => remoteHeld.current,
    enabled: editable,
  })

  /** props(ast/content) → doc：等于本地序列化 → 只回填属性/装饰；不等且无未落盘输入 → 按块合并 */
  const syncFromProps = useCallback(
    (view: EditorView) => {
      const { ast: a, content: c, subExcept: se, astStale: stale } = latest.current
      const incoming = bookText(c, book)
      if (incoming === undefined) return
      if (stale) {
        remoteHeld.current = incoming !== baseText.current
        return
      }
      remoteHeld.current = false
      if (composing.current) {
        pendingMerge.current = true
        return
      }
      let local: string | null = null
      try {
        local = fromBookDoc(view.state.doc)
      } catch {
        local = null
      }
      const next = toBookDoc(a, book, c, { subExcept: se })
      // 用户还在输入且尚未落盘时：远端（协同对端 / 服务端回写）相对 base 的改动按块套到本地，
      // 与本地脏块重叠时本地优先（随后本地保存以块补丁 / base_sha 决胜），不整篇覆盖；自己刚保存的正文回流不算远端改动
      const plan = planIncoming(view.state, next, local, incoming, { doc: baseDoc.current, text: baseText.current }, sched.pending)
      if (plan.merge) view.dispatch(plan.merge.tr.setMeta(bookDecoKey, a))
      else view.dispatch(astTransaction(view.state, a))
      if (plan.advance === 'none') return
      baseDoc.current = next
      if (plan.advance === 'doc') return
      baseText.current = incoming
      sched.markSaved(incoming)
    },
    [book, sched],
  )

  const syncRef = useRef(syncFromProps)
  syncRef.current = syncFromProps

  const lastBlock = useRef<string | null | undefined>(undefined)
  const reportCursor = useCallback((view: EditorView, explicit: boolean) => {
    const $from = view.state.selection.$from
    const node = $from.depth > 0 ? $from.node(1) : null
    const id = node ? blockAttrsOf(node).blockId : null
    if (id === lastBlock.current && !explicit) return
    lastBlock.current = id
    latest.current.onCursorBlock?.(id, explicit)
  }, [])

  // 挂载：建 EditorView（doc 来自当时的 ast/content；后续更新走 merge effect）
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const { ast: a, content: c, subExcept: se } = latest.current
    const doc = toBookDoc(a, book, c, { subExcept: se })
    baseDoc.current = doc
    baseText.current = bookText(c, book) ?? null
    const state = EditorState.create({
      doc,
      selection: Selection.atStart(doc),
      // tableEditing 要在其它键盘插件之后（table/commands.ts）
      plugins: [history(), bookKeymap(), ...tablePlugins(), bookDecorations(book, a), ...(plugins ?? [])],
    })
    const view = new EditorView(el, {
      state,
      editable: () => latest.current.mode !== 'readonly',
      // 浏览器原生改动 DOM（如并段）后重读时忽略生成物 widget，段号 / 权项性质永不进正文
      domParser: bookDomParser,
      attributes: () => ({
        class: 'ps-book',
        'data-book': book,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': `${book} 正文`,
        'aria-readonly': latest.current.mode === 'readonly' ? 'true' : 'false',
      }),
      nodeViews: {
        ps_table: (node) => new TableNodeView(node),
        ps_figure: (node) => new FigureNodeView(node),
        ps_equation: (node, v, getPos) =>
          new EquationNodeView(node, v, getPos, (pos, eqNode) => {
            // 用 NodeView 自己的 node 判 blockId：doc.nodeAt(pos, side=-1) 对首子节点内的嵌套 eq 会返回父 ps_claim——
            // 首个权项里的公式曾被误送到 open(claimId) → gotoLine 静默跳源码（B38-D2）
            const id = blockAttrsOf(eqNode).blockId
            if (id) {
              latest.current.onOpenEquation?.(id)
              return
            }
            // 权项内嵌公式（claim segment 无 blockId）：双击直接开公式对话框，
            // 提交两阶段 setNodeMarkup（源码先落、mathml 异步补且不入历史）——与 BlockEditor.editEquation 同路径
            if (!v.editable) {
              latest.current.onReadonlyInput?.()
              return
            }
            // resolve().nodeAfter 正确落到嵌套 eq（nodeAt 有同样的首子节点坑）；对话框存续期间文档可变，pos 越界时放弃
            const eqAt = (s: typeof v.state) =>
              pos <= s.doc.content.size ? s.doc.resolve(pos).nodeAfter : null
            openFormulaDialog(String(eqNode.attrs.source), (source) => {
              const cur = eqAt(v.state)
              if (!cur || cur.type.name !== 'ps_equation') return
              v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, source, mathml: null }))
              v.focus()
              api
                .mathml(source)
                .then((r) => {
                  const n2 = eqAt(v.state)
                  if (!n2 || n2.type.name !== 'ps_equation' || n2.attrs.source !== source) return
                  v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...n2.attrs, mathml: r.mathml }).setMeta('addToHistory', false))
                })
                .catch(() => undefined)
            })
          }),
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr)
        view.updateState(next)
        if (tr.docChanged && !tr.getMeta('ps-merge') && latest.current.mode !== 'readonly') sched.touch()
        if (tr.selectionSet || tr.docChanged) reportCursor(view, tr.getMeta('pointer') === true)
      },
      handleDOMEvents: {
        compositionstart: () => {
          composing.current = true
          return false
        },
        compositionend: (v) => {
          composing.current = false
          if (pendingMerge.current) {
            pendingMerge.current = false
            queueMicrotask(() => syncFromProps(v))
          } else sched.touch()
          return false
        },
        blur: () => {
          void sched.flush()
          return false
        },
        focus: () => {
          promotePmView(view)
          return false
        },
        mousedown: (v) => {
          // 点击即光标，格式跟随点击处的文字：原地点击选区不变时 ProseMirror 不会清 storedMarks，这里统一清
          if (v.state.storedMarks) v.dispatch(v.state.tr.setStoredMarks(null))
          queueMicrotask(() => reportCursor(v, true))
          return false
        },
        click: (_v, e) => {
          // 合成 click（无 mousedown）也能选中块：按 DOM 的 data-block-id 上报
          const el = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-block-id]') : null
          const id = el?.dataset.blockId
          if (id) {
            lastBlock.current = id
            latest.current.onCursorBlock?.(id, true)
          }
          return false
        },
        keydown: (_v, e) => {
          if (latest.current.mode !== 'readonly' || e.isComposing) return false
          if (e.ctrlKey || e.metaKey || e.altKey) return false
          if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Delete') latest.current.onReadonlyInput?.()
          return false
        },
      },
    })
    viewRef.current = view
    sched.markSaved(bookText(c, book) ?? fromBookDoc(doc))
    promotePmView(view)
    onView?.(view)
    return () => {
      // 卸序以声明序执行（hook 的 flush+dispose 在前），这里再补一次幂等 flush：
      // 保证无论未来谁调整 hook/effect 声明顺序，卸载前的未落盘输入都不丢
      void sched.flush()
      demotePmView(view)
      onView?.(null)
      viewRef.current = null
      view.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    syncFromProps(view)
  }, [ast, content, astStale, opts, syncFromProps])

  // readonly ↔ 可编辑切换：让 editable() 重新求值
  useEffect(() => {
    viewRef.current?.setProps({})
  }, [editable])

  return <div ref={host} className={cn('ps-book-host', className)} data-book={book} data-editable={editable || undefined} {...rest} />
}
