import * as React from 'react'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

const HeadingLevelContext = React.createContext<HeadingLevel>(2)

/**
 * 标题层级由宿主决定：壳只提供 sr-only h1，可复用面板（形式检查 / OA 答复卡…）在 dock、伴随栏、移动全屏等宿主中被复用，
 * 自己写死 h3 会在没有 h2 的宿主里出现 h1→h3 跳级（axe heading-order）。
 * 宿主用 HeadingLevelProvider 声明正文起始层级（默认 2；伴随栏头已是 h2 → 正文从 3 起），面板用 <Heading /> 取层级渲染。
 */
export function HeadingLevelProvider({ level, children }: { level: HeadingLevel; children: React.ReactNode }) {
  return <HeadingLevelContext.Provider value={level}>{children}</HeadingLevelContext.Provider>
}

export function useHeadingLevel(offset = 0): HeadingLevel {
  const base = React.useContext(HeadingLevelContext)
  return Math.min(6, Math.max(1, base + offset)) as HeadingLevel
}

export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** 相对宿主起始层级的偏移：0 = 面板标题，1 = 面板内小节 */
  offset?: 0 | 1 | 2
}

export function Heading({ offset = 0, ...props }: HeadingProps) {
  const level = useHeadingLevel(offset)
  const Tag = `h${level}` as const
  return <Tag {...props} />
}
