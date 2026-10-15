/**
 * hash 路由（docs/plan/13-w4a-case-dashboard-design.md §5；W4-E 17 §2.1 增 deliver / account / admin）：
 *   #/                    案卷面板（首页）
 *   #/p/<pid>             工作台（规范路径）
 *   #/p/<pid>/deliver     递交页（体检 + 导出包；同一案，不重开 openProject）
 *   #/p/<pid>/board       附图绘制画板页（W17：?src=<stem> 打开已存图源，缺省新建）
 *   #/<pid>               旧工作台路径 → 仍解析为 pid；StoreBootstrap 打开后 writeHashPid 会改写成 #/p/<pid>
 *   #/login               登录页；#/share/<token> 分享领取页（R6）
 *   #/account             个人资料；#/admin 机构管理（超管；?tab=members|org|audit|ai）
 * W5（docs/plan/21-w5-spec.md §4）：
 *   #/deadlines           期限中心；#/inbox 通知
 *   #/p/<pid>?c=<cid>     工作台并打开批注；#/p/<pid>?focus=<block_id> 工作台并定位（query 由 project 路由携带）
 *   #/c/<token>           客户审阅页（免登录）
 *   #/__ds                设计系统展示页（仅 DEV）
 * W6（05 §2.9 伴随栏；契约见 docs/design-system/w6-spec/prep-contracts.md）：
 *   #/p/<pid>?panel=<CompanionId>   打开工作台并展开伴随栏（ai / review / history / console / problems / terms / figures / search / deadlines / notify）
 *   #/p/<pid>?c=<cid>               隐含 panel=review（批注在审阅面板里）；?panel= 显式优先
 *   #/__ds?panel=<id>               展示页里的伴随栏骨架演示（同一参数名）
 * 消费方（shell-workbench 的 CompanionHost）读 readHashProjectQuery().panel → openCompanion 后用 clearProjectQuery / writeCompanionHash 回写。
 */
export const COMPANION_PARAM = 'panel'
export interface ProjectQuery {
  /** 打开批注 id */
  c?: string
  /** 定位块 id（AST block_id） */
  focus?: string
  /** 定位期限 id（一次性的，期限伴随栏消费后由 clearProjectQuery 清除） */
  dl?: string
  /** W6：打开的伴随栏 id（值域 = store/ui.ts CompanionId；这里不校验，由 isCompanionId 在消费时过滤） */
  panel?: string
}

export type HashRoute =
  | { kind: 'dashboard' }
  | { kind: 'deadlines' }
  | { kind: 'figlib' }
  | { kind: 'legal'; page: string }
  | { kind: 'inbox' }
  | { kind: 'workbench'; query: { caseId: string | null; view: 'queue' | 'case' | 'approvals' | 'notifications' } }
  /** B12：平台文稿编辑器页 #/edit/<caseId>/<docId>（旧三书块编辑器接 /api/v1 working-copy） */
  | { kind: 'edit'; caseId: string; docId: string }
  | { kind: 'project'; pid: string; legacy: boolean; query: ProjectQuery }
  | { kind: 'deliver'; pid: string }
  /** W17：附图绘制画板页 #/p/<pid>/board?src=<stem>；同一案不重开 openProject
   *  ?img=<figs 图名>：位图标注改图模式（原图上画布，导出覆盖原位） */
  | { kind: 'board'; pid: string; src: string | null; img: string | null }
  /** W19 批4：查新记录卡页 #/p/<pid>/novelty；同一案不重开 openProject */
  | { kind: 'novelty'; pid: string }
  | { kind: 'login' }
  | { kind: 'share'; token: string }
  | { kind: 'client'; token: string }
  | { kind: 'account' }
  | { kind: 'admin'; tab: AdminTab | null }
  | { kind: 'ds'; query: ProjectQuery }

export type AdminTab = 'members' | 'org' | 'audit' | 'ai'
const ADMIN_TABS: readonly AdminTab[] = ['members', 'org', 'audit', 'ai']

const PAGE_ROUTES = /^(share|c|edit)\/|^(login|account|admin|deadlines|inbox|workbench|figlib|__ds|legal)(\?|$|\/)/

function parseQuery(q: string | undefined): ProjectQuery {
  if (!q) return {}
  const sp = new URLSearchParams(q)
  const out: ProjectQuery = {}
  const c = sp.get('c')
  const focus = sp.get('focus')
  const panel = sp.get(COMPANION_PARAM)
  const dl = sp.get('dl')
  if (c) out.c = c
  if (focus) out.focus = focus
  if (panel) out.panel = panel
  if (dl) out.dl = dl
  return out
}

const _decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s // R91：畸形 % 序列不崩路由——原样留作 pid/token，由后端 404 兜底
  }
}

export function parseHash(hash: string = window.location.hash): HashRoute {
  const h = hash.replace(/^#\/?/, '')
  if (!h) return { kind: 'dashboard' }
  if (h === 'login' || h.startsWith('login?')) return { kind: 'login' }
  if (h === 'account' || h.startsWith('account?')) return { kind: 'account' }
  if (h === 'admin' || h.startsWith('admin?')) {
    const tab = new URLSearchParams(h.split('?')[1] ?? '').get('tab')
    return { kind: 'admin', tab: ADMIN_TABS.includes(tab as AdminTab) ? (tab as AdminTab) : null }
  }
  if (h === 'deadlines' || h.startsWith('deadlines?')) return { kind: 'deadlines' }
  if (h === 'inbox' || h.startsWith('inbox?')) return { kind: 'inbox' }
  if (h === 'workbench' || h.startsWith('workbench?')) {
    const q = new URLSearchParams(h.split('?')[1] ?? '')
    const view = q.get('view')
    return {
      kind: 'workbench',
      query: {
        caseId: q.get('case'),
        view: view === 'case' || view === 'approvals' || view === 'notifications' ? view : 'queue',
      },
    }
  }
  if (h === 'figlib' || h.startsWith('figlib?')) return { kind: 'figlib' }
  const legal = h.match(/^legal\/(terms|privacy|copyright)/)
  if (legal) return { kind: 'legal', page: legal[1] }
  if (h === '__ds' || h.startsWith('__ds?')) return { kind: 'ds', query: parseQuery(h.split('?')[1]) }
  const share = h.match(/^share\/([^/?#]+)/)
  if (share) return { kind: 'share', token: _decode(share[1]) }
  const client = h.match(/^c\/([^/?#]+)/)
  if (client) return { kind: 'client', token: _decode(client[1]) }
  const edit = h.match(/^edit\/([^/?#]+)\/([^/?#]+)/)
  if (edit) return { kind: 'edit', caseId: _decode(edit[1]), docId: _decode(edit[2]) }
  const p = h.match(/^p\/([^/?#]+)(\/(?:deliver|board|novelty))?(?:\?(.*))?$/)
  if (p) {
    const pid = _decode(p[1])
    if (p[2] === '/board') {
      const q = p[3] ? new URLSearchParams(p[3]) : null
      const src = q?.get('src') ?? null
      const img = q?.get('img') ?? null
      return { kind: 'board', pid, src: src ? _decode(src) : null, img: img ? _decode(img) : null }
    }
    if (p[2] === '/novelty') return { kind: 'novelty', pid }
    return p[2] ? { kind: 'deliver', pid } : { kind: 'project', pid, legacy: false, query: parseQuery(p[3]) }
  }
  return { kind: 'project', pid: _decode(h.split('?')[0]), legacy: true, query: parseQuery(h.split('?')[1]) }
}

/** 当前 hash 指向的案卷 id（工作台 / 递交页 / 画板页 / 旧路径）；面板 / 页面路由 ⇒ null */
export function readHashPid(): string | null {
  const r = parseHash()
  return r.kind === 'project' || r.kind === 'deliver' || r.kind === 'board' || r.kind === 'novelty' ? r.pid : null
}

/** 当前 hash 是页面路由（#/login、#/share/…、#/c/…、#/account、#/admin、#/deadlines、#/inbox、#/__ds）而非案卷 id / 面板 */
export function atPageRoute(): boolean {
  return PAGE_ROUTES.test(window.location.hash.replace(/^#\/?/, ''))
}

export function atDashboard(): boolean {
  return parseHash().kind === 'dashboard'
}

export function readHashShareToken(): string | null {
  const r = parseHash()
  return r.kind === 'share' ? r.token : null
}

const SHARE_RETURN_KEY = 'patent-studio:share-return'

/**
 * 分享领取页去登录前把 token 暂存（跳 #/login 会覆盖当前 share hash，login 成功后
 * enterWorkspace 取回并恢复 #/share/<token> 路由继续领取——W12 R14-01）。
 * sessionStorage：关标签即失效，不会跨会话串案。
 */
export function stashShareToken(token: string): void {
  try {
    sessionStorage.setItem(SHARE_RETURN_KEY, token)
  } catch {
    /* private mode 等：领不到就维持现状 */
  }
}

/** 取回并消费暂存的 share token（只消费一次；无暂存返回 null） */
export function takeShareToken(): string | null {
  try {
    const t = sessionStorage.getItem(SHARE_RETURN_KEY)
    if (t) sessionStorage.removeItem(SHARE_RETURN_KEY)
    return t
  } catch {
    return null
  }
}

export function readHashClientToken(): string | null {
  const r = parseHash()
  return r.kind === 'client' ? r.token : null
}

/** 当前工作台路由的 query（?c= / ?focus=）；非工作台 ⇒ {} */
export function readHashProjectQuery(): ProjectQuery {
  const r = parseHash()
  return r.kind === 'project' ? r.query : {}
}

export const projectHash = (pid: string, query?: ProjectQuery) => {
  const base = `/p/${encodeURIComponent(pid)}`
  const sp = new URLSearchParams()
  if (query?.panel) sp.set(COMPANION_PARAM, query.panel)
  if (query?.dl) sp.set('dl', query.dl)
  if (query?.c) sp.set('c', query.c)
  if (query?.focus) sp.set('focus', query.focus)
  const q = sp.toString()
  return q ? `${base}?${q}` : base
}

/** 工作台内伴随栏开/关回写 hash（replace，不多留历史；保留 c / focus）；非工作台路由不动 */
export function writeCompanionHash(panel: string | null) {
  const r = parseHash()
  if (r.kind !== 'project') return
  const next = { ...r.query }
  if (panel) next.panel = panel
  else delete next.panel
  const target = `#${projectHash(r.pid, next)}`
  if (window.location.hash !== target) window.location.replace(target)
}
export const deliverHash = (pid: string) => `${projectHash(pid)}/deliver`

/** W19 批4：查新记录卡页 */
export const noveltyHash = (pid: string) => `${projectHash(pid)}/novelty`
/** 画板页 #/p/<pid>/board?src=<stem>：src 缺省 = 新建图源；?img=<figs 图名> = 位图标注改图 */
export const boardHash = (pid: string, src?: string, img?: string) =>
  `/p/${encodeURIComponent(pid)}/board${src ? `?src=${encodeURIComponent(src)}` : img ? `?img=${encodeURIComponent(img)}` : ''}`
export const deadlinesHash = '/deadlines'
export const inboxHash = '/inbox'
export const workbenchHash = '/workbench'
/** B12 文稿编辑器页 #/edit/<caseId>/<docId> */
export const editorHash = (caseId: string, docId: string) => `/edit/${encodeURIComponent(caseId)}/${encodeURIComponent(docId)}`
export const figlibHash = '/figlib'
export const clientHash = (token: string) => `/c/${encodeURIComponent(token)}`

/** 写规范路径；旧 #/<pid> 打开同一案时也改写（replace，不多留一条历史）；已在该案递交页/画板页时不动 */
export function writeHashPid(pid: string) {
  const r = parseHash()
  if ((r.kind === 'deliver' || r.kind === 'board' || r.kind === 'novelty') && r.pid === pid) return
  if (r.kind === 'project' && r.pid === pid && !r.legacy) return
  if (r.kind === 'project' && r.pid === pid) window.location.replace(`#${projectHash(pid)}`)
  else window.location.hash = projectHash(pid)
}

export function goDashboard() {
  if (!atDashboard()) window.location.hash = '/'
}

/** 递交页 ⇄ 工作台（同一案：StoreBootstrap 的 hashchange 不会重开案） */
export function goDeliver(pid: string) {
  const r = parseHash()
  if (!(r.kind === 'deliver' && r.pid === pid)) window.location.hash = deliverHash(pid)
}

/** 工作台 → 查新记录卡页（同一案：StoreBootstrap 的 hashchange 不会重开案） */
export function goNovelty(pid: string) {
  const r = parseHash()
  if (!(r.kind === 'novelty' && r.pid === pid)) window.location.hash = noveltyHash(pid)
}

/** 工作台 → 画板页（同一案：StoreBootstrap 的 hashchange 不会重开案） */
export function goBoard(pid: string, src?: string, img?: string) {
  const r = parseHash()
  if (!(r.kind === 'board' && r.pid === pid && r.src === (src ?? null) && r.img === (img ?? null))) {
    window.location.hash = boardHash(pid, src, img)
  }
}
export function goWorkbench(pid: string, query?: ProjectQuery) {
  const r = parseHash()
  if (query && (query.c || query.focus)) {
    window.location.hash = projectHash(pid, query)
    return
  }
  if (!(r.kind === 'project' && r.pid === pid && !r.legacy)) window.location.hash = projectHash(pid)
}

/** 工作台内消费完 ?c= / ?focus= / ?dl= 后清掉一次性 query（replace，不多留历史）；?panel= 是状态参数，保留 */
export function clearProjectQuery() {
  const r = parseHash()
  if (r.kind === 'project' && (r.query.c || r.query.focus || r.query.dl)) window.location.replace(`#${projectHash(r.pid, r.query.panel ? { panel: r.query.panel } : undefined)}`)
}

/** 工作台案件空间 → 文稿编辑器页 */
export function goEditor(caseId: string, docId: string) {
  const r = parseHash()
  if (!(r.kind === 'edit' && r.caseId === caseId && r.docId === docId)) window.location.hash = editorHash(caseId, docId)
}
export function goDeadlines() {
  if (parseHash().kind !== 'deadlines') window.location.hash = deadlinesHash
}
export function goInbox() {
  if (parseHash().kind !== 'inbox') window.location.hash = inboxHash
}
export function goAccount() {
  if (parseHash().kind !== 'account') window.location.hash = '/account'
}
/** 机构管理（超管页面；?tab 缺省 = 成员） */
export function goAdmin() {
  if (parseHash().kind !== 'admin') window.location.hash = '/admin'
}
/** 机构审计日志直达（超管页面 ?tab=audit） */
export function goAudit() {
  window.location.hash = '/admin?tab=audit'
}
