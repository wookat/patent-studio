import { useEffect, useImperativeHandle, useRef, useState, forwardRef, type CSSProperties } from 'react'
import type { EditorHandle } from '@/store'
import type { CriticMark, Diagnostic } from '@/lib/types'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, scrollPastEnd, placeholder as cmPlaceholder,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search'
import { bracketMatching } from '@codemirror/language'
import { diagnosticsExtension, setDiagnostics, groupByLine, flashLine } from '@/components/editor/diagnostics'
import { nativeUndoGuard } from '@/components/editor/nativeUndoGuard'
import { chromeTheme, syntaxTheme, zhPhrases } from '@/components/editor/theme'
import { insertSpec, notifyEditorUpdate, registerEditorView } from '@/components/editor/commands'
import { selectionInfo } from '@/components/editor/selectionInfo'
import { sourceFocusExtensions, useSourceFocus } from '@/components/editor/sourceFocus'
import type { EditorSelectionInfo } from '@/components/ai/SelectionActionBar'
import { criticExtension, setCriticMarks } from '@/components/review/criticExtension'
import { minimalChange } from './sync'

/**
 * 卡片自持的 CodeMirror 宿主（docs/plan/08-r4-dockview-design.md §4.1；D2 所有）。
 * 与 editor/Editor.tsx 的 CodeMirrorEditor 同一套扩展装配（主题 / 诊断 gutter / CriticMarkup / 中文短语 / 键位），
 * 差异只在多卡片场景需要的三点：
 *  - `readOnly`（全文镜像卡片）；
 *  - `Mod-s` 在卡片内被拦截为 onSave（单书保存 PUT /docs/{book}），不冒泡到 window 的全文保存；
 *  - 命令 registry（菜单 撤销/重做/插入、附图插入引用）随**焦点**切到当前卡片，而不是随挂载顺序。
 * 行号全部是卡片相对行；全文行换算在 SourceCard（sync.ts）里做。
 * `collabExtension`（R8）：与 CodeMirrorEditor 同一套约定——放在 baseKeymap 之前的 Compartment 里热重配；接上后 Y.Text 是本书真相：
 * 编辑器自己刚发出（onChange）的快照从 `value` 回源时不再回写，其他外部 `value`（接受修订 / 术语统一 / AI 应用 / 恢复备份等）
 * 作为带 userEvent 的普通变更进入 Y.Text 广播给对端。同书多卡片共享同一个 Y.Doc（collab/registry），彼此经 ySync 即时互通。
 */

export interface CardCursor {
  line: number
  col: number
}

export interface CardEditorHandle extends EditorHandle {
  /** 只滚动不动光标（对照滚动锁从卡片用；不触发 onCursor，避免两卡片互相回环） */
  scrollToLine(line: number): void
  hasFocus(): boolean
}

interface Props {
  value: string
  onChange?: (v: string) => void
  /** 为 true 时 value 视为「加载」：整体替换并重建 undo 栈 */
  loaded?: boolean
  readOnly?: boolean
  dark: boolean
  /** 卡片相对行的诊断 / 标记（调用方已用 sync.toCardDiagnostics / toCardMarks 过滤） */
  diagnostics?: readonly Diagnostic[]
  marks?: readonly CriticMark[]
  onCursor?: (c: CardCursor) => void
  /** 非空选区（卡片相对行；与 onCursor 同步防抖）；选区消失 / 失焦时 null。供选区浮动动作条 */
  onSelection?: (s: EditorSelectionInfo | null) => void
  onSave?: () => void
  onFocus?: () => void
  /** 本卡片第 1 行在 content.md 里的行基（全文行 = 卡片行 + lineBase）；命令 registry 按全文行写入时据此换算 */
  lineBase?: number
  ariaLabel: string
  placeholder?: string
  className?: string
  fontSize?: number
  testId?: string
  collabExtension?: Extension
  /** 服务端已落盘的本书文本（store.serverContent 切片）：协同中 value 与之相同时不写 Y.Text，等房间下发对齐 */
  serverValue?: string | null
}

const lockExtension = (readOnly: boolean): Extension => [
  EditorView.contentAttributes.of({ 'aria-readonly': readOnly ? 'true' : 'false' }),
  ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
]

const NONE: readonly never[] = []
/** 协同中保留的最近 onChange 快照数（React 提交与 ws 消息交错时 value 可能落后若干步） */
const EMITTED_KEEP = 8
const CURSOR_DEBOUNCE_MS = 100
const FLASH_MS = 1200

const baseKeymap: Extension = keymap.of([
  ...defaultKeymap.filter((b) => b.key !== 'Mod-Enter'),
  ...historyKeymap,
  ...searchKeymap,
  indentWithTab,
])

/** 最近一次由卡片注册到命令 registry 的视图：卸载时只注销自己，不打掉别的卡片 */
let registeredCardView: EditorView | null = null

function registerCard(view: EditorView, lineBase: () => number) {
  registeredCardView = view
  registerEditorView(view, lineBase)
}

function unregisterCard(view: EditorView) {
  if (registeredCardView !== view) return
  registeredCardView = null
  registerEditorView(null)
}

export const CardEditor = forwardRef<CardEditorHandle, Props>(function CardEditor(
  {
    value, onChange, loaded = false, readOnly = false, dark, diagnostics = NONE, marks = NONE,
    onCursor, onSelection, onSave, onFocus, lineBase = 0, ariaLabel, placeholder, className, fontSize, testId = 'card-editor', collabExtension,
    serverValue = null,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const cb = useRef({ onChange, onCursor, onSelection, onSave, onFocus })
  const lineBaseRef = useRef(lineBase)
  lineBaseRef.current = lineBase
  const diagRef = useRef(diagnostics)
  const marksRef = useRef(marks)
  const themeComp = useRef(new Compartment())
  const collabComp = useRef(new Compartment())
  const lockComp = useRef(new Compartment())
  const collabRef = useRef(collabExtension)
  collabRef.current = collabExtension
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const serverRef = useRef(serverValue)
  serverRef.current = serverValue
  const emitted = useRef<string[]>([])
  const valueRef = useRef(value)
  valueRef.current = value
  const cursorTimer = useRef<number | null>(null)
  const flashTimer = useRef<number | null>(null)
  cb.current = { onChange, onCursor, onSelection, onSave, onFocus }
  diagRef.current = diagnostics
  marksRef.current = marks
  const [mounted, setMounted] = useState(false)
  const focusDriver = useSourceFocus(viewRef, () => lineBaseRef.current, mounted)

  const reportCursor = (view: EditorView) => {
    if (cursorTimer.current != null) window.clearTimeout(cursorTimer.current)
    cursorTimer.current = window.setTimeout(() => {
      cursorTimer.current = null
      if (viewRef.current !== view) return
      const head = view.state.selection.main.head
      const l = view.state.doc.lineAt(head)
      cb.current.onCursor?.({ line: l.number, col: head - l.from + 1 })
      cb.current.onSelection?.(selectionInfo(view))
    }, CURSOR_DEBOUNCE_MS)
  }

  const createState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        bracketMatching(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorState.phrases.of(zhPhrases),
        EditorView.lineWrapping,
        scrollPastEnd(),
        markdown({ base: markdownLanguage }),
        ...(placeholder ? [cmPlaceholder(placeholder)] : []),
        diagnosticsExtension(),
        criticExtension(),
        // 协同锁（sync 前 / viewer）必须排在 readOnly / editable 之前：两个 facet 都是“首个值胜”
        collabComp.current.of(collabRef.current ?? []),
        themeComp.current.of([chromeTheme(dark), syntaxTheme(dark)]),
        lockComp.current.of(lockExtension(readOnlyRef.current)),
        nativeUndoGuard,
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              cb.current.onSave?.()
              return true
            },
          },
        ]),
        baseKeymap,
        ...sourceFocusExtensions(focusDriver, () => lineBaseRef.current),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const doc = u.state.doc.toString()
            if (collabRef.current) emitted.current = [...emitted.current.slice(1 - EMITTED_KEEP), doc]
            cb.current.onChange?.(doc)
          }
          if ((u.docChanged || u.selectionSet || u.focusChanged) && u.view.hasFocus) reportCursor(u.view)
          else if (u.focusChanged && !u.view.hasFocus) cb.current.onSelection?.(null)
          if (u.focusChanged && u.view.hasFocus) {
            if (!readOnlyRef.current) registerCard(u.view, () => lineBaseRef.current)
            cb.current.onFocus?.()
          }
          if ((u.docChanged || u.selectionSet) && !readOnlyRef.current) notifyEditorUpdate()
        }),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false', tabindex: '0' }),
      ],
    })

  const jumpTo = (view: EditorView, line: number) => {
    const n = Math.max(1, Math.min(line, view.state.doc.lines))
    const l = view.state.doc.line(n)
    view.dispatch({
      selection: { anchor: l.from },
      effects: [EditorView.scrollIntoView(l.from, { y: 'center' }), flashLine.of(n)],
    })
    view.focus()
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null
      if (viewRef.current === view) view.dispatch({ effects: flashLine.of(null) })
    }, FLASH_MS)
  }

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ state: createState(value), parent: host.current })
    viewRef.current = view
    view.dispatch({ effects: [setDiagnostics.of(groupByLine(diagRef.current)), setCriticMarks.of(marksRef.current)] })
    setMounted(true)
    return () => {
      setMounted(false)
      if (cursorTimer.current != null) window.clearTimeout(cursorTimer.current)
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current)
      unregisterCard(view)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur === value) return
    const collab = collabRef.current != null
    // 服务端已落盘同一文本（恢复版本 / 块补丁）：房间会下发，本端再写 Y.Text 会与之并发成双份
    if (collab && serverRef.current === value) return
    const external = () => {
      const v = viewRef.current
      if (!v) return
      const now = v.state.doc.toString()
      if (now !== value) v.dispatch({ changes: minimalChange(now, value), userEvent: collab ? 'input.external' : undefined })
    }
    if (collab && emitted.current.includes(value)) {
      // 旧快照回源：可能是 React 提交落后于协同变更（马上会有新 value），也可能是有意恢复到旧文本（拒绝修订 / 撤销建议）；
      // 推到下一拍再看：value 仍是它且与文档不同 ⇒ 是有意的，写进 Y.Text
      const t = window.setTimeout(() => {
        if (valueRef.current === value) external()
      }, 0)
      return () => window.clearTimeout(t)
    }
    if (loaded) {
      view.setState(createState(value))
      view.dispatch({ effects: [setDiagnostics.of(groupByLine(diagRef.current)), setCriticMarks.of(marksRef.current)] })
      view.scrollDOM.scrollTop = 0
    } else {
      external()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeComp.current.reconfigure([chromeTheme(dark), syntaxTheme(dark)]) })
  }, [dark])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setDiagnostics.of(groupByLine(diagnostics)) })
  }, [diagnostics])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setCriticMarks.of(marks) })
  }, [marks])

  useEffect(() => {
    emitted.current = []
    viewRef.current?.dispatch({ effects: collabComp.current.reconfigure(collabExtension ?? []) })
  }, [collabExtension])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: lockComp.current.reconfigure(lockExtension(readOnly)) })
  }, [readOnly])

  useImperativeHandle(ref, () => ({
    gotoLine(line) {
      if (viewRef.current) jumpTo(viewRef.current, line)
    },
    scrollToLine(line) {
      const view = viewRef.current
      if (!view) return
      const n = Math.max(1, Math.min(line, view.state.doc.lines))
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(n).from, { y: 'start' }) })
    },
    hasFocus() {
      return viewRef.current?.hasFocus ?? false
    },
    openSearch() {
      if (viewRef.current) openSearchPanel(viewRef.current)
    },
    focus() {
      viewRef.current?.focus()
    },
    undo() {
      const view = viewRef.current
      if (!view) return
      undo(view)
      view.focus()
    },
    redo() {
      const view = viewRef.current
      if (!view) return
      redo(view)
      view.focus()
    },
    insertSnippet(kind) {
      const view = viewRef.current
      if (!view || readOnly) return
      const spec = insertSpec(view.state, kind)
      if (spec) view.dispatch(spec)
      view.focus()
    },
  }), [readOnly])

  const style = fontSize ? ({ '--editor-font-size': `${fontSize}px` } as CSSProperties) : undefined
  return <div ref={host} className={className} style={style} data-testid={testId} />
})
