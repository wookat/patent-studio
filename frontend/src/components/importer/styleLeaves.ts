import type { StyleOverride } from '@/lib/types'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface StyleLeaf {
  /** 点路径，如 fonts.body_cjk */
  key: string
  path: string[]
  value: unknown
}

/** StyleOverride → 叶子列表（key = 点路径） */
export function flattenStyle(o: StyleOverride | undefined, prefix: string[] = []): StyleLeaf[] {
  if (!isObj(o)) return []
  return Object.entries(o).flatMap(([k, v]) => {
    const path = [...prefix, k]
    return isObj(v) ? flattenStyle(v as StyleOverride, path) : [{ key: path.join('.'), path, value: v }]
  })
}

/** 只保留勾选叶子的 StyleOverride */
export function pickStyle(o: StyleOverride, keys: Set<string>): StyleOverride {
  const out: Obj = {}
  for (const leaf of flattenStyle(o)) {
    if (!keys.has(leaf.key)) continue
    let cur = out
    leaf.path.slice(0, -1).forEach((p) => {
      if (!isObj(cur[p])) cur[p] = {}
      cur = cur[p] as Obj
    })
    cur[leaf.path[leaf.path.length - 1]] = leaf.value
  }
  return out as StyleOverride
}
