import { useEffect, useMemo } from 'react'
import { useStudio } from '@/store'
import { buildOutline, toOutlineNodes, type OutlineModel } from '@/lib/outline'

/** store.ast → 大纲模型（ast 为 null 时为 EMPTY_OUTLINE，各书为 null） */
export function useOutlineModel(): OutlineModel {
  const ast = useStudio((s) => s.ast)
  return useMemo(() => buildOutline(ast), [ast])
}

/** 把大纲写入 doc.outline（状态栏「光标所在」路径等消费者） */
export function useOutlineSync(model: OutlineModel) {
  const setOutline = useStudio((s) => s.setOutline)
  useEffect(() => {
    setOutline(toOutlineNodes(model))
  }, [model, setOutline])
}
