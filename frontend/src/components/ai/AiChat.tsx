import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { Check, ChevronDown, Eraser, FileText, Loader2, Paperclip, SendHorizontal, Square, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { FOCUS_RING, TRANSITION_COLOR, cn, touchHit } from '@/lib/utils'
import { selectAiEnabled, selectBoundSha, selectDirty, useStudio } from '@/store'
import { api } from '@/lib/api'
import type { ChatAttachmentMeta, ChatMessage } from '@/types/ai'
import { Markdown } from './Markdown'
import { BOOK_LABELS, splitBooks } from '@/lib/docset'
import {
  MAX_CONTEXT_ITEMS, PARA_REF_RE, bookAtLine, claimTreePack, clearSelection, focusParaNo, selectionLabel, streamChat, stopStreaming, termsPack,
  useLastChatMeta, useLastSelection, type ChatContextPacks,
} from './aiModel'

/** 「附带上下文」三包（W5 §6.6 A1）：术语表 / 体检诊断 / 权项树 */
export type ContextPack = 'terms' | 'health' | 'claims'
const PACKS: { key: ContextPack; label: string }[] = [
  { key: 'terms', label: '术语' },
  { key: 'health', label: '体检' },
  { key: 'claims', label: '权项树' },
]

/** 空对话首屏的常用操作快捷卡：点击即发——让首次使用者直接看到 agent 能干什么 */
const SUGGESTS: { id: string; label: string; prompt: string }[] = [
  { id: 'search', label: '跑先行技术检索', prompt: '对本案跑一遍先行技术检索，给出机器初筛命中清单（公开号、标题、日期）。' },
  { id: 'health', label: '全案体检', prompt: '对本案做一次全面体检，列出需要我处理的问题（按严重度排序，注明行号）。' },
  { id: 'draft', label: '起草/润色权项', prompt: '帮我起草或润色权利要求，先以 CriticMarkup 提案给出修改建议，不要直接改正文。' },
]

/**
 * 对话区（05 §S6）：上下文 chip 24（当前书 / 选区，可按下取消）+ 「附带上下文」勾选 术语 / 体检 / 权项树（随请求 context 字段发送）
 * + 消息列表（flex-1 可滚；assistant 完成后 aria-live 播报，生成中 role=status；回答内 [00NN] 可点 → setFocus{source:'ai'}；模型 / token 折叠进「详情」）
 * + 底部固定 composer：`Textarea` 自增 + `Button soft` 发送（面板内无 primary；Enter 发送 / Shift+Enter 换行 / 流式时「停止」）。
 */
export function AiChat({ enabled, compact }: { enabled: boolean; compact: boolean }) {
  const chat = useStudio((s) => s.chat)
  const streaming = useStudio((s) => s.chatStreaming)
  const chatError = useStudio((s) => s.chatError)
  const clearChat = useStudio((s) => s.clearChat)
  const cursorLine = useStudio((s) => s.cursor.line)
  const ast = useStudio((s) => s.ast)
  const content = useStudio((s) => s.content)
  const items = useStudio((s) => s.items)
  const terms = useStudio((s) => s.terms)
  const issues = items.filter((d) => d.severity === 'error' || d.severity === 'warning')
  const sel = useLastSelection()
  const meta = useLastChatMeta()
  /* 批71：输入草稿存 store——AI 面板页签切换（chat↔scenarios↔proposals↔jobs 默认卸载）
     与面板关闭都卸载 AiChat，本地态草稿随实例死（卸载丢草稿族收口） */
  const text = useStudio((s) => s.aiChatDraft ?? '')
  const setText = useStudio((s) => s.setAiChatDraft)
  const attachments = useStudio((s) => s.aiChatAttachments)
  const addAttachments = useStudio((s) => s.addAiChatAttachments)
  const removeAttachment = useStudio((s) => s.removeAiChatAttachment)
  const markAttachmentsSent = useStudio((s) => s.markAiChatAttachmentsSent)
  const materials = useStudio((s) => s.aiChatMaterials)
  const removeMaterial = useStudio((s) => s.removeAiChatMaterial)
  const toast = useStudio((s) => s.toast)
  /* 批76：store 草稿保重挂不保刷新（批73 口径）——输入稿/未发送材料在手时关页签走浏览器确认；
     已发送材料 chip 是上下文授权记录，不算未保存草稿 */
  useBeforeUnload(() => text.trim() !== '' || attachments.some((a) => !a.sent))
  /* P05：授权 chip 态存 store——面板重挂/桌面↔移动壳切换不得复活用户已撤销的授权；切案 resetAi 复位 */
  const useBook = useStudio((s) => s.aiUseBook)
  const useSel = useStudio((s) => s.aiUseSel)
  const packs = useStudio((s) => s.aiPacks)
  const setUseBook = useStudio((s) => s.setAiUseBook)
  const setUseSel = useStudio((s) => s.setAiUseSel)
  const setPacks = useStudio((s) => s.setAiPacks)
  const claimTree = claimTreePack(ast)
  const packCount: Record<ContextPack, number> = { terms: terms.length, health: issues.length, claims: claimTree.length }
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attaching, setAttaching] = useState(false)

  const pickFiles = async (files: FileList | null) => {
    if (!files?.length || attaching || !enabled) return
    const s = useStudio.getState()
    if (!s.pid) return
    const room = 8 - attachments.length
    const list = Array.from(files).slice(0, room)
    if (Array.from(files).length > room) toast(`附件最多 8 个，已取前 ${room} 个`, 'info')
    setAttaching(true)
    try {
      const { results } = await api.aiChatAttach(s.pid, list)
      addAttachments(results.filter((r) => r.ok).map((r) => ({ name: r.name, text: r.text ?? '', chars: r.chars ?? 0, truncated: r.truncated })))
      for (const r of results.filter((r) => !r.ok)) toast(`《${r.name}》${r.error ?? '无法附加'}`, 'error')
    } catch (e) {
      toast(`附件解析失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setAttaching(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const book = bookAtLine(ast, content, cursorLine)
  const sentScopeKeys = useStudio((s) => s.sentScopeKeys)
  const scopeNote = useStudio((s) => s.chatScopeNote)
  const setAiScope = useStudio((s) => s.setAiScope)
  const setScopeNote = useStudio((s) => s.setChatScopeNote)

  /** 当前 chip 态声明的授权键与 scope 体——keys 携带真实身份（书/选区区间/材料名/pack），
      发送过的键收窄即清对话；scope 随请求发送，服务端按同名身份校验 */
  const scopeSnapshot = () => {
    const keys: string[] = []
    if (useBook) keys.push(`book:${book}`)
    /* 选区键用选区自己落在的书（bookAtLine 按行号定位）——不能用当前光标 book 给旧选区贴标签 */
    const selBook = sel ? bookAtLine(ast, content, sel.lineStart) : book
    if (useSel && sel) keys.push(`sel:${selBook}:${sel.lineStart}-${sel.lineEnd}`)
    for (const [k, v] of Object.entries(packs)) if (v) keys.push(`pack:${k}`)
    for (const a of attachments) keys.push(`mat:${a.name}`)
    for (const m of materials) keys.push(`mat:${m}`)
    const scope = {
      source: useBook ? { book } : useSel && sel ? { book: selBook, lines: [sel.lineStart, sel.lineEnd] } : undefined,
      materials: [...attachments.map((a) => a.name), ...materials],
    }
    return { keys, scope }
  }

  /* P05：授权快照入 store（send/resume 共用同一声明）；已发键收窄（含撤销材料/换书/改选区）→ 清对话
     + 提示新对话，防旧材料经历史消息/续跑回执泄漏（服务端 scope⊆ 回执校验为第二道） */
  useEffect(() => {
    const { keys, scope } = scopeSnapshot()
    setAiScope(scope)
    const sent = useStudio.getState().sentScopeKeys
    const chat = useStudio.getState().chat
    if (chat.length > 0 && sent.some((k) => !keys.includes(k))) {
      useStudio.getState().clearChat()
      setScopeNote('上下文范围已缩小：已清除可能含旧内容的对话与待续跑任务，请开始新对话。')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- book/sel/attachments/materials/packs 变化均经 scopeSnapshot 覆盖
  }, [useBook, useSel, sel, book, packs, attachments, materials, sentScopeKeys, setAiScope, setScopeNote])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])

  const buildContext = (): ChatContextPacks | null => {
    const ctx: ChatContextPacks = {}
    if (useBook) ctx.book = book
    if (useSel && sel) ctx.selection = { line_start: sel.lineStart, line_end: sel.lineEnd, text: sel.text.slice(0, 2000) }
    if (packs.health && issues.length) ctx.diagnostics = issues.slice(0, MAX_CONTEXT_ITEMS).map((d) => `${d.line ? `L${d.line} ` : ''}[${d.severity}] ${d.message}`)
    if (packs.terms && terms.length) ctx.terms = termsPack(terms)
    if (packs.claims && claimTree.length) ctx.claim_tree = claimTree
    if (materials.length) ctx.materials = materials
    return Object.keys(ctx).length ? ctx : null
  }

  const send = () => {
    const t = text.trim()
    const s = useStudio.getState()
    if (!t || streaming || !enabled || !s.pid || s.chatStreaming || !selectAiEnabled(s)) return
    const ctx: ChatContextPacks = buildContext() ?? {}
    const meta: ChatAttachmentMeta[] = attachments.map((a) => ({ name: a.name, chars: a.chars, truncated: a.truncated }))
    if (attachments.length) ctx.attachments = attachments.map((a) => ({ name: a.name, text: a.text }))
    const { keys } = scopeSnapshot()
    setText('')
    /* 材料 chip 发送后保留为已授权上下文（sent 标记）——用户明确移除才撤销授权并触发收窄清对话 */
    markAttachmentsSent()
    void streamChat(t, Object.keys(ctx).length ? ctx : null, meta, keys)
    inputRef.current?.focus()
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const lastAssistant = [...chat].reverse().find((m) => m.role === 'assistant' && !m.streaming && !m.error)

  /**
   * composer 按钮 pointerdown 不夺焦点：375 下输入框聚焦时 MobileTabs 隐藏（useTextInputFocused），若按下发送键时 textarea 失焦，
   * Tab 栏同步回来使 composer 上移 56px，pointerup 落在别处 ⇒ click 不触发（首次点击不发送）。同 MobileQuickKeys.keepFocus。
   */
  const keepFocus = (e: PointerEvent<HTMLButtonElement>) => e.preventDefault()

  return (
    <section aria-label="AI 对话" className={cn('flex min-h-0 flex-1 flex-col gap-2', compact ? 'min-h-64' : 'min-h-72')} data-testid="ai-chat">
      <div className="flex flex-wrap items-center gap-1" data-testid="ai-context-chips" aria-label="随对话发送的案卷上下文" role="group">
        <Chip pressed={useBook} onClick={() => setUseBook(!useBook)} testId="ai-chip-book">
          当前书：{BOOK_LABELS[book]}
          <span className="ml-1 text-fg-muted">≈{splitBooks(content).books[book]?.text.length ?? 0}字</span>
        </Chip>
        {sel && (
          <Chip pressed={useSel} onClick={() => setUseSel(!useSel)} testId="ai-chip-selection" onRemove={clearSelection}>
            选区 · {selectionLabel(sel, ast, content)} · {sel.text.length}字
            <span className="ml-1 max-w-36 truncate text-fg-muted" aria-hidden>
              {sel.text.replace(/\s+/g, ' ').trim().slice(0, 24)}
            </span>
          </Chip>
        )}
        <VersionTag />
      </div>
      {scopeNote && (
        <p role="status" className="rounded-sm bg-warn-bg px-2 py-1 text-2xs text-warn-fg" data-testid="ai-scope-note">
          {scopeNote}
        </p>
      )}
      {(attachments.length > 0 || materials.length > 0) && (
        <div className="flex flex-wrap items-center gap-1" data-testid="ai-attach-chips" aria-label="上下文材料（发送后即授权范围）">
          {materials.map((m) => (
            <span key={`mat-${m}`} className="inline-flex items-stretch">
              <span className="inline-flex h-xs-control max-w-56 items-center gap-1 rounded-l-full border border-brand-300 bg-selected px-2.5 text-2xs text-fg-strong">
                <FileText className="size-3 shrink-0" aria-hidden />
                <span className="truncate" title={m}>{m}</span>
                <span className="shrink-0 text-fg-muted">案卷材料</span>
              </span>
              <button
                type="button"
                onClick={() => removeMaterial(m)}
                aria-label={`移除材料 ${m}`} title={`移除材料 ${m}（已授权的会撤销授权并清空对话）`}
                className={cn(touchHit, 'inline-flex size-xs-control items-center justify-center rounded-r-full border border-l-0 border-border text-fg-muted hover:text-fg', FOCUS_RING)}
                data-testid={`ai-material-rm-${m}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          {attachments.map((a) => (
            <span key={a.name} className="inline-flex items-stretch">
              <span className="inline-flex h-xs-control max-w-56 items-center gap-1 rounded-l-full border border-brand-300 bg-selected px-2.5 text-2xs text-fg-strong">
                <FileText className="size-3 shrink-0" aria-hidden />
                <span className="truncate" title={a.name}>{a.name}</span>
                <span className="shrink-0 text-fg-muted">{a.chars}字{a.truncated ? '·截断' : ''}{a.sent ? '·已授权' : ''}</span>
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(a.name)}
                aria-label={`移除附件 ${a.name}`} title={`移除附件 ${a.name}（已授权的会撤销授权并清空对话）`}
                className={cn(touchHit, 'inline-flex size-xs-control items-center justify-center rounded-r-full border border-l-0 border-border text-fg-muted hover:text-fg', FOCUS_RING)}
                data-testid={`ai-attach-rm-${a.name}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <fieldset
        className={cn('flex min-w-0 items-center gap-group-m whitespace-nowrap', compact ? 'text-2xs' : 'flex-wrap gap-y-1 text-xs')}
        data-testid="ai-context-packs"
      >
        <legend className="float-left shrink-0 text-fg-muted">附带上下文</legend>
        {PACKS.map((p) => {
          const id = `ai-context-${p.key}`
          const n = packCount[p.key]
          return (
            <span key={p.key} className="inline-flex shrink-0 items-center gap-1.5">
              <Checkbox
                id={id}
                checked={packs[p.key]}
                disabled={n === 0}
                onCheckedChange={(v) => setPacks({ ...packs, [p.key]: v === true })}
                aria-describedby={n === 0 ? `${id}-empty` : undefined}
                data-testid={id}
              />
              <label htmlFor={id} className={cn('cursor-pointer select-none', n === 0 && 'text-fg-muted')} data-testid={`${id}-label`}>
                {p.label}：{n} 条
              </label>
              {n === 0 && <span id={`${id}-empty`} className="sr-only">本案暂无可附带的{p.label}</span>}
            </span>
          )
        })}
      </fieldset>

      <div
        ref={listRef}
        role="log"
        aria-label="对话记录"
        className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md bg-sunken p-2', compact ? 'min-h-32' : 'min-h-40')}
        data-testid="ai-chat-log"
      >
        {chat.length === 0 && (
          <div className="m-auto flex max-w-form-col flex-col items-center gap-2">
            <p className="text-center text-xs text-fg-muted">
              {enabled
                ? '问关于本案的任何问题。回答只作参考；改写建议一律以 CriticMarkup 呈现，由你接受或拒绝。'
                : 'AI 外发已关闭，开启后可对话。'}
            </p>
            {enabled ? (
              <div className="flex flex-wrap justify-center gap-1.5" data-testid="ai-suggests" role="group" aria-label="常用操作">
                {SUGGESTS.map((sg) => (
                  <button
                    key={sg.label}
                    type="button"
                    className={cn(
                      'rounded-full border border-border bg-panel px-2.5 py-1 text-2xs text-fg shadow-xs',
                      'hover:border-brand-300 hover:bg-selected hover:text-fg-strong',
                      FOCUS_RING, TRANSITION_COLOR,
                    )}
                    data-testid={`ai-suggest-${sg.id}`}
                    onClick={() => {
                      const s = useStudio.getState()
                      if (streaming || s.chatStreaming || !s.pid || !selectAiEnabled(s)) return
                      void streamChat(sg.prompt, null, [])
                    }}
                  >
                    {sg.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {chat.map((m) => <Message key={m.id} m={m} />)}
        {streaming && (
          <p role="status" className="flex items-center gap-1 text-xs text-fg-muted" data-testid="ai-streaming-status">
            <Loader2 className="size-3 animate-spin" aria-hidden /> 正在生成…
          </p>
        )}
        {!streaming && meta && lastAssistant && (
          <Collapsible className="self-start">
            <CollapsibleTrigger
              className="inline-flex h-xs-control items-center gap-1 rounded-xs text-2xs text-fg-subtle hover:text-fg in-data-[density=touch]:min-w-touch in-data-[density=touch]:px-2 [&[aria-expanded=true]>svg]:rotate-180"
              data-testid="ai-chat-meta-toggle"
            >
              <ChevronDown className="size-3 transition-transform duration-(--dur-fast)" aria-hidden />
              详情
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="font-mono text-2xs text-fg-subtle" data-testid="ai-chat-meta">
                {meta.model ?? '模型未知'}
                {meta.usage ? ` · ${meta.usage.total_tokens} token` : ''}
                {meta.fallback ? ' · 已用兜底模型' : ''}
              </p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="ai-chat-live">
        {lastAssistant && !streaming ? `AI 回复：${lastAssistant.content}` : ''}
      </div>
      {chatError && (
        <p role="alert" className="rounded-sm bg-danger-bg px-2 py-1 text-xs text-danger-fg" data-testid="ai-chat-error">
          {chatError}
        </p>
      )}

      <form
        className={cn('flex shrink-0 items-end border-t border-border pt-2', compact ? 'gap-group-m' : 'gap-1')}
        data-testid="ai-composer"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <Textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={compact ? 1 : 2}
          disabled={!enabled}
          aria-label="向 AI 提问"
          placeholder={enabled ? '询问本案（Enter 发送，Shift+Enter 换行）' : 'AI 外发已关闭'}
          size={compact ? 'lg' : 'md'}
          className={cn('flex-1 resize-none py-1.5 text-sm', !compact && 'min-h-sm-control')}
          data-testid="ai-chat-input"
        />
        <div className={cn('flex', compact ? 'flex-row gap-group-m self-center' : 'flex-col gap-1')}>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept=".md,.markdown,.txt,.text,.csv,.tsv,.json,.jsonl,.log,.xml,.yaml,.yml,.html,.htm,.docx,.pdf,.py,.js,.ts,.java,.c,.cpp,.h,.rs,.go,.sh,.sql,.ini,.cfg,.toml"
            onChange={(e) => void pickFiles(e.target.files)}
            data-testid="ai-attach-input"
          />
          <Button
            type="button"
            size={compact ? 'icon-md' : 'icon-sm'}
            variant="ghost"
            onPointerDown={keepFocus}
            onClick={() => fileRef.current?.click()}
            disabled={!enabled || attaching || attachments.length >= 8}
            aria-label="添加附件" title={attaching ? '解析中…' : '添加附件（文档/代码/文本，模型不读图）'}
            data-testid="ai-attach-btn"
          >
            {attaching ? <Loader2 className="animate-spin" /> : <Paperclip />}
          </Button>
          {streaming ? (
            <Button type="button" size={compact ? 'icon-md' : 'icon-sm'} variant="secondary" onPointerDown={keepFocus} onClick={stopStreaming} aria-label="停止生成" title="停止生成" data-testid="ai-chat-stop">
              <Square />
            </Button>
          ) : (
            <Button type="submit" size={compact ? 'icon-md' : 'icon-sm'} variant="soft" onPointerDown={keepFocus} disabled={!enabled || !text.trim()} aria-label="发送" title="发送" data-testid="ai-chat-send">
              <SendHorizontal />
            </Button>
          )}
          <Button
            type="button"
            size={compact ? 'icon-md' : 'icon-sm'}
            variant="ghost"
            onPointerDown={keepFocus}
            onClick={clearChat}
            disabled={chat.length === 0 || streaming}
            aria-label="清空对话" title="清空对话"
            data-testid="ai-chat-clear"
          >
            <Eraser />
          </Button>
        </div>
      </form>
    </section>
  )
}

function Message({ m }: { m: ChatMessage }) {
  const user = m.role === 'user'
  return (
    <div
      className={cn(
        'max-w-11/12 whitespace-pre-wrap break-words rounded-md px-2.5 py-1.5 text-sm leading-5',
        user ? 'self-end bg-selected text-fg-strong' : 'self-start bg-panel text-fg shadow-sm',
        m.error && 'border border-danger-dot',
      )}
      data-testid={`ai-msg-${m.role}`}
      data-streaming={m.streaming || undefined}
    >
      {user ? m.content : <MarkdownRefs text={m.content || (m.streaming ? '…' : '')} />}
      {!user && m.steps?.length ? <StepsRow steps={m.steps} /> : null}
      {!user && m.confirm ? <ConfirmCard m={m} /> : null}
      {m.attachments?.length ? (
        <div className="mt-1 flex flex-wrap gap-1" data-testid="ai-msg-attach">
          {m.attachments.map((a) => (
            <span key={a.name} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs text-fg-muted">
              <FileText className="size-3" aria-hidden />{a.name}（{a.chars}字{a.truncated ? '·截断' : ''}）
            </span>
          ))}
        </div>
      ) : null}
      {m.error && <span className="mt-1 block text-xs text-danger-fg">出错：{m.error}</span>}
    </div>
  )
}

/** agent 工具步小票：name + 状态点 + summary，running 转圈；>4 步时前置已完成步默认折叠；
 *  单步长 summary 可点开看全文（Solve 推理叙事栏的紧凑版） */
const STEPS_KEEP_TAIL = 2
const STEP_SUMMARY_LONG = 40
function StepItem({ s }: { s: NonNullable<ChatMessage['steps']>[number] }) {
  const [open, setOpen] = useState(false)
  const long = (s.summary?.length ?? 0) > STEP_SUMMARY_LONG
  return (
    <li data-testid={`ai-step-${s.status}`}>
      <button
        type="button"
        disabled={!long}
        onClick={() => setOpen(!open)}
        aria-expanded={long ? open : undefined}
        title={long && !open ? s.summary : undefined}
        className={cn('flex w-full items-center gap-1.5 rounded-xs text-left text-2xs text-fg-muted', long && FOCUS_RING, !long && 'cursor-default')}
        data-testid={`ai-step-${s.id}`}
      >
        {s.status === 'running'
          ? <Loader2 className="size-3 animate-spin" aria-hidden />
          : s.status === 'ok'
            ? <Check className="size-3 text-success-fg" aria-hidden />
            : <X className="size-3 text-danger-fg" aria-hidden />}
        <span className="font-mono">{s.name}</span>
        {s.summary ? <span className={cn('text-fg-subtle', !open && 'truncate')}>{s.summary}</span> : null}
        {long ? <ChevronDown className={cn('ml-auto size-3 shrink-0 transition-transform duration-(--dur-fast)', open && 'rotate-180')} aria-hidden /> : null}
      </button>
      {open && long ? (
        <p className="mb-0.5 mt-0.5 whitespace-pre-wrap break-words pl-5 text-2xs leading-4 text-fg-subtle" data-testid={`ai-step-detail-${s.id}`}>{s.summary}</p>
      ) : null}
    </li>
  )
}
function StepsRow({ steps }: { steps: NonNullable<ChatMessage['steps']> }) {
  const [expanded, setExpanded] = useState(false)
  const folded = !expanded && steps.length > 4
  const hidden = folded ? steps.slice(0, -STEPS_KEEP_TAIL) : []
  const visible = folded ? steps.slice(-STEPS_KEEP_TAIL) : steps
  const renderStep = (s: (typeof steps)[number]) => <StepItem key={s.id} s={s} />
  return (
    <div className="mt-1.5" data-testid="ai-steps">
      {hidden.length > 0 ? (
        <button
          type="button"
          className={cn('mb-0.5 rounded-sm text-2xs text-fg-subtle hover:text-fg', FOCUS_RING)}
          onClick={() => setExpanded(true)}
          data-testid="ai-steps-expand"
        >
          展开 {hidden.length} 步已完成 ▸
        </button>
      ) : null}
      <ul className="space-y-0.5 border-l-2 border-border pl-2">
        {(expanded ? steps : visible).map(renderStep)}
      </ul>
      {expanded ? (
        <button
          type="button"
          className={cn('mt-0.5 rounded-sm text-2xs text-fg-subtle hover:text-fg', FOCUS_RING)}
          onClick={() => setExpanded(false)}
          data-testid="ai-steps-collapse"
        >
          收起 ▾
        </button>
      ) : null}
    </div>
  )
}

/** agent 确认卡：写面/计划待裁决——执行/拒绝；decision 后落已批准/已拒绝 */
function ConfirmCard({ m }: { m: ChatMessage }) {
  const answerConfirm = useStudio((s) => s.answerConfirm)
  const c = m.confirm!
  const argsBrief = Object.entries(c.args)
    .filter(([k]) => k !== 'pid')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v)}`)
    .join(' ')
  return (
    <div
      className={cn('mt-2 rounded-sm border px-2.5 py-2 text-xs', c.danger ? 'border-danger-dot bg-danger-bg/40' : 'border-border bg-canvas/60')}
      data-testid="ai-confirm"
      data-danger={c.danger || undefined}
    >
      <div className="flex items-center gap-1.5 font-medium text-fg">
        <Wrench className="size-3" aria-hidden />
        {c.tool === 'propose_plan' ? '执行计划' : `调用 ${c.tool}`}
        {c.danger ? <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-2xs text-danger-fg">危险操作</span> : null}
        {c.stage === 2 ? <span className="rounded-full bg-danger-bg px-1.5 py-0.5 text-2xs text-danger-fg">二次确认</span> : null}
      </div>
      {c.plan_md ? <div className="mt-1.5" data-testid="ai-confirm-plan"><Markdown text={c.plan_md} /></div> : null}
      {!c.plan_md && argsBrief ? <p className="mt-1 break-all font-mono text-2xs text-fg-muted" title={argsBrief}>{argsBrief}</p> : null}
      {c.decision ? (
        <p className="mt-1.5 text-2xs text-fg-subtle" data-testid="ai-confirm-decision">
          {c.decision === 'approved' ? '已批准，继续执行' : '已拒绝'}
        </p>
      ) : (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="soft" onClick={() => answerConfirm(m.id, true)} data-testid="ai-confirm-approve">
            {c.tool === 'propose_plan' ? '按计划执行' : c.stage === 2 ? '确认执行' : '执行'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => answerConfirm(m.id, false)} data-testid="ai-confirm-decline">拒绝</Button>
        </div>
      )}
    </div>
  )
}

/** assistant 消息：[00NN] 拆段——文本段走 markdown 渲染，段号仍是可点按钮（code 块内的 [00NN] 不该可点，拆段在渲染前故天然不误伤） */
function MarkdownRefs({ text }: { text: string }) {
  const segs: { t: 'md' | 'ref'; s: string }[] = []
  const re = new RegExp(PARA_REF_RE.source, PARA_REF_RE.flags)
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) segs.push({ t: 'md', s: text.slice(last, m.index) })
    segs.push({ t: 'ref', s: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) segs.push({ t: 'md', s: text.slice(last) })
  return <>{segs.map((seg, i) => seg.t === 'md' ? <Markdown key={i} text={seg.s} /> : <ParaRef key={i} text={seg.s} />)}</>
}

function ParaRef({ text }: { text: string }) {
  return <ParaRefs text={text} />
}

/** 回答里的 `[0012]` 渲染为可点按钮 → focusParaNo（找不到对应段时 toast） */
export function ParaRefs({ text }: { text: string }) {
  const toast = useStudio((s) => s.toast)
  const parts: ReactNode[] = []
  let last = 0
  const re = new RegExp(PARA_REF_RE.source, PARA_REF_RE.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const n = parseInt(m[1], 10)
    parts.push(
      <button
        key={`${m.index}`}
        type="button"
        className={cn('inline rounded-xs font-mono text-link underline decoration-dotted underline-offset-2 hover:decoration-solid', FOCUS_RING)}
        aria-label={`定位到说明书段落 ${m[0]}`}
        data-testid={`ai-para-ref-${m[1]}`}
        onClick={() => {
          if (!focusParaNo(n)) toast(`未找到段落 ${m![0]}（可能已被重新编号）`, 'info')
        }}
      >
        {m[0]}
      </button>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>
}

function Chip({
  pressed, onClick, onRemove, disabled, testId, children,
}: {
  pressed: boolean
  onClick: () => void
  onRemove?: () => void
  disabled?: boolean
  testId: string
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-stretch">
      <button
        type="button"
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        data-testid={testId}
        className={cn(
          touchHit,
          'inline-flex h-xs-control max-w-full items-center rounded-l-full border px-2.5 text-2xs',
          !onRemove && 'rounded-r-full',
          pressed ? 'border-brand-300 bg-selected text-fg-strong' : 'border-border text-fg-muted line-through',
          'disabled:text-fg-disabled disabled:no-underline',
          FOCUS_RING,
          TRANSITION_COLOR,
        )}
      >
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="移除选区上下文" title="移除选区上下文"
          className={cn(touchHit, 'inline-flex size-xs-control items-center justify-center rounded-r-full border border-l-0 border-border text-fg-muted hover:text-fg', FOCUS_RING)}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  )
}

/** P05：发送范围绑定的版本标识——内容 sha 短 8 位 + 案卷 pid。
   真值 = 服务端已存正文（ai_chat 按 read_content 盖章）：优先本地已验证 savedSha
   （随 saved 切案重置），空时仅回退同案 context 快照；本地未保存修改另行标注。 */
function VersionTag() {
  const sha = useStudio(selectBoundSha)
  const pid = useStudio((s) => s.pid)
  const dirty = useStudio(selectDirty)
  const v = sha.slice(0, 8)
  if (!pid || !v) return null
  return (
    <span
      className="ml-auto inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 font-mono text-2xs text-fg-subtle"
      title={
        dirty
          ? `本轮上下文绑定案卷 ${pid} · 服务端已存版本 ${v}（本地未保存修改不在上下文内）`
          : `本轮上下文绑定案卷 ${pid} · 版本 ${v}`
      }
      data-testid="ai-scope-version"
    >
      {pid}@{v}
      {dirty ? '·未存' : ''}
    </span>
  )
}
