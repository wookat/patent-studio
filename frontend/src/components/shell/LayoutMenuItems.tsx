import { MenuCheckRow, MenuRow, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger } from '@/components/ui/menu-bits'
import { listPresets } from '@/layout/presets'
import { bookViewLabel, listPanels } from '@/layout/registry'
import { hotkeyLabel } from '@/lib/hotkeys'
import { BOOK_VIEWS, makePanelId, useStudio, type PanelId } from '@/store'

/**
 * 「视图 › 布局」子菜单（docs/plan/08-r4-dockview-design.md §6.3；D3 所有）。
 * 预置布局（menuitemradio）· 对照滚动锁（menuitemcheckbox）· 打开为新面板（listPanels()：带书的 kind 再按书分一层，
）· 下一个/上一个/最大化/关闭面板（快捷键标签取 lib/hotkeys）· 重置布局。
 * dockHandle === null（移动壳 / dockview 未就绪）时整个子菜单 disabled；新面板放在当前活动面板右侧分屏，没有活动面板时加入默认组。
 */
export function LayoutMenuItems() {
  const ready = useStudio((s) => s.dockHandle !== null)
  const preset = useStudio((s) => s.layoutPreset)
  const compareLock = useStudio((s) => s.compareLock)
  const activePanelId = useStudio((s) => s.activePanelId)
  const applyPreset = useStudio((s) => s.applyPreset)
  const openCasework = useStudio((s) => s.openCasework)
  const resetLayout = useStudio((s) => s.resetLayout)
  const setCompareLock = useStudio((s) => s.setCompareLock)
  const openPanel = useStudio((s) => s.openPanel)
  const closePanel = useStudio((s) => s.closePanel)
  const focusNextPanel = useStudio((s) => s.focusNextPanel)
  const toggleMaximize = useStudio((s) => s.toggleMaximize)

  const openBeside = (id: PanelId) => openPanel(id, activePanelId ? { position: { referencePanel: activePanelId, direction: 'right' } } : undefined)

  return (
    <MenuSub>
      <MenuSubTrigger noIcon disabled={!ready} data-testid="view-layout-presets">
        布局
      </MenuSubTrigger>
      <MenuSubContent className="min-w-[280px]" aria-label="布局">
        {listPresets().map((p) => (
          /* C1/P04：casework 除 dock 预设外还展开左栏与 Agent 伴随栏（三栏一键到位） */
          <MenuCheckRow key={p.id} noIcon checked={preset === p.id} onSelect={() => (p.id === 'casework' ? openCasework() : applyPreset(p.id))} sub={p.compareLock ? '对照锁' : undefined} data-testid={`view-preset-${p.id}`}>
            {p.label}
          </MenuCheckRow>
        ))}
        <MenuSeparator />
        <MenuCheckRow noIcon kind="checkbox" checked={compareLock} onSelect={() => setCompareLock()} sub={hotkeyLabel('compareLock')} data-testid="view-compare-lock">
          对照滚动锁
        </MenuCheckRow>
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger noIcon data-testid="view-open-panel">
            打开为新面板
          </MenuSubTrigger>
          <MenuSubContent className="min-w-[200px]" aria-label="打开为新面板">
            {listPanels().map(([kind, def]) =>
              def.perBook ? (
                <MenuSub key={kind}>
                  <MenuSubTrigger noIcon data-testid={`view-open-${kind}`}>
                    {def.label}
                  </MenuSubTrigger>
                  <MenuSubContent className="min-w-[160px]" aria-label={def.label}>
                    {BOOK_VIEWS.map((b) => (
                      <MenuRow key={b} noIcon onSelect={() => openBeside(makePanelId(kind, b))} data-testid={`view-open-${kind}-${b}`}>
                        {bookViewLabel(b)}
                      </MenuRow>
                    ))}
                  </MenuSubContent>
                </MenuSub>
              ) : (
                <MenuRow key={kind} noIcon onSelect={() => openBeside(makePanelId(kind))} data-testid={`view-open-${kind}`}>
                  {def.label}
                </MenuRow>
              ),
            )}
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator />
        <MenuRow noIcon onSelect={() => focusNextPanel(1)} sub={hotkeyLabel('nextPanel')} data-testid="view-panel-next">
          下一个面板
        </MenuRow>
        <MenuRow noIcon onSelect={() => focusNextPanel(-1)} sub={hotkeyLabel('prevPanel')} data-testid="view-panel-prev">
          上一个面板
        </MenuRow>
        <MenuRow noIcon disabled={!activePanelId} onSelect={() => toggleMaximize()} sub={hotkeyLabel('maximizePanel')} data-testid="view-panel-maximize">
          最大化 / 还原面板
        </MenuRow>
        <MenuRow noIcon disabled={!activePanelId} onSelect={() => activePanelId && closePanel(activePanelId)} sub={hotkeyLabel('closePanel')} data-testid="view-panel-close">
          关闭面板
        </MenuRow>
        <MenuSeparator />
        <MenuRow noIcon onSelect={() => resetLayout()} data-testid="view-layout-reset">
          重置布局
        </MenuRow>
      </MenuSubContent>
    </MenuSub>
  )
}
