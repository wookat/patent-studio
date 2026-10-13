import { useMemo, useState } from 'react'
import { TreeRow } from '@/components/outline/TreeRow'
import { treeKeyDown } from '@/components/outline/treeKeys'
import type { ClaimNode } from '@/types/preflight'
import { claimTone, orphanClaims, ruleLabel, usePreflightLocate } from './preflightUtils'

type Level = 0 | 1 | 2 | 3
const clampLevel = (n: number): Level => (n >= 3 ? 3 : (n as Level))

const refText = (n: ClaimNode) => (n.refs.length ? `→${n.refs.join(n.alternative ? '/' : ',')}` : '独')

/**
 * 权利要求树（05 §6.2）：独立权项为根，从属按 children 挂树；节点 = `权N · 类别 · 引用 N,M`，
 * 多引多 / 循环 / 前向红点，其余问题黄点；点节点 → 跳权项首行 + 结构块 + PDF。
 * 循环引用会让某些从属权项从任何根都到不了 → 单列「未挂树」分组；同一权项在环里只渲染一次（visited）。
 */
export function ClaimTree({ nodes }: { nodes: ClaimNode[] }) {
  const locate = usePreflightLocate()
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())
  const [current, setCurrent] = useState<number | null>(null)
  const byNum = useMemo(() => new Map(nodes.map((n) => [n.num, n])), [nodes])
  const roots = nodes.filter((n) => n.kind === 'independent')
  const orphans = useMemo(() => orphanClaims(nodes), [nodes])

  const toggle = (num: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(num)) next.delete(num)
      else next.add(num)
      return next
    })
  const activate = (n: ClaimNode) => {
    setCurrent(n.num)
    locate(n.line, `claims/${n.num}`)
  }

  // visited = 当前路径（防环）；rendered = 本次渲染已出现过的权项（未挂树分组里避免同一环渲染两遍）
  const rendered = new Set<number>()
  const render = (n: ClaimNode, level: number, visited: Set<number>, first: boolean): React.ReactNode => {
    rendered.add(n.num)
    const tone = claimTone(n)
    const kids = n.children.map((c) => byNum.get(c)).filter((c): c is ClaimNode => !!c && !visited.has(c.num))
    const isCollapsed = collapsed.has(n.num)
    const issues = n.issues.map(ruleLabel).join('、')
    const label = `权利要求 ${n.num}，${n.kind === 'independent' ? '独立' : `从属，引用 ${n.refs.join('、')}`}${n.category ? `，${n.category}` : ''}${issues ? `，问题：${issues}` : ''}`
    const nextVisited = new Set(visited).add(n.num)
    return (
      <div key={`${n.num}@${level}`} role="none">
        <TreeRow
          id={`claim-${n.num}`}
          level={clampLevel(level)}
          current={current === n.num}
          tabStop={current === null ? first : undefined}
          collapsed={kids.length ? isCollapsed : undefined}
          onToggle={kids.length ? () => toggle(n.num) : undefined}
          onActivate={() => activate(n)}
          mark={issues || null}
          markTone={tone ?? 'error'}
          ariaLabel={label}
          title={issues || undefined}
          tag={refText(n)}
          tagBad={tone === 'error'}
          count={n.refs.length > 1 ? '多引' : undefined}
          testId="claim-node"
          className={tone === 'error' ? 'text-danger-fg' : tone === 'warning' ? 'text-warn-fg' : undefined}
        >
          权{n.num}
          {n.category && <span className="ml-1.5 text-xs text-fg-muted">{n.category}</span>}
        </TreeRow>
        {kids.length > 0 && !isCollapsed && (
          <div role="group">{kids.map((k) => render(k, level + 1, nextVisited, false))}</div>
        )}
      </div>
    )
  }

  return (
    <div className="py-1" data-testid="preflight-claim-tree">
      {roots.length > 0 && (
        <div role="tree" aria-label="权利要求树" onKeyDown={treeKeyDown}>
          {roots.map((r, i) => render(r, 0, new Set(), i === 0))}
        </div>
      )}
      {orphans.length > 0 && (
        <>
          <p className="flex h-sm-control items-center px-2.5 text-xs font-semibold text-danger-fg" id="preflight-claim-orphans-label">
            未挂树（前向 / 循环引用）
          </p>
          <div role="tree" aria-labelledby="preflight-claim-orphans-label" data-testid="claim-orphans" onKeyDown={treeKeyDown}>
            {orphans.map((o, i) => (rendered.has(o.num) ? null : render(o, 0, new Set(), roots.length === 0 && i === 0)))}
          </div>
        </>
      )}
    </div>
  )
}
