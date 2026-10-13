import {
  Bot, CalendarCheck2, CalendarClock, CalendarX2, CircleDot, Download, FilePlus2, Link2, MessageSquareText, Reply, Send, ShieldCheck, UserCheck, type LucideIcon,
} from 'lucide-react'
import type { TimelineEventKind } from '@/types/timeline'
/** 时间线事件类型 → 图标 / 标签 / 节点色（05 §3.16；语义族 info / ok / warn / violet / teal / 中性，不全绿） */
export const TIMELINE_KIND: Record<TimelineEventKind, { Icon: LucideIcon; label: string; className: string }> = {
  'case.created': { Icon: FilePlus2, label: '建案', className: 'bg-sunken text-fg-muted' },
  'case.status': { Icon: CircleDot, label: '状态', className: 'bg-info-bg text-info-fg' },
  note: { Icon: MessageSquareText, label: '备注', className: 'bg-info-bg text-info-fg' },
  'share.created': { Icon: Link2, label: '分享', className: 'bg-sunken text-fg-muted' },
  'share.confirmed': { Icon: ShieldCheck, label: '客户确认', className: 'bg-ok-bg text-ok-fg' },
  'deliver.filed': { Icon: Send, label: '递交', className: 'bg-ok-bg text-ok-fg' },
  'oa.round': { Icon: Reply, label: 'OA', className: 'bg-warn-bg text-warn-fg' },
  'deadline.done': { Icon: CalendarCheck2, label: '期限完成', className: 'bg-ok-bg text-ok-fg' },
  'deadline.undone': { Icon: CalendarX2, label: '撤销期限完成', className: 'bg-warn-bg text-warn-fg' },
  'deadline.override': { Icon: CalendarClock, label: '期限改期', className: 'bg-warn-bg text-warn-fg' },
  'review.assigned': { Icon: UserCheck, label: '指派审阅', className: 'bg-violet-bg text-violet-fg' },
  'export.downloaded': { Icon: Download, label: '导出', className: 'bg-sunken text-fg-muted' },
  'ai.proposal': { Icon: Bot, label: 'AI 提案', className: 'bg-teal-bg text-teal-fg' },
}

/** 事件文本按 @提及 切段（提及原文保留在 text 中，mentions 为名单） */
export function splitMentions(text: string, mentions: readonly string[]): { text: string; mention: boolean }[] {
  if (mentions.length === 0 || !text.includes('@')) return [{ text, mention: false }]
  const names = [...mentions].sort((a, b) => b.length - a.length)
  const out: { text: string; mention: boolean }[] = []
  let i = 0
  let plain = ''
  while (i < text.length) {
    if (text[i] === '@') {
      const hit = names.find((n) => text.startsWith(n, i + 1))
      if (hit) {
        if (plain) out.push({ text: plain, mention: false })
        plain = ''
        out.push({ text: `@${hit}`, mention: true })
        i += hit.length + 1
        continue
      }
    }
    plain += text[i]
    i++
  }
  if (plain) out.push({ text: plain, mention: false })
  return out
}
