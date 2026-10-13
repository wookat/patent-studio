import type { Node as PmNode } from 'prosemirror-model'
import { bookDiff } from '@/components/layout-view/doc/bookDiff'
import type { BookDocName } from '@/components/layout-view/doc/toBookDoc'
import { toCritic, toCriticBook } from '@/components/layout-view/mode/toCritic'
import { api, ApiError } from '@/lib/api'
import { replaceBook, splitBooks } from '@/lib/docset'
import type { BookName } from '@/types/ast'
import { blockSource, findBlockLines } from './blocks'
import { selectCollabActive } from './collab'
import type { Slice, Studio } from './types'

/**
 * W4-D 版面视图 slice（docs/plan/16 §9）。D3（纸面 / 菜单 / 模式）与 D4（375 底部工具栏 / 三视图 tab）只通过这里通信。
 * 不持久化。样式来自 GET /style.css（api.styleCss）；styleCssVersion 每次保存设置后 +1，<link>/<style> 依此重取。
 *
 * W9 prep-contract（docs/plan/22 §2 决策 4/5）：`bookDoc` = 当前版面视图挂载的整书 PM doc（layout-view/doc/toBookDoc），
 * `saveBookDoc(book, newMd, {review})`（store 面向调用方的入口是 doc.saveBook(book, newMd, {review})，同名委托）把整书 Markdown 落回正文真源：
 *   - bookDiff 判定：单块内改动（含行内格式）→ 既有 patchBlock（POST /blocks/{id}，乐观替换 / 失败回滚规则同 blocks.ts）；
 *     跨块 / 分并段 / 增删块 → PUT /docs/{book} {content, base_sha}（乐观 setContent，失败回滚），
 *     409 → toast「内容已被他人修改」并 reload 正文 / AST；
 *   - review=true：每个变化块 old→new 经 mode/toCritic 生成 CriticMarkup 再写回（正文含 {++ ++} / {-- --} / {~~ ~> ~~}）；
 *   - 协同在线（selectCollabActive）：不走 HTTP，对该书 Y.Text（无书房间则 content 房间）做 diff-apply（与源码视图同一条路，
 *     服务端去抖落盘后经房间下发；Y.Text 模型不变），写入器由 collab/useCollabMirror 注册。
 */
export type LayoutViewToolbar = 'none' | 'insert' | 'table' | 'equation'

export interface BookDocState {
  book: BookDocName
  doc: PmNode
  /** toBookDoc 时的书正文（bookDiff 的 oldMd） */
  sourceMd: string
}

export interface SaveBookOptions {
  /** 审阅模式：变化块写成 CriticMarkup 而不是直接改正文 */
  review?: boolean
}

/** 协同在线时的整书写入器：把 `bookText`（或整篇 `fullContent`）diff-apply 到 Y.Text；返回 false 表示无可用房间 */
export type CollabBookWriter = (pid: string, book: BookName, bookText: string, fullContent: string) => boolean

let collabBookWriter: CollabBookWriter | null = null
export function registerCollabBookWriter(w: CollabBookWriter | null): void {
  collabBookWriter = w
}

/** 协同在线时的全文写入器：跨书合并结果（接受/拒绝修订等批量动作）按活房间分布写进各 Y.Text；
 * 返回被房间覆盖的书名集合（含 'content' 镜像）；null = 无活房间，调用方须走 HTTP 落盘。 */
export type CollabContentWriter = (pid: string, prevContent: string, fullContent: string) => Set<string> | null

let collabContentWriter: CollabContentWriter | null = null
export function registerCollabContentWriter(w: CollabContentWriter | null): void {
  collabContentWriter = w
}
export function writeCollabMerged(pid: string, prevContent: string, merged: string): Set<string> | null {
  return collabContentWriter?.(pid, prevContent, merged) ?? null
}

export const CONFLICT_TOAST = '内容已被他人修改'

export interface LayoutViewSlice {
  /** 375 底部工具栏当前展开的二级面板 */
  layoutViewToolbar: LayoutViewToolbar
  /** 版面 CSS 的重取计数（保存设置 → +1） */
  styleCssVersion: number
  /** 版面视图当前整书文档（未挂载 / 切书时为 null） */
  bookDoc: BookDocState | null
  /** GET /docs/{book} 带回的各书 sha（PUT base_sha）；旧后端无 ⇒ 不带 base_sha */
  bookSha: Partial<Record<BookName, string>>
  /** saveBook 进行中（与 blockPending 一样用于禁用编辑器保存入口） */
  bookSaving: boolean
  setLayoutViewToolbar(panel: LayoutViewToolbar): void
  bumpStyleCss(): void
  setBookDoc(bookDoc: BookDocState | null): void
  setBookSha(book: BookName, sha: string | undefined): void
  saveBookDoc(book: BookName, newMd: string, opts?: SaveBookOptions): Promise<boolean>
  resetLayoutView(): void
}

export const layoutViewSlice: Slice<LayoutViewSlice> = (set, get) => ({
  layoutViewToolbar: 'none',
  styleCssVersion: 0,
  bookDoc: null,
  bookSha: {},
  bookSaving: false,
  setLayoutViewToolbar: (panel) => set({ layoutViewToolbar: panel }),
  bumpStyleCss: () => set((s) => ({ styleCssVersion: s.styleCssVersion + 1 })),
  setBookDoc: (bookDoc) => set({ bookDoc }),
  setBookSha: (book, sha) =>
    set((s) => {
      const bookSha = { ...s.bookSha }
      if (sha === undefined) delete bookSha[book]
      else bookSha[book] = sha
      return { bookSha }
    }),

  saveBookDoc: async (book, newMd, opts = {}) => {
    const s = get()
    if (!s.pid || !s.ast || s.bookSaving || s.blockPending) return false
    const pid = s.pid
    const oldMd = splitBooks(s.content).books[book]?.text
    if (oldMd === undefined) {
      s.toast('content.md 不是规范三书文件，请在源码视图保存全文', 'error')
      return false
    }
    if (oldMd === newMd) return true
    const d = bookDiff(oldMd, newMd, s.ast, book)
    if (d.kind === 'none') return true
    const review = opts.review === true

    // 要落盘的块 Markdown（单块）/ 书正文（整书）
    let blockMd: string | null = null
    let bookText: string
    if (d.kind === 'block') {
      const old = blockSource(s.ast, s.content, d.id)
      const loc = findBlockLines(s.ast, d.id)
      if (old === null || !loc) return false
      blockMd = review ? toCritic(old, d.markdown) : d.markdown
      const lines = oldMd.split('\n')
      lines.splice(loc.start - 1, loc.end - loc.start + 1, ...blockMd.split('\n'))
      bookText = lines.join('\n')
    } else {
      bookText = review ? criticBook(oldMd, newMd) : newMd
    }
    const fullContent = replaceBook(s.content, book, bookText)

    // 房间对 reviewer / viewer 只读（14 D5.2）：Y.Text 写入会被服务端丢弃，建议改走 HTTP（服务端 check_source_write）
    const roomWritable = !s.collabReadonly && s.project?.role !== 'reviewer' && s.project?.role !== 'viewer'
    if (selectCollabActive(s) && roomWritable) {
      if (collabBookWriter?.(pid, book, bookText, fullContent)) return true
      // 无活书房可写：经 persistMergedContent——镜像房在则它推进，不在则 PUT /docs/{book} 兜底
      // （裸 setContent 在镜像也死时静默丢；D-B49-1 族）
      s.persistMergedContent(fullContent)
      return true
    }

    if (blockMd !== null && d.kind === 'block') return get().patchBlock(d.id, blockMd)

    const snap = { content: s.content, saved: s.saved }
    set({ bookSaving: true })
    if (fullContent !== s.content) s.setContent(fullContent)
    try {
      const r = await api.putDoc(pid, book, { content: bookText, base_sha: s.bookSha[book] ?? null })
      if (get().pid && get().pid !== pid) return true
      if (r.sha) get().setBookSha(book, r.sha)
      if (r.ast && typeof r.content === 'string') {
        get().applyServerContent(r.content, { ast: r.ast, astContent: r.content, astError: null, astUnavailable: false })
      } else {
        set({ saved: replaceBook(get().saved, book, bookText), serverContent: get().collabStatus !== 'off' ? fullContent : null })
        get().scheduleAst()
      }
      if (r.backups) set({ backups: r.backups })
      return true
    } catch (e) {
      const cur = get()
      if (cur.pid === pid && cur.content === fullContent) set({ content: snap.content, saved: snap.saved })
      if (e instanceof ApiError && e.status === 409) {
        cur.toast(CONFLICT_TOAST, 'error')
        await refreshFromServer(get, pid)
      } else {
        cur.toast(`保存失败：${(e as Error).message}`, 'error')
      }
      return false
    } finally {
      set({ bookSaving: false })
    }
  },

  resetLayoutView: () => set({ layoutViewToolbar: 'none', bookDoc: null, bookSha: {}, bookSaving: false }),
})

/** 409 后重取正文与 AST（openProject 对同 pid 短路，这里直接 GET /projects/{pid} + loadAst） */
async function refreshFromServer(get: () => Studio, pid: string): Promise<void> {
  try {
    const p = await api.project(pid)
    const now = get()
    if (now.pid !== pid) return
    now.applyServerContent(p.content, { project: p, settings: p.settings, backups: p.backups })
    void now.loadAst(pid, { fromDisk: true })
  } catch (e) {
    get().toast(`刷新失败：${(e as Error).message}`, 'error')
  }
}

/** 整书审阅写回：按空行切块、块级对齐后逐块 toCritic（整书直接交给 toCritic 会因 `#` 标题触发整块替换，把全书标成删除 + 插入） */
export function criticBook(oldMd: string, newMd: string): string {
  return toCriticBook(oldMd, newMd)
}
