// @vitest-environment jsdom
import axe from 'axe-core'
import { act, useLayoutEffect, useRef, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Button, SplitButton } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CompanionPanel, clampCompanionWidth } from '@/components/ui/companion-panel'
import { Count } from '@/components/ui/count'
import { Countdown } from '@/components/ui/countdown'
import { DropdownMenuItem } from '@/components/ui/dropdown'
import { EmptyState } from '@/components/ui/empty-state'
import { Heat, heatOf } from '@/components/ui/heat'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Segmented } from '@/components/ui/segmented'
import { StatusDot } from '@/components/ui/status-dot'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import { Textarea } from '@/components/ui/textarea'
import { CASE_STATUSES } from '@/types/case'
import { FileText } from 'lucide-react'

/**
 * W6 prep 原语冒烟（05 §2）：尺寸档 class / 状态属性 / 键盘 / axe（jsdom 只守 ARIA 结构类规则）。
 * 真实浏览器像素与对比度见 testing skill + check-contrast.test.ts。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

async function violations(el: Element) {
  const res = await axe.run(el, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, 'scrollable-region-focusable': { enabled: false }, region: { enabled: false } },
  })
  return res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

const q = <T extends Element = HTMLElement>(sel: string, el: ParentNode = document) => el.querySelector<T>(sel)

describe('Button 5 档 × 6 变体 + SplitButton', () => {
  it('xs/sm/md/lg/xl → h-xs/h-sm/h-md/h-lg/h-touch；无 h-10；loading 置 aria-busy；axe 0', async () => {
    const el = await mount(
      <div>
        <Button size="xs">xs</Button>
        <Button size="sm">sm</Button>
        <Button size="md">md</Button>
        <Button size="lg">lg</Button>
        <Button size="xl">xl</Button>
        <Button variant="secondary">二级</Button>
        <Button variant="soft">柔和</Button>
        <Button variant="ghost">幽灵</Button>
        <Button variant="danger">危险</Button>
        <Button variant="link">链接</Button>
        <Button loading data-testid="loading">加载</Button>
        <Button size="icon" aria-label="图标"><FileText /></Button>
      </div>,
    )
    const cls = [...el.querySelectorAll('button')].map((b) => b.className)
    expect(cls[0]).toContain('h-xs-control')
    expect(cls[1]).toContain('h-sm-control')
    expect(cls[2]).toContain('h-md-control')
    expect(cls[3]).toContain('h-lg-control')
    expect(cls[4]).toContain('h-touch')
    expect(cls.some((c) => /\bh-10\b/.test(c))).toBe(false)
    expect(q('[data-testid="loading"]', el)?.getAttribute('aria-busy')).toBe('true')
    expect(await violations(el)).toEqual([])
  })

  it('SplitButton：主按钮 + 独立下拉触发（aria-label），同一 variant；axe 0', async () => {
    const el = await mount(
      <SplitButton data-testid="build" menu={<DropdownMenuItem>导出 DOCX</DropdownMenuItem>} menuLabel="更多构建操作">
        构建
      </SplitButton>,
    )
    const wrap = q('[data-testid="build"]', el)!
    expect(wrap.dataset.variant).toBe('primary')
    expect(q('[data-slot="split-button-main"]', wrap)?.textContent).toBe('构建')
    expect(q('[data-slot="split-button-trigger"]', wrap)?.getAttribute('aria-label')).toBe('更多构建操作')
    expect(await violations(el)).toEqual([])
  })
})

describe('Input / Textarea 4 档', () => {
  it('sm/md/lg/xl → 28/32/36/44；xl 16px 字；aria-invalid 透传；axe 0', async () => {
    const el = await mount(
      <div>
        <Input aria-label="a" size="sm" />
        <Input aria-label="b" size="md" />
        <Input aria-label="c" size="lg" />
        <Input aria-label="d" size="xl" />
        <Input aria-label="e" aria-invalid data-testid="bad" />
        <Textarea aria-label="f" />
      </div>,
    )
    const cls = [...el.querySelectorAll('input')].map((i) => i.className)
    expect(cls[0]).toContain('h-sm-control')
    expect(cls[1]).toContain('h-md-control')
    expect(cls[2]).toContain('h-lg-control')
    expect(cls[3]).toContain('h-touch')
    expect(cls[3]).toContain('text-lg')
    expect(q('[data-testid="bad"]', el)?.getAttribute('aria-invalid')).toBe('true')
    expect(await violations(el)).toEqual([])
  })
})

describe('Segmented（radiogroup，md 32 / xl 44）', () => {
  it('←/→/Home/End 切换；sm/lg 兼容输入映射为 md；axe 0', async () => {
    const onChange = vi.fn()
    const el = await mount(
      <div>
        <Segmented aria-label="视图" value="a" onValueChange={onChange} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]} data-testid="seg" />
        <Segmented aria-label="旧" size="lg" value="a" onValueChange={() => {}} options={[{ value: 'a', label: 'A' }]} data-testid="legacy" />
        <Segmented aria-label="触控" size="xl" value="a" onValueChange={() => {}} options={[{ value: 'a', label: 'A' }]} data-testid="xl" />
      </div>,
    )
    const seg = q('[data-testid="seg"]', el)!
    expect(seg.getAttribute('role')).toBe('radiogroup')
    expect(seg.className).toContain('h-md-control')
    expect([...seg.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    await act(async () => seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('b')
    await act(async () => seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('c')
    await act(async () => seg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith('c')
    expect(q('[data-testid="legacy"]', el)?.dataset.size).toBe('md')
    expect(q('[data-testid="xl"]', el)?.className).toContain('h-touch')
    expect(await violations(el)).toEqual([])
  })
})

describe('Tabs 下划线式', () => {
  it('默认 variant=underline（非胶囊）；激活项 border-primary；axe 0', async () => {
    const el = await mount(
      <Tabs defaultValue="a">
        <TabsList aria-label="面板">
          <TabsTrigger value="a">源码</TabsTrigger>
          <TabsTrigger value="b">版面</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A</TabsContent>
        <TabsContent value="b">B</TabsContent>
      </Tabs>,
    )
    const list = q('[data-slot="tabs-list"]', el)!
    expect(list.dataset.variant).toBe('underline')
    expect(list.className).not.toContain('rounded-full')
    expect(q('[data-state="active"][data-slot="tabs-trigger"]', el)?.className).toContain('border-primary')
    expect(await violations(el)).toEqual([])
  })
})

describe('Badge / Tag / Count 拆三', () => {
  it('Badge tone → data-tone；Tag 色点不染底 + 可移除；Count 0 隐藏 / 99+；axe 0', async () => {
    const onRemove = vi.fn()
    const el = await mount(
      <div>
        <Badge tone="warn">警告</Badge>
        <Badge tone="danger" data-testid="legacy">旧</Badge>
        <Tag color="var(--info-dot)" onRemove={onRemove} data-testid="tag">机械</Tag>
        <Count value={0} data-testid="zero" />
        <Count value={120} data-testid="big" />
        <Count value={3} tone="brand" data-testid="brand" />
      </div>,
    )
    expect(q('[data-slot="badge"]', el)?.dataset.tone).toBe('warn')
    expect(q('[data-testid="legacy"]', el)?.dataset.tone).toBe('danger')
    const tag = q('[data-testid="tag"]', el)!
    expect(tag.className).not.toContain('rounded-full')
    expect(q('[data-slot="tag-dot"]', tag)).not.toBeNull()
    await act(async () => q('[data-slot="tag-remove"]', tag)!.click())
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="zero"]', el)).toBeNull()
    expect(q('[data-testid="big"]', el)?.textContent).toBe('99+')
    expect(q('[data-testid="brand"]', el)?.dataset.tone).toBe('brand')
    expect(await violations(el)).toEqual([])
  })
})

describe('StatusDot（点 + 文字，禁 dotOnly）', () => {
  it('十档 data-status + 中文文字 + 色点；badge 变体为 pill 底；axe 0', async () => {
    const el = await mount(
      <div>
        {CASE_STATUSES.map((s) => <StatusDot key={s} status={s} />)}
        <StatusDot variant="badge" status="review" data-testid="legacy" />
      </div>,
    )
    const dots = [...el.querySelectorAll('[data-slot="status-dot"]')]
    expect(dots.map((d) => d.getAttribute('data-status'))).toEqual([...CASE_STATUSES, 'review'])
    for (const d of dots) {
      expect(d.querySelector('[data-slot="status-dot-mark"]')).not.toBeNull()
      expect(d.textContent?.trim().length).toBeGreaterThan(0)
    }
    const legacy = q('[data-testid="legacy"]', el)!
    expect(legacy.dataset.variant).toBe('badge')
    expect(legacy.dataset.status).toBe('review')
    expect(legacy.textContent).toBe('内审')
    expect(await violations(el)).toEqual([])
  })
})

describe('Heat / Countdown 3 档', () => {
  it('heatOf：>30 → 0；7<d≤30 → 1；≤7 / 逾期 → 2；Countdown 文案 剩 / 逾期 / 今天；axe 0', async () => {
    expect(heatOf(31)).toBe(0)
    expect(heatOf(30)).toBe(1)
    expect(heatOf(8)).toBe(1)
    expect(heatOf(7)).toBe(2)
    expect(heatOf(0)).toBe(2)
    expect(heatOf(-3)).toBe(2)
    expect(heatOf(null)).toBe(0)
    const el = await mount(
      <div>
        <Heat daysLeft={45} data-testid="h0" />
        <Heat daysLeft={12} data-testid="h1" />
        <Countdown daysLeft={12} data-testid="c1" />
        <Countdown daysLeft={-2} data-testid="c2" />
        <Countdown daysLeft={0} size="lg" data-testid="c0" />
      </div>,
    )
    expect(q('[data-testid="h0"]', el)?.dataset.heat).toBe('0')
    expect(q('[data-testid="h1"]', el)?.dataset.heat).toBe('1')
    expect(q('[data-testid="c1"]', el)?.textContent).toBe('剩 12 天')
    expect(q('[data-testid="c1"]', el)?.dataset.heat).toBe('1')
    expect(q('[data-testid="c2"]', el)?.textContent).toBe('逾期 2 天')
    expect(q('[data-testid="c2"]', el)?.dataset.heat).toBe('2')
    expect(q('[data-testid="c0"]', el)?.textContent).toBe('今天')
    expect(await violations(el)).toEqual([])
  })
})

describe('EmptyState / PageHeader', () => {
  it('EmptyState：56 容器 + 32 图标（size-14 / size-8）+ 一个次要动作；PageHeader：h1 + primary 插槽；axe 0', async () => {
    const el = await mount(
      <div>
        <EmptyState icon={FileText} title="暂无案件" reason="导入或新建一个案卷开始" action={<Button variant="secondary">新建</Button>} data-testid="empty" />
        <PageHeader title="案件台账" description="全部案卷" primary={<Button>新建案件</Button>} actions={<Button variant="ghost">导出</Button>} data-testid="ph" />
      </div>,
    )
    const empty = q('[data-testid="empty"]', el)!
    const iconBox = q('[data-slot="empty-state-icon"]', empty)!
    expect(iconBox.className).toContain('size-14')
    expect(iconBox.className).toContain('rounded-xl')
    expect(iconBox.querySelector("svg")?.getAttribute("class")).toContain("size-8")
    expect(q('h1', el)?.textContent).toBe('案件台账')
    expect(q('[data-slot="page-header-actions"]', el)?.querySelectorAll('button').length).toBe(2)
    expect(await violations(el)).toEqual([])
  })

  it('EmptyState illustration：给则替换图标芯片且仅 md 生效（VI V3 雕线空态）', async () => {
    const el = await mount(
      <div>
        <EmptyState illustration="/empty-dossier.webp" icon={FileText} title="暂无案件" data-testid="e-ill" />
        <EmptyState illustration="/x.webp" icon={FileText} title="小" size="sm" data-testid="e-ill-sm" />
      </div>,
    )
    const md = q('[data-testid="e-ill"]', el)!
    expect(q('[data-slot="empty-state-illustration"]', md)?.getAttribute('src')).toBe('/empty-dossier.webp')
    expect(q('[data-slot="empty-state-icon"]', md)).toBeNull()
    const sm = q('[data-testid="e-ill-sm"]', el)!
    expect(q('[data-slot="empty-state-illustration"]', sm)).toBeNull()
    expect(q('[data-slot="empty-state-icon"]', sm)).not.toBeNull()
  })
})

describe('CompanionPanel 壳', () => {
  it('clamp 320–480；column：aside + 拖拽把手 + 关闭；id=null 不渲染；键盘 ←/→ 调宽；axe 0', async () => {
    expect(clampCompanionWidth(100)).toBe(320)
    expect(clampCompanionWidth(999)).toBe(480)
    expect(clampCompanionWidth(360.4)).toBe(360)
    const onClose = vi.fn()
    const onWidth = vi.fn()
    const el = await mount(
      <div>
        <CompanionPanel id="ai" title="AI 助手" onClose={onClose} width={360} onWidthChange={onWidth} data-testid="cp">
          内容
        </CompanionPanel>
        <CompanionPanel id={null} title="隐藏" onClose={() => {}} data-testid="hidden" />
      </div>,
    )
    const cp = q('[data-testid="cp"]', el)!
    expect(cp.tagName).toBe('ASIDE')
    expect(q('[data-testid="hidden"]', el)).toBeNull()
    expect(q('[data-slot="companion-title"]', cp)?.textContent).toBe('AI 助手')
    const handle = q('[data-slot="companion-resize"]', cp)!
    expect(handle.getAttribute('role')).toBe('separator')
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    expect(onWidth).toHaveBeenLastCalledWith(376)
    await act(async () => q('[data-slot="companion-close"]', cp)!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await violations(el)).toEqual([])
  })
})

describe('Popover 打开时的焦点接管（W7 ux-01 / qa-04）', () => {
  function SelfFocusing() {
    const ref = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => ref.current?.focus(), [])
    return <div ref={ref} tabIndex={0} data-testid="self" />
  }

  it('子元素挂载时已自行聚焦 → Content 不再把焦点抢到首个 <button>', async () => {
    await mount(
      <Popover open>
        <PopoverTrigger>
          <button type="button">开</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button">取消</button>
          <SelfFocusing />
        </PopoverContent>
      </Popover>,
    )
    expect(document.activeElement).toBe(q('[data-testid="self"]'))
  })

  it('无人聚焦时跳过 tabindex=-1 / disabled 的按钮，contenteditable 也算可聚焦', async () => {
    await mount(
      <Popover open>
        <PopoverTrigger>
          <button type="button">开</button>
        </PopoverTrigger>
        <PopoverContent>
          <button type="button" tabIndex={-1}>工具</button>
          <button type="button" disabled>灰</button>
          <div contentEditable="true" tabIndex={0} data-testid="ce" suppressContentEditableWarning />
          <button type="button">取消</button>
        </PopoverContent>
      </Popover>,
    )
    expect(document.activeElement).toBe(q('[data-testid="ce"]'))
  })
})
