import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link2, MessageSquarePlus, Plus, Save, Trash2 } from 'lucide-react'
import { ApiError, api } from '@/lib/api'
import { projectHash } from '@/lib/hash'
import { PageChrome } from '@/components/shell/PageChrome'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useIsDesktop } from '@/hooks/useMisc'
import { useStudio } from '@/store'
import {
  EVIDENCE_STATUSES, EVIDENCE_STATUS_LABEL,
  NOVELTY_RELEVANCES, NOVELTY_RELEVANCE_LABEL,
  type EvidenceStatus, type NoveltyHit, type NoveltyQuery, type NoveltyRecord, type NoveltyRelevance,
} from '@/types/novelty'

/**
 * W19 批4：查新记录卡 `#/p/<pid>/novelty`。
 * 真源 .studio/novelty.json（oa 台账同族）：检索式（≤20）+ 对比文件（≤50，ECLA X/Y/A/P 相关度）+ 结论。
 * s8 场景经 MCP record_novelty 增量合并写入；本页是人手编辑/复核的整页入口（05 §4 页惯例、deliver/board 同族）。
 * 脏态守卫：返回/首页链接 capture 拦截 → DiscardDialog；刷新/关页签走 beforeunload。
 * （⌘K 直改 hash 不在拦截面内——记录在案，后续若需要再做全局路由守卫。）
 */

const MAX_QUERIES = 20
const MAX_HITS = 50

const CLIP = { number: 64, title: 300, note: 2000, link: 500, query: 300, provider: 40, ran_at: 40 } as const

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function NoveltyPage({ pid }: { pid: string }) {
  const isDesktop = useIsDesktop()
  const project = useStudio((s) => s.project)
  const projectLoading = useStudio((s) => s.projectLoading)
  const authStatus = useStudio((s) => s.authStatus)
  const superuser = useStudio((s) => s.user?.is_superuser ?? false)
  const toast = useStudio((s) => s.toast)

  const [rec, setRec] = useState<NoveltyRecord | null>(null)
  const [base, setBase] = useState<NoveltyRecord | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [askDiscard, setAskDiscard] = useState<string | null>(null)
  const dirtyRef = useRef(false)
  // Z31 证据对照表单（局部状态，不进 dirty 守卫——登记即落库，随服务端回写 rec）
  const [evHit, setEvHit] = useState('')
  const [evClaim, setEvClaim] = useState('')
  const [evFeature, setEvFeature] = useState('')
  const [evQuote, setEvQuote] = useState('')
  const [evStatus, setEvStatus] = useState<EvidenceStatus>('hit')
  const [evBusy, setEvBusy] = useState(false)

  const loaded = project?.id === pid
  const role = loaded ? project.role ?? null : null
  const canEdit = loaded && (authStatus === 'off' || superuser || role === 'agent' || role === 'owner' || role === 'editor')

  const dirty = useMemo(() => {
    if (!rec || !base) return false
    return JSON.stringify(rec) !== JSON.stringify(base)
  }, [rec, base])
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // 换案（同页不同 pid）→ 渲染期重置（React 官方 adjust-state-on-prop-change，避免 effect 内同步 setState）
  const [prevPid, setPrevPid] = useState(pid)
  if (prevPid !== pid) {
    setPrevPid(pid)
    setRec(null)
    setBase(null)
    setLoadError(null)
  }

  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current // 迟发/换案响应闸——最后发起者落地
    try {
      const r = await api.getNovelty(pid)
      if (seq !== loadSeq.current) return
      setRec(r)
      setBase(r)
      setLoadError(null)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setLoadError(e instanceof ApiError ? e.message : '查新记录读取失败')
    }
  }, [pid])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect —— load 内的 setState 全在 await 之后（异步取数落地），非同步级联渲染
    void load()
  }, [load])

  // 刷新 / 关页签守卫
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // 返回 / 首页链接 capture 拦截（PageChrome 的 <a> 没有 onBeforeLeave 钩子，按 批67 惯例自拦）
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.('a[data-testid="novelty-back"], a[data-testid="novelty-home"]') as HTMLAnchorElement | null
      if (!a || !dirtyRef.current) return
      e.preventDefault()
      e.stopPropagation()
      setAskDiscard(a.getAttribute('href') ?? `#${projectHash(pid)}`)
    }
    document.addEventListener('click', h, true)
    return () => document.removeEventListener('click', h, true)
  }, [pid])

  const patch = useCallback(
    (fn: (r: NoveltyRecord) => NoveltyRecord) => {
      if (!canEdit) return
      setRec((r) => (r ? fn(r) : r))
    },
    [canEdit],
  )

  const setQuery = (i: number, patch2: Partial<NoveltyQuery>) =>
    patch((r) => ({ ...r, queries: r.queries.map((q, j) => (j === i ? { ...q, ...patch2 } : q)) }))
  const delQuery = (i: number) => patch((r) => ({ ...r, queries: r.queries.filter((_, j) => j !== i) }))
  const addQuery = () =>
    patch((r) =>
      r.queries.length >= MAX_QUERIES ? r : { ...r, queries: [...r.queries, { query: '', provider: '', ran_at: todayISO() }] },
    )

  const setHit = (i: number, patch2: Partial<NoveltyHit>) =>
    patch((r) => ({ ...r, hits: r.hits.map((h, j) => (j === i ? { ...h, ...patch2 } : h)) }))
  const delHit = (i: number) => patch((r) => ({ ...r, hits: r.hits.filter((_, j) => j !== i) }))
  const addHit = () =>
    patch((r) =>
      r.hits.length >= MAX_HITS
        ? r
        : { ...r, hits: [...r.hits, { number: '', title: '', relevance: 'A', note: '', link: '', publication_date: '' }] },
    )

  // 对比文件缺省取首个已登记行（下拉可换）
  const evHitKey = evHit || (rec?.hits[0] ? rec.hits[0].number || rec.hits[0].title : '')

  /** Z31：登记证据行；annotate=true 时另生成 claims/{claim} 审阅批注（不改正文） */
  const addEvidence = async (annotate: boolean) => {
    if (!rec || !evHitKey || evBusy) return
    const claimNum = evClaim.trim() ? Number(evClaim) : null
    const input = { hit: evHitKey, claim: claimNum, feature: evFeature.trim(), quote: evQuote.trim(), status: evStatus }
    setEvBusy(true)
    try {
      if (annotate) {
        if (claimNum == null) return
        const { comment, evidence } = await api.annotateEvidence(pid, { ...input, claim: claimNum })
        setRec((r) => (r ? { ...r, evidence: [...r.evidence, evidence] } : r))
        setBase((b) => (b ? { ...b, evidence: [...b.evidence, evidence] } : b))
        toast(`已生成权 ${claimNum} 审阅批注（批注 ${comment.id}，见工作台审阅面板）`, 'success')
      } else {
        const { evidence } = await api.addEvidence(pid, input)
        setRec((r) => (r ? { ...r, evidence: [...r.evidence, evidence] } : r))
        setBase((b) => (b ? { ...b, evidence: [...b.evidence, evidence] } : b))
        toast('证据行已登记', 'success')
      }
      setEvFeature('')
      setEvQuote('')
      setEvClaim('')
    } catch (e) {
      toast(e instanceof ApiError ? `登记失败：${e.message}` : '登记失败', 'error')
    } finally {
      setEvBusy(false)
    }
  }

  const save = async () => {
    if (!rec || !canEdit || saving) return
    setSaving(true)
    try {
      const r = await api.putNovelty(pid, { queries: rec.queries, hits: rec.hits, evidence: rec.evidence, conclusion: rec.conclusion })
      setRec(r)
      setBase(r)
      toast('查新记录已保存', 'success')
    } catch (e) {
      toast(e instanceof ApiError ? `保存失败：${e.message}` : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveButton = (
    <Button onClick={() => void save()} disabled={!dirty || saving} data-testid="novelty-save">
      <Save aria-hidden />
      {saving ? '保存中…' : '保存'}
    </Button>
  )

  const body = (() => {
    if (loadError) {
      return (
        <div role="alert" className="rounded-md border border-danger bg-panel p-4 text-sm">
          <p className="text-danger">{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              setLoadError(null)
              void load()
            }}
            data-testid="novelty-retry"
          >
            重试
          </Button>
        </div>
      )
    }
    if (!rec) {
      return (
        <div className="grid gap-cards-m" role="status" aria-label="正在加载查新记录" data-testid="novelty-loading">
          <div className="h-24 animate-pulse rounded-md bg-sunken" />
          <div className="h-40 animate-pulse rounded-md bg-sunken" />
        </div>
      )
    }
    return (
      <div className="grid gap-cards-l" data-testid="novelty-form">
        <section aria-labelledby="novelty-queries" className="grid gap-2">
          <div className="flex items-center justify-between">
            <h2 id="novelty-queries" className="text-sm font-semibold text-fg-strong">
              检索式
              <span className="ml-1 font-normal text-fg-subtle">（{rec.queries.length}/{MAX_QUERIES}）</span>
            </h2>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={addQuery} disabled={rec.queries.length >= MAX_QUERIES} data-testid="add-query">
                <Plus aria-hidden /> 添加检索式
              </Button>
            )}
          </div>
          {rec.queries.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-fg-subtle" data-testid="queries-empty">
              尚无检索记录——s8 查新场景或外部 agent 检完后会落到这里，也可手动补录
            </p>
          )}
          <ul className="grid gap-2">
            {rec.queries.map((q, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-panel p-2" data-testid={`query-row-${i}`}>
                <Input
                  className="min-w-56 flex-1"
                  value={q.query}
                  maxLength={CLIP.query}
                  disabled={!canEdit}
                  placeholder='检索式，如 (transformer AND 时间序列)'
                  aria-label={`检索式 ${i + 1}`}
                  data-testid={`query-text-${i}`}
                  onChange={(e) => setQuery(i, { query: e.target.value })}
                />
                <Input
                  className="w-32"
                  value={q.provider}
                  maxLength={CLIP.provider}
                  disabled={!canEdit}
                  placeholder="来源（如 OPS）"
                  aria-label={`来源 ${i + 1}`}
                  data-testid={`query-provider-${i}`}
                  onChange={(e) => setQuery(i, { provider: e.target.value })}
                />
                <Input
                  className="w-36"
                  type="date"
                  value={q.ran_at}
                  maxLength={CLIP.ran_at}
                  disabled={!canEdit}
                  aria-label={`检索日期 ${i + 1}`}
                  data-testid={`query-date-${i}`}
                  onChange={(e) => setQuery(i, { ran_at: e.target.value })}
                />
                {canEdit && (
                  <Button variant="ghost" size="icon-sm" aria-label={`删除检索式 ${i + 1}`} data-testid={`del-query-${i}`} onClick={() => delQuery(i)}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="novelty-hits" className="grid gap-2">
          <div className="flex items-center justify-between">
            <h2 id="novelty-hits" className="text-sm font-semibold text-fg-strong">
              对比文件
              <span className="ml-1 font-normal text-fg-subtle">（{rec.hits.length}/{MAX_HITS} · X 破坏新颖性 / Y 影响创造性 / A 背景 / P 申请日前后）</span>
            </h2>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={addHit} disabled={rec.hits.length >= MAX_HITS} data-testid="add-hit">
                <Plus aria-hidden /> 添加对比文件
              </Button>
            )}
          </div>
          {rec.hits.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-fg-subtle" data-testid="hits-empty">
              尚无对比文件
            </p>
          )}
          <ul className="grid gap-2">
            {rec.hits.map((h, i) => (
              <li key={i} className="grid gap-2 rounded-md border border-border bg-panel p-2" data-testid={`hit-row-${i}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-44"
                    value={h.number}
                    maxLength={CLIP.number}
                    disabled={!canEdit}
                    placeholder="公开号 CN…"
                    aria-label={`公开号 ${i + 1}`}
                    data-testid={`hit-number-${i}`}
                    onChange={(e) => setHit(i, { number: e.target.value })}
                  />
                  <Select
                    value={h.relevance}
                    onValueChange={(v) => setHit(i, { relevance: v as NoveltyRelevance })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="w-44" aria-label={`相关度 ${i + 1}`} data-testid={`hit-relevance-${i}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOVELTY_RELEVANCES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {NOVELTY_RELEVANCE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-36"
                    type="date"
                    value={h.publication_date}
                    disabled={!canEdit}
                    aria-label={`公开日期 ${i + 1}`}
                    title="公开日期"
                    data-testid={`hit-pubdate-${i}`}
                    onChange={(e) => setHit(i, { publication_date: e.target.value })}
                  />
                  <Input
                    className="min-w-40 flex-1"
                    value={h.link}
                    maxLength={CLIP.link}
                    disabled={!canEdit}
                    placeholder="链接（可空）"
                    aria-label={`链接 ${i + 1}`}
                    data-testid={`hit-link-${i}`}
                    onChange={(e) => setHit(i, { link: e.target.value })}
                  />
                  {h.link && (
                    <Button asChild variant="ghost" size="icon-sm">
                      <a href={h.link} target="_blank" rel="noreferrer" aria-label={`打开链接 ${i + 1}`} data-testid={`hit-open-${i}`}>
                        <Link2 aria-hidden />
                      </a>
                    </Button>
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="icon-sm" aria-label={`删除对比文件 ${i + 1}`} data-testid={`del-hit-${i}`} onClick={() => delHit(i)}>
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="min-w-64 flex-1"
                    value={h.title}
                    maxLength={CLIP.title}
                    disabled={!canEdit}
                    placeholder="专利名称"
                    aria-label={`名称 ${i + 1}`}
                    data-testid={`hit-title-${i}`}
                    onChange={(e) => setHit(i, { title: e.target.value })}
                  />
                  <Input
                    className="min-w-64 flex-1"
                    value={h.note}
                    maxLength={CLIP.note}
                    disabled={!canEdit}
                    placeholder="与本申请的区别 / 相关段落（可空）"
                    aria-label={`备注 ${i + 1}`}
                    data-testid={`hit-note-${i}`}
                    onChange={(e) => setHit(i, { note: e.target.value })}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="novelty-evidence" className="grid gap-2" data-testid="evidence-section">
          <h2 id="novelty-evidence" className="text-sm font-semibold text-fg-strong">
            证据对照批注
            <span className="ml-1 font-normal text-fg-subtle">（{rec.evidence.length} 条 · 机器筛选记录，供人工复核，非法律意见）</span>
          </h2>
          {rec.evidence.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-fg-subtle" data-testid="evidence-empty">
              尚无证据对照——登记对比文件后，把特征与证据原句逐条落在这里，并可生成锚到权项的审阅批注
            </p>
          ) : (
            <ul className="grid gap-2">
              {rec.evidence.map((ev) => (
                <li key={ev.id} className="rounded-md border border-border bg-panel p-2 text-xs" data-testid={`evidence-row-${ev.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg-strong">{ev.hit}</span>
                    {ev.claim != null && <Badge>权{ev.claim}</Badge>}
                    <Badge tone={ev.status === 'hit' ? 'danger' : ev.status === 'missing' ? 'ok' : 'neutral'}>
                      {EVIDENCE_STATUS_LABEL[ev.status]}
                    </Badge>
                  </div>
                  {ev.feature && <p className="mt-1 text-fg">特征：{ev.feature}</p>}
                  <p className="mt-0.5 text-fg-muted">原句：{ev.quote || '未提供（无全文/未检出），待核对'}</p>
                </li>
              ))}
            </ul>
          )}
          {canEdit && rec.hits.length > 0 && (
            <div className="grid gap-2 rounded-md border border-border bg-panel p-3" data-testid="evidence-form">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={evHitKey} onValueChange={setEvHit}>
                  <SelectTrigger className="w-56" aria-label="对比文件" data-testid="evidence-hit">
                    <SelectValue placeholder="选择对比文件" />
                  </SelectTrigger>
                  <SelectContent>
                    {rec.hits.map((h) => (
                      <SelectItem key={h.number || h.title} value={h.number || h.title}>
                        {h.number || h.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="w-28"
                  type="number"
                  min={1}
                  value={evClaim}
                  onChange={(e) => setEvClaim(e.target.value)}
                  placeholder="锚定权项"
                  aria-label="锚定权项编号"
                  data-testid="evidence-claim"
                />
                <Select value={evStatus} onValueChange={(v) => setEvStatus(v as EvidenceStatus)}>
                  <SelectTrigger className="w-40" aria-label="比对状态" data-testid="evidence-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s} disabled={s !== 'pending' && !evQuote.trim()}>
                        {EVIDENCE_STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={evFeature}
                onChange={(e) => setEvFeature(e.target.value)}
                maxLength={500}
                placeholder="对照特征（如：指纹特征点集合的构建）"
                aria-label="对照特征"
                data-testid="evidence-feature"
              />
              <Textarea
                value={evQuote}
                onChange={(e) => setEvQuote(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="证据原句（对比文件中的相关记载；留空则标待核对）"
                aria-label="证据原句"
                data-testid="evidence-quote"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void addEvidence(false)} disabled={!evHitKey || evBusy} data-testid="evidence-add">
                  登记证据行
                </Button>
                <Button size="sm" onClick={() => void addEvidence(true)} disabled={!evHitKey || !evClaim.trim() || evBusy} data-testid="evidence-annotate">
                  <MessageSquarePlus aria-hidden /> 登记并生成权项批注
                </Button>
                {evBusy && <span className="text-xs text-fg-muted">处理中…</span>}
              </div>
              <p className="text-xs text-fg-muted">
                批注锚到 claims/权N 块并出现在工作台审阅面板（source=ai）；不修改正文。无证据原句一律记「待核对」。
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="novelty-conclusion" className="grid gap-2">
          <h2 id="novelty-conclusion" className="text-sm font-semibold text-fg-strong">
            查新结论
          </h2>
          <Textarea
            value={rec.conclusion}
            maxLength={20000}
            disabled={!canEdit}
            rows={5}
            placeholder="对比文件与本申请的区别、可专利性初步判断（代理人复核后填写）"
            aria-label="查新结论"
            data-testid="novelty-conclusion-input"
            onChange={(e) => patch((r) => ({ ...r, conclusion: e.target.value }))}
          />
        </section>
      </div>
    )
  })()

  return (
    <div data-slot="NoveltyPage" data-testid="novelty-page" data-pid={pid} className="contents">
      <PageChrome
        name="novelty"
        title="查新记录"
        documentTitle={`查新记录 · ${project?.title ?? pid}`}
        backHref={`#${projectHash(pid)}`}
        backLabel="返回工作台"
        description={
          rec?.updated_at
            ? `更新于 ${rec.updated_at}`
            : '检索式 · 对比文件（X/Y/A/P）· 结论——与 s8 场景共享同一份档案'
        }
        actions={isDesktop && canEdit ? saveButton : undefined}
        footer={!isDesktop && canEdit ? saveButton : undefined}
      >
        {!canEdit && loaded && !projectLoading && (
          <p className="mb-cards-m rounded-md border border-border bg-sunken px-3 py-2 text-sm text-fg-subtle" data-testid="novelty-readonly">
            只读：查新记录由代理人 / 编辑维护
          </p>
        )}
        {body}
      </PageChrome>
      <DiscardDialog
        open={askDiscard !== null}
        onStay={() => setAskDiscard(null)}
        onDiscard={() => {
          const href = askDiscard ?? `#${projectHash(pid)}`
          setAskDiscard(null)
          window.location.hash = href
        }}
      />
    </div>
  )
}
