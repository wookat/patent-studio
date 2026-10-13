import { useCallback, useEffect, useRef, useState } from 'react'
import { PencilLine } from 'lucide-react'
import { Text } from '@codemirror/state'
import { BOOK_NAMES, blockAtLine } from '@/types/ast'
import { BOOK_LABELS } from '@/lib/docset'
import { SCROLL_REQUEST_FRESH_MS, selectDirty, useStudio } from '@/store'
import { makePanelId } from '@/store/layout'
import { useIsDark } from '@/hooks/useMisc'
import { sectionAt } from '@/components/editor/section'
import { CardEditor, type CardCursor, type CardEditorHandle } from './CardEditor'
import { CardHeader, HEADER_BUTTON } from './CardHeader'
import { bookAtFullLine } from './sync'
import type { CardProps } from './types'

/**
 * 全文卡片 source:all（§4.1）：content.md 的**只读**合并镜像（三书装配律 assemble(split(md)) === md 保证与磁盘一致），
 * 不触碰 doc.content。光标仍上报全文行（大纲 / 结构 / PDF 照常定位）；
 * 「在单书卡片中编辑」把光标所在书的源码卡片拆分到右侧（走 store.openPanel，D1 落地）。
 */
export function FullTextCard({ panelId, onSwitchBook }: CardProps) {
  const content = useStudio((s) => s.content)
  const contentEditedAt = useStudio((s) => s.contentEditedAt)
  const items = useStudio((s) => s.items)
  const marks = useStudio((s) => s.marks)
  const editorFontSize = useStudio((s) => s.editorFontSize)
  const scrollRequest = useStudio((s) => s.scrollRequest)
  const clearScrollRequest = useStudio((s) => s.clearScrollRequest)
  const openPanel = useStudio((s) => s.openPanel)
  const dirty = useStudio(selectDirty)
  const dark = useIsDark()
  const ref = useRef<CardEditorHandle>(null)
  // 同 SourceCard：接住「为了开我」刚发的新鲜 pending 请求（R48-01）
  const seenSeq = useRef(scrollRequest?.seq ?? 0)
  useEffect(() => {
    // 同 SourceCard：接住「为了开我」刚发的新鲜 pending（R48-01）；渲染期不调 Date.now
    const p = useStudio.getState().scrollRequest
    if (p && Date.now() - p.at < SCROLL_REQUEST_FRESH_MS) seenSeq.current = p.seq - 1
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时判定一次
  }, [])
  const [cursorBook, setCursorBook] = useState(() => bookAtFullLine(content, useStudio.getState().cursor.line))

  const onCursor = useCallback((c: CardCursor) => {
    const s = useStudio.getState()
    s.setCursor({ line: c.line, col: c.col, section: sectionAt(Text.of(s.content.split('\n')), c.line).label })
    const loc = s.ast ? blockAtLine(s.ast, c.line) : null
    if (loc) s.setActiveBlock(loc.block.id, 'editor')
    setCursorBook(bookAtFullLine(s.content, c.line))
  }, [])

  useEffect(() => {
    if (!scrollRequest || scrollRequest.seq <= seenSeq.current) return
    seenSeq.current = scrollRequest.seq
    ref.current?.gotoLine(scrollRequest.line)
    clearScrollRequest()
  }, [scrollRequest, clearScrollRequest])

  const editBook = () => {
    if (!cursorBook) return
    openPanel(makePanelId('source', cursorBook), { position: { referencePanel: panelId, direction: 'right' } })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid="card-source-all">
      <CardHeader
        title="全文"
        book="all"
        dirty={dirty}
        panelId={panelId}
        switchable={[...BOOK_NAMES, 'all']}
        onSwitchBook={onSwitchBook}
        actions={
          <>
            <span className="rounded bg-sunken px-1.5 text-2xs leading-5 text-fg-muted" data-testid="card-readonly">
              只读镜像
            </span>
            <button
              type="button"
              disabled={!cursorBook}
              onClick={editBook}
              title="把光标所在书的源码卡片拆分到右侧"
              className={HEADER_BUTTON}
              data-testid="card-edit-book"
            >
              <PencilLine aria-hidden="true" />
              {cursorBook ? `编辑「${BOOK_LABELS[cursorBook]}」` : '在单书卡片中编辑'}
            </button>
          </>
        }
      />
      <CardEditor
        ref={ref}
        value={content}
        loaded={contentEditedAt === 0}
        readOnly
        onCursor={onCursor}
        dark={dark}
        diagnostics={items}
        marks={marks}
        fontSize={editorFontSize}
        ariaLabel="全文源码（只读镜像）"
        placeholder="（空文档）"
        className="min-h-0 flex-1 overflow-hidden"
        testId="card-editor-all"
      />
    </div>
  )
}
