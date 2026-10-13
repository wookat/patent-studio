// @vitest-environment jsdom
import { act, useEffect, useRef, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useFocusReturnOnUnmount } from '@/components/ui/focus-return'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Rail } from '@/components/shell/Rail'
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog'
import { useStudio } from '@/store'
import { useTextInputFocused } from '@/components/mobile/useTextInputFocused'

/**
 * W12 R3-03：store 受控（无 Radix Trigger）的 Dialog / Sheet 关闭后，键盘焦点要回到打开它的入口，而不是落到 body。
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let root: Root | null = null
let host: HTMLElement

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.matchMedia ??= (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  host?.remove()
})

async function mount(el: ReactElement) {
  host = document.createElement('main')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(el))
  return host
}

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)

/** Radix FocusScope 的关闭回焦在 setTimeout(0) 里执行 */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)))

async function escape() {
  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  await settle()
}

function ControlledDialog({ kind }: { kind: 'dialog' | 'sheet' }) {
  const [open, setOpen] = useState(false)
  const Body = kind === 'dialog' ? (
    <DialogContent data-testid="fr-content">
      <DialogTitle>标题</DialogTitle>
      <DialogDescription>说明</DialogDescription>
      <button type="button" data-testid="fr-inner">内部</button>
    </DialogContent>
  ) : (
    <SheetContent data-testid="fr-content">
      <SheetTitle>标题</SheetTitle>
      <SheetDescription>说明</SheetDescription>
      <button type="button" data-testid="fr-inner">内部</button>
    </SheetContent>
  )
  return (
    <>
      <button type="button" data-testid="fr-opener" onClick={() => setOpen(true)}>打开</button>
      {kind === 'dialog' ? <Dialog open={open} onOpenChange={setOpen}>{Body}</Dialog> : <Sheet open={open} onOpenChange={setOpen}>{Body}</Sheet>}
    </>
  )
}

describe('受控 Dialog / Sheet 关闭后焦点回入口（W12 R3-03）', () => {
  it.each(['dialog', 'sheet'] as const)('%s：键盘打开 → Tab 到内部 → Escape → 焦点回到打开按钮', async (kind) => {
    await mount(<ControlledDialog kind={kind} />)
    const opener = q<HTMLButtonElement>('[data-testid="fr-opener"]')!
    opener.focus()
    await act(async () => opener.click())
    expect(q('[data-testid="fr-content"]')).toBeTruthy()
    expect(q('[data-testid="fr-content"]')!.contains(document.activeElement)).toBe(true)
    q<HTMLButtonElement>('[data-testid="fr-inner"]')!.focus()
    await escape()
    expect(q('[data-testid="fr-content"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('入口在弹层打开期间被卸载：不抢焦点（保持 Radix 默认）', async () => {
    function Case() {
      const [open, setOpen] = useState(false)
      return (
        <>
          {!open && <button type="button" data-testid="fr-opener" onClick={() => setOpen(true)}>打开</button>}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent data-testid="fr-content">
              <DialogTitle>标题</DialogTitle>
              <DialogDescription>说明</DialogDescription>
            </DialogContent>
          </Dialog>
        </>
      )
    }
    await mount(<Case />)
    const opener = q<HTMLButtonElement>('[data-testid="fr-opener"]')!
    opener.focus()
    await act(async () => opener.click())
    expect(opener.isConnected).toBe(false)
    await escape()
    expect(q('[data-testid="fr-content"]')).toBeNull()
    expect(document.activeElement).not.toBe(opener)
  })

  describe('入口在另一个弹层里、且该弹层为子层让位而卸载（W12 R11-01，docs/plan/29）', () => {
    function Nested({ child }: { child: 'sheet' | 'dialog' }) {
      const [more, setMore] = useState(false)
      const [nav, setNav] = useState(false)
      const openNav = () => {
        setMore(false)
        setNav(true)
      }
      const ChildBody = child === 'dialog' ? (
        <DialogContent data-testid="fr-nav">
          <DialogTitle>子层</DialogTitle>
          <DialogDescription>说明</DialogDescription>
          <button type="button" data-testid="fr-nav-inner">内部</button>
        </DialogContent>
      ) : (
        <SheetContent data-testid="fr-nav" side="left">
          <SheetTitle>子层</SheetTitle>
          <SheetDescription>说明</SheetDescription>
          <button type="button" data-testid="fr-nav-inner">内部</button>
        </SheetContent>
      )
      return (
        <>
          <button type="button" data-testid="fr-tab-more" onClick={() => setMore(true)}>更多</button>
          <Sheet open={more} onOpenChange={setMore}>
            <SheetContent data-testid="fr-more" side="bottom">
              <SheetTitle>更多</SheetTitle>
              <SheetDescription>说明</SheetDescription>
              <button type="button" data-testid="fr-more-outline" onClick={openNav}>大纲</button>
            </SheetContent>
          </Sheet>
          {child === 'dialog' ? <Dialog open={nav} onOpenChange={setNav}>{ChildBody}</Dialog> : <Sheet open={nav} onOpenChange={setNav}>{ChildBody}</Sheet>}
        </>
      )
    }

    it.each(['sheet', 'dialog'] as const)('More Sheet → 子%s（More 卸载）→ Escape：焦点回到 More 的入口', async (child) => {
      await mount(<Nested child={child} />)
      const tabMore = q<HTMLButtonElement>('[data-testid="fr-tab-more"]')!
      tabMore.focus()
      await act(async () => tabMore.click())
      const outline = q<HTMLButtonElement>('[data-testid="fr-more-outline"]')!
      outline.focus()
      await act(async () => outline.click())
      await settle()
      expect(q('[data-testid="fr-more"]')).toBeNull()
      expect(outline.isConnected).toBe(false)
      expect(tabMore.isConnected).toBe(true)
      expect(q('[data-testid="fr-nav"]')!.contains(document.activeElement)).toBe(true)
      q<HTMLButtonElement>('[data-testid="fr-nav-inner"]')!.focus()
      await escape()
      expect(q('[data-testid="fr-nav"]')).toBeNull()
      expect(document.activeElement).toBe(tabMore)
    })

    it('子层入口仍连接时仍回入口本身（链首），不跳到外层入口', async () => {
      function Case() {
        const [more, setMore] = useState(false)
        const [nav, setNav] = useState(false)
        return (
          <>
            <button type="button" data-testid="fr-tab-more" onClick={() => setMore(true)}>更多</button>
            <Sheet open={more} onOpenChange={setMore}>
              <SheetContent data-testid="fr-more" side="bottom">
                <SheetTitle>更多</SheetTitle>
                <SheetDescription>说明</SheetDescription>
                <button type="button" data-testid="fr-more-outline" onClick={() => setNav(true)}>大纲</button>
              </SheetContent>
            </Sheet>
            <Dialog open={nav} onOpenChange={setNav}>
              <DialogContent data-testid="fr-nav">
                <DialogTitle>子层</DialogTitle>
                <DialogDescription>说明</DialogDescription>
              </DialogContent>
            </Dialog>
          </>
        )
      }
      await mount(<Case />)
      const tabMore = q<HTMLButtonElement>('[data-testid="fr-tab-more"]')!
      tabMore.focus()
      await act(async () => tabMore.click())
      const outline = q<HTMLButtonElement>('[data-testid="fr-more-outline"]')!
      outline.focus()
      await act(async () => outline.click())
      expect(q('[data-testid="fr-more"]')).toBeTruthy()
      await escape()
      expect(q('[data-testid="fr-nav"]')).toBeNull()
      expect(document.activeElement).toBe(outline)
    })
  })

  describe('内容挂载即 autoFocus（W12 R12-03，docs/plan/32）', () => {
    function AutoFocusDialog() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" data-testid="fr-opener" onClick={() => setOpen(true)}>打开</button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent data-testid="fr-content">
              <DialogTitle>标题</DialogTitle>
              <DialogDescription>说明</DialogDescription>
              {open && <input autoFocus data-testid="fr-input" />}
            </DialogContent>
          </Dialog>
        </>
      )
    }

    it('Dialog 内 <input autoFocus>：打开后焦点在输入，Escape 后回入口按钮而不是 body', async () => {
      await mount(<AutoFocusDialog />)
      const opener = q<HTMLButtonElement>('[data-testid="fr-opener"]')!
      opener.focus()
      await act(async () => opener.click())
      expect(document.activeElement).toBe(q('[data-testid="fr-input"]'))
      await escape()
      expect(q('[data-testid="fr-content"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
    })
  })

  describe('非 Radix 整屏面板 useFocusReturnOnUnmount（W12 R12-03，docs/plan/32）', () => {
    function Panel({ onClose }: { onClose(): void }) {
      const ref = useRef<HTMLElement>(null)
      useFocusReturnOnUnmount(ref)
      return (
        <section ref={ref} data-testid="fr-panel">
          <input autoFocus data-testid="fr-panel-input" />
          <button type="button" data-testid="fr-panel-close" onClick={onClose}>关闭</button>
        </section>
      )
    }
    function Shell() {
      const [open, setOpen] = useState(false)
      const [more, setMore] = useState(false)
      return (
        <>
          <button type="button" data-testid="fr-opener" onClick={() => setOpen(true)}>设置</button>
          <button type="button" data-testid="fr-other-tab" onClick={() => setOpen(false)}>编辑</button>
          <button type="button" data-testid="fr-tab-more" onClick={() => setMore(true)}>更多</button>
          <Sheet open={more} onOpenChange={setMore}>
            <SheetContent data-testid="fr-more" side="bottom">
              <SheetTitle>更多</SheetTitle>
              <SheetDescription>说明</SheetDescription>
              <button
                type="button"
                data-testid="fr-more-settings"
                onClick={() => {
                  setMore(false)
                  setOpen(true)
                }}
              >
                排版设置
              </button>
            </SheetContent>
          </Sheet>
          {open && <Panel onClose={() => setOpen(false)} />}
        </>
      )
    }

    it('入口按钮 → 面板（输入 autoFocus）→ 点面板内关闭：焦点回入口', async () => {
      await mount(<Shell />)
      const opener = q<HTMLButtonElement>('[data-testid="fr-opener"]')!
      opener.focus()
      await act(async () => opener.click())
      expect(document.activeElement).toBe(q('[data-testid="fr-panel-input"]'))
      await act(async () => q<HTMLButtonElement>('[data-testid="fr-panel-close"]')!.click())
      expect(q('[data-testid="fr-panel"]')).toBeNull()
      expect(document.activeElement).toBe(opener)
    })

    it('面板因点了外部按钮而收起：焦点留在外部按钮，不抢', async () => {
      await mount(<Shell />)
      const opener = q<HTMLButtonElement>('[data-testid="fr-opener"]')!
      opener.focus()
      await act(async () => opener.click())
      const other = q<HTMLButtonElement>('[data-testid="fr-other-tab"]')!
      other.focus()
      await act(async () => other.click())
      expect(q('[data-testid="fr-panel"]')).toBeNull()
      expect(document.activeElement).toBe(other)
    })

    it('入口在 More Sheet 里且 Sheet 随之卸载：关闭面板后回 More 的入口（链继承）', async () => {
      await mount(<Shell />)
      const tabMore = q<HTMLButtonElement>('[data-testid="fr-tab-more"]')!
      tabMore.focus()
      await act(async () => tabMore.click())
      const item = q<HTMLButtonElement>('[data-testid="fr-more-settings"]')!
      item.focus()
      await act(async () => item.click())
      await settle()
      expect(q('[data-testid="fr-more"]')).toBeNull()
      expect(item.isConnected).toBe(false)
      expect(q('[data-testid="fr-panel"]')).toBeTruthy()
      await act(async () => q<HTMLButtonElement>('[data-testid="fr-panel-close"]')!.click())
      expect(q('[data-testid="fr-panel"]')).toBeNull()
      expect(document.activeElement).toBe(tabMore)
    })

    /**
     * 375 真机时序（Chrome 实测）：底部 Tab 栏在文本输入得焦期间 `hidden`；输入上按 Esc 由全局热键关面板，面板卸载时输入才失焦，
     * Tab 栏要等下一次渲染才重新显示——卸载 cleanup 里那一次 `focus()` 打在还不可聚焦的入口上无效。
     * jsdom 没有渲染，用 `disabled` 代替 `hidden` 表示「此刻不可聚焦」；jsdom 也不会在被移除的聚焦元素上派发 focusout（Chrome 会），这里手工补一次。
     */
    it('Tab 栏随输入得焦而隐藏、Esc 在输入上关面板：焦点仍回 More 入口（下一 tick 重试）', async () => {
      function KeyboardAwareShell() {
        const [open, setOpen] = useState(false)
        const inputFocused = useTextInputFocused()
        useEffect(() => {
          const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [])
        return (
          <>
            <button type="button" data-testid="fr-tab-more" disabled={inputFocused} onClick={() => setOpen(true)}>
              更多
            </button>
            {open && <Panel onClose={() => setOpen(false)} />}
          </>
        )
      }
      await mount(<KeyboardAwareShell />)
      const tabMore = q<HTMLButtonElement>('[data-testid="fr-tab-more"]')!
      tabMore.focus()
      await act(async () => tabMore.click())
      const input = q<HTMLInputElement>('[data-testid="fr-panel-input"]')!
      expect(document.activeElement).toBe(input)
      expect(tabMore.disabled).toBe(true)
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(q('[data-testid="fr-panel"]')).toBeNull()
      await act(async () => {
        document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      })
      expect(tabMore.disabled).toBe(false)
      await settle()
      expect(document.activeElement).toBe(tabMore)
    })
  })

  describe('入口在正在退出的 Radix 菜单里（W12 R12-04）', () => {
    /**
     * 1440 顶栏案卷菜单 → 「重命名」/「复制」：菜单项 onSelect 经 store 微任务开 Dialog，此时菜单因
     * Presence 退出动画仍在 DOM 但 `data-state` 已 `closed`；鼠标打开时触发钮 preventDefault 从未得焦，
     * 入口链须沿菜单内容常驻的 `aria-labelledby` 找回触发钮。同时 Radix `onItemLeave` 会在退出期间把
     * 焦点还给 content——全局 focusin 捕获要撤销这次偷窃。
     */
    function MenuDialog({ autoFocus = false, menuState = 'closed' }: { autoFocus?: boolean; menuState?: 'open' | 'closed' }) {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" id="fr-menu-trigger" data-testid="fr-menu-trigger">案卷</button>
          <div role="menu" data-radix-menu-content="" data-state={menuState} aria-labelledby="fr-menu-trigger">
            <button type="button" role="menuitem" data-testid="fr-menu-item" onClick={() => setOpen(true)}>重命名</button>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent data-testid="fr-content">
              <DialogTitle>标题</DialogTitle>
              <DialogDescription>说明</DialogDescription>
              {open && autoFocus && <input autoFocus data-testid="fr-input" />}
            </DialogContent>
          </Dialog>
        </>
      )
    }

    it('菜单项（退出动画中）打开 Dialog：Escape 后经 aria-labelledby 回到触发钮', async () => {
      await mount(<MenuDialog />)
      const trigger = q<HTMLButtonElement>('[data-testid="fr-menu-trigger"]')!
      const item = q<HTMLButtonElement>('[data-testid="fr-menu-item"]')!
      item.focus()
      await act(async () => item.click())
      expect(q('[data-testid="fr-content"]')).toBeTruthy()
      await escape()
      expect(q('[data-testid="fr-content"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })

    it('Dialog 内容 autoFocus 抢走焦点后打开入口仍解析为触发钮（历史回溯跳过退出层）', async () => {
      await mount(<MenuDialog autoFocus />)
      const trigger = q<HTMLButtonElement>('[data-testid="fr-menu-trigger"]')!
      const item = q<HTMLButtonElement>('[data-testid="fr-menu-item"]')!
      item.focus()
      await act(async () => item.click())
      expect(document.activeElement).toBe(q('[data-testid="fr-input"]'))
      await escape()
      expect(document.activeElement).toBe(trigger)
    })

    it('菜单关闭提交晚于 Dialog 挂载（挂载时菜单仍 data-state=open）：入口仍复原为触发钮', async () => {
      await mount(<MenuDialog menuState="open" />)
      const trigger = q<HTMLButtonElement>('[data-testid="fr-menu-trigger"]')!
      const item = q<HTMLButtonElement>('[data-testid="fr-menu-item"]')!
      item.focus()
      await act(async () => item.click())
      expect(q('[data-testid="fr-content"]')).toBeTruthy()
      await escape()
      expect(document.activeElement).toBe(trigger)
    })

    it('焦点被移进退出中的层（onItemLeave→content.focus()）：撤销并还给被偷的元素', async () => {
      await mount(
        <>
          <input data-testid="fr-prev" />
          <div data-radix-menu-content="" data-state="closed" tabIndex={-1} data-testid="fr-dying" />
        </>,
      )
      const input = q<HTMLInputElement>('[data-testid="fr-prev"]')!
      const dying = q<HTMLElement>('[data-testid="fr-dying"]')!
      input.focus()
      const spy = vi.spyOn(input, 'focus')
      await act(async () => {
        dying.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: input }))
      })
      expect(spy).toHaveBeenCalled()
    })

    it.each([
      ['仍在打开的层（data-state=open）', 'open'],
      ['被偷者也正在退出（relatedTarget 在退出层里）', 'closed-dying-prev'],
    ])('不干预：%s', async (_case, mode) => {
      const dyingPrev = mode === 'closed-dying-prev'
      await mount(
        <>
          <div data-radix-menu-content="" data-state="closed" data-testid="fr-dying">
            <button type="button" data-testid="fr-dying-item">项</button>
          </div>
          <div data-radix-menu-content="" data-state={dyingPrev ? 'closed' : 'open'} data-testid="fr-content-el" />
        </>,
      )
      const item = q<HTMLButtonElement>('[data-testid="fr-dying-item"]')!
      const spy = vi.spyOn(item, 'focus')
      await act(async () => {
        q<HTMLElement>('[data-testid="fr-content-el"]')!.dispatchEvent(
          new FocusEvent('focusin', { bubbles: true, relatedTarget: item }),
        )
      })
      expect(spy).not.toHaveBeenCalled()
    })
  })

  it('Rail「帮助与快捷键」→ ShortcutsDialog → Escape：焦点回 rail-help', async () => {
    useStudio.setState({ dialog: null })
    await mount(
      <TooltipProvider>
        <Rail />
        <ShortcutsDialog />
      </TooltipProvider>,
    )
    const help = q<HTMLButtonElement>('[data-testid="rail-help"]')!
    help.focus()
    await act(async () => help.click())
    expect(useStudio.getState().dialog).toBe('shortcuts')
    const dlg = q('[data-testid="shortcuts-dialog"]')!
    expect(dlg.contains(document.activeElement)).toBe(true)
    await escape()
    expect(useStudio.getState().dialog).toBeNull()
    expect(q('[data-testid="shortcuts-dialog"]')).toBeNull()
    expect(document.activeElement).toBe(help)
  })
})
