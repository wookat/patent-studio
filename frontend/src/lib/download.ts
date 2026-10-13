import { ApiError, netFetch, type ErrorDetail } from './api'

/** 从 Content-Disposition 取文件名：优先 RFC 5987 `filename*=UTF-8''…`，其次 `filename="…"` */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/.exec(header)
  return plain?.[1]?.trim() || null
}

/** URL 末段作为兜底文件名（去 query） */
export function filenameFromUrl(url: string): string {
  const path = url.split('?')[0] ?? url
  const last = path.split('/').filter(Boolean).pop() ?? 'download'
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

const isErrorDetail = (d: unknown): d is ErrorDetail => typeof d === 'object' && d !== null && typeof (d as ErrorDetail).message === 'string'

/** 把后端错误响应转成 ApiError（与 api.ts handle 同口径；message 用户可读） */
async function toApiError(r: Response): Promise<ApiError> {
  let msg = r.statusText || `HTTP ${r.status}`
  let detail: ErrorDetail | null = null
  try {
    const j = (await r.json()) as { detail?: unknown }
    if (typeof j.detail === 'string') msg = j.detail
    else if (isErrorDetail(j.detail)) {
      detail = j.detail
      msg = detail.message
    }
  } catch {
    /* 非 JSON 错误体 */
  }
  return new ApiError(r.status, msg, detail)
}

export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 给浏览器一拍完成读取再释放
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/**
 * 同源产物下载：fetch → blob → `<a download>`，永不导航当前页面，因此不会触发 beforeunload「离开站点」，
 * 后端返回错误 JSON 时抛 ApiError（调用方 toast），而不是把 raw JSON 顶掉应用。
 */
export async function downloadFile(url: string, fallbackName?: string): Promise<string> {
  // 走 netFetch：断网 / DNS 失败与 API 调用同口径 toast（导出正是用户最在意反馈的动作）
  const r = await netFetch(url, { credentials: 'same-origin' })
  if (!r.ok) throw await toApiError(r)
  const blob = await r.blob()
  const name = filenameFromDisposition(r.headers.get('Content-Disposition')) ?? fallbackName ?? filenameFromUrl(url)
  saveBlob(blob, name)
  return name
}

/** 剪贴板写入：权限被拒返回 false（调用方 toast 各自文案）。
    批77：非安全上下文（http://IP:端口 直连 VPS 的常见部署形态）clipboard API 整个缺席——
    execCommand('copy') 旧路径兜底，否则所有「复制」钮只剩 toast 死端 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* fall through —— API 缺席或被拒都走旧路径再试一次 */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    /* readonly + 屏外定位：iOS Safari 需要真实 selection，且不弹键盘 */
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
