import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Save } from 'lucide-react'
import { Text } from '@codemirror/state'
import { BOOK_NAMES, blockAtLine } from '@/types/ast'
import { BOOK_LABELS, splitBooks } from '@/lib/docset'
import { SCROLL_REQUEST_FRESH_MS, selectBookDirty, selectReadonly, selectServerSlice, useStudio } from '@/store'
import { useIsDark } from '@/hooks/useMisc'
import { sectionAt } from '@/components/editor/section'
import { switchToView } from '@/components/workbench/ViewSwitch'
import { ReviewerSourceHint } from '@/components/editor/Editor'
import { SelectionActionBar, type EditorSelectionInfo } from '@/components/ai/SelectionActionBar'
import { CardEditor, type CardCursor, type CardEditorHandle } from './CardEditor'
import { CardHeader, CompareLockButton, HEADER_BUTTON } from './CardHeader'
import { toCardDiagnostics, toCardLine, toCardMarks, toFullLine } from './sync'
import { usePairedBlock } from './useCompareLock'
import { useRevealOnFocus } from './useRevealOnFocus'
import { useCollabSession } from '@/collab'
import type { SourceCardProps } from './types'

/**
 * 单书源码卡片（docs/plan/08-r4-dockview-design.md §4.1；D2 所有）。
 * value = splitBooks(doc.content).books[book].text，onChange → doc.setBookContent（只替换本书切片，content.md 其它字节不动）；
 * Mod-s → doc.saveBook（PUT /docs/{book}）；脏标 = selectBookDirty(book)，与状态栏 selectDirty 同源。
 * 同步：光标行换算成全文行写 doc.cursor（章节标签用 sectionAt 在全文上算，与 <Editor/> 一致）并写 activeBlock；
 * 只消费落在本书内的 scrollRequest；诊断 / CriticMarkup 标记按本书行区间过滤后换算成书相对行。
 * 三视图 Focus（PDF 单击 / 拖选、大纲、版面）落在本书而本卡片是 tab 组里被遮住的 tab → 露出自己；CardEditor 的 useSourceFocus 随后滚到块。
 * R8：每张单书卡片接房间 (pid, book)（useCollabSession，同书卡片共享会话）；协同生效时写盘由服务端去抖完成。
 */
export function SourceCard({ panelId, book, onSwitchBook }: SourceCardProps) {
  const content = useStudio((s) => s.content)
  const contentEditedAt = useStudio((s) => s.contentEditedAt)
  const setBookContent = useStudio((s) => s.setBookContent)
  const saveBook = useStudio((s) => s.saveBook)
  const saving = useStudio((s) => s.saving)
  const dirty = useStudio(selectBookDirty(book))
  const items = useStudio((s) => s.items)
  const marks = useStudio((s) => s.marks)
  const editorFontSize = useStudio((s) => s.editorFontSize)
  const scrollRequest = useStudio((s) => s.scrollRequest)
  const clearScrollRequest = useStudio((s) => s.clearScrollRequest)
  const registerEditor = useStudio((s) => s.registerEditor)
  const readonly = useStudio(selectReadonly)
  const role = useStudio((s) => s.project?.role ?? null)
  const dark = useIsDark()
  const ref = useRef<CardEditorHandle>(null)
  const collab = useCollabSession(book)
  const serverValue = useStudio(selectServerSlice(book))
  /** 选区浮动条（全文行）；容器 = 编辑器外层 relative 宿主 */
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null)
  const [slotHost, setSlotHost] = useState<HTMLDivElement | null>(null)
  /** 挂载前的旧请求不补跳；但 gotoLine 是「先激活/开卡再发请求」——卡挂载晚一拍，仍在新鲜窗内的 pending 请求要接住（R48-01）。
      新鲜度在挂载 effect 里判定（渲染期不调 Date.now——React Compiler 纯度）。 */
  const seenSeq = useRef(scrollRequest?.seq ?? 0)
  useEffect(() => {
    const p = useStudio.getState().scrollRequest
    if (p && Date.now() - p.at < SCROLL_REQUEST_FRESH_MS) seenSeq.current = p.seq - 1
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时判定一次
  }, [])

  const slice = useMemo(() => splitBooks(content).books[book], [content, book])
  const diagnostics = useMemo(() => toCardDiagnostics(items, content, book), [items, content, book])
  const cardMarks = useMemo(() => toCardMarks(marks, content, book), [marks, content, book])

  const onChange = useCallback((text: string) => setBookContent(book, text), [book, setBookContent])
  const onSave = useCallback(() => void saveBook(book), [book, saveBook])

  const onCursor = useCallback(
    (c: CardCursor) => {
      const s = useStudio.getState()
      const line = toFullLine(s.content, book, c.line)
      if (line == null) return
      s.setCursor({ line, col: c.col, section: sectionAt(Text.of(s.content.split('\n')), line).label })
      const loc = s.ast ? blockAtLine(s.ast, line) : null
      if (loc) s.setActiveBlock(loc.block.id, 'editor')
    },
    [book],
  )

  const onSelection = useCallback(
    (sel: EditorSelectionInfo | null) => {
      if (!sel) return setSelection(null)
      const c = useStudio.getState().content
      const lineStart = toFullLine(c, book, sel.lineStart)
      const lineEnd = toFullLine(c, book, sel.lineEnd)
      setSelection(lineStart == null || lineEnd == null ? null : { ...sel, lineStart, lineEnd })
    },
    [book],
  )

  const onFocus = useCallback(() => registerEditor(ref.current), [registerEditor])
  useEffect(() => {
    const handle = ref.current
    return () => {
      if (handle && useStudio.getState().editorHandle === handle) registerEditor(null)
    }
  }, [registerEditor])

  useEffect(() => {
    if (!scrollRequest || scrollRequest.seq <= seenSeq.current) return
    const line = toCardLine(content, book, scrollRequest.line)
    if (line == null) return
    seenSeq.current = scrollRequest.seq
    ref.current?.gotoLine(line)
    clearScrollRequest()
  }, [scrollRequest, content, book, clearScrollRequest])

  useRevealOnFocus(panelId, book, 'source')

  const paired = usePairedBlock(book, panelId)
  useEffect(() => {
    if (paired) ref.current?.scrollToLine(paired.block.lines.start)
  }, [paired])

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid={`card-source-${book}`}>
      <CardHeader
        title={BOOK_LABELS[book]}
        book={book}
        dirty={dirty}
        panelId={panelId}
        switchable={[...BOOK_NAMES, 'all']}
        onSwitchBook={onSwitchBook}
        actions={
          <>
            {saving && (
              <span className="text-xs text-fg-muted" data-testid="card-saving">
                保存中…
              </span>
            )}
            {readonly ? (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted" data-testid="card-readonly" title="查看者角色：只读">
                <Lock className="size-3" aria-hidden="true" />
                只读
              </span>
            ) : dirty ? (
              // R7：仅未保存改动时出现——selectDirty 在协同（服务端去抖落盘）与只读下恒 false，
              // 协同里这钮本就永久禁用；⌘S 与文件菜单保存保留
              <button
                type="button"
                aria-label={`保存${BOOK_LABELS[book]}`}
                title={`保存${BOOK_LABELS[book]}（Ctrl+S）`}
                disabled={saving}
                onClick={onSave}
                className={HEADER_BUTTON}
                data-testid="card-save"
              >
                <Save aria-hidden="true" />
              </button>
            ) : null}
            <CompareLockButton />
          </>
        }
      />
      {slice ? (
        <div ref={setSlotHost} className="relative flex min-h-0 flex-1 flex-col" data-testid={`card-slot-host-${book}`}>
          {role === 'reviewer' && <ReviewerSourceHint onSwitch={() => switchToView('layout')} />}
          <CardEditor
            ref={ref}
            value={slice.text}
            loaded={contentEditedAt === 0}
            onChange={onChange}
            onCursor={onCursor}
            onSelection={readonly ? undefined : onSelection}
            onSave={readonly ? undefined : onSave}
            onFocus={onFocus}
            lineBase={slice.offset}
            readOnly={readonly}
            dark={dark}
            diagnostics={diagnostics}
            marks={cardMarks}
            fontSize={editorFontSize}
            ariaLabel={`${BOOK_LABELS[book]}源码编辑器`}
            placeholder={`${BOOK_LABELS[book]}正文…`}
            className="min-h-0 flex-1 overflow-hidden"
            testId={`card-editor-${book}`}
            collabExtension={collab}
            serverValue={serverValue}
          />
          {!readonly && <SelectionActionBar selection={selection} container={slotHost} />}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-fg-muted" data-testid="card-no-book">
          全文中没有「## {BOOK_LABELS[book]}」章节，请在全文中补上后再按书编辑
        </div>
      )}
    </div>
  )
}
