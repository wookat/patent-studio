import {
  BookOpen,
  CalendarClock,
  Download,
  ExternalLink,
  FileInput,
  FileStack,
  FileText,
  FolderPlus,
  History,
  Image,
  Info,
  ListTree,
  Mail,
  MessageSquareText,
  PackageCheck,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Type,
  UserCircle2,
  Users,
  Wrench,
} from 'lucide-react'
import { LABEL_NEW_PROJECT } from '@/lib/copy'
import { Count } from '@/components/ui/count'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { StatusDot } from '@/components/ui/status-dot'
import { api } from '@/lib/api'
import { goDeliver } from '@/lib/hash'
import { ROLE_LABEL } from '@/lib/types'
import { useStudio, selectPdfUrl, selectOnlineCount, selectErrorCount } from '@/store'
import type { Density, Theme } from '@/store/ui'
import { FOCUS_RING, TRANSITION_COLOR, cn } from '@/lib/utils'
import { MobileEditorViewTabs } from './MobileEditorViewTabs'

/** 每项 44（06 §Sheet 列表项）：16 图标 · 15 文案 · 右侧 11px 副文案 / Count；Sheet 内边距 16（--pad-sheet-m），行 hover 底 -mx-2 出血 8 但文本仍对齐 16 */
const ITEM = cn(
  '-mx-2 flex min-h-touch items-center gap-3 rounded-md px-2 text-left text-base text-fg hover:bg-sunken disabled:text-fg-disabled disabled:hover:bg-transparent aria-disabled:pointer-events-none aria-disabled:text-fg-disabled [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted',
  FOCUS_RING,
  TRANSITION_COLOR,
)
const HINT = 'ml-auto text-2xs text-fg-muted'

const THEME_OPTIONS: readonly SegmentedOption<Theme>[] = [
  { value: 'light', label: '浅色', 'data-testid': 'more-theme-light' },
  { value: 'dark', label: '深色', 'data-testid': 'more-theme-dark' },
  { value: 'system', label: '跟随系统', 'data-testid': 'more-theme-system' },
]
const DENSITY_OPTIONS: readonly SegmentedOption<Density>[] = [
  { value: 'compact', label: '紧凑', 'data-testid': 'more-density-compact' },
  {
    value: 'comfortable',
    label: '舒适',
    'data-testid': 'more-density-comfortable',
  },
]

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2" aria-label={title}>
      <h3 className="pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-fg-muted">{title}</h3>
      <div className="grid" role="group">
        {children}
      </div>
    </section>
  )
}

/**
 * 更多 Sheet（05 §3.19 / S10e）：底部 Sheet ≤85dvh，抓手 + 头部（案名 · 案号 · 状态徽章 · 角色 · N 在线）+ 四组：
 * 编辑（源码｜版面 Segmented md）· 面板（大纲 / 审阅 / 版本历史 / 案件时间线 / 问题与检查 Count / 术语 / 附图 / 查找替换 / 控制台）·
 * 案卷（递交页 / 检查 / 下载 DOCX·PDF / 新标签页 / 排版设置 / 协作者·分享 / 新建 / 导入 Word / 转专利 / 回归检查）· 帮助（命令面板 / 语法 / 关于——桌面菜单栏与 ? 热键的触达补齐）· 外观（主题 · 密度 Segmented md，唯一入口）· 账户。
 * 每项 44（内边距 16）；Esc / 遮罩 / 下滑关闭；构建不在此处（顶栏 primary）。
 */
export function MoreSheet() {
  const open = useStudio((s) => s.moreOpen)
  const toggleMore = useStudio((s) => s.toggleMore)
  const openMobileNav = useStudio((s) => s.openMobileNav)
  const openConsole = useStudio((s) => s.openConsole)
  const openCompanion = useStudio((s) => s.openCompanion)
  const toggleTimeline = useStudio((s) => s.toggleTimeline)
  const pid = useStudio((s) => s.pid)
  const project = useStudio((s) => s.project)
  const authed = useStudio((s) => s.authStatus === 'authed')
  const buildId = useStudio((s) => s.lastOk?.build_id)
  const pdfUrl = useStudio(selectPdfUrl)
  const hasOk = pdfUrl !== null
  const setMobileTab = useStudio((s) => s.setMobileTab)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const openDialog = useStudio((s) => s.openDialog)
  const openCollabCenter = useStudio((s) => s.openCollabCenter)
  const online = useStudio(selectOnlineCount)
  const errors = useStudio(selectErrorCount)
  const theme = useStudio((s) => s.theme)
  const setTheme = useStudio((s) => s.setTheme)
  const density = useStudio((s) => s.density)
  const setDensity = useStudio((s) => s.setDensity)
  const toggleMobileSettings = useStudio((s) => s.toggleMobileSettings)
  const runLint = useStudio((s) => s.runLint)
  const lintRunning = useStudio((s) => s.lintRunning)
  const toast = useStudio((s) => s.toast)
  const href = (fmt: 'docx' | 'pdf') => (pid ? api.exportUrl(pid, fmt, buildId) : '#')
  const close = () => toggleMore(false)
  const go = (fn: () => void) => () => {
    close()
    fn()
  }

  /** 与桌面 导出 ▾ → 运行当前案检查 一致：立即运行 lint，切到控制台显示结果并 toast 汇总 */
  const runCheck = () => {
    close()
    openConsole('all')
    void runLint().then(() => {
      const run = useStudio.getState().lintRun
      if (!run) return
      if (run.error) toast(`检查失败：${run.error}`, 'error')
      else {
        const n = run.report?.diagnostics.length ?? 0
        toast(n ? `当前案检查：${n} 条问题` : '当前案检查：未发现问题', n ? 'info' : 'success')
      }
    })
  }

  const meta = [project?.case?.case_no, project?.role ? ROLE_LABEL[project.role] : null, online !== null ? `${online} 在线` : null].filter(Boolean).join(' · ')

  return (
    <Sheet open={open} onOpenChange={toggleMore}>
      <SheetContent
        side="bottom"
        hideClose
        data-density="touch"
        className="max-h-[85dvh] overflow-y-auto rounded-t-xl bg-panel px-sheet-m pt-sheet-top-m pb-[calc(var(--pad-sheet-m)+env(safe-area-inset-bottom))]"
        data-slot="MoreSheet"
        data-testid="more-sheet"
      >
        <div className="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-border-strong" aria-hidden />
        <SheetHeader className="flex-row items-center gap-3 border-b px-0 pb-3 pt-1 text-left">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-lg font-semibold text-fg-strong" data-testid="more-sheet-title">
              {project?.title ?? '更多操作'}
            </SheetTitle>
            <SheetDescription className="truncate font-mono text-2xs text-fg-muted" data-testid="more-sheet-meta">
              {meta || '构建、面板、交付与外观'}
            </SheetDescription>
          </div>
          {project?.case?.status && <StatusDot variant="badge" status={project.case.status} size="sm" className="shrink-0" data-testid="more-sheet-status" />}
        </SheetHeader>

        {pid && (
          <Group title="编辑">
            <div className="py-1">
              <MobileEditorViewTabs size="md" className="w-full" />
            </div>
          </Group>
        )}

        <Group title="面板">
          <button type="button" className={ITEM} disabled={!pid} onClick={() => openMobileNav('outline')} data-testid="more-outline">
            <ListTree />
            大纲
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={go(() => openCompanion('review'))} data-testid="more-review">
            <MessageSquareText />
            审阅修订 · 建议与批注
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={go(() => openCompanion('materials'))} data-testid="more-materials">
            <FileStack />
            资料事实 · 材料与事实确认
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={() => openMobileNav('history')} data-testid="more-history">
            <History />
            版本历史
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={go(() => toggleTimeline(true))} data-testid="more-timeline">
            <CalendarClock />
            案件时间线
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={go(() => openConsole('all'))} data-testid="more-console">
            <TerminalSquare />
            问题与控制台
            <Count value={errors} tone="danger" className="ml-auto" aria-label={`${errors} 个错误`} />
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={() => openMobileNav('terms')} data-testid="more-terms">
            <Type />
            术语
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={() => openMobileNav('figures')} data-testid="more-figures">
            <Image />
            附图
          </button>
          <button type="button" className={ITEM} disabled={!pid} onClick={go(() => openConsole('oa'))} data-testid="more-oa">
            <Mail />
            OA 答复
          </button>
          <button
            type="button"
            className={ITEM}
            disabled={!pid}
            onClick={go(() => {
              toggleMobileSettings(false)
              setMobileTab('edit')
              window.setTimeout(() => useStudio.getState().editorHandle?.openSearch(), 50)
            })}
            data-testid="more-search"
          >
            <Search />
            查找 / 替换
          </button>
        </Group>

        <Group title="案卷">
          <button type="button" className={ITEM} disabled={!pid} onClick={go(() => pid && goDeliver(pid))} data-testid="open-deliver-page">
            <PackageCheck />
            递交页<span className={HINT}>体检 · XML · 递交包</span>
          </button>
          <button type="button" className={ITEM} disabled={!pid || lintRunning} onClick={runCheck} data-testid="run-lint">
            <ShieldCheck className={cn(lintRunning && 'animate-pulse motion-reduce:animate-none')} />
            运行当前案检查
          </button>
          <a className={cn(ITEM, !hasOk && 'pointer-events-none text-fg-disabled')} href={href('docx')} download aria-disabled={!hasOk} onClick={close} data-testid="export-docx">
            <Download />
            下载 DOCX
          </a>
          <a className={cn(ITEM, !hasOk && 'pointer-events-none text-fg-disabled')} href={href('pdf')} download aria-disabled={!hasOk} onClick={close} data-testid="export-pdf">
            <FileText />
            下载 PDF
          </a>
          <a
            className={cn(ITEM, !hasOk && 'pointer-events-none text-fg-disabled')}
            href={pdfUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!hasOk}
            onClick={close}
            data-testid="more-open-pdf"
          >
            <ExternalLink />
            预览在新标签页打开
          </a>
          <button type="button" className={ITEM} disabled={!pid} onClick={go(() => toggleMobileSettings(true))} data-testid="more-settings">
            <Settings2 />
            排版设置
          </button>
          {authed && pid && (
            <button type="button" className={ITEM} onClick={go(() => openCollabCenter('members'))} data-testid="more-share">
              <Users />
              协作者 · 分享
              {online !== null && (
                <span className={HINT} data-testid="more-share-online">
                  {online} 在线
                </span>
              )}
            </button>
          )}
          <button type="button" className={ITEM} onClick={go(() => requestNavigation({ type: 'create-project' }))} data-testid="more-create-project">
            <FolderPlus />
            {LABEL_NEW_PROJECT}…
          </button>
          <button
            type="button"
            className={ITEM}
            onClick={go(() =>
              requestNavigation({
                type: 'custom',
                label: '导入 Word 文档',
                run: () => openDialog('import-docx'),
              }),
            )}
            data-testid="more-import-docx"
          >
            <FileInput />
            导入 Word 文档…
          </button>
          <button type="button" className={ITEM} onClick={go(() => openDialog('convert'))} data-testid="more-convert">
            <Sparkles />
            论文 / 交底书转专利…
          </button>
          <button type="button" className={ITEM} onClick={go(() => openConsole('checks'))} data-testid="open-check">
            <Wrench />
            回归检查<span className={HINT}>开发者</span>
          </button>
        </Group>

        <Group title="帮助">
          <button type="button" className={ITEM} onClick={go(() => openDialog('palette'))} data-testid="more-palette">
            <Search />
            命令面板
          </button>
          <button type="button" className={ITEM} onClick={go(() => openDialog('syntax'))} data-testid="more-syntax">
            <BookOpen />
            语法帮助
          </button>
          <button type="button" className={ITEM} onClick={go(() => openDialog('about'))} data-testid="more-about">
            <Info />
            关于
          </button>
        </Group>

        <Group title="外观">
          <div className="flex min-h-touch items-center gap-3">
            <span className="w-8 shrink-0 text-base text-fg">主题</span>
            <Segmented size="md" options={THEME_OPTIONS} value={theme} onValueChange={setTheme} aria-label="主题" className="min-w-0 flex-1" data-testid="more-theme" />
          </div>
          <div className="flex min-h-touch items-center gap-3">
            <span className="w-8 shrink-0 text-base text-fg">密度</span>
            <Segmented size="md" options={DENSITY_OPTIONS} value={density} onValueChange={setDensity} aria-label="密度" className="min-w-0 flex-1" data-testid="more-density" />
          </div>
        </Group>

        {authed && (
          <Group title="账户">
            <a className={ITEM} href="#/account" onClick={close} data-testid="more-account">
              <UserCircle2 />
              账户与机构
            </a>
          </Group>
        )}
      </SheetContent>
    </Sheet>
  )
}
