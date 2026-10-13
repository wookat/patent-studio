import { useEffect, useState } from 'react'

const isTextInput = (el: Element | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

/** 文本输入（input / textarea / contenteditable，含 CodeMirror）获得焦点期间为 true：软键盘弹出时让出底部 Tab，由快捷键盘接管 */
export function useTextInputFocused(): boolean {
  const [focused, setFocused] = useState(() => isTextInput(document.activeElement))
  useEffect(() => {
    const update = () => setFocused(isTextInput(document.activeElement))
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])
  return focused
}
