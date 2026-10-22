import { MenuRow, MenuSeparator } from '@/components/ui/menu-bits'
import { hotkeyLabel } from '@/lib/hotkeys'
import { selectDevUser, useStudio } from '@/store'
import { Switch } from '@/components/ui/switch'

/**
 * 构建菜单项（顶栏「构建 ▾」SplitButton 与 菜单栏 构建 共用）：
 *   立即构建 · 自动构建（开关）· 停止 ─ 清除构建缓存 ─ 运行回归检查（打开伴随栏控制台 → 回归检查）
 */
export function BuildMenuItems() {
  const pid = useStudio((s) => s.pid)
  const phase = useStudio((s) => s.phase)
  const autoBuild = useStudio((s) => s.autoBuild)
  const setAutoBuild = useStudio((s) => s.setAutoBuild)
  const enqueue = useStudio((s) => s.enqueue)
  const resetBuild = useStudio((s) => s.resetBuild)
  const cancelBuild = useStudio((s) => s.cancelBuild)
  const debounceMs = useStudio((s) => s.debounceMs)
  const openCompanion = useStudio((s) => s.openCompanion)
  const setConsoleTab = useStudio((s) => s.setConsoleTab)
  const lintRunning = useStudio((s) => s.lintRunning)
  const devUser = useStudio(selectDevUser)
  const busy = phase === 'building' || phase === 'queued'
  return (
    <>
      <MenuRow noIcon disabled={!pid} onSelect={() => enqueue('manual', true)} sub={hotkeyLabel('build')} data-testid="build-now">
        立即构建
      </MenuRow>
      <MenuRow
        noIcon
        role="menuitemcheckbox"
        aria-checked={autoBuild}
        onSelect={(e) => {
          e.preventDefault()
          setAutoBuild(!autoBuild)
        }}
        sub={autoBuild ? `编辑后 ${(debounceMs / 1000).toFixed(1)} s` : '手动'}
        mark={<Switch checked={autoBuild} tabIndex={-1} aria-hidden className="pointer-events-none h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3" />}
        data-testid="build-auto"
      >
        自动构建
      </MenuRow>
      <MenuRow
        noIcon
        disabled={!busy}
        onSelect={() => {
          cancelBuild()
          useStudio.getState().toast('已停止当前构建（保留上次预览）', 'info')
        }}
        data-testid="build-stop"
      >
        停止
      </MenuRow>
      <MenuSeparator />
      {devUser && (
        <MenuRow
          noIcon
          disabled={!pid}
          onSelect={() => {
            resetBuild()
            enqueue('manual', true)
          }}
          sub="重建"
          data-testid="build-clear"
        >
          清除构建缓存
        </MenuRow>
      )}
      <MenuRow
        noIcon
        disabled={!pid || lintRunning}
        onSelect={() => {
          setConsoleTab('checks')
          openCompanion('console')
          void useStudio.getState().runLint()
        }}
        sub={lintRunning ? '运行中…' : undefined}
        data-testid="build-lint"
      >
        运行回归检查
      </MenuRow>
    </>
  )
}
