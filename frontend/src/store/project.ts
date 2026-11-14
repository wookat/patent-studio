import { api, ApiError } from '@/lib/api'
import { writeHashPid } from '@/lib/hash'
import type { Backup, CaseContext, Health, ProjectDetail, ProjectSummary, Settings, Style } from '@/lib/types'
import type { CasePatch } from '@/types/case'
import type { Slice } from './types'

const SETTINGS_SAVE_DEBOUNCE_MS = 600

let settingsTimer: number | null = null
let settingsFlush: (() => Promise<void>) | null = null
// settings PUT 串行链：两个在飞请求乱序到达会让后端落下旧 settings（客户端已是新值）
let settingsInFlight: Promise<void> = Promise.resolve()

export interface ProjectSlice {
  projects: ProjectSummary[]
  /** 当前案 id（hash 路由）；与 project 分开是为了在详情加载前就能高亮 */
  pid: string | null
  project: ProjectDetail | null
  settings: Settings | null
  defaults: Style | null
  defaultSettings: Settings | null
  figs: string[]
  backups: Backup[]
  health: Health | null
  /** 打开案子时的网络/404 错误（toast 之外也留一份给 shell 展示） */
  projectError: string | null
  /** 案卷列表拉取失败（成功清 null）——台账空态区分「真没案卷」与「加载失败」 */
  projectsError: string | null
  /** openProject 已发 GET /api/projects/{pid} 但未返回：角色未知，编辑器先上锁（selectReadonly） */
  projectLoading: boolean
  /** C0/P01：统一案卷上下文（PG 绑定/能力/版本契约）；off/未取到 ⇒ null，切案即清 */
  caseContext: CaseContext | null
  /** 复核10：聚合上下文可重试——加载失败停留 null 时 Ui 可再拉一次（pid 守卫防串案） */
  loadCaseContext(): void
  /** C0/P01：已保存正文 sha256（index.ts 订阅在 saved 变化时异步计算；版本显示用，空串=未算/无正文） */
  savedSha: string

  loadProjects(): Promise<void>
  /** 轻量重取案件元（role 等）——不重置各数据 slice；供「成员变更」通知触发的 affordance 收口 */
  refreshProjectMeta(pid: string): Promise<void>
  /** projects + defaults + health 一次拉齐（StoreBootstrap 调用，可重入） */
  loadBootstrap(): Promise<void>
  refreshHealth(): Promise<void>
  /** 切案：写 hash → 拉详情 → 灌 doc/settings → 触发首次构建 */
  openProject(pid: string): Promise<void>
  /**
   * 登出 / 换用户：清空当前案卷的全部工作区状态（案列表 / 详情 / 正文 / PDF / 诊断 / 批注 / AI / 协同…），
   * 下一位登录者重新 openProject 时不会因 pid 相同而短路导致沿用上一位用户的角色 / 内容。
   */
  closeWorkspace(): void
  /** 设置变更：立即入 store 并触发构建，PUT 到后端做 600ms 防抖 */
  saveSettings(settings: Settings): void
  /** 把防抖中的 PUT 立刻发出并等它落盘（依赖 settings 的请求——如 AI 对话——先 flush 再发，避免后端仍读到旧值 403） */
  flushSettings(): Promise<void>
  resetSettings(): void
  /** caseFields：案号 / 客户 / 责任人等台账字段（13 §3.3；不传 = 后端默认，责任人 = 创建者） */
  createProject(id: string, title: string, caseFields?: CasePatch, parentPid?: string): Promise<ProjectDetail>
}

export const projectSlice: Slice<ProjectSlice> = (set, get) => ({
  projects: [],
  pid: null,
  project: null,
  caseContext: null,
  savedSha: '',
  loadCaseContext: () => {
    const pid = get().pid
    if (!pid) return
    api.caseContext(pid)
      .then((ctx) => {
        if (get().pid === pid) set({ caseContext: ctx })
      })
      .catch(() => undefined)
  },
  settings: null,
  defaults: null,
  defaultSettings: null,
  figs: [],
  backups: [],
  health: null,
  projectError: null,
  projectLoading: false,
  projectsError: null,

  loadProjects: async () => {
    try {
      set({ projects: await api.projects(), projectsError: null })
    } catch (e) {
      set({ projectsError: e instanceof Error ? e.message : String(e) })
      throw e
    }
  },

  loadBootstrap: async () => {
    // auth=on 且未登录：/api/projects 必 401，不发（登录页 0 个多余 401）
    const projectsReq = get().authStatus === 'anon' ? Promise.resolve(get().projects) : api.projects()
    const [projects, defaults, health] = await Promise.allSettled([projectsReq, api.defaults(), api.health()])
    set({
      projects: projects.status === 'fulfilled' ? projects.value : get().projects,
      projectsError: projects.status === 'rejected' ? (projects.reason instanceof Error ? projects.reason.message : String(projects.reason)) : null,
      defaults: defaults.status === 'fulfilled' ? defaults.value.style : get().defaults,
      defaultSettings: defaults.status === 'fulfilled' ? defaults.value.settings : get().defaultSettings,
      health: health.status === 'fulfilled' ? health.value : { ok: false, soffice: false, soffice_bin: '', projects_dir: '' },
    })
  },

  refreshProjectMeta: async (pid) => {
    if (get().pid !== pid) return
    try {
      set({ project: await api.project(pid) })
    } catch (e) {
      /* 被移出成员后 meta 403/404——清 project 走错误态，别留旧 role 的写 affordance */
      if (e instanceof ApiError && (e.status === 403 || e.status === 404) && get().pid === pid) {
        set({ project: null, projectError: e.message, projectLoading: false })
      }
    }
  },

  refreshHealth: async () => {
    try {
      set({ health: await api.health() })
    } catch {
      set({ health: { ok: false, soffice: false, soffice_bin: '', projects_dir: '' } })
    }
  },

  openProject: async (pid) => {
    writeHashPid(pid)
    if (get().pid === pid && get().project?.id === pid) return
    set({
      pid,
      projectError: null,
      projectLoading: true,
      members: [],
      membersLoading: false,
      membersError: null,
      shareLinks: [],
      shareLinksLoading: false,
      shareLinksError: null,
      /* 案域残留清场：公开链接/MCP 审计不随案走（否则新案标题下闪旧案数据）；块写在飞旗标清孤儿防新案永久禁用 */
      publicLinks: [],
      publicLinksLoading: false,
      publicLinksUnavailable: false,
      publicLinksError: null,
      editingBlockId: null,
      blockPending: false,
      blockError: null,
      blocksUnavailable: false,
      /* 正文态同步清空：旧案文本不得在新案标题下存活一个加载窗——卡片编辑器随空内容卸载，
         其卸载/idle 保存与新案上下文重逢时文本归属已错（跨案覆写根因） */
      content: '',
      saved: '',
      serverContent: null,
      contentEditedAt: 0,
      cursor: { line: 1, col: 1 },
      /* 时间线备注草稿属案域——翻案即清（批71 store 草稿族）；dupTabOther 同案域（批74 观察器换 pid 重启） */
      timelineNote: null,
      dupTabOther: false,
      caseContext: null,
    })
    get().resetFigures()
    get().resetFiguresBook()
    get().resetAttachments()
    get().resetPreflight()
    get().resetCollab()
    get().resetCollabCenter()
    get().resetLayoutView()
    get().resetPreview()
    /* AST 一并翻案：patchBlock/saveBookDoc 的 ast 守卫在本窗内拒写，挡住旧案编辑器卸载 flush */
    get().resetAst()
    try {
      const p = await api.project(pid)
      if (get().pid !== pid) return
      set({
        projectLoading: false,
        project: p,
        settings: p.settings,
        figs: p.figs,
        backups: p.backups,
        content: p.content,
        saved: p.content,
        serverContent: null,
        contentEditedAt: 0,
        cursor: { line: 1, col: 1 },
        scrollRequest: null,
      })
      get().resetBuild()
      get().resetDiagnostics()
      get().resetChecks()
      get().resetDeliver()
      get().resetAst()
      get().resetReview()
      get().resetComments()
      get().resetHistory()
      get().resetAi()
      get().hydrateChat(pid)
      get().resetTerms()
      get().resetConvert()
      get().resetOa()
      get().enqueue('open', true)
      void get().loadAst(pid, { fromDisk: true })
      void get().loadMarks(pid)
      void get().loadCollabStatus(pid)
      // C0/P01：聚合上下文（PG 绑定 + 版本契约）——失败不阻塞开案（off 模式后端也返回）
      get().loadCaseContext()
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 404 ? `案卷「${pid}」不存在` : (e as Error).message
      if (get().pid === pid) set({ project: null, projectError: msg, projectLoading: false })
      get().toast(msg, 'error')
    }
  },

  closeWorkspace: () => {
    get().resetBuild()
    get().resetDiagnostics()
    get().resetChecks()
    get().resetDeliver()
    get().resetAst()
    get().resetReview()
    get().resetComments()
    get().resetHistory()
    get().resetAi()
    get().resetTerms()
    get().resetConvert()
    get().resetOa()
    get().resetFigures()
    get().resetFiguresBook()
    get().resetAttachments()
    get().resetPreflight()
    get().resetCollab()
    get().resetCollabCenter()
    get().resetLayoutView()
    get().resetPreview()
    set({
      projects: [],
      pid: null,
      project: null,
      settings: null,
      figs: [],
      backups: [],
      projectError: null,
      projectLoading: false,
      projectsError: null,
      content: '',
      saved: '',
      serverContent: null,
      contentEditedAt: 0,
      cursor: { line: 1, col: 1 },
      outline: [],
      scrollRequest: null,
      members: [],
      membersLoading: false,
      membersError: null,
      shareLinks: [],
      shareLinksLoading: false,
      shareLinksError: null,
      /* 案域残留清场（pats 账号域不在此清） */
      publicLinks: [],
      publicLinksLoading: false,
      publicLinksUnavailable: false,
      publicLinksError: null,
      editingBlockId: null,
      blockPending: false,
      blockError: null,
      blocksUnavailable: false,
      timelineNote: null,
      dupTabOther: false,
    })
  },

  saveSettings: (settings) => {
    const { pid, settings: prev } = get()
    set({ settings })
    if (!pid) return
    if (settingsTimer) window.clearTimeout(settingsTimer)
    const put = async () => {
      settingsTimer = null
      settingsFlush = null
      try {
        const mine = settingsInFlight.then(() => api.saveSettings(pid, settings))
        settingsInFlight = mine.then(
          () => undefined,
          () => undefined,
        )
        await mine
        // R96：PUT 成功才触发重建——失败回滚的修改白跑一轮 build
        get().enqueue('settings')
      } catch (e) {
        if (get().settings === settings && get().pid === pid) set({ settings: prev })
        get().toast(`设置保存失败：${(e as Error).message}`, 'error')
      }
    }
    settingsFlush = put
    settingsTimer = window.setTimeout(put, SETTINGS_SAVE_DEBOUNCE_MS)
  },

  flushSettings: async () => {
    if (!settingsFlush) return
    if (settingsTimer) window.clearTimeout(settingsTimer)
    await settingsFlush()
  },

  /** 恢复默认排版参数（style/abstract_limit/sub_except），附图选择保留 */
  resetSettings: () => {
    const { defaultSettings, settings } = get()
    if (!settings) return
    get().saveSettings({
      ...settings,
      style: {},
      abstract_limit: defaultSettings?.abstract_limit ?? 300,
      sub_except: defaultSettings?.sub_except ?? ['tsf_guard', 'on_matured'],
    })
  },

  createProject: async (id, title, caseFields, parentPid) => {
    const p = await api.createProject(id, title, caseFields, parentPid)
    set({ projects: await api.projects() })
    await get().openProject(p.id)
    return p
  },
})
