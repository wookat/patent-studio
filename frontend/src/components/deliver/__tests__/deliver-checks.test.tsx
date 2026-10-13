// @vitest-environment jsdom
import axe from 'axe-core'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import type { Diagnostic } from '@/lib/types'
import { DESKTOP_QUERY, selectErrorCount, useStudio } from '@/store'
import { selectCheckCounts, selectCheckErrorCount, selectCheckItems } from '@/store/checks'
import { confirmationState, gridEntries, selectExportEntries } from '@/store/deliver'
import type { DeliverManifest } from '@/types/deliver'
import type { Confirmation } from '@/types/public-share'
import { CheckTable, locationLabel } from '../CheckTable'
import { ConfirmationBadge, DeliverPage } from '../DeliverPage'
import { gridEntries as gridEntriesFromGrid } from '../ExportGrid'
import { CPC_BADGE_KINDS, CPC_UNVERIFIED } from '../ExportItem'
import { FieldErrors } from '../FieldErrors'
import { DeliverSteps } from '../DeliverSteps'
import { XmlReport } from '../DeliverReport'
import type { XmlBook } from '@/lib/types'

/**
 * W5 递交页（docs/plan/21 §4.4；R-CHK-03 / R-CHK-05 / R-CHK-07；§1.2 A5；§1.3 A12）：
 *  - 体检表与控制台 error 数来自同一 selector（store.items）且相等
 *  - 字段级错误点击 → openCaseForm({ field: 'applicants' })
 *  - 客户确认 sha ≠ 当前版本 sha → warning「确认版本已过期」；相等 → success「客户确认 vN」
 *  - 产物列表：ExportGrid 导出的 gridEntries 与 store.selectExportEntries 是同一函数（唯一产物源）
 *  - XML / 递交包卡片角标「未经 CPC 客户端验证」
 *  - deliver/errors 501 → 字段级错误区不渲染、不报错
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement
let desktop = true
const initial = useStudio.getInitialState()

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia = (q: string) =>
    ({ matches: q === DESKTOP_QUERY ? desktop : false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
  Element.prototype.scrollIntoView ??= () => {}
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
})

beforeEach(() => {
  useStudio.setState(initial, true)
  desktop = true
  window.location.hash = '#/p/method/deliver'
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
  vi.restoreAllMocks()
})

async function mount(el: ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function serious(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel)
const qa = (sel: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLElement>(sel))
const click = async (el: Element | null) => {
  expect(el, 'element to click').not.toBeNull()
  await act(async () => (el as HTMLElement).click())
}

const diag = (id: string, severity: Diagnostic['severity'], code: string, line: number | null): Diagnostic =>
  ({ id, severity, code, message: `${code} @ ${line}`, line, source: 'lint' }) as Diagnostic

const items: Diagnostic[] = [
  diag('d1', 'error', 'claims.forward_ref', 15),
  diag('d2', 'error', 'structure.missing_book', null),
  diag('d3', 'warning', 'claims.unsupported_term', 15),
  diag('d4', 'info', 'abstract.limit', 5),
]

const manifest: DeliverManifest = {
  pid: 'method',
  title: '一种方法',
  items: [
    { kind: 'docx', label: 'DOCX', at: '2026-09-05T10:00:00+00:00', size: 40960, url: '/api/projects/method/export/docx?build_id=b1' },
    { kind: 'xml', label: 'CNIPA XML', at: null, size: null, url: null },
  ],
}

const confirmation = (sha: string, version = 3): Confirmation => ({ version, sha, name: '张客户', note: null, confirmed_at: 1_757_000_000 })

const project = {
  id: 'method',
  title: '一种方法',
  mtime: 0,
  collaborators: [],
  last_modified_by: null,
  my_role: 'owner' as const,
  list_state: 'active' as const,
  figs: [],
  settings: {} as never,
  has_settings_file: false,
  content: '# x',
  backups: [],
  case: { status: 'drafting', dates: { filed: null, application_no: null }, confirmations: [confirmation('abc1234')] },
}

function seedPage() {
  useStudio.setState({
    pid: 'method',
    project: project as never,
    authStatus: 'off',
    content: '# x',
    items,
    manifest,
    versions: [{ sha: 'abc1234', at: 1, message: '', author: '', added: 0, removed: 0 }] as never,
    loadManifest: vi.fn(async () => manifest),
    loadHistory: vi.fn(async () => {}),
    refreshCase: vi.fn(async () => {}),
    ensureLint: vi.fn(async () => {}),
    loadDeliverErrors: vi.fn(async () => {}),
  })
}

describe('R-CHK-03 体检与控制台同源', () => {
  it('selectCheckErrorCount 与控制台 selectErrorCount 读同一 store.items 且相等；CheckTable 计数徽章显示同一数字', async () => {
    useStudio.setState({ items, ast: SYNTH_AST })
    const s = useStudio.getState()
    expect(selectCheckItems(s)).toBe(s.items)
    expect(selectCheckErrorCount(s)).toBe(selectErrorCount(s))
    expect(selectCheckErrorCount(s)).toBe(2)
    expect(selectCheckCounts(s)).toEqual({ error: 2, warning: 1, info: 1 })

    const onLocate = vi.fn()
    await mount(
      <CheckTable items={s.items} counts={selectCheckCounts(s)} loading={false} error={null} stale={false} ran onRerun={() => {}} onLocate={onLocate} />,
    )
    expect(q('[data-testid="check-table"]')).not.toBeNull()
    expect(q('[data-testid="check-counts"]')?.textContent).toContain(String(selectErrorCount(s)))
    expect(qa('[data-testid="check-severity"]').map((el) => el.dataset.severity)).toEqual(['error', 'error', 'warning', 'info'])
    // W11 三批：位置列是用户可读的书 / 权项 / 段落（AST 折算），不露 content.md 与行号
    const tableText = q('[data-testid="check-table"]')?.textContent ?? ''
    expect(tableText).toContain('权利要求 4')
    expect(tableText).not.toMatch(/content\.md|第 \d+ 行/)
    // W12 R3-06：规则 id（d1 / preflight.xxx#1）不进表格文本，只留在信息栏 title
    expect(tableText).not.toMatch(/\bd[1-4]\b/)
    expect(q('[data-testid="check-table"] [title="d1"]')).not.toBeNull()
    const loc = qa('[data-testid="check-location"]')
    expect(loc[0].textContent).toBe('权利要求 4')
    expect(loc[1].textContent).toBe('全文')
    expect(loc[3].textContent).toBe('摘要')
    expect(qa('[data-testid="check-locate"]')[0].getAttribute('aria-label')).toBe('定位到 权利要求 4')
    // 无 AST 时退到后端章节字样，再退到全文
    expect(locationLabel({ ...diag('d9', 'warning', 'x', 39), section: '权利要求书' })).toBe('权利要求书')
    expect(locationLabel(diag('d0', 'info', 'y', null))).toBe('全文')
    await click(qa('[data-testid="check-locate"]')[0])
    expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', line: 15 }))
    expect(await serious(host)).toEqual([])
  })
  it('375：表格转卡片；无问题 → 空态；陈旧 → 提示 + 重跑', async () => {
    const onRerun = vi.fn()
    await mount(<CheckTable items={items} counts={selectCheckCounts({ items })} loading={false} error={null} stale ran mobile onRerun={onRerun} onLocate={() => {}} />)
    expect(q('[data-testid="check-table"]')).toBeNull()
    expect(qa('[data-testid="check-cards"] li')).toHaveLength(4)
    expect(q('[data-testid="check-cards"]')?.textContent).not.toMatch(/\bd[1-4]\b/)
    expect(q('[data-testid="check-stale"]')).not.toBeNull()
    await click(q('[data-testid="check-rerun"]'))
    expect(onRerun).toHaveBeenCalledTimes(1)
    await act(async () => root!.render(<CheckTable items={[]} counts={{ error: 0, warning: 0, info: 0 }} loading={false} error={null} stale={false} ran onRerun={onRerun} onLocate={() => {}} />))
    expect(q('[data-testid="check-empty"]')).not.toBeNull()
    expect(await serious(host)).toEqual([])
  })
})

describe('字段级错误（deliver.errors[] → openCaseForm）', () => {
  it('点击「申请人」错误 → onOpen("applicants")；页内接 store.openCaseForm({ field })', async () => {
    const onOpen = vi.fn()
    await mount(
      <FieldErrors
        errors={[
          { field: 'applicants', code: 'required', message: '至少一位申请人' },
          { field: 'dates.filed', code: 'format', message: '申请日格式错误' },
        ]}
        loading={false}
        unavailable={false}
        onOpen={onOpen}
      />,
    )
    expect(qa('[data-testid="field-errors"] li')).toHaveLength(2)
    // W12 R3-06：规则 code 不在可见文本，人话 message + 字段名在；code 仅落 data-code
    const applicants = q('[data-testid="field-error-applicants"]')!
    expect(applicants.textContent).toContain('申请人')
    expect(applicants.textContent).toContain('至少一位申请人')
    expect(applicants.textContent).not.toContain('required')
    expect(applicants.dataset.code).toBe('required')
    expect(applicants.querySelector('code')).toBeNull()
    await click(q('[data-testid="field-error-applicants"]'))
    expect(onOpen).toHaveBeenCalledWith('applicants')
    expect(await serious(host)).toEqual([])

    seedPage()
    useStudio.setState({ deliverErrors: [{ field: 'applicants', code: 'required', message: '至少一位申请人' }] })
    const openCaseForm = vi.fn()
    useStudio.setState({ openCaseForm })
    await act(async () => root?.unmount())
    root = null
    await mount(<DeliverPage pid="method" />)
    await click(q('[data-testid="field-error-applicants"]'))
    expect(openCaseForm).toHaveBeenCalledWith('method', 'applicants')
  })
  it('501 / 无错误 → 字段级错误区不渲染', async () => {
    await mount(<FieldErrors errors={[]} loading={false} unavailable onOpen={() => {}} />)
    expect(q('[data-testid="field-errors"]')).toBeNull()
    await act(async () => root!.render(<FieldErrors errors={[]} loading={false} unavailable={false} onOpen={() => {}} />))
    expect(q('[data-testid="field-errors"]')).toBeNull()
  })
})

describe('客户确认徽章（§1.2 A5）', () => {
  it('confirmationState：无确认 → none；最新确认 sha = 当前 → current；≠ → stale', () => {
    expect(confirmationState(undefined, 'abc').kind).toBe('none')
    expect(confirmationState([], 'abc').kind).toBe('none')
    const older = { ...confirmation('abc1234', 2), confirmed_at: 1 }
    const newer = confirmation('def5678', 3)
    expect(confirmationState([older, newer], 'abc1234')).toEqual({ kind: 'stale', confirmation: newer })
    expect(confirmationState([older, newer], 'def5678')).toEqual({ kind: 'current', confirmation: newer })
  })
  it('sha 相同 → success「客户确认 v3」；不同 → warning「确认版本已过期」', async () => {
    await mount(<ConfirmationBadge state={{ kind: 'current', confirmation: confirmation('abc1234') }} />)
    expect(q('[data-testid="confirmation-badge"]')?.dataset.state).toBe('current')
    expect(q('[data-testid="confirmation-badge"]')?.textContent).toContain('客户确认 v3')
    await act(async () => root!.render(<ConfirmationBadge state={{ kind: 'stale', confirmation: confirmation('abc1234') }} />))
    expect(q('[data-testid="confirmation-badge"]')?.dataset.state).toBe('stale')
    expect(q('[data-testid="confirmation-badge"]')?.textContent).toContain('确认版本已过期')
  })
  it('W5 走查 qa-03：进页重拉 case 与版本列（工作台副本陈旧：确认前打开、确认后未刷新）→ 徽章出现；版本列非空也重拉', async () => {
    seedPage()
    const stale = { ...project, case: { ...project.case, confirmations: [] } }
    useStudio.setState({
      project: stale as never,
      versions: [{ sha: 'old0000', at: 0, message: '', author: '', added: 0, removed: 0 }] as never,
      refreshCase: vi.fn(async () => {
        useStudio.setState({ project: project as never })
      }),
      loadHistory: vi.fn(async () => {
        useStudio.setState({ versions: [{ sha: 'abc1234', at: 1, message: '', author: '', added: 0, removed: 0 }] as never })
      }),
    })
    await mount(<DeliverPage pid="method" />)
    expect(useStudio.getState().refreshCase).toHaveBeenCalledWith('method')
    expect(useStudio.getState().loadHistory).toHaveBeenCalledWith('method')
    expect(q('[data-testid="deliver-header"] [data-testid="confirmation-badge"]')?.dataset.state).toBe('current')
    expect(q('[data-testid="confirmation-badge"]')?.textContent).toContain('客户确认 v3')
  })

  it('W5 走查 domain-12：case 变化（递交页上补填申请人保存）→ 字段级错误立即重拉', async () => {
    seedPage()
    await mount(<DeliverPage pid="method" />)
    const load = useStudio.getState().loadDeliverErrors
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () =>
      useStudio.setState({ project: { ...project, case: { ...project.case, applicants: ['甲公司'] } } as never }),
    )
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith('method')
  })

  it('页内：versions[0].sha 变化 → 徽章从 current 变 stale', async () => {
    seedPage()
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="deliver-header"] [data-testid="confirmation-badge"]')?.dataset.state).toBe('current')
    await act(async () => useStudio.setState({ versions: [{ sha: 'ffff999', at: 2, message: '', author: '', added: 1, removed: 0 }] as never }))
    expect(q('[data-testid="confirmation-badge"]')?.dataset.state).toBe('stale')
    expect(q('[data-testid="confirmation-badge"]')?.textContent).toContain('确认版本已过期')
    expect(await serious(host)).toEqual([])
  })
})

describe('R-CHK-07 唯一产物源 + A12 CPC 未验', () => {
  it('ExportGrid.gridEntries 与 store.selectExportEntries 同一函数；页面卡片顺序 = selector 结果', async () => {
    expect(gridEntriesFromGrid).toBe(gridEntries)
    const s = { manifest }
    expect(selectExportEntries(s)).toEqual(gridEntries(manifest))
    seedPage()
    await mount(<DeliverPage pid="method" />)
    const kinds = qa('[data-testid="export-grid"] li[data-slot="ExportItem"]').map((el) => el.dataset.kind!)
    expect(kinds.sort()).toEqual(
      selectExportEntries(useStudio.getState())
        .map((e) => e.kind)
        .sort(),
    )
  })
  it('XML 与递交包卡片带「未经 CPC 客户端验证」；DOCX / PDF 不带', async () => {
    expect([...CPC_BADGE_KINDS].sort()).toEqual(['bundle', 'xml'])
    seedPage()
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="export-item-xml"]')?.textContent).toContain(CPC_UNVERIFIED)
    expect(q('[data-testid="export-item-bundle"]')?.textContent).toContain(CPC_UNVERIFIED)
    expect(q('[data-testid="export-item-docx"]')?.textContent).not.toContain(CPC_UNVERIFIED)
    expect(q('[data-testid="export-item-pdf"]')?.textContent).not.toContain(CPC_UNVERIFIED)
  })
  it('375：产物卡单列全宽；头部按钮只留图标', async () => {
    desktop = false
    seedPage()
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="deliver-mobile"]')).not.toBeNull()
    expect(q('[data-testid="export-grid-items"]')?.className).not.toContain('grid-cols-2')
    expect(q('[data-testid="deliver-settings"] .sr-only')).not.toBeNull()
    expect(await serious(host)).toEqual([])
  })
  it('W8 375：步骤条 ScrollRow（chip sm）；Tab 行可横滑不裁切；产物卡 p-card-m、重新生成/下载 md 等宽 gap-2；底栏 生成递交包 lg + 两 icon-md；正文与底栏留 pb-4；顶栏 back / 首页 sm', async () => {
    desktop = false
    seedPage()
    await mount(<DeliverPage pid="method" />)
    const steps = q('[data-testid="deliver-steps"]')!
    expect(steps.getAttribute('data-slot')).toBe('scroll-row')
    expect(q('[data-testid="deliver-step-1"]')?.className).toContain('h-sm-control')
    const tabs = q('[data-testid="deliver-tabs"]')!
    expect(tabs.className).toContain('overflow-x-auto')
    expect(tabs.className).toContain('px-page-m')
    expect(q('[data-testid="deliver-mobile"] [role="tabpanel"]')?.className).toContain('gap-cards-m')
    expect(q('[data-testid="export-grid-items"]')?.className).toContain('gap-cards-m')
    const item = q('[data-testid="export-item-docx"]')!
    expect(item.className).toContain('p-card-m')
    const actions = q('[data-testid="export-item-actions"]', item)!
    expect(actions.className).toContain('[&>*]:flex-1')
    expect(actions.className).toContain('gap-2')
    for (const b of qa('button', actions)) {
      expect(b.className).toContain('h-md-control')
      expect(b.className).not.toContain('h-lg-control')
    }
    expect(q('[data-testid="export-bundle-run"]')?.className).toContain('h-lg-control')
    expect(q('[data-testid="deliver-settings"]')?.className).toContain('size-md-control')
    expect(q('[data-testid="deliver-file"]')?.className).toContain('size-md-control')
    expect(q('[data-testid="deliver-footer"]')?.className).toContain('h-16')
    expect(q('[data-testid="deliver-body"]')?.className).toContain('pb-4')
    expect(q('[data-testid="deliver-back"]')?.className).toContain('size-sm-control')
    expect(q('[data-testid="deliver-home"]')?.className).toContain('h-sm-control')
    expect(await serious(host)).toEqual([])
  })
  it('W8 1440：桌面不变——非滚动步骤条、产物行 px-4 py-2 + sm 按钮、底栏 lg、首页链接 md', async () => {
    seedPage()
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="deliver-steps"]')?.getAttribute('data-slot')).toBeNull()
    expect(q('[data-testid="deliver-tabs"]')).toBeNull()
    const item = q('[data-testid="export-item-docx"]')!
    expect(item.className).toContain('px-4')
    expect(item.className).not.toContain('p-card-m')
    expect(q('[data-testid="export-regen-docx"]')?.className).toContain('h-sm-control')
    expect(q('[data-testid="deliver-settings"]')?.className).toContain('h-lg-control')
    expect(q('[data-testid="deliver-back"]')?.className).toContain('size-md-control')
    expect(q('[data-testid="deliver-home"]')?.className).toContain('h-md-control')
    expect(q('[data-testid="deliver-footer"]')).toBeNull()
    expect(q('[data-testid="deliver-body"]')?.className).toContain('pb-6')
  })
})

describe('deliver/errors 501', () => {
  it('store.loadDeliverErrors 收到 501 → deliverErrorsUnavailable，页面不渲染字段错误区', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ kind: 'not_implemented', detail: 'deliver-errors' }), { status: 501, headers: { 'Content-Type': 'application/json' } }),
    )
    useStudio.setState({ pid: 'method' })
    await useStudio.getState().loadDeliverErrors('method')
    expect(useStudio.getState().deliverErrorsUnavailable).toBe(true)
    expect(useStudio.getState().deliverErrorsLoading).toBe(false)
    seedPage()
    useStudio.setState({ deliverErrorsUnavailable: true })
    await mount(<DeliverPage pid="method" />)
    expect(q('[data-testid="field-errors"]')).toBeNull()
    expect(q('[data-testid="deliver-error"]')).toBeNull()
  })
})

describe('XmlReport DTD 徽章按实际文书数计（W12 R5 旁支）', () => {
  const book = (code: string, valid = true): XmlBook =>
    ({ code, name: '', file: `${code}.xml`, valid, errors: valid ? [] : ['x'], images: [], xml_url: '/x', preview_url: '/p' }) as XmlBook
  it('无说明书附图 → 4 书全过：徽章 4/4，不再写死 5/5', async () => {
    const res = { status: 'ok', valid: true, zip_url: '/z.zip', warnings: [], books: ['100001', '100002', '100004', '100005'].map((c) => book(c)) } as never
    const el = await mount(<XmlReport res={res} err={null} at={null} embedded />)
    expect(q('[data-testid="xml-valid"]', el)?.textContent).toContain('4/4')
    expect(q('[data-testid="xml-valid"]', el)?.textContent).not.toContain('5/5')
    expect(el.querySelectorAll('[data-testid^="xml-book-"]')).toHaveLength(4)
  })
  it('5 书 1 书未通过：徽章 1/5 书未通过', async () => {
    const res = { status: 'ok', valid: false, zip_url: null, warnings: [], books: ['100001', '100002', '100003', '100004', '100005'].map((c) => book(c, c !== '100002')) } as never
    const el = await mount(<XmlReport res={res} err={null} at={null} embedded />)
    expect(q('[data-testid="xml-valid"]', el)?.textContent).toContain('1/5 书未通过')
  })
})

describe('DeliverSteps（qa-05）', () => {
  const steps = [
    { label: '体检', hint: '', state: 'done' as const },
    { label: '生成产物', hint: '', state: 'active' as const },
    { label: '打包递交', hint: '', state: 'todo' as const },
    { label: '标记已递交', hint: '', state: 'todo' as const },
  ]
  it('375 compact 横滑 <ol> 可键盘聚焦（tabIndex=0 + focus ring），1440 非滚动不占 tab 位', async () => {
    await mount(<DeliverSteps steps={steps} compact />)
    const ol = q<HTMLOListElement>('[data-testid="deliver-steps"]')!
    expect(ol.className).toContain('overflow-x-auto')
    expect(ol.tabIndex).toBe(0)
    expect(ol.className).toContain('focus-visible:outline-2')
    await act(async () => root!.unmount())
    root = null
    await mount(<DeliverSteps steps={steps} />)
    expect(q<HTMLOListElement>('[data-testid="deliver-steps"]')!.hasAttribute('tabindex')).toBe(false)
  })
})

