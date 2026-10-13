import { useLayoutEffect, useMemo, useState } from 'react'
import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, GutterMarker, ViewPlugin, gutter } from '@codemirror/view'
import { Sparkles } from 'lucide-react'
import { Count } from '@/components/ui/count'
import { registerCompanionBody, registerEditorExtension, registerLayoutDecoration, type LayoutDecorationProps } from '@/lib/slots'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import type { Proposal } from '@/types/agent'
import { proposalSummary } from './aiModel'
import { AiPanel } from './AiPanel'
import { AI_RUNTIME_DOT, useAiRuntime } from './aiRuntime'

/**
 * AI 建议在三视图里的标记（W5 §6.6 A5 / R-AI-08）：
 *  - 源码视图：gutter 星标（按 anchor.line_start 聚合待处理 Proposal），点击 → AI 面板「建议」tab
 *  - 版面视图：块旁小卡（按 anchor.block_id），显示条数 + 首条预览，点击同上
 *  - W6 伴随栏：`registerCompanionBody('ai', AiPanel, AiCompanionActions)`（prep 契约；宽度由 store.companionWidth 管，单元不自设）
 * 通过 lib/slots 注入，不改 editor/** / layout-view/** / CompanionHost / DesktopShell；模块顶层注册（App.tsx 与 components/ai/index.ts 引用时生效）。
 */

type LineMap = Map<number, Proposal[]>

const pendingByLine = (list: readonly Proposal[]): LineMap => {
  const m: LineMap = new Map()
  for (const p of list) {
    if (p.state !== 'pending' || !('block_id' in p.anchor)) continue
    const n = p.anchor.line_start
    const prev = m.get(n)
    if (prev) prev.push(p)
    else m.set(n, [p])
  }
  return m
}

export const pendingByBlock = (list: readonly Proposal[], blockId: string): Proposal[] =>
  list.filter((p) => p.state === 'pending' && 'block_id' in p.anchor && p.anchor.block_id === blockId)

function openProposals(): void {
  const s = useStudio.getState()
  s.setAgentTab('proposals')
  s.openCompanion('ai')
}

const setProposalLines = StateEffect.define<LineMap>()

const proposalLinesField = StateField.define<LineMap>({
  create: () => pendingByLine(useStudio.getState().proposals),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setProposalLines)) return e.value
    return v
  },
})

/** store.proposals 变化 → dispatch 到编辑器（zustand 订阅在 ViewPlugin 生命周期内） */
const proposalSync = ViewPlugin.define((view) => {
  let last = useStudio.getState().proposals
  const unsub = useStudio.subscribe((s) => {
    if (s.proposals === last) return
    last = s.proposals
    view.dispatch({ effects: setProposalLines.of(pendingByLine(last)) })
  })
  return { destroy: unsub }
})

class ProposalMarker extends GutterMarker {
  readonly items: Proposal[]
  constructor(items: Proposal[]) {
    super()
    this.items = items
  }
  override eq(o: ProposalMarker) {
    return o.items.length === this.items.length && this.items.every((p, i) => p.id === o.items[i].id)
  }
  override toDOM() {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'cm-ai-gutter'
    el.setAttribute('data-testid', 'ai-gutter-marker')
    el.setAttribute('data-count', String(this.items.length))
    el.setAttribute('aria-label', `${this.items.length} 条 AI 建议，打开建议列表`)
    el.title = this.items.map((p) => proposalSummary(p)).join('\n')
    el.textContent = '✦'
    el.addEventListener('click', (e) => {
      e.preventDefault()
      openProposals()
    })
    return el
  }
}

const proposalGutter = gutter({
  class: 'cm-ai-gutter-col',
  lineMarker(view, line) {
    const map = view.state.field(proposalLinesField)
    if (!map.size) return null
    const items = map.get(view.state.doc.lineAt(line.from).number)
    return items ? new ProposalMarker(items) : null
  },
  lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setProposalLines))),
})

const proposalTheme = EditorView.baseTheme({
  '.cm-gutter.cm-ai-gutter-col': { width: '14px' },
  '.cm-ai-gutter': {
    display: 'inline-block',
    width: '14px',
    padding: '0',
    border: '0',
    background: 'transparent',
    textAlign: 'center',
    cursor: 'pointer',
    fontSize: '11px',
    lineHeight: 'inherit',
    color: 'var(--info-fg)',
  },
  '.cm-ai-gutter:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '-1px', borderRadius: 'var(--radius-sm)' },
})

/** 源码 gutter：待处理建议星标 */
export const proposalGutterExtension = () => [proposalLinesField, proposalSync, proposalGutter, proposalTheme]

/** 版面块旁卡：块右侧（窄屏落在块右上角） */
export function BlockProposalCard({ blockId, element }: LayoutDecorationProps) {
  const proposals = useStudio((s) => s.proposals)
  const items = useMemo(() => pendingByBlock(proposals, blockId), [proposals, blockId])
  const [pos, setPos] = useState<{ top: number; left: number; inside: boolean } | null>(null)

  useLayoutEffect(() => {
    if (!element || !items.length) return
    const body = element.closest<HTMLElement>('.ps-layout-body')
    if (!body) return
    const measure = () => {
      const r = element.getBoundingClientRect()
      const b = body.getBoundingClientRect()
      const room = b.right - r.right
      setPos({ top: r.top - b.top + body.scrollTop, left: room >= 176 ? r.right - b.left + 8 : r.right - b.left - 8, inside: room < 176 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(element)
    ro.observe(body)
    return () => ro.disconnect()
  }, [element, items.length])

  if (!items.length || !pos) return null
  const first = proposalSummary(items[0])
  return (
    <button
      type="button"
      className={cn('absolute z-sticky flex max-w-40 items-start gap-1 rounded-md border border-brand-300 bg-elevated p-1.5 text-left text-2xs shadow-sm hover:bg-hover', FOCUS_RING)}
      style={{ top: pos.top, left: pos.left, transform: pos.inside ? 'translateX(-100%)' : undefined }}
      aria-label={`${items.length} 条 AI 建议：${first}，打开建议列表`}
      title={`${items.length} 条 AI 建议，打开建议列表`}
      onClick={openProposals}
      data-testid={`ai-block-card-${blockId}`}
    >
      <Sparkles className="mt-px size-3 shrink-0 text-info-fg" aria-hidden />
      <span className="min-w-0">
        <Count value={items.length} tone="brand" />
        <span className="mt-0.5 line-clamp-2 break-words text-fg-muted">{first}</span>
      </span>
    </button>
  )
}

/** 伴随栏头右侧运行态（05 §S6：StatusDot tone；mock 与真模型同形态，只差文字后缀） */
export function AiCompanionActions() {
  const rt = useAiRuntime()
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs text-fg-muted" data-testid="ai-companion-runtime" data-tone={rt.tone}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', AI_RUNTIME_DOT[rt.tone], rt.tone === 'info' && 'motion-safe:animate-pulse')} />
      {rt.label}
      {rt.suffix}
    </span>
  )
}

registerEditorExtension('ai-proposals', proposalGutterExtension, 10)
registerLayoutDecoration('ai-proposals', (props) => <BlockProposalCard key={props.blockId} {...props} />, 10)
registerCompanionBody('ai', AiPanel, AiCompanionActions)
