import { useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import { useStudio } from '@/store'
import type { Member } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Avatar } from '@/components/ui/avatar'

/** 光标前最近的 `@词`（词内无空白 / 第二个 @） */
const MENTION_RE = /(^|[\s(（])@([^\s@]*)$/

export interface MentionTextareaProps extends Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> {
  value: string
  onValueChange(v: string): void
  /** 提交（Ctrl/Cmd+Enter；提及列表打开时 Enter 先选人） */
  onSubmit?(): void
  onCancel?(): void
  /** 成员列表来源；缺省取 store.members（打开的案子成员） */
  members?: Member[]
}

export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = MENTION_RE.exec(text.slice(0, caret))
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

export function filterMembers(members: Member[], q: string): Member[] {
  const s = q.trim().toLowerCase()
  if (!s) return members
  return members.filter((m) => m.display_name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s))
}

/**
 * 可 @ 提及的文本框（R-REV-02 / R-CASE-05）：输入 `@` 弹 cmdk Command 成员列表（↑↓ 选、Enter/Tab 插入 `@显示名 `、Esc 关）。
 * 提及以纯文本 `@显示名` 落在正文里，随批注 / 备注正文经现有 api.comments / api.addNote 持久化（mentions 解析在后端）。
 */
export function MentionTextarea({ value, onValueChange, onSubmit, onCancel, members: membersProp, className, onKeyDown, ...props }: MentionTextareaProps) {
  const storeMembers = useStudio((s) => s.members)
  const members = membersProp ?? storeMembers
  const ref = useRef<HTMLTextAreaElement>(null)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [picked, setSelected] = useState<string>('')

  const matches = useMemo(() => (mention ? filterMembers(members, mention.query) : []), [members, mention])
  const selected = matches.some((m) => m.user_id === picked) ? picked : (matches[0]?.user_id ?? '')

  const fetched = useRef(false)
  const sync = (el: HTMLTextAreaElement) => {
    const q = mentionQuery(el.value, el.selectionStart ?? el.value.length)
    setMention(q)
    if (q && !membersProp && !fetched.current) {
      fetched.current = true
      const s = useStudio.getState()
      if (s.pid && s.authStatus === 'authed' && s.members.length === 0) void s.loadMembers(s.pid)
    }
  }

  const insert = (m: Member) => {
    if (!mention) return
    const el = ref.current
    const caret = el?.selectionStart ?? value.length
    // 无显示名的成员退 email 本地段——整 email 的第二个 @ 会被后端 mention 解析截断，解析侧同样按本地段匹配
    const name = m.display_name.trim() || m.email.split('@', 1)[0]
    const next = `${value.slice(0, mention.start)}@${name} ${value.slice(caret)}`
    onValueChange(next)
    setMention(null)
    const pos = mention.start + name.length + 2
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length > 0) {
      const idx = Math.max(0, matches.findIndex((m) => m.user_id === selected))
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected(matches[(idx + 1) % matches.length].user_id)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected(matches[(idx - 1 + matches.length) % matches.length].user_id)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insert(matches[idx])
        return
      }
    }
    if (e.key === 'Escape') {
      if (mention) {
        e.preventDefault()
        e.stopPropagation()
        setMention(null)
        return
      }
      onCancel?.()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      onSubmit?.()
      return
    }
    onKeyDown?.(e)
  }

  const open = mention !== null

  return (
    <div className="relative" data-slot="mention-textarea">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value)
          sync(e.target)
        }}
        onKeyDown={handleKey}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') sync(e.currentTarget)
        }}
        onClick={(e) => sync(e.currentTarget)}
        onBlur={() => setTimeout(() => setMention(null), 120)}
        className={cn('min-h-0 text-xs', className)}
        aria-autocomplete="list"
        {...props}
      />
      {open && (
        <Command
          value={selected}
          onValueChange={setSelected}
          shouldFilter={false}
          className="absolute left-0 top-full z-popover mt-1 h-auto w-full max-w-72 rounded-md border shadow-md"
          data-testid="mention-list"
          label="提及成员"
        >
          <CommandList className="max-h-56">
            <CommandEmpty>{members.length === 0 ? '本案暂无其他成员' : '没有匹配的成员'}</CommandEmpty>
            <CommandGroup heading="提及成员">
              {matches.map((m) => (
                <CommandItem
                  key={m.user_id}
                  value={m.user_id}
                  onSelect={() => insert(m)}
                  onMouseDown={(e) => e.preventDefault()}
                  data-testid={`mention-item-${m.user_id}`}
                >
                  <Avatar size="sm" name={m.display_name || m.email} />
                  <span className="truncate" title={m.display_name || m.email}>{m.display_name || m.email}</span>
                  <span className="ml-auto truncate text-2xs text-fg-muted" title={m.email}>{m.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      )}
    </div>
  )
}
