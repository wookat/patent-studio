/**
 * 附图绘制 · 画板页（W17）：`#/p/<pid>/board?src=<stem>` 整页画布，替代 W16 弹窗。
 * 闭环：智能体写 figs-src/*.mmd → 本页经 mermaid-to-excalidraw 上画布 → 人拖拽精调 → 导出 PNG 入附图节。
 * 契约：mmd 唯一真源；画布调整不回写源码（源码窗手动改→「应用到画布」单向同步）。
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BoxSelect, Code2, Download, FilePlus2, Loader2, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiscardDialog } from '@/components/ui/discard-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FOCUS_RING, cn } from '@/lib/utils'
import { UserMenu } from '@/components/auth/UserMenu'
import { Toasts } from '@/components/shell/Toasts'
import { api, ApiError } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/lib/query'
import { projectHash } from '@/lib/hash'
import { selectReadonly, useStudio } from '@/store'
import { SpecCanvas } from './SpecCanvas'
import { SpecForm } from './SpecForm'
import { DRAW_STEM_RE, DRAW_TEMPLATE, SPEC_TEMPLATE, cutImageRegion, imageBlobToScene, parseSourceToScene, sceneToPng, type ExcalidrawApi, type ParsedScene, type SceneRect } from './figureDraw'

/* 画布（excalidraw 全家桶）只在本页挂载时进包 */
const BoardCanvas = lazy(() => import('./BoardCanvas'))

/** 画布元素指纹：程序化 updateScene 后快照与此相同 ⇒ 其 onChange 非用户编辑（时间窗抑制挡不住迟发的批量 onChange） */
const fp = (els: readonly { id: string; version?: number }[]) => els.map((e) => `${e.id}:${e.version ?? 0}`).join('|')

export interface BoardPageProps {
  pid: string
  /** ?src=<stem>：打开已存图源；空 = 新图源（模板起） */
  src: string | null
  /** ?img=<figs 图名>：位图标注改图——原图挂画布底，导出覆盖原位 */
  img?: string | null
}

export function BoardPage({ pid, src, img }: BoardPageProps) {
  const uploadFigures = useStudio((s) => s.uploadFigures)
  const toast = useStudio((s) => s.toast)
  const figures = useStudio((s) => s.figures)
  const readOnly = useStudio(selectReadonly)
  const project = useStudio((s) => s.project)

  const { data: sourceData } = useQuery({
    queryKey: ['figure-sources', pid],
    queryFn: () => api.getFigureSources(pid),
  })
  /* 存在性判定不依赖 store.figures——冷开画板 URL 时 store 未水合会漏检走旧 dedup 静默跳过 */
  const { data: figsData } = useQuery({
    queryKey: ['figures', pid],
    queryFn: () => api.getFigures(pid),
  })
  const figItems = figsData?.figures ?? figures
  /* 画板收文本图源（.mmd 画布 / .spec JSON 预览）——图片源列进下拉会把二进制灌进编辑窗 */
  const sources = (sourceData?.sources ?? []).filter((s) => /\.(mmd|spec)$/.test(s.name))
  const [name, setName] = useState('')
  const [code, setCode] = useState(DRAW_TEMPLATE)
  const [baseline, setBaseline] = useState(DRAW_TEMPLATE)
  const [parseErr, setParseErr] = useState('')
  const [srcOpen, setSrcOpen] = useState(false)
  const [askDiscard, setAskDiscard] = useState(false)
  const [busy, setBusy] = useState<'' | 'save' | 'export' | 'del' | 'apply'>('')
  const [delArm, setDelArm] = useState(false)
  /* .spec 图源走 JSON 编辑+后端渲染预览（不上 excalidraw 画布）；同名导出覆盖前需二次确认
     image = 位图标注改图：原图在画布上，可加/拖标注元素，导出整景覆盖 figs 原图 */
  const [kind, setKind] = useState<'mmd' | 'spec' | 'image'>('mmd')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  /* 覆盖确认锁定到具体 docName——换名/换型自动失效，无需 effect 复位 */
  const [armTarget, setArmTarget] = useState<string | null>(null)
  /* .spec 编辑窗：表单（结构微调）| 源码（复杂排布/AI 粘贴） */
  const [specView, setSpecView] = useState<'form' | 'code'>('form')
  /* 位图「区域移动」：armed 时画布盖选框层——拖出的矩形从底图抠成独立可拖元素 */
  const [regionArm, setRegionArm] = useState(false)
  const [regionSel, setRegionSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const regionStart = useRef<{ cx: number; cy: number } | null>(null)
  const canvasBoxRef = useRef<HTMLDivElement | null>(null)

  const apiRef = useRef<ExcalidrawApi | null>(null)
  const pendingCode = useRef<string | null>(null) // 画布 API 未就绪前待应用的源码
  const pendingScene = useRef<ParsedScene | null>(null) // 同上，位图标注模式的整景
  const appliedFp = useRef('') // 上次程序化落画布的元素指纹
  const canvasDirty = useRef(false)
  const pending = useRef<(() => void) | null>(null)
  const codeRef = useRef<HTMLTextAreaElement>(null)
  const applySeq = useRef(0)

  /** 案卷已登记标号（marks 表跨图去重，按号序） */
  const marks = new Map<string, string>()
  for (const f of figures) {
    for (const [num, label] of Object.entries(f.marks ?? {})) if (!marks.has(num)) marks.set(num, label)
  }
  const markList = [...marks.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))

  /** 整景（元素+文件）落画布——applySource 与位图标注模式共用；画布未就绪排队到 onApi */
  const applySceneRaw = useCallback(async (scene: ParsedScene) => {
    const apiInst = apiRef.current
    if (!apiInst) {
      pendingScene.current = scene
      return
    }
    const id = ++applySeq.current
    apiInst.updateScene({ elements: scene.elements })
    if (scene.files) apiInst.addFiles(Object.values(scene.files))
    apiInst.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 })
    appliedFp.current = fp(apiInst.getSceneElements())
    canvasDirty.current = false
    setParseErr('')
    /* 冷载竞态：同 applySource——mount 期 initialData 可能晚落定清掉画布 */
    let tries = 0
    const verify = () => {
      const a = apiRef.current
      if (!a || applySeq.current !== id || !scene.elements.length) return
      if (a.getSceneElements().length > 0) return
      a.updateScene({ elements: scene.elements })
      if (scene.files) a.addFiles(Object.values(scene.files))
      a.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 })
      appliedFp.current = fp(a.getSceneElements())
      if (++tries < 3) window.setTimeout(verify, 120)
    }
    window.setTimeout(verify, 80)
  }, [])

  const applySource = useCallback(async (source: string) => {
    const apiInst = apiRef.current
    if (!apiInst) {
      pendingCode.current = source
      return
    }
    const id = ++applySeq.current
    try {
      const scene = await parseSourceToScene(source)
      if (applySeq.current !== id) return
      apiInst.updateScene({ elements: scene.elements })
      if (scene.files) apiInst.addFiles(Object.values(scene.files))
      apiInst.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 })
      appliedFp.current = fp(apiInst.getSceneElements())
      canvasDirty.current = false
      setParseErr('')
      /* 冷载竞态：首访时 mount 期 initialData 可能晚于本次 updateScene 落定并清掉画布——出帧核空重灌（至多 3 次） */
      let tries = 0
      const verify = () => {
        const a = apiRef.current
        if (!a || applySeq.current !== id || !scene.elements.length) return
        if (a.getSceneElements().length > 0) return
        a.updateScene({ elements: scene.elements })
        a.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9 })
        appliedFp.current = fp(a.getSceneElements())
        if (++tries < 3) window.setTimeout(verify, 120)
      }
      window.setTimeout(verify, 80)
    } catch (e) {
      if (applySeq.current === id) setParseErr(e instanceof Error ? e.message.split('\n')[0] : '解析失败')
    }
  }, [])

  const reload = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['figure-sources', pid] }),
    [pid],
  )

  /* 初载：拉图源清单 + ?img= 位图标注 / ?src= 打开 / 空参套模板（setTimeout 出帧：sync setState 会触发级联渲染告警） */
  useEffect(() => {
    const t = window.setTimeout(() => {
      void reload()
      if (img) {
        const stem0 = img.replace(/\.[^.]+$/, '')
        setKind('image')
        setName(stem0)
        setCode('')
        setBaseline('')
        void api.getFigureImage(pid, img)
          .then((blob) => imageBlobToScene(blob))
          .then((scene) => applySceneRaw(scene))
          .catch((e) => toast(e instanceof ApiError ? e.message : '原图载入失败', 'error'))
        return
      }
      if (src) {
        const stem0 = src.replace(/\.(mmd|spec)$/, '')
        api.getFigureSource(pid, `${stem0}.mmd`)
          .catch(() => api.getFigureSource(pid, `${stem0}.spec`))
          .then((doc) => {
            const k = doc.name.endsWith('.spec') ? 'spec' : 'mmd'
            setKind(k)
            setName(doc.name.replace(/\.(mmd|spec)$/, ''))
            setCode(doc.source)
            setBaseline(doc.source)
            if (k === 'mmd') void applySource(doc.source)
          })
          .catch((e) => toast(e instanceof ApiError ? e.message : '图源读取失败', 'error'))
      } else {
        void applySource(DRAW_TEMPLATE)
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [pid, src, img, reload, applySource, applySceneRaw, toast])

  /* 源码窗编辑 → 防抖 400ms 单向同步画布（不回写文件；.spec 不上画布走预览） */
  useEffect(() => {
    if (kind !== 'mmd') return
    const t = window.setTimeout(() => void applySource(code), 400)
    return () => window.clearTimeout(t)
  }, [code, applySource, kind])

  /* .spec 真渲染预览按需取（画布自身即实时视图；本接口出最终版式 PNG） */
  const showRender = () => {
    setRendering(true)
    api.previewFigureSource(pid, code)
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return url })
        setParseErr('')
      })
      .catch((e) => setParseErr(e instanceof ApiError ? e.message : '预览渲染失败'))
      .finally(() => setRendering(false))
  }

  const stem = name.trim()
  const stemOk = DRAW_STEM_RE.test(stem)
  /* 脏判定现读 ref——onUserEdit 只写 canvasDirty 不触发重渲，渲染期快照会让画布拖拽逃出守卫（D-W17-3） */
  const isDirty = () => code !== baseline || canvasDirty.current
  const guard = (act: () => void) => (isDirty() ? ((pending.current = act), setAskDiscard(true)) : act())
  const goBack = () => guard(() => { window.location.hash = projectHash(pid, { panel: 'figures' }) })

  const run = async (kind: 'save' | 'export' | 'del' | 'apply', fn: () => Promise<void>) => {
    if (busy) return
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : '操作失败'
      toast(msg, 'error')
    } finally {
      setBusy('')
    }
  }

  const openSource = (n: string) => guard(() => {
    void api.getFigureSource(pid, n)
      .then((doc) => {
        const k = doc.name.endsWith('.spec') ? 'spec' : 'mmd'
        setKind(k)
        setName(doc.name.replace(/\.(mmd|spec)$/, ''))
        setCode(doc.source)
        setBaseline(doc.source)
        if (k === 'mmd') void applySource(doc.source)
      })
      .catch((e) => toast(e instanceof ApiError ? e.message : '图源读取失败', 'error'))
  })

  /* ---------- 位图「区域移动」：指针 client → 场景坐标（excalidraw 视口 = (scene+scroll)*zoom） ---------- */
  const sceneFromClient = (cx: number, cy: number) => {
    const st = apiRef.current?.getAppState() as { scrollX?: number; scrollY?: number; zoom?: { value?: number } } | undefined
    const box = canvasBoxRef.current?.getBoundingClientRect()
    const zoom = st?.zoom?.value ?? 1
    return {
      x: (cx - (box?.left ?? 0)) / zoom - (st?.scrollX ?? 0),
      y: (cy - (box?.top ?? 0)) / zoom - (st?.scrollY ?? 0),
    }
  }
  const onRegionDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    regionStart.current = { cx: e.clientX, cy: e.clientY }
    setRegionSel({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, y: e.clientY - e.currentTarget.getBoundingClientRect().top, w: 0, h: 0 })
  }
  const onRegionMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = regionStart.current
    if (!st) return
    const box = e.currentTarget.getBoundingClientRect()
    setRegionSel({
      x: Math.min(st.cx, e.clientX) - box.left,
      y: Math.min(st.cy, e.clientY) - box.top,
      w: Math.abs(e.clientX - st.cx),
      h: Math.abs(e.clientY - st.cy),
    })
  }
  const onRegionUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = regionStart.current
    regionStart.current = null
    setRegionSel(null)
    setRegionArm(false)
    if (!st) return
    const apiInst = apiRef.current
    if (!apiInst) return
    const p1 = sceneFromClient(st.cx, st.cy)
    const p2 = sceneFromClient(e.clientX, e.clientY)
    const rect: SceneRect = { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p1.x - p2.x), height: Math.abs(p1.y - p2.y) }
    if (rect.width < 4 || rect.height < 4) return
    void cutImageRegion(apiInst, rect).then((ok) => {
      if (ok) {
        canvasDirty.current = true
        toast('区域已抠出为可拖块——直接拖动摆放；「导出为附图」覆盖原图', 'info')
      } else {
        toast('未命中图片区域——框选需覆盖底图', 'error')
      }
    })
  }

  const ext = kind === 'spec' ? '.spec' : '.mmd'
  const docName = `${stem}${ext}`
  const overwriteArm = armTarget === `${stem}.png`

  const save = () => run('save', async () => {
    await api.putFigureSource(pid, docName, code)
    void queryClient.invalidateQueries({ queryKey: ['figure-sources', pid] })
    setBaseline(code)
    toast(`图源已保存 figs-src/${docName}`, 'success')
    await reload()
  })

  const exportPng = () => run('export', async () => {
    const fname = `${stem}.png`
    const blob = kind === 'spec'
      ? await api.previewFigureSource(pid, code)
      : await (async () => {
          const apiInst = apiRef.current
          if (!apiInst) throw new Error('画布未就绪')
          return sceneToPng(apiInst)
        })()
    /* 同图已存在 → 二次确认后整组替换（题注/标号/spec 引用不动） */
    if (figItems.some((f) => f.name === fname)) {
      if (!overwriteArm) { setArmTarget(fname); return }
      setArmTarget(null)
      await api.replaceFigureImage(pid, fname, [new File([blob], fname, { type: 'image/png' })])
      canvasDirty.current = false
      toast(`已覆盖 figs/${fname}（同图原位替换，题注/标号不变）`, 'success')
      return
    }
    const r = await uploadFigures([new File([blob], fname, { type: 'image/png' })])
    canvasDirty.current = false
    if (!r) return
    const skipped = (r.skipped ?? []).find((s) => s.name === fname)
    if (skipped) {
      toast(`figs/${fname} 未导出：${skipped.reason}`, 'info')
      return
    }
    toast(`已导出 figs/${fname} 并入附图节（记得在「附图说明」补题注）`, 'success')
  })

  const remove = () => run('del', async () => {
    await api.deleteFigureSource(pid, docName)
    void queryClient.invalidateQueries({ queryKey: ['figure-sources', pid] })
    toast(`图源已删除 ${docName}`, 'success')
    setDelArm(false)
    setName('')
    setCode(kind === 'spec' ? SPEC_TEMPLATE : DRAW_TEMPLATE)
    setBaseline(kind === 'spec' ? SPEC_TEMPLATE : DRAW_TEMPLATE)
    await reload()
  })

  /** 点标号 chip → 在源码光标处插 "名称 标号"（mermaid 节点文本格式） */
  const insertMark = (num: string, label: string) => {
    const t = codeRef.current
    const text = `${label} ${num}`
    if (!t) {
      setCode((c) => `${c}${text}`)
      return
    }
    const pos = t.selectionStart ?? code.length
    setCode(`${code.slice(0, pos)}${text}${code.slice(pos)}`)
    requestAnimationFrame(() => {
      t.focus()
      t.setSelectionRange(pos + text.length, pos + text.length)
    })
  }

  const exists = sources.some((s) => s.name === docName)
  const disabled = readOnly || !stemOk || !!busy

  return (
    <div className="flex h-dvh flex-col bg-app" data-testid="board-page" data-pid={pid}>
      <header className="flex h-md-control shrink-0 items-center gap-1 border-b bg-card px-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-xs" onClick={goBack} data-testid="board-back">
          <ArrowLeft aria-hidden /> 附图书
        </Button>
        <a href="#/" className="inline-flex items-center gap-1.5 px-2 text-link" aria-label="知撰首页">
          <img src="/logo-mark.svg" alt="" aria-hidden className="size-5 rounded-sm" />
          <span className="hidden text-sm font-semibold text-fg-strong sm:inline">知撰</span>
        </a>
        <span className="mx-2 h-4 w-px bg-border" aria-hidden />
        <span className="text-sm font-medium text-fg-strong" data-testid="board-title">
          绘制附图 · 画板{project?.title ? ` · ${project.title}` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-2 py-1.5">
        <Select value="" onValueChange={(n) => { if (n) openSource(n) }} disabled={!sources.length}>
          <SelectTrigger size="sm" className="w-44" aria-label="打开已有图源" data-testid="board-source-select">
            <SelectValue placeholder={sources.length ? `打开已有（${sources.length}）…` : '暂无已存图源'} />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs"
          onClick={() => guard(() => { setKind('mmd'); setName(''); setCode(DRAW_TEMPLATE); setBaseline(DRAW_TEMPLATE) })}
          data-testid="board-new"
        >
          <FilePlus2 aria-hidden /> 新建
        </Button>
        <Button
          size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs"
          onClick={() => guard(() => { setKind('spec'); setName(''); setCode(SPEC_TEMPLATE); setBaseline(SPEC_TEMPLATE) })}
          data-testid="board-new-spec"
        >
          <FilePlus2 aria-hidden /> 新建 .spec
        </Button>
        {kind === 'mmd' && (
          <Button
            size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs"
            disabled={readOnly}
            title="把 mmd 图源转为 .spec 分层框图——可上交互画布拖块/点选改图（原 .mmd 保留，保存后成 stem.spec）"
            onClick={() => void run('apply', async () => {
              const r = await api.mmdToSpec(pid, code)
              setKind('spec')
              setSpecView('form')
              setCode(r.spec)
              toast('已转 .spec——画布可拖动编辑；保存写入同名 .spec（原 .mmd 保留可删）', 'info')
            })}
            data-testid="board-to-spec"
          >
            转 .spec
          </Button>
        )}
        {kind === 'image' && (
          <>
            <Button
              size="sm" variant={regionArm ? 'secondary' : 'ghost'} className="h-7 gap-1 px-1.5 text-xs"
              disabled={readOnly}
              title="框选底图一块区域→抠成可拖动的小块（原位置留白）；可重复多次抠多区域"
              onClick={() => { setRegionArm((a) => !a); setRegionSel(null); regionStart.current = null }}
              data-testid="board-region-move"
            >
              <BoxSelect aria-hidden /> 区域移动
            </Button>
            <span className="text-xs text-fg-muted" data-testid="board-image-badge">位图改图 · 导出覆盖原图</span>
          </>
        )}
        {kind === 'spec' && (
          <>
            <span className="text-xs text-fg-muted">.spec 分层框图 · 画布即编辑</span>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs" onClick={showRender} disabled={rendering} data-testid="board-show-render">
              {rendering ? '渲染中…' : '渲染预览'}
            </Button>
          </>
        )}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="图源名（字母/数字/_/-）"
          aria-label="图源名"
          className="h-7 w-44 text-xs"
          data-testid="board-name"
        />
        {!stemOk && stem && <span className="text-xs text-danger-fg" data-testid="board-name-err">名称仅限字母/数字/_/-，≤64 字符</span>}
        {exists && <span className="text-xs text-fg-muted">已存——保存将覆盖</span>}
        {kind !== 'image' && (
          <Button
            size="sm" variant={srcOpen ? 'secondary' : 'ghost'} className="h-7 gap-1 px-1.5 text-xs"
            onClick={() => setSrcOpen((o) => !o)}
            aria-pressed={srcOpen}
            data-testid="board-src-toggle"
          >
            <Code2 aria-hidden /> 源码
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {kind !== 'image' && (
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs" disabled={disabled} onClick={() => void save()} data-testid="board-save">
              {busy === 'save' ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />} 保存
            </Button>
          )}
          {kind !== 'image' && (delArm ? (
            <>
              <Button size="sm" variant="danger" className="h-7 gap-1 px-1.5 text-xs" disabled={disabled || !exists} onClick={() => void remove()} data-testid="board-delete-confirm">
                确认删除
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs" onClick={() => setDelArm(false)} aria-label="取消删除">
                取消
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs text-danger-fg" disabled={disabled || !exists} onClick={() => setDelArm(true)} data-testid="board-delete">
              <Trash2 aria-hidden /> 删除
            </Button>
          ))}
          {overwriteArm ? (
            <>
              <Button size="sm" variant="danger" className="h-7 gap-1 px-1.5 text-xs" disabled={disabled} onClick={() => void exportPng()} data-testid="board-export-confirm">
                确认覆盖导出
              </Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 px-1.5 text-xs" onClick={() => setArmTarget(null)} aria-label="取消覆盖">
                取消
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-7 gap-1 px-1.5 text-xs" disabled={disabled} onClick={() => void exportPng()} data-testid="board-export">
              {busy === 'export' ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />} 导出为附图
            </Button>
          )}
        </span>
      </div>

      {markList.length > 0 && srcOpen && kind === 'mmd' && (
        <div className="flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1" data-testid="board-marks">
          <span className="text-xs text-fg-muted">案卷标号：</span>
          {markList.map(([num, label]) => (
            <button
              key={num}
              type="button"
              className={cn('rounded border px-1.5 py-0.5 text-xs hover:bg-hover', FOCUS_RING)}
              title={`插入「${label} ${num}」`}
              onClick={() => insertMark(num, label)}
              data-testid={`board-mark-${num}`}
            >
              {num} {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" data-testid="board-canvas" ref={canvasBoxRef}>
          {kind === 'spec' ? (
            <>
              <SpecCanvas code={code} readOnly={readOnly} onChange={setCode} />
              {previewUrl && (
                <div
                  className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
                  onClick={() => setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return null })}
                  data-testid="board-render-overlay"
                >
                  <img src={previewUrl} alt="figspec 最终渲染预览（点击关闭）" className="max-h-full max-w-full rounded bg-white shadow-lg" />
                </div>
              )}
            </>
          ) : (
            <Suspense fallback={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-6 animate-spin text-fg-muted" aria-label="加载画板" />
              </div>
            }>
              <BoardCanvas
                viewOnly={readOnly}
                onApi={(a) => {
                  apiRef.current = a
                  const sc = pendingScene.current
                  if (sc !== null) {
                    pendingScene.current = null
                    void applySceneRaw(sc)
                    return
                  }
                  const c = pendingCode.current
                  if (c !== null) {
                    pendingCode.current = null
                    void applySource(c)
                  }
                }}
                onUserEdit={() => {
                  const a = apiRef.current
                  if (a && fp(a.getSceneElements()) !== appliedFp.current) canvasDirty.current = true
                }}
              />
            </Suspense>
          )}
          {kind === 'image' && regionArm && (
            <div
              className="absolute inset-0 z-30 cursor-crosshair"
              data-testid="board-region-overlay"
              onPointerDown={onRegionDown}
              onPointerMove={onRegionMove}
              onPointerUp={onRegionUp}
              onPointerCancel={() => { regionStart.current = null; setRegionSel(null); setRegionArm(false) }}
            >
              {regionSel && (
                <div
                  className="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
                  style={{ left: regionSel.x, top: regionSel.y, width: regionSel.w, height: regionSel.h }}
                  data-testid="board-region-rect"
                />
              )}
            </div>
          )}
          <p className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-card/90 px-2 py-0.5 text-[11px] text-fg-muted" data-testid="board-hint">
            {kind === 'spec'
              ? '画布即编辑面——拖块/点选改动直接写回 JSON；「渲染预览」看最终版式'
              : kind === 'image'
                ? '原图作底——加框/箭头/文字标注、点「区域移动」框选抠块拖动；「导出为附图」整景覆盖原图（题注/标号不变）'
                : '画布调整只进导出 PNG，不回写 mmd 源码——逐块拖动改结构点「转 .spec」，改图源用右侧「源码」窗'}
          </p>
        </div>
        {srcOpen && (
          <aside className="flex w-80 shrink-0 flex-col border-l bg-card" data-testid="board-src-pane">
            {kind === 'spec' && (
              <div className="flex items-center gap-1 border-b px-2 py-1" data-testid="spec-view-toggle">
                {(['form', 'code'] as const).map((v) => (
                  <Button
                    key={v}
                    size="sm" variant={specView === v ? 'secondary' : 'ghost'} className="h-6 px-2 text-[11px]"
                    onClick={() => setSpecView(v)}
                    aria-pressed={specView === v}
                    data-testid={`spec-view-${v}`}
                  >{v === 'form' ? '表单' : '源码'}</Button>
                ))}
                <span className="ml-auto text-[10px] text-fg-muted">改动实时预览</span>
              </div>
            )}
            {kind === 'spec' && specView === 'form' ? (
              <SpecForm code={code} readOnly={readOnly} onChange={setCode} />
            ) : (
              <>
                <textarea
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  readOnly={readOnly}
                  spellCheck={false}
                  aria-label={kind === 'spec' ? 'figspec JSON 图源' : 'Mermaid 图源'}
                  className="min-h-0 flex-1 resize-none bg-card p-2 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="board-code"
                />
                {parseErr && <p className="border-t px-2 py-1 text-xs text-danger-fg" data-testid="board-parse-err">语法错误：{parseErr}</p>}
              </>
            )}
          </aside>
        )}
      </div>

      <DiscardDialog
        open={askDiscard}
        onStay={() => { pending.current = null; setAskDiscard(false) }}
        onDiscard={() => { setAskDiscard(false); const act = pending.current; pending.current = null; act?.() }}
      />
      <Toasts />
    </div>
  )
}
