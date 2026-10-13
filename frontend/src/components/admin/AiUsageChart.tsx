import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Chart, CHART_COLORS } from '@/components/ui/chart'
import { fmtTokens } from '@/lib/format'
import type { AiUsageSummary } from '@/types/org'
/** 今日按案卷 token 用量（仅经 AiPanel 的 React.lazy 引入；不要直接 import） */
export default function AiUsageChart({ usage, height = 200 }: { usage: AiUsageSummary; height?: number }) {
  const data = usage.by_project.slice(0, 8).map((p) => ({ name: p.title || p.pid, tokens: p.today_tokens }))
  return (
    <Chart label="今日各案卷 AI 用量（token）" height={height} data-testid="ai-usage-chart">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tickFormatter={(v: string) => (v.length > 8 ? `${v.slice(0, 8)}…` : v)} />
        <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
        <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--popover-foreground)' }} formatter={(v) => [`${fmtTokens(Number(v ?? 0))} token`, '今日']} />
        <Bar dataKey="tokens" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={40} />
      </BarChart>
    </Chart>
  )
}
