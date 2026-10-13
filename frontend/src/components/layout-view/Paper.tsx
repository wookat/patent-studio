import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { HeadingNumbering } from '@/store/styleEdit'
import { PART_HEADER_LABEL, type PaperPart } from './slots'

/** 章节（###）/ 小节（####）编号：style-panel.css 按 data-h3-numbering / data-h4-numbering 用 CSS 计数器画 ::before */
export interface PaperNumbering {
  h3: HeadingNumbering
  h4: HeadingNumbering
}

/**
 * 一张 A4 纸面（16 §4.1）：`.ps-paper` 尺寸 / 边距全部来自 --ps-* 变量（D1 style.css；缺省 = layout-view.css 的 A4 回退），
 * 页眉书名字样绝对定位在 --ps-header-distance。role=document 让读屏把整张纸当文档区域。
 */
export function Paper({ part, label, numbering, children, className }: { part: PaperPart; label?: string; numbering?: PaperNumbering; children?: ReactNode; className?: string }) {
  const text = label ?? PART_HEADER_LABEL[part]
  return (
    <section
      role="document"
      aria-label={text}
      data-testid={`ps-paper-${part}`}
      data-part={part}
      data-h3-numbering={numbering?.h3}
      data-h4-numbering={numbering?.h4}
      data-h3-numbering-base={numbering?.h3}
      data-h4-numbering-base={numbering?.h4}
      className={cn('ps-paper', `ps-paper-${part}`, className)}
    >
      <header className="ps-header" aria-hidden="true">
        {text}
      </header>
      {children}
    </section>
  )
}
