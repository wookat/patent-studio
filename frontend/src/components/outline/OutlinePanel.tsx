import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Image, Sigma, Table2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { selectAbstractLive, useStudio } from '@/store'
import { useIsDesktop } from '@/hooks/useMisc'
import {
  REQUIRED_SECTIONS, ancestorsOf, defaultCollapsed, isCollapsed, locateLine,
  type LeafItem, type SectionItem, type SubsectionItem,
} from '@/lib/outline'
import type { Diagnostic } from '@/lib/types'
import type { Ast } from '@/types/ast'
import { pdfQueryForBlock } from '@/components/preview/locate'
import { bookOfBlockId } from '@/components/preview/pdfFocus'
import { useOutlineModel } from './useOutline'
import { TreeRow } from './TreeRow'
import { treeKeyDown } from './treeKeys'
import { claimRefTag, paraRangeTag, refRange } from './outlineTags'

/** 找 diagnostics 中落在 [from,end] 行内或 section 匹配的 ⚠/✕ */
function findDiag(items: Diagnostic[], from: number, end: number, section?: string): Diagnostic | undefined {
  return items.find(
    (d) =>
      d.severity !== 'info' &&
      ((d.line !== null && d.line >= from && d.line <= end) || (section !== undefined && d.section === section)),
  )
}

const LEAF_ICON: Record<LeafItem['kind'], ReactNode> = { equation: <Sigma />, table: <Table2 />, figure: <Image /> }
const LEAF_NAME: Record<LeafItem['kind'], string> = { equation: '公式', table: '表格', figure: '附图' }

/** 章节 / 小节右侧的叶子计数徽标：`Σ2 ▦1 ▣3` */
function LeafBadges({ leaves }: { leaves: LeafItem[] }) {
  const n = { equation: 0, table: 0, figure: 0 }
  for (const l of leaves) n[l.kind]++
  const parts = (Object.keys(n) as LeafItem['kind'][]).filter((k) => n[k] > 0)
  if (!parts.length) return null
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="leaf-badges">
      {parts.map((k) => (
        <span key={k} className="inline-flex items-center gap-0.5 [&_svg]:size-3" title={`${LEAF_NAME[k]} ${n[k]}`}>
          {LEAF_ICON[k]}
          {n[k]}
        </span>
      ))}
    </span>
  )
}

/** 结构视图要滚到的块：书级根节点取该书首块；附图取题注段；其余节点 id 本身就是块 id */
function blockIdFor(ast: Ast, id: string): string | null {
  if (id === 'claims') return ast.claims[0]?.id ?? null
  if (id === 'description') return ast.description[0]?.id ?? null
  const fig = ast.figures.find((f) => f.id === id)
  if (fig) {
    const cap = fig.caption_line !== null ? ast.description.find((b) => b.kind === 'paragraph' && b.lines.start === fig.caption_line) : undefined
    return cap?.id ?? null
  }
  return id
}

/**
 * 文档大纲（07 §2.1 侧栏下块；04-r1-design §5.6）：数据源 = store.ast（后端唯一解析器），diagnostics 叠加 ⚠/✕。
 * 摘要（`298 字`，超限红）→ 权利要求书 (N)：每项 `编号. 首句…` + `独` / `→1` / `→2–6` →
 * 说明书：法定五章节（缺失灰斜体）→ 小节 → 图 / 表 / 公式叶子（带图标；段落不列出）。
 * 折叠态 = 默认（发明内容 / 具体实施方式展开，其余章节与带叶子的小节折叠）XOR `ui.outlineCollapsedIds`；光标所在节点高亮并自动展开其祖先；
 * 点击 → 桌面 dock：setCursor + setFocus(source:'outline')（源码 / 版面卡片各自滚到块并闪烁，被遮住的源码 tab 由 SourceCard 露出；不看持久化的 editorView）；
 *   无 dock：gotoLine（源码；结构态改为 setCursor，留在结构视图）；两者都 + setActiveBlock(id,'outline')（结构视图滚到块）+ locateInPdf(pdfQueryForBlock)（PDF 高亮首个命中）；
 * ↑/↓/Home/End/Enter/←/→ 键盘漫游（treeKeys）。
 * /ast 尚未返回（含 501）→ 「等待解析」。
 */
export function OutlinePanel() {
  const model = useOutlineModel()
  const ast = useStudio((s) => s.ast)
  const pid = useStudio((s) => s.pid)
  const astLoading = useStudio((s) => s.astLoading)
  const astError = useStudio((s) => s.astError)
  const astUnavailable = useStudio((s) => s.astUnavailable)
  const cursorLine = useStudio((s) => s.cursor.line)
  const gotoLine = useStudio((s) => s.gotoLine)
  const setCursor = useStudio((s) => s.setCursor)
  const desktop = useIsDesktop()
  const editorView = useStudio((s) => s.editorView)
  const structure = desktop && editorView === 'layout'
  const setActiveBlock = useStudio((s) => s.setActiveBlock)
  const setFocus = useStudio((s) => s.setFocus)
  const locateInPdf = useStudio((s) => s.locateInPdf)
  const diagnostics = useStudio((s) => s.items)
  const abstract = useStudio(useShallow(selectAbstractLive))
  const toggledIds = useStudio((s) => s.outlineCollapsedIds)
  const toggleOutlineCollapsed = useStudio((s) => s.toggleOutlineCollapsed)

  const defaults = useMemo(() => defaultCollapsed(model), [model])
  const collapsed = (id: string) => isCollapsed(defaults, toggledIds, id)
  const toggle = (id: string) => () => toggleOutlineCollapsed(id)

  // 点击节点后先本地高亮；待编辑器把光标写回 doc.cursor（cursorLine 变化）后改由 locateLine 决定
  const [clicked, setClicked] = useState<{ id: string; cursorLine: number } | null>(null)
  const current = useMemo(
    () => (clicked && clicked.cursorLine === cursorLine ? clicked.id : locateLine(ast, model, cursorLine)),
    [ast, model, cursorLine, clicked],
  )
  const activate = (id: string, line: number) => () => {
    setClicked({ id, cursorLine })
    const dock = desktop && useStudio.getState().dockHandle != null
    if (dock || structure) setCursor({ line, col: 1 })
    else gotoLine(line)
    if (!ast) return
    const blockId = blockIdFor(ast, id)
    setActiveBlock(blockId, 'outline')
    if (dock && blockId) setFocus({ book: bookOfBlockId(blockId), blockId, line, source: 'outline' })
    const q = pdfQueryForBlock(ast, id)
    if (q) locateInPdf(q)
  }

  // 光标进入新节点 → 展开其被折叠的祖先（只在 current 变化时做，手动折叠不会被立刻撑开）
  const lastExpanded = useRef<string | null>(null)
  useEffect(() => {
    if (!current || current === lastExpanded.current) return
    lastExpanded.current = current
    const { outlineCollapsedIds, toggleOutlineCollapsed: flip } = useStudio.getState()
    for (const a of ancestorsOf(model, current)) if (isCollapsed(defaults, outlineCollapsedIds, a)) flip(a)
  }, [current, model, defaults])

  if (!pid) {
    return (
      <div data-slot="OutlinePanel" className="h-full overflow-auto text-sm">
        <p className="px-3 py-2 text-xs text-fg-muted">打开案子后在此显示大纲。</p>
      </div>
    )
  }
  if (!ast) {
    return (
      <div data-slot="OutlinePanel" className="h-full overflow-auto text-sm" aria-busy={astLoading || undefined}>
        <p className="px-3 py-2 text-xs text-fg-muted" data-testid="outline-waiting" title={astUnavailable ? '后端 /ast 未实现（R1 B2）' : astError ?? undefined}>
          等待解析
        </p>
      </div>
    )
  }

  const claimsDiag = model.claims ? findDiag(diagnostics, model.claims.line, model.claims.end, '权利要求书') : undefined
  const abstractDiag = model.abstract ? findDiag(diagnostics, model.abstract.line, model.abstract.end, '摘要') : undefined
  const sections = model.description?.sections ?? []
  const sectionsByName = new Map(sections.map((s) => [s.name, s]))
  const missing = model.description ? REQUIRED_SECTIONS.filter((n) => !sectionsByName.has(n)) : []
  const figureCount = ast.figures.length
  // 没有节点被定位到时，首行可 Tab 进入
  const firstStop = current === null

  const leafRow = (leaf: LeafItem, level: 2 | 3) => {
    const kindName = LEAF_NAME[leaf.kind]
    // label 可能已自带类型名（公式 （11））或 tag 全文（无题注表格 label="表格 [0064]"）——已覆盖的信息不再重复
    const named = leaf.label.startsWith(kindName) ? leaf.label : `${kindName} ${leaf.label}`
    const tag = leaf.tag && !leaf.label.includes(leaf.tag) ? leaf.tag : undefined
    return (
      <TreeRow
        key={leaf.id}
        id={leaf.id}
        level={level}
        current={current === leaf.id}
        onActivate={activate(leaf.id, leaf.line)}
        icon={LEAF_ICON[leaf.kind]}
        tag={tag}
        title={`${named}${tag ? ` · ${tag}` : ''}`}
        ariaLabel={named}
        testId={`outline-${leaf.kind}`}
      >
        {leaf.label}
      </TreeRow>
    )
  }

  const subsectionRows = (s: SectionItem) =>
    s.subsections.map((x: SubsectionItem) => {
      const d = findDiag(diagnostics, x.line, x.end)
      const hasLeaves = x.leaves.length > 0
      return (
        <div key={x.id} role="none">
          <TreeRow
            id={x.id}
            level={2}
            current={current === x.id}
            onActivate={activate(x.id, x.line)}
            collapsed={hasLeaves ? collapsed(x.id) : undefined}
            onToggle={hasLeaves ? toggle(x.id) : undefined}
            mark={d?.message ?? null}
            markTone={d?.severity === 'warning' ? 'warning' : 'error'}
            tag={hasLeaves ? <LeafBadges leaves={x.leaves} /> : undefined}
            title={x.name}
            testId="outline-subsection"
          >
            {x.name}
          </TreeRow>
          {hasLeaves && !collapsed(x.id) && <div role="group">{x.leaves.map((l) => leafRow(l, 3))}</div>}
        </div>
      )
    })

  const sectionRow = (s: SectionItem) => {
    const required = (REQUIRED_SECTIONS as readonly string[]).includes(s.name)
    const d = findDiag(diagnostics, s.line, s.end, `说明书/${s.name}`)
    const hasChildren = s.subsections.length > 0 || s.leaves.length > 0
    const range = paraRangeTag(s)
    const tag =
      s.part === 'description-of-drawings' && figureCount ? `图1–${figureCount}` : s.part === 'mode-for-invention' ? range : hasChildren ? <LeafBadges leaves={[...s.leaves, ...s.subsections.flatMap((x) => x.leaves)]} /> : null
    return (
      <div key={s.id} role="none">
        <TreeRow
          id={s.id}
          level={1}
          current={current === s.id}
          onActivate={activate(s.id, s.line)}
          collapsed={hasChildren ? collapsed(s.id) : undefined}
          onToggle={hasChildren ? toggle(s.id) : undefined}
          mark={d?.message ?? (required ? null : `非标准章节：${s.name}`)}
          markTone={d && d.severity === 'warning' ? 'warning' : 'error'}
          tag={tag ?? undefined}
          title={range ? `${s.name} · ${range}` : s.name}
          testId="outline-section"
        >
          {s.name}
        </TreeRow>
        {hasChildren && !collapsed(s.id) && (
          <div role="group">
            {s.leaves.map((l) => leafRow(l, 2))}
            {subsectionRows(s)}
          </div>
        )}
      </div>
    )
  }

  /** 法定五章节按规定顺序（缺失者灰斜体占位），非标准章节按行号插入 */
  const sectionRows = () => {
    const rows: { line: number; node: ReactNode }[] = []
    const seen = new Set<string>()
    REQUIRED_SECTIONS.forEach((name, i) => {
      const s = sectionsByName.get(name)
      if (s) {
        seen.add(s.id)
        rows.push({ line: s.line, node: sectionRow(s) })
      } else {
        const id = `description/${name}`
        // 缺失章节排在前一个存在章节之后（用其行号 + 0.5）
        const prev = REQUIRED_SECTIONS.slice(0, i).map((n) => sectionsByName.get(n)).filter((x): x is SectionItem => !!x).pop()
        rows.push({
          line: (prev?.end ?? model.description!.line) + 0.5,
          node: (
            <TreeRow key={id} id={id} level={1} muted onActivate={activate('description', model.description!.line)} mark={`缺少章节 ### ${name}`} title={`缺少章节 ### ${name}`} testId="outline-section-missing">
              <span className="italic">{name}</span>
            </TreeRow>
          ),
        })
      }
    })
    for (const s of sections) if (!seen.has(s.id)) rows.push({ line: s.line, node: sectionRow(s) })
    return rows.sort((a, b) => a.line - b.line).map((r) => r.node)
  }

  return (
    <div data-slot="OutlinePanel" role="tree" aria-label="文档大纲" className="h-full overflow-auto px-1 pb-1 text-base" data-testid="outline-tree" onKeyDown={treeKeyDown}>
      {model.abstract ? (
        <TreeRow
          id="abstract"
          current={current === 'abstract'}
          tabStop={firstStop || undefined}
          onActivate={activate('abstract', model.abstract.line)}
          mark={abstractDiag?.message ?? (abstract.over ? `摘要 ${abstract.chars} 字，超过上限 ${abstract.limit}` : null)}
          markTone={!abstract.over && abstractDiag?.severity === 'warning' ? 'warning' : 'error'}
          tag={<span data-testid="abstract-chip">{abstract.chars} 字</span>}
          tagBad={abstract.over}
          title={`摘要 ${abstract.chars} / ${abstract.limit} 字`}
        >
          摘要
        </TreeRow>
      ) : (
        <TreeRow id="abstract" tabStop={firstStop || undefined} muted onActivate={activate('abstract', 1)} mark="缺少 `## 摘要`" title="缺少 `## 摘要`">
          <span className="italic">摘要</span>
        </TreeRow>
      )}

      {model.claims ? (
        <>
          <TreeRow
            id="claims"
            current={current === 'claims'}
            onActivate={activate('claims', model.claims.line)}
            collapsed={collapsed('claims')}
            onToggle={toggle('claims')}
            mark={claimsDiag?.message ?? (model.claims.items.some((c) => c.badRefs.length) ? '存在前向 / 越界引用' : null)}
            markTone={claimsDiag?.severity === 'warning' ? 'warning' : 'error'}
            count={<span data-testid="claims-count">{model.claims.items.length} 项</span>}
            title={`权利要求书 · ${model.claims.items.length} 项`}
          >
            权利要求书
          </TreeRow>
          {!collapsed('claims') && (
            <div role="group">
              {model.claims.items.map((c) => {
                const d = findDiag(diagnostics, c.line, c.end)
                const bad = c.badRefs.length ? `引用了不存在或在后的权利要求 ${c.badRefs.join(',')}` : null
                const kind = c.dependent
                  ? `从属，引用 ${c.refs.join('、') || '—'}`
                  : c.refs.length ? `独立（引用权利要求 ${refRange(c.refs)}）` : '独立'
                return (
                  <TreeRow
                    key={c.id}
                    id={c.id}
                    level={1}
                    current={current === c.id}
                    onActivate={activate(c.id, c.line)}
                    mark={bad ?? d?.message ?? null}
                    markTone={!bad && d?.severity === 'warning' ? 'warning' : 'error'}
                    tag={<span data-testid="claim-ref">{claimRefTag(c.dependent, c.refs)}</span>}
                    tagBad={!!bad || d?.severity === 'error'}
                    title={`${c.num}. ${c.full}\n${kind}${bad ? `\n${bad}` : ''}`}
                    ariaLabel={`权利要求 ${c.num}，${kind}`}
                    testId="outline-claim"
                  >
                    {c.num}. {c.text}
                  </TreeRow>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <TreeRow id="claims" muted onActivate={activate('claims', 1)} mark="缺少 `## 权利要求书`" title="缺少 `## 权利要求书`">
          <span className="italic">权利要求书</span>
        </TreeRow>
      )}

      {model.description ? (
        <>
          <TreeRow
            id="description"
            current={current === 'description'}
            onActivate={activate('description', model.description.line)}
            collapsed={collapsed('description')}
            onToggle={toggle('description')}
            mark={missing.length ? `缺少章节：${missing.join('、')}` : null}
            title={`说明书 · ${model.description.paragraphs} 段`}
          >
            说明书
          </TreeRow>
          {!collapsed('description') && (
            <div role="group">
              {model.description.leaves.map((l) => leafRow(l, 2))}
              {sectionRows()}
            </div>
          )}
        </>
      ) : (
        <TreeRow id="description" muted onActivate={activate('description', 1)} mark="缺少 `## 说明书`" title="缺少 `## 说明书`">
          <span className="italic">说明书</span>
        </TreeRow>
      )}
    </div>
  )
}
