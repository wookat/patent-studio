/** 摘要字数 ≥ 上限×此比例（默认 300 → 285）视为「接近上限」：状态栏/编辑器头部转警告色，控制台出 warning（仅前端；后端 lint 只在越界时报错） */
export const ABSTRACT_NEAR_RATIO = 0.95

export function abstractNearThreshold(limit: number): number {
  return Math.ceil(limit * ABSTRACT_NEAR_RATIO)
}
