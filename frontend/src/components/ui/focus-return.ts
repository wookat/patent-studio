import * as React from 'react'

interface AutoFocusProps<T extends HTMLElement = HTMLElement> {
  ref?: React.Ref<T | null>
  onCloseAutoFocus?: (event: Event) => void
}

/** 已打开的弹层容器 → 它的入口链（自己的入口在前，外层弹层的入口在后） */
const chains = new WeakMap<Element, HTMLElement[]>()

const isConnected = (el: HTMLElement) => el.isConnected

/**
 * 正在退出的 Radix 层：Presence 退出动画期间节点仍在 DOM，但 `data-state` 已翻成 `closed`。
 * 还有代码会把焦点移进去（菜单项 pointerleave 时 Radix 把焦点还给 content）——层随即卸载，焦点落到 body。
 */
const DYING_LAYER =
  '[data-radix-menu-content][data-state="closed"], [role="dialog"][data-state="closed"], [role="alertdialog"][data-state="closed"], [role="listbox"][data-state="closed"]'
const dyingLayerOf = (el: Element | null | undefined) => (el instanceof Element ? el.closest(DYING_LAYER) : null)

/** 菜单内容（任意 state）：菜单项被点中时菜单随之道出，但 data-state 翻 closed 的提交可能晚于弹层挂载——入口候选落在菜单里一律不可采 */
const MENU_LAYER = '[data-radix-menu-content]'

/** 可做入口/归还目标：在文档里、不是 body、且不在正在退出的 Radix 层里 */
const returnable = (el: unknown): el is HTMLElement =>
  el instanceof HTMLElement && el !== document.body && el.isConnected && !dyingLayerOf(el)

/**
 * 候选落在正在退出的层里时复原真实入口：Radix 菜单内容的 `aria-labelledby` 常驻指向触发钮 id
 * （鼠标打开时触发钮 preventDefault 从未得焦，`recent` 里没有它），沿它一跳一跳找回
 * （子菜单内容的 labelledby 指向子菜单触发钮——它自己还在退出的父菜单里，继续跳）。
 * 非菜单层（Dialog 的 labelledby 指向标题）无法复原，返回 null 交给历史回溯。
 */
function reviveOpener(candidate: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = candidate
  for (let hop = 0; hop < 4 && cur; hop += 1) {
    const dead: Element | null = dyingLayerOf(cur) ?? cur.closest(MENU_LAYER)
    if (!dead) return cur.isConnected ? cur : null
    const id: string | null = dead.hasAttribute('data-radix-menu-content') ? dead.getAttribute('aria-labelledby') : null
    const next: HTMLElement | null = id ? document.getElementById(id) : null
    cur = next instanceof HTMLElement && next !== candidate ? next : null
  }
  return null
}

/** `from` 所在的最近弹层容器登记的入口链；不在任何弹层里则为 null */
function enclosingChain(from: Element | null): HTMLElement[] | null {
  for (let n = from?.parentElement ?? null; n; n = n.parentElement) {
    const chain = chains.get(n)
    if (chain) return chain
  }
  return null
}

/** 最近几次得焦的元素（新的在后）：弹层内容自带 `autoFocus` 时，登记入口的钩子已经读不到入口，从这里回溯 */
const RECENT = 4
const recent: HTMLElement[] = []
let tracking = false
function trackFocus() {
  if (tracking || typeof document === 'undefined') return
  tracking = true
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target
      if (!(t instanceof HTMLElement)) return
      const i = recent.indexOf(t)
      if (i >= 0) recent.splice(i, 1)
      recent.push(t)
      if (recent.length > RECENT) recent.shift()
      // 焦点被移进正在退出的菜单（onItemLeave→content.focus()）：菜单留不住焦点，撤销这次偷窃并还给被偷走的元素。
      // 只拦菜单：正在退出的 Dialog/Sheet 自带 FocusScope 还在往容器里收焦，跟它抢会 ping-pong——那种层交给层自己收尾。
      if (t.closest('[data-radix-menu-content][data-state="closed"]')) {
        const prev = e.relatedTarget
        if (returnable(prev)) prev.focus({ preventScroll: true })
      }
    },
    true,
  )
}
trackFocus()

/**
 * 正在打开的容器 `layer` 的入口链：当前焦点元素在前，它所在外层弹层的链在后。
 * 焦点已被 `layer` 内的 `autoFocus` 抢走、或入口所在的菜单等外层正在退出动画时，依次回溯最近的得焦历史；
 * 落在退出层里或菜单内容里的候选经 `reviveOpener` 复原真实入口（如菜单触发钮）。
 */
function captureOpenerChain(layer: Element | null): HTMLElement[] {
  const usable = (cand: unknown): cand is HTMLElement => returnable(cand) && !(layer && layer.contains(cand as HTMLElement))
  const el = document.activeElement
  let opener: HTMLElement | null = null
  for (const cand of [el, ...[...recent].reverse()]) {
    const inMenu: Element | null = cand instanceof Element ? cand.closest(MENU_LAYER) : null
    if (usable(cand) && !inMenu) {
      opener = cand
      break
    }
    const revived = cand instanceof HTMLElement && (dyingLayerOf(cand) || inMenu) ? reviveOpener(cand) : null
    if (usable(revived)) {
      opener = revived
      break
    }
  }
  return opener ? [opener, ...(enclosingChain(opener) ?? [])] : []
}

/**
 * 把焦点还给链上第一个仍在文档里的元素；整条链都已卸载返回 false。
 * 焦点已在另一个弹层里（子层的焦点陷阱会把归还拽回去）就不归还，改把链交给那一层，由它关闭时归还。
 */
function returnFocus(chain: HTMLElement[]): boolean {
  const target = chain.find(isConnected)
  if (!target) return false
  const a = document.activeElement
  // 焦点元素已随本层一起摘除（isConnected=false）时沿其祖先找到的仍是本层自己——视为无宿主
  const host = a?.isConnected ? enclosingChain(a) : null
  if (host) {
    if (!host.some(isConnected)) host.push(...chain)
    return true
  }
  target.focus()
  if (document.activeElement !== target) {
    // 入口此刻可能不可聚焦：宿主随输入失焦才把它显示出来（MobileTabs 在文本输入得焦期间 hidden），下一 tick 再试；
    // 仍不成就再补一拍——宿主状态提交可能晚于第一个宏任务（375 Esc 路径实测边缘时序）
    let tries = 0
    const retry = () => {
      const a = document.activeElement
      // 焦点元素已随本层摘除（isConnected=false）视同落 body——可归还
      if (target.isConnected && (!a || a === document.body || !a.isConnected)) target.focus()
      if (document.activeElement !== target && ++tries < 2) setTimeout(retry, 0)
    }
    setTimeout(retry, 0)
  }
  return true
}

/**
 * Radix Dialog/Sheet 关闭时默认把焦点还给 `Trigger`；本项目的弹层多由 store（`ui.dialog` 等）受控打开、没有 Trigger，
 * 关闭后焦点会落到 body。这里在打开时记住真正的入口元素，关闭时还给它（调用方已 preventDefault 时不干预）。
 * 入口本身在另一个弹层里（如 375 More Sheet 里的按钮打开 NavDrawer / Dialog，More 随之整体卸载）时，
 * 一并继承外层的入口链，关闭时归还给链上第一个仍在文档里的元素；整条链都已卸载才交给 Radix 默认。
 * 入口在内容节点挂上（ref）时登记而不是在 `onOpenAutoFocus` 里：内容里有挂载即 `autoFocus` 的输入时，Radix FocusScope 看到焦点已在容器内，
 * 根本不派发 open 事件；此时入口从最近的焦点历史回溯。
 */
export function useFocusReturn<T extends HTMLElement>(props: AutoFocusProps<T>): Pick<AutoFocusProps<T>, 'ref' | 'onCloseAutoFocus'> {
  const chainRef = React.useRef<HTMLElement[]>([])
  const nodeRef = React.useRef<T | null>(null)
  const { ref, onCloseAutoFocus } = props
  const attach = React.useCallback(
    (node: T | null) => {
      const cleanup = typeof ref === 'function' ? ref(node) : undefined
      if (ref && typeof ref !== 'function') ref.current = node
      if (node && node !== nodeRef.current) {
        const chain = captureOpenerChain(node)
        chainRef.current = chain
        chains.set(node, chain)
      }
      nodeRef.current = node
      return () => {
        if (typeof cleanup === 'function') cleanup()
        else if (typeof ref === 'function') ref(null)
        else if (ref) ref.current = null
      }
    },
    [ref],
  )
  // Radix FocusScope 只在「挂载时容器内无焦点元素」才派发卸载回焦事件；内容自带 autoFocus 的弹层不走它，这里兜底。
  // 卸载时焦点已随层摘除（落 body / 虚空）或进了另一个弹层（交给它归并链）才归还；焦点已在别处（用户点走）不抢。
  React.useEffect(
    () => () => {
      const a = document.activeElement
      if (a && a !== document.body && a.isConnected && !enclosingChain(a)) return
      returnFocus(chainRef.current)
    },
    [],
  )
  return {
    ref: attach,
    onCloseAutoFocus: (event) => {
      onCloseAutoFocus?.(event)
      if (event.defaultPrevented) return
      if (returnFocus(chainRef.current)) event.preventDefault()
    },
  }
}

/**
 * 非 Radix 的整屏面板（如 375 MobileSettings：条件渲染在内容区，没有 FocusScope）与弹层同一契约：
 * 挂载时登记入口链（并把面板登记为容器，面板内再开的弹层可继承），卸载时若焦点因面板消失而落到 body 就归还；
 * 焦点已在别处（用户点了别的 Tab 让面板收起）则不抢。
 */
export function useFocusReturnOnUnmount(ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const panel = ref.current
    const chain = captureOpenerChain(panel)
    if (panel) chains.set(panel, chain)
    return () => {
      const a = document.activeElement
      if (a && a !== document.body && a.isConnected) return
      returnFocus(chain)
    }
  }, [ref])
}
