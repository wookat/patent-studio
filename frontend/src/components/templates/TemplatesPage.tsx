import { Check, Download, FileUp, Loader2, MoreHorizontal, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fmtRelative } from '@/lib/format'
import { useIsDesktop } from '@/hooks/useMisc'
import { countLeaves } from '@/lib/style'
import type { DocumentType, Template, TemplateIn } from '@/lib/types'
import { parseTemplateJson } from './templateJson'
import { cn } from '@/lib/utils'
import { selectCanEditStyle, useStudio } from '@/store'
import { saveBlob } from '@/lib/download'

export interface TemplatesPageProps {
  className?: string
}

const DOC_TYPE_LABEL: Record<DocumentType, string> = { patent_cn_invention: '发明专利' }
/** 与后端 app/domain/templates.py 模板名规则一致 */
const NAME_RE = /^[\w\u4e00-\u9fff-]{1,64}$/

function summary(t: Template): string {
  const parts = [`样式 ${countLeaves(t.settings.style)} 项`]
  if (t.settings.abstract_limit != null) parts.push(`摘要上限 ${t.settings.abstract_limit}`)
  if (t.settings.sub_except?.length) parts.push(`下标例外 ${t.settings.sub_except.length}`)
  return parts.join(' · ')
}

function downloadJson(t: Template) {
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' })
  saveBlob(blob, `template-${t.name}.json`)
}

/**
 * 排版模板页（docs/plan/10 §6 / §7.1；Overleaf 模板库 + Word 样式集）：保存当前设置为模板 · 列表 · 应用/导出/删除 · 导入 JSON。
 * `document_type` 只读标签（预留毕业论文等类型）。375：行内两行、操作收进 ⋯ 菜单。
 */
export function TemplatesPage({ className }: TemplatesPageProps) {
  const pid = useStudio((s) => s.pid)
  const settings = useStudio((s) => s.settings)
  const templates = useStudio((s) => s.templates)
  const loading = useStudio((s) => s.templatesLoading)
  const unavailable = useStudio((s) => s.templatesUnavailable)
  const error = useStudio((s) => s.templatesError)
  const loadTemplates = useStudio((s) => s.loadTemplates)
  const saveCurrentAsTemplate = useStudio((s) => s.saveCurrentAsTemplate)
  const applyTemplate = useStudio((s) => s.applyTemplate)
  const deleteTemplate = useStudio((s) => s.deleteTemplate)
  const importTemplate = useStudio((s) => s.importTemplate)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const toast = useStudio((s) => s.toast)
  // R76-01：保存/应用写的是本案 settings——与 R59 同口径按 editor+ 门控；导入/删除是机构级资源，仍交服务端 403。
  const canEdit = useStudio(selectCanEditStyle)
  const desktop = useIsDesktop()

  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [confirmImport, setConfirmImport] = useState<TemplateIn | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const removingRef = useRef(false)

  useEffect(() => { void loadTemplates() }, [loadTemplates])

  const trimmed = name.trim()
  const nameOk = !trimmed || NAME_RE.test(trimmed)
  const exists = templates.some((t) => t.name === trimmed)
  const canSave = !!pid && !!settings && !!trimmed && nameOk && !saving && canEdit

  const onSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    const saved = await saveCurrentAsTemplate(trimmed, desc.trim(), exists)
    setSaving(false)
    if (saved) {
      setName('')
      setDesc('')
    }
  }

  const onImportFile = async (f: File) => {
    try {
      const t = parseTemplateJson(await f.text())
      if (templates.some((x) => x.name === t.name)) setConfirmImport(t)
      else await importTemplate(t)
    } catch (e) {
      toast(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }

  const apply = (t: Template) => {
    if (!pid) return
    requestNavigation({ type: 'custom', label: `应用模板「${t.name}」`, run: async () => { await applyTemplate(pid, t.name) } })
  }
  const remove = async (t: Template) => {
    if (removingRef.current) return
    removingRef.current = true
    setConfirmDel(null)
    try {
      await deleteTemplate(t.name)
      toast(`已删除模板「${t.name}」`)
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除模板失败', 'error')
    } finally {
      removingRef.current = false
    }
  }

  return (
    <section data-slot="TemplatesPage" data-testid="settings-page-templates" aria-label="模板" className={cn('min-w-0', className)}>
      <h3 className="pb-1 pt-3 text-sm font-semibold">排版模板</h3>
      <p className="text-xs text-fg-muted">
        把当前案卷的排版设置（样式 / 摘要字数上限 / 下标例外，不含附图选择）保存为命名模板，在其他案卷一键应用；也可导入导出 JSON。
      </p>

      {unavailable ? (
        <p className="pt-3 text-xs text-fg-muted" data-testid="templates-unavailable">模板功能尚未启用（后端 501）。</p>
      ) : (
        <>
          <form className="mt-3 space-y-2 rounded-sm border bg-panel p-3" onSubmit={(e) => void onSave(e)} aria-label="保存当前设置为模板" data-testid="template-save-form">
            <div className={cn('grid gap-2', desktop && 'grid-cols-[1fr_2fr]')}>
              <div className="space-y-1">
                <Label htmlFor="tpl-name" className="text-xs">模板名</Label>
                <Input
                  id="tpl-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：宋体小四-一倍半行距"
                  className="h-md-control text-sm"
                  maxLength={64}
                  aria-invalid={!nameOk || undefined}
                  aria-describedby={nameOk ? undefined : 'tpl-name-hint'}
                  data-testid="template-name"
                />
                {!nameOk && (
                  <p id="tpl-name-hint" className="text-xs text-danger-fg" data-testid="template-name-invalid">
                    模板名只能用中文、字母、数字、下划线和连字符（不含空格）
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="tpl-desc" className="text-xs">说明（可选）</Label>
                <Input id="tpl-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="给自己或同事的一句话备注" className="h-md-control text-sm" maxLength={200} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={!canSave} data-testid="template-save">
                {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {exists ? '覆盖同名模板' : '保存当前设置为模板'}
              </Button>
              <span className="text-xs text-fg-muted">
                {!pid ? '先打开一个案卷' : exists ? `已有同名模板，保存将覆盖` : settings ? `当前：样式 ${countLeaves(settings.style)} 项已改` : ''}
              </span>
            </div>
          </form>

          <div className="flex items-center gap-2 pt-4">
            <h4 className="text-xs font-semibold text-fg-muted">
              模板列表{templates.length > 0 && ` (${templates.length})`}
            </h4>
            <span className="flex-1" />
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              tabIndex={-1}
              aria-label="选择模板 JSON"
              data-testid="template-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onImportFile(f)
                e.target.value = ''
              }}
            />
            <Button variant="outline" size="sm" className="h-sm-control px-2 text-xs" disabled={!canEdit} onClick={() => fileRef.current?.click()} data-testid="template-import">
              <FileUp className="size-3.5" aria-hidden /> 导入 JSON
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => void loadTemplates()} disabled={loading} aria-label="刷新模板列表">
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} aria-hidden />
            </Button>
          </div>

          {error && (
            <p role="alert" className="pt-2 text-xs text-danger-fg">{error}</p>
          )}

          {templates.length === 0 ? (
            <div className="mt-2 rounded-sm border border-dashed px-4 py-6 text-center text-xs text-fg-muted" data-testid="templates-empty">
              {loading ? '正在加载…' : '尚无模板。用上方表单保存当前案卷的排版设置，或导入同事导出的模板 JSON。'}
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-sm border text-sm" aria-label="模板列表" data-testid="templates-list">
              {templates
                .slice()
                .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                .map((t) => {
                  const del = confirmDel === t.name
                  const actions = del ? (
                    <span className="flex items-center gap-1 text-xs" role="group" aria-label={`确认删除模板 ${t.name}`}>
                      <span className="text-danger-fg">删除？</span>
                      <Button variant="danger" size="sm" className="h-sm-control px-2 text-xs" onClick={() => void remove(t)} data-testid={`template-delete-confirm-${t.name}`}>
                        <Check className="size-3.5" aria-hidden /> 确认
                      </Button>
                      <Button variant="ghost" size="sm" className="h-sm-control px-2 text-xs" onClick={() => setConfirmDel(null)}>
                        <X className="size-3.5" aria-hidden /> 取消
                      </Button>
                    </span>
                  ) : desktop ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button size="sm" className="h-sm-control px-2.5 text-xs" disabled={!pid || !canEdit} onClick={() => apply(t)} data-testid={`template-apply-${t.name}`}>
                        应用
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => downloadJson(t)} aria-label={`导出模板 ${t.name}`} data-testid={`template-export-${t.name}`}>
                        <Download className="size-3.5" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7 text-fg-muted hover:text-danger-fg" onClick={() => setConfirmDel(t.name)} aria-label={`删除模板 ${t.name}`} data-testid={`template-delete-${t.name}`}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </span>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`模板 ${t.name} 的操作`} title={`模板 ${t.name} 的操作`} data-testid={`template-more-${t.name}`}>
                          <MoreHorizontal className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={!pid || !canEdit} onSelect={() => apply(t)}>应用到当前案卷</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => downloadJson(t)}>导出 JSON</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-danger-fg focus:text-danger-fg" onSelect={() => setConfirmDel(t.name)}>删除</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                  return (
                    <li key={t.name} className="flex items-start gap-2 px-3 py-2" data-testid="template-row">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium">{t.name}</span>
                          <Badge tone="outline" className="h-5 px-1.5 text-2xs font-normal text-fg-muted" data-testid="template-doctype">
                            {DOC_TYPE_LABEL[t.document_type] ?? t.document_type}
                          </Badge>
                        </div>
                        <p className="truncate text-xs text-fg-muted" title={t.description || summary(t)}>
                          {t.description || summary(t)}
                          <span className="px-1">·</span>
                          <time dateTime={t.updated_at}>{fmtRelative(Date.parse(t.updated_at))}</time>
                        </p>
                      </div>
                      {actions}
                    </li>
                  )
                })}
            </ul>
          )}
        </>
      )}

      <Dialog open={confirmImport !== null} onOpenChange={(o) => { if (!o) setConfirmImport(null) }}>
        <DialogContent size="sm" data-testid="template-import-confirm">
          <DialogHeader>
            <DialogTitle>覆盖同名模板</DialogTitle>
            <DialogDescription>已存在同名模板「{confirmImport?.name}」，导入将覆盖其样式与说明，原内容不可恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmImport(null)}>取消</Button>
            <Button
              variant="danger"
              data-testid="template-import-confirm-ok"
              onClick={async () => {
                const t = confirmImport
                setConfirmImport(null)
                if (t) await importTemplate(t, true)
              }}
            >
              覆盖导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
