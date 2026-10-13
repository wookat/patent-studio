import { describe, expect, it } from 'vitest'
import { fmtBytes, fmtClock, fmtDateTime, fmtDateTimeIso, fmtFull, fmtMdTime, fmtMs, fmtRelative, fmtRelativeIso, fmtTokens, fmtWhen } from '../format'

const NOW = Date.parse('2026-09-27T14:00:00+08:00')

describe('fmtClock', () => {
  it('毫秒 → HH:mm；空 ⇒ --:--', () => {
    expect(fmtClock(NOW)).toMatch(/^\d{2}:\d{2}$/)
    expect(fmtClock(null)).toBe('--:--')
    expect(fmtClock(undefined)).toBe('--:--')
    expect(fmtClock(0)).toBe('--:--')
  })
})

describe('fmtRelative（紧凑：今天裸 HH:mm，跨年 MM-DD）', () => {
  it('分档', () => {
    expect(fmtRelative(NOW - 30_000, NOW)).toBe('刚刚')
    expect(fmtRelative(NOW - 3 * 60_000, NOW)).toBe('3 分钟前')
    expect(fmtRelative(NOW - 2 * 3_600_000, NOW)).toMatch(/^\d{2}:\d{2}$/)
    expect(fmtRelative(NOW - 26 * 3_600_000, NOW)).toMatch(/^昨天 \d{2}:\d{2}$/)
    expect(fmtRelative(NOW - 30 * 86_400_000, NOW)).toMatch(/^\d{2}-\d{2}$/)
    expect(fmtRelative(null, NOW)).toBe('')
  })
})

describe('fmtRelativeIso', () => {
  it('ISO → 相对时间；空/无法解析 ⇒ 空串/原串', () => {
    expect(fmtRelativeIso(new Date(NOW - 3 * 60_000).toISOString(), NOW)).toBe('3 分钟前')
    expect(fmtRelativeIso('not-a-date', NOW)).toBe('not-a-date')
    expect(fmtRelativeIso('', NOW)).toBe('')
    expect(fmtRelativeIso(null, NOW)).toBe('')
  })
})

describe('fmtWhen（详细：今天 HH:mm、MM-DD HH:mm）', () => {
  const sec = (ms: number) => ms / 1000
  it('分档', () => {
    expect(fmtWhen(sec(NOW - 20_000), NOW)).toBe('刚刚')
    expect(fmtWhen(sec(NOW - 5 * 60_000), NOW)).toBe('5 分钟前')
    expect(fmtWhen(sec(NOW - 2 * 3_600_000), NOW)).toMatch(/^今天 \d{2}:\d{2}$/)
    expect(fmtWhen(sec(NOW - 26 * 3_600_000), NOW)).toMatch(/^昨天 \d{2}:\d{2}$/)
    expect(fmtWhen(sec(NOW - 30 * 86_400_000), NOW)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('fmtFull / fmtMdTime', () => {
  const sec = (ms: number) => ms / 1000
  it('fmtFull：locale 绝对日期时间', () => {
    expect(fmtFull(sec(NOW))).toMatch(/2026/)
  })
  it('fmtMdTime：当年紧凑、跨年补年', () => {
    expect(fmtMdTime(sec(NOW))).toMatch(/\d{2}\/\d{2} \d{2}:\d{2}/)
    expect(fmtMdTime(sec(Date.parse('2019-06-01T00:00:00Z')))).toMatch(/2019/)
  })
})

describe('fmtDateTime / fmtDateTimeIso', () => {
  it('Unix 秒 → YYYY-MM-DD HH:mm；空 ⇒ 空串', () => {
    expect(fmtDateTime(null)).toBe('')
    expect(fmtDateTime(Date.UTC(2026, 8, 6, 4, 5) / 1000)).toMatch(/^2026-09-0\d \d{2}:\d{2}$/)
  })
  it('ISO → 同上；null ⇒ empty 文案；无法解析 ⇒ 原串', () => {
    expect(fmtDateTimeIso('2026-09-06T04:05:00Z')).toMatch(/^2026-09-0\d \d{2}:\d{2}$/)
    expect(fmtDateTimeIso(null)).toBe('尚未生成')
    expect(fmtDateTimeIso('bogus')).toBe('bogus')
  })
})

describe('fmtBytes', () => {
  it('分档', () => {
    expect(fmtBytes(null)).toBe('—')
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('fmtMs', () => {
  it('ms / s 分档；null ⇒ -', () => {
    expect(fmtMs(null)).toBe('-')
    expect(fmtMs(850)).toBe('850 ms')
    expect(fmtMs(1500)).toBe('1.5 s')
  })
})

describe('fmtTokens', () => {
  it('≥1万 → X.X 万，否则千分位', () => {
    expect(fmtTokens(9999)).toBe('9,999')
    expect(fmtTokens(12_345)).toBe('1.2 万')
  })
})
