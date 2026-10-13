import type { KeyboardEvent } from 'react'

/** 侧栏树里可见的节点行（折叠的子树不在 DOM 里） */
const rowsOf = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])

/**
 * 树容器的键盘漫游（roving tabindex）：↑/↓ 在可见节点间移动焦点，Home/End 首尾。
 * Enter/Space/←/→ 由节点行自身处理（激活 / 折叠展开）。
 */
export function treeKeyDown(e: KeyboardEvent<HTMLElement>) {
  const rows = rowsOf(e.currentTarget)
  const i = rows.indexOf(document.activeElement as HTMLElement)
  if (!rows.length) return
  let next = -1
  if (e.key === 'ArrowDown') next = i < 0 ? 0 : Math.min(rows.length - 1, i + 1)
  else if (e.key === 'ArrowUp') next = i < 0 ? rows.length - 1 : Math.max(0, i - 1)
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = rows.length - 1
  if (next < 0) return
  e.preventDefault()
  rows[next].focus()
}
