/**
 * 审阅模式：块的旧 / 新 Markdown → 带 CriticMarkup 的 Markdown（docs/plan/16 §4.6）。
 * 标记子集与 backend/src/patent_studio/kernel/critic.py 一致：{++ins++} {--del--} {~~a~>b~~}，单行内非贪婪匹配 ⇒ 标记绝不跨行。
 *
 * 行级：LCS 对齐旧 / 新行；成对的改动行做字符级 LCS 合成 {~~~>~~} / {++++} / {----}；只在新文里的整行 → {++行++}，
 * 只在旧文里的整行 → {--行--}（服务端 acl._original 把整行插入视为「原文没有」，故 reviewer 落盘后 original(new) == 原文）。
 * 行首 `|`（表格）/ `$$`（公式）/ `#`（标题）的行不能被标记切开（会破坏内核对该行的识别），这类块整块替换：
 * 旧块每行 {--…--}，随后新块每行 {++…++}。
 *
 * 行内格式片（`**粗**` `*斜*` `<u>下划线</u>` `_{下标}` `^{上标}` `_x` `^x`）是原子 token：字符级对齐不会把 `_{` 与 `}` 拆成两处插入，
 * 选一段加下标 / 加粗 = 一条 {~~原文~>_{原文}~~} 替换（Word 的「格式变更」在 CriticMarkup 子集里只能这样表达），
 * 在既有格式片内续写 = 整片替换，落盘后每个标记内部仍是完整的行内语法，版面 / PDF 不会出现裸 `_{`。
 *
 * 旧文里已有的未决标记是边界：字符级对齐把标记记号当原子 token，改动按所在区域折算——
 * 删掉自己插入的字 = 直接收回；删除已删除的字 = 保持；在插入区里续写 = 扩大插入；在删除区里键入 = 挪到 --} 之后作新插入；
 * 用户删掉的记号一律复原。于是两处改动永不嵌套，落盘后每个标记仍是独立一张修订卡。
 */
export function toCritic(oldMd: string, newMd: string): string {
  if (oldMd === newMd) return newMd
  const a = oldMd.split('\n')
  const b = newMd.split('\n')
  if (a.some(isStructural) || b.some(isStructural)) {
    return [...a.map(del), ...b.map(ins)].join('\n')
  }
  const out: string[] = []
  for (const g of groups(lcsOps(a, b))) {
    if (g.kind === 'equal') out.push(...g.a)
    else {
      const n = Math.min(g.a.length, g.b.length)
      for (let i = 0; i < n; i++) out.push(diffLine(g.a[i], g.b[i]))
      for (let i = n; i < g.a.length; i++) out.push(del(g.a[i]))
      for (let i = n; i < g.b.length; i++) out.push(ins(g.b[i]))
    }
  }
  return out.join('\n')
}

/**
 * 整书旧 / 新 Markdown → CriticMarkup：先按空行切成块（标题 / 段落 / 表格 / 公式各自成块），块级 LCS 对齐，
 * 只对改动的块两两调用 toCritic；只在新书里的块整块 {++…++}，只在旧书里的块整块 {--…--}。
 * 不能把整书直接交给 toCritic——书里总有 `#` 标题，会触发「结构行整块替换」把全书标成删除 + 插入。
 */
export function toCriticBook(oldMd: string, newMd: string): string {
  if (oldMd === newMd) return newMd
  const a = chunks(oldMd)
  const b = chunks(newMd)
  const out: string[] = []
  for (const g of groups(lcsOps(a, b))) {
    if (g.kind === 'equal') out.push(...g.a)
    else {
      const n = Math.min(g.a.length, g.b.length)
      for (let i = 0; i < n; i++) out.push(toCritic(g.a[i], g.b[i]))
      for (let i = n; i < g.a.length; i++) out.push(markChunk(g.a[i], del))
      for (let i = n; i < g.b.length; i++) out.push(markChunk(g.b[i], ins))
    }
  }
  return out.join('\n')
}

/** 按行切块：空行单独成块（保持块间距原样），连续非空行合成一块 */
function chunks(md: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  for (const line of md.split('\n')) {
    if (line === '') {
      if (cur.length) out.push(cur.join('\n'))
      cur = []
      out.push('')
    } else cur.push(line)
  }
  if (cur.length) out.push(cur.join('\n'))
  return out
}

const markChunk = (chunk: string, mark: (line: string) => string) => chunk.split('\n').map(mark).join('\n')

const isStructural = (line: string) => /^(\||\$\$|#)/.test(line)

/** 整行删除：空行没有可删的字，原样保留（{----} 会被 acl._original 当成插入行）；已含标记的行按区域折算 */
const del = (line: string) => (line === '' ? line : hasMark(line) ? diffLine(line, '') : `{--${line}--}`)
const ins = (line: string) => (line === '' ? line : hasMark(line) ? diffLine('', line) : `{++${line}++}`)

const MARK_TOKENS = new Set(['{++', '++}', '{--', '--}', '{~~', '~>', '~~}'])
const hasMark = (s: string) => /\{(\+\+|--|~~)/.test(s)

/**
 * 原子 token：CriticMarkup 记号 | 行内格式片（与 doc/inline.ts / 内核 `_SUB_RE` 同一语法子集：
 * `***粗斜***` `**粗**` `*斜*`（内侧非空白）`<u>…</u>` `_{…}` `_[…]` `_x`/`_abc`（字母数字串）`^{…}` `^x`）。
 * 记号优先于格式片（`{++_{2}++}` 里 `{++` 先切出来，随后 `_{2}` 成片），其余逐字。
 */
const ATOM_RE =
  /\{\+\+|\+\+\}|\{--|--\}|\{~~|~>|~~\}|\*\*\*\S(?:[^*]*?\S)?\*\*\*|\*\*\S(?:[^*]*?\S)?\*\*|\*\S(?:[^*]*?\S)?\*|<u>.*?<\/u>|[_^](?:\{[^}]+\}|\[[^\]]+\]|[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*)/g

/** 记号 / 格式片为原子 token，其余逐字 */
function tokenize(line: string): string[] {
  const out: string[] = []
  let last = 0
  for (const m of line.matchAll(ATOM_RE)) {
    out.push(...line.slice(last, m.index))
    out.push(m[0])
    last = m.index + m[0].length
  }
  out.push(...line.slice(last))
  return out
}

type Op<T> = { kind: 'equal'; a: T; b: T } | { kind: 'del'; a: T } | { kind: 'ins'; b: T }

/** 经典 LCS 动态规划（块只有几行 / 几百字，O(n·m) 足够），输出按位置顺序的 equal / del / ins */
function lcsOps<T>(a: readonly T[], b: readonly T[]): Op<T>[] {
  const n = a.length
  const m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Op<T>[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'equal', a: a[i], b: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'del', a: a[i] })
      i++
    } else {
      ops.push({ kind: 'ins', b: b[j] })
      j++
    }
  }
  for (; i < n; i++) ops.push({ kind: 'del', a: a[i] })
  for (; j < m; j++) ops.push({ kind: 'ins', b: b[j] })
  return ops
}

type Group<T> = { kind: 'equal'; a: T[] } | { kind: 'change'; a: T[]; b: T[] }

/** 连续 equal 合一组；相邻的 del / ins 合成一组 change（顺序无关，输出时统一为 旧→新） */
function groups<T>(ops: Op<T>[]): Group<T>[] {
  const out: Group<T>[] = []
  for (const op of ops) {
    const last = out.at(-1)
    if (op.kind === 'equal') {
      if (last?.kind === 'equal') last.a.push(op.a)
      else out.push({ kind: 'equal', a: [op.a] })
    } else {
      const g = last?.kind === 'change' ? last : { kind: 'change' as const, a: [] as T[], b: [] as T[] }
      if (g !== last) out.push(g)
      if (op.kind === 'del') g.a.push(op.a)
      else g.b.push(op.b)
    }
  }
  return out
}

/** 输出片段：原文 / 改动（a 旧 b 新；fresh = 本次产生，可与相邻 fresh 合并；旧文既有标记 fresh=false 原样保留为独立一条） */
type Seg = { plain: string } | { a: string; b: string; fresh: boolean }

/** 光标所处的旧文标记区域 */
type Ctx = 'plain' | 'ins' | 'del' | 'subA' | 'subB'

/**
 * 字符级：旧文标记记号为原子 token 参与 LCS；改动按所在区域折算（见文件头）。
 * 夹在两处新改动之间的单个相同字符并入改动（"{~~a~>b~~}c{~~d~>e~~}" → "{~~acd~>bce~~}"），标记更少更好读。
 */
function diffLine(oldLine: string, newLine: string): string {
  if (oldLine === newLine) return newLine
  const segs: Seg[] = []
  let ctx: Ctx = 'plain'
  let cur: { a: string; b: string; fresh: false } | null = null
  let afterClose = ''

  const pushSeg = (s: Seg) => {
    const last = segs.at(-1)
    if ('plain' in s) {
      if (!s.plain) return
      if (last && 'plain' in last) last.plain += s.plain
      else segs.push(s)
      return
    }
    if (!s.a && !s.b) return
    if (s.fresh && last && !('plain' in last) && last.fresh) {
      last.a += s.a
      last.b += s.b
      return
    }
    const prev2 = segs.at(-2)
    if (s.fresh && last && 'plain' in last && [...last.plain].length === 1 && prev2 && !('plain' in prev2) && prev2.fresh) {
      segs.pop()
      prev2.a += last.plain + s.a
      prev2.b += last.plain + s.b
      return
    }
    segs.push(s)
  }
  const closeCur = () => {
    if (cur) pushSeg(cur)
    cur = null
    ctx = 'plain'
    if (afterClose) pushSeg({ a: '', b: afterClose, fresh: true })
    afterClose = ''
  }
  const openCur = (c: Ctx) => {
    cur = { a: '', b: '', fresh: false }
    ctx = c
  }
  /** 旧文里的记号（equal / del 都算旧文有）：驱动区域状态；不合语法位置的记号当普通字符 */
  const oldMark = (t: string): boolean => {
    if (ctx === 'plain' && (t === '{++' || t === '{--' || t === '{~~')) {
      openCur(t === '{++' ? 'ins' : t === '{--' ? 'del' : 'subA')
      return true
    }
    if ((ctx === 'ins' && t === '++}') || (ctx === 'del' && t === '--}') || (ctx === 'subB' && t === '~~}')) {
      closeCur()
      return true
    }
    if (ctx === 'subA' && t === '~>') {
      ctx = 'subB'
      return true
    }
    return false
  }
  const equal = (t: string) => {
    if (!cur) pushSeg({ plain: t })
    else if (ctx === 'ins' || ctx === 'subB') cur.b += t
    else cur.a += t
  }
  const removed = (t: string) => {
    if (!cur) pushSeg({ a: t, b: '', fresh: true })
    else if (ctx === 'del' || ctx === 'subA') cur.a += t
    // ins / subB：收回自己插入的字
  }
  const added = (t: string) => {
    if (!cur) pushSeg({ a: '', b: t, fresh: true })
    else if (ctx === 'ins' || ctx === 'subB') cur.b += t
    else afterClose += t
  }

  for (const op of lcsOps(tokenize(oldLine), tokenize(newLine))) {
    if (op.kind === 'equal') {
      if (!oldMark(op.a)) equal(op.a)
    } else if (op.kind === 'del') {
      if (!oldMark(op.a)) removed(op.a)
    } else if (!MARK_TOKENS.has(op.b)) {
      added(op.b) // 新文里凭空出现的记号不可信，丢掉
    }
  }
  if (cur) closeCur()
  else if (afterClose) pushSeg({ a: '', b: afterClose, fresh: true })

  let s = ''
  for (const g of segs) {
    if ('plain' in g) s += g.plain
    else s += g.a && g.b ? `{~~${g.a}~>${g.b}~~}` : g.a ? `{--${g.a}--}` : `{++${g.b}++}`
  }
  return s
}
