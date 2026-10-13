import { useEffect, useState } from 'react'
import { AlertTriangle, BookA, Loader2, Plus, ScanSearch, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Count } from '@/components/ui/count'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { EmptyState , NOT_IMPLEMENTED_TITLE } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useBeforeUnload } from '@/hooks/useBeforeUnload'
import { lineChipLabel } from '@/lib/diagLocation'
import { selectReadonly, selectTermIssueCount, useStudio } from '@/store'
import { gotoReview, writeCriticLines } from '@/components/ai/aiModel'
import type { Term, TermCandidate } from '@/types/terms'
import { CandidateList } from './CandidateList'
import { TermEditor } from './TermEditor'
import { EMPTY_TERM } from './termsModel'
import { TermFixButton } from './TermFixButton'
import { TermRow } from './TermRow'
import { FOCUS_RING, cn } from '@/lib/utils'
import { MSG_READONLY } from '@/lib/copy'

/**
 * 术语面板（Rail「术语」/ 移动 NavDrawer；docs/plan/09 §6.3）：
 * 术语表（主名 / 别名 / 英文 / 定义 / 首现行）增删改 → terms slice PUT；候选抽取（确定性，不出站）→ 采纳 / 忽略；
 * 一致性问题列表（lint `terms.*` 诊断，带一键改为主名）→ 「一键统一」调 unifyTerms：后端返回 CriticMarkup `{~~别名~>主名~~}`
 * 写回编辑器（非直接改写），随后跳到审阅面板逐条接受 / 拒绝。
 * 面板宽 ≥ TABLE_MIN_W（dockview 宽窗 / 桌面宽侧栏）用表格；窄容器（默认侧栏、375 抽屉）用卡片列表。
 */
const TABLE_MIN_W = 560

function useWide(el: HTMLElement | null, min: number): boolean {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= min))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, min])
  return wide
}
export function TermsPanel() {
  const pid = useStudio((s) => s.pid)
  const terms = useStudio((s) => s.terms)
  const loading = useStudio((s) => s.termsLoading)
  const saving = useStudio((s) => s.termsSaving)
  const termsError = useStudio((s) => s.termsError)
  const unavailable = useStudio((s) => s.termsUnavailable)
  const termsPid = useStudio((s) => s.termsPid)
  const candidatesLoading = useStudio((s) => s.candidatesLoading)
  const items = useStudio((s) => s.items)
  const issueCount = useStudio(selectTermIssueCount)
  const readonly = useStudio(selectReadonly)
  const loadTerms = useStudio((s) => s.loadTerms)
  const upsertTerm = useStudio((s) => s.upsertTerm)
  const removeTerm = useStudio((s) => s.removeTerm)
  const saveTerms = useStudio((s) => s.saveTerms)
  const extractTerms = useStudio((s) => s.extractTerms)
  const adoptCandidate = useStudio((s) => s.adoptCandidate)
  const unifyTerms = useStudio((s) => s.unifyTerms)
  const gotoLine = useStudio((s) => s.gotoLine)
  const ast = useStudio((s) => s.ast)
  const toast = useStudio((s) => s.toast)
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const wide = useWide(host, TABLE_MIN_W)
  /* 批71：编辑态/五字段草稿存 store（termDraft，key='new' 或术语名）——面板随侧栏换面板/抽屉关闭/宿主卸载不再丢稿；
     editing 由 store 草稿派生：新增恒可恢复、行编辑需词条仍在（删词/改名后自然收口） */
  const termDraft = useStudio((s) => s.termDraft)
  const setTermDraft = useStudio((s) => s.setTermDraft)
  const editing: Term | 'new' | null = termDraft ? (termDraft.key === 'new' ? 'new' : (terms.find((t) => t.name === termDraft.key) ?? null)) : null
  /* 脏态 = 草稿字段偏离该词条原始值；待决动作挂起经 DiscardDialog 裁决 */
  const draftDirty = termDraft && (termDraft.key === 'new'
    ? !!(termDraft.name || termDraft.aliases || termDraft.en || termDraft.definition || termDraft.firstLine)
    : (() => {
        const t = terms.find((x) => x.name === termDraft.key)
        return t
          ? termDraft.name !== t.name || termDraft.aliases !== t.aliases.join('、') || termDraft.en !== (t.en ?? '') || termDraft.definition !== (t.definition ?? '') || termDraft.firstLine !== (t.first_line?.toString() ?? '')
          : false
      })())
  const [pending, setPending] = useState<(() => void) | null>(null)
  const guard = (act: () => void) => (draftDirty ? setPending(() => act) : act())
  const requestEdit = (t: Term) => guard(() => setTermDraft({ key: t.name, name: t.name, aliases: t.aliases.join('、'), en: t.en ?? '', definition: t.definition ?? '', firstLine: t.first_line?.toString() ?? '' }))
  const requestNew = () => guard(() => setTermDraft({ key: 'new', name: '', aliases: '', en: '', definition: '', firstLine: '' }))
  const requestCancel = () => guard(() => setTermDraft(null))
  useBeforeUnload(() => !!draftDirty)
  const [unifying, setUnifying] = useState(false)

  useEffect(() => {
    if (pid && termsPid !== pid) void loadTerms(pid)
  }, [pid, termsPid, loadTerms])

  if (!pid) return <p className="px-3 py-2 text-xs text-fg-muted">尚未打开案子</p>
  if (unavailable) {
    return (
      <div data-slot="TermsPanel" data-testid="terms-panel" className="flex h-full min-h-0 flex-col">
        <EmptyState size="sm" icon={BookA} title={NOT_IMPLEMENTED_TITLE} reason="术语表的后端接口尚未上线（返回 501）。上线后这里管理主名 / 别名 / 英文 / 定义，正文出现别名时在「问题」里给出一键改为主名的诊断。" />
      </div>
    )
  }

  const issues = items.filter((d) => d.id.startsWith('terms.'))
  const issuesByTerm = new Map<string, number>()
  for (const d of issues) if (d.replace) issuesByTerm.set(d.replace.to, (issuesByTerm.get(d.replace.to) ?? 0) + 1)

  const save = async (t: Term) => {
    const prev = termDraft && termDraft.key !== 'new' ? termDraft.key : null
    // 改名保持原位（整表 PUT）：filter+append 会把被改名的词甩到表尾
    const next = prev && prev !== t.name ? terms.map((x) => (x.name === prev ? t : x)) : null
    const ok = next ? await saveTerms(next) : await upsertTerm(t)
    if (ok) {
      setTermDraft(null)
      toast(prev ? `术语「${t.name}」已保存` : `已添加术语「${t.name}」`, 'success')
    }
  }
  const remove = async (t: Term) => {
    if (await removeTerm(t.name)) toast(`已删除术语「${t.name}」`, 'success')
  }
  const adopt = async (c: TermCandidate) => {
    const t = adoptCandidate(c)
    if (await upsertTerm(t)) toast(`已采纳「${t.name}」`, 'success')
  }
  const unify = async () => {
    if (unifying) return
    setUnifying(true)
    const r = await unifyTerms()
    setUnifying(false)
    if (r == null) return
    if (r.count === 0 || r.changed_lines.length === 0) {
      toast('正文没有需要统一的别名', 'info')
      return
    }
    const lo = Math.min(...r.changed_lines)
    const hi = Math.max(...r.changed_lines)
    writeCriticLines(lo, hi, r.critic_markdown.split('\n').slice(lo - 1, hi).join('\n'))
    toast(`已在 ${r.count} 处生成「别名 → 主名」修订建议，请在审阅面板接受或拒绝`, 'success')
    gotoReview()
  }

  const others = (t: Term | 'new' | null) => (t && t !== 'new' ? terms.filter((x) => x.name !== t.name) : terms)

  return (
    <div ref={setHost} data-slot="TermsPanel" data-testid="terms-panel" data-layout={wide ? 'table' : 'cards'} className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="术语操作" data-testid="terms-toolbar">
        <Button size="sm" variant="secondary" onClick={requestNew} disabled={readonly || editing === 'new'} title={readonly ? MSG_READONLY : undefined} data-testid="terms-add">
          <Plus aria-hidden /> 新增
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void extractTerms()} disabled={readonly || candidatesLoading} title={readonly ? MSG_READONLY : undefined} aria-busy={candidatesLoading || undefined} data-testid="terms-extract">
          {candidatesLoading ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ScanSearch aria-hidden />} 抽取候选
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void unify()}
          disabled={readonly || unifying || terms.length === 0}
          aria-busy={unifying || undefined}
          title="把正文中的别名改为主名，作为修订建议写入，由你在审阅面板接受或拒绝"
          data-testid="terms-unify"
        >
          {unifying ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Wand2 aria-hidden />} 一键统一{issueCount > 0 ? `（${issueCount}）` : ''}
        </Button>
      </div>

      {editing === 'new' && (
        <TermEditor initial={EMPTY_TERM} others={terms} saving={saving} error={termsError} onSave={(t) => void save(t)} onCancel={requestCancel} />
      )}

      {issues.length > 0 && (
        <section aria-label="术语一致性问题" className="flex flex-col gap-1" data-testid="terms-issues">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-strong">
            一致性问题
            <Count value={issues.length} tone="brand" />
          </h3>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {issues.map((d) => (
              <li key={d.id} className="flex min-h-row-menu items-center gap-2 rounded-sm border border-l-2 border-border border-l-warn-dot bg-warn-bg px-2 py-1 text-xs text-warn-fg" data-testid="terms-issue">
                {d.line != null && (
                  <button type="button" className={cn('shrink-0 rounded-xs font-mono tabular-nums underline-offset-2 hover:underline', FOCUS_RING)} onClick={() => gotoLine(d.line as number)} aria-label={`跳到：${lineChipLabel(d.line as number, ast)}`}>
                    {lineChipLabel(d.line as number, ast)}
                  </button>
                )}
                <span className="min-w-0 flex-1 truncate" title={d.message}>
                  {d.message}
                </span>
                <TermFixButton d={d} className="shrink-0" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <CandidateList onAdopt={(c) => void adopt(c)} />

      {loading ? (
        <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="术语表加载中" data-testid="terms-loading">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-row-menu w-full" />)}
        </div>
      ) : terms.length === 0 ? (
        termsError ? (
          // 加载失败（如 terms.json 腐坏 422）：错误态 + 重试，不冒充「空表」（R74-01）
          <EmptyState
            size="sm"
            icon={AlertTriangle}
            title="术语表加载失败"
            reason={termsError}
            action={<Button size="sm" variant="secondary" onClick={() => void loadTerms(pid)}>重试</Button>}
            data-testid="terms-error"
          />
        ) : (
          <EmptyState size="sm" icon={BookA} title="还没有术语" reason="点「抽取候选」从正文找高频名词与附图标记名称，或「新增」手工录入。" data-testid="terms-empty" />
        )
      ) : wide ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs" aria-label="术语表" data-testid="terms-table">
            <thead className="bg-sunken text-left text-2xs font-medium uppercase tracking-wide text-fg-muted">
              <tr className="h-row-menu">
                <th scope="col" className="px-2 font-medium">主名</th>
                <th scope="col" className="px-2 font-medium">别名</th>
                <th scope="col" className="px-2 font-medium">英文</th>
                <th scope="col" className="px-2 font-medium">定义</th>
                <th scope="col" className="px-2 font-medium">首现</th>
                <th scope="col" className="px-1">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {terms.map((t) =>
                editing !== 'new' && editing?.name === t.name ? (
                  <tr key={t.name}>
                    <td colSpan={6} className="p-1">
                      <TermEditor initial={t} others={others(t)} saving={saving} error={termsError} onSave={(x) => void save(x)} onCancel={requestCancel} />
                    </td>
                  </tr>
                ) : (
                  <TermRow
                    key={t.name}
                    term={t}
                    issueCount={issuesByTerm.get(t.name) ?? 0}
                    variant="table"
                    onEdit={() => requestEdit(t)}
                    onDelete={() => void remove(t)}
                    onGotoLine={gotoLine}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <ul aria-label="术语表" className="flex flex-col gap-1.5" data-testid="terms-list">
          {terms.map((t) =>
            editing !== 'new' && editing?.name === t.name ? (
              <li key={t.name}>
                <TermEditor initial={t} others={others(t)} saving={saving} error={termsError} onSave={(x) => void save(x)} onCancel={requestCancel} />
              </li>
            ) : (
              <TermRow
                key={t.name}
                term={t}
                issueCount={issuesByTerm.get(t.name) ?? 0}
                variant="card"
                onEdit={() => requestEdit(t)}
                onDelete={() => void remove(t)}
                onGotoLine={gotoLine}
              />
            ),
          )}
        </ul>
      )}
      {termsError && editing === null && terms.length > 0 && (
        <p role="alert" className="text-xs text-danger-fg" data-testid="terms-error">
          {termsError}
        </p>
      )}
      {/* 批71：脏稿待决——换编辑目标 / 新增 / 取消先问（选「放弃」即执行挂起动作并清 store 草稿） */}
      <DiscardDialog
        open={pending !== null}
        onStay={() => setPending(null)}
        onDiscard={() => {
          const act = pending
          setPending(null)
          act?.()
        }}
      />
    </div>
  )
}
