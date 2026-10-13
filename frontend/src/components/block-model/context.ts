import { createContext } from 'react'

export interface BlockActions {
  /** 单击：高亮 + 光标同步（结构视图保持可见） */
  select(id: string): void
  /** Enter / 双击：切回源码并跳到块起始行 */
  open(id: string): void
  /** 点击从属权项引用：定位目标权项块 */
  gotoClaim(num: number): void
  /** 权项引用是否渲染为按钮（默认 true）；窄屏只读纸面缩放后行内引用远小于 44px 热区，置 false 退化为纯文本 */
  refsInteractive?: boolean
}

export const BlockActionsContext = createContext<BlockActions>({ select: () => {}, open: () => {}, gotoClaim: () => {} })
