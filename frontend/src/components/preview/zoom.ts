/** 预览缩放常量；缩放模式/页码跳转/滚动位置等状态在 ui slice（zoomFit / pageRequest / previewScroll） */
export type { ZoomFit } from '@/store'

/** A4 纸宽 210 mm 在 96 dpi 下的 CSS 像素，100% 缩放 = 实际尺寸 */
export const A4_WIDTH_PX = 794
export const A4_RATIO = 297 / 210

export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.1

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))

