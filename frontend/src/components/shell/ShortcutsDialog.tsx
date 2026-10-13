import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { hotkeyLabel, type HotkeyAction } from '@/lib/hotkeys'
import { useStudio } from '@/store'

interface Row {
  action: HotkeyAction
  label: string
}

const GENERAL: Row[] = [
  { action: 'palette', label: '命令面板（跳案卷 / 面板 / 页面 / 动作）' },
  { action: 'save', label: '保存正文（自动备份）' },
  { action: 'build', label: '立即构建' },
  { action: 'find', label: '查找' },
  { action: 'replace', label: '替换' },
  { action: 'viewSource', label: '当前卡片切到源码' },
  { action: 'viewLayout', label: '当前卡片切到版面' },
  { action: 'viewPdf', label: '当前卡片切到 PDF' },
  { action: 'cycleView', label: '当前卡片循环：源码 → 版面 → PDF' },
  { action: 'cycleLayout', label: '布局循环：双栏 → 仅编辑 → 仅预览' },
  { action: 'toggleOutline', label: '案卷与大纲侧栏' },
  { action: 'toggleBottom', label: '控制台（预览区切换）' },
  { action: 'toggleSettings', label: '排版设置' },
  { action: 'nextProblem', label: '下一个问题' },
  { action: 'prevProblem', label: '上一个问题' },
  { action: 'escape', label: '关闭菜单 / 对话框 / 设置' },
  { action: 'help', label: '本快捷键列表' },
]

/** R4 多面板（视图 › 布局；lib/layoutShortcuts 接线，dockview 就绪时生效）。
 * Mod-PageUp/Down 在 Chrome/Edge 被浏览器级切标签占用、不派发给页面——有效键位见下方「面板焦点导航」。 */
const LAYOUT: Row[] = [
  { action: 'nextPanel', label: '焦点移到下一个面板（Firefox / Safari）' },
  { action: 'prevPanel', label: '焦点移到上一个面板（Firefox / Safari）' },
  { action: 'maximizePanel', label: '最大化 / 还原当前面板' },
  { action: 'closePanel', label: '关闭当前面板' },
  { action: 'compareLock', label: '对照滚动锁' },
]

/** 编辑器内也可用的焦点逃逸键（Ctrl+PageUp/Down 是 Chrome 浏览器级切标签键、不派发给页面——用 F6 这组） */
const DOCKVIEW_NAV: Row[] = [
  { action: 'nextPanelGroup', label: '焦点移到下一个面板' },
  { action: 'prevPanelGroup', label: '焦点移到上一个面板' },
]

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(({ action, label }) => (
        <div key={action} className="contents">
          <dt>
            <kbd className="inline-block min-w-[4.5rem] rounded-sm border bg-sunken px-1.5 py-0.5 text-center font-mono text-xs text-fg">
              {hotkeyLabel(action)}
            </kbd>
          </dt>
          <dd className="self-center text-fg-muted">{label}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 快捷键速查（02 §6）；打开状态 = ui.dialog === 'shortcuts'，由 Rail「帮助」与「帮助 › 快捷键」菜单触发。 */
export function ShortcutsDialog() {
  const open = useStudio((s) => s.dialog === 'shortcuts')
  const closeDialog = useStudio((s) => s.closeDialog)
  const openDialog = useStudio((s) => s.openDialog)
  return (
    <Dialog open={open} onOpenChange={(v) => (v ? openDialog('shortcuts') : closeDialog())}>
      <DialogContent data-slot="ShortcutsDialog" data-testid="shortcuts-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>快捷键</DialogTitle>
          <DialogDescription>全局生效（编辑器内外一致）。macOS 上 Ctrl 读作 ⌘。</DialogDescription>
        </DialogHeader>
        <Rows rows={GENERAL} />
        <h3 className="mt-2 text-xs font-medium text-fg-muted" id="shortcuts-layout-heading">
          多面板布局（视图 › 布局，dockview 就绪时生效）
        </h3>
        <div role="group" aria-labelledby="shortcuts-layout-heading" data-testid="shortcuts-layout">
          <Rows rows={LAYOUT} />
        </div>
        <h3 className="mt-2 text-xs font-medium text-fg-muted" id="shortcuts-dock-heading">
          面板焦点导航（编辑器内也可逃离，dockview 就绪时生效）
        </h3>
        <div role="group" aria-labelledby="shortcuts-dock-heading" data-testid="shortcuts-dockview-nav">
          <Rows rows={DOCKVIEW_NAV} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
