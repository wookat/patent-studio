import { useEffect, useMemo, useRef, useSyncExternalStore, type FunctionComponent } from 'react'
import { Maximize2, Minimize2, PictureInPicture2, Dock } from 'lucide-react'
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from 'dockview-react'

import { useIsDark } from '@/hooks/useMisc'
import { useCollabMirror } from '@/collab'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { NamedLandmarkHost } from '@/components/ui/landmark-host'
import { parsePanelId, useStudio, type LayoutPresetId, type PanelId } from '@/store'
import { setHeaderSlot } from './headerSlot'
import { describePanel, groupMinWidth, panelComponents, type PanelParams } from './registry'
import { registerBuiltinPanels } from './panels'
import { LAYOUT_PRESETS } from './presets'
import { studioTheme } from './theme'
import {
  FLOATING_DEFAULTS,
  applyLegacyLayout,
  createDockHandle,
  flushSave,
  loadInto,
  scheduleSave,
  type HostRuntime,
} from './dockHandle'
import 'dockview-react/dist/styles/dockview.css'
import './dockview.css'

/**
 * dockview 宿主（docs/plan/08-r4-dockview-design.md §2 / §5 / §7；D1 所有）。
 * 唯一 import dockview-react 运行时的文件：DockArea 用 lazy() 挂它，移动壳与主包不含 dockview-core。
 * dockview 基础样式（dist/styles/dockview.css）与 token 映射（./dockview.css）都在这里 import，随 lazy chunk 一起下载。
 *
 * 职责：
 *   - onReady：loadLayout(pid) ?? 默认预置 → fromJSON（损坏 / 含未注册面板 → 回默认）；注册 DockHandle；
 *   - onDidLayoutChange 300ms 防抖 saveLayout；切案卷时先落盘旧案再装入新案；
 *   - onDidActivePanelChange({ panel }) → store.setActivePanel；
 *   - 旧 ui.layout 三态：editor / preview = 最大化源码 / PDF 组，split = 还原（08 §1「旧布局」）；
 *   - ui.settingsOpen ↔ `settings` 面板：打开 = 在源码组里加一张「排版设置」tab（旧双栏里它替换编辑器区），关闭 / 关 tab 双向同步，经 openPanel('settings')（视图▾ 打开为新面板）加入的面板同样回写 settingsOpen；
 *   - tab = 注册表图标 + 标题；组标题栏右侧：浮动 / 停靠、最大化 / 还原；空态 = 预置按钮；
 *   - R8：useCollabMirror 接 (pid, 'content') 房间做全文双向镜像（没开卡片的书也能收到 / 推出改动），单书卡片各接自己的房间。
 */

registerBuiltinPanels()

const MESSAGES = {
  panelOpened: (t: string) => `已打开 ${t}`,
  panelClosed: (t: string) => `已关闭 ${t}`,
  groupMaximized: (t: string) => `${t} 已最大化`,
  groupRestored: (t: string) => `${t} 已还原`,
  groupFloated: (t: string) => `${t} 已浮动`,
  groupDocked: (t: string) => `${t} 已停靠`,
  closeTab: (t: string) => `关闭 ${t}`,
  closeTabPlain: () => '关闭',
  groupPoppedOut: (t: string) => `${t} 已弹出到新窗口`,
}

function useTitle(api: IDockviewPanelHeaderProps['api']) {
  return useSyncExternalStore(
    (cb) => {
      const d = api.onDidTitleChange(cb)
      return () => d.dispose()
    },
    () => api.title ?? api.id,
  )
}

/**
 * tab = 注册表图标 + 标题 + 关闭（沿用 dv-default-tab 的布局类，只加图标）。
 * 外层 .dv-tab 本身已是 role=tab 的可聚焦控件，关闭叉只做鼠标热区（不进可访问树，免 nested-interactive）；
 * 键盘 / 读屏走 HOTKEYS.closePanel 与菜单。
 */
function StudioTab({ api }: IDockviewPanelHeaderProps<PanelParams>) {
  const title = useTitle(api)
  const Icon = describePanel(api.id)?.def.icon
  return (
    <div className="dv-default-tab studio-tab" data-testid={`tab-${api.id}`}>
      {Icon && <Icon className="studio-tab-icon" aria-hidden="true" />}
      <span className="dv-default-tab-content">{title}</span>
      <span
        className="dv-default-tab-action"
        aria-hidden="true"
        title={`关闭 ${title}`}
        data-testid="close-tab"
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault()
          api.close()
        }}
      >
        <svg width="11" height="11" viewBox="0 0 28 28">
          <path
            fill="currentColor"
            d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z"
          />
        </svg>
      </span>
    </div>
  )
}

function useFloating(api: IDockviewHeaderActionsProps['api']) {
  return useSyncExternalStore(
    (cb) => {
      const d = api.onDidLocationChange(cb)
      return () => d.dispose()
    },
    () => api.location.type === 'floating',
  )
}

function useMaximized({ api, containerApi }: IDockviewHeaderActionsProps) {
  return useSyncExternalStore(
    (cb) => {
      const d = containerApi.onDidMaximizedGroupChange(cb)
      return () => d.dispose()
    },
    () => api.isMaximized(),
  )
}

/** 活动面板的面板头插槽（headerSlot.ts）：卡片把视图 Tabs / 工具 portal 进来，与文件 Tab 同一行 32 */
function HeaderSlot({ panelId }: { panelId: PanelId }) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    setHeaderSlot(panelId, ref.current)
    return () => setHeaderSlot(panelId, null)
  }, [panelId])
  return <div ref={ref} className="studio-header-slot" data-testid={`header-slot-${panelId}`} />
}

/** 组标题栏右侧：活动面板头插槽 + 浮动 ↔ 停靠、最大化 ↔ 还原（dockview 8.x 的右键菜单属企业模块，用按钮替代） */
function GroupActions(props: IDockviewHeaderActionsProps) {
  const { api, containerApi, activePanel, group } = props
  const floating = useFloating(api)
  const maximized = useMaximized(props)
  const name = activePanel?.title ?? '面板'
  return (
    <div className="studio-group-actions" data-testid="group-actions">
      {activePanel && <HeaderSlot key={activePanel.id} panelId={activePanel.id as PanelId} />}
      {floating ? (
        <button
          type="button"
          className="dv-default-tab-action"
          aria-label={`停靠 ${name}`}
          title="停靠"
          onClick={() => api.moveTo({ position: 'right' })}
        >
          <Dock aria-hidden="true" />
        </button>
      ) : (
        <>
          <button
            type="button"
            className="dv-default-tab-action"
            aria-label={`浮动 ${name}`}
            title="浮动"
            onClick={() => containerApi.addFloatingGroup(group, FLOATING_DEFAULTS)}
          >
            <PictureInPicture2 aria-hidden="true" />
          </button>
          <button
            type="button"
            className="dv-default-tab-action"
            aria-label={maximized ? `还原 ${name}` : `最大化 ${name}`}
            title={maximized ? '还原' : '最大化'}
            onClick={() => (maximized ? api.exitMaximized() : api.maximize())}
          >
            {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
        </>
      )}
    </div>
  )
}

const SETTINGS_PANEL = 'settings'

/** 注册表 `minWidth` → 所在 group 的 setConstraints（W5 §4.3：ai 面板 min 280；预置默认 320） */
function applyMinWidths(api: HostRuntime['api']): void {
  for (const g of api.groups) {
    const w = groupMinWidth(g.panels.map((p) => p.id))
    if (w != null) g.api.setConstraints({ minimumWidth: w })
  }
}

/** settingsOpen → 设置面板存在：加到活动源码卡片所在组（退而任一源码组 / 活动组）；关 → 移除 */
function syncSettingsPanel(rt: HostRuntime, open: boolean): void {
  const { api } = rt
  const existing = api.getPanel(SETTINGS_PANEL)
  if (!open) {
    existing?.api.close()
    return
  }
  if (existing) {
    existing.api.setActive()
    return
  }
  const d = describePanel(SETTINGS_PANEL)
  if (!d) return
  const sources = api.panels.filter((p) => parsePanelId(p.id)?.kind === 'source')
  const group = (sources.find((p) => p.api.isActive) ?? sources[0])?.group ?? api.activeGroup
  const base = { id: SETTINGS_PANEL, component: d.kind, params: d.params, title: d.title }
  api.addPanel(group ? { ...base, position: { referenceGroup: group } } : base)
}

const EMPTY_PRESETS: LayoutPresetId[] = ['default', 'three-books', 'layout-pdf']

/** 空态（08 §6.1）：最后一张卡片关闭后，主区显示提示 + 预置按钮 */
function Watermark() {
  const applyPreset = useStudio((s) => s.applyPreset)
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 bg-panel text-sm text-fg-muted"
      data-testid="dock-empty"
    >
      <p>从「视图 › 布局」或 Rail 打开面板，或选择一个预置布局</p>
      <div className="flex flex-wrap justify-center gap-2">
        {EMPTY_PRESETS.map((id) => (
          <Button key={id} variant="outline" size="sm" onClick={() => applyPreset(id)} data-testid={`dock-empty-${id}`}>
            {LAYOUT_PRESETS[id].label}
          </Button>
        ))}
      </div>
    </div>
  )
}

export default function DockviewHost({ className }: { className?: string }) {
  const pid = useStudio((s) => s.pid)
  const dark = useIsDark()
  useCollabMirror()
  const rtRef = useRef<HostRuntime | null>(null)
  const components = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(panelComponents()).map(([kind, Panel]) => [
          kind,
          function HostedPanel(p: IDockviewPanelProps<PanelParams>) {
            return (
              <NamedLandmarkHost>
                <Panel {...p} />
              </NamedLandmarkHost>
            )
          },
        ]),
      ) as Record<string, FunctionComponent<IDockviewPanelProps<PanelParams>>>,
    [],
  )
  const theme = useMemo(() => studioTheme(dark), [dark])

  const onReady = (e: DockviewReadyEvent) => {
    const rt: HostRuntime = { api: e.api, muted: false, timer: null, loadedPid: null, dispose: () => {} }
    rtRef.current = rt
    loadInto(rt, useStudio.getState().pid)
    const handle = createDockHandle(rt)
    const store = useStudio.getState()
    const d1 = e.api.onDidLayoutChange(() => scheduleSave(rt))
    const d2 = e.api.onDidActivePanelChange(({ panel }) => useStudio.getState().setActivePanel(panel?.id ?? null))
    const d3 = e.api.onDidRemovePanel((panel) => {
      if (panel.id === SETTINGS_PANEL && useStudio.getState().settingsOpen) useStudio.getState().toggleSettings(false)
      useStudio.getState().bumpDockRevision()
    })
    const d4 = e.api.onDidAddPanel((panel) => {
      if (panel.id === SETTINGS_PANEL && !useStudio.getState().settingsOpen) useStudio.getState().toggleSettings(true)
      applyMinWidths(e.api)
      useStudio.getState().bumpDockRevision()
    })
    const d5 = e.api.onDidLayoutFromJSON(() => applyMinWidths(e.api))
    applyMinWidths(e.api)
    const unsub = useStudio.subscribe((s, prev) => {
      if (s.layoutPreset !== prev.layoutPreset || s.compareLock !== prev.compareLock) scheduleSave(rt)
      if (s.layout !== prev.layout) applyLegacyLayout(rt, handle, s.layout)
      if (s.settingsOpen !== prev.settingsOpen) syncSettingsPanel(rt, s.settingsOpen)
    })
    syncSettingsPanel(rt, store.settingsOpen)
    store.setActivePanel(e.api.activePanel?.id ?? null)
    store.registerDock(handle)
    rt.dispose = () => {
      d1.dispose()
      d2.dispose()
      d3.dispose()
      d4.dispose()
      d5.dispose()
      unsub()
    }
  }

  useEffect(() => {
    const rt = rtRef.current
    if (!rt || rt.loadedPid === pid) return
    flushSave(rt)
    loadInto(rt, pid)
    syncSettingsPanel(rt, useStudio.getState().settingsOpen)
  }, [pid])

  useEffect(
    () => () => {
      const rt = rtRef.current
      if (!rt) return
      flushSave(rt)
      rt.dispose()
      useStudio.getState().registerDock(null)
      rtRef.current = null
    },
    [],
  )

  // isolate：把 dockview 内部 z 阶（sash z-99）收进本容器——否则 99 压过全局 z-popover(50) 的抽屉/弹层（R47-01：抽屉里复选框被 sash 吃掉点击）
  return (
    <div className={cn('isolate h-full min-h-0 min-w-0', className)} data-testid="dock-host">
      <DockviewReact
        components={components}
        defaultTabComponent={StudioTab}
        rightHeaderActionsComponent={GroupActions}
        watermarkComponent={Watermark}
        noPanelsOverlay="watermark"
        theme={theme}
        messages={MESSAGES}
        onReady={onReady}
        className="h-full w-full"
      />
    </div>
  )
}
