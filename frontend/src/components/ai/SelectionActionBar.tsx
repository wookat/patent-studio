import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { DESKTOP_QUERY, selectAiEnabled, useStudio } from '@/store'
import { useMediaQuery } from '@/hooks/useMisc'
import type { RewriteAction } from '@/types/ai'
import { REWRITE_ACTIONS, applySuggestion, gotoReview, publishSelection, runRewrite } from './aiModel'

/** 编辑器选区（全文 1-based 闭区间；book 由 AST/边界折算，E4 用 blockAtLine） */
export interface EditorSelectionInfo {
  from: number
  to: number
  lineStart: number
  lineEnd: number
  text: string
  /** 选区在编辑器容器内的位置（px），用于浮动条定位 */
  rect: { top: number; left: number; bottom: number } | null
}

export interface EditorExtensionSlotProps {
  /** 当前非空选区；无选区 null */
  selection: EditorSelectionInfo | null
  /** 编辑器容器（浮动层挂载点） */
  container: HTMLElement | null
}

const BAR_H = 36
const GAP = 6

const sameRange = (a: EditorSelectionInfo | null, b: EditorSelectionInfo | null) => !!a && !!b && a.from === b.from && a.to === b.to

/**
 * 选区浮动动作条（docs/plan/09 §6.2–6.3；借鉴 Notion / Google Docs 选区浮动条）：
 * 编辑器有非空选区时按 rect 绝对定位在容器内（选区上方，放不下则下方），4 个动作 润色 / 规范化 / 扩写 / 解释 →
 * rewrite(action, {book, line_start, line_end})；改写结果（CriticMarkup）立即写入编辑器（可撤销）并引导到审阅面板接受/拒绝；
 * 解释进入 AI 面板对话。role="toolbar"，←/→ 移动焦点，Esc 关闭并把焦点还给编辑器，Alt+A 在有选区时重新打开。
 * ai_enabled=false：只显示「AI 外发已关闭」入口，不发任何请求。移动端（<1024）改为容器底部通栏（44px 触控目标）。
 * Editor 把选区置 null 的时机含编辑器失焦，因此条上有焦点 / 请求进行中时沿用最近一次选区。
 */
export function SelectionActionBar({ selection, container }: EditorExtensionSlotProps): ReactNode {
  const enabled = useStudio(selectAiEnabled)
  const unavailable = useStudio((s) => s.aiUnavailable)
  const toast = useStudio((s) => s.toast)
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const ref = useRef<HTMLDivElement>(null)
  /** 条上有焦点 / 请求进行中时保留的最近选区（Editor 在失焦时会把 selection 置 null） */
  const [held, setHeld] = useState<EditorSelectionInfo | null>(null)
  const [dismissed, setDismissed] = useState<EditorSelectionInfo | null>(null)
  const [busy, setBusy] = useState<RewriteAction | null>(null)
  const [width, setWidth] = useState(0)
  const [focusIndex, setFocusIndex] = useState(0)

  useEffect(() => publishSelection(selection), [selection])

  const active = selection ?? held
  const visible = !!active && !sameRange(dismissed, active)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && el.offsetWidth !== width) setWidth(el.offsetWidth)
  }, [active, enabled, unavailable, busy, desktop, width])

  // Alt+A：有选区但条已关闭时重新打开并聚焦第一个按钮
  useEffect(() => {
    if (!active) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setDismissed(null)
        requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (!visible || !active) return null

  const close = () => {
    setDismissed(active)
    setHeld(null)
    container?.querySelector<HTMLElement>('.cm-content')?.focus()
  }

  const run = async (action: RewriteAction) => {
    if (busy) return
    setBusy(action)
    setHeld(active)
    const before = useStudio.getState().suggestions.length
    const ok = await runRewrite(action, { lineStart: active.lineStart, lineEnd: active.lineEnd })
    setBusy(null)
    if (!ok) return
    if (action === 'explain') {
      toast('解释已写入 AI 面板对话', 'info')
      openAiPanel()
    } else {
      const sug = useStudio.getState().suggestions.at(-1)
      if (sug && useStudio.getState().suggestions.length > before) applySuggestion(sug)
      toast('已把对选区的建议作为修订写入正文，请在审阅面板接受或拒绝', 'success')
      gotoReview()
    }
    setDismissed(active)
    setHeld(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      if (buttons.length === 0) return
      const cur = buttons.findIndex((b) => b === document.activeElement)
      const next = (cur + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length
      setFocusIndex(next)
      buttons[next]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const b = e.key === 'Home' ? buttons[0] : buttons.at(-1)
      b?.focus()
    }
  }

  const onFocus = () => setHeld(active)
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null
    if (busy || (next && ref.current?.contains(next))) return
    setHeld(null)
  }

  const style = (() => {
    if (!desktop) return { left: 0, right: 0, bottom: 0 }
    const r = active.rect
    const cw = container?.clientWidth ?? 0
    if (!r) return { left: 8, top: 8 }
    const w = width || 320
    const left = cw > 0 ? Math.max(4, Math.min(r.left, cw - w - 4)) : r.left
    const top = r.top - BAR_H - GAP >= 0 ? r.top - BAR_H - GAP : r.bottom + GAP
    return { left, top }
  })()

  const disabledReason = unavailable ? 'AI 接入层尚未落地（501）' : !enabled ? 'AI 外发已关闭，在 AI 面板开启后可用' : null

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="选区 AI 动作"
      aria-orientation="horizontal"
      data-testid="selection-action-bar"
      data-lines={`${active.lineStart}-${active.lineEnd}`}
      className={cn(
        'absolute z-panel flex items-center gap-0.5 bg-elevated text-fg shadow-md',
        desktop ? 'rounded-sm border p-0.5' : 'border-t px-2 py-1.5 overflow-x-auto',
      )}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <Sparkles className="mx-1 size-3.5 shrink-0 text-info-fg" aria-hidden />
      {disabledReason ? (
        <>
          <span className="px-1 text-xs text-fg-muted" data-testid="selection-action-disabled">{disabledReason}</span>
          {!unavailable && (
            <Button
              type="button"
              variant="ghost"
              size={desktop ? 'sm' : 'md'}
              tabIndex={0}
              className={cn(barBtn(desktop), 'text-primary')}
              onClick={() => {
                openAiPanel()
                close()
              }}
            >
              去开启
            </Button>
          )}
        </>
      ) : (
        REWRITE_ACTIONS.map((a, i) => (
          <Button
            key={a.action}
            type="button"
            variant="ghost"
            size={desktop ? 'sm' : 'md'}
            tabIndex={i === focusIndex ? 0 : -1}
            aria-label={`${a.label}（${a.hint}）`}
            title={a.hint}
            aria-busy={busy === a.action || undefined}
            disabled={busy != null}
            data-testid={`selection-action-${a.action}`}
            className={barBtn(desktop)}
            onClick={() => void run(a.action)}
          >
            {busy === a.action ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            {a.label}
          </Button>
        ))
      )}
      <span className="sr-only">第 {active.lineStart}–{active.lineEnd} 行 · Esc 关闭 · Alt+A 重新打开</span>
    </div>
  )
}

/** Button sm（28，工具条）/ xl（移动 40 → 撑到 44 触控目标，spec §3 Sheet 项 44） */
const barBtn = (desktop: boolean) => cn('shrink-0', desktop ? 'px-2' : 'min-h-11 flex-1 px-3 text-sm')

/** W6：AI 面板 = 伴随栏 id=ai（桌面第 4 列 / 移动底部 Sheet），由 CompanionHost 按 presentation 呈现 */
function openAiPanel() {
  useStudio.getState().openCompanion('ai')
}
