import { useEffect } from 'react'
import { useStudio } from '@/store'
import type { BlockKind, BlockTemplate } from '@/lib/api'
import type { BookName } from '@/types/ast'
import { formulaMarkdown } from '../dialogs/formula'
import { focusBlock, openFigureDialog, openFormulaDialog, openTableDialog } from '../dialogs/state'

export type InsertAnchor = { after_block_id: string } | { book: BookName }

/** 后端 501 时的统一原因文案（把手 / 工具条 disabled + title） */
/**
 * 模板只拉一次：blockTemplates 为 null 且未标记 501 时触发 loadBlockTemplates()（store 内缓存成功结果）。
 * 128 个把手同时挂载也只发一个请求；501 后不再重试，直到某次块操作成功把 blocksUnavailable 清回 false。
 */
let inflight: Promise<unknown> | null = null
export function useBlockTemplates(): BlockTemplate[] | null {
  const templates = useStudio((s) => s.blockTemplates)
  const unavailable = useStudio((s) => s.blocksUnavailable)
  const load = useStudio((s) => s.loadBlockTemplates)
  useEffect(() => {
    if (templates || unavailable || inflight) return
    inflight = load().finally(() => {
      inflight = null
    })
  }, [templates, unavailable, load])
  return templates
}

/** 菜单项：按目标书过滤后端模板（后端是 kind→book 的唯一来源，前端不硬编码） */
export const templatesFor = (templates: BlockTemplate[] | null, book: BookName | null): BlockTemplate[] =>
  book && templates ? templates.filter((t) => t.book.includes(book)) : []

/** 公式 / 表格 / 内嵌图先开对话框，其余 kind 直接用后端缺省模板插入（06 §5.3） */
export const DIALOG_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>(['equation', 'table', 'figure'])

/**
 * 插入动作：返回 (kind) => void。模板类 kind 插入成功后立即进入该块编辑；
 * 公式 / 表格由对话框给出 markdown 再插入，插入后聚焦新块（不进编辑态：公式再编辑仍走对话框）。
 */
export function useInsertBlock(anchor: InsertAnchor | null, returnTo: string | null) {
  const insertBlock = useStudio((s) => s.insertBlock)
  const startBlockEdit = useStudio((s) => s.startBlockEdit)

  return (kind: BlockKind) => {
    if (!anchor) return
    const insert = async (markdown?: string) => {
      const id = await insertBlock({ kind, ...anchor, ...(markdown !== undefined ? { markdown } : {}) })
      if (!id) return
      if (DIALOG_KINDS.has(kind)) requestAnimationFrame(() => focusBlock(id))
      else startBlockEdit(id)
    }
    if (kind === 'equation') openFormulaDialog('', (src) => void insert(formulaMarkdown(src)), { returnTo })
    else if (kind === 'table') openTableDialog(null, (md) => void insert(md), { returnTo })
    else if (kind === 'figure') openFigureDialog((md) => void insert(md), { returnTo })
    else void insert()
  }
}
