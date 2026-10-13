import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

export const MATHML_DEBOUNCE_MS = 300

export type Preview =
  | { status: 'idle' | 'loading' | 'ok'; mathml: string | null }
  | { status: 'error'; mathml: null; message: string }

const IDLE: Preview = { status: 'idle', mathml: null }

/** POST /api/mathml 实时预览：300 ms 防抖 + AbortController 丢弃过期请求；失败显示后端 message（与 FormulaDialog 同策略） */
export function useMathmlPreview(source: string, enabled: boolean): Preview {
  const [preview, setPreview] = useState<Preview>(IDLE)
  const trimmed = source.trim()
  useEffect(() => {
    if (!enabled || !trimmed) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setPreview((p) => ({ status: 'loading', mathml: p.mathml }))
      api
        .mathml(trimmed, ctl.signal)
        .then((r) => {
          if (!ctl.signal.aborted) setPreview({ status: 'ok', mathml: r.mathml })
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted) return
          setPreview({ status: 'error', mathml: null, message: e instanceof Error ? e.message : String(e) })
        })
    }, MATHML_DEBOUNCE_MS)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [enabled, trimmed])
  return trimmed ? preview : IDLE
}
