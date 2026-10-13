import { describe, expect, it } from 'vitest'
import { SYNTH_AST } from '@/lib/__tests__/astFixture'
import {
  THREE_VIEWS,
  blockFocusOf,
  currentView,
  isSideBySide,
  planSideBySide,
  planViewSwitch,
  viewForHotkey,
  type ViewSwitchState,
} from '../viewSwitchPlan'

const base: ViewSwitchState = {
  activePanelId: null,
  editorView: 'source',
  activeBook: 'all',
  openPanels: null,
  ast: null,
  activeBlockId: null,
  cursorLine: 1,
}

const st = (o: Partial<ViewSwitchState>): ViewSwitchState => ({ ...base, ...o })

describe('currentView', () => {
  it('三视图恰好三段：源码 / 版面 / PDF', () => {
    expect(THREE_VIEWS).toEqual(['source', 'layout', 'pdf'])
  })
  it('活动卡片是源码 / 版面 / PDF → 取卡片；非三视图卡片或无 dock → 回退 editorView', () => {
    expect(currentView({ activePanelId: 'layout:claims', editorView: 'source' })).toEqual({ view: 'layout', panelId: 'layout:claims', book: 'claims' })
    expect(currentView({ activePanelId: 'pdf', editorView: 'source' })).toEqual({ view: 'pdf', panelId: 'pdf', book: null })
    expect(currentView({ activePanelId: 'outline', editorView: 'layout' })).toEqual({ view: 'layout', panelId: null, book: null })
    expect(currentView({ activePanelId: null, editorView: 'source' })).toEqual({ view: 'source', panelId: null, book: null })
  })
})

describe('blockFocusOf（切换保持块：block_id 单一身份）', () => {
  it('无 AST → null', () => {
    expect(blockFocusOf({ ast: null, activeBlockId: 'claims/2', cursorLine: 9 })).toBeNull()
  })
  it('activeBlock 优先：给出书 / block_id / 全文首行', () => {
    expect(blockFocusOf({ ast: SYNTH_AST, activeBlockId: 'claims/2', cursorLine: 1 })).toEqual({ book: 'claims', blockId: 'claims/2', line: 11 })
  })
  it('无 activeBlock（或 id 不存在）→ 光标行所在块', () => {
    const f = blockFocusOf({ ast: SYNTH_AST, activeBlockId: 'nope', cursorLine: 26 })
    expect(f).toEqual({ book: 'description', blockId: 'description/背景技术/p0002', line: 26 })
    // 表格 3 行：中间行也归到该块首行
    expect(blockFocusOf({ ast: SYNTH_AST, activeBlockId: null, cursorLine: 51 })).toMatchObject({ blockId: 'description/具体实施方式/p0008', line: 50 })
  })
})

describe('planViewSwitch', () => {
  it('同视图且活动卡片就是它 → 不动卡片；PDF 不改 editorView', () => {
    expect(planViewSwitch('layout', st({ activePanelId: 'layout:claims', openPanels: ['layout:claims'] })).ops).toEqual([])
    expect(planViewSwitch('pdf', st({ activePanelId: 'pdf', openPanels: ['pdf'] }))).toMatchObject({ editorView: null, ops: [] })
  })
  it('无 dock（375）→ 一条 open（走 store.openPanel 的移动退化），书取 focus 书 / activeBook', () => {
    expect(planViewSwitch('layout', st({ ast: SYNTH_AST, activeBlockId: 'claims/2' })).ops).toEqual([{ type: 'open', id: 'layout:claims' }])
    expect(planViewSwitch('pdf', st({ editorView: 'layout' })).ops).toEqual([{ type: 'open', id: 'pdf' }])
  })
  it('源码 → 版面：所有源码卡一起换（replace 原位），活动卡最后；目标已存在则只关旧并聚焦目标', () => {
    const p = planViewSwitch('layout', st({ activePanelId: 'source:claims', openPanels: ['source:description', 'source:claims', 'outline'] }))
    expect(p.editorView).toBe('layout')
    expect(p.ops).toEqual([
      { type: 'open', id: 'layout:description', opts: { replace: 'source:description' } },
      { type: 'open', id: 'layout:claims', opts: { replace: 'source:claims' } },
    ])
    const q = planViewSwitch('layout', st({ activePanelId: 'source:claims', openPanels: ['source:claims', 'layout:claims'] }))
    expect(q.ops).toEqual([{ type: 'close', id: 'source:claims' }, { type: 'open', id: 'layout:claims' }])
  })
  it('→ PDF：已开则聚焦，否则 replace 当前卡；PDF → 源码：优先同书卡，再全文卡，再任一，否则 replace PDF 卡', () => {
    expect(planViewSwitch('pdf', st({ activePanelId: 'source:claims', openPanels: ['source:claims', 'pdf'] })).ops).toEqual([{ type: 'open', id: 'pdf' }])
    expect(planViewSwitch('pdf', st({ activePanelId: 'source:claims', openPanels: ['source:claims'] })).ops).toEqual([
      { type: 'open', id: 'pdf', opts: { replace: 'source:claims' } },
    ])
    const fromPdf = (open: string[], activeBook: ViewSwitchState['activeBook'] = 'claims') =>
      planViewSwitch('source', st({ activePanelId: 'pdf', openPanels: open as ViewSwitchState['openPanels'], activeBook })).ops
    expect(fromPdf(['pdf', 'source:claims', 'source:all'])).toEqual([{ type: 'open', id: 'source:claims' }])
    expect(fromPdf(['pdf', 'source:all'])).toEqual([{ type: 'open', id: 'source:all' }])
    expect(fromPdf(['pdf', 'source:description'])).toEqual([{ type: 'open', id: 'source:description' }])
    expect(fromPdf(['pdf'])).toEqual([{ type: 'open', id: 'source:claims', opts: { replace: 'pdf' } }])
  })
  it('计划带回当前块 focus（切换后广播 → 目标视图滚到同 block_id）', () => {
    const p = planViewSwitch('layout', st({ activePanelId: 'source:claims', openPanels: ['source:claims'], ast: SYNTH_AST, cursorLine: 13 }))
    expect(p.focus).toEqual({ book: 'claims', blockId: 'claims/3', line: 13 })
  })
})

describe('并排（当前视图 + PDF）', () => {
  it('isSideBySide：PDF + 任一源码 / 版面卡', () => {
    expect(isSideBySide(null)).toBe(false)
    expect(isSideBySide(['pdf'])).toBe(false)
    expect(isSideBySide(['source:claims', 'outline'])).toBe(false)
    expect(isSideBySide(['layout:all', 'pdf'])).toBe(true)
  })
  it('开：PDF 放在当前卡右侧；已开不重复；无 dock 无操作', () => {
    expect(planSideBySide(true, { activePanelId: 'layout:claims', editorView: 'layout', openPanels: ['layout:claims'] })).toEqual([
      { type: 'open', id: 'pdf', opts: { position: { referencePanel: 'layout:claims', direction: 'right' } } },
    ])
    expect(planSideBySide(true, { activePanelId: 'outline', editorView: 'source', openPanels: ['source:all', 'outline'] })).toEqual([
      { type: 'open', id: 'pdf', opts: { position: { referencePanel: 'source:all', direction: 'right' } } },
    ])
    expect(planSideBySide(true, { activePanelId: 'source:all', editorView: 'source', openPanels: ['source:all', 'pdf'] })).toEqual([])
    expect(planSideBySide(true, { activePanelId: null, editorView: 'source', openPanels: null })).toEqual([])
  })
  it('关：关 PDF 卡；当前就在 PDF 卡上不关（避免把用户正在看的卡关掉）', () => {
    expect(planSideBySide(false, { activePanelId: 'source:all', editorView: 'source', openPanels: ['source:all', 'pdf'] })).toEqual([{ type: 'close', id: 'pdf' }])
    expect(planSideBySide(false, { activePanelId: 'pdf', editorView: 'source', openPanels: ['source:all', 'pdf'] })).toEqual([])
    expect(planSideBySide(false, { activePanelId: 'source:all', editorView: 'source', openPanels: ['source:all'] })).toEqual([])
  })
})

describe('viewForHotkey（Ctrl+1/2/3；mac ⌘）', () => {
  const ev = (o: Partial<KeyboardEvent>) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, key: '', code: '', ...o })
  it('Ctrl+1/2/3 → 源码 / 版面 / PDF；带 Alt / Shift 不算（Mod-Alt-1/2/3 旧热键不冲突）', () => {
    expect(viewForHotkey(ev({ ctrlKey: true, key: '1' }))).toBe('source')
    expect(viewForHotkey(ev({ ctrlKey: true, key: '2' }))).toBe('layout')
    expect(viewForHotkey(ev({ ctrlKey: true, key: '3', code: 'Digit3' }))).toBe('pdf')
    expect(viewForHotkey(ev({ ctrlKey: true, altKey: true, key: '1' }))).toBeNull()
    expect(viewForHotkey(ev({ ctrlKey: true, shiftKey: true, key: '!' , code: 'Digit1' }))).toBeNull()
    expect(viewForHotkey(ev({ ctrlKey: true, key: '4' }))).toBeNull()
    expect(viewForHotkey(ev({ key: '1' }))).toBeNull()
  })
  it('mac 用 ⌘（metaKey），Ctrl 不触发；非 mac 反之', () => {
    expect(viewForHotkey(ev({ metaKey: true, key: '2' }), true)).toBe('layout')
    expect(viewForHotkey(ev({ ctrlKey: true, key: '2' }), true)).toBeNull()
    expect(viewForHotkey(ev({ metaKey: true, key: '2' }), false)).toBeNull()
  })
})
