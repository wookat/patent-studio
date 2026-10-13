import type { ReactNode } from 'react'
import type { Node as PmNode } from 'prosemirror-model'
import type { Plugin } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import type { AstClaim, AstParagraph, BookName, DescriptionBlock } from '@/types/ast'

/**
 * R3 结构视图挂载点（docs/plan/06-r3-structure-edit-design.md §7）。
 * StructureView.tsx（共享，只允许 prep/integrate 改）从固定模块路径引入三个单元的入口组件：
 *   block-model/edit/index.tsx     → BlockEditor        （B2-pm-editor）
 *   block-model/toolbar/index.tsx  → StructureToolbar / InsertHandle（B3-insert-toolbar）
 *   block-model/dialogs/index.tsx  → StructureDialogs   （B3-insert-toolbar）
 * 单元只改自己目录里的实现，props 契约冻结在这里。
 */

/** 可进入块编辑的 AST 块（title / 摘要整块 / figures 不可编辑：题名与图号是内核生成物或另有归属） */
export type EditableBlock = AstParagraph | AstClaim | DescriptionBlock

export interface BlockEditorProps {
  block: EditableBlock
  book: BookName
  /** 该块当前源码行（`\n` 分隔，来自 content 按 AST lines 切片；与后端 serialize_block 逐字节一致） */
  markdown: string
  /** 提交：整块 Markdown 行（不含块间空行）→ store.patchBlock；返回是否成功 */
  onSubmit(markdown: string): Promise<boolean>
  /** Esc / 取消按钮：丢弃改动回只读 */
  onCancel(): void
  /** 请求在途：禁用再次提交 */
  pending: boolean
  /**
   * W4-D 版面视图：换用扩展 schema（prosemirror-tables 角色）的 doc 构建 / 序列化，并追加插件（表格键位 + tableEditing）。
   * 缺省 = 结构视图基础 schema（edit/serialize.ts 的 toDoc / serialize）。
   */
  engine?: { toDoc(block: EditableBlock): PmNode; serialize(doc: PmNode): string; plugins(): Plugin[] }
  /** ProseMirror 视图挂载 / 销毁时回调（版面视图据此挂表格工具条） */
  onView?(view: EditorView | null): void
  /** 渲染在编辑器根内、标题行与正文之间的工具条（点击不算失焦，不触发提交） */
  toolbar?: ReactNode
}

/**
 * B3 在 dialogs/index.tsx 额外导出 `useFormulaDialog(): { open(initial: string, onSubmit: (source: string) => void): void }`；
 * B2 的公式节点双击只 import 该 hook（06 §7），不自建对话框。
 */
export interface StructureToolbarProps {
  editable: boolean
  /** 当前选中块（插入 / 删除 / 公式 / 表格 操作对象） */
  activeBlockId: string | null
}
