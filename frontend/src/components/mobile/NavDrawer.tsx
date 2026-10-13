import { BookA, FileText, Files, History, Image, ListTree, MessageSquareText, Settings2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { OutlinePanel } from '@/components/outline/OutlinePanel'
import { HistoryPanel } from '@/components/outline/HistoryPanel'
import { FileTree } from '@/components/outline/FileTree'
import { FigureBookView } from '@/components/figure-book/FigureBookView'
import { FilePreviewPanel } from '@/components/attachments/FilePreviewPanel'
import { ReviewPanel } from '@/components/review/ReviewPanel'
import { TermsPanel } from '@/components/terms/TermsPanel'
import { useStudio, type RailTab } from '@/store'
import { FOCUS_RING_INSET, cn } from '@/lib/utils'

/** AI 不在抽屉里：移动 AI 走底部 Tab（MobileAiTab），避免双入口 */
type NavTab = 'files' | Exclude<RailTab, 'ai'>

const TABS: { id: NavTab; label: string; Icon: typeof History }[] = [
  { id: 'files', label: '案卷文件', Icon: Files },
  { id: 'outline', label: '大纲', Icon: ListTree },
  { id: 'history', label: '历史', Icon: History },
  { id: 'figures', label: '附图书', Icon: Image },
  { id: 'review', label: '审阅', Icon: MessageSquareText },
  { id: 'terms', label: '术语', Icon: BookA },
]

/**
 * 左侧导航抽屉（07 §3 NavDrawer）：案卷文件 / 大纲 / 历史 / 附图书（W4-C）/ 审阅（R6）/ 术语，复用 FileTree / OutlinePanel / HistoryPanel / FigureBookView / ReviewPanel。
 * 开关与 tab = ui.mobileNav（不复用 ui.railTab：setRailTab 会联动桌面 outlineOpen）。
 * 离开抽屉的动作（大纲跳行 → doc.gotoLine；恢复备份 → doc.restore）由 store 自行关闭抽屉；面板内的展开/选中不关闭。
 *
 * mobileNav.tab 含 'files'（R99 起在 store 内，不再用本地 state）。
 */
export function NavDrawer() {
  const open = useStudio((s) => s.mobileNav.open)
  const storeTab = useStudio((s) => s.mobileNav.tab)
  const openMobileNav = useStudio((s) => s.openMobileNav)
  const closeMobileNav = useStudio((s) => s.closeMobileNav)
  const tab: NavTab = storeTab === 'checks' || storeTab === 'search' || storeTab === 'ai' ? 'outline' : storeTab
  const onOpenChange = (o: boolean) => (o ? openMobileNav() : closeMobileNav())
  const onTabChange = (t: NavTab) => {
    const s = useStudio.getState()
    s.setPreviewFig(null)
    s.setPreviewAttachment(null)
    openMobileNav(t)
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" hideClose data-density="touch" className="w-[85vw] max-w-[320px] gap-0 p-0" data-slot="NavDrawer" data-testid="nav-drawer">
        <SheetHeader className="h-mobile-topbar flex-row items-center gap-group-m py-0 pl-page-m pr-2 pt-[env(safe-area-inset-top)]">
          <SheetTitle className="flex-1 text-base">导航</SheetTitle>
          <SheetDescription className="sr-only">案卷文件、大纲、版本历史、附图、审阅与术语</SheetDescription>
          <SheetClose asChild>
            <Button size="icon-md" variant="ghost" aria-label="关闭导航" title="关闭导航">
              <X className="size-5" />
            </Button>
          </SheetClose>
        </SheetHeader>
        {/* Tab 条：面板头 44（md 档）套 ScrollRow 可滑不裁切；下划线与 Tabs 原语同样式 */}
        <ScrollRow bleed={false} role="tablist" aria-label="导航抽屉" className="my-0 gap-1 border-b py-0 px-2" data-testid="nav-tabs-row">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`nav-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="nav-tabpanel"
              data-testid={`nav-tab-${id}`}
              className={cn(
                'flex h-panel-header items-center justify-center gap-1.5 border-b-2 px-2.5 text-sm',
                FOCUS_RING_INSET,
                tab === id ? 'border-primary font-medium text-primary-text' : 'border-transparent text-fg-muted',
              )}
              onClick={() => onTabChange(id)}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </ScrollRow>
        <div id="nav-tabpanel" role="tabpanel" aria-labelledby={`nav-tab-${tab}`} className="min-h-0 flex-1 overflow-auto [&_button]:min-h-touch">
          {tab === 'files' && <MobileFileList />}
          {tab === 'outline' && <OutlinePanel />}
          {tab === 'history' && <HistoryPanel />}
          {tab === 'figures' && <FigureBookView variant="mobile" />}
          {tab === 'review' && <ReviewPanel />}
          {tab === 'terms' && <TermsPanel />}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * 案卷文件 tab：FileTree（docs/ figs/ attachments/ studio.json content.md）+ 移动特有的「去编辑 / 去设置」两行。
 * 点开 figs/ 或 attachments/ 下的文件（previewFig / previewAttachment 非空）时，整个 tab 换成 FilePreviewPanel + 「返回文件」（15 §5.2）。
 */
function MobileFileList() {
  const pid = useStudio((s) => s.pid)
  const setMobileTab = useStudio((s) => s.setMobileTab)
  const closeMobileNav = useStudio((s) => s.closeMobileNav)
  const toggleMobileSettings = useStudio((s) => s.toggleMobileSettings)
  const mobileTab = useStudio((s) => s.mobileTab)
  const settingsOpen = useStudio((s) => s.mobileSettingsOpen)
  const previewing = useStudio((s) => s.previewFig ?? s.previewAttachment)
  if (!pid) return <div className="p-6 text-center text-xs text-fg-muted">请先打开一个案子</div>
  const row = cn(
    'flex w-full items-center gap-2 px-4 text-left text-sm hover:bg-sunken [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted',
    FOCUS_RING_INSET,
  )
  if (previewing) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="mobile-file-preview">
        <button
          type="button"
          className={row}
          onClick={() => {
            const s = useStudio.getState()
            s.setPreviewFig(null)
            s.setPreviewAttachment(null)
          }}
          data-testid="mobile-file-preview-back"
        >
          <Files />
          返回案卷文件
        </button>
        <FilePreviewPanel className="min-h-0 flex-1" />
      </div>
    )
  }
  return (
    <div className="py-1" data-testid="mobile-file-list">
      <FileTree />
      <button
        type="button"
        className={cn(row, mobileTab === 'edit' && !settingsOpen && 'bg-primary-soft font-medium text-primary-text')}
        onClick={() => {
          toggleMobileSettings(false)
          setMobileTab('edit')
          closeMobileNav()
        }}
        aria-current={mobileTab === 'edit' && !settingsOpen ? 'page' : undefined}
        data-testid="file-content"
      >
        <FileText />
        全文
      </button>
      <button
        type="button"
        className={cn(row, settingsOpen && 'bg-primary-soft font-medium text-primary-text')}
        onClick={() => {
          toggleMobileSettings(true)
          closeMobileNav()
        }}
        aria-current={settingsOpen ? 'page' : undefined}
        data-testid="file-settings"
      >
        <Settings2 />
        排版设置
      </button>
    </div>
  )
}
