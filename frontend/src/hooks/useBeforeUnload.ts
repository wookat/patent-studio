import { useEffect, useRef } from 'react'

/**
 * 表单草稿关页签守卫：active() 为真期间关闭/刷新页签走浏览器原生确认。
 * 编辑器正文 dirty 由 StoreBootstrap 全局闸（selectDirty），弹窗草稿脏态属各对话框自治——
 * 两者合并即「任何输入中的内容都有关页签拦截」。
 * 取值走 ref：挂载即注册监听，active 读最新闭包（dirtyRef 类非响应式脏态同样适用）。
 */
export function useBeforeUnload(active: () => boolean): void {
  const ref = useRef(active)
  useEffect(() => {
    ref.current = active
  })
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (ref.current()) e.preventDefault()
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])
}
