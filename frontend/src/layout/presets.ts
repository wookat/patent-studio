import type { Orientation, SerializedDockview } from 'dockview-react'
import { LAYOUT_PRESET_IDS, parsePanelId, type LayoutPresetId, type PanelId } from '@/store/layout'

/**
 * 预置布局（docs/plan/08-r4-dockview-design.md §7.1；「AI 辅助」为波次 3 集成新增）：dockview `fromJSON` 直接可用的序列化布局。
 * 尺寸按 1000×700 给比例，dockview 装入时按容器实际尺寸等比重排；panels 的 title 由 D1 装入前用注册表重算（这里只是回退值）。
 * 只用 `grid + panels + activeGroup`；不含浮动 / 弹出组（用户自己拖出来的浮动组由持久化保存，不进预置）。
 */

export interface LayoutPreset {
  id: LayoutPresetId
  label: string
  /** 菜单里的一句说明 */
  hint: string
  /** 应用后是否开对照滚动锁 */
  compareLock: boolean
  layout: SerializedDockview
}

type Leaf = { id: string; views: PanelId[]; activeView?: PanelId; size: number }

function panel(id: PanelId): SerializedDockview['panels'][string] {
  const p = parsePanelId(id)
  if (!p) throw new Error(`bad panel id ${id}`)
  return { id, contentComponent: p.kind, params: { book: p.book }, title: id }
}

/** 一行多列（HORIZONTAL）；每个 leaf 可以是 tab 组（多 views） */
function columns(leaves: Leaf[], activeGroup: string): SerializedDockview {
  const panels: SerializedDockview['panels'] = {}
  for (const l of leaves) for (const v of l.views) panels[v] = panel(v)
  return {
    grid: {
      root: {
        type: 'branch',
        size: 700,
        data: leaves.map((l) => ({
          type: 'leaf',
          size: l.size,
          data: { id: l.id, views: l.views, activeView: l.activeView ?? l.views[0] },
        })),
      },
      width: 1000,
      height: 700,
      orientation: 'HORIZONTAL' as Orientation.HORIZONTAL,
    },
    panels,
    activeGroup,
  }
}

export const LAYOUT_PRESETS: Record<LayoutPresetId, LayoutPreset> = {
  default: {
    id: 'default',
    label: '源码 | PDF',
    hint: '左侧三书 tab（摘要 / 权利要求书 / 说明书），右侧真实 PDF；与旧双栏等价',
    compareLock: false,
    layout: columns(
      [
        { id: 'g-source', views: ['source:abstract', 'source:claims', 'source:description'], activeView: 'source:description', size: 500 },
        { id: 'g-pdf', views: ['pdf'], size: 500 },
      ],
      'g-source',
    ),
  },
  'three-books': {
    id: 'three-books',
    label: '三书对照',
    hint: '摘要 | 权利要求书 | 说明书 三列源码并排',
    compareLock: false,
    layout: columns(
      [
        { id: 'g-abstract', views: ['source:abstract'], size: 200 },
        { id: 'g-claims', views: ['source:claims'], size: 400 },
        { id: 'g-description', views: ['source:description'], size: 400 },
      ],
      'g-claims',
    ),
  },
  'claims-description': {
    id: 'claims-description',
    label: '权利要求书 ↔ 说明书',
    hint: '两列源码 + 对照滚动锁（权项 ↔ 支持段落按块对齐），右侧 PDF',
    compareLock: true,
    layout: columns(
      [
        { id: 'g-claims', views: ['source:claims'], size: 350 },
        { id: 'g-description', views: ['source:description'], size: 350 },
        { id: 'g-pdf', views: ['pdf'], size: 300 },
      ],
      'g-claims',
    ),
  },
  'layout-pdf': {
    id: 'layout-pdf',
    label: '版面 | PDF',
    hint: '全文版面视图（Word 对齐、块级编辑）与 PDF 并排',
    compareLock: false,
    layout: columns(
      [
        { id: 'g-layout', views: ['layout:all'], size: 500 },
        { id: 'g-pdf', views: ['pdf'], size: 500 },
      ],
      'g-layout',
    ),
  },
  review: {
    id: 'review',
    label: '审阅',
    hint: '全文源码（修订标记）| PDF；批注 / 修订在顶栏伴随栏「审阅」',
    compareLock: false,
    layout: columns(
      [
        { id: 'g-source', views: ['source:all'], size: 560 },
        { id: 'g-pdf', views: ['pdf'], size: 440 },
      ],
      'g-source',
    ),
  },
  'ai-assist': {
    id: 'ai-assist',
    label: 'AI 辅助',
    hint: '三书源码 tab | 真实 PDF | 右侧 320：术语 / OA 答复 tab 组（AI 助手与审阅在顶栏伴随栏）',
    compareLock: false,
    layout: columns(
      [
        { id: 'g-source', views: ['source:abstract', 'source:claims', 'source:description'], activeView: 'source:description', size: 460 },
        { id: 'g-pdf', views: ['pdf'], size: 380 },
        { id: 'g-ai', views: ['terms', 'oa'], size: 320 },
      ],
      'g-source',
    ),
  },
}

/**
 * 默认预置（W5 21 §5.5 U1 / W6 05 §2.9）：ai-assist —— 源码 | PDF | 右侧 320 术语组；AI 助手不再是 dock 面板，由顶栏伴随栏（CompanionHost 'ai'）承载。
 * 含 `pdf` 卡，旧 ui.layout='preview' 最大化 PDF 仍成立；`resetLayout` 与「基于 X」菜单勾选同用本常量。
 */
export const DEFAULT_PRESET: LayoutPresetId = 'ai-assist'

export function listPresets(): LayoutPreset[] {
  return LAYOUT_PRESET_IDS.map((id) => LAYOUT_PRESETS[id])
}

/** 预置里出现的全部面板 id（注册表完整性测试用） */
export function presetPanelIds(p: LayoutPreset): PanelId[] {
  return Object.keys(p.layout.panels)
}
