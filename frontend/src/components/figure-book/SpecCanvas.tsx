/**
 * .spec 交互画布——figspec JSON 的 React Flow（@xyflow/react）编辑面：
 *   块拖动：同层重排 / 跨层移动（改 bands 归属），多选/框选批量拖动
 *   连线：块底手柄拖到另一块即成边；点选边改标注/虚线/删除
 *   点选块：菱形/占位切换、删除、双击改文案；层框 + 按钮加块
 * 语义与后端 figspec 渲染器一致：spec 无自由坐标——拖动只改结构归属，
 * 松手后位置由布局重算；PNG 真渲染走后端，画布只是同一几何的可交互投影。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'

interface SpecBlock { id: string; label: string; shape?: string; weight?: number }
interface SpecBand { title?: string; blocks: SpecBlock[] }
interface SpecEdge { from: string; to: string; label?: string; dashed?: boolean }
interface SpecDoc { bands: SpecBand[]; edges: SpecEdge[] }

function parse(code: string): SpecDoc | null {
  try {
    const d = JSON.parse(code) as SpecDoc
    if (!d || !Array.isArray(d.bands) || !d.bands.length) return null
    return { bands: d.bands, edges: Array.isArray(d.edges) ? d.edges : [] }
  } catch {
    return null
  }
}

/* ------- 布局常量（与后端 figspec 画法同形：层堆叠+层内横排+正交边） ------- */
const PAD = 24
const TITLE_H = 26
const BLOCK_H = 44
const GAP_X = 28
const BAND_GAP = 92
const GUTTER = 56
const MIN_W = 720

const estW = (s: string, weight = 1) => {
  let w = 24
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 14 : 8
  return Math.max(110, Math.min(240, w + 16)) * weight
}
const blkW = (b: SpecBlock) =>
  b.shape === 'spacer' ? 60 * (b.weight ?? 1) : estW(b.label, b.weight ?? 1)

interface LBlock extends SpecBlock { x: number; y: number; w: number; band: number }

function layout(spec: SpecDoc) {
  const bandWidths = spec.bands.map((b) =>
    b.blocks.reduce((s, x) => s + blkW(x), 0) + GAP_X * Math.max(0, b.blocks.length - 1))
  const width = Math.max(MIN_W + GUTTER, Math.max(...bandWidths, 0) + PAD * 2 + GUTTER)
  const pos = new Map<string, LBlock>()
  const bands: { y: number; title?: string; blocks: LBlock[] }[] = []
  spec.bands.forEach((band, i) => {
    const by = PAD + i * (TITLE_H + BLOCK_H + BAND_GAP)
    let x = PAD + Math.max(0, (width - GUTTER - PAD * 2 - bandWidths[i]) / 2)
    const lbs: LBlock[] = band.blocks.map((blk) => {
      const w = blkW(blk)
      const lb: LBlock = { ...blk, x, y: by + TITLE_H, w, band: i }
      pos.set(blk.id, lb)
      x += w + GAP_X
      return lb
    })
    bands.push({ y: by, title: band.title, blocks: lbs })
  })
  return { width, bands, pos }
}

/* ------- 自定义节点/边 ------- */

type BlkData = {
  label: string
  shape?: string
  editing: boolean
  editVal: string
  ro: boolean
  onEditVal: (v: string) => void
  onCommitEdit: () => void
  onCancelEdit: () => void
  onDblClick: () => void
}
type BlkNode = Node<BlkData, 'blk'>

function SpecBlockNode({ id, data, selected }: NodeProps<BlkNode>) {
  const diamond = data.shape === 'diamond'
  const spacer = data.shape === 'spacer'
  const editInput = data.editing ? (
    <input
      autoFocus
      value={data.editVal}
      onChange={(e) => data.onEditVal(e.target.value)}
      onBlur={data.onCommitEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') data.onCommitEdit()
        if (e.key === 'Escape') data.onCancelEdit()
      }}
      className="nodrag h-full w-full border-0 bg-transparent text-center text-[13px] outline-none"
      data-testid="canvas-edit-input"
    />
  ) : null
  return (
    <div
      className="relative h-full w-full"
      data-testid={`canvas-block-${id}`}
      onDoubleClick={() => { if (!data.ro) data.onDblClick() }}
    >
      {!data.ro && (
        <>
          <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-slate-400" />
          <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-slate-400" />
        </>
      )}
      {diamond ? (
        <>
          <svg className="h-full w-full overflow-visible">
            <polygon
              points="50%,0 100%,50% 50%,100% 0,50%"
              fill="#fff"
              stroke={selected ? '#2563eb' : '#222'}
              strokeWidth={selected ? 2 : 1.4}
            />
          </svg>
          {editInput ?? (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center text-[12px] leading-tight text-[#111]">
              {data.label}
            </span>
          )}
        </>
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center rounded-sm border ${
            spacer ? 'border-dashed border-slate-300 bg-slate-50 text-slate-400' : 'border-[#222] bg-white'
          }`}
          style={selected ? { borderColor: '#2563eb', borderWidth: 2 } : undefined}
        >
          {editInput ?? (
            <span className="px-1 text-center text-[13px] leading-tight text-[#111]">
              {spacer ? (data.label || '占位') : data.label}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

type BandData = { bi: number; title?: string; ro: boolean; onAdd: (bi: number) => void }
type BandNode = Node<BandData, 'band'>

function SpecBandNode({ data }: NodeProps<BandNode>) {
  return (
    <div
      className="relative h-full w-full rounded border border-dashed border-slate-300"
      data-testid={`canvas-band-${data.bi}`}
    >
      {data.title ? (
        <span className="absolute left-2 top-1 text-[11px] text-slate-500">{data.title}</span>
      ) : null}
      {!data.ro && (
        <button
          type="button"
          className="nodrag absolute right-1 top-1 flex h-[18px] w-[26px] items-center justify-center rounded border border-slate-300 bg-white text-[13px] text-slate-600"
          onClick={() => data.onAdd(data.bi)}
          data-testid={`canvas-add-block-${data.bi}`}
        >＋</button>
      )}
    </div>
  )
}

type SpecEdgeData = { idx: number; label?: string; dashed?: boolean; path: string; lx: number; ly: number }
type SpecRFEdge = Edge<SpecEdgeData, 'spec'>

/* 正交边：下行相邻→底→层间车道→顶；同层→顶部上跨；上行→右沟槽绕行 */
function SpecEdgeView({ id, data, selected }: EdgeProps<SpecRFEdge>) {
  if (!data) return null
  return (
    <>
      <path d={data.path} fill="none" stroke="transparent" strokeWidth={14} data-testid={`canvas-edge-${data.idx}`} />
      <BaseEdge
        id={id}
        path={data.path}
        style={{
          stroke: selected ? '#2563eb' : '#222',
          strokeWidth: selected ? 2.4 : 1.6,
          strokeDasharray: data.dashed ? '6 4' : undefined,
        }}
        markerEnd="url(#spec-arrow)"
      />
      <EdgeLabelRenderer>
        {data.label ? (
          <div
            className="nodrag nopan absolute rounded bg-white/90 px-1 text-[11px] text-slate-700"
            style={{ transform: `translate(-50%, -50%) translate(${data.lx}px, ${data.ly}px)` }}
          >{data.label}</div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { blk: SpecBlockNode, band: SpecBandNode }
const edgeTypes = { spec: SpecEdgeView }

function edgePath(a: LBlock, b: LBlock, gutterX: number) {
  const ax = a.x + a.w / 2
  const ay = a.y
  const bx = b.x + b.w / 2
  const by = b.y
  if (b.band > a.band) {
    if (b.band - a.band === 1) {
      const lane = ay + BLOCK_H + BAND_GAP / 2
      return { d: `M ${ax} ${ay + BLOCK_H} V ${lane} H ${bx} V ${by}`, lx: (ax + bx) / 2, ly: lane - 8 }
    }
    const lane = by - BAND_GAP / 2
    const gy = ay + BLOCK_H + 16
    return { d: `M ${ax} ${ay + BLOCK_H} V ${gy} H ${gutterX} V ${lane} H ${bx} V ${by}`, lx: gutterX - 8, ly: (gy + lane) / 2 }
  }
  if (b.band === a.band) {
    const top = ay - 14
    return { d: `M ${ax} ${ay} V ${top} H ${bx} V ${by}`, lx: (ax + bx) / 2, ly: top - 4 }
  }
  const down = ay + BLOCK_H + 16
  const lane = by - 16
  return { d: `M ${ax} ${ay + BLOCK_H} V ${down} H ${gutterX} V ${lane} H ${bx} V ${by}`, lx: gutterX - 8, ly: (lane + down) / 2 }
}

export interface SpecCanvasProps {
  code: string
  readOnly?: boolean
  onChange: (json: string) => void
}

function Canvas({ code, readOnly, onChange }: SpecCanvasProps) {
  const spec = useMemo(() => parse(code), [code])
  const lay = useMemo(() => (spec ? layout(spec) : null), [spec])

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selEdge, setSelEdge] = useState<number | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  const dragRef = useRef(false)

  const ro = !!readOnly
  const allIds = spec ? spec.bands.flatMap((b) => b.blocks.map((x) => x.id)) : []
  const nextId = () => { for (let i = 1; ; i++) if (!allIds.includes(`n${i}`)) return `n${i}` }
  const update = (mut: (d: SpecDoc) => void) => {
    if (!spec) return
    const d: SpecDoc = JSON.parse(JSON.stringify(spec)) as SpecDoc
    mut(d)
    onChange(JSON.stringify(d, null, 2))
  }

  const commitEdit = () => {
    if (editId) update((d) => {
      for (const b of d.bands) for (const bl of b.blocks) if (bl.id === editId) bl.label = editVal
    })
    setEditId(null)
  }

  /* spec → React Flow 节点/边；拖动期间不重建（防跳变），重建时保留选中态 */
  useEffect(() => {
    if (!spec || !lay || dragRef.current) return
    const gutterX = lay.width - GUTTER + 10
    setNodes((prev) => {
      const prevSel = new Map(prev.map((n) => [n.id, !!n.selected]))
      const ns: Node[] = []
      lay.bands.forEach((band, bi) => {
        ns.push({
          id: `band:${bi}`,
          type: 'band',
          position: { x: 0, y: band.y - 6 },
          data: {
            bi, ro, title: band.title,
            onAdd: (b2: number) => update((d) => {
              d.bands[b2].blocks.push({ id: nextId(), label: `新模块 ${100 + allIds.length + 1}` })
            }),
          },
          style: { width: lay.width - GUTTER + 4, height: TITLE_H + BLOCK_H + 16, zIndex: -1 },
          draggable: false,
          selectable: false,
        })
        band.blocks.forEach((blk) => {
          ns.push({
            id: blk.id,
            type: 'blk',
            position: { x: blk.x, y: blk.y },
            data: {
              label: blk.label,
              shape: blk.shape,
              ro,
              editing: editId === blk.id,
              editVal,
              onEditVal: setEditVal,
              onCommitEdit: commitEdit,
              onCancelEdit: () => setEditId(null),
              onDblClick: () => { setEditId(blk.id); setEditVal(blk.label) },
            },
            style: { width: blk.w, height: BLOCK_H },
            selected: prevSel.get(blk.id) ?? false,
            draggable: !ro,
            connectable: !ro,
          })
        })
      })
      return ns
    })
    setEdges(spec.edges.map((e, idx) => {
      const a = lay.pos.get(e.from)
      const b = lay.pos.get(e.to)
      const p = a && b ? edgePath(a, b, gutterX) : { d: '', lx: 0, ly: 0 }
      return {
        id: `e-${idx}`,
        source: e.from,
        target: e.to,
        type: 'spec',
        data: { idx, label: e.label, dashed: e.dashed, path: p.d, lx: p.lx, ly: p.ly },
        selectable: !ro,
        selected: selEdge === idx,
      }
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, editId, editVal, selEdge])

  const onNodesChange = (changes: NodeChange[]) => {
    if (changes.some((c) => c.type === 'position' && c.dragging)) dragRef.current = true
    setNodes((ns) => applyNodeChanges(changes, ns))
  }

  /* 拖动落点 → 目标层 + 层内插入序（同一几何，不写坐标） */
  const bandZone = (y: number) => {
    let best = 0
    lay?.bands.forEach((b, i) => { if (y > b.y + TITLE_H / 2) best = i })
    return best
  }
  const insertIdx = (bi: number, x: number) => {
    const lbs = lay?.bands[bi]?.blocks ?? []
    for (let i = 0; i < lbs.length; i++) {
      if (x < lbs[i].x + lbs[i].w / 2 - GAP_X / 2) return i
    }
    return lbs.length
  }

  const onNodeDragStop = (_e: MouseEvent | TouchEvent, _node: Node, dragged: Node[]) => {
    dragRef.current = false
    if (ro || !lay) return
    update((d) => {
      for (const n of dragged) {
        if (n.type !== 'blk') continue
        let fromBi = -1
        let blk: SpecBlock | null = null
        d.bands.forEach((b, i) => {
          const j = b.blocks.findIndex((x) => x.id === n.id)
          if (j >= 0) { fromBi = i; blk = b.blocks[j] }
        })
        if (!blk) continue
        const cy = n.position.y + BLOCK_H / 2
        const cx = n.position.x + (lay.pos.get(n.id)?.w ?? 100) / 2
        const toBi = bandZone(cy)
        let idx = insertIdx(toBi, cx)
        d.bands[fromBi].blocks = d.bands[fromBi].blocks.filter((x) => x.id !== n.id)
        if (toBi === fromBi) {
          const oldIdx = lay.bands[toBi].blocks.findIndex((x) => x.id === n.id)
          if (oldIdx >= 0 && oldIdx < idx) idx -= 1
        }
        d.bands[toBi].blocks.splice(Math.min(idx, d.bands[toBi].blocks.length), 0, blk)
      }
      d.bands = d.bands.filter((b) => b.blocks.length > 0)
    })
  }

  const onConnect = (c: Connection) => {
    if (ro || !c.source || !c.target || c.source === c.target) return
    update((d) => { d.edges.push({ from: c.source!, to: c.target! }) })
  }

  if (!spec || !lay) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="spec-canvas-invalid">
        <p className="text-xs text-danger-fg">JSON 无法解析——请在「源码」窗修正语法</p>
      </div>
    )
  }

  const selIds = nodes.filter((n) => n.selected && n.type === 'blk').map((n) => n.id)
  const selBlockObj = selIds.length === 1
    ? spec.bands.flatMap((b) => b.blocks).find((x) => x.id === selIds[0]) : null
  const selEdgeObj = selEdge !== null ? spec.edges[selEdge] : null

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="spec-canvas">
      <div className="flex items-center gap-1 border-b bg-card px-2 py-1">
        <Button
          size="sm" variant="ghost" className="h-6 gap-1 px-1.5 text-[11px] text-danger-fg"
          disabled={ro || (selIds.length === 0 && selEdge === null)}
          onClick={() => {
            if (selIds.length) update((d) => {
              const gone = new Set(selIds)
              for (const b of d.bands) b.blocks = b.blocks.filter((x) => !gone.has(x.id))
              d.edges = d.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to))
              d.bands = d.bands.filter((b) => b.blocks.length > 0)
            })
            else if (selEdge !== null) update((d) => { d.edges.splice(selEdge, 1) })
            setSelEdge(null)
          }}
          data-testid="canvas-del-sel"
        ><Trash2 /> 删除所选{selIds.length > 1 ? `（${selIds.length}）` : ''}</Button>
        {selBlockObj && (
          <label className="ml-1 flex items-center gap-1 text-[11px] text-fg-muted">
            <Checkbox
              checked={selBlockObj.shape === 'diamond'}
              onCheckedChange={(v) => update((d) => {
                for (const b of d.bands) for (const bl of b.blocks) if (bl.id === selIds[0]) bl.shape = v === true ? 'diamond' : undefined
              })}
              disabled={ro}
              data-testid="canvas-diamond"
            />菱形判据
          </label>
        )}
        {selEdgeObj && selEdge !== null && (
          <>
            <Input
              value={selEdgeObj.label ?? ''}
              onChange={(e) => update((d) => { d.edges[selEdge].label = e.target.value })}
              readOnly={ro}
              placeholder="边标注"
              aria-label="边标注"
              className="ml-1 h-6 w-28 text-[11px]"
              data-testid="canvas-edge-label"
            />
            <label className="flex items-center gap-1 text-[11px] text-fg-muted">
              <Checkbox
                checked={!!selEdgeObj.dashed}
                onCheckedChange={(v) => update((d) => { d.edges[selEdge].dashed = v === true })}
                disabled={ro}
                data-testid="canvas-edge-dashed"
              />虚线
            </label>
          </>
        )}
        <span className="ml-auto text-[10px] text-fg-muted">
          拖块换层/排序（Shift 多选）· 双击改字 · 从块底手柄拖出连线 · 滚轮缩放
        </span>
      </div>

      <div className="min-h-0 flex-1 bg-app">
        <svg className="absolute h-0 w-0" aria-hidden>
          <defs>
            <marker id="spec-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L8,4 L0,8 z" fill="#222" />
            </marker>
          </defs>
        </svg>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgeClick={(_e, edge) => { if (!ro) setSelEdge((edge.data as SpecEdgeData | undefined)?.idx ?? null) }}
          onPaneClick={() => setSelEdge(null)}
          fitView
          minZoom={0.3}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={!ro}
          nodesConnectable={!ro}
          elementsSelectable={!ro}
          deleteKeyCode={null}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}

export function SpecCanvas(props: SpecCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
