// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { MobilePage, MobilePageSection } from '@/components/ui/mobile-page'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { touchHit } from '@/lib/utils'

/**
 * W8 触控四档（06 §2）：jsdom 无布局，按 class 断言——
 *  ① 视觉高度 class = 档位 token（h-xs/sm/md/lg-control · h-touch · h-full 随容器），触控值由 index.css [data-density=touch] 决定：28/32/36/44；
 *  ② 视觉 < 44 的可点原语带 `touch-hit`（index.css @utility：touch 后代 ::after 扩到 max(100%,44)）；
 *  ③ Checkbox / Switch 保留 after:-inset-* 写法（mobile.touch-hotzone.test 已验 46 / 44）。
 * 真实像素由 docs/archive/design-system/w8-mobile/capture/measure-touch.mjs（Playwright，375）量。
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
  Element.prototype.scrollIntoView ??= () => {}
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  host.dataset.density = 'touch'
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const cls = (el: Element | null) => el?.className ?? ''

describe('W8 触控四档：视觉按档 + touch-hit 命中区', () => {
  it('touchHit 常量 = index.css @utility 名', () => {
    expect(touchHit).toBe('touch-hit')
  })

  it('Button：xs/sm/md/lg/xl 视觉 class 按档，全部带 touch-hit + relative', async () => {
    const h = await mount(
      <>
        <Button size="xs" data-testid="xs">xs</Button>
        <Button size="sm" data-testid="sm">sm</Button>
        <Button size="md" data-testid="md">md</Button>
        <Button size="lg" data-testid="lg">lg</Button>
        <Button size="xl" data-testid="xl">xl</Button>
      </>,
    )
    const want: Record<string, string> = { xs: 'h-xs-control', sm: 'h-sm-control', md: 'h-md-control', lg: 'h-lg-control', xl: 'h-touch' }
    for (const [id, hc] of Object.entries(want)) {
      const c = cls(h.querySelector(`[data-testid=${id}]`))
      expect(c, id).toContain(hc)
      expect(c, id).toContain('touch-hit')
      expect(c, id).toContain('relative')
    }
  })

  it('Toggle / ToggleGroupItem：sm 32 / md 36 / lg 44 视觉 + touch-hit', async () => {
    const h = await mount(
      <>
        <Toggle size="sm" data-testid="t-sm">a</Toggle>
        <Toggle size="lg" data-testid="t-lg">b</Toggle>
        <ToggleGroup type="single" size="md" aria-label="g">
          <ToggleGroupItem value="x" data-testid="tg">x</ToggleGroupItem>
        </ToggleGroup>
      </>,
    )
    expect(cls(h.querySelector('[data-testid=t-sm]'))).toMatch(/h-sm-control.*touch-hit|touch-hit.*h-sm-control/)
    expect(cls(h.querySelector('[data-testid=t-lg]'))).toContain('h-lg-control')
    const tg = cls(h.querySelector('[data-testid=tg]'))
    expect(tg).toContain('h-md-control')
    expect(tg).toContain('touch-hit')
  })

  it('Tabs trigger（underline 44 面板头 / pill md 36）带 touch-hit', async () => {
    const h = await mount(
      <>
        <Tabs defaultValue="a"><TabsList aria-label="u"><TabsTrigger value="a" data-testid="u">A</TabsTrigger></TabsList></Tabs>
        <Tabs defaultValue="a"><TabsList variant="pill" aria-label="p"><TabsTrigger value="a" data-testid="p">A</TabsTrigger></TabsList></Tabs>
      </>,
    )
    expect(cls(h.querySelector('[data-testid=u]'))).toContain('touch-hit')
    expect(cls(h.querySelector('[data-testid=p]'))).toContain('touch-hit')
    expect(cls(h.querySelector('[data-testid=u]')?.closest('[data-slot=tabs-list]') ?? null)).toContain('h-panel-header')
    expect(cls(h.querySelector('[data-testid=p]')?.closest('[data-slot=tabs-list]') ?? null)).toContain('h-md-control')
  })

  it('Segmented item：md 容器 h-md-control（触控 36）/ xl h-touch；item h-full + touch-hit', async () => {
    const h = await mount(
      <>
        <Segmented aria-label="m" value="a" onValueChange={() => {}} options={[{ value: 'a', label: 'A', 'data-testid': 'sm' }, { value: 'b', label: 'B' }]} />
        <Segmented size="xl" aria-label="x" value="a" onValueChange={() => {}} options={[{ value: 'a', label: 'A', 'data-testid': 'sx' }, { value: 'b', label: 'B' }]} />
      </>,
    )
    const item = h.querySelector('[data-testid=sm]')!
    expect(cls(item)).toContain('h-full')
    expect(cls(item)).toContain('touch-hit')
    expect(cls(item.closest('[role=radiogroup]'))).toContain('h-md-control')
    expect(cls(h.querySelector('[data-testid=sx]')?.closest('[role=radiogroup]') ?? null)).toContain('h-touch')
  })

  it('Select trigger / Input：触控一律 lg 44（in-data-[density=touch]:h-lg-control）；Select 另带 touch-hit', async () => {
    const h = await mount(
      <>
        <Select><SelectTrigger size="sm" aria-label="s" data-testid="sel"><SelectValue placeholder="x" /></SelectTrigger></Select>
        <Input size="sm" aria-label="i" data-testid="inp" />
      </>,
    )
    const s = cls(h.querySelector('[data-testid=sel]'))
    expect(s).toContain('in-data-[density=touch]:h-lg-control')
    expect(s).toContain('touch-hit')
    expect(cls(h.querySelector('[data-testid=inp]'))).toContain('in-data-[density=touch]:h-lg-control')
  })

  it('Tag：可删 / 可点 → 触控视觉 h-6 + touch-hit（× 也带）；纯展示不加', async () => {
    const h = await mount(
      <>
        <Tag onRemove={() => {}} data-testid="rm">a</Tag>
        <Tag onClick={() => {}} data-testid="ck">b</Tag>
        <Tag data-testid="plain">c</Tag>
      </>,
    )
    expect(cls(h.querySelector('[data-testid=rm]'))).toContain('touch-hit')
    expect(cls(h.querySelector('[data-testid=rm]'))).toContain('in-data-[density=touch]:h-6')
    expect(cls(h.querySelector('[data-testid=rm] [data-slot=tag-remove]'))).toContain('touch-hit')
    expect(cls(h.querySelector('[data-testid=ck]'))).toContain('touch-hit')
    expect(cls(h.querySelector('[data-testid=plain]'))).not.toContain('touch-hit')
  })

  it('Dropdown item：触控 min-h-row-menu（44）+ touch-hit', async () => {
    const h = await mount(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild><button type="button">m</button></DropdownMenuTrigger>
        <DropdownMenuContent><DropdownMenuItem data-testid="mi">项</DropdownMenuItem></DropdownMenuContent>
      </DropdownMenu>,
    )
    const mi = document.body.querySelector('[data-testid=mi]') ?? h.querySelector('[data-testid=mi]')
    expect(cls(mi)).toContain('in-data-[density=touch]:min-h-row-menu')
    expect(cls(mi)).toContain('touch-hit')
  })

  it('Checkbox / Switch：保留 after:-inset 伪元素热区（16 / 20 视觉不变）', async () => {
    const h = await mount(
      <>
        <Checkbox aria-label="c" data-testid="cb" />
        <Switch aria-label="s" data-testid="sw" />
      </>,
    )
    expect(cls(h.querySelector('[data-testid=cb]'))).toContain('in-data-[density=touch]:after:-inset-4')
    expect(cls(h.querySelector('[data-testid=sw]'))).toContain('in-data-[density=touch]:after:-inset-3.5')
  })
})

describe('W8 版式原语：MobilePage / ScrollRow（06 §3）', () => {
  it('MobilePage：px-page-m · gap-section-m · 底部 Tab bar + safe-area 让位；tabbar=false 只留页边', async () => {
    const h = await mount(
      <>
        <MobilePage data-testid="mp"><MobilePageSection title="区块" data-testid="sec">x</MobilePageSection></MobilePage>
        <MobilePage tabbar={false} data-testid="mp2">y</MobilePage>
      </>,
    )
    const mp = cls(h.querySelector('[data-testid=mp]'))
    expect(mp).toContain('px-page-m')
    expect(mp).toContain('gap-section-m')
    expect(mp).toContain('pb-[calc(var(--h-mobile-tabs)+var(--pad-page-m)+env(safe-area-inset-bottom))]')
    expect(cls(h.querySelector('[data-testid=mp2]'))).toContain('pb-[calc(var(--pad-page-m)+env(safe-area-inset-bottom))]')
    expect(cls(h.querySelector('[data-testid=sec]'))).toContain('gap-group-m')
    expect(h.querySelector('[data-testid=sec] h2')?.textContent).toBe('区块')
  })

  it('ScrollRow：overflow-x-auto · scrollbar-none · 首末 px-page-m · gap-group-m · 出血 -mx-page-m · tabIndex=0 · ← → 滚动', async () => {
    const h = await mount(
      <ScrollRow aria-label="筛选" data-testid="row"><button type="button">a</button><button type="button">b</button></ScrollRow>,
    )
    const row = h.querySelector<HTMLDivElement>('[data-testid=row]')!
    const c = cls(row)
    for (const k of ['overflow-x-auto', 'scrollbar-none', 'px-page-m', 'gap-group-m', '-mx-page-m', 'py-2']) expect(c).toContain(k)
    expect(c).not.toContain('overflow-hidden')
    expect(row.tabIndex).toBe(0)
    let scrolled = 0
    row.scrollBy = ((o: ScrollToOptions) => { scrolled += o.left ?? 0 }) as typeof row.scrollBy
    Object.defineProperty(row, 'clientWidth', { value: 300 })
    await act(async () => {
      row.focus()
      row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(scrolled).toBe(180)
  })
})

/** R82-01：portal 浮层脱出壳的 data-density 祖先链——Content 原语在非桌面断点自动补 touch，桌面不补。 */
describe('R82-01：Sheet/Dialog/Dropdown/Select/Popover 非桌面自动补 data-density', () => {
  async function mountPortal(el: ReactElement) {
    const h = document.createElement('div')
    document.body.appendChild(h)
    const r = createRoot(h)
    await act(async () => r.render(el))
    return h
  }
  afterEach(() => {
    for (const el of document.body.querySelectorAll('[data-slot$="-content"], [data-slot=popover-content]')) el.remove()
  })

  const portals = (
    <>
      <Sheet open><SheetContent side="bottom" data-testid="sh">x</SheetContent></Sheet>
      <Dialog open><DialogContent data-testid="dl">x</DialogContent></Dialog>
      <DropdownMenu open><DropdownMenuTrigger>t</DropdownMenuTrigger><DropdownMenuContent data-testid="dd"><DropdownMenuItem>i</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <Select open><SelectTrigger><SelectValue /></SelectTrigger><SelectContent data-testid="se"><SelectItem value="a">a</SelectItem></SelectContent></Select>
      <Popover open><PopoverTrigger><button type="button">t</button></PopoverTrigger><PopoverContent data-testid="po">x</PopoverContent></Popover>
    </>
  )
  const ids = ['sh', 'dl', 'dd', 'se', 'po']

  it('非桌面（matchMedia false）：五个 portal 面都带 data-density=touch', async () => {
    await mountPortal(portals)
    for (const id of ids) {
      const el = document.body.querySelector(`[data-testid=${id}]`)
      expect(el, id).not.toBeNull()
      expect(el!.getAttribute('data-density'), id).toBe('touch')
    }
  })

  it('桌面（matchMedia true）：不注入，调用方显式值仍优先', async () => {
    const orig = window.matchMedia
    window.matchMedia = (q: string) =>
      ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
    try {
      await mountPortal(
        <>
          <Sheet open><SheetContent side="right" data-testid="sh2">x</SheetContent></Sheet>
          <Sheet open><SheetContent side="right" data-testid="sh3" data-density="touch">x</SheetContent></Sheet>
        </>,
      )
      expect(document.body.querySelector('[data-testid=sh2]')?.hasAttribute('data-density')).toBe(false)
      expect(document.body.querySelector('[data-testid=sh3]')?.getAttribute('data-density')).toBe('touch')
    } finally {
      window.matchMedia = orig
    }
  })
})
