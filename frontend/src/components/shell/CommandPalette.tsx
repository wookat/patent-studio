import { useEffect } from 'react'
import { Building2, Code, FilePlus2, FileText, FileType, Inbox, Keyboard, LayoutGrid, ScrollText, UserRound, Hammer, CalendarClock, FolderOpen, Send } from 'lucide-react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { COMPANION_META } from '@/components/shell/companionMeta'
import { useIsDesktop } from '@/hooks/useMisc'
import { goAccount, goAdmin, goAudit, goDashboard, goDeliver, goDeadlines, goInbox, goWorkbench } from '@/lib/hash'
import { hotkeyLabel } from '@/lib/hotkeys'
import { useStudio, type CompanionId } from '@/store'
import { THREE_VIEWS, VIEW_HOTKEY_LABEL, VIEW_LABEL, switchToView, type ThreeView } from '@/components/workbench'

const COMPANION_IDS: CompanionId[] = ['ai', 'review', 'history', 'console', 'problems', 'terms', 'figures', 'search', 'deadlines', 'notify', 'proposals', 'materials', 'runs']

/** 视图项图标与 ViewSwitch 同源（源码/版面/PDF） */
const VIEW_ICON: Record<ThreeView, typeof Code> = { source: Code, layout: FileText, pdf: FileType }

/**
 * ⌘K 全局命令面板：cmdk 模糊搜索——案卷跳转（案号/客户关键词）、当前案面板/构建/递交、页面导航、新建案卷/快捷键速查。
 * 打开态 = ui.dialog === 'palette'；入口：Mod-k 热键 / 视图菜单 / 移动端 MoreSheet「帮助」。
 * 桌面限定项按 isDesktop 门控：dockview 面板项（移动端走导航抽屉/MoreSheet）、快捷键速查与 kbd 提示（触屏无键盘）。
 * 对话框已有打开时不抢占（草稿守卫）。
 */
export function CommandPalette() {
  const open = useStudio((s) => s.dialog === 'palette')
  const projects = useStudio((s) => s.projects)
  const pid = useStudio((s) => s.pid)
  const superuser = useStudio((s) => s.user?.is_superuser)
  const authOff = useStudio((s) => s.authStatus === 'off')
  const adminVisible = superuser || authOff // AdminPage 允许 AUTH=off 直渲——⌘K 可达性与之一致
  const closeDialog = useStudio((s) => s.closeDialog)
  const isDesktop = useIsDesktop()

  useEffect(() => {
    if (open && projects.length === 0) void useStudio.getState().loadProjects()
  }, [open, projects.length])

  const run = (fn: () => void) => () => {
    closeDialog()
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={(v) => (v ? undefined : closeDialog())} title="命令面板" data-testid="command-palette">
      <CommandInput placeholder="搜索案卷、面板、页面或动作…" aria-label="命令面板搜索" />
      <CommandList>
        <CommandEmpty>没有匹配项</CommandEmpty>
        <CommandGroup heading="案卷">
          {projects.map((p) => (
            <CommandItem
              key={p.id}
              value={`case:${p.id}`}
              keywords={[p.title, p.case?.case_no ?? '', p.case?.client ?? '', p.id]}
              onSelect={run(() => goWorkbench(p.id))}
              data-testid={`palette-case-${p.id}`}
            >
              <FolderOpen aria-hidden />
              <span className="truncate">{p.title || p.id}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {[p.case?.case_no, p.case?.client].filter(Boolean).join(' · ')}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        {pid && (
          <CommandGroup heading="当前案卷">
            {isDesktop && COMPANION_IDS.map((id) => (
              <CommandItem key={id} value={`panel:${id}`} keywords={[COMPANION_META[id].title, '面板']} onSelect={run(() => useStudio.getState().openCompanion(id))} data-testid={`palette-panel-${id}`}>
                {COMPANION_META[id].icon}
                <span>打开面板 · {COMPANION_META[id].title}</span>
              </CommandItem>
            ))}
            {THREE_VIEWS.map((v) => {
              const Icon = VIEW_ICON[v]
              return (
                <CommandItem key={v} value={`view:${v}`} keywords={[VIEW_LABEL[v], '视图', 'view', '切换', 'switch']} onSelect={run(() => switchToView(v))} data-testid={`palette-view-${v}`}>
                  <Icon aria-hidden />
                  <span>切换到{VIEW_LABEL[v]}视图</span>
                  {isDesktop && <CommandShortcut>{VIEW_HOTKEY_LABEL[v]}</CommandShortcut>}
                </CommandItem>
              )
            })}
            <CommandItem value="act:build" keywords={['构建', '重新构建', 'build']} onSelect={run(() => useStudio.getState().enqueue('manual', true))} data-testid="palette-build">
              <Hammer aria-hidden />
              <span>重新构建</span>
              {isDesktop && <CommandShortcut>{hotkeyLabel('build')}</CommandShortcut>}
            </CommandItem>
            <CommandItem value="act:deliver" keywords={['递交', 'deliver']} onSelect={run(() => goDeliver(pid))} data-testid="palette-deliver">
              <Send aria-hidden />
              <span>递交页</span>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="页面">
          <CommandItem value="page:dashboard" keywords={['台账', '案卷列表', '工作台', '首页']} onSelect={run(() => goDashboard())} data-testid="palette-dashboard">
            <LayoutGrid aria-hidden />
            <span>台账</span>
          </CommandItem>
          <CommandItem value="page:deadlines" keywords={['期限', 'deadline']} onSelect={run(() => goDeadlines())} data-testid="palette-deadlines">
            <CalendarClock aria-hidden />
            <span>期限中心</span>
          </CommandItem>
          <CommandItem value="page:inbox" keywords={['通知', '未读', 'inbox']} onSelect={run(() => goInbox())} data-testid="palette-inbox">
            <Inbox aria-hidden />
            <span>通知</span>
          </CommandItem>
          <CommandItem
            value="page:account"
            keywords={['个人资料', '账号', 'account']}
            onSelect={run(() => goAccount())}
            data-testid="palette-account"
          >
            <UserRound aria-hidden />
            <span>个人资料</span>
          </CommandItem>
          {adminVisible && (
            <CommandItem
              value="page:admin"
              keywords={['机构', '管理', 'admin']}
              onSelect={run(() => goAdmin())}
              data-testid="palette-admin"
            >
              <Building2 aria-hidden />
              <span>机构管理</span>
            </CommandItem>
          )}
          {adminVisible && (
            <CommandItem
              value="page:audit"
              keywords={['审计日志', 'audit', '留痕', '操作记录']}
              onSelect={run(() => goAudit())}
              data-testid="palette-audit"
            >
              <ScrollText aria-hidden />
              <span>审计日志</span>
            </CommandItem>
          )}
        </CommandGroup>
        <CommandGroup heading="动作">
          <CommandItem value="act:create" keywords={['新建案卷', 'create']} onSelect={run(() => useStudio.getState().openDialog('create'))} data-testid="palette-create">
            <FilePlus2 aria-hidden />
            <span>新建案卷</span>
          </CommandItem>
          {isDesktop && (
            <CommandItem value="act:shortcuts" keywords={['快捷键', 'help', '帮助']} onSelect={run(() => useStudio.getState().openDialog('shortcuts'))} data-testid="palette-shortcuts">
              <Keyboard aria-hidden />
              <span>快捷键速查</span>
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
