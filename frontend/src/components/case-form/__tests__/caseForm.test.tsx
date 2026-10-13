// @vitest-environment jsdom
import axe from 'axe-core'
import { act, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { caseFieldsFromForm, caseFormValues, casePatchFromForm, validateCaseForm, type CaseFormErrors, type CaseFormValues, type CaseWithMeta } from '@/lib/caseForm'
import type { CaseSummary } from '@/types/case'
import { CaseForm } from '../CaseForm'

/**
 * R-CASE-02 案件元数据表单：旧 case.json（W4 形状，无 application_no / filing_date / priority / fee_status…）可渲染为空值；
 * 校验（日期格式 / 优先权必填 / 申请日≥优先权日 / 授权日≥申请日）；PUT 补丁只带改动键；375 控件 44px；axe 干净。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})
async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

/** W4 旧 case.json：没有任何 W5 新字段 */
const OLD_CASE: CaseSummary = {
  version: 1,
  case_no: 'PS-2026-001',
  kind: 'invention',
  status: 'drafting',
  owner_user_id: 'u1',
  client: '客户甲',
  applicants: ['甲公司', '乙公司'],
  inventors: ['张三'],
  tags: [],
  dates: { opened: '2026-01-01', target_filing: null, filed: null, application_no: null },
  deadlines: [],
  archived: false,
  next_deadline: null,
}

const NEW_CASE: CaseWithMeta = {
  ...OLD_CASE,
  dates: { ...OLD_CASE.dates, application_no: '202610123456.7', filed: '2026-03-01', publication: null, exam_request: '2026-03-02', grant: null },
  priority: [{ country: 'US', date: '2025-06-01', number: '63/000001' }],
  attorney: '李代理',
  reviewer: '王审核',
  client_contact: '赵联系 · 138',
  fee_status: 'billed',
  related: [{ pid: 'mother-1', kind: 'parent', note: '母案' }],
}

function Harness({ initial, mobile }: { initial: CaseFormValues; mobile?: boolean }) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<CaseFormErrors>({})
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setErrors(validateCaseForm(values))
      }}
    >
      <CaseForm values={values} errors={errors} mobile={mobile} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />
      <button type="submit" data-testid="submit">
        校验
      </button>
    </form>
  )
}

const input = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLInputElement

describe('lib/caseForm', () => {
  it('旧 case.json 无新字段 ⇒ 表单值全部为空串 / 空数组；新字段齐全时逐一映射', () => {
    const v = caseFormValues(OLD_CASE as CaseWithMeta)
    expect(v.caseNo).toBe('PS-2026-001')
    expect(v.applicants).toBe('甲公司\n乙公司')
    expect(v.opened).toBe('2026-01-01')
    expect(v.applicationNo).toBe('')
    expect(v.filingDate).toBe('')
    expect(v.priority).toEqual([])
    expect(v.feeStatus).toBe('')
    expect(v.attorney).toBe('')
    expect(caseFormValues(undefined).kind).toBe('invention')
    const n = caseFormValues(NEW_CASE)
    expect(n.applicationNo).toBe('202610123456.7')
    expect(n.filingDate).toBe('2026-03-01')
    expect(n.examRequestDate).toBe('2026-03-02')
    expect(n.priority).toEqual([{ country: 'US', date: '2025-06-01', number: '63/000001' }])
    expect(n.feeStatus).toBe('billed')
    expect(n.clientContact).toBe('赵联系 · 138')
    expect(n.related).toEqual([{ pid: 'mother-1', kind: 'parent', note: '母案' }])
  })

  it('校验：非法日期 / 优先权必填 / 申请日不早于优先权日 / 授权日不早于申请日', () => {
    const base = caseFormValues(NEW_CASE)
    expect(validateCaseForm(base)).toEqual({})
    expect(validateCaseForm({ ...base, grantDate: '2026-2-30x' }).grantDate).toMatch(/YYYY-MM-DD/)
    expect(validateCaseForm({ ...base, filingDate: '2025-01-01' }).filingDate).toBe('申请日不应早于优先权日')
    expect(validateCaseForm({ ...base, grantDate: '2026-02-01' }).grantDate).toBe('授权日不应早于申请日')
    const errs = validateCaseForm({ ...base, priority: [{ country: '', date: '', number: '' }] })
    expect(errs['priority.0.country']).toBeTruthy()
    expect(errs['priority.0.date']).toBeTruthy()
    expect(errs['priority.0.number']).toBeTruthy()
  })

  it('校验：申请号按后端正典 APPLICATION_NO_RE（批30 唯一权威）——坏值在落库前拦下', () => {
    const base = caseFormValues(NEW_CASE)
    expect(validateCaseForm(base).applicationNo).toBeUndefined()
    expect(validateCaseForm({ ...base, applicationNo: '' }).applicationNo).toBeUndefined()
    expect(validateCaseForm({ ...base, applicationNo: '  ' }).applicationNo).toBeUndefined()
    expect(validateCaseForm({ ...base, applicationNo: '2026 1 0123456.7' }).applicationNo).toBeUndefined()
    expect(validateCaseForm({ ...base, applicationNo: 'abc123' }).applicationNo).toMatch(/申请号格式/)
    expect(validateCaseForm({ ...base, applicationNo: '2026101234567' }).applicationNo).toMatch(/申请号格式/)
  })

  it('补丁只带改动键：全部日期 / 申请号归入 dates.*（后端字段名）；空串 ⇒ null；无改动 ⇒ {}', () => {
    const prev = caseFormValues(OLD_CASE as CaseWithMeta)
    expect(casePatchFromForm(prev, prev)).toEqual({})
    const patch = casePatchFromForm(
      { ...prev, applicationNo: ' 2026101234567 ', filingDate: '2026-03-01', publicationDate: '2027-09-01', grantDate: '2028-01-01', targetFiling: '2026-04-01', attorney: '', feeStatus: 'paid', priority: [{ country: 'cn', date: '2025-01-01', number: ' 1 ' }] },
      prev,
    )
    expect(patch).toEqual({
      dates: { target_filing: '2026-04-01', application_no: '2026101234567', filed: '2026-03-01', publication: '2027-09-01', grant: '2028-01-01' },
      fee_status: 'paid',
      priority: [{ country: 'CN', date: '2025-01-01', number: '1' }],
    })
    expect(casePatchFromForm({ ...caseFormValues(NEW_CASE), attorney: '  ' }, caseFormValues(NEW_CASE))).toEqual({ attorney: null })
  })

  it('caseFieldsFromForm（新建案对话框旧契约）保持不变', () => {
    expect(caseFieldsFromForm({ caseNo: '', client: '', opened: '' })).toBeUndefined()
    expect(caseFieldsFromForm({ caseNo: ' A ', client: '', opened: '2026-01-02' })).toEqual({ case_no: 'A', dates: { opened: '2026-01-02' } })
  })

  it('关联案：空 pid 报错；补丁只在变更时带出 related（pid/note 去空白）', () => {
    const prev = caseFormValues(NEW_CASE)
    const errs = validateCaseForm({ ...prev, related: [...prev.related, { pid: ' ', kind: 'divisional', note: '' }] })
    expect(errs['related.1.pid']).toBeTruthy()
    expect(validateCaseForm(prev)['related.0.pid']).toBeUndefined()
    const patch = casePatchFromForm(
      { ...prev, related: [...prev.related, { pid: '  div-2 ', kind: 'divisional', note: ' 分案二 ' }] },
      prev,
    )
    expect(patch.related).toEqual([
      { pid: 'mother-1', kind: 'parent', note: '母案' },
      { pid: 'div-2', kind: 'divisional', note: '分案二' },
    ])
    expect(casePatchFromForm(prev, prev)).toEqual({})
  })
})

describe('<CaseForm>', () => {
  it('旧 case.json 可渲染：新字段控件存在且为空，优先权显示「无」；axe 无 serious/critical', async () => {
    const el = await mount(<Harness initial={caseFormValues(OLD_CASE as CaseWithMeta)} />)
    expect(input(el, 'case-caseNo').value).toBe('PS-2026-001')
    expect(input(el, 'case-applicationNo').value).toBe('')
    expect(input(el, 'case-filingDate').value).toBe('')
    expect(input(el, 'case-grantDate').value).toBe('')
    expect(input(el, 'case-attorney').value).toBe('')
    expect(el.querySelector('[data-testid="case-feeStatus"]')?.textContent).toContain('未设置')
    expect(el.textContent).toContain('无优先权要求')
    const res = await axe.run(el, { resultTypes: ['violations'], rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual([])
  })

  it('添加优先权后提交 ⇒ 三个必填错误挂到对应 Field（aria-invalid + 错误文案）；删除后错误消失', async () => {
    const el = await mount(<Harness initial={caseFormValues(OLD_CASE as CaseWithMeta)} />)
    await act(async () => (el.querySelector('[data-testid="priority-add"]') as HTMLButtonElement).click())
    expect(el.querySelector('[data-testid="priority-0"]')).not.toBeNull()
    expect(input(el, 'priority-0-country').value).toBe('CN')
    await act(async () => (el.querySelector('[data-testid="submit"]') as HTMLButtonElement).click())
    expect(input(el, 'priority-0-date').getAttribute('aria-invalid')).toBe('true')
    expect(input(el, 'priority-0-number').getAttribute('aria-invalid')).toBe('true')
    expect(input(el, 'priority-0-country').getAttribute('aria-invalid')).toBeNull()
    expect(el.textContent).toContain('请填写优先权日')
    await act(async () => (el.querySelector('[data-testid="priority-0-remove"]') as HTMLButtonElement).click())
    expect(el.querySelector('[data-testid="priority-0"]')).toBeNull()
  })

  it('关联案行：添加/填写/删除联动 values；有 pid 时渲打开链接', async () => {
    const el = await mount(<Harness initial={caseFormValues(NEW_CASE)} />)
    // NEW_CASE 自带一条母案关联
    expect(input(el, 'related-0-pid').value).toBe('mother-1')
    expect((el.querySelector('[data-testid="related-0-open"]') as HTMLAnchorElement).href).toContain('#/p/mother-1')
    await act(async () => (el.querySelector('[data-testid="related-add"]') as HTMLButtonElement).click())
    expect(el.querySelector('[data-testid="related-1"]')).not.toBeNull()
    // 空 pid 提交 ⇒ 校验错误挂到对应 Field
    await act(async () => (el.querySelector('[data-testid="submit"]') as HTMLButtonElement).click())
    expect(input(el, 'related-1-pid').getAttribute('aria-invalid')).toBe('true')
    await act(async () => (el.querySelector('[data-testid="related-1-remove"]') as HTMLButtonElement).click())
    expect(el.querySelector('[data-testid="related-1"]')).toBeNull()
  })

  it('375：输入框 / 选择器用 44px 移动控件高度', async () => {
    const el = await mount(<Harness initial={caseFormValues(NEW_CASE)} mobile />)
    expect(input(el, 'case-caseNo').className).toContain('h-touch')
    expect(el.querySelector('[data-testid="case-kind"]')?.className).toContain('h-touch')
    expect(input(el, 'priority-0-number').value).toBe('63/000001')
  })
})

describe('<CaseFormDialog>', () => {
  it('R55-02 页头/页脚固定不随表单滚动——容器不滚整盒，表单区独立 overflow-y-auto', async () => {
    const { DESKTOP_QUERY, useStudio } = await import('@/store')
    const { CaseFormDialog } = await import('../CaseFormDialog')
    window.matchMedia = (q: string) =>
      ({ matches: q === DESKTOP_QUERY, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    useStudio.setState({
      caseFormPid: 'p1',
      authStatus: 'off',
      projects: [{ id: 'p1', title: '一案', case: OLD_CASE, my_role: 'owner' }] as never,
    })
    await mount(<CaseFormDialog />)
    const dlg = document.querySelector('[data-testid="case-form-dialog"]')!
    expect(dlg.className).toContain('sm:overflow-hidden')
    const scroll = dlg.querySelector('.overflow-y-auto')!
    expect(scroll.querySelector('[data-testid="case-caseNo"]')).not.toBeNull()
    expect(scroll.querySelector('[data-testid="case-form-save"]')).toBeNull()
    expect(document.querySelector('[data-slot="dialog-footer"]')!.className).toContain('shrink-0')
    useStudio.setState({ caseFormPid: null, projects: [] })
  })

  it('批74：宿主卸载→重挂草稿原样恢复（store caseFormDraft 接管）；放弃路径显式清稿', async () => {
    const { DESKTOP_QUERY, useStudio } = await import('@/store')
    const { CaseFormDialog } = await import('../CaseFormDialog')
    window.matchMedia = (q: string) =>
      ({ matches: q === DESKTOP_QUERY, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    useStudio.setState({
      caseFormPid: 'p1',
      authStatus: 'off',
      caseFormDraft: null,
      projects: [{ id: 'p1', title: '一案', case: OLD_CASE, my_role: 'owner' }] as never,
    })
    await mount(<CaseFormDialog />)
    const attorney = document.querySelector('[data-testid="case-attorney"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(attorney, '李代理乙')
      attorney.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useStudio.getState().caseFormDraft).toMatchObject({ key: 'p1', values: { attorney: '李代理乙' } })
    /* 宿主（DashboardPage）随 hash 路由卸载——草稿入 store，同案重开恢复 */
    await act(async () => root?.unmount())
    root = null
    host?.remove()
    await mount(<CaseFormDialog />)
    expect((document.querySelector('[data-testid="case-attorney"]') as HTMLInputElement).value).toBe('李代理乙')
    /* D-B74-1 钉：宿主重挂后 row?.case 换引用 → initial 复位不得覆写草稿（草稿持本 pid 钥匙即权威种子） */
    await act(async () =>
      useStudio.setState({ projects: [{ id: 'p1', title: '一案', case: { ...OLD_CASE }, my_role: 'owner' }] as never }),
    )
    expect((document.querySelector('[data-testid="case-attorney"]') as HTMLInputElement).value).toBe('李代理乙')
    /* 显式关（脏 → DiscardDialog 放弃）清稿 */
    await act(async () => (document.querySelector('[data-testid="case-form-cancel"]') as HTMLButtonElement).click())
    await act(async () => (document.querySelector('[data-testid="discard-confirm"]') as HTMLButtonElement).click())
    expect(useStudio.getState().caseFormDraft).toBeNull()
    expect(useStudio.getState().caseFormPid).toBeNull()
    useStudio.setState({ caseFormPid: null, projects: [], caseFormDraft: null })
  })
})
