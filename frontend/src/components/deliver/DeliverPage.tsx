import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { BadgeCheck, CheckCircle2, Package, Settings2, TriangleAlert } from 'lucide-react'
import { CaseFormDialog } from '@/components/case-form/CaseFormDialog'
import { PageChrome } from '@/components/shell/PageChrome'
import { resolveBlockId, usePreflightLocate } from '@/components/preflight/preflightUtils'
import { CaseSettingsDialog } from '@/components/settings/CaseSettingsDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsDesktop } from '@/hooks/useMisc'
import { api } from '@/lib/api'
import type { CaseWithMeta } from '@/lib/caseForm'
import { downloadFile } from '@/lib/download'
import { BOOK_LABELS, splitBooks } from '@/lib/docset'
import { fmtFull } from '@/lib/format'
import { goWorkbench, projectHash } from '@/lib/hash'
import type { Diagnostic } from '@/lib/types'
import { useStudio } from '@/store'
import { getPlatformCase } from '@/lib/platform'
import { PlatformPreflightCard, PlatformReleasesCard } from '@/components/platform/PlatformDeliver'
import type { PlatformCase } from '@/workbench/types'
import { selectCheckCounts, selectCheckItems } from '@/store/checks'
import { selectConfirmationState, selectExportEntries, type ConfirmationState } from '@/store/deliver'
import type { ExportKind } from '@/types/deliver'
import { CheckTable } from './CheckTable'
import { FailureLocate, XmlReport } from './DeliverReport'
import { ApplicantCard, DeadlineCard, FilingReadinessCard, RecordCard, type ReadyItem } from './DeliverSide'
import { DeliverSteps, type StepState } from './DeliverSteps'
import { ExportGrid } from './ExportGrid'
import type { Regen } from './ExportItem'
import { FieldErrors } from './FieldErrors'
import { FilingDialog } from './FilingDialog'

/** 客户确认徽章（21 §1.2 A5）：sha 相同 → ok「客户确认 vN」；不同 → warn「确认版本已过期」 */
export function ConfirmationBadge({ state }: { state: ConfirmationState }) {
  if (state.kind === 'none') return null
  const c = state.confirmation
  if (state.kind === 'current') {
    return (
      <Badge tone="ok" title={`${c.name} 于 ${fmtFull(c.confirmed_at)} 确认 ${c.sha.slice(0, 7)}`} data-testid="confirmation-badge" data-state="current">
        <BadgeCheck aria-hidden /> 客户确认 v{c.version}
      </Badge>
    )
  }
  return (
    <Badge tone="warn" title={`客户确认的是 v${c.version}（${c.sha.slice(0, 7)}），此后正文已修改`} data-testid="confirmation-badge" data-state="stale">
      <TriangleAlert aria-hidden /> 确认版本已过期
    </Badge>
  )
}

/** 递交页标题：案名 → 案号 → 「未命名案卷」；永不落到目录 id（审计 Top-25 #5） */
export function deliverTitle(title: string | undefined, caseNo: string | undefined): string {
  return title?.trim() || (caseNo?.trim() ? `案号 ${caseNo.trim()}` : '未命名案卷')
}

/**
 * 递交页 `#/p/<pid>/deliver`（05 §4 S7；prototype s7-deliver）：PageChrome 顶栏 + PageHeader（H1 案名 · 案号 / 版本 · StatusDot · 客户确认徽章 ·
 * 次级「案级设置」「标记为已递交…」· 唯一 primary「生成递交包」）+ 四步流程条 + 1440 两栏（左 体检 / 导出产物；右 期限 / 递交记录 / 申请信息）；
 * 375 单列 + 底部粘性动作条（primary 全宽）。
 * 数据与 W5 完全同源：进入时 ensureLint()（不另起 preflight 请求）、loadManifest / refreshCase / loadHistory / loadDeliverErrors；
 * 「定位」→ `#/p/<pid>?focus=<block_id>`（AST 按行反查；反查不到时退回 goWorkbench + gotoLine）。
 */
export function DeliverPage({ pid }: { pid: string }) {
  const isDesktop = useIsDesktop()
  const project = useStudio((s) => s.project)
  const projectError = useStudio((s) => s.projectError)
  const projectLoading = useStudio((s) => s.projectLoading)
  const lastOk = useStudio((s) => s.lastOk)
  const lastOkAt = useStudio((s) => s.lastOkAt)
  const buildPhase = useStudio((s) => s.phase)
  const buildOutcome = useStudio((s) => s.outcome)
  const netError = useStudio((s) => s.netError)
  const enqueue = useStudio((s) => s.enqueue)
  const xmlRunning = useStudio((s) => s.xmlRunning)
  const xmlResult = useStudio((s) => s.xmlResult)
  const xmlError = useStudio((s) => s.xmlError)
  const xmlAt = useStudio((s) => s.xmlAt)
  const runXmlExport = useStudio((s) => s.runXmlExport)
  const authStatus = useStudio((s) => s.authStatus)
  const superuser = useStudio((s) => s.user?.is_superuser ?? false)
  const items = useStudio(selectCheckItems)
  const counts = useMemo(() => selectCheckCounts({ items }), [items])
  const lintRun = useStudio((s) => s.lintRun)
  const lintRunning = useStudio((s) => s.lintRunning)
  const lintStale = useStudio((s) => s.lintRun?.report !== null && s.lintRun !== null && s.lintContent !== s.content)
  const ensureLint = useStudio((s) => s.ensureLint)
  const runLint = useStudio((s) => s.runLint)
  const manifest = useStudio((s) => s.manifest)
  const entries = useMemo(() => selectExportEntries({ manifest }), [manifest])
  const manifestLoading = useStudio((s) => s.manifestLoading)
  const manifestError = useStudio((s) => s.manifestError)
  const manifestUnavailable = useStudio((s) => s.manifestUnavailable)
  const bundleRunning = useStudio((s) => s.bundleRunning)
  const loadManifest = useStudio((s) => s.loadManifest)
  const runBundle = useStudio((s) => s.runBundle)
  const filingOpen = useStudio((s) => s.filingOpen)
  const setFilingOpen = useStudio((s) => s.setFilingOpen)
  const fileCase = useStudio((s) => s.fileCase)
  const deliverErrors = useStudio((s) => s.deliverErrors)
  const deliverErrorsLoading = useStudio((s) => s.deliverErrorsLoading)
  const deliverErrorsUnavailable = useStudio((s) => s.deliverErrorsUnavailable)
  const loadDeliverErrors = useStudio((s) => s.loadDeliverErrors)
  const openCaseForm = useStudio((s) => s.openCaseForm)
  const loadHistory = useStudio((s) => s.loadHistory)
  const versions = useStudio((s) => s.versions)
  const historyLoading = useStudio((s) => s.historyLoading)
  const historyUnavailable = useStudio((s) => s.historyUnavailable)
  const refreshCase = useStudio((s) => s.refreshCase)
  const confirmation = useStudio(useShallow(selectConfirmationState))
  const content = useStudio((s) => s.content)
  const figures = useStudio((s) => s.figures)
  const figuresPid = useStudio((s) => s.figuresPid)
  const figuresLoading = useStudio((s) => s.figuresLoading)
  const loadFigures = useStudio((s) => s.loadFigures)
  const locate = usePreflightLocate()
  const toast = useStudio((s) => s.toast)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tab, setTab] = useState<'checks' | 'exports' | 'info' | 'releases'>('exports')
  // M3：pid→平台案（case_key=目录名）。null ⇒ 纯旧案——发布包/平台体检入口整块不渲染，页面行为不变
  const [pcase, setPcase] = useState<PlatformCase | null>(null)
  useEffect(() => {
    let on = true
    void getPlatformCase(pid).then((c) => {
      if (on) setPcase(c)
    })
    return () => {
      on = false
    }
  }, [pid])
  const [downloading, setDownloading] = useState<string | null>(null)

  // 产物下载走 fetch → blob，不导航当前页（否则未保存守卫弹「离开站点」、后端错误 JSON 顶掉应用）
  // 单飞守卫用 ref：downloading 是 state，同拍双击两次都读旧值会通过守卫（R55-01）
  const downloadingRef = useRef<string | null>(null)
  const download = useCallback(
    async (url: string) => {
      if (downloadingRef.current) return
      downloadingRef.current = url
      setDownloading(url)
      try {
        await downloadFile(url)
      } catch (e) {
        toast(`下载失败：${e instanceof Error ? e.message : String(e)}`, 'error')
      } finally {
        downloadingRef.current = null
        setDownloading(null)
      }
    },
    [toast],
  )

  const loaded = project?.id === pid
  const kase = loaded ? project.case ?? null : null
  const title = loaded ? deliverTitle(project.title, kase?.case_no) : '递交'
  const role = loaded ? project.role ?? null : null
  const canFile = loaded && (authStatus === 'off' || superuser || role === 'agent' || role === 'owner')
  const canEdit = loaded && (authStatus === 'off' || superuser || role === 'agent' || role === 'owner' || role === 'editor')

  // 每次进递交页都重拉 case（客户在公开链接确认落在 case.json）与版本列（HEAD sha 决定确认徽章是否过期）：工作台里的副本可能已陈旧
  useEffect(() => {
    if (!loaded) return
    void ensureLint()
    void loadManifest(pid)
    void refreshCase(pid)
    void loadHistory(pid)
    // 就绪卡的「附图」检查项：深链直进递交页时 figures 分仓可能还没拉过
    if (useStudio.getState().figuresPid !== pid) void loadFigures(pid)
  }, [loaded, pid, ensureLint, loadManifest, refreshCase, loadHistory, loadFigures])

  // 台账字段错误跟着 case 走：递交页上补填申请人 / 发明人保存后立即重算，不等整页刷新
  useEffect(() => {
    if (!loaded) return
    void loadDeliverErrors(pid)
  }, [loaded, pid, kase, loadDeliverErrors])

  // 工作台同一条构建队列出了新产物 → 清单的 docx / pdf 时间与大小重拉；首次挂载不重复拉（上面那条 effect 已拉）
  const seenOkAt = useRef(lastOkAt)
  useEffect(() => {
    if (!loaded || lastOkAt === seenOkAt.current) return
    seenOkAt.current = lastOkAt
    void loadManifest(pid)
  }, [loaded, pid, lastOkAt, loadManifest])

  const onLocate = useCallback(
    (d: Diagnostic) => {
      const blockId = resolveBlockId(useStudio.getState().ast, null, d.line)
      if (blockId) goWorkbench(pid, { focus: blockId })
      else goWorkbench(pid)
      locate(d.line, blockId)
    },
    [pid, locate],
  )

  const fallbackHref: Partial<Record<ExportKind, string | null>> = {
    docx: lastOk ? api.exportUrl(pid, 'docx', lastOk.build_id) : null,
    pdf: lastOk ? api.exportUrl(pid, 'pdf', lastOk.build_id) : null,
    tracked: api.trackedDocxUrl(pid),
    figures: api.figuresExportUrl(pid),
  }

  const building = buildPhase === 'building' || buildPhase === 'queued'
  const buildError = netError ?? (buildOutcome?.status === 'error' ? buildOutcome.error?.message ?? '构建失败' : null)
  const xmlErrorMsg = xmlError ?? (xmlResult?.status === 'error' ? xmlResult.error?.message ?? '导出失败' : null)
  const xmlErrorLine = xmlResult?.status === 'error' ? xmlResult.error?.line ?? null : null
  const gotoSource = (line: number) => {
    goWorkbench(pid)
    locate(line, null)
  }
  const rebuild = () => enqueue('manual', true)
  const regen: Partial<Record<ExportKind, Regen>> = {
    docx: { run: rebuild, running: building, error: buildError },
    pdf: { run: rebuild, running: building, error: buildError },
    // 修订版按当前正文现算，正文构建不过则它也生不出来
    tracked: { running: false, error: buildError },
    xml: {
      run: () => void runXmlExport().then((r) => r && loadManifest(pid)),
      running: xmlRunning,
      error: xmlErrorMsg,
      errorAction: xmlErrorLine != null ? <FailureLocate line={xmlErrorLine} onGotoLine={gotoSource} /> : null,
    },
    bundle: { running: bundleRunning },
  }
  const xmlDetail =
    xmlResult?.status === 'ok' ? (
      <XmlReport
        res={xmlResult}
        err={null}
        at={xmlAt}
        embedded
        onGotoLine={gotoSource}
      />
    ) : undefined

  const hrefOf = (kind: ExportKind) => entries.find((e) => e.kind === kind)?.url ?? fallbackHref[kind] ?? null
  const docsFailed = !building && buildError !== null
  const docsReady = !docsFailed && !xmlErrorMsg && hrefOf('docx') !== null && hrefOf('pdf') !== null && hrefOf('xml') !== null
  const bundleReady = hrefOf('bundle') !== null
  const filed = kase?.status === 'filed' || kase?.status === 'granted' || kase?.status === 'rejected'
  const checkState: StepState = !lintRun ? (lintRunning ? 'active' : 'todo') : counts.error > 0 || deliverErrors.length > 0 ? 'error' : 'done'
  const steps: { label: string; state: StepState; hint?: string }[] = [
    { label: '递交体检', state: checkState, hint: lintRun ? `${counts.error} 错误 · ${counts.warning} 警告` : '进入页面自动检查' },
    {
      label: '生成产物',
      state: building || xmlRunning ? 'active' : docsFailed || xmlErrorMsg ? 'error' : docsReady ? 'done' : 'todo',
      hint: docsFailed ? 'DOCX / PDF 生成失败，先修正体检问题' : xmlErrorMsg ? 'XML 导出失败' : 'DOCX · PDF · XML',
    },
    { label: '打包递交', state: bundleReady ? 'done' : bundleRunning ? 'active' : docsReady ? 'active' : 'todo', hint: '递交包 zip' },
    { label: '标记已递交', state: filed ? 'done' : bundleReady ? 'active' : 'todo', hint: filed ? kase?.dates.filed ?? '' : '登记申请日 / 申请号' },
  ]

  const bundleButton = (
    <Button
      variant="primary"
      size="lg"
      className={isDesktop ? undefined : 'flex-1'}
      onClick={() => void runBundle()}
      disabled={manifestUnavailable || !loaded}
      loading={bundleRunning}
      loadingLabel="正在生成递交包"
      data-testid="export-bundle-run"
    >
      <Package aria-hidden /> 生成递交包
    </Button>
  )
  const secondaryActions = loaded ? (
    <>
      {canEdit && (
        <Button size={isDesktop ? 'lg' : 'icon-md'} variant="ghost" onClick={() => setSettingsOpen(true)} aria-label={isDesktop ? undefined : '案级设置'} data-testid="deliver-settings">
          <Settings2 aria-hidden />
          <span className={isDesktop ? undefined : 'sr-only'}>案级设置</span>
        </Button>
      )}
      {canFile && (
        <Button size={isDesktop ? 'lg' : 'icon-md'} variant="secondary" onClick={() => setFilingOpen(true)} aria-label={isDesktop ? undefined : filed ? '修改递交信息' : '标记为已递交'} data-testid="deliver-file">
          <CheckCircle2 aria-hidden />
          <span className={isDesktop ? undefined : 'sr-only'}>{filed ? '修改递交信息…' : '标记为已递交…'}</span>
        </Button>
      )}
    </>
  ) : null

  const checks = (
    <div className="flex min-h-0 flex-col gap-4" data-testid="deliver-checks">
      <FieldErrors errors={deliverErrors} loading={deliverErrorsLoading} unavailable={deliverErrorsUnavailable} onOpen={(field) => openCaseForm(pid, field)} />
      <CheckTable
        items={items}
        counts={counts}
        loading={lintRunning}
        error={lintRun?.error ?? null}
        stale={lintStale}
        ran={lintRun !== null}
        onRerun={() => void runLint()}
        onLocate={onLocate}
        mobile={!isDesktop}
      />
      {pcase && <PlatformPreflightCard key={pcase.id} caseId={pcase.id} />}
    </div>
  )
  const grid = (
    <ExportGrid
      manifest={manifest}
      loading={manifestLoading}
      unavailable={manifestUnavailable}
      error={manifestError}
      bundleRunning={bundleRunning}
      fallbackHref={fallbackHref}
      regen={regen}
      detail={{ xml: xmlDetail }}
      onDownload={(href) => void download(href)}
      downloading={downloading}
      mobile={!isDesktop}
    />
  )
  const empty = (
    <EmptyState
      icon={Package}
      title="还没有可递交的版本"
      reason="先在工作台构建一次，生成 DOCX / PDF 后再回到这里体检与打包。"
      size="sm"
      action={
        <Button variant="secondary" size="sm" asChild>
          <a href={`#${projectHash(pid)}`}>返回工作台构建</a>
        </Button>
      }
      className="rounded-md border border-dashed border-border bg-panel"
      data-testid="deliver-empty"
    />
  )
  // W19 批2 递交就绪聚合：必填（申请人/发明人/三书/附图/体检0错）+ 可选著录（费减/优先权）；
  // 每项「去补」直达补录位（案件表单聚焦字段 / 工作台 / 附图伴随栏 / 体检表）
  const kaseMeta = kase as CaseWithMeta | null
  const missingBooks = useMemo(() => {
    if (!loaded) return []
    const books = splitBooks(content).books
    return (['abstract', 'claims', 'description'] as const).filter((b) => !(books[b]?.text ?? '').trim()).map((b) => BOOK_LABELS[b])
  }, [loaded, content])
  const goChecks = () => {
    if (!isDesktop) setTab('checks')
    else document.querySelector('[data-testid="deliver-checks"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const readinessItems: ReadyItem[] = !loaded
    ? []
    : [
        {
          id: 'applicants',
          label: '申请人',
          ok: (kaseMeta?.applicants ?? []).some((a) => a.trim()),
          hint: (kaseMeta?.applicants ?? []).some((a) => a.trim()) ? undefined : '请求书必填',
          onFix: canEdit ? () => openCaseForm(pid, 'applicants') : undefined,
        },
        {
          id: 'inventors',
          label: '发明人',
          ok: (kaseMeta?.inventors ?? []).some((a) => a.trim()),
          hint: (kaseMeta?.inventors ?? []).some((a) => a.trim()) ? undefined : '请求书必填',
          onFix: canEdit ? () => openCaseForm(pid, 'inventors') : undefined,
        },
        { id: 'books', label: '三书（权项/说明书/摘要）', ok: missingBooks.length === 0, hint: missingBooks.length ? `缺 ${missingBooks.join('、')}` : undefined, onFix: () => void (window.location.hash = projectHash(pid)) },
        {
          id: 'figures',
          label: '附图',
          ok: figuresPid === pid ? figures.length > 0 : null,
          hint: figuresPid !== pid ? '清单未载入' : figures.length > 0 ? undefined : '未上传或未绘制',
          onFix: () => void (window.location.hash = projectHash(pid, { panel: 'figures' })),
        },
        {
          id: 'checks',
          label: '体检与著录校验',
          ok: lintRun !== null && counts.error === 0 && deliverErrors.length === 0,
          hint: lintRun === null ? '体检运行中' : counts.error + deliverErrors.length > 0 ? `${counts.error + deliverErrors.length} 项待清` : undefined,
          onFix: goChecks,
        },
        { id: 'fee', label: '费减备案（可选）', ok: kaseMeta?.fee_status ? true : null, hint: kaseMeta?.fee_status ? undefined : '符合条件未登记', onFix: canEdit ? () => openCaseForm(pid, 'fee_status') : undefined },
        { id: 'priority', label: '优先权（可选）', ok: (kaseMeta?.priority ?? []).length ? true : null, hint: (kaseMeta?.priority ?? []).length ? undefined : '无在先申请', onFix: canEdit ? () => openCaseForm(pid) : undefined },
      ]

  const side = (
    <>
      <FilingReadinessCard items={readinessItems} loading={(!loaded && projectLoading) || figuresLoading} />
      <DeadlineCard kase={kase} loading={!loaded && projectLoading} />
      <RecordCard kase={kase} versions={versions} loading={historyLoading} unavailable={historyUnavailable} />
      <ApplicantCard kase={kase} loading={!loaded && projectLoading} onEdit={canEdit ? () => openCaseForm(pid) : undefined} />
    </>
  )

  const nothingBuilt = loaded && !lastOk && !manifest?.items.some((e) => e.url)
  let body: ReactNode
  if (projectError && !loaded) {
    body = (
      <Alert variant="danger" data-testid="deliver-error">
        <TriangleAlert />
        <AlertTitle>无法打开案卷</AlertTitle>
        <AlertDescription>{projectError}</AlertDescription>
      </Alert>
    )
  } else if (!loaded && projectLoading) {
    body = (
      <div className="grid gap-4" role="status" aria-label="正在加载案卷" data-testid="deliver-loading">
        <Skeleton className="h-lg-control w-1/2" />
        <Skeleton lines={4} />
        <Skeleton lines={3} />
      </div>
    )
  } else if (isDesktop) {
    body = (
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,320px)] gap-6" data-testid="deliver-desktop">
        <div className="grid content-start gap-4">
          {nothingBuilt && empty}
          {checks}
          {grid}
          {pcase && <PlatformReleasesCard key={pcase.id} caseItem={pcase} />}
        </div>
        <div className="grid content-start gap-4">{side}</div>
      </div>
    )
  } else {
    body = (
      <Tabs value={tab === 'releases' && !pcase ? 'exports' : tab} onValueChange={(v) => setTab(v as typeof tab)} className="grid gap-4" data-testid="deliver-mobile">
        <TabsList className="-mx-page-m overflow-x-auto px-page-m scrollbar-none [&>*]:shrink-0" aria-label="递交内容" data-testid="deliver-tabs">
          <TabsTrigger value="checks" data-testid="deliver-tab-checks">
            体检{items.length ? ` · ${counts.error + counts.warning}` : ''}
          </TabsTrigger>
          <TabsTrigger value="exports" data-testid="deliver-tab-exports">
            导出产物
          </TabsTrigger>
          <TabsTrigger value="info" data-testid="deliver-tab-info">
            期限与记录
          </TabsTrigger>
          {pcase && (
            <TabsTrigger value="releases" data-testid="deliver-tab-releases">
              发布包
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="checks" className="grid gap-cards-m">
          {checks}
        </TabsContent>
        <TabsContent value="exports" className="grid gap-cards-m">
          {nothingBuilt && empty}
          {grid}
        </TabsContent>
        <TabsContent value="info" className="grid gap-cards-m">
          {side}
        </TabsContent>
        {pcase && (
          <TabsContent value="releases" className="grid gap-cards-m">
            <PlatformReleasesCard key={pcase.id} caseItem={pcase} />
          </TabsContent>
        )}
      </Tabs>
    )
  }

  return (
    <div data-slot="DeliverPage" data-testid="deliver-page" data-pid={pid} className="contents">
      <PageChrome
        name="deliver"
        title={title}
        documentTitle={`递交 · ${title}`}
        backHref={`#${projectHash(pid)}`}
        backLabel="返回工作台"
        breadcrumb={
          isDesktop && (
          <nav aria-label="位置" className="flex items-center gap-1.5">
            <a href="#/" className="hover:text-fg hover:underline">案卷</a>
            <span aria-hidden>/</span>
            <a href={`#${projectHash(pid)}`} className="hover:text-fg hover:underline">工作台</a>
            <span aria-hidden>/</span>
            <span className="text-fg">递交</span>
          </nav>
          )
        }
        description={loaded ? [kase?.case_no ? `案号 ${kase.case_no}` : null, versions.length ? `第 ${versions.length} 版` : null, kase?.client ? `客户 ${kase.client}` : null].filter(Boolean).join(' · ') || undefined : undefined}
        meta={
          loaded ? (
            <>
              {kase && <StatusDot status={kase.status} variant="badge" />}
              <ConfirmationBadge state={confirmation} />
            </>
          ) : undefined
        }
        actions={isDesktop ? secondaryActions : undefined}
        primary={loaded && isDesktop ? bundleButton : undefined}
        headerChildren={loaded ? <DeliverSteps steps={steps} compact={!isDesktop} /> : undefined}
        footer={
          loaded && !isDesktop ? (
            <>
              {secondaryActions}
              {bundleButton}
            </>
          ) : undefined
        }
      >
        {body}
      </PageChrome>

      <FilingDialog
        open={filingOpen}
        onOpenChange={setFilingOpen}
        initial={{ filed: kase?.dates.filed ?? undefined, application_no: kase?.dates.application_no ?? undefined }}
        draftKey={pid}
        onSubmit={fileCase}
      />
      <CaseSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CaseFormDialog />
    </div>
  )
}
