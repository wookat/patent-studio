import * as React from 'react'
import { ResponsiveContainer } from 'recharts'

/** Chart 的 Recharts 实现（仅 chart.tsx 通过 React.lazy 引入；不要直接 import） */
export default function ChartImpl({ children, height }: { children: React.ReactElement; height: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  )
}
