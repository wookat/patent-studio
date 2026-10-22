import { useSyncExternalStore } from 'react'
import { DESKTOP_QUERY, selectReadonly, useStudio } from '@/store'
import type { Ast, BookName } from '@/types/ast'
import { blockAtLine } from '@/types/ast'
import type { AiSuggestion, ChatContext, ChatMeta, RewriteAction } from '@/types/ai'
import { PROPOSAL_KIND_LABEL, SCENARIOS, type Anchor, type Proposal } from '@/types/agent'
import { editorCommands } from '@/components/editor/commands'
import type { EditorSelectionInfo } from './SelectionActionBar'
import { diagLocationLabel } from '@/lib/diagLocation'
import { BOOK_LABELS } from '@/lib/docset'
import { MSG_READONLY } from '@/lib/copy'

/** 4 个选区动作的文案与快捷描述（动作条 / 面板快捷按钮共用） */
export const REWRITE_ACTIONS: { action: RewriteAction; label: string; hint: string }[] = [
  { action: 'polish', label: '润色', hint: '通顺、去口语，不改技术含义' },
  { action: 'formalize', label: '规范化', hint: '改为专利表述（所述 / 被配置为 / 其特征在于）' },
  { action: 'expand', label: '扩写', hint: '补充实施细节与可选方案' },
  { action: 'explain', label: '解释', hint: '解释选区含义，不改源码' },
]


/** 全文行 → 所属书：优先块 AST；AST 未就位时按 `## 摘要 / ## 权利要求书 / ## 说明书` 标题扫源码 */
export function bookAtLine(ast: Ast | null, content: string, line: number): BookName {
  if (ast) {
    const loc = blockAtLine(ast, line)
    if (loc) return loc.book
  }
  const lines = content.split('\n')
  let book: BookName = 'abstract'
  for (let i = 0; i < Math.min(line, lines.length); i++) {
    const h = /^##\s*(\S+)/.exec(lines[i])
    if (!h) continue
    if (h[1].startsWith('权利要求')) book = 'claims'
    else if (h[1].startsWith('说明书')) book = 'description'
    else if (h[1].startsWith('摘要')) book = 'abstract'
  }
  return book
}

/** 把 [lineStart, lineEnd]（全文 1-based 闭区间）整段替换为 text（可多行）；越界行号夹到文档范围 */
export function replaceLines(content: string, lineStart: number, lineEnd: number, text: string): string {
  const lines = content.split('\n')
  const s = Math.max(1, Math.min(lineStart, lines.length))
  const e = Math.max(s, Math.min(lineEnd, lines.length))
  lines.splice(s - 1, e - s + 1, ...text.replace(/\n$/, '').split('\n'))
  return lines.join('\n')
}

/**
 * 把 CriticMarkup 写到源码 [lineStart, lineEnd]：编辑器挂载时走 CodeMirror 事务（保留光标 / 逐步撤销），
 * 未挂载（移动端预览 tab / 仅预览）时 setContent 回填。写入的是标记而非终稿，去留由审阅面板逐条决定。
 */
export function writeCriticLines(lineStart: number, lineEnd: number, text: string): void {
  const s = useStudio.getState()
  // setContent 回填是 editorCommands 之外的写路径，只读角色在这里拦
  if (selectReadonly(s)) {
    s.toast(MSG_READONLY, 'info')
    return
  }
  if (editorCommands.replaceLines(lineStart, lineEnd, text.replace(/\n$/, ''))) return
  s.persistMergedContent(replaceLines(s.content, lineStart, lineEnd, text))
}

/** 接受一条建议：critic_markdown 覆盖建议行写回源码，随后 review slice 的 marks 出现，用户逐条接受或拒绝。 */
export function applySuggestion(sug: AiSuggestion): void {
  const s = useStudio.getState()
  if (selectReadonly(s)) {
    s.toast(MSG_READONLY, 'info')
    return
  }
  writeCriticLines(sug.line_start, sug.line_end, sug.critic_markdown)
  useStudio.getState().acceptSuggestion(sug.id)
}

/** 桌面：Rail 下块切到审阅；移动：NavDrawer 打开审阅 tab */
export function gotoReview(): void {
  const s = useStudio.getState()
  if (window.matchMedia(DESKTOP_QUERY).matches) {
    if (s.railTab !== 'review' || !s.outlineOpen) s.setRailTab('review')
  } else {
    s.openMobileNav('review')
  }
}

/** 打开 AI 面板宿主：桌面开伴随栏 ai；移动切底栏 AI 页签并放下盖在上面的层（审阅 Sheet / 导航抽屉 / 更多） */
function openAiPanelHost(): void {
  const s = useStudio.getState()
  if (window.matchMedia(DESKTOP_QUERY).matches) {
    s.openCompanion('ai')
  } else {
    if (s.reviewDrawerOpen) s.setReviewDrawerOpen(false)
    if (s.rightRailSheetOpen) s.setRightRailSheetOpen(false)
    if (s.mobileNav.open) s.closeMobileNav()
    if (s.moreOpen) s.toggleMore(false)
    s.setMobileTab('ai')
  }
}

/** Z18/Z25：跳到 AI 面板「建议」tab */
export function gotoAiProposals(): void {
  useStudio.getState().setAgentTab('proposals')
  openAiPanelHost()
}

/** 附件预览「带入 Agent」：跳到 AI 面板「对话」tab（chip 就在那里） */
export function gotoAiChat(): void {
  useStudio.getState().setAgentTab('chat')
  openAiPanelHost()
}

// ---- 编辑器选区（Editor → SelectionActionBar 推送；AiPanel 上下文芯片读取） ----

let lastSelection: EditorSelectionInfo | null = null
let lastSelectionPid: string | null = null
const selListeners = new Set<() => void>()

/** 记住最近一次非空选区（点面板时编辑器失焦会把 selection 置 null，芯片仍需可用）。
 *  选区按 pid 归属：换案后旧案选区不得渗入新案对话/快捷动作（C0/P01 切案残留）。 */
export function publishSelection(sel: EditorSelectionInfo | null): void {
  if (sel === null || sel.text.trim() === '') return
  if (lastSelection && lastSelection.from === sel.from && lastSelection.to === sel.to && lastSelection.text === sel.text) return
  lastSelection = sel
  lastSelectionPid = useStudio.getState().pid
  selListeners.forEach((l) => l())
}
export function clearSelection(): void {
  if (!lastSelection) return
  lastSelection = null
  lastSelectionPid = null
  selListeners.forEach((l) => l())
}
/** 选区的用户可读位置：「权利要求 3」/「说明书 · 段落 [0012]」，跨块时 `A – B`；AST 未就位时退到书名 */
export function selectionLabel(sel: Pick<EditorSelectionInfo, 'lineStart' | 'lineEnd'>, ast: Ast | null, content = ''): string {
  const at = (line: number) => {
    const label = diagLocationLabel({ line }, ast)
    if (label !== '全文') return label
    return BOOK_LABELS[bookAtLine(ast, content, line)]
  }
  const a = at(sel.lineStart)
  const b = sel.lineEnd > sel.lineStart ? at(sel.lineEnd) : a
  return a === b ? a : `${a} – ${b}`
}

export function useLastSelection(): EditorSelectionInfo | null {
  const sel = useSyncExternalStore(
    (cb) => {
      selListeners.add(cb)
      return () => selListeners.delete(cb)
    },
    () => lastSelection,
  )
  const pid = useStudio((s) => s.pid)
  return sel && lastSelectionPid === pid ? sel : null
}

// ---- 流式对话（状态机在 store/ai.sendChat：idle → streaming → idle | error） ----

/** 最近一条完成的回复的元数据（模型 / token / 是否兜底），显示在最后一条回复下方；流中 / 出错 / 本地提示无 */
export function useLastChatMeta(): ChatMeta | null {
  return useStudio((s) => s.chat.at(-1)?.meta ?? null)
}

export const streamChat = (text: string, context: ChatContext | null, attachmentMeta?: import('@/types/ai').ChatAttachmentMeta[], scopeKeys?: string[]): Promise<void> =>
  useStudio.getState().sendChat(text, context, attachmentMeta, scopeKeys)

/** 停止当前流：中断 fetch；已收到的部分保留在消息里 */
export const stopStreaming = (): void => useStudio.getState().stopChat()

let seq = 0
/** 追加一条本地（非请求）assistant 消息：解释结果 / 提示语 */
export function pushAssistantNote(content: string): void {
  const id = `n${Date.now().toString(36)}${(seq++).toString(36)}`
  useStudio.setState((s) => ({ chat: [...s.chat, { id, role: 'assistant', content, created_at: Date.now() }] }))
}

/**
 * 选区动作入口：润色 / 规范化 / 扩写 → store.rewrite 追加 CriticMarkup 建议；
 * 解释 → 结果不是标记，移出建议列表，作为一条 assistant 消息进入对话。返回是否成功。
 */
export async function runRewrite(action: RewriteAction, sel: { lineStart: number; lineEnd: number }, instruction?: string): Promise<boolean> {
  const s = useStudio.getState()
  if (!s.pid || !(s.settings?.ai_enabled ?? false)) return false
  const book = bookAtLine(s.ast, s.content, sel.lineStart)
  const r = await s.rewrite(action, { book, line_start: sel.lineStart, line_end: sel.lineEnd }, instruction)
  if (!r) return false
  if (action === 'explain') {
    pushAssistantNote(`解释（${selectionLabel(sel, s.ast, s.content)}）：\n${r.explanation ?? r.critic_markdown ?? ''}`)
  }
  return true
}

// ---- W5 §6.6：对话上下文包 / 定位 ----

/** 随对话发送的案卷上下文（ChatContext + 术语 / 权项树两包；后端 `_chat_context` 消费字段见 integration_requests） */
export interface ChatContextPacks extends ChatContext {
  /** 术语主名（别名）列表，每项一行 */
  terms?: string[]
  /** 权项树：`权1 独立 · 产品` / `权2 ← 1` */
  claim_tree?: string[]
}

export const MAX_CONTEXT_ITEMS = 30

/** 术语表 → 「主名（别名 a / b）」 */
export function termsPack(terms: readonly { name: string; aliases: string[] }[]): string[] {
  return terms.slice(0, MAX_CONTEXT_ITEMS).map((t) => (t.aliases.length ? `${t.name}（${t.aliases.join(' / ')}）` : t.name))
}

/** AST 权项 → 树形摘要（独权标类别，从权列引用目标） */
export function claimTreePack(ast: Ast | null): string[] {
  if (!ast) return []
  return ast.claims.slice(0, MAX_CONTEXT_ITEMS).map((c) => {
    const num = c.num_written ?? String(c.num)
    if (c.claim_kind === 'independent') return `权${num} 独立${c.category ? ` · ${c.category}` : ''}`
    const targets = [...new Set(c.refs.flatMap((r) => r.targets))].sort((a, b) => a - b)
    return `权${num} ← ${targets.length ? targets.join(', ') : '?'}`
  })
}

/** 回答 / 批注里的说明书段号引用 `[0012]`；同一段多次出现只保留一处可点 */
export const PARA_REF_RE = /\[(\d{4})\]/g

/** 段号 → setFocus{source:'ai'}（说明书 paragraph / table / code 的 para_no）；找不到返回 false */
export function focusParaNo(paraNo: number): boolean {
  const s = useStudio.getState()
  const ast = s.ast
  if (!ast) return false
  const block = ast.description.find((b) => (b.kind === 'paragraph' || b.kind === 'table' || b.kind === 'code') && b.para_no === paraNo)
  if (!block) return false
  s.setFocus({ source: 'ai', book: 'description', blockId: block.id, line: ast.books.description.offset + block.lines.start })
  return true
}

/** Proposal 锚点 → setFocus{source:'ai'}；文件级锚点（docs/*.md）不可定位 */
export function focusAnchor(anchor: Anchor): boolean {
  if (!('block_id' in anchor)) return false
  useStudio.getState().setFocus({ source: 'ai', book: anchor.book, blockId: anchor.block_id, line: anchor.line_start })
  return true
}

/** 建议锚点的用户可读位置：「权利要求 3」/「说明书 · 段落 [0012]」，跨块 `A – B`；AST 未就位时退到书名；文件级建议给文件名 */
export function anchorLabel(anchor: Anchor, ast: Ast | null = null): string {
  if ('file' in anchor) return anchor.file
  const at = (line: number) => {
    const label = diagLocationLabel({ line }, ast)
    return label === '全文' ? BOOK_LABELS[anchor.book] : label
  }
  const a = at(anchor.line_start)
  const b = anchor.line_end > anchor.line_start ? at(anchor.line_end) : a
  return a === b ? a : `${a} – ${b}`
}

/** 建议的一行摘要（gutter / 版面卡 / 列表标题共用）：场景 · 形态 + 正文首句（批注正文 / critic 去标记后的文本） */
export function proposalSummary(p: Proposal, max = 60): string {
  const scenario = SCENARIOS.find((s) => s.id === p.scenario)?.label ?? p.scenario
  const body = (p.comment_body ?? p.critic_markdown ?? '').replace(/\{[+\-~=>]{2}|[+\-~=<]{2}\}|~>/g, '').replace(/\s+/g, ' ').trim()
  const head = `${scenario} · ${PROPOSAL_KIND_LABEL[p.kind]}`
  if (!body) return head
  return `${head}：${body.length > max ? `${body.slice(0, max)}…` : body}`
}
