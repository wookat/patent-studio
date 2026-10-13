import { api, bookSha, contentSha } from '@/lib/api'
import { bookAtLine, replaceBook, splitBooks } from '@/lib/docset'
import { writeCollabMerged } from './layoutView'
import type { OutlineNode } from '@/lib/types'
import type { BookName } from '@/types/ast'
import type { SaveBookOptions } from './layoutView'
import type { Slice, Studio } from './types'

export interface Cursor {
  line: number
  col: number
  /** 光标所在章节的可读标签（如「说明书 / 背景技术」「权利要求书 · 权项 2」），由 Editor 回报 */
  section?: string
}

/** 编辑器滚动/定位请求（seq 递增保证同一行可重复跳）；Editor 消费后调 clearScrollRequest */
export interface ScrollRequest {
  line: number
  seq: number
  /** 发出时刻（ms）。gotoLine 先激活/打开目标书卡再发请求，卡片挂载晚一拍——只有「新鲜」pending 请求才在挂载时被消费 */
  at: number
}

/** 卡片挂载时仍视为「为它而发」的请求新鲜度窗口 */
export const SCROLL_REQUEST_FRESH_MS = 3000

/** 插入模板种类（与 components/editor/commands.ts InsertKind 一致） */
export type EditorSnippetKind = 'h2' | 'h3' | 'formula' | 'subscript' | 'table' | 'figure' | 'claimRef'

/** 编辑器暴露给 store 的命令接口（由 components/editor/Editor 注册） */
export interface EditorHandle {
  gotoLine(line: number): void
  openSearch(): void
  focus(): void
  undo(): void
  redo(): void
  insertSnippet(kind: EditorSnippetKind): void
}

export interface DocSlice {
  content: string
  /** 最近一次成功保存/加载时的内容；dirty = content !== saved */
  saved: string
  /**
   * 协同在线时最近一次由服务端落盘并返回的全文（恢复版本 / 块补丁）。服务端保存会经 on_saved 把同一改动推进各房间的
   * Y.Text，所以本端对与它一致的部分不再写 Y.Text（否则与服务端下发并发 ⇒ CRDT 双份）；协同关闭时为 null。
   */
  serverContent: string | null
  /** 最近一次编辑时间戳（selectStale 用）；0 = 尚未编辑 */
  contentEditedAt: number
  cursor: Cursor
  /** 由 F2 的 lib/outline.ts 解析后写入；prep 阶段保持空数组 */
  outline: OutlineNode[]
  saving: boolean
  editorHandle: EditorHandle | null
  scrollRequest: ScrollRequest | null

  setContent(content: string): void
  /**
   * 应用服务端已落盘的全文（HTTP 响应）：content = saved = 该文；协同在线时记入 serverContent，
   * 编辑器 / 全文镜像据此跳过对 Y.Text 的重复写入，改由房间下发对齐。
   */
  applyServerContent(content: string, extra?: Partial<Studio>): void
  /**
   * R4 单书卡片编辑（08 §4.2）：把 `book` 正文换进全文再走 setContent —— content 仍是唯一真源，
   * 其它卡片（全文 / 其它书 / 结构 / 大纲 / 构建）经同一 store 更新，不双写。
   */
  setBookContent(book: BookName, text: string): void
  /**
   * 程序化全文写口（修订应用 / 载入备份 / AI 回填 / 术语统一 / 改名回填等「算出新全文」的动作）：
   * collab 在线时变化的书文本写进各自的活书房间（CRDT，不覆盖他人键入），content 镜像房在则整篇写入
   * （覆盖头部与无房间的书）；无房覆盖的变化书逐个 PUT /docs/{book}，头部有变且无镜像时 PUT /content——
   * 只 setContent 会让房间旧文回推「复活」（D-B49-1 族）。viewer/reviewer 不经房间走 HTTP（服务端判 403）。
   * collab off 维持 setContent + 既有 save 链。
   */
  persistMergedContent(content: string): void
  setCursor(cursor: Cursor): void
  setOutline(outline: OutlineNode[]): void
  /** 保存到后端（Ctrl+S / AppBar 保存）；成功后刷新 backups 并 toast */
  save(): Promise<boolean>
  /**
   * R4 只保存一书：`PUT /docs/{book}`（后端 docset.replace + save_content，装配律不变）。
   * 成功后 saved 只换该书正文，其它书的未保存修改仍为 dirty；本书正文已与 saved 一致时直接返回 true。
   * W9：带 `newMd` 时为版面视图整书写回 —— 委托 layoutView.saveBookDoc（bookDiff → 块补丁 / PUT{base_sha} / Y.Text，review 转 CriticMarkup）。
   */
  saveBook(book: BookName, newMd?: string, opts?: SaveBookOptions): Promise<boolean>
  /** 从备份恢复到编辑区（不自动保存，可 Ctrl+S 确认） */
  restore(backupName: string): Promise<void>
  registerEditor(handle: EditorHandle | null): void
  /** 仅发出滚动请求（不切换移动 tab / 不收起 Sheet） */
  requestScroll(line: number): void
  clearScrollRequest(): void
  /** 定位到某行：移动端先切到「编辑」并收起 Sheet/抽屉，再发 scrollRequest（大纲 / 问题列表 / F8） */
  gotoLine(line: number): void
}

export const docSlice: Slice<DocSlice> = (set, get) => ({
  content: '',
  saved: '',
  serverContent: null,
  contentEditedAt: 0,
  cursor: { line: 1, col: 1 },
  outline: [],
  saving: false,
  editorHandle: null,
  scrollRequest: null,

  setContent: (content) => {
    if (content === get().content) return
    set({ content, contentEditedAt: Date.now() })
    get().enqueue('edit')
    get().scheduleAst()
    get().scheduleMarks()
    get().clearPdfLocate()
  },

  applyServerContent: (content, extra = {}) => {
    const live = get().collabStatus !== 'off'
    set({ ...extra, content, saved: content, serverContent: live ? content : null, contentEditedAt: Date.now() })
    get().enqueue('edit')
    get().scheduleMarks()
    get().clearPdfLocate()
  },

  setBookContent: (book, text) => {
    get().setContent(replaceBook(get().content, book, text))
  },

  persistMergedContent: (merged) => {
    const s = get()
    if (merged === s.content) return
    /* 批76：整篇 PUT 带 base（自认与盘一致的 saved 哈希）乐观并发——他会话先写即 409 toast，
       不再静默覆盖；原 `void api.saveContent` 无 catch，任何失败静默丢成 unhandled rejection。
       批78 补书级同闸：per-book PUT 带 base_sha = 该书 saved 正文 sha1（后端 book_sha 同算法） */
    const savedB = splitBooks(s.saved)
    const putBookWithBase = (pid: string, book: BookName, text: string) => {
      const savedText = savedB.books[book]?.text
      void (async () => {
        try {
          await api.putDoc(pid, book, { content: text, base_sha: savedText === undefined ? undefined : await bookSha(savedText) })
        } catch (e) {
          get().toast(`保存失败：${(e as Error).message}`, 'error')
        }
      })()
    }
    const putMergedWithBase = (pid: string) => {
      void (async () => {
        try {
          await api.saveContent(pid, merged, await contentSha(get().saved))
        } catch (e) {
          get().toast(`保存失败：${(e as Error).message}`, 'error')
        }
      })()
    }
    if (s.collabStatus !== 'off' && s.pid) {
      const roomWritable = !s.collabReadonly && s.project?.role !== 'reviewer' && s.project?.role !== 'viewer'
      if (roomWritable) {
        const covered = writeCollabMerged(s.pid, s.content, merged)
        const prevB = splitBooks(s.content)
        const next = splitBooks(merged)
        for (const book of next.order) {
          const t = next.books[book]!.text
          if (t === prevB.books[book]?.text || covered?.has(book) === true || covered?.has('content') === true) continue
          putBookWithBase(s.pid, book, t)
        }
        if (next.head !== prevB.head && covered?.has('content') !== true) putMergedWithBase(s.pid)
      } else {
        putMergedWithBase(s.pid)
      }
    }
    s.setContent(merged)
  },

  setCursor: (cursor) => {
    const c = get().cursor
    if (c.line === cursor.line && c.col === cursor.col && c.section === cursor.section) return
    set({ cursor })
  },

  setOutline: (outline) => set({ outline }),

  save: async () => {
    const { pid, content, saving } = get()
    if (!pid || saving) return false
    /* OBS-B78-1：clean 态 Ctrl+S 原样发 PUT——空写浪费磁盘往返，且陈旧页签无脏也吃 409 误导用户
       （以为自己的「无修改保存」冲了别人）。无脏即成功，静默早退 */
    if (content === get().saved) return true
    if (get().collabStatus !== 'off') {
      // R8（docs/plan/11 §4.3）：协同生效时写盘由服务端去抖完成，本地 PUT /content 关闭；Ctrl+S 只清脏标记
      set({ saved: content })
      get().toast('协同模式：由服务端自动保存')
      return true
    }
    set({ saving: true })
    try {
      /* 批76：base = 自认与盘一致的 saved 哈希——他会话先写即 409，不再静默覆盖 */
      const r = await api.saveContent(pid, content, await contentSha(get().saved))
      if (!get().pid || get().pid === pid) set({ saved: content, backups: r.backups })
      get().toast(r.backup ? '已保存（上一版已入版本历史）' : '已保存')
      get().loadProjects().catch(() => undefined)
      return true
    } catch (e) {
      get().toast(`保存失败：${(e as Error).message}`, 'error')
      return false
    } finally {
      set({ saving: false })
    }
  },

  saveBook: async (book, newMd, opts) => {
    if (newMd !== undefined) return get().saveBookDoc(book, newMd, opts)
    const { pid, content, saved, saving } = get()
    if (!pid || saving) return false
    const text = splitBooks(content).books[book]?.text
    if (text === undefined) {
      get().toast('content.md 不是规范三书文件，请保存全文', 'error')
      return false
    }
    const savedText = splitBooks(saved).books[book]?.text
    if (savedText === text) return true
    if (get().collabStatus !== 'off') {
      set({ saved: replaceBook(saved, book, text) })
      get().toast('协同模式：由服务端自动保存')
      return true
    }
    set({ saving: true })
    try {
      /* 批78（D-B78-1）：saveBook 不带 base_sha 的裸写 = 陈旧页签静默覆盖他端——
         base_sha = saved 该书正文 sha1，与后端 book_sha 同算法同输入 */
      const r = await api.putDoc(pid, book, { content: text, base_sha: savedText === undefined ? undefined : await bookSha(savedText) })
      if (get().pid && get().pid !== pid) return true
      set({ saved: replaceBook(get().saved, book, text), backups: r.backups })
      get().toast(r.backup ? '已保存（上一版已入版本历史）' : '已保存')
      get().loadProjects().catch(() => undefined)
      return true
    } catch (e) {
      get().toast(`保存失败：${(e as Error).message}`, 'error')
      return false
    } finally {
      set({ saving: false })
    }
  },

  restore: async (name) => {
    const { pid } = get()
    if (!pid) return
    try {
      const b = await api.backup(pid, name)
      if (get().pid && get().pid !== pid) return
      get().persistMergedContent(b.content)
      if (get().mobileTab !== 'edit') get().setMobileTab('edit')
      get().closeMobileNav()
      get().toast(`已载入备份 ${name}（Ctrl+S 保存）`)
    } catch (e) {
      get().toast(`读取备份失败：${(e as Error).message}`, 'error')
    }
  },

  registerEditor: (editorHandle) => set({ editorHandle }),

  requestScroll: (line) => set((s) => ({ scrollRequest: { line, seq: (s.scrollRequest?.seq ?? 0) + 1, at: Date.now() } })),
  clearScrollRequest: () => set({ scrollRequest: null }),

  gotoLine: (line) => {
    const s = get()
    if (s.mobileTab !== 'edit') s.setMobileTab('edit')
    s.closeMobileNav()
    // 命中行所在书的卡可能是未激活 tab（未挂载 → scrollRequest 没人消费，点击静默无效）——先激活/打开它；落在书外（头部等）退全文卡
    if (s.dockHandle) {
      const book = bookAtLine(splitBooks(s.content), line)
      s.openPanel(book ? `source:${book}` : 'source:all')
    }
    s.requestScroll(line)
  },
})
