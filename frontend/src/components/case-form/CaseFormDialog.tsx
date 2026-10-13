import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { useIsDesktop } from '@/hooks/useMisc'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { caseFormValues, casePatchFromForm, validateCaseForm, type CaseFormErrors, type CaseFormValues, type CaseWithMeta } from '@/lib/caseForm'
import { useStudio } from '@/store'
import { CaseForm } from './CaseForm'

/** 后端 DeliverError.field / case.json 键 → 表单控件 data-testid 后缀（CaseForm 的 `case-<key>`） */
const FIELD_TESTID: Record<string, string> = {
  case_no: 'caseNo',
  client: 'client',
  client_contact: 'clientContact',
  applicants: 'applicants',
  inventors: 'inventors',
  attorney: 'attorney',
  reviewer: 'reviewer',
  fee_status: 'feeStatus',
  'dates.application_no': 'applicationNo',
  'dates.opened': 'opened',
  'dates.target_filing': 'targetFiling',
  'dates.filed': 'filingDate',
  'dates.publication': 'publicationDate',
  'dates.exam_request': 'examRequestDate',
  'dates.grant': 'grantDate',
}

/**
 * 案件元数据对话框：读 store.projects[pid].case（含旧文件缺新字段）→ 表单；保存 = PUT /case 只带改动字段（patchCase）。
 * Dialog md（560）；375 由 DialogContent 自带全屏 Sheet；viewer 只读。store.caseFormField（递交页字段级错误）打开时聚焦对应控件。
 */
export function CaseFormDialog() {
  const pid = useStudio((s) => s.caseFormPid)
  const focusField = useStudio((s) => s.caseFormField)
  const close = useStudio((s) => s.closeCaseForm)
  const contentRef = useRef<HTMLDivElement>(null)
  const row = useStudio((s) => (pid ? s.projects.find((p) => p.id === pid) ?? (s.project?.id === pid ? s.project : undefined) : undefined))
  const patchCase = useStudio((s) => s.patchCase)
  const authOff = useStudio((s) => s.authStatus === 'off')
  const isDesktop = useIsDesktop()
  const readonly = !authOff && row?.my_role === 'viewer'

  const initial = useMemo(() => caseFormValues(row?.case as CaseWithMeta | undefined), [row?.case])
  /* 批74：草稿上提 store——宿主（DashboardPage）随 hash 路由卸载时表单不丢；
     同案重开以草稿为初值，关闭/提交/放弃各路径显式清 */
  const draft = useStudio((s) => s.caseFormDraft)
  const setCaseFormDraft = useStudio((s) => s.setCaseFormDraft)
  const [values, setValuesState] = useState<CaseFormValues>(() => (draft && draft.key === pid ? draft.values : initial))
  const [errors, setErrors] = useState<CaseFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const setValues = (p: Partial<CaseFormValues>) => {
    setValuesState((v) => {
      const next = { ...v, ...p }
      if (pid) setCaseFormDraft({ key: pid, values: next })
      return next
    })
  }
  const closeAndClear = () => {
    setCaseFormDraft(null)
    close()
  }

  /* 挂载首拍初值即种子（恢复稿或 initial）无须复位；pid/initial 后续变化才复位。
     D-B74-1：草稿持本 pid 钥匙时 initial 换引用（宿主重挂后 row?.case 重新取回）不得覆写——
     草稿即表单权威种子，覆写=静默丢稿（复位后表单呈「非脏」，取消还会直关连带清稿） */
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (useStudio.getState().caseFormDraft?.key === pid) return
    setValuesState(initial)
    setErrors({})
    setFailed(false)
  }, [initial, pid])

  useEffect(() => {
    if (!pid || !focusField) return
    const key = FIELD_TESTID[focusField] ?? focusField
    const t = window.setTimeout(() => {
      const el = contentRef.current?.querySelector<HTMLElement>(`[data-testid="case-${key}"]`)
      el?.focus()
      el?.scrollIntoView?.({ block: 'center' })
    }, 0)
    return () => window.clearTimeout(t)
  }, [pid, focusField])

  const dirty = useMemo(() => Object.keys(casePatchFromForm(values, initial)).length > 0, [values, initial])
  useBeforeUnload(() => pid !== null && dirty)
  /* Esc / 遮罩 / 取消 在脏态先问「放弃修改？」（requestClose 单一路径） */
  const [ask, setAsk] = useState(false)
  const requestClose = () => (!readonly && dirty ? setAsk(true) : closeAndClear())

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pid) return
    const errs = validateCaseForm(values)
    setErrors(errs)
    if (Object.keys(errs).length) return
    if (!dirty) return closeAndClear()
    setSaving(true)
    setFailed(false)
    const ok = await patchCase(pid, casePatchFromForm(values, initial))
    setSaving(false)
    if (ok) closeAndClear()
    else setFailed(true)
  }

  return (
    <Dialog open={!!pid} onOpenChange={(v) => !v && requestClose()}>
      {/* R55-02：页头/页脚固定、表单区内部滚动——整盒滚动会把页脚沉到裁切区外，点击命中 scrim 静默丢输入 */}
      <DialogContent ref={contentRef} size="md" className="max-h-dvh sm:flex sm:max-h-[90dvh] sm:flex-col sm:overflow-hidden" data-testid="case-form-dialog">
        <form onSubmit={(e) => void submit(e)} className="flex min-h-0 flex-1 flex-col gap-4" noValidate>
          <DialogHeader className="shrink-0">
            <DialogTitle>案件信息</DialogTitle>
            <DialogDescription className="truncate">{row ? `${row.case?.case_no ? `${row.case.case_no} · ` : ''}${row.title || row.id}` : '案卷不存在'}</DialogDescription>
          </DialogHeader>
          <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
            {row?.case ? (
              <CaseForm values={values} errors={errors} onChange={setValues} readonly={readonly} mobile={!isDesktop} />
            ) : (
              <p className="text-sm text-fg-muted">该案卷没有 case.json，先在案卷内初始化案件信息。</p>
            )}
            {failed && (
              <Alert variant="danger" data-testid="case-form-failed">
                <AlertDescription>保存失败，请检查网络或权限后重试。</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" size={isDesktop ? 'md' : 'xl'} onClick={requestClose} data-testid="case-form-cancel">
              {readonly ? '关闭' : '取消'}
            </Button>
            {!readonly && row?.case && (
              <Button type="submit" size={isDesktop ? 'md' : 'xl'} loading={saving} disabled={!dirty} data-testid="case-form-save">
                保存
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
      <DiscardDialog open={ask} onStay={() => setAsk(false)} onDiscard={() => { setAsk(false); closeAndClear() }} />
    </Dialog>
  )
}
