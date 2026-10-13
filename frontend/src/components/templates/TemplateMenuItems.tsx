import { useEffect } from 'react'
import { MenuLabel, MenuRow, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger } from '@/components/ui/menu-bits'
import { useStudio } from '@/store'

/**
 * 「文件 › 模板 ▸」子菜单：已保存模板列表（选中 → 应用到当前案卷，走 dirty 守卫）+「另存为模板…」（打开设置面板 › 模板页）。
 * 501 / 无模板时只剩「另存为模板…」。
 */
export function TemplateMenuItems() {
  const pid = useStudio((s) => s.pid)
  const templates = useStudio((s) => s.templates)
  const unavailable = useStudio((s) => s.templatesUnavailable)
  const loadTemplates = useStudio((s) => s.loadTemplates)
  const applyTemplate = useStudio((s) => s.applyTemplate)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const toggleSettings = useStudio((s) => s.toggleSettings)
  const settingsOpen = useStudio((s) => s.settingsOpen)
  useEffect(() => { if (!unavailable) void loadTemplates() }, [loadTemplates, unavailable])
  const saveRow = (
    <MenuRow noIcon disabled={!pid || unavailable} data-slot="TemplateMenuItems" data-testid="menu-save-template" onSelect={() => { if (!settingsOpen) toggleSettings() }}>
      另存为模板…
    </MenuRow>
  )
  if (unavailable || templates.length === 0) return saveRow
  return (
    <MenuSub>
      <MenuSubTrigger noIcon data-testid="menu-templates">模板</MenuSubTrigger>
      <MenuSubContent>
        <MenuLabel>应用到当前案卷</MenuLabel>
        {templates.map((t) => (
          <MenuRow
            key={t.name}
            noIcon
            disabled={!pid}
            onSelect={() => { if (pid) requestNavigation({ type: 'custom', label: `应用模板「${t.name}」`, run: async () => { await applyTemplate(pid, t.name) } }) }}
            sub={t.description || undefined}
            data-testid={`menu-apply-template-${t.name}`}
          >
            {t.name}
          </MenuRow>
        ))}
        <MenuSeparator />
        {saveRow}
      </MenuSubContent>
    </MenuSub>
  )
}
