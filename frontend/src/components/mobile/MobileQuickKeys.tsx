import { useEffect, useState, type PointerEvent } from 'react'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ChevronDown, Crosshair, Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { editorCommands } from '@/components/editor/commands'
import { selectReadonly, useStudio } from '@/store'

/** 光标处/选区包裹：`{++` + 选区 + `++}`；无选区时光标落在包裹符中间 */
interface WrapKey {
  id: string
  label: string
  open: string
  close: string
  hint: string
}

const KEYS: readonly WrapKey[] = [
  { id: 'h', label: '#', open: '# ', close: '', hint: '标题' },
  { id: 'bold', label: '**', open: '**', close: '**', hint: '加粗' },
  { id: 'ins', label: '{++ ++}', open: '{++', close: '++}', hint: '建议插入' },
  { id: 'del', label: '{-- --}', open: '{--', close: '--}', hint: '建议删除' },
  {
    id: 'sub',
    label: '{~~ ~> ~~}',
    open: '{~~',
    close: '~>~~}',
    hint: '建议替换',
  },
  { id: 'cmt', label: '{>> <<}', open: '{>>', close: '<<}', hint: '批注' },
  { id: 'para', label: '[0000]', open: '[0000] ', close: '', hint: '段号' },
]

/** 当前聚焦的 CodeMirror 视图（编辑 Tab 的全文 / 单书编辑器都挂在 .cm-editor 下） */
function focusedView(): EditorView | null {
  const el = document.activeElement?.closest('.cm-editor')
  return el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
}

function wrap(k: WrapKey) {
  const view = focusedView()
  if (!view) {
    editorCommands.insertText(k.open + k.close)
    return
  }
  view.dispatch(
    view.state.changeByRange((r) => {
      const text = view.state.sliceDoc(r.from, r.to)
      const insert = k.open + text + k.close
      const cursor = r.from + k.open.length + text.length
      return {
        changes: { from: r.from, to: r.to, insert },
        range: text ? EditorSelection.range(r.from + k.open.length, cursor) : EditorSelection.cursor(cursor),
      }
    }),
    { scrollIntoView: true, userEvent: 'input' },
  )
}

/** 键盘期间用 pointerdown 拦截默认行为：不夺走 CodeMirror 焦点、输入法不收起 */
const keepFocus = (e: PointerEvent) => e.preventDefault()

/** 编辑 Tab 内 CodeMirror 聚焦期间为 true（输入法弹出 → 底 Tab 让位 → 本键盘贴输入法上方） */
function useEditorFocused(): boolean {
  const [focused, setFocused] = useState(() => focusedView() !== null)
  useEffect(() => {
    const update = () => setFocused(document.activeElement?.closest('[data-testid=mobile-edit] .cm-editor') != null)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return focused
}

/**
 * Markdown · CriticMarkup 快捷键盘（05 §3.20）：编辑器聚焦时出现在编辑列底部（底 Tab 已让位，贴输入法上方），44 高一行横滚；
 * 键 44×≥44 mono 14：# · ** · {++ ++} · {-- --} · {~~ ~> ~~} · {>> <<} · [0000] ｜ 撤销 · 重做 · 定位到 PDF · 收起键盘。
 * 键用 Kbd 键帽承载，pointerdown preventDefault 保持 CodeMirror 焦点；`prefers-reduced-motion` 下无动效。
 */
export function MobileQuickKeys() {
  const focused = useEditorFocused()
  const readonly = useStudio(selectReadonly)
  const setMobileTab = useStudio((s) => s.setMobileTab)
  if (!focused) return null
  return (
    <div
      role="toolbar"
      aria-label="Markdown 快捷键盘"
      data-slot="MobileQuickKeys"
      data-testid="mobile-quick-keys"
      className="flex h-touch shrink-0 items-center gap-1.5 overflow-x-auto border-t bg-app px-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {KEYS.map((k) => (
        <Button
          key={k.id}
          size="xl"
          variant="ghost"
          className="h-touch min-w-touch shrink-0 px-1.5"
          aria-label={k.hint}
          title={k.hint}
          data-testid={`qk-${k.id}`}
          disabled={readonly}
          onPointerDown={keepFocus}
          onClick={() => wrap(k)}
        >
          <Kbd className="h-7 px-2 font-mono text-sm font-medium">{k.label}</Kbd>
        </Button>
      ))}
      <span className="mx-0.5 h-6 w-px shrink-0 bg-border" aria-hidden />
      <Button
        size="icon-xl"
        variant="ghost"
        className="shrink-0 text-fg-muted"
        aria-label="撤销"
        data-testid="qk-undo"
        disabled={readonly}
        onPointerDown={keepFocus}
        onClick={() => editorCommands.undo()}
      >
        <Undo2 className="size-5" />
      </Button>
      <Button
        size="icon-xl"
        variant="ghost"
        className="shrink-0 text-fg-muted"
        aria-label="重做"
        data-testid="qk-redo"
        disabled={readonly}
        onPointerDown={keepFocus}
        onClick={() => editorCommands.redo()}
      >
        <Redo2 className="size-5" />
      </Button>
      <Button size="icon-xl" variant="ghost" className="shrink-0 text-fg-muted" aria-label="定位到 PDF" data-testid="qk-locate" onClick={() => setMobileTab('preview')}>
        <Crosshair className="size-5" />
      </Button>
      <Button
        size="icon-xl"
        variant="ghost"
        className="ml-auto shrink-0 text-fg-muted"
        aria-label="收起键盘"
        data-testid="qk-dismiss"
        onClick={() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined)}
      >
        <ChevronDown className="size-5" />
      </Button>
    </div>
  )
}
