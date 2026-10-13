import { useCallback, useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { history } from 'prosemirror-history'
import { EditorState, Selection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Button } from '@/components/ui/button'
import { useIsDesktop } from '@/hooks/useMisc'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Gen } from '../blocks'
import type { BlockEditorProps, EditableBlock } from '../slots'
import { editorKeymap } from './commands'
import { generatedDecorations } from './decorations'
import { EquationView } from './EquationView'
import { useFormulaDialog } from './formulaDialog'
import { serialize, toDoc } from './serialize'
import './block-editor.css'

const BASE_ENGINE: NonNullable<BlockEditorProps['engine']> = { toDoc, serialize, plugins: () => [] }

/**
 * B2 块编辑器（docs/plan/06-r3-structure-edit-design.md §4 / §5.2）。
 * ProseMirror 自定义 schema 只承载该块的内联内容（toDoc）；提交时 fromDoc → 内核 Markdown 行 → onSubmit（store.patchBlock）。
 * 交互：挂载即聚焦；Esc 取消；Ctrl/Cmd+Enter 或失焦提交；与原文相同则直接退出不发请求；pending 期间只读；
 * IME 组合中（isComposing / compositionstart–end）不提交不取消；Ctrl/Cmd+Z / Shift+Z 块内撤销重做（prosemirror-history）。
 * 段号 / 表题后置 等生成物是 widget 装饰，不在 doc 里，序列化天然不含。公式节点双击 → dialogs 的 useFormulaDialog。
 * 版面视图传 engine（扩展 schema 的 toDoc / serialize / 表格插件）与 toolbar（表格工具条，渲染在根内所以点击不算失焦）。
 */
export function BlockEditor({ block, book, markdown, onSubmit, onCancel, pending, engine = BASE_ENGINE, onView, toolbar }: BlockEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const formula = useFormulaDialog()
  const desktop = useIsDesktop()
  // 最新 props 放 ref：PM 命令与 DOM 事件回调在挂载时绑定一次
  const latest = useRef({ block, markdown, onSubmit, onCancel, pending, formula, engine, onView })
  useLayoutEffect(() => {
    latest.current = { block, markdown, onSubmit, onCancel, pending, formula, engine, onView }
  })
  const composing = useRef(false)
  const submitting = useRef(false)
  const closing = useRef(false)
  const dialogOpen = useRef(false)

  const submit = useCallback(async () => {
    const v = view.current
    const { markdown, onSubmit, onCancel, pending } = latest.current
    if (!v || pending || submitting.current || closing.current || composing.current) return
    const md = latest.current.engine.serialize(v.state.doc)
    if (md === markdown) {
      closing.current = true
      onCancel()
      return
    }
    submitting.current = true
    const ok = await onSubmit(md)
    submitting.current = false
    if (ok) closing.current = true
  }, [])

  const cancel = useCallback(() => {
    if (closing.current || composing.current) return
    closing.current = true
    latest.current.onCancel()
  }, [])

  const editEquation = useCallback((pos: number) => {
    const v = view.current
    const node = v?.state.doc.nodeAt(pos)
    if (!v || !node || node.type.name !== 'ps_equation') return
    dialogOpen.current = true
    latest.current.formula.open(node.attrs.source, (source) => {
      const cur = view.current
      const n = cur?.state.doc.nodeAt(pos)
      if (!cur || !n || n.type.name !== 'ps_equation') return
      cur.dispatch(cur.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, source, mathml: null }))
      cur.focus()
      api
        .mathml(source)
        .then((r) => {
          const v2 = view.current
          const n2 = v2?.state.doc.nodeAt(pos)
          if (!v2 || !n2 || n2.type.name !== 'ps_equation' || n2.attrs.source !== source) return
          v2.dispatch(v2.state.tr.setNodeMarkup(pos, undefined, { ...n2.attrs, mathml: r.mathml }).setMeta('addToHistory', false))
        })
        .catch(() => undefined)
    })
  }, [])

  useLayoutEffect(() => {
    const el = host.current!
    const { block, engine, onView } = latest.current
    const doc = engine.toDoc(block)
    const state = EditorState.create({
      doc,
      selection: Selection.atEnd(doc),
      plugins: [history(), editorKeymap({ submit, cancel, editEquation }), generatedDecorations(block), ...engine.plugins()],
    })
    const v = new EditorView(el, {
      state,
      editable: () => !latest.current.pending,
      attributes: { 'aria-label': '块内容', 'aria-multiline': 'true', role: 'textbox', tabindex: '0', class: 'ps-pm' },
      nodeViews: {
        ps_equation: (node, ev, getPos) => new EquationView(node, ev, getPos, editEquation),
      },
      handleDOMEvents: {
        compositionstart: () => {
          composing.current = true
          return false
        },
        compositionend: () => {
          composing.current = false
          return false
        },
      },
    })
    view.current = v
    closing.current = false
    submitting.current = false
    composing.current = false
    v.focus()
    onView?.(v)
    return () => {
      closing.current = true
      view.current = null
      v.destroy()
      latest.current.onView?.(null)
    }
    // 块编辑会话内 doc 只从初始 block 建一次；block/markdown 后续变化不重置用户输入
  }, [submit, cancel, editEquation])

  useEffect(() => {
    view.current?.setProps({ editable: () => !pending })
  }, [pending])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // 不让 Enter / Esc 冒泡到 StructureView 的块漫游
    e.stopPropagation()
    if (e.nativeEvent.isComposing || composing.current || e.isDefaultPrevented()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void submit()
    }
  }
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (dialogOpen.current || closing.current) return
    if (e.relatedTarget instanceof Node && root.current?.contains(e.relatedTarget)) return
    void submit()
  }
  const onFocus = () => {
    dialogOpen.current = false
  }
  const stop = (e: MouseEvent) => e.stopPropagation()

  return (
    <div
      ref={root}
      role="group"
      aria-label={`编辑块 ${block.id}`}
      aria-busy={pending || undefined}
      data-testid="block-editor"
      data-block-kind={block.kind}
      className="ps-editor -mx-2 my-1 rounded-sm border border-primary/60 bg-panel p-2 ring-2 ring-ring/40"
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onFocus={onFocus}
      onDoubleClick={stop}
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg/80">{kindLabel(block, book)}</span>
        {block.kind === 'claim' && (
          <Gen prefix={`权项 ${block.num}`}>{block.claim_kind === 'dependent' ? '从属权项' : '独立权项'}</Gen>
        )}
        <span className="ml-auto truncate">{pending ? '写回中…' : 'Ctrl+Enter 提交 · Esc 取消 · Ctrl+Z 撤销'}</span>
      </div>
      {toolbar}
      <div ref={host} className={cn('rounded-sm border bg-panel text-lg text-fg', desktop ? 'px-2 py-1' : 'flex min-h-30 flex-col p-3')} data-testid="block-editor-pm" />
      <div className={cn('flex items-center justify-end', desktop ? 'mt-1.5 gap-2' : 'mt-3 gap-group-m')} data-testid="block-editor-actions">
        <Button size={desktop ? 'sm' : 'md'} variant="secondary" onClick={cancel} disabled={pending}>
          取消
        </Button>
        <Button size={desktop ? 'sm' : 'md'} variant={desktop ? 'soft' : 'default'} onClick={() => void submit()} disabled={pending} data-testid="block-editor-submit">
          提交并重建
        </Button>
      </div>
    </div>
  )
}

function kindLabel(block: EditableBlock, book: BlockEditorProps['book']): string {
  switch (block.kind) {
    case 'paragraph':
      return book === 'abstract' ? '摘要段' : block.role === 'table-caption' ? '表题' : '段落'
    case 'claim':
      return `权利要求 ${block.num}`
    case 'section':
      return '章节标题'
    case 'subsection':
      return '小节标题'
    case 'equation':
      return '公式'
    case 'table':
      return '表格（单元格可编辑；选项与表题后置由表格对话框修改）'
    case 'code':
      return '代码块'
    case 'figure':
      return '内嵌图（编辑源码行：![alt](figs/文件){width=cm}）'
  }
}
