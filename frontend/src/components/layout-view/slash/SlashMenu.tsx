import { useCallback, type KeyboardEvent } from 'react'
import type { BlockKind, BlockTemplate } from '@/lib/api'
import { PopupList, usePopupNav, type PopupAnchor } from './PopupList'

/** 说明书里的「附图」不是块模板：选中即打开附图书（figure-book 面板 / 375 抽屉页签）上传或排序，附图真源 docs/figures.md */
export const FIGURE_BOOK_ITEM = 'figure-book'
/** 块模板加载失败的信息行（disabled）与重试伪项：非模板，重试选中由调用方拦截去重拉（与 FIGURE_BOOK_ITEM 同形） */
export const TEMPLATE_ERROR_ITEM = '__template-error'
export const TEMPLATE_RETRY_ITEM = '__template-retry'
export type SlashItemId = BlockKind | typeof FIGURE_BOOK_ITEM | typeof TEMPLATE_ERROR_ITEM | typeof TEMPLATE_RETRY_ITEM

export interface SlashMenuProps {
  open: boolean
  /** 后端 block-templates 按当前书过滤后的候选（block-model/toolbar/insert.templatesFor） */
  items: BlockTemplate[]
  /** 追加「附图…」项（当前书是说明书时由 LayoutView 传入） */
  figureBook?: boolean
  /** 相对 .ps-layout-body 的光标位置；null = 静态放在工具条下 */
  anchor: PopupAnchor | null
  /** 空态文案覆盖（一般不传，用 error） */
  empty?: string
  /** 块模板加载失败信息：空态如实报原因 + 追加可点重试伪项（数据加载失败不装成空） */
  error?: string | null
  /** 焦点移到列表（工具条打开）；false = 焦点留在块编辑器，父层用 handleKey 转发按键 */
  autoFocus?: boolean
  onSelect(id: SlashItemId): void
  onClose(): void
}

export const SLASH_MENU_ID = 'ps-slash-menu'

/** 菜单行（含伪项）单源构建；ids 由行派生，键盘/点击共用同一 onSelect 与 disabled 守卫 */
const slashRows = (items: BlockTemplate[], figureBook?: boolean, error?: string | null): { id: SlashItemId; label: string; disabled?: boolean }[] => {
  const rows: { id: SlashItemId; label: string; disabled?: boolean }[] = []
  if (error) rows.push({ id: TEMPLATE_ERROR_ITEM, label: `块模板加载失败：${error}`, disabled: true })
  for (const t of items) rows.push({ id: t.kind, label: t.label })
  if (figureBook) rows.push({ id: FIGURE_BOOK_ITEM, label: '附图…（打开附图书）' })
  if (error) rows.push({ id: TEMPLATE_RETRY_ITEM, label: '重试加载块模板' })
  return rows
}

/**
 * `/` 插入菜单（16 §4.3）：候选 = 后端模板（kind → 书 的唯一来源），选中只调 insertBlock，前端不拼 Markdown；
 * 末项「附图…」复用 figure-book，不新造上传 / 渲染。
 * 键盘：ArrowUp / ArrowDown / Enter / Escape；IME 组合中不响应。
 */
export function useSlashMenu(items: BlockTemplate[], onSelect: (id: SlashItemId) => void, onClose: () => void, figureBook?: boolean, error?: string | null) {
  const rows = slashRows(items, figureBook, error)
  const select = useCallback((i: number) => {
    const r = rows[i]
    if (r && !r.disabled) onSelect(r.id)
  }, [rows, onSelect])
  return usePopupNav(rows.length, select, onClose)
}

export function SlashMenu({ open, items, figureBook, anchor, autoFocus, empty, error, onSelect, onClose, nav }: SlashMenuProps & { nav?: ReturnType<typeof useSlashMenu> }) {
  const own = useSlashMenu(items, onSelect, onClose, figureBook, error)
  const { active, setActive, handleKey } = nav ?? own
  if (!open) return null
  const popupItems = slashRows(items, figureBook, error)
  return (
    <PopupList
      id={SLASH_MENU_ID}
      label="插入块"
      testId="slash-menu"
      items={popupItems}
      active={active}
      anchor={anchor}
      autoFocus={autoFocus}
      empty={empty ?? '当前书没有可插入的块类型'}
      itemClass="ps-slash-item"
      onHover={setActive}
      onSelect={(i) => {
        const r = popupItems[i]
        if (r && !r.disabled) onSelect(r.id)
      }}
      onClose={onClose}
      onKeyDown={(e: KeyboardEvent) => handleKey(e)}
    />
  )
}
