import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Text } from '@codemirror/state'
import { useStudio, selectReadonly, selectServerSlice, type EditorHandle } from '@/store'
import type { BookName } from '@/types/ast'
import type { CriticMark, Diagnostic } from '@/lib/types'
import { BOOK_FILES, BOOK_HEADINGS, BOOK_LABELS, bookLineToFull, fullLineToBook, splitBooks, type DocSplit } from '@/lib/docset'
import { useIsDark } from '@/hooks/useMisc'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useCollabSession } from '@/collab'
import { SelectionActionBar, type EditorSelectionInfo } from '@/components/ai/SelectionActionBar'
import { CodeMirrorEditor, ReviewerSourceHint, type CursorReport } from '@/components/editor/Editor'
import { abstractDiagnostic, ABSTRACT_IDS } from '@/components/editor/abstractLint'
import { sectionAt } from '@/components/editor/section'

/** 书正文在全文中的字符起点（head + 之前各书标题/正文 + 本书标题行），CriticMark from/to 是全文偏移 */
function bookCharOffset(ds: DocSplit, book: BookName): number {
  let off = ds.head.length
  for (const b of ds.order) {
    const s = ds.books[b]!
    off += s.heading.length
    if (b === book) return off
    off += s.text.length
  }
  return off
}

/**
 * 375 单书编辑器（08 §9 移动退化；D3 所有）：书切换器选中单书时替换全文 <Editor/>，
 * CodeMirror 只装 docs/{book}.md 的正文（splitBooks 切片），击键经 setBookContent 回写全文（保持装配律，全文/PDF 构建照旧），
 * 保存走 saveBook → PUT /docs/{book}。诊断/CriticMark/光标/跳行在全文行与书相对行之间用 fullLineToBook / bookLineToFull 换算；
 * 光标章节标签仍按全文计算（书切片里没有 `## 书名` 标题行）。
 * 唯一解析器仍在后端：这里只切片与算偏移。
 */
export function MobileBookEditor({ book, className }: { book: BookName; className?: string }) {
  const content = useStudio((s) => s.content)
  const contentEditedAt = useStudio((s) => s.contentEditedAt)
  const setBookContent = useStudio((s) => s.setBookContent)
  const setActiveBook = useStudio((s) => s.setActiveBook)
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
  const readonly = useStudio(selectReadonly)
  const role = useStudio((s) => s.project?.role ?? null)
  const collab = useCollabSession(book)
  const serverValue = useStudio(selectServerSlice(book))
  const dark = useIsDark()
  const ref = useRef<EditorHandle>(null)
  const [slotHost, setSlotHost] = useState<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<EditorSelectionInfo | null>(null)

  const ds = useMemo(() => splitBooks(content), [content])
  const slice = ds.books[book]
  const present = slice !== undefined

  const bookDiagnostics = useMemo<Diagnostic[]>(() => {
    const out: Diagnostic[] = []
    for (const d of items) {
      if (d.line == null) continue
      const rel = fullLineToBook(ds, book, d.line)
      if (rel != null && rel >= 1) out.push({ ...d, line: rel })
    }
    return out
  }, [items, ds, book])

  const bookMarks = useMemo<CriticMark[]>(() => {
    if (!slice) return []
    const off = bookCharOffset(ds, book)
    const end = off + slice.text.length
    return marks
      .filter((m) => m.from >= off && m.to <= end)
      .map((m) => ({
        ...m,
        from: m.from - off,
        to: m.to - off,
        line: m.line - slice.offset,
      }))
  }, [marks, ds, book, slice])

  useEffect(() => {
    registerEditor(ref.current)
    return () => registerEditor(null)
  }, [registerEditor, book])

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

  // 大纲 / 问题列表 / F8 发来的是全文行：在本书内 → 换算后跳；在别的书 → 切书（由新实例消费）；头部 → 回全文
  useEffect(() => {
    if (!scrollRequest) return
    const rel = fullLineToBook(ds, book, scrollRequest.line)
    if (rel != null) {
      ref.current?.gotoLine(Math.max(1, rel))
      clearScrollRequest()
      return
    }
    for (const b of ds.order) {
      if (fullLineToBook(ds, b, scrollRequest.line) != null) {
        setActiveBook(b)
        return
      }
    }
    setActiveBook('all')
  }, [scrollRequest, ds, book, clearScrollRequest, setActiveBook])

  const onCursor = useMemo(
    () => (c: CursorReport) => {
      const md = useStudio.getState().content
      const full = bookLineToFull(splitBooks(md), book, c.line) ?? c.line
      setCursor({
        line: full,
        col: c.col,
        section: sectionAt(Text.of(md.split('\n')), full).label,
      })
    },
    [setCursor, book],
  )

  // 选区动作条（AI 改写 / 润色）按全文行号工作：书相对行 → 全文行
  const onSelection = useCallback(
    (sel: EditorSelectionInfo | null) => {
      if (!sel) return setSelection(null)
      const d = splitBooks(useStudio.getState().content)
      const lineStart = bookLineToFull(d, book, sel.lineStart)
      const lineEnd = bookLineToFull(d, book, sel.lineEnd)
      setSelection(lineStart == null || lineEnd == null ? null : { ...sel, lineStart, lineEnd })
    },
    [book],
  )

  if (!present) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-fg-muted', className)} data-testid="mobile-book-missing">
        <p>正文里没有「{BOOK_HEADINGS[book]}」章节，无法按书编辑。</p>
        <button
          type="button"
          className={cn('h-touch rounded px-3 text-primary-text underline-offset-2 hover:underline', FOCUS_RING)}
          onClick={() => setActiveBook('all')}
        >
          回到全文
        </button>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 flex-col bg-panel', className)} data-slot="MobileBookEditor" data-testid="mobile-book-editor" data-book={book} data-file={BOOK_FILES[book]}>
      <div ref={setSlotHost} className="relative flex min-h-0 flex-1 flex-col" data-testid="mobile-book-slot-host">
        {role === 'reviewer' && <ReviewerSourceHint />}
        <CodeMirrorEditor
          key={book}
          ref={ref}
          value={slice.text}
          loaded={contentEditedAt === 0}
          onChange={(v) => setBookContent(book, v)}
          onCursor={onCursor}
          onSelection={readonly ? undefined : onSelection}
          dark={dark}
          diagnostics={bookDiagnostics}
          marks={bookMarks}
          fontSize={editorFontSize}
          collabExtension={collab}
          readOnly={readonly}
          serverValue={serverValue}
          lineBase={slice.offset}
          placeholder={`${BOOK_LABELS[book]}尚无内容`}
          className="min-h-0 flex-1 overflow-hidden"
        />
        {!readonly && <SelectionActionBar selection={selection} container={slotHost} />}
      </div>
    </div>
  )
}
