/**
 * .spec 图源结构化表单——figspec JSON 的人类微调视图：
 * 层（bands）/块（blocks）/连线（edges）列表化编辑，改一处即重写 JSON 真源。
 * 源码窗保留：表单只负责「不方便手写」的结构操作，复杂排布仍可回源码改。
 */
import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface SpecBlock { id: string; label: string; shape?: string; weight?: number }
interface SpecBand { title?: string; blocks: SpecBlock[] }
interface SpecEdge { from: string; to: string; label?: string; dashed?: boolean }
interface SpecDoc { bands: SpecBand[]; edges: SpecEdge[] }

function parse(code: string): SpecDoc | null {
  try {
    const d = JSON.parse(code) as SpecDoc
    if (!d || !Array.isArray(d.bands)) return null
    return { bands: d.bands, edges: Array.isArray(d.edges) ? d.edges : [] }
  } catch {
    return null
  }
}

const emit = (d: SpecDoc) => JSON.stringify(d, null, 2)

export interface SpecFormProps {
  code: string
  readOnly?: boolean
  onChange: (json: string) => void
}

export function SpecForm({ code, readOnly, onChange }: SpecFormProps) {
  const spec = useMemo(() => parse(code), [code])

  if (!spec) {
    return (
      <p className="p-3 text-xs text-danger-fg" data-testid="spec-form-invalid">
        JSON 无法解析——请切到「源码」窗修正语法后再用表单
      </p>
    )
  }

  const allIds = spec.bands.flatMap((b) => b.blocks.map((x) => x.id))
  const nextId = () => {
    for (let i = 1; ; i++) if (!allIds.includes(`n${i}`)) return `n${i}`
  }
  const update = (mut: (d: SpecDoc) => void) => {
    const d: SpecDoc = JSON.parse(JSON.stringify(spec)) as SpecDoc
    mut(d)
    onChange(emit(d))
  }
  const moveBand = (i: number, dir: -1 | 1) => update((d) => {
    const j = i + dir
    if (j < 0 || j >= d.bands.length) return
    ;[d.bands[i], d.bands[j]] = [d.bands[j], d.bands[i]]
  })
  const moveBlock = (bi: number, bi2: number, dir: -1 | 1) => update((d) => {
    const arr = d.bands[bi].blocks
    const j = bi2 + dir
    if (j < 0 || j >= arr.length) return
    ;[arr[bi2], arr[j]] = [arr[j], arr[bi2]]
  })

  const ro = !!readOnly
  const rowCls = 'flex items-center gap-1'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2 text-xs" data-testid="spec-form">
      {spec.bands.map((band, bi) => (
        <section key={bi} className="rounded border bg-app p-1.5" data-testid={`spec-band-${bi}`}>
          <div className={cn(rowCls, 'mb-1')}>
            <span className="shrink-0 text-fg-muted">层 {bi + 1}</span>
            <Input
              value={band.title ?? ''}
              onChange={(e) => update((d) => { d.bands[bi].title = e.target.value })}
              readOnly={ro}
              placeholder="层名（可空）"
              aria-label={`层 ${bi + 1} 名`}
              className="h-6 flex-1 text-xs"
              data-testid={`spec-band-title-${bi}`}
            />
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={ro || bi === 0} onClick={() => moveBand(bi, -1)} aria-label={`层 ${bi + 1} 上移`}><ArrowUp /></Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={ro || bi === spec.bands.length - 1} onClick={() => moveBand(bi, 1)} aria-label={`层 ${bi + 1} 下移`}><ArrowDown /></Button>
            <Button
              size="sm" variant="ghost" className="h-6 w-6 p-0 text-danger-fg" disabled={ro || spec.bands.length <= 1}
              onClick={() => update((d) => {
                const gone = new Set(d.bands[bi].blocks.map((x) => x.id))
                d.bands.splice(bi, 1)
                d.edges = d.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to))
              })}
              aria-label={`删除层 ${bi + 1}`}
            ><Trash2 /></Button>
          </div>
          {band.blocks.map((blk, bi2) => (
            <div key={blk.id} className={cn(rowCls, 'mb-1')} data-testid={`spec-block-${blk.id}`}>
              <span className="w-8 shrink-0 truncate font-mono text-[10px] text-fg-muted" title={blk.id}>{blk.id}</span>
              <Input
                value={blk.label}
                onChange={(e) => update((d) => { d.bands[bi].blocks[bi2].label = e.target.value })}
                readOnly={ro}
                aria-label={`块 ${blk.id} 文案`}
                className="h-6 flex-1 text-xs"
                data-testid={`spec-block-label-${blk.id}`}
              />
              <Select
                value={blk.shape ?? 'box'}
                onValueChange={(v) => update((d) => { d.bands[bi].blocks[bi2].shape = v === 'box' ? undefined : v })}
                disabled={ro}
              >
                <SelectTrigger className="h-6 w-[52px] shrink-0 text-[10px]" aria-label={`块 ${blk.id} 形状`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="box">方框</SelectItem>
                  <SelectItem value="diamond">菱形</SelectItem>
                  <SelectItem value="spacer">占位</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number" min={0.2} max={10} step={0.5}
                value={blk.weight ?? 1}
                onChange={(e) => update((d) => {
                  const w = parseFloat(e.target.value)
                  d.bands[bi].blocks[bi2].weight = Number.isFinite(w) && w > 0 && w !== 1 ? w : undefined
                })}
                readOnly={ro}
                title="宽度权重（同层按比例分配）"
                aria-label={`块 ${blk.id} 宽度权重`}
                className="h-6 w-12 shrink-0 text-[11px]"
              />
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={ro || bi2 === 0} onClick={() => moveBlock(bi, bi2, -1)} aria-label={`块 ${blk.id} 上移`}><ArrowUp /></Button>
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" disabled={ro || bi2 === band.blocks.length - 1} onClick={() => moveBlock(bi, bi2, 1)} aria-label={`块 ${blk.id} 下移`}><ArrowDown /></Button>
              <Button
                size="sm" variant="ghost" className="h-6 w-6 p-0 text-danger-fg" disabled={ro || band.blocks.length <= 1}
                onClick={() => update((d) => {
                  d.bands[bi].blocks.splice(bi2, 1)
                  d.edges = d.edges.filter((e) => e.from !== blk.id && e.to !== blk.id)
                })}
                aria-label={`删除块 ${blk.id}`}
              ><Trash2 /></Button>
            </div>
          ))}
          <Button
            size="sm" variant="ghost" className="h-6 gap-1 px-1 text-[11px]" disabled={ro}
            onClick={() => update((d) => { d.bands[bi].blocks.push({ id: nextId(), label: `新模块 ${100 + allIds.length + 1}` }) })}
            data-testid={`spec-add-block-${bi}`}
          ><Plus /> 添加块</Button>
        </section>
      ))}
      <Button
        size="sm" variant="ghost" className="h-6 gap-1 self-start px-1 text-[11px]" disabled={ro}
        onClick={() => update((d) => { d.bands.push({ title: '', blocks: [{ id: nextId(), label: '新模块' }] }) })}
        data-testid="spec-add-band"
      ><Plus /> 添加层</Button>

      <section className="rounded border bg-app p-1.5" data-testid="spec-edges">
        <div className="mb-1 text-fg-muted">连线</div>
        {spec.edges.map((e, ei) => (
          <div key={ei} className={cn(rowCls, 'mb-1')} data-testid={`spec-edge-${ei}`}>
            <Select value={e.from} onValueChange={(v) => update((d) => { d.edges[ei].from = v })} disabled={ro}>
              <SelectTrigger className="h-6 w-16 text-[11px]" aria-label={`连线 ${ei + 1} 起点`}><SelectValue /></SelectTrigger>
              <SelectContent>{allIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-fg-muted">→</span>
            <Select value={e.to} onValueChange={(v) => update((d) => { d.edges[ei].to = v })} disabled={ro}>
              <SelectTrigger className="h-6 w-16 text-[11px]" aria-label={`连线 ${ei + 1} 终点`}><SelectValue /></SelectTrigger>
              <SelectContent>{allIds.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent>
            </Select>
            <Input
              value={e.label ?? ''}
              onChange={(ev) => update((d) => { d.edges[ei].label = ev.target.value })}
              readOnly={ro}
              placeholder="标注"
              aria-label={`连线 ${ei + 1} 标注`}
              className="h-6 w-20 text-xs"
            />
            <label className="flex shrink-0 items-center gap-0.5 text-[10px] text-fg-muted" title="虚线（辅助数据/回授）">
              <Checkbox
                checked={!!e.dashed}
                onCheckedChange={(v) => update((d) => { d.edges[ei].dashed = v === true })}
                disabled={ro}
                aria-label={`连线 ${ei + 1} 虚线`}
              />虚线
            </label>
            <Button
              size="sm" variant="ghost" className="h-6 w-6 p-0 text-danger-fg" disabled={ro}
              onClick={() => update((d) => { d.edges.splice(ei, 1) })}
              aria-label={`删除连线 ${ei + 1}`}
            ><Trash2 /></Button>
          </div>
        ))}
        <Button
          size="sm" variant="ghost" className="h-6 gap-1 px-1 text-[11px]" disabled={ro || allIds.length < 2}
          onClick={() => update((d) => { d.edges.push({ from: allIds[0], to: allIds[1] }) })}
          data-testid="spec-add-edge"
        ><Plus /> 添加连线</Button>
      </section>
    </div>
  )
}
