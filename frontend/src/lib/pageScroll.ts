/** 页级列表滚动位置（会话内存）：进案卷后返回原页把位置写回，刷新页面自然清零。 */

const scrolls = new Map<string, { top: number; left: number }>()

export function savePageScroll(key: string, el: HTMLElement | null | undefined): void {
  if (!el) return
  if (el.scrollTop > 0 || el.scrollLeft > 0) scrolls.set(key, { top: el.scrollTop, left: el.scrollLeft })
  else scrolls.delete(key)
}

export function pageScroll(key: string): { top: number; left: number } | undefined {
  return scrolls.get(key)
}
