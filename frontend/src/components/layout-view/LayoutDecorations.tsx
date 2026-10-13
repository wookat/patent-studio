import { Fragment, useEffect, useMemo, useState, type RefObject } from 'react'
import { blockEntries } from '@/components/block-model/model'
import { useLayoutDecorations } from '@/lib/slots'
import type { Ast } from '@/types/ast'

interface Props {
  ast: Ast | null
  /** `.ps-pages` 容器；用 `[data-block-id]` 查块 DOM 交给装饰工厂 */
  pagesRef: RefObject<HTMLDivElement | null>
}

/**
 * 版面块装饰层（lib/slots.ts `registerLayoutDecoration` 的消费点）：对每个 AST 块 × 每个已注册工厂调用一次，
 * 工厂返回 null 即无装饰。无注册时不渲染任何 DOM。定位由工厂自理（拿到 element），本层只是 `.ps-layout-body` 内的兄弟容器。
 */
export function LayoutDecorations({ ast, pagesRef }: Props) {
  const factories = useLayoutDecorations()
  const entries = useMemo(() => (ast && factories.length ? blockEntries(ast) : []), [ast, factories.length])
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    setRoot(pagesRef.current)
  }, [pagesRef, ast])
  if (!entries.length) return null
  return (
    <div data-slot="layout-decorations" data-testid="layout-decorations" className="contents">
      {entries.map((e) => (
        <Fragment key={e.id}>
          {factories.map((f, i) => (
            <Fragment key={i}>{f({ book: e.book, blockId: e.id, element: root?.querySelector<HTMLElement>(`[data-block-id="${e.id}"]`) ?? null })}</Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
