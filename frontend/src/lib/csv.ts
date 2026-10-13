import { saveBlob } from './download'
/**
 * CSV 导出（21 §2 R-HOME-10）：BOM + UTF-8，CRLF 行尾（Excel 直接双击可开，中文不乱码）。
 * 列由调用方按「当前可见列」传入；行由调用方按「当前筛选 + 排序」传入——导出行数恒等于表格行数。
 */
export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

export const CSV_BOM = '\uFEFF'

/** 含分隔符 / 引号 / 换行的单元格加引号，内部引号双写（RFC 4180） */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(','))
  return CSV_BOM + lines.join('\r\n') + '\r\n'
}

/** 浏览器端触发下载（Blob + <a download>） */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  saveBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}

/** 文件名用的本地日期（YYYYMMDD） */
export function csvDateStamp(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
