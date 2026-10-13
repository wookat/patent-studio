import { useEffect, useState } from 'react'
import { Bot, ListChecks, Plug, Type } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Segmented, type SegmentedOption } from '@/components/ui/segmented'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { selectCanEditStyle, useStudio } from '@/store'
import { disabledPreflight, PREFLIGHT_WARNING_CODES, togglePreflightCode } from '@/store/checks'
import { SettingsContent } from './SettingsContent'

export type CaseSettingsTab = 'typography' | 'checks' | 'ai' | 'integrations'

const TABS: readonly SegmentedOption<CaseSettingsTab>[] = [
  { value: 'typography', label: '排版', icon: <Type aria-hidden />, 'data-testid': 'case-settings-tab-typography' },
  { value: 'checks', label: '体检', icon: <ListChecks aria-hidden />, 'data-testid': 'case-settings-tab-checks' },
  { value: 'ai', label: 'AI', icon: <Bot aria-hidden />, 'data-testid': 'case-settings-tab-ai' },
  { value: 'integrations', label: '集成', icon: <Plug aria-hidden />, 'data-testid': 'case-settings-tab-integrations' },
]

export interface CaseSettingsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  initialTab?: CaseSettingsTab
}

/** 一行「标签 + 说明 + Switch」；disabled 时整行降对比但说明保持可读 */
function ToggleRow({ id, label, hint, checked, disabled, onChange, testId }: { id: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void; testId?: string }) {
  return (
    <li className={cn('flex items-center gap-3 py-2.5', disabled && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-xs text-fg-muted">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} data-testid={testId} />
    </li>
  )
}

/** 体检开关页：列出可关闭的 warning code，写 settings.preflight.disabled[] */
export function PreflightTogglesPanel() {
  const settings = useStudio((s) => s.settings)
  const saveSettings = useStudio((s) => s.saveSettings)
  const canEdit = useStudio(selectCanEditStyle)
  const disabled = disabledPreflight(settings)
  if (!settings) return <p className="text-sm text-fg-muted">正在加载案子…</p>
  return (
    <div className="grid gap-2" data-testid="case-settings-checks">
      <p className="text-xs text-fg-muted">关闭的规则不再出现在体检表与控制台；错误级规则（结构 / 循环引用 / 多引多 / 图缺失）不可关闭。</p>
      <ul className="divide-y">
        {PREFLIGHT_WARNING_CODES.map((r) => (
          <ToggleRow
            key={r.code}
            id={`preflight-${r.code}`}
            label={r.label}
            hint={`${r.code} · ${r.hint}`}
            checked={!disabled.includes(r.code)}
            disabled={!canEdit}
            onChange={(on) => saveSettings(togglePreflightCode(settings, r.code, on))}
            testId={`preflight-toggle-${r.code}`}
          />
        ))}
      </ul>
    </div>
  )
}

/** AI 页：案级外发开关；机构禁用（orgSettings.ai_enabled === false）时 disabled + 说明 */
export function CaseAiPanel() {
  const settings = useStudio((s) => s.settings)
  const saveSettings = useStudio((s) => s.saveSettings)
  const orgAi = useStudio((s) => s.orgSettings?.ai_enabled ?? null)
  const canEdit = useStudio(selectCanEditStyle)
  const orgDisabled = orgAi === false
  if (!settings) return <p className="text-sm text-fg-muted">正在加载案子…</p>
  return (
    <div className="grid gap-3" data-testid="case-settings-ai">
      {orgDisabled && (
        <Alert variant="warn" data-testid="case-ai-org-disabled">
          <Bot />
          <AlertTitle>机构已关闭 AI</AlertTitle>
          <AlertDescription>管理员在「机构管理 › AI」关闭了全机构 AI 功能，本案无法单独开启；请联系管理员。</AlertDescription>
        </Alert>
      )}
      <ul className="divide-y">
        <ToggleRow
          id="case-ai-enabled"
          label="允许把本案内容发送给 AI"
          hint="开启后 AI 助手可读取三书正文生成建议（CriticMarkup / 批注，不直接改写源码）；模型路由 swe-2-max → swe-2-medium → swe-2-high。"
          checked={!orgDisabled && (settings.ai_enabled ?? false)}
          disabled={orgDisabled || !canEdit}
          onChange={(v) => saveSettings({ ...settings, ai_enabled: v })}
          testId="case-ai-toggle"
        />
      </ul>
    </div>
  )
}

/**
 * 案级设置（21 §4.6）：Dialog size=md（560）；<640 自动全屏 Sheet。四页 Segmented：排版（现有 SettingsContent）/ 体检开关 / AI / 集成（现有）。
 * 排版与集成复用 SettingsContent（mobile 变体 + 顶部分组下拉，tools 关），所有排版值仍走 saveSettings 即时重建。
 */
export function CaseSettingsDialog({ open, onOpenChange, initialTab = 'typography' }: CaseSettingsDialogProps) {
  const [tab, setTab] = useState<CaseSettingsTab>(initialTab)
  const title = useStudio((s) => s.project?.title ?? s.pid ?? '')
  const isSuperuser = useStudio((s) => s.user?.is_superuser ?? false)
  const orgSettings = useStudio((s) => s.orgSettings)
  const loadOrgSettings = useStudio((s) => s.loadOrgSettings)
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])
  useEffect(() => {
    if (open && isSuperuser && !orgSettings) void loadOrgSettings()
  }, [open, isSuperuser, orgSettings, loadOrgSettings])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="max-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-h-[85vh]" data-testid="case-settings-dialog">
        <DialogHeader>
          <DialogTitle>案级设置</DialogTitle>
          <DialogDescription className="truncate">{title} · 改动即时生效并触发重新构建</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-md-control overflow-x-auto px-1">
          <Segmented options={TABS} value={tab} onValueChange={setTab} aria-label="设置分类" className="w-full max-sm:w-max" data-testid="case-settings-tabs" />
        </div>
        <div className="min-h-0 overflow-y-auto">
          {tab === 'typography' && <SettingsContent variant="mobile" className="h-full" />}
          {tab === 'checks' && <PreflightTogglesPanel />}
          {tab === 'ai' && <CaseAiPanel />}
          {tab === 'integrations' && <SettingsContent variant="mobile" tools={false} page="integrations" className="h-full" />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
