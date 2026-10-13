import { useEffect } from 'react'
import { TopBar } from './TopBar'
import { Rail } from './Rail'
import { StatusBar } from './StatusBar'
import { SplitPane } from './SplitPane'
import { DirtyGuardDialog } from './DirtyGuardDialog'
import { Toasts } from './Toasts'
import { CreateProjectDialog } from './CreateProjectDialog'
import { SideSplit } from '@/components/outline/SideSplit'
import { Editor } from '@/components/editor/Editor'
import { PreviewPane } from '@/components/preview/PreviewPane'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { CollabDrawer } from '@/components/collab-center'
import { DockArea } from '@/layout/DockArea'
import { ConvertDialog } from '@/components/convert/ConvertDialog'
import { ImportDocxDialog } from '@/components/importer'
import { StructureDialogs } from '@/components/block-model/dialogs'
import { CompanionHost } from './CompanionHost'
import { SkipLink } from '@/components/ui/skip-link'
import { useStudio } from '@/store'
import { cn } from '@/lib/utils'
// 槽位注册随工作台 lazy 分包下沉（原在 App 层）：TopBarItem/Rail/伴随栏/编辑器扩展只被工作台消费（幂等）
import '@/components/notify/slots'
import '@/components/timeline/slots'
import '@/components/ai/slots'

/**
 * 桌面壳（05 S3 · C Pro Dense）：
 *   grid-template-columns: 40px(rail) [side 240|0] minmax(0,1fr) [companion auto|0]
 *   grid-template-rows:    40px(topbar) minmax(0,1fr) 24px(statusbar)
 * 第 4 列 = W6 伴随栏（CompanionHost → CompanionPanel，dockview 外侧，默认关；宽度由 store.companionWidth 320–480 决定）。
 * 业务面板正文由单元在 CompanionHost.tsx 接入；本文件 prep 独占，单元不改。
 * 历史（07 §2）：
 * 主区 SplitPane 左 = settingsOpen ? SettingsPanel : Editor；右 = PreviewPane（常驻：pdfView==='logs' 时其正文自行换为 ConsolePanel，
 * PdfToolbar 保留并显示「返回预览」）。设置替换编辑器区、控制台替换 PDF 区，没有底部面板行与右侧抽屉列。
 * ≤1279 打开设置自动折叠侧栏 / 关闭恢复：逻辑在 store（toggleSettings / syncSideAutoCollapse），这里只挂 resize。
 * R4：主区经 `<DockArea fallback=…/>`（docs/plan/08 §2），现有 SplitPane 三态作为 fallback；dockview 容器由 D1 在 layout/DockArea.tsx 内落地。
 */
export function DesktopShell() {
  const pid = useStudio((s) => s.pid)
  const title = useStudio((s) => s.project?.title)
  const outlineOpen = useStudio((s) => s.outlineOpen)
  const settingsOpen = useStudio((s) => s.settingsOpen)
  const layout = useStudio((s) => s.layout)
  const companion = useStudio((s) => s.companion)
  const syncSideAutoCollapse = useStudio((s) => s.syncSideAutoCollapse)

  useEffect(() => {
    syncSideAutoCollapse()
    window.addEventListener('resize', syncSideAutoCollapse)
    return () => window.removeEventListener('resize', syncSideAutoCollapse)
  }, [syncSideAutoCollapse])

  // 设置打开时编辑器只隐藏不卸载（保留 CodeMirror 光标 / 滚动 / 撤销栈）
  const left = (
    <div className="relative h-full min-h-0 min-w-0">
      <div className={cn('flex h-full min-h-0 flex-col bg-panel', settingsOpen && 'hidden')} data-testid="editor-pane" aria-hidden={settingsOpen}>
        {pid && <Editor className="min-h-0 flex-1 overflow-hidden" />}
      </div>
      {settingsOpen && <SettingsPanel />}
    </div>
  )
  const right = <PreviewPane />

  return (
    <>
      <SkipLink />
      <div
        data-slot="DesktopShell"
        data-testid="desktop-shell"
        data-companion={companion ?? undefined}
        className="grid h-full min-h-0 overflow-hidden bg-app text-fg"
        style={{
          gridTemplateColumns: `var(--w-rail) ${outlineOpen ? 'var(--w-side)' : '0px'} minmax(0,1fr) ${companion ? 'auto' : '0px'}`,
          gridTemplateRows: 'var(--h-topbar) minmax(0,1fr) var(--h-statusbar)',
        }}
      >
        <div className="col-span-4 row-start-1 min-w-0"><TopBar /></div>

        <div className="col-start-1 row-start-2 min-h-0"><Rail /></div>

        <aside className={cn('col-start-2 row-start-2 min-h-0 min-w-0 overflow-hidden', !outlineOpen && 'invisible')} aria-hidden={!outlineOpen} aria-label="案卷与大纲侧栏">
          <SideSplit />
        </aside>

        <main id="main-content" tabIndex={-1} className="col-start-3 row-start-2 min-h-0 min-w-0 outline-none" data-testid="main-area">
          <h1 className="sr-only">{title ? `${title} · Patent Studio` : 'Patent Studio'}</h1>
          <DockArea
            fallback={
              <>
                {layout === 'split' && <SplitPane left={left} right={right} />}
                {layout === 'editor' && left}
                {layout === 'preview' && right}
              </>
            }
          />
        </main>

        <div className={cn('col-start-4 row-start-2 min-h-0 min-w-0 overflow-hidden', !companion && 'invisible')} aria-hidden={!companion} data-testid="companion-column">
          <CompanionHost presentation="column" />
        </div>

        <div className="col-span-4 row-start-3 flex min-w-0 flex-col justify-center [&>*]:flex-1"><StatusBar /></div>
      </div>

      <DirtyGuardDialog />
      <CreateProjectDialog />
      <CollabDrawer />
      <ConvertDialog />
      <ImportDocxDialog />
      <StructureDialogs />
      <Toasts />
    </>
  )
}
