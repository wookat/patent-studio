import { Columns2, PictureInPicture2, Rows2, SquareSplitHorizontal } from 'lucide-react'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { MenuContent, MenuLabel, MenuRow, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger } from '@/components/ui/menu-bits'
import { bookViewLabel } from '@/layout/registry'
import { makePanelId, type BookView, type PanelId, type PanelKind } from '@/store/layout'
import { useStudio } from '@/store'
import { FOCUS_RING, cn } from '@/lib/utils'
import { openOptions } from './sync'
import type { OpenPlacement } from './types'

/**
 * 卡片标题栏「打开为…」（docs/plan/08-r4-dockview-design.md §4.2）：
 * 相对**本面板**拆分到右侧 / 下方，或打开为浮动窗口；可选视图 = 源码（各书 + 全文）/ 结构（各书 + 全文）/ PDF。
 * 全部走 store.layout.openPanel（D1 的 DockHandle 落地；移动壳退化为 tab 切换），不 import dockview。
 */

const PLACEMENTS: { id: OpenPlacement; label: string; icon: typeof Columns2 }[] = [
  { id: 'right', label: '拆分到右侧', icon: Columns2 },
  { id: 'below', label: '拆分到下方', icon: Rows2 },
  { id: 'floating', label: '打开为浮动窗口', icon: PictureInPicture2 },
]

const BOOK_ORDER: readonly BookView[] = ['abstract', 'claims', 'description', 'all']

interface Props {
  panelId: PanelId
  /** 当前卡片的书：菜单里首选它（同书的另一视图），其它书列在后面 */
  book: BookView
  className?: string
}

export function OpenAsMenu({ panelId, book, className }: Props) {
  const openPanel = useStudio((s) => s.openPanel)
  const open = (kind: PanelKind, b: BookView, placement: OpenPlacement) =>
    openPanel(makePanelId(kind, kind === 'pdf' ? null : b), openOptions(panelId, placement))
  const books = [book, ...BOOK_ORDER.filter((b) => b !== book)]

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        type="button"
        aria-label="打开为…"
        title="打开为…"
        className={cn(
          'card-win-ctrl inline-flex size-6 items-center justify-center rounded text-fg-muted outline-none hover:bg-hover hover:text-fg-strong',
          FOCUS_RING, 'data-[state=open]:bg-active',
          className,
        )}
        data-testid="card-open-as"
      >
        <SquareSplitHorizontal className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <MenuContent align="end" className="min-w-[200px]">
        {PLACEMENTS.map((p) => (
          <MenuSub key={p.id}>
            <MenuSubTrigger icon={<p.icon />} data-testid={`card-open-${p.id}`}>
              {p.label}
            </MenuSubTrigger>
            <MenuSubContent className="min-w-[180px]">
              <MenuLabel>源码</MenuLabel>
              {books.map((b) => (
                <MenuRow key={`source:${b}`} noIcon onSelect={() => open('source', b, p.id)} data-testid={`card-open-${p.id}-source-${b}`}>
                  {bookViewLabel(b)}
                </MenuRow>
              ))}
              <MenuSeparator />
              <MenuLabel>结构</MenuLabel>
              {books.map((b) => (
                <MenuRow key={`layout:${b}`} noIcon onSelect={() => open('layout', b, p.id)} data-testid={`card-open-${p.id}-layout-${b}`}>
                  {bookViewLabel(b)}
                </MenuRow>
              ))}
              <MenuSeparator />
              <MenuRow noIcon onSelect={() => open('pdf', 'all', p.id)} data-testid={`card-open-${p.id}-pdf`}>
                PDF
              </MenuRow>
            </MenuSubContent>
          </MenuSub>
        ))}
      </MenuContent>
    </DropdownMenu>
  )
}
