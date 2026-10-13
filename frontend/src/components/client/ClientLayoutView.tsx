import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Paper } from '@/components/layout-view/Paper'
import { SubExceptContext } from '@/components/layout-view/paper/InlineText'
import { LayoutClaim, LayoutCode, LayoutEquation, LayoutInlineFigure, LayoutParagraph, LayoutSection, LayoutTable } from '@/components/layout-view/paper/blocks'
import '@/components/layout-view/layout-view.css'
import { Block } from '@/components/block-model/blocks'
import { BlockActionsContext, type BlockActions } from '@/components/block-model/context'
import { TITLE_ID, claimId } from '@/components/block-model/model'
import { useIsDesktop } from '@/hooks/useMisc'
import { cn } from '@/lib/utils'
import type { Ast, DescriptionBlock } from '@/types/ast'

interface Props {
  ast: Ast
  /** GET /public/{token}/layout-css；null 用 layout-view.css 默认 A4 变量 */
  css: string | null
  /** 单击某块 → 页面在块旁弹「有意见」 */
  onPickBlock: (blockId: string, el: HTMLElement | null) => void
  pickedId: string | null
  /** meta.sub_except：行内 `_` 不作下标的白名单 */
  subExcept?: readonly string[]
  className?: string
}

/**
 * 客户审阅页「版面」（21 §4.5）：只读连续 A4 纸面，复用 layout-view 的 Paper / 纸面块与 .ps-* 样式，
 * 不进块编辑、无 `/` 菜单、无源码入口；单击块 = 选中并出「有意见」。窄屏整张纸按容器宽缩放（同 LayoutView）。
 */
export function ClientLayoutView({ ast, css, onPickBlock, pickedId, subExcept, className }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const desktop = useIsDesktop()

  useLayoutEffect(() => {
    const body = bodyRef.current
    const pages = pagesRef.current
    if (!body || !pages || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const pageW = pages.offsetWidth
      const avail = body.clientWidth - 32
      setScale(pageW > 0 && avail > 0 ? Math.min(1, avail / pageW) : 1)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    measure()
    return () => ro.disconnect()
  }, [ast])

  const actions = useMemo<BlockActions>(() => {
    const pick = (id: string) => onPickBlock(id, pagesRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`) ?? null)
    return {
      select: pick,
      open: pick,
      gotoClaim: (num) => {
        const id = claimId(ast, num)
        if (!id) return
        pagesRef.current?.querySelector<HTMLElement>(`[data-block-id="${id}"]`)?.scrollIntoView({ block: 'center' })
      },
      // 窄屏纸面按容器缩放，行内引用约 30×9px 无法达 44 热区（WCAG 2.5.8 行内例外）→ 退化为文本，整块仍可点选批注
      refsInteractive: desktop,
    }
  }, [ast, onPickBlock, desktop])

  const common = (id: string) => ({ active: pickedId === id, tabStop: pickedId ? pickedId === id : id === TITLE_ID })

  return (
    <div className={cn('ps-layout h-full overflow-y-auto', className)} data-testid="client-layout">
      {css && <style>{css}</style>}
      <div ref={bodyRef} className="ps-layout-body">
        <BlockActionsContext.Provider value={actions}>
          <SubExceptContext.Provider value={subExcept}>
            <div ref={pagesRef} className="ps-pages" data-testid="client-layout-pages" style={{ '--ps-scale': scale } as CSSProperties}>
              <Paper part="abstract">
                <h1 className="ps-title ps-h">{ast.title.text}</h1>
                {ast.abstract.paragraphs.map((p) => (
                  <LayoutParagraph key={p.id} block={p} part="abstract" {...common(p.id)} />
                ))}
                {ast.abstract.figure_num != null && <p className="ps-p ps-caption ps-empty">摘要附图：图{ast.abstract.figure_num}</p>}
              </Paper>
              <Paper part="claims">
                <ol className="ps-claims" aria-label="权利要求">
                  {ast.claims.map((c) => (
                    <LayoutClaim key={c.id} block={c} {...common(c.id)} />
                  ))}
                </ol>
              </Paper>
              <Paper part="description">
                <Block id={TITLE_ID} {...common(TITLE_ID)} className="ps-title">
                  <h2 className="ps-h">{ast.title.text}</h2>
                </Block>
                {ast.description.map((b) => (
                  <DescriptionBlockView key={b.id} block={b} {...common(b.id)} />
                ))}
              </Paper>
            </div>
          </SubExceptContext.Provider>
        </BlockActionsContext.Provider>
      </div>
    </div>
  )
}

function DescriptionBlockView({ block, ...rest }: { block: DescriptionBlock; active: boolean; tabStop: boolean }) {
  switch (block.kind) {
    case 'section':
    case 'subsection':
      return <LayoutSection block={block} {...rest} />
    case 'paragraph':
      return <LayoutParagraph block={block} {...rest} />
    case 'equation':
      return <LayoutEquation block={block} {...rest} />
    case 'table':
      return <LayoutTable block={block} {...rest} />
    case 'code':
      return <LayoutCode block={block} {...rest} />
    case 'figure':
      return <LayoutInlineFigure block={block} {...rest} />
  }
}
