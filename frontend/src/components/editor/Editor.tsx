import { createElement, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, type CSSProperties, type ReactNode } from 'react'
import { useStudio, selectEditorMode, selectReadonly, selectServerSlice, type EditorHandle } from '@/store'
import type { CriticMark, Diagnostic } from '@/lib/types'
import { useIsDark, useIsDesktop } from '@/hooks/useMisc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, scrollPastEnd, placeholder as cmPlaceholder,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search'
import { bracketMatching } from '@codemirror/language'
import { diagnosticsExtension, setDiagnostics, groupByLine, flashLine } from './diagnostics'
import { nativeUndoGuard } from './nativeUndoGuard'
import { sectionAt, type CursorSection } from './section'
import { abstractDiagnostic, ABSTRACT_IDS } from './abstractLint'
import { chromeTheme, syntaxTheme, zhPhrases } from './theme'
import { insertSpec, notifyEditorUpdate, registerEditorView } from './commands'
import { sourceFocusExtensions, useSourceFocus } from './sourceFocus'
import { selectionInfo } from './selectionInfo'
import { EditorTabs } from './EditorTabs'
import { EditorToolbar } from './EditorToolbar'
import { switchView } from './ViewTabs'
import { LayoutView } from '@/components/layout-view'
import { criticExtension, setCriticMarks } from '@/components/review/criticExtension'
import { SelectionActionBar, type EditorExtensionSlotProps, type EditorSelectionInfo } from '@/components/ai/SelectionActionBar'
import { useCollabSession } from '@/collab'
import { useEditorSlotExtensions } from '@/lib/slots'

export type { EditorHandle }
export type { EditorExtensionSlotProps, EditorSelectionInfo }

export const EMPTY_PLACEHOLDER = '输入 # 标题 开始…'
const NO_MARKS: readonly CriticMark[] = []
const CURSOR_DEBOUNCE_MS = 100
const FLASH_MS = 1200

export interface CursorReport extends CursorSection {
  line: number
  col: number
}

interface Props {
  value: string
  onChange: (v: string) => void
  /**
   * 为 true 时 value 视为「加载」（首屏/切案/恢复备份）：整体替换且重建 undo 栈；
   * 为 false 时视为外部编辑，作为普通变更进入历史。
   */
  loaded?: boolean
  dark: boolean
  diagnostics: readonly Diagnostic[]
  /** R6 CriticMarkup 标记（store review.marks），由 components/review/criticExtension 渲染为装饰 */
  marks?: readonly CriticMark[]
  /** 光标行列 + 所在章节，防抖 100ms */
  onCursor?: (c: CursorReport) => void
  /** 非空选区（与 onCursor 同步防抖）；选区消失 / 失焦时 null。供选区浮动动作条（E4） */
  onSelection?: (s: EditorSelectionInfo | null) => void
  /** 额外 CodeMirror 扩展（单元自带的装饰 / 键位）；放在 Compartment 中，数组引用变化时热重配（不重建 state） */
  extensions?: readonly Extension[]
  placeholder?: string
  className?: string
  /** 正文字号 px（覆写 index.css --editor-font-size，默认 12） */
  fontSize?: number
  /**
   * R8 协同扩展插槽（docs/plan/11 §5.3；由 `@/collab` 的 `collabExtension(session, readonly)` 提供）。
   * 放在 baseKeymap 之前的 Compartment，变化时热重配，不重建 state。撤销仍是编辑器自己的 history 一套栈（Mod-z / 工具栏 /
   * 菜单）：远端 ySync 事务标 addToHistory=false，撤销只撤本端；不用 Y.UndoManager。
   * 协同接上后 Y.Text 才是真相：编辑器自己刚发出（onChange）的旧快照从 `value` 回源时不再回写文档，
   * 其他外部 `value`（接受修订 / 导入 / 改名等）作为带 userEvent 的普通变更进入 Y.Text 广播给对端。
   * 未传 = 现状（本地编辑 + PUT /content）。
   */
  collabExtension?: Extension
  /** 服务端已落盘的本编辑器文本（selectServerSlice）：协同中 value 与之相同时不写 Y.Text，等房间下发对齐 */
  serverValue?: string | null
  /** 只读壳（viewer 角色）：readOnly + 不可编辑；与协同锁同一重建机制（Compartment 热重配） */
  readOnly?: boolean
  /** 文档首行在全文 content.md 中的行偏移（单书编辑器）：editorCommands 的全文行号由此换算到本视图 */
  lineBase?: number
}

/** 协同中保留的最近 onChange 快照数（React 提交与 ws 消息交错时 value 可能落后若干步） */
const EMITTED_KEEP = 8

/**
 * 编辑器不自己绑定 Mod-s / Mod-Enter 等页面级快捷键：由 StoreBootstrap 的 window keydown → dispatchHotkey 统一处理
 * （CodeMirror 自己没消费的按键会冒泡到 window；Mod-f 由全局 find 动作调 editorHandle.openSearch）。
 * defaultKeymap 的 Mod-Enter（insertBlankLine）会吞掉「立即构建」，从编辑器键位表里剔除。
 */
const baseKeymap: Extension = keymap.of([
  ...defaultKeymap.filter((b) => b.key !== 'Mod-Enter'),
  ...historyKeymap,
  ...searchKeymap,
  indentWithTab,
])

const NO_EXTENSIONS: readonly Extension[] = []

const lockExtension = (readOnly: boolean): Extension =>
  readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []

function placeholderDom(text: string) {
  return () => {
    const wrap = document.createElement('span')
    wrap.className = 'cm-empty-hint'
    wrap.setAttribute('data-testid', 'editor-placeholder')
    const main = document.createElement('span')
    main.textContent = text
    main.style.display = 'block'
    const sub = document.createElement('span')
    sub.textContent = '一级标题为发明名称；随后 ## 摘要、## 权利要求书、## 说明书 三个二级章节'
    sub.style.display = 'block'
    sub.style.fontSize = 'var(--fs-xs)'
    sub.style.opacity = '0.8'
    sub.style.marginTop = '4px'
    wrap.appendChild(main)
    wrap.appendChild(sub)
    return wrap
  }
}

/** 受控 CodeMirror 封装（只在三视图 Focus 收发处读 store，供测试/复用） */
export const CodeMirrorEditor = forwardRef<EditorHandle, Props>(function CodeMirrorEditor(
  { value, onChange, loaded = false, dark, diagnostics, marks = NO_MARKS, onCursor, onSelection, extensions = NO_EXTENSIONS, placeholder = EMPTY_PLACEHOLDER, className, fontSize, collabExtension, readOnly = false, lineBase = 0, serverValue = null },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const lineBaseRef = useRef(lineBase)
  lineBaseRef.current = lineBase
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorRef = useRef(onCursor)
  const onSelectionRef = useRef(onSelection)
  const extensionsRef = useRef(extensions)
  const diagRef = useRef(diagnostics)
  const marksRef = useRef(marks)
  const themeComp = useRef(new Compartment())
  const collabComp = useRef(new Compartment())
  const collabRef = useRef(collabExtension)
  collabRef.current = collabExtension
  const lockComp = useRef(new Compartment())
  const extComp = useRef(new Compartment())
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const serverRef = useRef(serverValue)
  serverRef.current = serverValue
  const emitted = useRef<string[]>([])
  const flashTimer = useRef<number | null>(null)
  // W5 三视图（21 §5.2 / §5.5）：光标块 → Focus{source:'source'}；其他视图的 Focus → 滚到行并闪烁
  const [mounted, setMounted] = useState(false)
  const focusDriver = useSourceFocus(viewRef, () => lineBaseRef.current, mounted)
  const valueRef = useRef(value)
  valueRef.current = value
  const cursorTimer = useRef<number | null>(null)
  /** 最近一次 gotoLine 的行：视图在同一实例内重建（StrictMode 二次 mount）时重放，否则结构→源码的跳行落在被销毁的视图上 */
  const lastGoto = useRef<number | null>(null)
  onChangeRef.current = onChange
  onCursorRef.current = onCursor
  onSelectionRef.current = onSelection
  extensionsRef.current = extensions
  diagRef.current = diagnostics
  marksRef.current = marks

  const reportCursor = (view: EditorView) => {
    if (cursorTimer.current != null) window.clearTimeout(cursorTimer.current)
    cursorTimer.current = window.setTimeout(() => {
      cursorTimer.current = null
      if (viewRef.current !== view) return
      const cb = onCursorRef.current
      if (cb) {
        const head = view.state.selection.main.head
        const l = view.state.doc.lineAt(head)
        cb({ line: l.number, col: head - l.from + 1, ...sectionAt(view.state.doc, l.number) })
      }
      onSelectionRef.current?.(selectionInfo(view))
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
        cmPlaceholder(placeholderDom(placeholder)),
        diagnosticsExtension(),
        criticExtension(),
        themeComp.current.of([chromeTheme(dark), syntaxTheme(dark)]),
        lockComp.current.of(lockExtension(readOnlyRef.current)),
        collabComp.current.of(collabRef.current ?? []),
        nativeUndoGuard,
        baseKeymap,
        ...sourceFocusExtensions(focusDriver, () => lineBaseRef.current),
        extComp.current.of([...extensionsRef.current]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const doc = u.state.doc.toString()
            if (collabRef.current) emitted.current = [...emitted.current.slice(1 - EMITTED_KEEP), doc]
            onChangeRef.current(doc)
          }
          if ((u.docChanged && u.view.hasFocus) || u.selectionSet || u.focusChanged) reportCursor(u.view)
          if (u.docChanged || u.selectionSet) notifyEditorUpdate()
        }),
        EditorView.contentAttributes.of({ 'aria-label': '全文源码编辑器', spellcheck: 'false', tabindex: '0' }),
      ],
    })

  const jumpTo = (view: EditorView, line: number) => {
    const n = Math.max(1, Math.min(line, view.state.doc.lines))
    const l = view.state.doc.line(n)
    lastGoto.current = n
    view.dispatch({
      selection: { anchor: l.from },
      effects: [EditorView.scrollIntoView(l.from, { y: 'center' }), flashLine.of(n)],
    })
    view.focus()
    if (flashTimer.current != null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null
      lastGoto.current = null
      if (viewRef.current === view) view.dispatch({ effects: flashLine.of(null) })
    }, FLASH_MS)
  }

  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({ state: createState(value), parent: host.current })
    viewRef.current = view
    view.dispatch({ effects: [setDiagnostics.of(groupByLine(diagRef.current)), setCriticMarks.of(marksRef.current)] })
    registerEditorView(view, () => lineBaseRef.current)
    if (lastGoto.current != null) jumpTo(view, lastGoto.current)
    setMounted(true)
    return () => {
      setMounted(false)
      if (cursorTimer.current != null) window.clearTimeout(cursorTimer.current)
      if (flashTimer.current != null) window.clearTimeout(flashTimer.current)
      registerEditorView(null)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: extComp.current.reconfigure([...extensions]) })
  }, [extensions])

  // 外部 value 变化：加载态 → 重建 state（不进 undo 栈）；否则作为普通变更
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
      if (now !== value) v.dispatch({ changes: { from: 0, to: now.length, insert: value }, userEvent: collab ? 'input.external' : undefined })
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
      notifyEditorUpdate()
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
    emitted.current = []
    viewRef.current?.dispatch({ effects: collabComp.current.reconfigure(collabExtension ?? []) })
  }, [collabExtension])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: lockComp.current.reconfigure(lockExtension(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setCriticMarks.of(marks) })
  }, [marks])

  useImperativeHandle(ref, () => ({
    gotoLine(line) {
      if (viewRef.current) jumpTo(viewRef.current, line)
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
      if (!view || readOnlyRef.current) return
      const spec = insertSpec(view.state, kind)
      if (spec) view.dispatch(spec)
      view.focus()
    },
  }))

  const style = fontSize ? ({ '--editor-font-size': `${fontSize}px` } as CSSProperties) : undefined
  return <div ref={host} className={className} style={style} data-testid="editor" />
})

interface EditorProps {
  className?: string
  /** 是否渲染 EditorTabs + EditorToolbar（默认：桌面显示，移动壳不显示，对照 prototype-c ?mobile&tab=edit） */
  chrome?: boolean
  /**
   * 扩展插槽（轨道 E prep，09 §6.2）：渲染在 CodeMirror 上方的浮层（容器 position:relative），收到当前选区与容器；
   * 默认 SelectionActionBar（E4 在 components/ai/ 内实现，prep 为空）。结构视图下不渲染。
   */
  renderExtension?: (props: EditorExtensionSlotProps) => ReactNode
  /** 额外 CodeMirror 扩展，透传 CodeMirrorEditor */
  extensions?: readonly Extension[]
}

/**
 * store 接线版：内容/主题/诊断来自 useStudio；光标行列 + 章节标签（防抖）写 doc.cursor；
 * 摘要字数超限 / 接近上限即时写 diagnostics client 源（id=abstract.limit error / abstract.near_limit warning，与后端 lint 合并）；
 * 消费 doc.scrollRequest（OutlinePanel/ProblemList/F8 通过 doc.gotoLine 发出），命令句柄注册到 doc.editorHandle（find/focus）。
 * 编辑器区竖向组合（07 §2.1）：EditorTabs 32 / EditorToolbar 32 / CodeMirror 弹性填满；工具栏经 ./commands registry 操作同一个视图。
 * R1（04 §5.1）/ W4-D：桌面且 ui.editorView === 'layout' 时用 <LayoutView/>（模式随 selectEditorMode）替换 CodeMirror；移动端强制源码；
 * 结构模式下收到 scrollRequest（大纲/问题列表定位）先切回源码再跳行。
 */
export function Editor({ className, chrome, renderExtension = SelectionActionBar, extensions }: EditorProps) {
  const desktop = useIsDesktop()
  const showChrome = chrome ?? desktop
  const content = useStudio((s) => s.content)
  const contentEditedAt = useStudio((s) => s.contentEditedAt)
  const setContent = useStudio((s) => s.setContent)
  const setCursor = useStudio((s) => s.setCursor)
  const registerEditor = useStudio((s) => s.registerEditor)
  const items = useStudio((s) => s.items)
  const marks = useStudio((s) => s.marks)
  const clientItems = useStudio((s) => s.clientItems)
  const setClient = useStudio((s) => s.setClient)
  const limit = useStudio((s) => s.settings?.abstract_limit ?? 300)
  const scrollRequest = useStudio((s) => s.scrollRequest)
  const clearScrollRequest = useStudio((s) => s.clearScrollRequest)
  const editorFontSize = useStudio((s) => s.editorFontSize)
  const editorView = useStudio((s) => s.editorView)
  const setEditorView = useStudio((s) => s.setEditorView)
  const structure = desktop && editorView === 'layout'
  const editorMode = useStudio(selectEditorMode)
  const role = useStudio((s) => s.project?.role ?? null)
  const dark = useIsDark()
  const ref = useRef<EditorHandle>(null)
  const [slotHost, setSlotHost] = useState<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null)
  // R8：单编辑器编的是装配镜像 content.md ⇒ 房间 (pid, 'content')；R4 多卡片后按当前书传入
  const collab = useCollabSession('content')
  const readonly = useStudio(selectReadonly)
  const serverValue = useStudio(selectServerSlice('content'))
  // lib/slots.ts 注入点：功能单元 registerEditorExtension 的扩展合并进来（引用随注册表变化，触发 Compartment 热重配）
  const slotFactories = useEditorSlotExtensions()
  const allExtensions = useMemo<readonly Extension[]>(
    () => [...(extensions ?? []), ...slotFactories.map((f) => f())],
    [extensions, slotFactories],
  )

  useEffect(() => {
    registerEditor(structure ? null : ref.current)
    return () => registerEditor(null)
  }, [registerEditor, structure])

  // 摘要 live 计数 → client 诊断（仅在结果变化时写 store，避免每次击键都触发合并）
  useEffect(() => {
    const next = abstractDiagnostic(content, limit)
    const prev = clientItems.find((d) => ABSTRACT_IDS.includes(d.id)) ?? null
    const same =
      (next == null && prev == null) ||
      (next != null && prev != null && next.id === prev.id && next.message === prev.message && next.line === prev.line && next.severity === prev.severity)
    if (same) return
    const others = clientItems.filter((d) => !ABSTRACT_IDS.includes(d.id))
    setClient(next ? [...others, next] : others)
  }, [content, limit, clientItems, setClient])

  useEffect(() => {
    if (!scrollRequest) return
    if (structure) {
      setEditorView('source')
      return
    }
    ref.current?.gotoLine(scrollRequest.line)
    clearScrollRequest()
  }, [scrollRequest, clearScrollRequest, structure, setEditorView])

  const onCursor = useMemo(
    () => (c: CursorReport) => setCursor({ line: c.line, col: c.col, section: c.label }),
    [setCursor],
  )

  return (
    <div className={cn('flex min-h-0 flex-col bg-panel', className)} data-slot="Editor" data-testid="editor-area">
      {showChrome && <EditorTabs />}
      {showChrome && <EditorToolbar />}
      {structure ? (
        <LayoutView className="min-h-0 flex-1 overflow-auto" mode={editorMode} />
      ) : (
        <div ref={setSlotHost} className="relative flex min-h-0 flex-1 flex-col" data-testid="editor-slot-host">
          {role === 'reviewer' && <ReviewerSourceHint onSwitch={desktop ? () => switchView('layout') : undefined} />}
          <CodeMirrorEditor
            ref={ref}
            value={content}
            loaded={contentEditedAt === 0}
            onChange={setContent}
            onCursor={onCursor}
            onSelection={setSelection}
            extensions={allExtensions}
            dark={dark}
            diagnostics={items}
            marks={marks}
            fontSize={editorFontSize}
            collabExtension={collab}
            readOnly={readonly}
            serverValue={serverValue}
            className="min-h-0 flex-1 overflow-hidden"
          />
          {!readonly && createElement(renderExtension, { selection, container: slotHost })}
        </div>
      )}
    </div>
  )
}

/**
 * reviewer 源码视图提示（14 D5.2）：协同房间对 reviewer 只读，直接键入不会变成建议；建议在版面视图键入（自动 toCritic），
 * 或选中文字后在审阅面板「添加批注」。移动端无版面视图，不给切换按钮。
 */
export function ReviewerSourceHint({ onSwitch }: { onSwitch?: () => void }) {
  return (
    <div
      role="status"
      data-testid="reviewer-source-hint"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-warn-bg px-3 py-1.5 text-xs text-fg"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-warn-dot" aria-hidden />
      <span className="font-medium text-warn-fg">审阅者：源码视图只读</span>
      <span className="text-fg-muted">{onSwitch ? '在版面视图中键入会自动变成修改建议；' : ''}选中文字后可在审阅面板添加批注。</span>
      {onSwitch && (
        <Button variant="secondary" size="xs" className="ml-auto" onClick={onSwitch}>
          切到版面视图提建议
        </Button>
      )}
    </div>
  )
}
