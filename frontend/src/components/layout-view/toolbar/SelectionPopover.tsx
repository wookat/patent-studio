import { useEffect, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from 'prosemirror-view'
import { Bold, Italic, MessageSquarePlus, PenLine, Subscript, Superscript, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { DESKTOP_QUERY, useStudio } from '@/store'
import { findBlockLines } from '@/store/blocks'
import { useMediaQuery } from '@/hooks/useMisc'
import { blockAttrsOf } from '../doc/bookSchema'
import { isMarkActive, selectionText, toggleMarkCmd, topBlock, type MarkName } from './commands'
import { popoverPosition } from './geometry'
import { runOnView, useEditorTick } from './useEditorTick'
import './toolbar.css'
import { LABEL_COMMENT, MSG_COMMENT_FAIL } from '@/lib/copy'

/**
 * 选区浮条（docs/plan/22 决策 2；Google Docs / Notion 选区浮条）：选区非空时按 `view.coordsAtPos` 浮在选区上方（放不下则下方），
 * B I U x₂ x² · 批注（既有 comments store addComment，anchor = 光标块 blockId + 全文行 + 选区引文）· 建议修改（切审阅模式）。
 * 375（< DESKTOP_QUERY）：改为软键盘上方的底部条（visualViewport 折算 bottom，44 高）。
 * 只依赖 `view` + store；`container` 为绝对定位的挂载容器（须 position: relative，默认 view.dom 的父元素）。
 * 未引 @radix-ui/react-popover（项目无此依赖，能不加就不加）；定位手写，role="toolbar"，←/→ 移焦点，Esc 关闭并还焦点。
 */
export interface SelectionPopoverProps {
  view: EditorView | null
  container?: HTMLElement | null
  className?: string
}

const MARKS: { name: MarkName; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { name: 'strong', label: '加粗', icon: Bold },
  { name: 'em', label: '斜体', icon: Italic },
  { name: 'underline', label: '下划线', icon: Underline },
  { name: 'subscript', label: '下标', icon: Subscript },
  { name: 'superscript', label: '上标', icon: Superscript },
]

/** 375 底部常驻工具栏（MobileLayoutToolbar）：浮条贴在它上方，不遮住撤销 / B / 插入 / 审阅栏 */
const bottomBarHeight = () => {
  const bar = document.querySelector<HTMLElement>('[data-slot="MobileBottomBar"]')
  if (!bar) return 0
  const r = bar.getBoundingClientRect()
  return r.height > 0 && r.top > window.innerHeight / 2 ? Math.max(0, Math.round(window.innerHeight - r.top)) : 0
}

/** 软键盘打开时 visualViewport 变矮：条贴在可视区底部（= 键盘上方），再抬高底部工具栏高度 */
function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (!active) return
    const vv = window.visualViewport
    const update = () => setInset(Math.max(0, vv ? window.innerHeight - vv.height - vv.offsetTop : 0) + bottomBarHeight())
    // 焦点进出编辑器时 MobileTabs 显隐，底栏位置变化发生在下一帧
    const later = () => requestAnimationFrame(update)
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', later)
    document.addEventListener('focusout', later)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', later)
      document.removeEventListener('focusout', later)
    }
  }, [active])
  return inset
}

export function SelectionPopover({ view, container, className }: SelectionPopoverProps) {
  const bump = useEditorTick(view)
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const pid = useStudio((s) => s.pid)
  const ast = useStudio((s) => s.ast)
  const addComment = useStudio((s) => s.addComment)
  const setEditorMode = useStudio((s) => s.setEditorMode)
  const toast = useStudio((s) => s.toast)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // 批注草稿绑定到当时选区（from-to）；选区变了草稿自然失效，不需要 effect 重置
  const [draftAt, setDraftAt] = useState<{ key: string; text: string } | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const state = view?.state ?? null
  const sel = state?.selection ?? null
  const hasSel = !!view && !!state && !!sel && !sel.empty && selectionText(state).trim().length > 0
  const key = hasSel && sel ? `${sel.from}-${sel.to}` : null
  const inset = useKeyboardInset(!desktop && hasSel)
  const measure = (el: HTMLDivElement | null) => {
    ref.current = el
    if (el && el.offsetWidth !== width) setWidth(el.offsetWidth)
  }

  if (!hasSel || !view || !key || dismissed === key) return null
  const draft = draftAt?.key === key ? draftAt.text : null
  const setDraft = (text: string | null) => setDraftAt(text === null ? null : { key, text })
  const host = container ?? (view.dom.parentElement as HTMLElement | null)
  const pos = desktop && host ? popoverPosition(view, host, width) : null

  const close = () => {
    setDismissed(key)
    setDraft(null)
    view.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (i < 0 || (document.activeElement as HTMLElement).tagName === 'INPUT') return
    e.preventDefault()
    items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  const submitComment = async () => {
    if (!pid || !draft?.trim()) return
    const top = topBlock(view.state)
    const blockId = top ? blockAttrsOf(top.node).blockId ?? '' : ''
    const loc = ast && blockId ? findBlockLines(ast, blockId) : null
    const line = loc ? loc.offset + loc.start : 0
    setBusy(true)
    const c = await addComment(pid, { block_id: blockId, line, quote: selectionText(view.state) }, draft.trim()).catch(() => null)
    setBusy(false)
    if (!c) {
      toast(MSG_COMMENT_FAIL, 'error')
      return
    }
    toast('已添加批注', 'success')
    setDraft(null)
    view.focus()
  }

  const style: CSSProperties | undefined = pos ? { left: pos.left, top: pos.top } : desktop ? undefined : { bottom: inset }
  const node = (
    <div
      ref={measure}
      role="toolbar"
      aria-label="选区格式"
      aria-orientation="horizontal"
      data-testid="selection-popover"
      className={cn('ps-selection-popover', !desktop && 'ps-selection-popover--mobile', className)}
      style={style}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.preventDefault()}
    >
      {(desktop || draft === null) && MARKS.map(({ name, label, icon: Icon }) => (
        <Toggle
          key={name}
          size={desktop ? 'sm' : 'lg'}
          aria-label={label}
          title={label}
          data-testid={`selection-mark-${name}`}
          pressed={isMarkActive(view.state, name)}
          onPressedChange={() => runOnView(view, toggleMarkCmd(name), bump)}
        >
          <Icon />
        </Toggle>
      ))}
      {(desktop || draft === null) && <span className="ps-selection-popover__sep" aria-hidden />}
      {draft === null ? (
        <>
          <Button variant="ghost" size={desktop ? 'sm' : 'lg'} aria-label="批注" data-testid="selection-comment" disabled={!pid} onClick={() => setDraft('')}>
            <MessageSquarePlus />
            批注
          </Button>
          <Button
            variant="ghost"
            size={desktop ? 'sm' : 'lg'}
            aria-label="建议修改（切到审阅模式）"
            data-testid="selection-suggest"
            onClick={() => {
              setEditorMode('review')
              toast('已切到审阅模式：后续改动记为建议', 'info')
              view.focus()
            }}
          >
            <PenLine />
            建议修改
          </Button>
        </>
      ) : (
        <form
          className="ps-selection-popover__form"
          onMouseDown={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault()
            void submitComment()
          }}
        >
          <Input
            autoFocus
            size="sm"
            aria-label={LABEL_COMMENT}
            data-testid="selection-comment-input"
            placeholder="批注…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
          />
          <Button type="submit" size="sm" disabled={busy || !draft.trim()} data-testid="selection-comment-submit">
            添加
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
            取消
          </Button>
        </form>
      )}
    </div>
  )
  return desktop && host ? createPortal(node, host) : node
}
