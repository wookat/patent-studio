import { useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronRight, Circle } from 'lucide-react'
import { StatusDot } from '@/components/ui/status-dot'
import { StatusPicker } from '@/components/dashboard/StatusPicker'
import { useCaseStatus } from '@/hooks/useCaseStatus'
import { goDeliver, goNovelty, goWorkbench } from '@/lib/hash'
import { FOCUS_RING, cn } from '@/lib/utils'
import { useStudio } from '@/store'
import { CASE_STATUSES, STATUS_LABEL, type CaseStatus } from '@/types/case'

interface StageAction {
  label: string
  /** 深链目标：deliver 递交页 / companion id / workbench */
  link?: 'deliver' | 'workbench' | 'deadlines' | 'figures' | 'problems' | 'ai' | 'oa' | 'novelty'
}

interface StageGuide {
  goal: string
  actions: StageAction[]
  exit: string
}

/**
 * 十档阶段导引（docs/design/w19-lifecycle.md）：真实代理流程的阶段目标/动作/出门条件，
 * 反哺密度基准嵌进撰写阶段自检口径。
 */
const STAGE_GUIDE: Record<CaseStatus, StageGuide> = {
  intake: {
    goal: '吃透交底材料，定出可专利的发明点',
    actions: [
      { label: '交底书：附件节「生成模板」按钮产出七段式模板，下载发给发明人', link: 'workbench' },
      { label: '读交底书/论文（附件节上传，或「转专利」直接起草）', link: 'workbench' },
      { label: '查新检索：AI 面板跑 s8 场景，对比文件落进查新记录卡', link: 'novelty' },
      { label: '发明点拿不准就先问发明人——批注 @ 客户', link: 'workbench' },
      { label: '术语表起步：核心名词先登记主名/别名', link: 'workbench' },
    ],
    exit: '发明点与布局策略（发明/新型/外观）确定 → 进入「撰写」',
  },
  drafting: {
    goal: '三书（权项/说明书/摘要）+ 附图成稿且质量过线',
    actions: [
      { label: '权项布局：独权方法先行，从权做退路限定（claims.md）', link: 'workbench' },
      { label: '密度自检：说明书 ≥ 9322 字 / 实施方式 ≥ 5769（语料中位，体检可自定阈值）', link: 'problems' },
      { label: '附图：附图书上传或画板绘制，标号表同步登记', link: 'figures' },
      { label: '跑体检清零（error 清零 / warning 逐条过）', link: 'problems' },
    ],
    exit: '三书齐、体检 0 error → 提交「内审」',
  },
  review: {
    goal: '质检意见闭环：每条批注/提案都有结论',
    actions: [
      { label: 'reviewer 逐章批注；代理师逐条答复或修订', link: 'workbench' },
      { label: '修订走提案卡（CriticMarkup 可回滚），别裸改正文', link: 'workbench' },
      { label: '复检：自称统一 / 密度 / 权项支持性 / 附图引用', link: 'problems' },
    ],
    exit: '批注与提案全部闭环 → 发「客户确认」',
  },
  client_review: {
    goal: '发明人/客户确认当前版本',
    actions: [
      { label: '分享只读链接给客户（协同抽屉 → 分享链接）', link: 'workbench' },
      { label: '客户批注逐条处理，必要时回「内审」再修', link: 'workbench' },
      { label: '客户点确认 → 台账留下 Confirmation 记录', link: 'workbench' },
    ],
    exit: '客户确认当前版本（确认卡 vN）→ 「定稿」',
  },
  final: {
    goal: '递交包完整可交：五书 + 著录项 + 费用',
    actions: [
      { label: '递交页核对要素清单（申请人/发明人/费减/优先权）', link: 'deliver' },
      { label: '构建 DOCX + XML 五书，0 error / 0 剔除警告', link: 'deliver' },
      { label: '台账补齐：案号/申请日/申请号位（递交后回填）', link: 'deliver' },
    ],
    exit: '递交包构建通过 → 递交（CPC/电子申请客户端）',
  },
  filed: {
    goal: '受理→初审→公布→实审，守住法定节点',
    actions: [
      { label: '登记申请号/申请日；受理通知书挂附件', link: 'deliver' },
      { label: '盯期限：实审请求 3 年死线 / 公布日 / 初审合格', link: 'deadlines' },
      { label: '优先权届满前评估分案/补正', link: 'deadlines' },
    ],
    exit: '进入实审 → 收到审查意见转「审查意见」',
  },
  oa: {
    goal: '按期答复审查意见（一通 4 个月 / 后续 2 个月）',
    actions: [
      { label: 'OA 工作台：上传通知书 → 拆条 → 逐条答复', link: 'oa' },
      { label: '修改权项走修订留痕，意见陈述书一键导出', link: 'oa' },
      { label: '答复期限标进期限面板，逾期视同撤回', link: 'deadlines' },
    ],
    exit: '授权通知 →「授权」；驳回决定 →「驳回」',
  },
  granted: {
    goal: '办登记 + 年费维持',
    actions: [
      { label: '2 个月内缴登记费 + 首年年费（期限面板已自动建）', link: 'deadlines' },
      { label: '证书/授权通知挂附件归档', link: 'workbench' },
      { label: '年费逐年盯——期限面板 annual_fee 自动续', link: 'deadlines' },
    ],
    exit: '维持至期满 / 放弃 →「结案」',
  },
  rejected: {
    goal: '评估复审价值，3 个月死线前决定',
    actions: [
      { label: '复审请求期限 3 个月——先登记进期限面板', link: 'deadlines' },
      { label: '复审理由 + 修改稿准备（对比驳回理由逐条）', link: 'workbench' },
      { label: '不复审/复审失败 → 结案归档', link: 'workbench' },
    ],
    exit: '复审翻案 → 回「审查意见」/「授权」；放弃 →「结案」',
  },
  closed: {
    goal: '归档复盘',
    actions: [
      { label: '台账归档（dashboard 归档列），案卷转只读参考', link: 'workbench' },
      { label: '复盘写入迭代报告：本案踩坑与模板沉淀', link: 'workbench' },
    ],
    exit: '终态——同族案可建新案引用本案',
  },
}

const LINK_LABEL: Record<NonNullable<StageAction['link']>, string> = {
  deliver: '递交页', workbench: '工作台', deadlines: '期限', figures: '附图', problems: '体检', ai: 'AI', oa: 'OA', novelty: '查新卡',
}

function ActionLink({ to }: { to: NonNullable<StageAction['link']> }) {
  const openCompanion = useStudio((s) => s.openCompanion)
  const setConsoleTab = useStudio((s) => s.setConsoleTab)
  const pid = useStudio((s) => s.pid)
  const go = () => {
    if (!pid) return
    if (to === 'deliver') goDeliver(pid)
    else if (to === 'novelty') goNovelty(pid)
    else if (to === 'workbench') goWorkbench(pid)
    else if (to === 'oa') {
      openCompanion('console')
      setConsoleTab('oa')
    } else openCompanion(to)
  }
  return (
    <button type="button" onClick={go} className={cn('ml-1 inline-flex items-center gap-0.5 rounded-sm text-link underline-offset-4 hover:underline', FOCUS_RING)} data-testid={`lifecycle-link-${to}`}>
      {LINK_LABEL[to]} <ChevronRight className="size-3" aria-hidden />
    </button>
  )
}

/**
 * 「流程」伴随面板：十档阶段步进（点击跳态，复用 setCaseStatus）+ 当前阶段导引卡。
 * viewer/无写权 → 步进只读。w19 批1。
 */
export function LifecyclePanel() {
  const { pid, status, canEdit } = useCaseStatus()
  const setCaseStatus = useStudio((s) => s.setCaseStatus)
  const cur: CaseStatus = status ?? 'intake'
  // 选中预览阶段（点行看导引不切换状态）；确认钮才真切换
  const [sel, setSel] = useState<CaseStatus | null>(null)
  const view = sel ?? cur
  const guide = STAGE_GUIDE[view]
  const curIdx = CASE_STATUSES.indexOf(cur)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4" data-testid="lifecycle-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <StatusDot status={cur} size="md" className="text-sm text-fg-strong" />
        </div>
        {pid && canEdit && (
          <StatusPicker pid={pid} status={cur}>
            <span className={cn('inline-flex items-center gap-1 rounded-sm text-xs text-link underline-offset-4 hover:underline', FOCUS_RING)} data-testid="lifecycle-change">
              切换阶段 <ChevronRight className="size-3" aria-hidden />
            </span>
          </StatusPicker>
        )}
      </div>

      <ol className="grid gap-0.5" aria-label="阶段步进">
        {CASE_STATUSES.map((s, i) => {
          const done = i < curIdx
          const active = s === cur
          return (
            <li key={s}>
              <button
                type="button"
                disabled={!pid}
                onClick={() => setSel(s === cur ? null : s)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm transition-colors',
                  FOCUS_RING,
                  s === view ? 'bg-brand-100 text-fg-strong font-medium' : done ? 'text-fg-muted hover:bg-hover' : 'text-fg hover:bg-hover',
                  !pid && 'cursor-default',
                )}
                data-testid={`lifecycle-stage-${s}`}
                aria-current={active ? 'step' : undefined}
                title={active ? '当前阶段' : `查看「${STATUS_LABEL[s]}」导引`}
              >
                {done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-ok-fg" aria-hidden />
                ) : active ? (
                  <StatusDot status={s} size="sm" label={<span className="sr-only">{STATUS_LABEL[s]}</span>} />
                ) : (
                  <Circle className="size-4 shrink-0 text-fg-faint" aria-hidden />
                )}
                {STATUS_LABEL[s]}
              </button>
            </li>
          )
        })}
      </ol>

      <section className="grid gap-2 rounded-md border border-border bg-panel p-3" aria-label="本阶段指引" data-testid="lifecycle-guide">
        <h3 className="text-sm font-semibold text-fg-strong">{view === cur ? '本阶段' : `预览 · ${STATUS_LABEL[view]}`} · {guide.goal}</h3>
        {view !== cur && pid && canEdit && (
          <button
            type="button"
            onClick={() => { void setCaseStatus(pid, view); setSel(null) }}
            className={cn('w-fit rounded-sm text-xs text-link underline-offset-4 hover:underline', FOCUS_RING)}
            data-testid="lifecycle-apply"
          >
            切换到「{STATUS_LABEL[view]}」
          </button>
        )}
        <ul className="grid gap-1.5">
          {guide.actions.map((a) => (
            <li key={a.label} className="flex items-start gap-1.5 text-sm text-fg">
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-fg-icon" aria-hidden />
              <span className="min-w-0">
                {a.label}
                {a.link && <ActionLink to={a.link} />}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-border pt-2 text-xs text-fg-muted">{guide.exit}</p>
      </section>
    </div>
  )
}
