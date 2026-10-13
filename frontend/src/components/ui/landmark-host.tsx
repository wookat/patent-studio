import * as React from 'react'

const NamedLandmarkHostContext = React.createContext(false)

/**
 * 宿主已经用面板标题提供了 role="region" 地标（dockview 的 group 容器按当前面板标题命名）时，
 * 面板自己的根 <section aria-label=标题> 会成为同名嵌套地标（axe landmark-unique）。
 * 宿主用 NamedLandmarkHost 包住面板，面板用 useNamedLandmarkHost() 决定是否省略根地标名。
 */
export function NamedLandmarkHost({ children }: { children: React.ReactNode }) {
  return <NamedLandmarkHostContext.Provider value>{children}</NamedLandmarkHostContext.Provider>
}

export function useNamedLandmarkHost(): boolean {
  return React.useContext(NamedLandmarkHostContext)
}
