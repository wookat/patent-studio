import * as React from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

/**
 * Chart 容器（Recharts lazy；仅台账 / 期限 / 用量三处使用）：
 * - `series` 语义色 `--chart-1..5`（index.css），子图用 `stroke="var(--chart-1)"` / `fill="var(--chart-2)"`，禁止写 hex
 * - `CHART_COLORS[i]` 给 Recharts 系列取色；ChartLegend/Tooltip 请用 Recharts 内建 + className 覆盖
 * - children 须是单个 Recharts 图（BarChart/LineChart/PieChart…），由 ResponsiveContainer 包裹
 */
export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'] as const

const ChartImpl = React.lazy(() => import('./chart-recharts'))

export interface ChartProps extends React.ComponentProps<'div'> {
  /** 像素高度（默认 200） */
  height?: number
  /** 图表标题（aria-label） */
  label: string
  children: React.ReactElement
}

function Chart({ className, height = 200, label, children, ...props }: ChartProps) {
  return (
    <div data-slot="chart" role="img" aria-label={label} className={cn('w-full text-xs [&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-text]:fill-muted-foreground', className)} style={{ height }} {...props}>
      <React.Suspense fallback={<Skeleton className="size-full" />}>
        <ChartImpl height={height}>{children}</ChartImpl>
      </React.Suspense>
    </div>
  )
}

export { Chart }
