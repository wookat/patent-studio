/** 统一格式化出口（R105 收编）：时间/字节/数量显示的单一语义来源。
 *
 *  输入单位约定：`*Sec` 后缀或 doc 注明 = Unix 秒；裸 number 参数 = Unix 毫秒（Date.now() 口径）。
 *  各函数语义均为既有实现的合并（见 R105 审计 §三）；刻意保持分离的语义：
 *  - `fmtRelative`（紧凑：今天只出 `HH:mm`，跨年只出 `MM-DD`）vs `fmtWhen`（详细：`今天 HH:mm`、`MM-DD HH:mm`）。
 *  - `fmtFull`（绝对日期时间，title/tooltip 用）vs `fmtMdTime`（紧凑 `MM/DD HH:mm`，跨年补年）。
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** 毫秒时间戳 → `HH:mm`；空/非法 ⇒ `--:--` */
export function fmtClock(ts: number | null | undefined): string {
  if (!ts) return '--:--'
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 毫秒时间戳 → 紧凑相对/绝对：`刚刚` · `N 分钟前` · `HH:mm`（当天） · `昨天 HH:mm` · `MM-DD` */
export function fmtRelative(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return ''
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ts)
  if (d.toDateString() === new Date(now).toDateString()) return fmtClock(ts)
  const y = new Date(now - 86_400_000)
  if (d.toDateString() === y.toDateString()) return `昨天 ${fmtClock(ts)}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO 串 → fmtRelative；空 ⇒ 空串，无法解析 ⇒ 原串回退 */
export function fmtRelativeIso(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  return Number.isNaN(ts) ? iso : fmtRelative(ts, now)
}

/** Unix 秒 → 详细相对/绝对：`刚刚` · `N 分钟前` · `今天 HH:mm` · `昨天 HH:mm` · `MM-DD HH:mm` */
export function fmtWhen(sec: number, now = Date.now()): string {
  const d = new Date(sec * 1000)
  const min = Math.round((now - d.getTime()) / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (new Date(now).toDateString() === d.toDateString()) return `今天 ${hhmm}`
  const y = new Date(now - 86_400_000)
  if (y.toDateString() === d.toDateString()) return `昨天 ${hhmm}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`
}

/** Unix 秒 → 绝对日期时间（locale 全量，含秒）；title/tooltip 用 */
export function fmtFull(sec: number): string {
  return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false })
}

/** Unix 秒 → 紧凑 `MM/DD HH:mm`；跨年补 `YYYY/` 前缀（消除跨年歧义） */
export function fmtMdTime(sec: number): string {
  const d = new Date(sec * 1000)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('zh-CN', {
    hour12: false,
    ...(sameYear ? {} : { year: 'numeric' }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Unix 秒 → 固定掩码 `YYYY-MM-DD HH:mm`；空 ⇒ 空串（确认/审计记录用，客户与代理师口径一致） */
export function fmtDateTime(sec: number | null | undefined): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** ISO 串 → `YYYY-MM-DD HH:mm`；空 ⇒ empty 文案，无法解析 ⇒ 原串回退 */
export function fmtDateTimeIso(iso: string | null | undefined, empty = '尚未生成'): string {
  if (!iso) return empty
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? iso : fmtDateTime(ms / 1000)
}

/** 字节数 → `—` · `N B` · `X.X KB` · `X.X MB` */
export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 毫秒时长 → `N ms`（<1000 取整）· `X.X s`；空 ⇒ `-` */
export function fmtMs(ms: number | undefined | null): string {
  if (ms == null) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`
}

/** token 计数 → ≥1 万显示 `X.X 万`，否则千分位 */
export function fmtTokens(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)} 万` : n.toLocaleString('zh-CN')
}
