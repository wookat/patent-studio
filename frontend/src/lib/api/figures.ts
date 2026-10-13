import { ApiError, netFetch, req } from './net'
import type { FigurePatch, FigureSource, FigureSourceDoc, FiguresResponse } from '@/types/figures'

export const figuresApi = {
  getFigures: (id: string, signal?: AbortSignal) =>
    req<FiguresResponse>(`/api/projects/${encodeURIComponent(id)}/figures`, { signal }),
  uploadFigures: (id: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    return req<FiguresResponse>(`/api/projects/${encodeURIComponent(id)}/figures`, { method: 'POST', body: form })
  },
  reorderFigures: (id: string, order: string[]) =>
    req<FiguresResponse>(`/api/projects/${encodeURIComponent(id)}/figures/order`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    }),
  updateFigure: (id: string, name: string, patch: FigurePatch) =>
    req<FiguresResponse>(`/api/projects/${encodeURIComponent(id)}/figures/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  /** 整组换图：上传文件须与 {name} 同 stem（前端先改名回本组 stem 再发）；被引用也可换 */
  replaceFigureImage: (id: string, name: string, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    return req<FiguresResponse>(`/api/projects/${encodeURIComponent(id)}/figures/${encodeURIComponent(name)}/image`, { method: 'PUT', body: form })
  },
  /** 被引用 → 抛 ApiError(409)，用 isFigureReferenced(e) 取 refs */
  deleteFigure: (id: string, name: string) =>
    req<FiguresResponse>(`/api/projects/${encodeURIComponent(id)}/figures/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  figuresExportUrl: (id: string) => `/api/projects/${encodeURIComponent(id)}/figures/export.zip`,
  /** W16 绘制图源 figs-src/*.mmd */
  getFigureSources: (id: string, signal?: AbortSignal) =>
    req<{ sources: FigureSource[] }>(`/api/projects/${encodeURIComponent(id)}/figures-src`, { signal }),
  getFigureSource: (id: string, name: string, signal?: AbortSignal) =>
    req<FigureSourceDoc>(`/api/projects/${encodeURIComponent(id)}/figures-src/${encodeURIComponent(name)}`, { signal }),
  putFigureSource: (id: string, name: string, source: string) =>
    req<FigureSource>(`/api/projects/${encodeURIComponent(id)}/figures-src/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ source }),
    }),
  deleteFigureSource: (id: string, name: string) =>
    req<{ deleted: string }>(`/api/projects/${encodeURIComponent(id)}/figures-src/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** 图源文本 → 后端渲染 PNG 预览（画板 .spec/.mmd 实时预览；非 JSON 响应不走 req） */
  previewFigureSource: async (id: string, source: string): Promise<Blob> => {
    const r = await netFetch(`/api/projects/${encodeURIComponent(id)}/figures-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    })
    if (!r.ok) {
      let msg = '预览渲染失败'
      try {
        const j = (await r.json()) as { detail?: string | { message?: string } }
        const d = j?.detail
        msg = typeof d === 'string' ? d : d?.message ?? msg
      } catch { /* 非 JSON 错误体用兜底文案 */ }
      throw new ApiError(r.status, msg)
    }
    return r.blob()
  },
  /** mmd 图源文本 → figspec JSON（画板「转 .spec 画布」） */
  mmdToSpec: (id: string, source: string) =>
    req<{ spec: string }>(`/api/projects/${encodeURIComponent(id)}/figures-mmd-to-spec`, {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),
  /** figs/<name> 原图字节（位图标注模式挂画布底图；非 JSON 不走 req） */
  getFigureImage: async (id: string, name: string): Promise<Blob> => {
    const r = await netFetch(`/api/projects/${encodeURIComponent(id)}/figs/${encodeURIComponent(name)}`)
    if (!r.ok) throw new ApiError(r.status, `图 ${name} 读取失败`)
    return r.blob()
  },
  /** W4-C attachments/（15 §3.2；prep 阶段后端 501 not_implemented detail=C2-figures-attachments-api） */
}
