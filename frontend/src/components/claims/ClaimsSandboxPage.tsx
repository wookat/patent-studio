import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import { api } from '@/lib/api'
import type { ApiError } from '@/lib/api'
import type { ClaimDetail, ClaimPreview } from '@/lib/api/claims'
import { projectHash } from '@/lib/hash'
import type { ClaimNode } from '@/types/preflight'
import { ClaimTree } from '@/components/preflight/ClaimTree'
import { ruleLabel } from '@/components/preflight/preflightUtils'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tag } from '@/components/ui/tag'
import { Skeleton } from '@/components/ui/skeleton'

/** Z20 权项沙盘：只读依赖图 + 「若调整引用」安全预览；不产生任何写操作。 */
function numSet(nums?: number[]) {
  return (nums ?? []).join('、') || '—'
}

function RefChips({ nums, onPick }: { nums: number[]; onPick?: (n: number) => void }) {
  if (!nums.length) return <span className="text-fg-muted">—</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          className="h-5 rounded-sm border border-border bg-panel px-1.5 text-xs text-fg hover:bg-hover disabled:cursor-default"
          onClick={() => onPick?.(n)}
          disabled={!onPick}
          data-testid={`ref-chip-${n}`}
        >
          权{n}
        </button>
      ))}
    </span>
  )
}

function SupportTable({ rows }: { rows: ClaimDetail['support'] }) {
  if (!rows?.length) return <p className="text-xs text-fg-muted">本权项术语未在 support_map 中出现（可能全部命中说明书或术语表为空）。</p>
  return (
    <table className="w-full text-left text-xs" data-testid="claim-support">
      <thead className="text-fg-muted">
        <tr><th className="py-1 pr-3 font-normal">术语</th><th className="py-1 pr-3 font-normal">涉及权项</th><th className="py-1 pr-3 font-normal">说明书支持</th><th className="py-1 font-normal">段落锚点（行）</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.term} className="border-t border-border">
            <td className="py-1 pr-3 text-fg-strong">{r.term}</td>
            <td className="py-1 pr-3">{numSet(r.claims)}</td>
            <td className="py-1 pr-3">{r.supported ? <Badge tone="ok">已支持</Badge> : <Badge tone="danger">未见支持</Badge>}</td>
            <td className="py-1 text-fg-muted">{numSet(r.description_lines)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PreviewResult({ r, onPick }: { r: ClaimPreview; onPick: (n: number) => void }) {
  return (
    <div className="mt-3 space-y-3" data-testid="claim-preview-result">
      {!r.ok ? (
        <div className="rounded-md border border-danger-fg/40 bg-danger-bg/40 p-3" data-testid="preview-blockers">
          <p className="text-xs font-semibold text-danger-fg">调整被阻断（{r.blockers.length} 项）</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-danger-fg">
            {r.blockers.map((b, i) => <li key={i}>{b.message}</li>)}
          </ul>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-panel p-3">
          <p className="text-xs font-semibold text-fg-strong">预览通过：调整在当前图上不引入结构错误</p>
          {r.warnings.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-warn-fg" data-testid="preview-warnings">
              {r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          )}
          <dl className="mt-2 grid grid-cols-[5.5rem_1fr] gap-y-1 text-xs">
            <dt className="text-fg-muted">引用差异</dt>
            <dd>新增 <RefChips nums={r.ref_diff?.added ?? []} onPick={onPick} /> · 移除 <RefChips nums={r.ref_diff?.removed ?? []} onPick={onPick} /></dd>
            <dt className="text-fg-muted">新引用链上游</dt>
            <dd><RefChips nums={r.upstream ?? []} onPick={onPick} /></dd>
            <dt className="text-fg-muted">下游受影响</dt>
            <dd><RefChips nums={r.downstream ?? []} onPick={onPick} /></dd>
          </dl>
        </div>
      )}
      <p className="text-xs text-fg-muted">仅为沙盘推演，未修改正文。确认调整请回工作台修订权利要求书文本；AI 变更一律经提案通道由人工采纳。</p>
    </div>
  )
}

export function ClaimsSandboxPage({ pid }: { pid: string }) {
  const [tree, setTree] = useState<ClaimNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<ClaimDetail | null>(null)
  const [refsInput, setRefsInput] = useState('')
  const [preview, setPreview] = useState<ClaimPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    api
      .getPreflight(pid, {}, ac.signal)
      .then((r) => setTree(r.claim_tree ?? []))
      .catch((e: ApiError) => {
        if (e.name !== 'AbortError' && !ac.signal.aborted) setError(e.message ?? '加载体检报告失败')
      })
    return () => ac.abort()
  }, [pid])

  const select = useCallback(
    (num: number) => {
      setSelected(num)
      setPreview(null)
      setRefsInput('')
      api
        .claimDetail(pid, num)
        .then(setDetail)
        .catch((e: ApiError) => setDetail({ claim: num, ok: false, blockers: [{ kind: 'unknown_claim', message: e.message }] }))
    },
    [pid],
  )

  const byNum = useMemo(() => new Map((tree ?? []).map((n) => [n.num, n])), [tree])
  const candidates = useMemo(
    () => (tree ?? []).map((n) => n.num).filter((n) => n !== selected && n < (selected ?? 0)).sort((a, b) => a - b),
    [tree, selected],
  )

  const runPreview = () => {
    if (selected == null) return
    const refs = refsInput
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n))
    setPreviewLoading(true)
    api
      .claimPreview(pid, selected, refs)
      .then(setPreview)
      .catch((e: ApiError) => setPreview({ claim: selected, ok: false, blockers: [{ kind: 'unknown_claim', message: e.message }], warnings: [] }))
      .finally(() => setPreviewLoading(false))
  }

  const node = selected != null ? byNum.get(selected) : undefined

  return (
    <div className="flex min-h-dvh flex-col bg-app" data-testid="claims-sandbox-page">
      <PageHeader
        size="md"
        breadcrumb={
          <a href={`#${projectHash(pid)}`} className="inline-flex items-center gap-1 text-fg-muted hover:text-fg-strong">
            <ArrowLeft className="size-3" aria-hidden /> 工作台
          </a>
        }
        title="权项沙盘"
        description="权项依赖与证据联动（只读）：独立/从属、引用链、下游受影响权项与说明书支持锚点。「若调整引用」仅推演，不改正文。"
      />
      <main className="mx-auto w-full max-w-6xl flex-1 gap-4 px-4 py-4 md:grid md:grid-cols-[17rem_1fr] md:px-page-x">
        <section className="mb-4 rounded-md border border-border bg-panel md:mb-0" aria-label="权项树">
          <p className="border-b border-border px-3 py-2 text-xs font-semibold text-fg-strong">权项树</p>
          {error ? (
            <p className="p-3 text-xs text-danger-fg" role="alert">{error}</p>
          ) : tree === null ? (
            <div className="space-y-1 p-3"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-4/5" /><Skeleton className="h-5 w-3/5" /></div>
          ) : tree.length === 0 ? (
            <EmptyState title="未解析到权利要求" reason="当前文档没有可解析的权项编号；请先在权利要求书中编写权项。" className="m-2" />
          ) : (
            <ClaimTree nodes={tree} onSelect={select} />
          )}
        </section>

        <section className="space-y-4" aria-label="权项详情与预览">
          {selected == null ? (
            <EmptyState
              title="在左侧选择一项权利要求"
              reason="查看其引用关系、下游受影响权项与说明书支持锚点；或输入调整后的引用编号做安全预览。"
              className="rounded-md border border-border bg-panel p-6"
            />
          ) : detail === null ? (
            <div className="space-y-2 rounded-md border border-border bg-panel p-4"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-16 w-full" /></div>
          ) : !detail.ok ? (
            <p className="rounded-md border border-border bg-panel p-4 text-sm text-danger-fg" role="alert">{detail.blockers?.[0]?.message ?? '加载失败'}</p>
          ) : (
            <>
              <div className="rounded-md border border-border bg-panel p-4" data-testid="claim-detail">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-fg-strong">权利要求 {selected}</h2>
                  {node?.kind === 'independent' ? <Badge tone="brand">独立</Badge> : <Badge>从属</Badge>}
                  {node?.category && <Tag>{node.category}</Tag>}
                  {(node?.issues ?? []).map((r) => (
                    <Badge key={r} tone="danger" title={r}>{ruleLabel(r)}</Badge>
                  ))}
                </div>
                <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-y-2 text-xs">
                  <dt className="text-fg-muted">当前引用</dt>
                  <dd><RefChips nums={detail.current_refs ?? []} onPick={select} /></dd>
                  <dt className="text-fg-muted">直接从属</dt>
                  <dd><RefChips nums={detail.direct_dependents ?? []} onPick={select} /></dd>
                  <dt className="text-fg-muted">下游受影响</dt>
                  <dd><RefChips nums={detail.downstream ?? []} onPick={select} /></dd>
                  <dt className="text-fg-muted">现状上游链</dt>
                  <dd><RefChips nums={detail.upstream ?? []} onPick={select} /></dd>
                </dl>
                <h3 className="mt-4 text-xs font-semibold text-fg-strong">支持段落 / 术语锚点</h3>
                <div className="mt-1"><SupportTable rows={detail.support} /></div>
              </div>

              <div className="rounded-md border border-border bg-panel p-4" data-testid="claim-preview-form">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-strong"><FlaskConical className="size-3.5" aria-hidden /> 若调整引用（安全预览）</h3>
                <p className="mt-1 text-xs text-fg-muted">输入调整后的引用编号（逗号分隔；留空 = 改为独立权项）。仅校验：无效 / 缺失 / 自引用 / 前向 / 循环引用将被阻断。</p>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    value={refsInput}
                    onChange={(e) => setRefsInput(e.target.value)}
                    placeholder={detail.current_refs?.length ? `当前：${detail.current_refs.join(',')}` : '如：1, 2'}
                    className="h-sm-control w-48 text-xs"
                    aria-label="调整后引用编号"
                    data-testid="preview-refs-input"
                  />
                  <Button size="sm" variant="secondary" onClick={runPreview} disabled={previewLoading} data-testid="preview-run">
                    {previewLoading ? '推演中…' : '推演'}
                  </Button>
                </div>
                {candidates.length > 0 && (
                  <p className="mt-2 text-xs text-fg-muted">
                    可引（编号在前）：
                    {candidates.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className="ml-1 inline-flex h-5 rounded-sm border border-border bg-panel px-1.5 text-xs hover:bg-hover"
                        onClick={() =>
                          setRefsInput((cur) => {
                            const set = new Set(cur.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean))
                            if (set.has(String(n))) set.delete(String(n))
                            else set.add(String(n))
                            return [...set].sort((a, b) => Number(a) - Number(b)).join(',')
                          })
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </p>
                )}
                {preview && <PreviewResult r={preview} onPick={select} />}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
