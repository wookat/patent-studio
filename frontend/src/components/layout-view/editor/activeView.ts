import type { EditorView } from 'prosemirror-view'

/**
 * 版面视图（ProseMirror）存活编辑器登记表，与 review/criticExtension 的 CodeMirror `liveViews` 同构：
 * BookEditor 挂载即入表、DOM focus 前置、destroy 摘除；多张版面卡并存时 `active` = 最近创建 / 最近得焦的那张。
 * ReviewPanel「添加批注」经 `editorSelection()` 读取（W12 R12-05，docs/plan/34）。
 */
const live: EditorView[] = []
let active: EditorView | null = null

export function promotePmView(view: EditorView): void {
  const i = live.indexOf(view)
  if (i >= 0) live.splice(i, 1)
  live.push(view)
  active = view
}

export function demotePmView(view: EditorView): void {
  const i = live.indexOf(view)
  if (i >= 0) live.splice(i, 1)
  if (active === view) active = live.at(-1) ?? null
}

/** 当前活动版面编辑器；已摘除 / 已脱离 DOM 的返回 null */
export function activePmView(): EditorView | null {
  return active && active.dom.isConnected ? active : null
}
