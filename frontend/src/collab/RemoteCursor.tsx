import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { CURSOR_LABEL_TEXT, type PeerColor } from './colors'

/**
 * 远端光标标签（docs/plan/11 §6.2；G2 所有）。y-codemirror.next 自己画 `.cm-ySelectionCaret` / `.cm-ySelectionInfo`，
 * 这里只覆写主题：标签常显 1.2 s 后淡出、hover 再现（Google Docs 做法；Overleaf 常显名字条），字体跟编辑器而非 serif。
 * prep：基础主题已可用；G2 视需要补 `.cm-ySelection` 选区底色透明度、深色主题变体。
 */
export function remoteCursorTheme(): Extension {
  return EditorView.baseTheme({
    /* y-codemirror.next 把 user.color 写在 style 里（caret border/背景、选区 colorLight）；这里只管形状与时序 */
    '.cm-ySelection': { mixBlendMode: 'multiply' },
    '&dark .cm-ySelection': { mixBlendMode: 'screen' },
    '.cm-ySelectionCaret': { borderLeftWidth: '2px', borderRightWidth: '0', marginLeft: '-1px', marginRight: '0' },
    '.cm-ySelectionCaretDot': { display: 'none' },
    '.cm-ySelectionCaret > .cm-ySelectionInfo': { color: CURSOR_LABEL_TEXT },
    '.cm-ySelectionInfo': {
      fontFamily: 'inherit',
      fontSize: '11px',
      lineHeight: '14px',
      fontWeight: 500,
      borderRadius: '3px 3px 3px 0',
      padding: '0 4px',
      top: '-15px',
      left: '-2px',
      whiteSpace: 'nowrap',
      maxWidth: '12em',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      opacity: 1,
      transitionDelay: '1.2s',
      transitionDuration: '.25s',
      zIndex: 1,
    },
    '.cm-ySelectionCaret:hover > .cm-ySelectionInfo': { opacity: 1, transitionDelay: '0s' },
    /* 375：标签只在 hover/触摸后短暂出现，避免遮住正在编辑的行 */
    '@media (max-width: 767px)': {
      '.cm-ySelectionInfo': { maxWidth: '6em' },
    },
    '@media (prefers-reduced-motion: reduce)': {
      '.cm-ySelectionInfo': { transition: 'none' },
    },
  })
}

/** 在线头像悬浮 / 协作者中心在线列表里用的静态标签（同一配色规则），也是 axe 冒烟的挂载对象 */
export function RemoteCursorLabel({ name, color }: { name: string; color: PeerColor }) {
  return (
    <span
      className="inline-flex h-3.5 items-center rounded-[3px] rounded-bl-none px-1 text-2xs leading-none"
      style={{ backgroundColor: color, color: CURSOR_LABEL_TEXT }}
      data-slot="RemoteCursorLabel"
    >
      {name}
    </span>
  )
}
