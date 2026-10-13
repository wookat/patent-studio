import { useEffect } from 'react'
import { useStudio, selectDirty } from '@/store'
import { goDashboard, parseHash, readHashPid, writeHashPid, clearProjectQuery } from '@/lib/hash'
import { dispatchHotkey, matchHotkey, registerHotkeys } from '@/lib/hotkeys'
import { bindLayoutHotkeys } from '@/lib/layoutShortcuts'
import { preflightLocate, lineForBlock } from '@/components/preflight/preflightUtils'

/** F8 / Shift+F8：按行号循环跳到下一条 / 上一条可定位的诊断，并展开问题面板 */
function stepProblem(dir: 1 | -1) {
  const s = useStudio.getState()
  const lines = [...new Set(s.items.map((d) => d.line).filter((l): l is number => l !== null))].sort((a, b) => a - b)
  if (!lines.length) return
  const cur = s.cursor.line
  const next = dir === 1 ? (lines.find((l) => l > cur) ?? lines[0]) : (lines.filter((l) => l < cur).pop() ?? lines[lines.length - 1])
  s.gotoLine(next)
  s.openBottom('problems')
}

/** 焦点在 Radix 弹层（菜单/对话框/抽屉）内时，Esc 由弹层自行处理，其余快捷键仍全局生效 */
function inOverlay(el: Element | null): boolean {
  return !!el?.closest('[role="dialog"],[role="menu"],[role="alertdialog"]')
}

/** 深链接指向不存在 / 无权的案（openProject 已 toast）⇒ 回面板，不把用户留在空壳里 */
async function openFromHash(pid: string) {
  await useStudio.getState().openProject(pid)
  const s = useStudio.getState()
  if (s.pid === pid && s.projectError && readHashPid() === pid) goDashboard()
}

/** hashchange：换案 / 重试开案失败的案才真正 openProject；同一案的旧 #/<pid> 只改写成 #/p/<pid> */
function onHashChange() {
  const pid = readHashPid()
  if (!pid) return
  const s = useStudio.getState()
  // anon（登出后同页 hashchange）不开案：与启动路径一致，避免 GET /projects/<pid> 401
  if (s.authStatus === 'anon') return
  if (pid !== s.pid || (!s.project && s.projectError)) void openFromHash(pid)
  else writeHashPid(pid)
}

/** `#/p/<pid>?focus=<block_id>`（R56-02：AI 通知等深链）：hash 到达即挂起 + 清 query，案与 AST 就绪后 resolveFocusRequest 消费 */
function readFocusFromHash() {
  const r = parseHash()
  if (r.kind !== 'project' || !r.query.focus) return
  useStudio.getState().requestFocusBlock(r.pid, r.query.focus)
  clearProjectQuery()
}

function resolveFocusRequest() {
  const s = useStudio.getState()
  const req = s.focusRequest
  if (!req || s.pid !== req.pid || s.projectLoading || s.astPid !== req.pid || s.astLoading) return
  s.clearFocusRequest()
  // ?focus=<块id> 深链：目标块在 AST 中确实不存在（文档已改）时给反馈——与 ?c=<cid>「该批注不存在或已被删除」同契约，
  // 否则定位链静默全落空（源码不跳 / 大纲无节点 / PDF 无查找词），用户只见案子打开而不知深链失效
  const ast = s.ast
  const exists = ast
    ? req.blockId === 'abstract' || req.blockId === 'claims' || req.blockId === 'description'
      ? true
      : req.blockId.startsWith('figures/')
        ? ast.figures.some((f) => f.id === req.blockId)
        : lineForBlock(ast, req.blockId) !== null
    : null
  if (exists === false) s.toast('定位目标不存在或已变更', 'info')
  else preflightLocate(null, req.blockId)
}

/** Mod-f/h 冷路径：编辑器从未聚焦过时 editorHandle 为空——经 editorCommands 的 DOM 回退找卡（与 MenuBar 查找同口径） */
function openEditorFind() {
  const h = useStudio.getState().editorHandle
  if (h) {
    h.openSearch()
    return
  }
  void import('@/components/editor/commands').then((m) => m.editorCommands.openSearch())
}

/**
 * 无 UI 的启动器（05 §1 App.tsx）：
 *  - 拉 projects / defaults / health；
 *  - hash 路由 #/p/<pid>（旧 #/<pid>）↔ project.openProject；#/（面板）、#/login、#/share 不自动开案（13 §5：首页 = 面板，不再默认开第一个案子）；
 *  - document.title、主题 class、beforeunload dirty 守卫、全局快捷键。
 */
export function StoreBootstrap() {
  useEffect(() => {
    let alive = true
    void (async () => {
      // 客户确认页（#/client/<token>）是匿名公开页：不拉 me / bootstrap，避免 2 个 401
      if (parseHash(window.location.hash).kind === 'client') return
      const st = useStudio.getState()
      await st.loadMe()
      try {
        await st.loadBootstrap()
      } catch (e) {
        st.toast(`后端不可用：${(e as Error).message}`, 'error')
      }
      if (!alive) return
      const s = useStudio.getState()
      if (!s.health?.ok && !s.projects.length) s.toast('后端不可用，请确认 :8000 已启动', 'error')
      // anon（auth=on 未登录）不自动开案：进案交给 LoginPage 登录后的 enterWorkspace，避免一串 401
      if (s.authStatus === 'anon') return
      const pid = readHashPid()
      if (pid) void openFromHash(pid)
    })()

    window.addEventListener('hashchange', onHashChange)
    window.addEventListener('hashchange', readFocusFromHash)
    const unsubFocusReq = useStudio.subscribe((s, prev) => {
      if (s.focusRequest && (s.focusRequest !== prev.focusRequest || s.ast !== prev.ast || s.astLoading !== prev.astLoading || s.pid !== prev.pid || s.projectLoading !== prev.projectLoading))
        queueMicrotask(resolveFocusRequest)
    })
    readFocusFromHash()

    const onUnload = (e: BeforeUnloadEvent) => {
      if (selectDirty(useStudio.getState())) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)

    /* document.title 路由感知：页签路由各自落名，页级自有设置器（PageChrome/登录/分享/客户页）不覆盖。
       此前只跟 project 订阅——账户页返回工作台标题残留「账户」；期限/通知页则残留案名。 */
    const applyTitle = () => {
      const r = parseHash()
      if (r.kind === 'project') {
        const p = useStudio.getState().project
        document.title = p ? `${p.title || p.id} · Patent Studio` : 'Patent Studio'
      } else if (r.kind === 'dashboard') document.title = 'Patent Studio'
      else if (r.kind === 'deadlines') document.title = '期限中心 · Patent Studio'
      else if (r.kind === 'inbox') document.title = '通知中心 · Patent Studio'
    }
    const unsubTitle = useStudio.subscribe((s) => s.project, applyTitle, { fireImmediately: true })
    window.addEventListener('hashchange', applyTitle)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const t = useStudio.getState().theme
      document.documentElement.classList.toggle('dark', t === 'dark' || (t === 'system' && mq.matches))
    }
    const unsubTheme = useStudio.subscribe((s) => s.theme, applyTheme, { fireImmediately: true })
    mq.addEventListener('change', applyTheme)

    const unregHotkeys = registerHotkeys({
      save: () => void useStudio.getState().save(),
      build: () => useStudio.getState().enqueue('manual', true),
      find: () => openEditorFind(),
      // CM 查找面板自带替换行——Mod-h 与 Mod-f 同入口（R52-02：速查表宣传键接线）
      replace: () => openEditorFind(),
      // editor/commands 拖 CodeMirror——动态 import 把它挡在首屏分包外（工作台里模块已缓存，热键不增延迟）
      palette: () => {
        const s = useStudio.getState()
        // 已开对话框不抢占——替换 dialog id 会卸载其组件，草稿态随之丢（与 help 同守卫）；
        // 登录墙/分享页不弹（anon 唯一禁项）——AUTH=off 单用户模式菜单已宣传此键，热键不得死链（D-JRN-2）
        if (!s.dialog && s.authStatus !== 'anon') s.openDialog('palette')
      },
      undo: () => void import('@/components/editor/commands').then((m) => m.editorCommands.undo()),
      redo: () => void import('@/components/editor/commands').then((m) => m.editorCommands.redo()),
      toggleSettings: () => useStudio.getState().toggleSettings(),
      toggleBottom: () => useStudio.getState().toggleBottom(),
      toggleOutline: () => useStudio.getState().toggleOutline(),
      cycleLayout: () => useStudio.getState().cycleLayout(),
      nextProblem: () => stepProblem(1),
      prevProblem: () => stepProblem(-1),
      escape: () => {
        const s = useStudio.getState()
        if (s.dialog) s.closeDialog()
        else if (s.settingsOpen) s.toggleSettings(false)
        else if (s.bottomOpen) s.toggleBottom(false)
      },
      help: () => {
        const s = useStudio.getState()
        if (!s.dialog) s.openDialog('shortcuts')
      },
    })
    const unbindLayoutHotkeys = bindLayoutHotkeys()
    // 02 §6：快捷键全局生效，不限 CodeMirror 内。Esc 在 Radix 弹层内交由弹层处理；
    // `?` / 撤销重做 只在焦点不在可编辑区时触发（避免吞掉正文输入；CodeMirror 内由它自己的 historyKeymap 处理）。
    // R52-01/03：原生输入控件里不触发全局命令（Ctrl+B 在搜索框里曾是收起其所在侧栏）；
    // 编辑器（.cm-content / ProseMirror contenteditable）保持全局键——编辑器自家消费的键会 preventDefault 先拦；IME 组合期一律不触发。
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const target = e.target as Element | null
      const editing = !!target?.closest('input,textarea,select,[contenteditable="true"],.cm-content')
      const plainField = !!target?.closest('input,textarea,select')
      if (e.key === 'Escape' && inOverlay(target)) return
      if (editing && (e.key === '?' || matchHotkey(e, 'undo') || matchHotkey(e, 'redo'))) return
      if (plainField && e.key !== 'Escape' && !matchHotkey(e, 'palette')) return
      dispatchHotkey(e)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      alive = false
      window.removeEventListener('hashchange', onHashChange)
      window.removeEventListener('hashchange', readFocusFromHash)
      window.removeEventListener('hashchange', applyTitle)
      unsubFocusReq()
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('keydown', onKeyDown)
      mq.removeEventListener('change', applyTheme)
      unsubTitle()
      unsubTheme()
      unregHotkeys()
      unbindLayoutHotkeys()
    }
  }, [])
  return null
}
