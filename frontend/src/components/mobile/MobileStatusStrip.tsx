import { useShallow } from 'zustand/react/shallow'
import { fmtMs } from '@/lib/format'
import { StatusPill } from '@/components/shell/StatusPill'
import { blockLabel } from '@/components/review/reviewUtils'
import { diagLocationLabel } from '@/lib/diagLocation'
import { ROLE_LABEL } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useStudio, selectDirty, selectAbstractLive, selectSummary, selectRoleKnown } from '@/store'

const COLLAB_LABEL = {
  off: null,
  connecting: '协同连接中',
  connected: '协同中',
  reconnecting: '协同重连中',
} as const

/**
 * 移动状态条两行（21 §4.3 状态栏行 / 20 §9）：
 * ① 定位文案（aria-live=polite）：「已定位 权利要求 3 · 第 8 页」（store.focus 最近一次三视图定位）或光标所在「说明书 · 段落 [0012]」（AST 未就位时「行 N，列 M」）；
 * ② 角色 · 构建 · 协同（在线数）· ●未保存 · 摘要 n/限 · 权项 · 页 · 编辑→预览耗时 · soffice 缺失——横向滚动 chip，「·」分隔。
 * 每行 --h-statusbar（24），不撑高。
 */
export function MobileStatusStrip({ showPage = false }: { showPage?: boolean }) {
  const dirty = useStudio(selectDirty)
  const abs = useStudio(useShallow(selectAbstractLive))
  const summary = useStudio(selectSummary)
  const phase = useStudio((s) => s.phase)
  const previewMs = useStudio((s) => s.previewMs)
  const page = useStudio((s) => s.pageInfo)
  const soffice = useStudio((s) => s.health?.soffice ?? null)
  const focus = useStudio((s) => s.focus)
  const ast = useStudio((s) => s.ast)
  const cursor = useStudio(useShallow((s) => s.cursor))
  const role = useStudio((s) => s.project?.role ?? null)
  const roleKnown = useStudio(selectRoleKnown)
  const collab = useStudio((s) => s.collabStatus)
  const peers = useStudio((s) => s.peers.length)

  const chip = 'inline-flex h-full shrink-0 items-center whitespace-nowrap'
  const row =
    'flex h-statusbar w-full min-w-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
  const cursorAt = diagLocationLabel({ line: cursor.line }, ast)
  const located = focus
    ? ['已定位 ' + blockLabel(ast, focus.blockId), focus.page ? `第 ${focus.page} 页` : null].filter(Boolean).join(' · ')
    : cursorAt
  const collabText = COLLAB_LABEL[collab]

  return (
    <footer
      data-slot="MobileStatusStrip"
      data-testid="status-bar"
      className="flex w-full min-w-0 shrink-0 flex-col border-t bg-sunken text-xs leading-none text-fg-muted tabular"
      aria-label="状态条"
    >
      <div className={cn(row, 'border-b border-border/60')} role="region" aria-label="定位" tabIndex={0} aria-live="polite" aria-atomic="true" data-testid="status-locate">
        <span className={cn(chip, 'text-fg')}>{located}</span>
      </div>
      <div className={cn(row, "[&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·']")} role="region" aria-label="角色与构建状态" tabIndex={0} data-testid="status-meta">
        <span className={chip} data-testid="chip-role">
          {roleKnown && role ? ROLE_LABEL[role] : '角色确认中'}
        </span>
        <span
          className={cn(
            chip,
            '[&_[data-testid=build-status]]:h-4.5 [&_[data-testid=build-status]]:rounded [&_[data-testid=build-status]]:bg-transparent [&_[data-testid=build-status]]:px-0 [&_[data-testid=build-status]]:py-0 [&_[data-testid=build-status]]:text-xs',
          )}
        >
          <StatusPill />
        </span>
        {collabText && (
          <span className={cn(chip, collab === 'connected' ? 'text-ok-fg' : 'text-warn-fg')} data-testid="chip-collab">
            {collabText}
            {collab === 'connected' && peers > 0 ? ` ${peers + 1} 人` : ''}
          </span>
        )}
        {dirty && (
          <span className={cn(chip, 'text-warn-fg')} data-testid="chip-dirty">
            ● 未保存
          </span>
        )}
        <span className={cn(chip, abs.over && 'text-danger-fg', abs.near && 'text-warn-fg')} data-testid="chip-abstract">
          摘要 <b className={cn('mx-0.5', abs.over ? 'text-danger-fg' : abs.near ? 'text-warn-fg' : 'text-fg')}>{abs.chars}</b>/{abs.limit}
        </span>
        {summary && (
          <span className={chip}>
            权项 <b className="ml-0.5 text-fg">{summary.claims}</b>
          </span>
        )}
        {phase !== 'error' &&
          (showPage && page && page.total > 0 ? (
            <span className={chip} data-testid="chip-page">
              页 <b className="mx-0.5 text-fg">{page.page}</b>/{page.total}
            </span>
          ) : (
            summary && (
              <span className={chip}>
                页 <b className="ml-0.5 text-fg">{summary.pages ?? '-'}</b>
              </span>
            )
          ))}
        {previewMs != null && phase === 'ok' && (
          <span className={chip} data-testid="preview-e2e">
            编辑→预览 {fmtMs(previewMs)}
          </span>
        )}
        {soffice === false && <span className={cn(chip, 'text-danger-fg')}>未检测到 LibreOffice</span>}
      </div>
    </footer>
  )
}
