/**
 * 「跳到主内容」skip link（WCAG 2.4.1）：sr-only，聚焦时浮条显示。
 * hash-router SPA 不能用纯 `href="#main-content"` 裸锚（激活会改写 location.hash 被路由归一到 `#/`——
 * R19-01 实测把工作台传送回 dashboard）；必须 preventDefault + 手动聚焦目标（目标带 tabIndex=-1）。
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:z-popover focus-visible:rounded-sm focus-visible:bg-panel focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:text-link focus-visible:shadow-md"
      onClick={(e) => {
        e.preventDefault()
        const main = document.getElementById('main-content')
        main?.focus()
        main?.scrollIntoView()
      }}
    >
      跳到主内容
    </a>
  )
}
