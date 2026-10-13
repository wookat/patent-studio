import { useEffect, useState } from 'react'
import { Bot, ChevronDown, Construction, Download, FileText, Hammer, History, Info, MessageSquareText, Moon, Plus, Search, Sun, TriangleAlert } from 'lucide-react'
import { PageChrome } from '@/components/shell/PageChrome'
import { COMPANION_META } from '@/components/shell/CompanionHost'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarGroup } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button, SplitButton } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CompanionPanel } from '@/components/ui/companion-panel'
import { Count } from '@/components/ui/count'
import { Countdown } from '@/components/ui/countdown'
import { DataTable, type ColumnDef } from '@/components/ui/data-table'
import { DropdownMenuItem } from '@/components/ui/dropdown'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Heat } from '@/components/ui/heat'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { MobilePage, MobilePageSection } from '@/components/ui/mobile-page'
import { PageHeader } from '@/components/ui/page-header'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollRow } from '@/components/ui/scroll-row'
import { Segmented } from '@/components/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tag } from '@/components/ui/tag'
import { Textarea } from '@/components/ui/textarea'
import { Toast } from '@/components/ui/toast'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks/useMisc'
import { parseHash } from '@/lib/hash'
import { COMPANION_IDS, isCompanionId, useStudio } from '@/store'
import { CASE_STATUSES, type CaseStatus } from '@/types/case'

/**
 * `#/__ds` 设计系统展示页（05 §5 prep ④）：规格总表（原始灰阶 / 四层面 / 语义族 / 字阶 / 尺寸档 / 圆角 / 阴影）
 * + components/ui 全部原语（尺寸变体 × 状态）+ 复合组件占位 + CompanionPanel 骨架演示，亮暗切换。
 * 这是 8 个单元的对照面：单元页面上的任何视觉都应能在这里找到出处；找不到 → integration_request，不要自造。
 * 开发 / 走查用（shots / axe 都会截它）；不进主包（App lazy）。不接任何后端。
 */

const GRAYS = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11'] as const
const SURFACES = ['bg-app', 'bg-panel', 'bg-sunken', 'bg-elevated', 'bg-hover', 'bg-active', 'bg-selected', 'paper', 'paper-canvas', 'border', 'border-strong', 'ring'] as const
const FGS = ['fg-strong', 'fg', 'fg-muted', 'fg-subtle', 'fg-disabled', 'fg-icon', 'link', 'primary', 'primary-hover', 'primary-active', 'primary-soft', 'fg-on-brand'] as const
/* 字面量类名（Tailwind 只扫描源码里出现过的 class） */
const FAMILIES: [string, string, string][] = [
  ['info', 'bg-info-bg text-info-fg', 'bg-info-dot'],
  ['ok', 'bg-ok-bg text-ok-fg', 'bg-ok-dot'],
  ['warn', 'bg-warn-bg text-warn-fg', 'bg-warn-dot'],
  ['danger', 'bg-danger-bg text-danger-fg', 'bg-danger-dot'],
  ['violet', 'bg-violet-bg text-violet-fg', 'bg-violet-dot'],
  ['teal', 'bg-teal-bg text-teal-fg', 'bg-teal-dot'],
  ['orange', 'bg-orange-bg text-orange-fg', 'bg-orange-dot'],
]
const TEXT_SIZES: [string, string, string][] = [
  ['2xs', '11 / 16', 'text-2xs'], ['xs', '12 / 18', 'text-xs'], ['sm', '13 / 20', 'text-sm'], ['base', '14 / 22 · 基准', 'text-base'],
  ['lg', '16 / 24', 'text-lg'], ['xl', '20 / 28', 'text-xl'], ['2xl', '24 / 32 · 紧凑 H1', 'text-2xl'], ['3xl', '28 / 36 · 页 H1', 'text-3xl'],
]
const CONTROL_HEIGHTS: [string, string, string][] = [
  ['xs', '24', 'h-xs-control'], ['sm', '28', 'h-sm-control'], ['md', '32', 'h-md-control'], ['lg', '36', 'h-lg-control'], ['xl / touch', '44', 'h-touch'],
]
const SHELL_DIMS: [string, string][] = [
  ['--h-topbar 40', 'h-topbar'], ['--h-statusbar 24', 'h-statusbar'], ['--w-rail 40', 'h-rail'], ['--h-panel-header 32', 'h-panel-header'],
  ['--h-pdftb 32', 'h-pdftb'], ['--row-h 40', 'h-row'], ['--row-h-compact 36', 'h-row-compact'], ['--row-h-mobile 48', 'h-row-mobile'],
]
const RADII: [string, string][] = [['xs 3', 'rounded-xs'], ['sm 4', 'rounded-sm'], ['md 6', 'rounded-md'], ['lg 8', 'rounded-lg'], ['xl 12', 'rounded-xl'], ['full', 'rounded-full']]
const SHADOWS: [string, string][] = [['sm · 卡/表/浮条', 'shadow-sm'], ['md · 菜单/popover', 'shadow-md'], ['lg · 对话框/Sheet', 'shadow-lg'], ['paper · 纸面', 'shadow-paper']]
const HEAT_DAYS = [45, 20, 3, 0, -4, null] as const

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`ds-${id}`} className="grid gap-3" data-testid={`ds-${id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`ds-${id}`} className="text-lg font-semibold text-fg-strong">{title}</h2>
        {hint && <span className="text-xs text-fg-muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Swatch({ name, tall }: { name: string; tall?: boolean }) {
  return (
    <div className="grid gap-1 text-2xs" title={`var(--${name})`}>
      <div className={`${tall ? 'h-row' : 'h-lg-control'} rounded-sm border border-border`} style={{ background: `var(--${name})` }} />
      <span className="truncate font-mono text-fg-muted">--{name}</span>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-fg-muted">{children}</span>
}

type Row = { id: string; title: string; status: CaseStatus; owner: string; days: number | null }
const ROWS: Row[] = CASE_STATUSES.map((s, i) => ({ id: `c${i + 1}`, title: `示例案卷 ${i + 1} · 一种基于 ${['图像', '语音', '区块链'][i % 3]}的方法`, status: s, owner: ['张三', '李四', '王五'][i % 3], days: [45, 20, 3, -4, 12, 90, 7, null, 30, 1][i] }))
const COLS: ColumnDef<Row>[] = [
  { accessorKey: 'title', header: '标题' },
  { accessorKey: 'status', header: '状态', cell: ({ row }) => <StatusDot status={row.original.status} /> },
  { accessorKey: 'owner', header: '负责人' },
  { accessorKey: 'days', header: '期限', cell: ({ row }) => <Heat daysLeft={row.original.days} /> },
]

/** CompanionPanel 骨架演示：读写真实 store（companion / companionWidth）+ hash ?panel=；<768 转 Sheet（右）/ <640 底部 */
function CompanionDemo() {
  const companion = useStudio((s) => s.companion)
  const width = useStudio((s) => s.companionWidth)
  const toggleCompanion = useStudio((s) => s.toggleCompanion)
  const closeCompanion = useStudio((s) => s.closeCompanion)
  const setCompanionWidth = useStudio((s) => s.setCompanionWidth)
  const md = useMediaQuery('(min-width: 768px)')
  const sm = useMediaQuery('(min-width: 640px)')
  const presentation = md ? 'column' : sm ? 'sheet-right' : 'sheet-bottom'

  // hash ?panel= → store（契约演示：shell-workbench 的 CompanionHost 同样这么消费）
  useEffect(() => {
    const r = parseHash()
    if (r.kind === 'ds' && r.query.panel && isCompanionId(r.query.panel)) useStudio.getState().openCompanion(r.query.panel)
    return useStudio.subscribe(
      (s) => s.companion,
      (id) => {
        if (parseHash().kind !== 'ds') return
        const target = id ? `#/__ds?panel=${id}` : '#/__ds'
        if (window.location.hash !== target) window.location.replace(target)
      },
    )
  }, [])

  const panel = companion ? (
    <CompanionPanel
      id={companion}
      title={COMPANION_META[companion].title}
      icon={COMPANION_META[companion].icon}
      width={width}
      onWidthChange={setCompanionWidth}
      onClose={closeCompanion}
      presentation={presentation}
      data-testid="ds-companion"
    >
      <EmptyState size="sm" icon={Construction} title={`${COMPANION_META[companion].title}面板`} reason={`由 ${COMPANION_META[companion].unit} 单元接入；宽 ${width}px（320–480，左缘可拖）`} />
    </CompanionPanel>
  ) : null

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="伴随栏面板">
        {COMPANION_IDS.map((id) => (
          <Button key={id} size="sm" variant={companion === id ? 'soft' : 'secondary'} aria-pressed={companion === id} onClick={() => toggleCompanion(id)} data-testid={`ds-companion-open-${id}`}>
            {COMPANION_META[id].icon}
            {COMPANION_META[id].title}
          </Button>
        ))}
      </div>
      <div className="grid h-80 overflow-hidden rounded-lg border border-border bg-app" style={{ gridTemplateColumns: `var(--w-rail) minmax(0,1fr) ${companion && presentation === 'column' ? 'auto' : '0px'}` }} data-testid="ds-shell-mock">
        <div className="border-r border-border bg-panel" aria-hidden />
        <div className="grid place-items-center p-4">
          <div data-slot="paper" role="img" className="h-full w-full max-w-64 rounded-xs shadow-paper" aria-label="纸面（恒白）" data-testid="ds-paper" />
        </div>
        <div className="min-w-0 overflow-hidden">{presentation === 'column' && panel}</div>
      </div>
      {presentation !== 'column' && panel}
      <p className="text-xs text-fg-muted">
        store: <code className="font-mono">companion={String(companion)}</code> · <code className="font-mono">companionWidth={width}</code> · hash <code className="font-mono">?panel={companion ?? ''}</code> · 呈现 <code className="font-mono">{presentation}</code>
      </p>
    </div>
  )
}

export function DesignSystemPage() {
  const theme = useStudio((s) => s.theme)
  const setTheme = useStudio((s) => s.setTheme)
  const [seg, setSeg] = useState<'source' | 'layout' | 'pdf'>('source')
  const [checked, setChecked] = useState(true)
  const [open, setOpen] = useState(false)
  const dark = theme === 'dark'
  const buildMenu = (
    <>
      <DropdownMenuItem>构建 DOCX</DropdownMenuItem>
      <DropdownMenuItem>构建 PDF</DropdownMenuItem>
      <DropdownMenuItem>导出 CNIPA XML</DropdownMenuItem>
    </>
  )
  return (
    <PageChrome
      name="ds"
      title="设计系统"
      actions={
        <Button variant="secondary" size="sm" onClick={() => setTheme(dark ? 'light' : 'dark')} data-testid="ds-theme-toggle" aria-pressed={dark}>
          {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {dark ? '浅色' : '深色'}
        </Button>
      }
    >
      <div className="mx-auto grid max-w-page gap-10 pb-16">
        <PageHeader
          size="lg"
          title="W6 · C Pro Dense 规格总表"
          description="docs/design-system/05-w6-spec.md §1–§3 的落地对照面：tokens（index.css）→ 原语（components/ui）→ 复合组件占位。单元只消费，不自造。"
          meta={<><Badge tone="brand">prep</Badge><Badge tone="neutral">theme: {theme}</Badge></>}
          primary={<SplitButton menu={buildMenu} data-testid="ds-split-button"><Hammer aria-hidden />构建</SplitButton>}
          actions={<Button variant="secondary"><Download aria-hidden />导出</Button>}
        />

        <Section id="grays" title="原始层 · 冷灰 12 阶" hint="--g0 1.0 → --g11 0.150，hue 255；暗色四层面独立取值，不反色">
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">{GRAYS.map((n) => <Swatch key={n} name={n} />)}</div>
        </Section>

        <Section id="surfaces" title="语义层 · 四层面 / 边框 / 前景" hint="app · panel · sunken · elevated；纸面 --paper 亮暗恒白">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">{SURFACES.map((n) => <Swatch key={n} name={n} tall />)}</div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">{FGS.map((n) => <Swatch key={n} name={n} />)}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['bg-app', 'bg-panel', 'bg-sunken', 'bg-elevated'] as const).map((s) => (
              <div key={s} className={`rounded-md border border-border p-3 ${s} ${s === 'bg-elevated' ? 'shadow-md' : ''}`}>
                <div className="text-sm font-medium text-fg-strong">{s}</div>
                <div className="text-xs text-fg-muted">次要文字 --fg-muted</div>
                <div className="text-2xs text-fg-subtle">辅助 --fg-subtle 11px</div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="families" title="语义族 × fg / bg / dot" hint="info 258 · ok 152 · warn 70 · danger 27 · violet 300 · teal 190 · orange 45；fg on bg ≥ 6.0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {FAMILIES.map(([f, box, dot]) => (
              <div key={f} className="grid gap-1 text-2xs">
                <div className={`flex h-lg-control items-center gap-1.5 rounded-sm px-2 ${box}`}>
                  <span className={`size-2 rounded-full ${dot}`} aria-hidden />
                  <span className="font-medium">{f}</span>
                </div>
                <span className="font-mono text-fg-muted">--{f}-fg/bg/dot</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="status" title="案件状态 · 十档 StatusDot" hint="任何位置 = 点 + 文字（禁 dotOnly）；granted / filed 同族加图标">
          <div className="flex flex-wrap gap-x-4 gap-y-2">{CASE_STATUSES.map((s) => <StatusDot key={s} status={s} />)}</div>
          <div className="flex flex-wrap gap-2">{CASE_STATUSES.map((s) => <StatusDot key={s} status={s} variant="badge" />)}</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">{CASE_STATUSES.map((s) => <StatusDot key={s} status={s} size="sm" />)}</div>
        </Section>

        <Section id="heat" title="期限热度 · Heat / Countdown" hint="heat-0 >30d · heat-1 7<d≤30 · heat-2 ≤7d 或逾期；阈值 = store/deadlines.ts，不单独用色">
          <div className="flex flex-wrap items-center gap-2">{HEAT_DAYS.map((d, i) => <Heat key={i} daysLeft={d} />)}{HEAT_DAYS.map((d, i) => <Heat key={`m${i}`} daysLeft={d} size="md" />)}</div>
          <div className="flex flex-wrap items-end gap-6">
            {[45, 20, 3, -4].map((d) => <Countdown key={d} daysLeft={d} date="2026-09-30" />)}
            {[20, 3].map((d) => <Countdown key={`l${d}`} daysLeft={d} size="lg" date="答复期限 2026-09-30" />)}
          </div>
        </Section>

        <Section id="type" title="字阶 · 8 档" hint="最小 11px；正文 14/22；编辑器 14 / 1.7；字重 400 / 500 / 600">
          <div className="grid gap-1">
            {TEXT_SIZES.map(([t, spec, cls]) => (
              <div key={t} className={`${cls} flex items-baseline gap-3`}>
                <span className="w-24 shrink-0 font-mono text-2xs text-fg-muted">{t} · {spec}</span>
                <span className="truncate">权利要求书 Claims · 说明书 Description · 摘要 0123</span>
              </div>
            ))}
            <div className="mt-2 font-mono text-(length:--editor-font-size) leading-(--editor-line-height)">font-mono · JetBrains Mono · `{'{++插入++}'}` `{'{--删除--}'}` · 14 / 1.7</div>
          </div>
        </Section>

        <Section id="dims" title="尺寸 · 控件 5 档 + 壳" hint="xs 24 · sm 28 · md 32 · lg 36 · xl/touch 44（40 档删除）；data-density=touch 一律 44">
          <div className="flex flex-wrap items-end gap-3">
            {CONTROL_HEIGHTS.map(([n, px, cls]) => (
              <div key={n} className="grid gap-1 text-2xs">
                <div className={`${cls} w-16 rounded-sm bg-primary-soft`} />
                <span className="font-mono text-fg-muted">{n} {px}</span>
              </div>
            ))}
            <Separator orientation="vertical" className="h-row" />
            {SHELL_DIMS.map(([v, cls]) => (
              <div key={v} className="grid gap-1 text-2xs">
                <div className={`${cls} w-16 rounded-sm bg-sunken border border-border`} />
                <span className="font-mono text-fg-muted">{v}</span>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label>圆角 · 随尺寸档；pill 仅 chip / 状态 / 头像 / 计数</Label>
              <div className="flex flex-wrap items-end gap-3">{RADII.map(([n, cls]) => <div key={n} className="grid gap-1 text-2xs"><div className={`${cls} size-12 border border-border-strong bg-panel`} /><span className="font-mono text-fg-muted">{n}</span></div>)}</div>
            </div>
            <div className="grid gap-1">
              <Label>阴影 · 4 档；暗色每档内含 1px --border-strong 环</Label>
              <div className="flex flex-wrap items-end gap-4 py-2">{SHADOWS.map(([n, cls]) => <div key={n} className="grid gap-1 text-2xs"><div className={`${cls} h-12 w-20 rounded-lg bg-elevated`} /><span className="font-mono text-fg-muted">{n}</span></div>)}</div>
            </div>
          </div>
        </Section>

        <Section id="buttons" title="Button · 5 size × 6 variant + SplitButton" hint="一屏一个 primary；字重 500；图标随高 14 / 16 / 18">
          <div className="flex flex-wrap items-center gap-2">
            <Button>primary</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="soft">soft</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="danger">danger</Button>
            <Button variant="link">link</Button>
            <Button loading loadingLabel="保存中">保存</Button>
            <Button disabled>禁用</Button>
            <Button variant="secondary" disabled>禁用</Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button size="xs" variant="secondary"><Plus aria-hidden />xs 24</Button>
            <Button size="sm" variant="secondary"><Plus aria-hidden />sm 28</Button>
            <Button size="md" variant="secondary"><Plus aria-hidden />md 32</Button>
            <Button size="lg" variant="secondary"><Plus aria-hidden />lg 36</Button>
            <Button size="xl" variant="secondary"><Plus aria-hidden />xl 44</Button>
            <Button size="icon-xs" variant="ghost" aria-label="搜索 xs"><Search aria-hidden /></Button>
            <Button size="icon-sm" variant="ghost" aria-label="搜索 sm"><Search aria-hidden /></Button>
            <Button size="icon" variant="ghost" aria-label="搜索 md"><Search aria-hidden /></Button>
            <Button size="icon-lg" variant="ghost" aria-label="搜索 lg"><Search aria-hidden /></Button>
            <Button size="icon-xl" variant="ghost" aria-label="搜索 xl"><Search aria-hidden /></Button>
            <SplitButton menu={buildMenu} size="sm">构建 sm</SplitButton>
            <SplitButton menu={buildMenu} variant="secondary">次要 md</SplitButton>
          </div>
        </Section>

        <Section id="inputs" title="Input / Textarea / Select · 4 size" hint="sm 28 · md 32 · lg 36 · xl 44（16px 字，登录 / 移动防缩放）；aria-invalid 行内错误">
          <div className="grid gap-2 sm:grid-cols-4">
            <Input size="sm" placeholder="sm 28" aria-label="sm" />
            <Input size="md" placeholder="md 32" aria-label="md" />
            <Input size="lg" placeholder="lg 36" aria-label="lg" />
            <Input size="xl" placeholder="xl 44 · 16px" aria-label="xl" />
            <Input aria-invalid defaultValue="CN2026" aria-label="错误态" />
            <Input disabled defaultValue="禁用" aria-label="禁用" />
            <Select defaultValue="method">
              <SelectTrigger aria-label="类型 md"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="method">方法</SelectItem>
                <SelectItem value="system">系统</SelectItem>
                <SelectItem value="product">产品</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="method">
              <SelectTrigger size="xl" aria-label="类型 xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="method">方法</SelectItem>
                <SelectItem value="system">系统</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>发明名称</FieldLabel>
              <FieldControl><Input placeholder="一种基于…的方法" /></FieldControl>
              <FieldDescription>≤ 25 字</FieldDescription>
            </Field>
            <Field error="申请号不能为空">
              <FieldLabel>申请号</FieldLabel>
              <FieldControl><Input defaultValue="" /></FieldControl>
              <FieldError />
            </Field>
            <Field>
              <FieldLabel>备注</FieldLabel>
              <FieldControl><Textarea rows={2} placeholder="…" /></FieldControl>
            </Field>
            <Field>
              <FieldLabel>备注 · xl</FieldLabel>
              <FieldControl><Textarea size="xl" rows={2} placeholder="移动端 16px" /></FieldControl>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-base"><Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> 复选</label>
            <label className="inline-flex items-center gap-2 text-base"><Switch defaultChecked aria-label="开关" /> 开关</label>
            <RadioGroup defaultValue="a" orientation="horizontal" aria-label="单选">
              <label className="inline-flex items-center gap-1.5 text-base"><RadioGroupItem value="a" /> A</label>
              <label className="inline-flex items-center gap-1.5 text-base"><RadioGroupItem value="b" /> B</label>
            </RadioGroup>
            <ToggleGroup type="single" defaultValue="b" aria-label="切换组">
              <ToggleGroupItem value="b" aria-label="粗体">B</ToggleGroupItem>
              <ToggleGroupItem value="i" aria-label="斜体">I</ToggleGroupItem>
            </ToggleGroup>
            <Toggle aria-label="置顶">置顶</Toggle>
          </div>
        </Section>

        <Section id="segmented" title="Segmented / Tabs" hint="Segmented md 32 · xl 44（role=radiogroup 方向键）；Tabs 下划线 2px brand，替代胶囊">
          <div className="flex flex-wrap items-center gap-4">
            <Segmented aria-label="视图 md" value={seg} onValueChange={setSeg} options={[{ value: 'source', label: '源码' }, { value: 'layout', label: '版面' }, { value: 'pdf', label: 'PDF' }]} />
            <Segmented aria-label="视图 xl" size="xl" value={seg} onValueChange={setSeg} options={[{ value: 'source', label: '源码' }, { value: 'layout', label: '版面' }, { value: 'pdf', label: 'PDF' }]} />
          </div>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">对话</TabsTrigger>
              <TabsTrigger value="b">场景 <Count value={3} /></TabsTrigger>
              <TabsTrigger value="c">建议 <Count value={12} tone="brand" /></TabsTrigger>
              <TabsTrigger value="d" disabled>禁用</TabsTrigger>
            </TabsList>
            <TabsContent value="a" className="text-base text-fg-muted">对话内容</TabsContent>
            <TabsContent value="b" className="text-base text-fg-muted">场景卡片</TabsContent>
            <TabsContent value="c" className="text-base text-fg-muted">建议列表</TabsContent>
          </Tabs>
        </Section>

        <Section id="badges" title="Badge / Tag / Count / Kbd" hint="Badge 语义 tone · Tag 案件标签（数据色点）· Count 16–18 高 tabular-nums">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>neutral</Badge><Badge tone="info">info</Badge><Badge tone="ok">ok</Badge><Badge tone="warn">warn</Badge><Badge tone="danger">danger</Badge>
            <Badge tone="violet">violet</Badge><Badge tone="teal">teal</Badge><Badge tone="orange">orange</Badge><Badge tone="brand">brand</Badge><Badge tone="outline">outline</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tag>通信</Tag><Tag color="var(--violet-dot)">AI</Tag><Tag color="var(--orange-dot)" onRemove={() => {}}>加急</Tag><Tag>一个很长的案件标签会被截断显示</Tag>
            <Count value={0} showZero /><Count value={7} /><Count value={128} max={99} tone="brand" /><Count value={3} tone="danger" /><Count value={42} tone="inverse" size="md" />
            <Kbd keys={['Mod', 'Shift', 'L']} /><Kbd keys={['Mod', 'Alt', '0']} />
          </div>
        </Section>

        <Section id="feedback" title="Alert / Toast / Progress / Skeleton">
          <div className="grid gap-2 sm:grid-cols-2">
            <Alert><Info /><AlertTitle>提示</AlertTitle><AlertDescription>PDF 由 DOCX 经 LibreOffice 生成。</AlertDescription></Alert>
            <Alert variant="info"><Info /><AlertTitle>信息</AlertTitle><AlertDescription>已连接后端 :8000。</AlertDescription></Alert>
            <Alert variant="ok"><Info /><AlertTitle>通过</AlertTitle><AlertDescription>递交体检 0 阻塞项。</AlertDescription></Alert>
            <Alert variant="warn"><TriangleAlert /><AlertTitle>注意</AlertTitle><AlertDescription>摘要接近 300 字上限。</AlertDescription></Alert>
            <Alert variant="danger"><TriangleAlert /><AlertTitle>失败</AlertTitle><AlertDescription>LibreOffice 转换超时。</AlertDescription></Alert>
            <Toast kind="success" onDismiss={() => {}}>已保存</Toast>
            <Toast kind="error" action={{ label: '重试', onClick: () => {} }}>构建失败</Toast>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Progress value={40} label="进度" />
            <Progress label="不确定进度" />
            <Skeleton lines={3} />
          </div>
        </Section>

        <Section id="overlay" title="Tooltip / Popover / Sheet / Breadcrumb / Avatar">
          <div className="flex flex-wrap items-center gap-3">
            <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="sm">悬停</Button></TooltipTrigger><TooltipContent shortcut={['Mod', 'B']}>构建</TooltipContent></Tooltip>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger><Button variant="secondary" size="sm">Popover</Button></PopoverTrigger>
              <PopoverContent className="text-base">浮层内容 · shadow-md · r8</PopoverContent>
            </Popover>
            <Sheet>
              <SheetTrigger asChild><Button variant="secondary" size="sm">Sheet 右 360</Button></SheetTrigger>
              <SheetContent side="right"><SheetTitle>右侧 Sheet</SheetTitle><SheetDescription>宽 360 · r12 · shadow-lg</SheetDescription></SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild><Button variant="secondary" size="sm">Sheet 底 ≤85vh</Button></SheetTrigger>
              <SheetContent side="bottom" handle><SheetTitle>底部 Sheet</SheetTitle><SheetDescription>抓手 36×4 · 顶角 r12 · 行 48</SheetDescription></SheetContent>
            </Sheet>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem><BreadcrumbLink href="#/">案卷</BreadcrumbLink></BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage>示例案卷 1</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <Avatar name="张三" size="sm" /><Avatar name="李四" /><Avatar name="王五" size="lg" />
            <AvatarGroup max={3} items={['A', 'B', 'C', 'D', 'E'].map((name) => ({ name }))} />
          </div>
        </Section>

        <Section id="companion" title="CompanionPanel · 与 dockview 共存骨架" hint="DesktopShell 第 4 栅格列（dockview 外侧）· 同时只开一个 id · 360（320–480）· <768 右 Sheet · <640 底 Sheet · hash ?panel=">
          <CompanionDemo />
        </Section>

        <Section id="table" title="DataTable · 行 40 / 紧凑 36 / 表头 32" hint="只留水平线；空态 · 加载（Skeleton 5 行）· 错误（Alert + 重试）三态由 dashboard 单元接">
          <div className="rounded-md border border-border bg-panel">
            <DataTable columns={COLS} data={ROWS} getRowId={(r) => r.id} data-testid="ds-table" />
          </div>
        </Section>

        <Section id="empty" title="EmptyState" hint="图标 32 于 56 r12 sunken 容器；标题 16/24；说明 14/22；一个次要动作">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-border bg-panel"><EmptyState icon={Construction} title={NOT_IMPLEMENTED_TITLE} reason="该单元尚未落地（501）。" action={<Button size="sm" variant="secondary">返回</Button>} /></div>
            <div className="rounded-md border border-border bg-panel"><EmptyState size="sm" icon={FileText} title="暂无案卷" reason="导入 Word 或新建一案" action={<Button size="sm" variant="soft"><Plus aria-hidden />新建</Button>} /></div>
          </div>
        </Section>

        <Section id="touch" title="data-density=touch · 触控四档 + 命中区 ≥ 44" hint="06 §2：MobileShell / 底部 Sheet 注入；视觉 xs 28 / sm 32 / md 36 / lg 44，行 48；视觉 < 44 的原语用 touchHit 伪元素把命中区扩到 44（相邻 gap ≥ 8）">
          <div data-density="touch" className="flex flex-wrap items-center gap-group-m rounded-md border border-border bg-panel p-card-m" data-testid="ds-touch">
            <Button size="xs" variant="ghost">xs 28</Button>
            <Button size="sm" variant="secondary">sm 32</Button>
            <Button size="md" variant="secondary">md 36</Button>
            <Button size="lg" variant="secondary">lg 44</Button>
            <Button size="xl">主 CTA 44</Button>
            <Input size="md" placeholder="Input → 44" aria-label="touch input" className="w-40" />
            <Segmented aria-label="touch seg" value={seg} onValueChange={setSeg} options={[{ value: 'source', label: '源码' }, { value: 'pdf', label: 'PDF' }]} />
            <Toggle size="sm" aria-label="touch toggle">Toggle 32</Toggle>
            <Tag onRemove={() => {}}>可删 Tag 24</Tag>
          </div>
        </Section>

        <Section id="mobile-page" title="MobilePage · ScrollRow · 移动 8pt 间距" hint="06 §3：页边 16 · 区块 24 · 卡片内 16 · 卡片间 12 · 同组 8 · 行内 4；横向行 overflow-x auto 首末 16 不裁切">
          <div data-density="touch" className="mx-auto w-full max-w-sm overflow-hidden rounded-lg border border-border bg-app" data-testid="ds-mobile-page">
            <MobilePage tabbar={false} className="h-80">
              <MobilePageSection title="今日" action={<Button size="sm" variant="ghost">全部</Button>}>
                <ScrollRow aria-label="状态筛选">
                  {['全部', '撰写中', '审阅', '客户审阅', '已定稿', '已递交', 'OA', '已授权'].map((s, i) => (
                    <Toggle key={s} size="sm" variant="outline" pressed={i === 0} aria-label={s}>{s}</Toggle>
                  ))}
                </ScrollRow>
              </MobilePageSection>
              <MobilePageSection title="案件">
                <div className="flex flex-col gap-cards-m">
                  {['一种基于…的方法', '一种…系统'].map((t) => (
                    <div key={t} className="flex flex-col gap-group-m rounded-lg border border-border bg-panel p-card-m">
                      <div className="flex items-center gap-inline-m text-sm font-medium text-fg-strong"><FileText className="size-4 text-fg-icon" aria-hidden />{t}</div>
                      <div className="flex items-center justify-between gap-group-m">
                        <Badge tone="info">撰写中</Badge>
                        <Button size="md" variant="secondary">打开</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </MobilePageSection>
            </MobilePage>
          </div>
        </Section>

        <Section id="compound" title="复合组件占位 · 单元交付" hint="05 §3：CaseTable · KanbanColumn · TodayStrip · FileTree · PdfToolbar · ProposalCard · ReviewThread · VersionList · ClientHeader · MobileTabbar">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[['TodayStrip 32', 'dashboard', Info], ['CaseTable', 'dashboard', FileText], ['KanbanColumn', 'dashboard', ChevronDown], ['FileTree 240', 'shell-workbench', FileText], ['PdfToolbar 32', 'editor-threeview', FileText],
              ['ProposalCard', 'ai-panel', Bot], ['ReviewThread', 'collab-review-history', MessageSquareText], ['VersionList', 'collab-review-history', History], ['ClientHeader 56', 'auth-client-public', FileText], ['MobileTabbar 56', 'mobile-shell', ChevronDown]].map(([n, unit, Icon]) => (
              <div key={n as string} className="rounded-md border border-dashed border-border-strong bg-sunken/50">
                <EmptyState size="sm" icon={Icon as typeof Info} title={n as string} reason={unit as string} />
              </div>
            ))}
          </div>
        </Section>

        <Separator />
        <p className="text-xs text-fg-muted">tokens: frontend/src/index.css · 规格: docs/design-system/05-w6-spec.md · 契约: docs/design-system/w6-spec/prep-contracts.md · 校验: pnpm lint:tokens / src/test/check-contrast.test.ts / components/ui/__tests__</p>
      </div>
    </PageChrome>
  )
}

export default DesignSystemPage
