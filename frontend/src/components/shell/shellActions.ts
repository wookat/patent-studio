import { useStudio, type Layout } from '@/store'

export const LAYOUT_MODES: { id: Layout; label: string }[] = [
  { id: 'split', label: '双栏' },
  { id: 'editor', label: '仅编辑' },
  { id: 'preview', label: '仅预览' },
]

/** 打开侧栏「版本历史」页（railTab='history'，已开则保持） */
export function showHistory() {
  const s = useStudio.getState()
  if (s.railTab !== 'history' || !s.outlineOpen) s.setRailTab('history')
}
