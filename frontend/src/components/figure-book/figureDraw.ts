/**
 * W17 画板管线：mermaid 图源 → Excalidraw 画布元素桥 + CNIPA 直线稿后处理 + 画布 → PNG 导出。
 * 图源 .mmd 是唯一真相（智能体写/人改源码）；画布是派生视图——人在画板上的拖拽调整只进导出 PNG，不回写图源。
 */

export const DRAW_TEMPLATE = `flowchart TB
  S101["接收请求 101"]
  S102["解析参数 102"]
  S103["生成响应 103"]
  S101 --> S102 --> S103
`

export const DRAW_STEM_RE = /^[A-Za-z0-9_-]{1,64}$/

/** .spec 图源模板——figspec 分层框图 JSON（bands 层堆叠 / edges 连线），与后端 figspec 渲染器同构 */
export const SPEC_TEMPLATE = `{
  "bands": [
    { "title": "输入层", "blocks": [{ "id": "A", "label": "输入模块 101" }] },
    { "title": "处理层", "blocks": [{ "id": "B", "label": "处理模块 102" }] },
    { "title": "输出层", "blocks": [{ "id": "C", "label": "输出模块 103" }] }
  ],
  "edges": [
    { "from": "A", "to": "B" },
    { "from": "B", "to": "C" }
  ]
}
`
/** 300dpi≈3.2x（CSS 96dpi→300dpi）；缩 2/3 仍清晰要求再抬一档 */
export const DRAW_EXPORT_SCALE = 4
/** 导出 PNG 单边像素上限——Safari 画布面积上限 ~16Mpx、Chrome 边长 32767；
 *  真实图源场景经 mermaid 布局动辄数千 CSS px，固定 4× 会超上限令 exportToBlob 返 null */
export const DRAW_EXPORT_MAX_SIDE = 8192

export type ExcalidrawApi = import('@excalidraw/excalidraw/types').ExcalidrawImperativeAPI
export type SceneElements = ReturnType<ExcalidrawApi['getSceneElements']>
export type SceneFiles = ReturnType<ExcalidrawApi['getFiles']>

export interface ParsedScene {
  elements: SceneElements
  files?: SceneFiles
}

/** 位图（上传图/论文提取图）→ 画布场景：原图作底，上面任意加框/箭头/文字并拖动排版，
 *  导出整景 PNG 覆盖原图（replace_figure_image 保留题注/标号）。「画板改图」入口用。 */
export async function imageBlobToScene(blob: Blob): Promise<ParsedScene> {
  const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw')
  /* arrayBuffer+btoa 手拼 dataURL——FileReader.readAsDataURL 对非本域 Blob
     （如 undici Response.blob()）可能静默不回调，全环境此法最稳 */
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  const dataURL = `data:${blob.type || 'image/png'};base64,${btoa(bin)}` as import('@excalidraw/excalidraw/types').DataURL
  const { width, height } = await probeImage(dataURL)
  const scale = Math.min(1, 1400 / Math.max(width, height, 1))
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const rid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `f${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const fileId = rid as unknown as import('@excalidraw/excalidraw/types').BinaryFileData['id']
  const elements = convertToExcalidrawElements(
    [{ type: 'image', x: 0, y: 0, width: w, height: h, fileId }],
    { regenerateIds: false },
  )
  const files = {
    [fileId]: { id: fileId, mimeType: blob.type || 'image/png', dataURL, created: Date.now() },
  } as unknown as SceneFiles
  return { elements, files }
}

/** dataURL → 自然尺寸；jsdom/解码失败回落 1200×800（限时 1.2s 防悬挂） */
function probeImage(dataURL: string): Promise<{ width: number; height: number }> {
  return new Promise((res) => {
    const img = new Image()
    const t = window.setTimeout(() => res({ width: 1200, height: 800 }), 1200)
    img.onload = () => {
      window.clearTimeout(t)
      res({ width: img.naturalWidth || 1200, height: img.naturalHeight || 800 })
    }
    img.onerror = () => {
      window.clearTimeout(t)
      res({ width: 1200, height: 800 })
    }
    img.src = dataURL
  })
}

/**
 * 图源源码 → 画布元素。后处理两条即 CNIPA 线稿口径：
 *   roughness → 0   直线直边（Excalidraw 默认手绘抖动，专利附图不可）
 *   fontFamily → Helvetica（2） 无衬线；默认 Virgil/Excalifont 是手写体
 */
export async function parseSourceToScene(code: string): Promise<ParsedScene> {
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements, FONT_FAMILY }] = await Promise.all([
    import('@excalidraw/mermaid-to-excalidraw'),
    import('@excalidraw/excalidraw'),
  ])
  const { elements: skeleton, files } = await parseMermaidToExcalidraw(code, { themeVariables: { fontSize: '16px' } })
  const elements = convertToExcalidrawElements(skeleton).map((e) => ({
    ...e,
    roughness: 0,
    ...(e.type === 'text' ? { fontFamily: FONT_FAMILY.Helvetica } : null),
  }))
  return { elements, files }
}

/** 画布 → PNG：白底黑线、DRAW_EXPORT_SCALE 放大（与原 SVG 管线同口径），
 *  大场景按 DRAW_EXPORT_MAX_SIDE 自动降档（否则超浏览器 canvas 上限 exportToBlob 返 null），空画布直接拒 */
export async function sceneToPng(api: ExcalidrawApi, scale = DRAW_EXPORT_SCALE): Promise<Blob> {
  const { exportToBlob } = await import('@excalidraw/excalidraw')
  const elements = api.getSceneElements()
  if (!elements.length) throw new Error('画布为空——先绘图或贴入图源')
  const blob = await exportToBlob({
    elements,
    appState: { exportBackground: true, viewBackgroundColor: '#ffffff', theme: 'light', exportWithDarkMode: false },
    files: api.getFiles(),
    mimeType: 'image/png',
    exportPadding: 12,
    getDimensions: (w: number, h: number) => {
      const s = Math.min(scale, DRAW_EXPORT_MAX_SIDE / Math.max(w, h, 1))
      return { width: Math.round(w * s), height: Math.round(h * s), scale: s }
    },
  })
  if (!blob) throw new Error('导出失败：画布过大或浏览器 canvas 受限，请缩小画布内容后重试')
  return blob
}

/* ---------- 位图「区域移动」：框选一块原图抠成可拖元素，原位留白补丁 ---------- */

export interface SceneRect {
  x: number
  y: number
  width: number
  height: number
}

interface SceneEl {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  isDeleted?: boolean
  fileId?: string | null
  /** Excalidraw 0.18 裁切元素：crop 为自然像素坐标下的显示窗口 */
  crop?: { x: number; y: number; width: number; height: number } | null
}

/** 两矩形相交区（场景坐标），无有效交集（边长 >1）返回 null */
export function regionOverlap(a: SceneRect, b: SceneRect): SceneRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x
  const height = Math.min(a.y + a.height, b.y + b.height) - y
  return width > 1 && height > 1 ? { x, y, width, height } : null
}

/** 画布元素中命中最上层位图（数组序即层序，后画在上） */
export function pickImageElement(elements: readonly SceneEl[], rect: SceneRect): SceneEl | null {
  let hit: SceneEl | null = null
  for (const e of elements) {
    if (e.type === 'image' && !e.isDeleted && e.fileId && regionOverlap(e, rect)) hit = e
  }
  return hit
}

/** 相交区映射到源图自然像素（含 excalidraw crop 窗口换算） */
export function regionToPixels(el: SceneEl, ov: SceneRect, naturalW: number, naturalH: number) {
  const baseW = el.crop ? el.crop.width : naturalW
  const baseH = el.crop ? el.crop.height : naturalH
  const offX = el.crop ? el.crop.x : 0
  const offY = el.crop ? el.crop.y : 0
  return {
    sx: offX + ((ov.x - el.x) / el.width) * baseW,
    sy: offY + ((ov.y - el.y) / el.height) * baseH,
    sw: (ov.width / el.width) * baseW,
    sh: (ov.height / el.height) * baseH,
  }
}

function loadImg(dataURL: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image()
    const t = window.setTimeout(() => res(null), 1500)
    img.onload = () => {
      window.clearTimeout(t)
      res(img)
    }
    img.onerror = () => {
      window.clearTimeout(t)
      res(null)
    }
    img.src = dataURL
  })
}

const newFileId = () =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `f${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`) as unknown as import('@excalidraw/excalidraw/types').BinaryFileData['id']

/**
 * 框选区域从底图抠出：裁成新的可拖 image 元素（自动选中）+ 原位铺白色补丁（CNIPA 附图恒白底）。
 * 命中不到位图 / 区域太小 / 解码裁切失败返回 false。
 */
export async function cutImageRegion(api: ExcalidrawApi, rect: SceneRect): Promise<boolean> {
  const elements = api.getSceneElements() as unknown as SceneEl[]
  const hit = pickImageElement(elements, rect)
  if (!hit || !hit.fileId) return false
  const file = api.getFiles()[hit.fileId as never]
  const dataURL = file?.dataURL as string | undefined
  if (!dataURL) return false
  const img = await loadImg(dataURL)
  if (!img || !img.naturalWidth) return false
  const ov = regionOverlap(hit, rect)
  if (!ov) return false
  const px = regionToPixels(hit, ov, img.naturalWidth, img.naturalHeight)
  if (px.sw < 2 || px.sh < 2) return false
  const cvs = document.createElement('canvas')
  cvs.width = Math.max(1, Math.round(px.sw))
  cvs.height = Math.max(1, Math.round(px.sh))
  const ctx = cvs.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(img, px.sx, px.sy, px.sw, px.sh, 0, 0, px.sw, px.sh)
  const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw')
  const fileId = newFileId()
  const [patch, imgEl] = convertToExcalidrawElements(
    [
      {
        type: 'rectangle',
        x: ov.x,
        y: ov.y,
        width: ov.width,
        height: ov.height,
        backgroundColor: '#ffffff',
        fillStyle: 'solid',
        strokeColor: 'transparent',
        strokeWidth: 0,
        roughness: 0,
      },
      { type: 'image', x: ov.x, y: ov.y, width: ov.width, height: ov.height, fileId },
    ],
    { regenerateIds: true },
  ) as unknown as SceneEl[]
  api.addFiles([
    { id: fileId, mimeType: 'image/png', dataURL: cvs.toDataURL('image/png'), created: Date.now() },
  ] as never)
  api.updateScene({
    elements: [...(api.getSceneElements() as unknown as SceneEl[]), patch, imgEl] as never,
    appState: { selectedElementIds: { [imgEl.id]: true } } as never,
  })
  return true
}
