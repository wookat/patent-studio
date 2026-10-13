import { useEffect, useState } from 'react'
import { CalendarCheck, Construction } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import type { HolidayStatus } from '@/store/admin'
import { useStudio } from '@/store'
import type { Org } from '@/types/account'
import type { OrgSettings } from '@/types/org'
import { OrgForm } from './OrgForm'

export interface OrgPanelProps {
  org: Org | null
  orgUnavailable: boolean
  onSaveName(name: string): Promise<boolean>
}

const HOLIDAY_TEXT: Record<HolidayStatus, { label: string; tone: 'default' | 'ok' | 'warn' | 'danger'; hint: string }> = {
  unknown: { label: '检查中…', tone: 'default', hint: '正在读取期限服务。' },
  ok: { label: '已加载', tone: 'ok', hint: '期限计算按法定节假日顺延（backend/app/deadlines/holidays/<year>.json）。' },
  missing: { label: '缺失', tone: 'warn', hint: '没有节假日表：期限只按周末顺延，请运维补充 holidays/<year>.json 后重启。' },
  unavailable: { label: '不可用', tone: 'danger', hint: '期限服务未就绪（501 / 网络错误），无法判断节假日表状态。' },
}

/**
 * 机构 tab（21 §4.6 / R-ADM-02）：机构名称（org.json）· 新建案卷默认协作（OrgSettings.default_collab）· 节假日表状态只读。
 * default_collab 契约当前只有 editor_mode / allow_viewer_comment（types/org.ts）；下载 / 复制 / 链接 TTL 见 integration_requests，不在此臆造。
 */
export function OrgPanel({ org, orgUnavailable, onSaveName }: OrgPanelProps) {
  const settings = useStudio((s) => s.orgSettings)
  const unavailable = useStudio((s) => s.orgSettingsUnavailable)
  const saving = useStudio((s) => s.orgSettingsSaving)
  const loadOrgSettings = useStudio((s) => s.loadOrgSettings)
  const saveOrgSettings = useStudio((s) => s.saveOrgSettings)
  const holidays = useStudio((s) => s.orgHolidays)
  const loadOrgHolidays = useStudio((s) => s.loadOrgHolidays)

  useEffect(() => {
    void loadOrgSettings()
    void loadOrgHolidays()
  }, [loadOrgSettings, loadOrgHolidays])

  const [collab, setCollab] = useState<OrgSettings['default_collab'] | null>(null)
  useEffect(() => {
    setCollab(settings?.default_collab ?? null)
  }, [settings])
  const dirty = !!settings && !!collab && (collab.editor_mode !== settings.default_collab.editor_mode || collab.allow_viewer_comment !== settings.default_collab.allow_viewer_comment)
  const h = HOLIDAY_TEXT[holidays]

  return (
    <div className="grid max-w-form gap-6" data-testid="admin-org-panel">
      <section aria-labelledby="admin-org-name-h" className="grid gap-2">
        <h3 id="admin-org-name-h" className="text-sm font-semibold">机构名称</h3>
        <OrgForm key={org?.name ?? ''} org={org} unavailable={orgUnavailable} onSave={onSaveName} />
      </section>

      <section aria-labelledby="admin-collab-h" className="grid gap-3">
        <div>
          <h3 id="admin-collab-h" className="text-sm font-semibold">默认协作设置</h3>
          <p className="text-xs text-fg-muted">新建案卷时的初始协作策略；已有案卷不受影响，可在各案「协作」里单独改。</p>
        </div>
        {unavailable ? (
          <EmptyState icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="机构设置接口（GET/PUT /api/admin/settings）尚未提供（501）。" size="sm" data-testid="admin-collab-unavailable" />
        ) : !settings || !collab ? (
          <div className="grid gap-2" aria-busy data-testid="admin-collab-loading">
            <Skeleton className="h-md-control" />
            <Skeleton className="h-md-control" />
          </div>
        ) : (
          <form
            className="grid gap-4"
            data-testid="admin-collab-form"
            onSubmit={(e) => {
              e.preventDefault()
              void saveOrgSettings({ default_collab: collab })
            }}
          >
            <div className="grid gap-1.5">
              <span id="collab-mode-label" className="text-sm font-medium">协作者默认模式</span>
              <Segmented<'edit' | 'review'>
                aria-label="协作者默认模式"
                aria-labelledby="collab-mode-label"
                value={collab.editor_mode}
                onValueChange={(v) => setCollab({ ...collab, editor_mode: v })}
                options={[
                  { value: 'edit', label: '直接编辑', 'data-testid': 'collab-mode-edit' },
                  { value: 'review', label: '审阅建议', 'data-testid': 'collab-mode-review' },
                ]}
              />
              <p className="text-xs text-fg-muted">「审阅建议」下协作者的改动以 CriticMarkup 建议写入，由责任人接受 / 拒绝。</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border bg-panel px-3 py-2">
              <div className="min-w-0">
                <Label htmlFor="collab-viewer-comment" className="text-sm">允许只读协作者批注</Label>
                <p className="text-xs text-fg-muted">viewer 可添加批注但不能改正文。</p>
              </div>
              <Switch id="collab-viewer-comment" checked={collab.allow_viewer_comment} onCheckedChange={(v) => setCollab({ ...collab, allow_viewer_comment: v })} data-testid="collab-viewer-comment" />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" variant="outline" disabled={!dirty || saving} data-testid="collab-save">
                {saving ? '保存中…' : '保存'}
              </Button>
              <span className="text-xs text-fg-muted">下载 / 复制 / 分享链接有效期等更多默认项待机构设置契约扩展。</span>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="admin-holiday-h" className="grid gap-2">
        <h3 id="admin-holiday-h" className="text-sm font-semibold">节假日数据</h3>
        <Alert variant={h.tone} data-testid="admin-holidays" data-state={holidays}>
          <CalendarCheck aria-hidden />
          <AlertTitle className="flex items-center gap-2">
            法定节假日表
            <Badge tone={h.tone === 'default' ? 'neutral' : h.tone}>{h.label}</Badge>
          </AlertTitle>
          <AlertDescription>{h.hint}</AlertDescription>
        </Alert>
      </section>
    </div>
  )
}
