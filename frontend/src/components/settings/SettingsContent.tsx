import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Download, Image, MoreHorizontal, Plus, RotateCcw, Search, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Settings, Style } from '@/lib/types'
import { FONT_SUGGESTIONS, SIZE_PRESETS, diffStyle, mergeStyle } from '@/lib/style'
import { cn, deepClone, getPath, setPath } from '@/lib/utils'
import { DEBOUNCE_MAX, DEBOUNCE_MIN, DEBOUNCE_MS, EDITOR_FONT_DEFAULT, EDITOR_FONT_MAX, EDITOR_FONT_MIN, makePanelId, selectCanEditStyle, useStudio, type Density, type Theme, type ZoomFit } from '@/store'
import { NumberField, SwitchField, TextField, type ComboOpt } from './fields'
import { parseSettingsJson } from './settingsJson'
import { SettingRow } from './SettingRow'
import { SettingsNav } from './SettingsNav'
import { TemplatesPage } from '@/components/templates'
import { IntegrationsPage } from '@/components/integrations'
import {
  ALL_ROWS, PAGES, PAGE_OF_ROW, ROW_OF, isPrefItem, isStyleItem, listChanged, matchRow,
  type PageId, type PrefItem, type Row, type RowItem, type StyleItem,
} from './schema'
import { saveBlob } from '@/lib/download'

const FONT_OPTS: ComboOpt[] = FONT_SUGGESTIONS.map((f) => ({ label: f, value: f, font: f }))
const SIZE_OPTS: ComboOpt[] = SIZE_PRESETS.map((p) => ({ label: p.name, value: String(p.pt) }))
const FLASH_MS = 1000
const ABSTRACT_LIMIT = { min: 50, max: 2000, step: 10, unit: '字' }
const DEBOUNCE = { min: DEBOUNCE_MIN, max: DEBOUNCE_MAX, step: 100, unit: 'ms' }
const EDITOR_FS = { min: EDITOR_FONT_MIN, max: EDITOR_FONT_MAX, step: 1, unit: 'px' }
const DEFAULT_THEME: Theme = 'system'
const DEFAULT_ZOOM_FIT: ZoomFit = 'width'
const DEFAULT_DENSITY: Density = 'comfortable'

export interface SettingsContentProps {
  className?: string
  /** 工具行（搜索 · 已改 N 项 ▾）是否显示 */
  tools?: boolean
  /** desktop = 左 172px SettingsNav（SettingsPanel 用）；mobile（默认）= 顶部分组下拉 + ⋯（MobileSettings 全屏复用） */
  variant?: 'desktop' | 'mobile'
  /** 受控当前页（MobileSettings 头部下拉在 tools=false 时接管页面切换）；缺省由组件内部维护 */
  page?: PageId
  onPageChange?: (id: PageId) => void
}

/**
 * 排版设置内容（07 §2.1）：7 个逻辑页（页面与边距 / 字体与字号 / 页眉与页脚 / 附图与表格 / 校验规则 / 构建与预览 / 外观）
 * + 搜索（跨页过滤并高亮）+ 已改 N 项 ▾（跳到该行并高亮 1 s）+ 导入 / 导出 JSON + 全部恢复默认（确认对话框）。
 * 所有排版值仍写 project.saveSettings（立即重建 + PUT /settings，JSON 结构不变）；构建/外观页读写 ui/build store 已有字段。
 */
export function SettingsContent({ className, tools = true, variant = 'mobile', page, onPageChange }: SettingsContentProps) {
  const pid = useStudio((s) => s.pid)
  const project = useStudio((s) => s.project)
  const figs = useStudio((s) => s.figs)
  const defaults = useStudio((s) => s.defaults)
  const defaultSettings = useStudio((s) => s.defaultSettings)
  const settings = useStudio((s) => s.settings)
  const saveSettings = useStudio((s) => s.saveSettings)
  const resetSettings = useStudio((s) => s.resetSettings)
  const toast = useStudio((s) => s.toast)

  if (!pid || !defaults || !settings || !project || project.id !== pid) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6 text-center text-xs text-fg-muted', className)} data-testid="settings-content">
        {pid ? '正在加载案子…' : '请先打开一个案子'}
      </div>
    )
  }
  return (
    <SettingsBody
      key={pid}
      pid={pid}
      figs={figs}
      defaults={defaults}
      defaultSettings={defaultSettings}
      settings={settings}
      onChange={saveSettings}
      onResetAll={resetSettings}
      onToast={toast}
      className={className}
      tools={tools}
      variant={variant}
      page={page}
      onPageChange={onPageChange}
    />
  )
}

interface BodyProps {
  pid: string
  figs: string[]
  defaults: Style
  defaultSettings: Settings | null
  settings: Settings
  onChange: (s: Settings) => void
  onResetAll: () => void
  onToast: (text: string, kind?: 'info' | 'error' | 'success') => void
  className?: string
  tools: boolean
  variant: 'desktop' | 'mobile'
  page?: PageId
  onPageChange?: (id: PageId) => void
}

function SettingsBody({ pid, figs, defaults, defaultSettings, settings, onChange, onResetAll, onToast, className, tools, variant, page: pageProp, onPageChange }: BodyProps) {
  /* ---- ui / build store 偏好（构建与预览 · 外观页） ---- */
  const autoBuild = useStudio((s) => s.autoBuild)
  const setAutoBuild = useStudio((s) => s.setAutoBuild)
  const zoomFit = useStudio((s) => s.zoomFit)
  const setZoomFit = useStudio((s) => s.setZoomFit)
  const setZoom = useStudio((s) => s.setZoom)
  const theme = useStudio((s) => s.theme)
  const setTheme = useStudio((s) => s.setTheme)
  const debounceMs = useStudio((s) => s.debounceMs)
  const setDebounceMs = useStudio((s) => s.setDebounceMs)
  const editorFontSize = useStudio((s) => s.editorFontSize)
  const setEditorFontSize = useStudio((s) => s.setEditorFontSize)
  const density = useStudio((s) => s.density)
  const setDensity = useStudio((s) => s.setDensity)
  /* R59-01：写 settings 的控件（style/abstract_limit/sub_except/导入/恢复默认）要 editor+；
     pref 项（主题/密度/缩放/编辑器字号/自动构建）是本机偏好不 PUT，viewer 也可改 */
  const canEdit = useStudio(selectCanEditStyle)
  const prefs: PrefControlProps['prefs'] = { autoBuild, setAutoBuild, zoomFit, setZoomFit, setZoom, theme, setTheme, debounceMs, setDebounceMs, editorFontSize, setEditorFontSize, density, setDensity }

  const eff = useMemo(() => mergeStyle(defaults, settings.style), [defaults, settings.style])
  const changedList = useMemo(() => listChanged(defaults, settings, defaultSettings), [defaults, settings, defaultSettings])
  const changedIds = useMemo(() => new Set(changedList.map((c) => c.item.id)), [changedList])
  const pageCounts = useMemo(() => {
    const out: Partial<Record<PageId, number>> = {}
    for (const c of changedList) {
      const p = PAGE_OF_ROW[ROW_OF[c.item.id]]
      if (p) out[p] = (out[p] ?? 0) + 1
    }
    return out
  }, [changedList])

  const [pageState, setPageState] = useState<PageId>('page')
  const page = pageProp ?? pageState
  const setPage = useCallback((id: PageId) => { setPageState(id); onPageChange?.(id) }, [onPageChange])
  const [q, setQ] = useState('')
  const [flashId, setFlashId] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [subInput, setSubInput] = useState('')
  const flashTimer = useRef<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current) }, [])

  const query = q.trim()
  const currentPage = PAGES.find((p) => p.id === page)!
  /** 搜索时跨全部页过滤；否则只显示当前页 */
  const visiblePages = useMemo(() => {
    if (!query) return [currentPage]
    return PAGES
      .map((p) => ({ ...p, sections: p.sections.map((s) => ({ ...s, rows: s.rows.filter((r) => matchRow(r, query)) })).filter((s) => s.rows.length > 0) }))
      .filter((p) => p.sections.length > 0)
  }, [query, currentPage])
  const matchCount = query ? visiblePages.reduce((n, p) => n + p.sections.reduce((m, s) => m + s.rows.length, 0), 0) : 0

  /* ---- 写入 ---- */
  const updateStyle = useCallback((path: string[], value: unknown) => {
    const next = deepClone(eff) as unknown as Record<string, unknown>
    setPath(next, path, value)
    onChange({ ...settings, style: diffStyle(defaults, next as unknown as Style) })
  }, [eff, defaults, settings, onChange])
  const update = useCallback((patch: Partial<Settings>) => onChange({ ...settings, ...patch }), [settings, onChange])

  const prefChanged = (it: PrefItem): boolean => {
    switch (it.pref) {
      case 'auto_build': return !autoBuild
      case 'debounce_ms': return debounceMs !== DEBOUNCE_MS
      case 'zoom_default': return zoomFit !== DEFAULT_ZOOM_FIT
      case 'theme': return theme !== DEFAULT_THEME
      case 'editor_font_size': return editorFontSize !== EDITOR_FONT_DEFAULT
      case 'ui_density': return density !== DEFAULT_DENSITY
    }
  }
  const resetPref = (it: PrefItem) => {
    switch (it.pref) {
      case 'auto_build': setAutoBuild(true); break
      case 'debounce_ms': setDebounceMs(DEBOUNCE_MS); break
      case 'zoom_default': setZoomFit(DEFAULT_ZOOM_FIT); break
      case 'theme': setTheme(DEFAULT_THEME); break
      case 'editor_font_size': setEditorFontSize(EDITOR_FONT_DEFAULT); break
      case 'ui_density': setDensity(DEFAULT_DENSITY); break
    }
  }
  const itemChanged = (it: RowItem) => (isPrefItem(it) ? prefChanged(it) : changedIds.has(it.id))
  const canReset = (it: RowItem) => (isPrefItem(it) ? !it.pending : it.kind !== 'figures_book')
  const resetItem = (it: RowItem) => {
    if (isPrefItem(it)) resetPref(it)
    else if (isStyleItem(it)) updateStyle(it.path, getPath(defaults, it.path))
    else if (it.kind === 'abstract_limit') update({ abstract_limit: defaultSettings?.abstract_limit ?? 300 })
    else if (it.kind === 'sub_except') update({ sub_except: defaultSettings?.sub_except ?? ['tsf_guard', 'on_matured'] })
  }
  /** 合成行（页边距）只重置已改的那几项 */
  const resetRow = (r: Row) => r.items.filter((it) => itemChanged(it) && canReset(it)).forEach(resetItem)

  /* ---- 跳到某项所在行并高亮 1 s（痛点 #11） ---- */
  const revealItem = (itemId: string) => {
    const rowId = ROW_OF[itemId] ?? itemId
    const row = ALL_ROWS.find((r) => r.id === rowId)
    const pageId = PAGE_OF_ROW[rowId]
    if (pageId) setPage(pageId)
    if (query && row && !matchRow(row, query)) setQ('')
    window.requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(rowId)}"]`)
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el?.querySelector<HTMLElement>('input:not([disabled]), button[role="combobox"], button[role="switch"]')?.focus({ preventScroll: true })
      setFlashId(rowId)
      if (flashTimer.current) window.clearTimeout(flashTimer.current)
      flashTimer.current = window.setTimeout(() => setFlashId(null), FLASH_MS)
    })
  }

  /* ---- 导入 / 导出 JSON（结构 = studio.json） ---- */
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
    saveBlob(blob, `studio-${pid}.json`)
  }
  const importJson = async (f: File) => {
    try {
      onChange({ ...settings, ...parseSettingsJson(await f.text()) })
      onToast(`已导入 ${f.name}`, 'success')
    } catch (e) {
      onToast(`导入失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }
  const doResetAll = () => {
    setConfirmReset(false)
    onResetAll()
    onToast('已恢复默认排版参数（附图选择保留）', 'info')
  }

  const changedCount = changedList.length

  /* ---- 单项控件 ---- */
  const renderControl = (it: RowItem, prefix?: string): ReactNode => {
    if (isPrefItem(it)) return <PrefControl item={it} prefs={prefs} />
    if (isStyleItem(it)) return <StyleControl item={it} eff={eff} onChange={updateStyle} prefix={prefix} disabled={!canEdit} />
    if (it.kind === 'abstract_limit') {
      return <NumberField item={ABSTRACT_LIMIT} value={settings.abstract_limit} ariaLabel="abstract_limit" disabled={!canEdit} onCommit={(v) => update({ abstract_limit: v })} />
    }
    if (it.kind === 'sub_except') {
      return (
        <>
          <div className="flex flex-wrap gap-1.5">
            {settings.sub_except.map((s) => (
              <Badge key={s} tone="neutral" className="pr-1 font-mono">
                {s}
                <button type="button" aria-label={`移除 ${s}`} disabled={!canEdit} className="rounded-full p-0.5 hover:bg-fg/10 disabled:opacity-50"
                  onClick={() => update({ sub_except: settings.sub_except.filter((x) => x !== s) })}><X /></button>
              </Badge>
            ))}
            {settings.sub_except.length === 0 && <span className="text-xs text-fg-muted">（无）</span>}
          </div>
          <form className="mt-1.5 flex gap-1.5" onSubmit={(e) => {
            e.preventDefault()
            const v = subInput.trim()
            if (v && !settings.sub_except.includes(v)) update({ sub_except: [...settings.sub_except, v] })
            setSubInput('')
          }}>
            <Input value={subInput} onChange={(e) => setSubInput(e.target.value)} placeholder="添加标识符，如 my_var" disabled={!canEdit} className="h-md-control max-w-[240px] font-mono" aria-label="新增 sub_except" />
            <Button type="submit" size="sm" variant="outline" disabled={!canEdit || !subInput.trim()}><Plus />添加</Button>
          </form>
        </>
      )
    }
    /* figures_book（W4-C：设置页不再编辑附图，只给入口；真源 docs/figures.md） */
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" variant="outline" className="h-sm-control text-xs" data-testid="settings-open-figure-book"
          onClick={() => useStudio.getState().openPanel(makePanelId('figures'))}>
          <Image />打开附图书
        </Button>
        <span className="text-xs text-fg-muted">
          说明书附图 {settings.spec_figures.length} 幅 · 摘要图 {settings.abstract_figure ? settings.abstract_figure[0] : '未设'} · 图片文件 {figs.length} 个
        </span>
      </div>
    )
  }

  const renderRow = (r: Row) => {
    const changed = r.items.some(itemChanged)
    const resettable = r.items.some(canReset)
    const first = r.items[0]
    const block = !isPrefItem(first) && first.kind === 'sub_except'
    const pending = isPrefItem(first) && !!first.pending
    /* pref 行只重置本机偏好；其余行写 settings 需 editor+ */
    const rowNeedsWrite = r.items.some((it) => !isPrefItem(it))
    return (
      <SettingRow
        key={r.id}
        id={r.id}
        label={r.label}
        description={r.desc}
        q={query}
        changed={changed}
        flash={flashId === r.id}
        onReset={resettable && (canEdit || !rowNeedsWrite) ? () => resetRow(r) : undefined}
        block={block}
        pending={pending}
      >
        {r.items.length > 1 ? (
          <div className="grid max-w-full min-w-0 grid-cols-2 gap-2 @max-[280px]:grid-cols-1" data-testid={`setting-grid-${r.id}`}>
            {r.items.map((it, i) => <div key={it.id} className="min-w-0" data-setting-id={it.id}>{renderControl(it, r.prefixes?.[i])}</div>)}
          </div>
        ) : renderControl(first)}
      </SettingRow>
    )
  }

  const changedMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={changedCount === 0} className="h-md-control shrink-0 gap-1 px-2 text-xs" data-testid="settings-changed">
          {changedCount > 0 ? <>已改 <b className="tabular-nums">{changedCount}</b> 项</> : '未修改'}
          {changedCount > 0 && <ChevronDown className="size-3.5 opacity-60" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        {changedList.map(({ item, value, defaultValue }) => (
          <DropdownMenuItem key={item.id} onSelect={() => revealItem(item.id)} className="items-start gap-2 py-1.5">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm" title={item.label}>{item.label}</span>
              <span className="block truncate text-2xs text-fg-muted" title={`${value} · 默认 ${defaultValue}`}>
                <span className="text-fg">{value}</span> · 默认 {defaultValue}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const searchBox = (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-muted" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索设置，如“页边距”“段号”…"
        aria-label="搜索设置"
        className="h-md-control pl-8 pr-7"
        data-testid="settings-search"
      />
      {q && (
        <button type="button" aria-label="清除搜索" onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-fg-muted hover:bg-hover hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )

  const form = (
    <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto pb-4', variant === 'desktop' ? 'px-4' : 'px-3')} data-testid="settings-groups">
      {query && matchCount === 0 && (
        <div className="p-6 text-center text-xs text-fg-muted">没有匹配「{query}」的设置项</div>
      )}
      {visiblePages.map((p) => p.custom ? (
        p.custom === 'templates' ? <TemplatesPage key={p.id} /> : <IntegrationsPage key={p.id} />
      ) : (
        <section key={p.id} data-testid={`settings-page-${p.id}`} aria-label={p.title}>
          <h3 className={query ? 'pb-1 pt-3 text-sm font-semibold' : 'sr-only'}>
            {p.title}
            {query && <span className="ml-2 text-2xs font-medium text-fg-muted">{p.sections.reduce((m, s) => m + s.rows.length, 0)} 项匹配</span>}
          </h3>
          {p.sections.map((s, i) => (
            <div key={s.title ?? i}>
              {s.title && <h4 className="pb-1 pt-4 text-xs font-semibold text-fg-muted">{s.title}</h4>}
              {s.rows.map(renderRow)}
            </div>
          ))}
        </section>
      ))}
    </div>
  )

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="hidden"
      aria-label="选择设置 JSON"
      data-testid="settings-import-file"
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) void importJson(f)
        e.target.value = ''
      }}
    />
  )

  const confirmDialog = (
    <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
      <DialogContent className="max-w-sm" data-testid="settings-reset-confirm">
        <DialogHeader>
          <DialogTitle>全部恢复默认？</DialogTitle>
          <DialogDescription>把 {changedCount} 项排版参数恢复为零漂移基准（附图选择保留），并立即重新构建。此操作不可撤销。</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>取消</Button>
          <Button variant="danger" size="sm" onClick={doResetAll} data-testid="settings-reset-confirm-ok"><RotateCcw />全部恢复默认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  if (variant === 'desktop') {
    return (
      <div className={cn('flex h-full min-h-0 min-w-0', className)} data-testid="settings-content">
        <SettingsNav
          current={page}
          onSelect={(id) => { setPage(id); setQ('') }}
          counts={pageCounts}
          onImport={() => fileRef.current?.click()}
          onExport={exportJson}
          onResetAll={() => setConfirmReset(true)}
          importDisabled={!canEdit}
          resetDisabled={changedCount === 0 || !canEdit}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tools && (
            <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-2" data-testid="settings-tools">
              {searchBox}
              {changedMenu}
            </div>
          )}
          {form}
        </div>
        {fileInput}
        {confirmDialog}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)} data-testid="settings-content">
      {tools && (
        <div className="shrink-0 space-y-2 border-b border-border px-3 py-2" data-testid="settings-tools">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select value={query ? '__search' : page} onValueChange={(v) => { setPage(v as PageId); setQ('') }}>
              <SelectTrigger className="h-md-control min-w-28 flex-1" aria-label="设置分组" data-testid="settings-page-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}{pageCounts[p.id] ? <span className="ml-1.5 text-2xs text-link">已改 {pageCounts[p.id]}</span> : null}
                  </SelectItem>
                ))}
                {query && <SelectItem value="__search" disabled>搜索结果</SelectItem>}
              </SelectContent>
            </Select>
            {changedMenu}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label="更多：导入 / 导出 JSON / 全部恢复默认" title="更多" data-testid="settings-more"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={exportJson}><Download />导出 JSON<span className="ml-auto pl-3 text-2xs text-fg-muted">studio-{pid}.json</span></DropdownMenuItem>
                <DropdownMenuItem onSelect={() => fileRef.current?.click()} disabled={!canEdit}><Upload />导入 JSON…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setConfirmReset(true)} disabled={changedCount === 0 || !canEdit} className="text-danger-fg" data-testid="settings-reset-all"><RotateCcw />全部恢复默认</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {searchBox}
        </div>
      )}
      {form}
      {fileInput}
      {confirmDialog}
    </div>
  )
}

function StyleControl({ item, eff, onChange, prefix, disabled }: { item: StyleItem; eff: Style; onChange: (path: string[], v: unknown) => void; prefix?: string; disabled?: boolean }) {
  const ariaLabel = item.path.join('.')
  if (item.kind === 'number') {
    return <NumberField item={item} value={getPath(eff, item.path) as number} ariaLabel={ariaLabel} prefix={prefix} disabled={disabled} options={item.presets === 'size' ? SIZE_OPTS : undefined} onCommit={(v) => onChange(item.path, v)} />
  }
  if (item.kind === 'text') {
    return <TextField item={item} value={String(getPath(eff, item.path) ?? '')} options={item.suggestions ? FONT_OPTS : undefined} ariaLabel={ariaLabel} disabled={disabled} onCommit={(v) => onChange(item.path, v)} />
  }
  return <SwitchField value={!!getPath(eff, item.path)} ariaLabel={ariaLabel} disabled={disabled} onCommit={(v) => onChange(item.path, v)} />
}

interface PrefControlProps {
  item: PrefItem
  prefs: {
    autoBuild: boolean
    setAutoBuild: (on: boolean) => void
    zoomFit: ZoomFit
    setZoomFit: (fit: ZoomFit) => void
    setZoom: (z: number) => void
    theme: Theme
    setTheme: (t: Theme) => void
    debounceMs: number
    setDebounceMs: (ms: number) => void
    editorFontSize: number
    setEditorFontSize: (px: number) => void
    density: Density
    setDensity: (d: Density) => void
  }
}

/** 构建与预览 / 外观页：读写 ui/build store 字段（自动构建 / 防抖 / 缩放 / 主题 / 编辑器字号 / UI 密度） */
function PrefControl({ item, prefs }: PrefControlProps) {
  const { autoBuild, setAutoBuild, zoomFit, setZoomFit, setZoom, theme, setTheme, debounceMs, setDebounceMs, editorFontSize, setEditorFontSize, density, setDensity } = prefs
  switch (item.pref) {
    case 'auto_build':
      return <SwitchField value={autoBuild} ariaLabel="自动构建" onCommit={setAutoBuild} />
    case 'debounce_ms':
      return <NumberField item={DEBOUNCE} value={debounceMs} ariaLabel="构建防抖 ms" onCommit={setDebounceMs} />
    case 'zoom_default':
      return (
        <Select value={zoomFit ?? '100'} onValueChange={(v) => { if (v === '100') { setZoomFit(null); setZoom(1) } else setZoomFit(v as ZoomFit) }}>
          <SelectTrigger className="h-md-control w-30 max-w-full" aria-label="预览缩放默认"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="width">适宽</SelectItem>
            <SelectItem value="page">适页</SelectItem>
            <SelectItem value="100">100%</SelectItem>
          </SelectContent>
        </Select>
      )
    case 'theme':
      return (
        <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <SelectTrigger className="h-md-control w-30 max-w-full" aria-label="主题"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="light">浅色</SelectItem>
            <SelectItem value="dark">深色</SelectItem>
            <SelectItem value="system">跟随系统</SelectItem>
          </SelectContent>
        </Select>
      )
    case 'editor_font_size':
      return <NumberField item={EDITOR_FS} value={editorFontSize} ariaLabel="编辑器字号 px" onCommit={setEditorFontSize} />
    case 'ui_density':
      return (
        <Select value={density} onValueChange={(v) => setDensity(v as Density)}>
          <SelectTrigger className="h-md-control w-30 max-w-full" aria-label="UI 密度"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="compact">紧凑</SelectItem>
            <SelectItem value="comfortable">舒适</SelectItem>
          </SelectContent>
        </Select>
      )
  }
}
