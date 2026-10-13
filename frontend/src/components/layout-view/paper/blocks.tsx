import { useContext, type MouseEvent } from 'react'
import { Block, Gen, MathML, Scroller } from '@/components/block-model/blocks'
import { BlockActionsContext } from '@/components/block-model/context'
import { paraLabel, splitSegment, type BlockDiagnostic } from '@/components/block-model/model'
import { api } from '@/lib/api'
import { useStudio } from '@/store'
import { cn } from '@/lib/utils'
import type { AstClaim, AstCode, AstEquation, AstInlineFigure, AstParagraph, AstSection, AstTable, ClaimSegment } from '@/types/ast'
import { ParaNo } from '../paraNo/ParaNo'
import { InlineText } from './InlineText'

/**
 * 纸面块渲染（16 §2 part 类映射）。外壳复用 block-model/blocks 的 <Block>（data-block-id / aria-current / 单击选中 / 双击打开），
 * 每种块直接套自己的 .ps-* 类，字体 / 字号 / 行距 / 段前后 / 缩进全由 --ps-* 变量决定（D1 style.css 或 layout-view.css 回退）。
 * 编号一律读 AST：段号 para_no、公式 label、表题 / 表注原文；前端不算号。
 */
export type Common = { active: boolean; tabStop: boolean; diag?: BlockDiagnostic }

const modified = (e: MouseEvent) => e.ctrlKey || e.metaKey

export function LayoutParagraph({ block, part = 'body', ...rest }: Common & { block: AstParagraph; part?: 'body' | 'abstract' }) {
  const caption = block.role === 'table-caption'
  return (
    <Block id={block.id} {...rest} className={cn(caption ? 'ps-caption' : `ps-${part}`)}>
      <p className="ps-p">
        {block.para_no != null && <ParaNo n={block.para_no} />}
        <InlineText text={block.text} />
      </p>
    </Block>
  )
}

export function LayoutSection({ block, ...rest }: Common & { block: AstSection }) {
  const h1 = block.kind === 'section'
  const Tag = h1 ? 'h3' : 'h4'
  return (
    <Block id={block.id} {...rest} className={cn('ps-desc-h', h1 ? 'ps-desc-h1' : 'ps-desc-h2')}>
      <Tag className="ps-h">
        <InlineText text={block.title} />
      </Tag>
    </Block>
  )
}

function ClaimSegmentView({ claim, index, seg }: { claim: AstClaim; index: number; seg: ClaimSegment }) {
  const actions = useContext(BlockActionsContext)
  if (seg.kind === 'equation') {
    return (
      <div className="ps-eq ps-claim-eq" role="group" aria-label="权项公式">
        <MathML mathml={seg.mathml} source={seg.text} />
      </div>
    )
  }
  return (
    <p className="ps-p">
      {splitSegment(claim, index, seg).map((piece, i) =>
        piece.kind === 'text' ? (
          <span key={i}>
            <InlineText text={piece.text} />
          </span>
        ) : actions.refsInteractive === false ? (
          <span key={i} className="ps-ref ps-ref-static" data-testid="claim-ref-static">
            {piece.text}
          </span>
        ) : (
          <button
            key={i}
            type="button"
            className="ps-ref"
            title={`跳到权利要求 ${piece.targets.join('、')}`}
            data-testid="claim-ref"
            onClick={(e) => {
              e.stopPropagation()
              if (modified(e)) return
              const t = piece.targets[0]
              if (t != null) actions.gotoClaim(t)
            }}
          >
            {piece.text}
          </button>
        ),
      )}
    </p>
  )
}

export function LayoutClaim({ block, ...rest }: Common & { block: AstClaim }) {
  const kind = block.claim_kind === 'independent' ? '独立' : '从属'
  return (
    <Block id={block.id} as="li" ariaLabel={`权利要求 ${block.num}（${kind}权项）`} {...rest} className="ps-claim">
      <Gen prefix={`权项 ${block.num}`} className="ps-claim-kind">
        {kind}
      </Gen>
      {block.segments.map((seg, i) => (
        <ClaimSegmentView key={seg.id} claim={block} index={i} seg={seg} />
      ))}
    </Block>
  )
}

export function LayoutEquation({ block, ...rest }: Common & { block: AstEquation }) {
  return (
    <Block id={block.id} ariaLabel={`公式${block.label ? ` ${block.label}` : ''}：${block.source}`} {...rest} className="ps-eq">
      <span className="ps-eq-side" aria-hidden="true" />
      <Scroller label={`公式${block.label ? ` ${block.label}` : ''}`} className="ps-eq-math">
        <MathML mathml={block.mathml} source={block.source} />
      </Scroller>
      <span className="ps-eq-side ps-eq-label tabular">{block.label ?? ''}</span>
    </Block>
  )
}

/** ^^ = 与上一行同列单元格竖向合并 → rowSpan；被合并的格不渲染（与 block-model/blocks 同法则） */
function tableSpans(rows: string[][]) {
  const span: number[][] = rows.map((r) => r.map(() => 1))
  for (let c = 0; c < (rows[0]?.length ?? 0); c++) {
    for (let r = rows.length - 1; r >= 1; r--) {
      if (rows[r][c] === '^^') {
        span[r][c] = 0
        let up = r - 1
        while (up > 0 && rows[up][c] === '^^') up--
        span[up][c] += 1
      }
    }
  }
  return span
}

export function LayoutTable({ block, ...rest }: Common & { block: AstTable }) {
  const [head, ...body] = block.rows
  const spans = tableSpans(block.rows)
  return (
    <Block
      id={block.id}
      ariaLabel={`表格，段号 ${paraLabel(block.para_no)}`}
      {...rest}
      className={cn('ps-table', block.options.three_line && 'ps-table-three-line', block.options.num_left && 'ps-table-num-left')}
    >
      <div className="ps-table-row">
        <div className="ps-table-no">
          <ParaNo n={block.para_no} />
        </div>
        <Scroller label={`表格 ${paraLabel(block.para_no)}`} className="ps-table-scroll">
          <table className="ps-table-grid">
            {head && (
              <thead>
                <tr>
                  {head.map((h, i) => (
                    <th key={i} scope="col">
                      <InlineText text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => {
                    const s = spans[r + 1]?.[i] ?? 1
                    if (s === 0) return null
                    return (
                      <td key={i} rowSpan={s > 1 ? s : undefined}>
                        <InlineText text={c} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      </div>
      {block.caption_after && (
        <p className="ps-caption ps-p">
          <ParaNo n={block.caption_after.para_no} />
          <InlineText text={block.caption_after.text} />
        </p>
      )}
      {block.note && (
        <p className="ps-table-note ps-p">
          <ParaNo n={block.note.para_no} />
          <InlineText text={block.note.text} />
        </p>
      )}
    </Block>
  )
}

export function LayoutCode({ block, ...rest }: Common & { block: AstCode }) {
  return (
    <Block id={block.id} ariaLabel={`代码块，段号 ${paraLabel(block.para_no)}`} {...rest} className="ps-code">
      <div className="ps-table-no">
        <ParaNo n={block.para_no} />
      </div>
      <pre className="ps-code-pre">{block.code_lines.join('\n')}</pre>
    </Block>
  )
}

const INLINE_FIG_CM = 17

/** 说明书内嵌图（W18）：引用 figs/ 图件（经 preview 伴生名渲染）；段号照常，图号不分配。 */
export function LayoutInlineFigure({ block, ...rest }: Common & { block: AstInlineFigure }) {
  const pid = useStudio((s) => s.pid)
  const item = useStudio((s) => s.figures.find((f) => f.name === block.file))
  const v = useStudio((s) => s.figsVersion)
  const url = pid && item?.preview ? api.figUrl(pid, item.preview, v) : null
  return (
    <Block id={block.id} ariaLabel={`内嵌图 ${block.file}，段号 ${paraLabel(block.para_no)}`} {...rest} className="ps-figure">
      <div className="ps-table-no">
        <ParaNo n={block.para_no} />
      </div>
      <div className="ps-figure-stage" style={{ width: `${Math.min(100, (block.width / INLINE_FIG_CM) * 100)}%` }}>
        {url ? <img className="ps-figure-img" src={url} alt={block.alt || block.file} draggable={false} /> : <div className="ps-figure-missing">{block.file} 无预览</div>}
      </div>
      {block.alt ? <div className="ps-figure-no">{block.alt}</div> : null}
    </Block>
  )
}
