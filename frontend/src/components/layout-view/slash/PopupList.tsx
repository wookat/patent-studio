import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

export interface PopupItem {
  id: string
  label: string
  hint?: string
  /** 不可选信息行（如加载失败原因）；仍占 option 位可经方向键朗读 */
  disabled?: boolean
}

export interface PopupAnchor {
  x: number
  y: number
}

/**
 * 键盘漫游状态：ArrowUp / ArrowDown 循环，Enter 选中，Escape 关闭；IME 组合中（isComposing）一律不处理。
 * 返回 handleKey 给两处调用：弹层自身（工具条「插入」打开、焦点在列表上）与 LayoutView 的捕获阶段（焦点仍在块编辑器里）。
 */
export function usePopupNav(count: number, onSelect: (index: number) => void, onClose: () => void) {
  const [raw, setActive] = useState(0)
  const active = Math.min(raw, Math.max(0, count - 1))
  const handleKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (e.nativeEvent.isComposing) return false
      switch (e.key) {
        case 'ArrowDown':
          if (count) setActive((i) => (i + 1) % count)
          return true
        case 'ArrowUp':
          if (count) setActive((i) => (i - 1 + count) % count)
          return true
        case 'Enter':
          if (count) onSelect(active)
          else onClose()
          return true
        case 'Escape':
          onClose()
          return true
        default:
          return false
      }
    },
    [active, count, onSelect, onClose],
  )
  return { active, setActive, handleKey }
}

export interface PopupListProps {
  id: string
  label: string
  testId: string
  items: readonly PopupItem[]
  active: number
  anchor: PopupAnchor | null
  /** 打开时把焦点移到列表上（工具条触发）；false = 焦点留在块编辑器，键盘由外层捕获转发 */
  autoFocus?: boolean
  empty?: string
  /** 选项附加类（如 ps-slash-item），供样式 / 测试定位 */
  itemClass?: string
  onHover(index: number): void
  onSelect(index: number): void
  onClose(): void
  onKeyDown(e: KeyboardEvent): boolean
}

/**
 * role=listbox + li[role=option]（不嵌套 button，axe nested-interactive）；aria-activedescendant 指向当前项。
 * mousedown 阻止默认：不夺走块编辑器焦点（否则 BlockEditor 失焦即提交）。
 */
export function PopupList({ id, label, testId, items, active, anchor, autoFocus, empty, itemClass, onHover, onSelect, onClose, onKeyDown }: PopupListProps) {
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    const list = ref.current
    const opt = list?.querySelector<HTMLElement>(`#${id}-opt-${active}`)
    if (!list || !opt) return
    if (opt.offsetTop < list.scrollTop) list.scrollTop = opt.offsetTop
    else if (opt.offsetTop + opt.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = opt.offsetTop + opt.offsetHeight - list.clientHeight
  }, [id, active])
  const style: CSSProperties | undefined = anchor ? { left: anchor.x, top: anchor.y } : undefined
  return (
    <ul
      ref={ref}
      id={id}
      role="listbox"
      aria-label={label}
      aria-activedescendant={items.length ? `${id}-opt-${active}` : undefined}
      tabIndex={autoFocus ? 0 : -1}
      data-testid={testId}
      className={cn('ps-popup', !anchor && 'ps-popup-static')}
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (onKeyDown(e)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onBlur={() => {
        if (!autoFocus) return
        /* 延迟一拍再判焦点真去向：宿主重渲染 / StrictMode 重挂会让 focused 列表产生
           relatedTarget=null 的瞬态 blur——同步按 relatedTarget 判关会把刚打开的菜单误关。
           一拍后焦点仍不在列表内（body / 其他控件）才算真离开；实例已卸载则无需动作。 */
        window.setTimeout(() => {
          const list = ref.current
          if (list && !list.contains(document.activeElement)) onClose()
        }, 0)
      }}
    >
      {items.length === 0 && empty && (
        <li role="option" aria-selected={false} aria-disabled="true" className="ps-popup-empty">
          {empty}
        </li>
      )}
      {items.map((it, i) => (
        <li
          key={it.id}
          id={`${id}-opt-${i}`}
          role="option"
          aria-selected={i === active}
          data-active={i === active || undefined}
          data-kind={it.id}
          aria-disabled={it.disabled || undefined}
          className={cn('ps-popup-item', itemClass, it.disabled && 'ps-popup-empty')}
          onMouseEnter={() => onHover(i)}
          onClick={() => !it.disabled && onSelect(i)}
        >
          <span className="ps-popup-label">{it.label}</span>
          {it.hint && <span className="ps-popup-hint">{it.hint}</span>}
        </li>
      ))}
    </ul>
  )
}
