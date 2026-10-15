import { createContext, useContext, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown'
import { hotkeyLabel } from '@/lib/hotkeys'
import { FOCUS_RING, cn } from '@/lib/utils'
import { decodeMarkdownFile } from '@/lib/textFile'
import { useIsDark } from '@/hooks/useMisc'
import { selectReadonly, useStudio } from '@/store'
import { INSERT_KINDS, INSERT_LABELS, editorCommands } from '@/components/editor/commands'
import { ExportMenuItems } from './ExportMenu'
import { TemplateMenuItems } from '@/components/templates'
import { MenuCheckRow, MenuContent, MenuRow, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger } from '@/components/ui/menu-bits'
import { LAYOUT_MODES, showHistory } from './shellActions'
import { LayoutMenuItems } from './LayoutMenuItems'
import { BuildMenuItems } from './BuildMenuItems'
import { LABEL_NEW_PROJECT } from '@/lib/copy'
import { figlibHash } from '@/lib/hash'

/** 编辑菜单动作失败（编辑器未挂载，如仅预览 / 设置替换了编辑器）时的统一提示 */
function requireEditor(run: () => boolean) {
  if (!run()) useStudio.getState().toast('编辑器未显示：请先聚焦任意源码编辑器再试', 'info')
}

/** 查找是读操作：先走聚焦过卡片的 editorHandle（含只读视图），冷路径经 editorCommands 的 DOM 回退找卡 */
function openEditorSearch() {
  const h = useStudio.getState().editorHandle
  if (h) {
    h.openSearch()
    return
  }
  if (editorCommands.openSearch()) return
  useStudio.getState().toast('编辑器未显示：请先聚焦任意源码编辑器再试', 'info')
}

const MENU_IDS = ['file', 'edit', 'view', 'build', 'help'] as const
type MenuId = (typeof MENU_IDS)[number]

interface MenuBarState {
  openId: MenuId | null
  setOpenId: (id: MenuId | null) => void
  /** ←/→ 在顶级菜单间移动：菜单已展开则换展开邻居，否则只移动焦点 */
  step: (from: MenuId, dir: -1 | 1, open: boolean) => void
  register: (id: MenuId, el: HTMLButtonElement | null) => void
}

const MenuBarCtx = createContext<MenuBarState | null>(null)

function Menu({ id, label, children }: { id: MenuId; label: string; children: ReactNode }) {
  const bar = useContext(MenuBarCtx)
  const open = bar?.openId === id
  const onKey = (e: KeyboardEvent, opened: boolean) => {
    if (!bar || e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    if (opened) {
      const menu = (e.target as HTMLElement).closest('[role="menu"]')
      if (menu !== e.currentTarget) return
    }
    e.preventDefault()
    bar.step(id, e.key === 'ArrowLeft' ? -1 : 1, opened)
  }
  return (
    <DropdownMenu modal={false} open={bar ? open : undefined} onOpenChange={(o) => bar?.setOpenId(o ? id : null)}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          role="menuitem"
          ref={(el) => bar?.register(id, el)}
          onKeyDown={(e) => onKey(e, false)}
          className={cn(
            'inline-flex h-md-control items-center rounded-md px-2.5 text-base text-fg transition-colors',
            'hover:bg-hover hover:text-fg-strong data-[state=open]:bg-active data-[state=open]:text-fg-strong', FOCUS_RING,
          )}
          data-testid={`menu-${id}`}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <MenuContent
        align="start"
        sideOffset={2}
        onKeyDown={(e) => onKey(e, true)}
        onCloseAutoFocus={(e) => {
          if (bar?.openId && bar.openId !== id) e.preventDefault()
        }}
        data-testid={`menu-${id}-content`}
      >
        {children}
      </MenuContent>
    </DropdownMenu>
  )
}

/**
 * 顶栏文字菜单栏（07 §2.1 / 原型 .top .menus）：文件 / 编辑 / 视图 / 构建 / 帮助。
 * 14px 文字，项高 36px、下拉 240px、分组线、右侧灰字快捷键；Radix DropdownMenu 提供 Esc 关闭与方向键导航。
 * 菜单栏本身 role=menubar：Tab 在触发器间移动，←/→ 在顶级菜单间循环（展开时连带换展开邻居，子菜单内的 ←/→ 仍由 Radix 处理）。
 */
export function MenuBar({ className }: { className?: string }) {
  const [openId, setOpenId] = useState<MenuId | null>(null)
  const triggers = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({})
  const register = (id: MenuId, el: HTMLButtonElement | null) => {
    triggers.current[id] = el
  }
  const step = (from: MenuId, dir: -1 | 1, open: boolean) => {
    const next = MENU_IDS[(MENU_IDS.indexOf(from) + dir + MENU_IDS.length) % MENU_IDS.length]
    if (open) setOpenId(next)
    else triggers.current[next]?.focus()
  }
  return (
    <MenuBarCtx.Provider value={{ openId, setOpenId, step, register }}>
      <nav role="menubar" aria-label="主菜单" className={cn('flex items-center', className)} data-slot="MenuBar" data-testid="menubar">
        <FileMenu />
        <EditMenu />
        <ViewMenu />
        <BuildMenu />
        <HelpMenu />
      </nav>
    </MenuBarCtx.Provider>
  )
}

function FileMenu() {
  const pid = useStudio((s) => s.pid)
  const dirty = useStudio((s) => s.content !== s.saved)
  const saving = useStudio((s) => s.saving)
  const requestNavigation = useStudio((s) => s.requestNavigation)
  const fileRef = useRef<HTMLInputElement>(null)

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    const s = useStudio.getState()
    if (fileRef.current) fileRef.current.value = ''
    const text = decodeMarkdownFile(await file.arrayBuffer())
    if (text === null) {
      s.toast(`${file.name} 不是文本文件（Word 文档请用「文件 → 导入 → Word 文档…」）`, 'error')
      return
    }
    s.persistMergedContent(text.replace(/\r\n?/g, '\n'))
    s.toast(`已导入 ${file.name}，保存后生效`, 'info')
  }

  return (
    <>
    <Menu id="file" label="文件">
      <MenuRow noIcon onSelect={() => requestNavigation({ type: 'create-project' })} data-testid="file-new">
        {LABEL_NEW_PROJECT}…
      </MenuRow>
      <MenuSub>
        <MenuSubTrigger noIcon data-testid="file-import-menu">
          导入
        </MenuSubTrigger>
        <MenuSubContent className="min-w-[240px]">
          <MenuRow
            noIcon
            disabled={!pid}
            onSelect={() => requestNavigation({ type: 'custom', label: '导入 content.md', run: () => fileRef.current?.click() })}
            data-testid="file-import"
          >
            content.md…
          </MenuRow>
          <MenuRow
            noIcon
            onSelect={() => requestNavigation({ type: 'custom', label: '论文/交底书转专利', run: () => useStudio.getState().openDialog('convert') })}
            data-testid="file-import-convert"
          >
            论文/交底书转专利…
          </MenuRow>
        </MenuSubContent>
      </MenuSub>
      <MenuRow
        noIcon
        onSelect={() => requestNavigation({ type: 'custom', label: '导入 Word 文档', run: () => useStudio.getState().openDialog('import-docx') })}
        data-testid="file-import-docx"
      >
        导入 Word 文档…
      </MenuRow>
      <MenuRow
        noIcon
        disabled={!pid}
        onSelect={() => requestNavigation({ type: 'custom', label: '复制案卷', run: () => useStudio.getState().openDialog('duplicate') })}
        data-testid="file-duplicate"
      >
        复制案卷…
      </MenuRow>
      <MenuSeparator />
      <MenuRow noIcon disabled={!pid} onSelect={showHistory} data-testid="file-history">
        版本历史
      </MenuRow>
      <MenuRow
        noIcon
        disabled={!pid || saving || !dirty}
        onSelect={() => void useStudio.getState().save()}
        sub={hotkeyLabel('save')}
        data-testid="file-save"
      >
        保存
      </MenuRow>
      <MenuSeparator />
      <MenuSub>
        <MenuSubTrigger noIcon disabled={!pid} data-testid="file-export">
          导出
        </MenuSubTrigger>
        <MenuSubContent className="min-w-[260px]">
          <ExportMenuItems noIcon />
        </MenuSubContent>
      </MenuSub>
      <MenuSeparator />
      <MenuRow noIcon disabled={!pid} onSelect={() => useStudio.getState().toggleSettings()} sub={hotkeyLabel('toggleSettings')} data-testid="file-settings">
        排版设置
      </MenuRow>
      <TemplateMenuItems />
    </Menu>
    <input
      ref={fileRef}
      type="file"
      accept=".md,.markdown,.txt,text/markdown,text/plain"
      className="hidden"
      aria-hidden
      tabIndex={-1}
      onChange={(e) => void onImportFile(e.target.files?.[0])}
      data-testid="file-import-input"
    />
    </>
  )
}

function EditMenu() {
  const pid = useStudio((s) => s.pid)
  const readonly = useStudio(selectReadonly)
  return (
    <Menu id="edit" label="编辑">
      <MenuRow noIcon disabled={!pid || readonly} onSelect={() => requireEditor(() => editorCommands.undo())} sub={hotkeyLabel('undo')} data-testid="edit-undo">
        撤销
      </MenuRow>
      <MenuRow noIcon disabled={!pid || readonly} onSelect={() => requireEditor(() => editorCommands.redo())} sub={hotkeyLabel('redo')} data-testid="edit-redo">
        重做
      </MenuRow>
      <MenuRow
        noIcon
        disabled={!pid}
        onSelect={openEditorSearch}
        sub={hotkeyLabel('find')}
        data-testid="edit-find"
      >
        查找替换
      </MenuRow>
      <MenuSeparator />
      <MenuSub>
        <MenuSubTrigger noIcon disabled={!pid || readonly} data-testid="edit-insert">
          插入
        </MenuSubTrigger>
        <MenuSubContent>
          {INSERT_KINDS.map((kind) => (
            <MenuRow key={kind} noIcon onSelect={() => requireEditor(() => editorCommands.insert(kind))} data-testid={`insert-${kind}`}>
              {INSERT_LABELS[kind]}
            </MenuRow>
          ))}
        </MenuSubContent>
      </MenuSub>
    </Menu>
  )
}

function ViewMenu() {
  const layout = useStudio((s) => s.layout)
  const setLayout = useStudio((s) => s.setLayout)
  const sideOpen = useStudio((s) => s.sideOpen)
  const toggleSide = useStudio((s) => s.toggleSide)
  const consoleOpen = useStudio((s) => s.pdfView === 'logs')
  const togglePdfView = useStudio((s) => s.togglePdfView)
  const isDark = useIsDark()
  const toggleTheme = useStudio((s) => s.toggleTheme)
  return (
    <Menu id="view" label="视图">
      <MenuRow noIcon onSelect={() => useStudio.getState().openDialog('palette')} sub={hotkeyLabel('palette')} data-testid="view-palette">
        命令面板…
      </MenuRow>
      <MenuSeparator />
      {LAYOUT_MODES.map((m) => (
        <MenuCheckRow key={m.id} noIcon checked={layout === m.id} onSelect={() => setLayout(m.id)} sub={m.id === 'split' ? hotkeyLabel('cycleLayout') : undefined} data-testid={`view-layout-${m.id}`}>
          {m.label}
        </MenuCheckRow>
      ))}
      <LayoutMenuItems />
      <MenuSeparator />
      <MenuCheckRow noIcon kind="checkbox" checked={sideOpen} onSelect={() => toggleSide()} sub={hotkeyLabel('toggleOutline')} data-testid="view-side">
        案卷与大纲
      </MenuCheckRow>
      <MenuCheckRow noIcon kind="checkbox" checked={consoleOpen} onSelect={() => togglePdfView()} sub={hotkeyLabel('toggleBottom')} data-testid="view-console">
        控制台（替换预览区）
      </MenuCheckRow>
      <MenuSeparator />
      <MenuRow
        noIcon
        onSelect={() => useStudio.getState().requestNavigation({ type: 'custom', label: '附图图库', run: () => { window.location.hash = figlibHash } })}
        data-testid="view-figlib"
      >
        附图图库
      </MenuRow>
      <MenuSeparator />
      <MenuCheckRow noIcon kind="checkbox" checked={isDark} onSelect={() => toggleTheme()} data-testid="view-dark">
        深色模式
      </MenuCheckRow>
    </Menu>
  )
}

function BuildMenu() {
  return (
    <Menu id="build" label="构建">
      <BuildMenuItems />
    </Menu>
  )
}

function HelpMenu() {
  const openDialog = useStudio((s) => s.openDialog)
  return (
    <Menu id="help" label="帮助">
      <MenuRow noIcon onSelect={() => openDialog('syntax')} data-testid="help-syntax">
        源码语法
      </MenuRow>
      <MenuRow noIcon onSelect={() => openDialog('shortcuts')} sub="?" data-testid="help-shortcuts">
        快捷键
      </MenuRow>
      <MenuSeparator />
      <MenuRow noIcon onSelect={() => openDialog('about')} data-testid="help-about">
        关于知撰
      </MenuRow>
    </Menu>
  )
}
