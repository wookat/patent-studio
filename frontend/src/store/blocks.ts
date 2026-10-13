import { ApiError, api, type BlockEditResult, type BlockTemplate, type InsertBlockInput } from '@/lib/api'
import { diagLocationLabel } from '@/lib/diagLocation'
import type { Ast, BookName } from '@/types/ast'
import type { Slice } from './types'

/**
 * R3 blocks slice（docs/plan/06-r3-structure-edit-design.md §6）：结构视图块级编辑的状态与三条写回动作。
 *
 * 乐观更新：patchBlock 先按 AST 行区间在本地 content 上做同样的行替换（setContent → 结构预览 200ms 内跟随、
 * 构建入队），再调后端；成功以后端返回的 content/ast 为准（并视为已保存：saved = content）；
 * 失败回滚到调用前的 content/saved/ast 快照并 toast（422 带行号）。insert/delete 不做本地预演（结果块 id 由后端 AST 给）。
 * 一次只编辑一块（editingBlockId）；请求在途（blockPending）期间 StructureView 禁用再次提交。
 */
export interface BlocksSlice {
  /** 处于编辑态的块 id（null = 无） */
  editingBlockId: string | null
  /** 有 patch/insert/delete 请求在途 */
  blockPending: boolean
  /** 最近一次写回失败的消息（成功后清空） */
  blockError: string | null
  /** 后端块路由 501（B1 未就绪）：结构视图仍可进入编辑，但提交会失败并回滚 */
  blocksUnavailable: boolean
  /** GET /api/block-templates 缓存；null = 未加载 */
  blockTemplates: BlockTemplate[] | null
  /** block-templates 非 501 失败：插入菜单错误行 + 重试（tools 家族同例，不静默假空） */
  blockTemplatesError: string | null

  startBlockEdit(id: string): void
  cancelBlockEdit(): void
  /** 把某块整块替换为 markdown（内核 Markdown 行，`\n` 分隔，不含块间空行）；成功 true */
  /** base：打开编辑器时块的原行（服务端对照同区间行，不一致 → 409 conflict，防打开后被改静默覆盖） */
  patchBlock(id: string, markdown: string, base?: string): Promise<boolean>
  /** 插入块；成功返回新块 id 并把它设为 activeBlock */
  insertBlock(input: InsertBlockInput): Promise<string | null>
  deleteBlock(id: string): Promise<boolean>
  loadBlockTemplates(): Promise<BlockTemplate[]>
}

/** 用 AST 的书 offset + 块 lines 把 markdown 拼进全文（与后端 patch.patch_block 同一法则）。找不到块返回 null。 */
export function spliceBlock(ast: Ast, content: string, id: string, markdown: string): string | null {
  const loc = findBlockLines(ast, id)
  if (!loc) return null
  const lines = content.split('\n')
  const start = loc.offset + loc.start - 1
  const end = loc.offset + loc.end
  return [...lines.slice(0, start), ...markdown.split('\n'), ...lines.slice(end)].join('\n')
}

/** 某块当前源码行（`\n` 分隔）；与后端 serialize_block(block) 逐字节相同（tests/test_patch.py 已对两案验证）。 */
export function blockSource(ast: Ast, content: string, id: string): string | null {
  const loc = findBlockLines(ast, id)
  if (!loc) return null
  return content.split('\n').slice(loc.offset + loc.start - 1, loc.offset + loc.end).join('\n')
}

/** 可编辑块（摘要段 / 权项 / 说明书块）的书 + 书相对 lines；title / 摘要整块 / figures 不在内 */
export function findBlockLines(ast: Ast, id: string): { book: BookName; offset: number; start: number; end: number } | null {
  const pick = (book: BookName, lines: { start: number; end: number }) => ({ book, offset: ast.books[book].offset, ...lines })
  const ap = ast.abstract.paragraphs.find((p) => p.id === id)
  if (ap) return pick('abstract', ap.lines)
  const c = ast.claims.find((b) => b.id === id)
  if (c) return pick('claims', c.lines)
  const d = ast.description.find((b) => b.id === id)
  return d ? pick('description', d.lines) : null
}

interface Snapshot {
  content: string
  saved: string
  ast: Ast | null
  astContent: string | null
}

export const blocksSlice: Slice<BlocksSlice> = (set, get) => {
  const apply = (r: BlockEditResult) => {
    get().applyServerContent(r.content, {
      ast: r.ast, astContent: r.content, astError: null, astUnavailable: false,
      blockPending: false, blockError: null, blocksUnavailable: false, editingBlockId: null,
    })
    get().loadProjects().catch(() => undefined)
  }
  const fail = (e: unknown, snapshot: Snapshot) => {
    const line = e instanceof ApiError ? e.detail?.line : null
    const base = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e)
    const msg = line != null ? `${diagLocationLabel({ line }, snapshot.ast)}：${base}` : base
    const rollback = get().collabStatus === 'off' ? snapshot : { ast: snapshot.ast, astContent: snapshot.astContent }
    set({ ...rollback, blockPending: false, blockError: msg, blocksUnavailable: e instanceof ApiError && e.status === 501 })
    get().toast(`写回失败，已回滚：${msg}`, 'error')
  }
  const snapshotOf = (): Snapshot => {
    const s = get()
    return { content: s.content, saved: s.saved, ast: s.ast, astContent: s.astContent }
  }

  return {
    editingBlockId: null,
    blockPending: false,
    blockError: null,
    blocksUnavailable: false,
    blockTemplates: null,
    blockTemplatesError: null,

    startBlockEdit: (id) => {
      if (get().blockPending) return
      set({ editingBlockId: id, blockError: null })
      get().setActiveBlock(id, 'structure')
    },
    cancelBlockEdit: () => {
      if (get().editingBlockId !== null) set({ editingBlockId: null })
    },

    patchBlock: async (id, markdown, base) => {
      const s = get()
      if (!s.pid || !s.ast || s.blockPending) return false
      const snap = snapshotOf()
      const optimistic = spliceBlock(s.ast, s.content, id, markdown)
      if (optimistic === null) {
        get().toast('该块已不在当前结构中，请刷新后重试', 'error')
        return false
      }
      set({ blockPending: true, blockError: null })
      // 协同在线时不做乐观替换：正文由服务端落盘后经房间下发，本端不另写 Y.Text
      if (optimistic !== s.content && s.collabStatus === 'off') s.setContent(optimistic)
      try {
        const r = await api.patchBlock(s.pid, id, { markdown, content: snap.content, settings: s.settings ?? undefined, base })
        if (!get().pid || get().pid === s.pid) {
          apply(r)
          if (r.block_id) get().setActiveBlock(r.block_id, 'structure')
        }
        return true
      } catch (e) {
        if (!get().pid || get().pid === s.pid) fail(e, snap)
        return false
      }
    },

    insertBlock: async (input) => {
      const s = get()
      if (!s.pid || s.blockPending) return null
      const snap = snapshotOf()
      set({ blockPending: true, blockError: null })
      try {
        const r = await api.insertBlock(s.pid, { ...input, content: snap.content, settings: s.settings ?? undefined })
        if (get().pid && get().pid !== s.pid) return r.block_id
        apply(r)
        if (r.block_id) get().setActiveBlock(r.block_id, 'structure')
        return r.block_id
      } catch (e) {
        if (!get().pid || get().pid === s.pid) fail(e, snap)
        return null
      }
    },

    deleteBlock: async (id) => {
      const s = get()
      if (!s.pid || s.blockPending) return false
      const snap = snapshotOf()
      set({ blockPending: true, blockError: null })
      try {
        const r = await api.deleteBlock(s.pid, id, { content: snap.content, settings: s.settings ?? undefined })
        if (get().pid && get().pid !== s.pid) return true
        apply(r)
        if (get().activeBlock?.id === id) get().setActiveBlock(null, 'structure')
        return true
      } catch (e) {
        if (!get().pid || get().pid === s.pid) fail(e, snap)
        return false
      }
    },

    loadBlockTemplates: async () => {
      const cached = get().blockTemplates
      if (cached) return cached
      try {
        const r = await api.blockTemplates()
        set({ blockTemplates: r.templates, blocksUnavailable: false, blockTemplatesError: null })
        return r.templates
      } catch (e) {
        if (e instanceof ApiError && e.status === 501) set({ blocksUnavailable: true, blockTemplatesError: null })
        else set({ blockTemplatesError: (e as Error).message })
        return []
      }
    },
  }
}
