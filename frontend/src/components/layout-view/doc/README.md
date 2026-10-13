# layout-view/doc — 整书 ProseMirror 文档契约（W9 prep-contract）

规格：docs/plan/22-w9-word-editing-design.md §2 / 决策 4–5 / 验收 §4。本目录只定义**契约**（schema、转换、差分、写回），不含编辑器 UI（U1–U4 消费）。
不变量总纲：**Markdown 仍是唯一正文真源**；PM doc 是派生视图；任何版面编辑最终落成源码文本变更（块补丁 / PUT docs / Y.Text）。

## 1. `bookSchema.ts`

```ts
export const bookSchema: PsSchema            // withTableRoles(new Schema({ nodes, marks }))
export type  BookBlockKind = 'paragraph'|'table-caption'|'figure-caption'|'section'|'subsection'|'claim'|'equation'|'table'|'code'|'figure'
export type  BookBlockAttrs = { blockId: string | null; kind: BookBlockKind | null }
export function blockAttrsOf(n: PmNode): BookBlockAttrs
```

- `doc: block+`，一个 doc = **一本书**（abstract / claims / description，或 figures 的图 atom 序列）。`doc.attrs.book` 记书名；
  `lead` / `trail` = 书首块前 / 末块后的空行数（源码事实，fromBookDoc 原样写回）。
- 块节点复用 `structure/edit/schema.ts` 的 ps_para / ps_heading(level 3|4) / ps_equation(atom) / ps_table+ps_row+ps_cell（prosemirror-tables 角色由
  `table/schema.ts withTableRoles` 打上，`ps_header_cell` 同）/ ps_note / ps_code，新增 `ps_claim`（`block+`，权项正文行 = ps_para，公式行 = ps_equation）
  与 `ps_figure`（atom：file / width / alt / num / caption）。每个块节点都有 attrs `blockId`（AST id，如 `claims/3`、`description/12`；权项内的段 / 表注为 null）
  与 `kind`（表题 / 图题只在 kind 上区分，节点仍是 ps_para）。
- **段号 / 权项号 / 图号不进 doc**（`[0001]`、`1.`、「图 1」由 decoration 渲染；权项号由 `ps_claim` 在书内的序号派生，序列化时写回 `n.` 前缀）。
- marks：`strong` / `em` / `underline` / `subscript` / `superscript`；`subscript` 与 `superscript` **互斥**（`excludes` 互相排除），
  下 / 上标带 `attrs.src`（源码 token 原样，如 `{s∈M_t}`、`t,c`、`[k]`），用于逐字节往返。

## 2. `inline.ts`

```ts
export function parseInline(text: string, opts?: { subExcept?: readonly string[]; schema?: Schema }): Fragment
export function serializeInline(fragment: Fragment | readonly PmNode[]): string
export function scriptSource(sigil: '_' | '^', text: string, src: string | null): string
```

语法与后端逐字一致（INLINE_SPEC）：`**粗体**`→strong，`*斜体*`→em，`<u>…</u>`→underline，`_x`/`_{…}`/`_[…]`→subscript（builder.py `_SUB_RE`，
`subExcept` = settings.sub_except 白名单），`^x`/`^{…}`→superscript。规则：`**` 优先于 `*`；`*`/`**` 内侧不得是空白；可嵌套（`**a_{2}**`、`**<u>a</u>**`）；
em 内不再解析 `*`；下 / 上标内容不再解析；未闭合记号按字面；**只接受单行**（标记不跨行）。调用方负责：`$$` 公式行 / 表格分隔行 / `###` 前缀不进
parseInline；CriticMarkup 先 critic.accept/reject 再 tokenize。
序列化：strong > em > underline 规范嵌套（PM mark 集无序，`<u>**a**</u>` 写成 `**<u>a</u>**`，语义相同）；下 / 上标：`src` 与文本一致则原样，
否则单个字母数字写 `_x`，其余写 `_{…}`。
不变量：对规范嵌套的任意单行 s，`serializeInline(parseInline(s)) === s`；`parseInline(serializeInline(f))` 与 f 逐节点相等。

## 3. `toBookDoc.ts` / `fromBookDoc.ts`

```ts
export type BookDocName = BookName | 'figures'
export function toBookDoc(ast: Ast, book: BookDocName, content: string, opts?: InlineOptions): PmNode
export function fromBookDoc(doc: PmNode): string          // 整书 Markdown（书正文，不含 `## 书名` 标题行）
export function bookBlocks(doc: PmNode): BookBlockLines[] // [{ id, kind, start, end }] 书相对 1-based 行区间（与 findBlockLines 同坐标）
```

- 块的身份 / 顺序 / 行范围来自 AST（`store/blocks.findBlockLines`）；文本来自 AST 字段（与 structure/edit/serialize 同源，golden 已证与源码行逐字节一致）；
  `lead`/`trail` 从 `splitBooks(content).books[book].text` 量得。
- 空行 / 块间距规则与 backend patch.py `serialize_block` 一致：块内无空行，**块间恒为一个空行**；表格 = 表题（可选）+ GFM 行 + 表注（可选）为一块；
  权项 = `n.` 首行 + 后续行（公式行 `$$…$$`）。源码里多余的块间空行往返时归一（examples/ 两案无此情形）。
- **golden**（`__tests__/bookDoc.golden.test.ts`）：两案（method / system）× 三书 `fromBookDoc(toBookDoc(ast, book, content)) === splitBooks(content).books[book].text`
  逐字节；第四书 figures：`ps_figure` atom 与 `ast.figures` 一一对应，**无 Markdown 形态**（docs/figures.md 由 `PUT /figures` 逐图改写），`fromBookDoc` 对 figures 抛错。

## 4. `bookDiff.ts`

```ts
export type BookDiff = { kind: 'none' } | { kind: 'block'; id: string; markdown: string } | { kind: 'multi' }
export function bookDiff(oldMd: string, newMd: string, ast: Ast, book: BookName): BookDiff
```

按行公共前后缀取旧文变化区间；区间完全落在**一个** AST 块的行范围内（含行内格式、块内增删行）→ `block`（markdown = 该块新源码，首尾无空行）；
块内出现新空行（拆段）/ 触及块间空行（并段）/ 跨块 / 新增或删除块 / 两处相隔改动 → `multi`。任何不确定都退到 `multi`（整书 PUT 永远正确）。

## 5. `store/layoutView.ts` — `saveBook`

```ts
// store 入口（doc.ts）：saveBook(book) 保持 R4 语义；带 newMd 即委托 layoutView.saveBookDoc
saveBook(book: BookName, newMd?: string, opts?: { review?: boolean }): Promise<boolean>
saveBookDoc(book: BookName, newMd: string, opts?: { review?: boolean }): Promise<boolean>
bookDoc: { book; doc; sourceMd } | null;  setBookDoc()
bookSha: Partial<Record<BookName, string>>;  setBookSha(book, sha)   // GET /docs/{book}.sha → PUT base_sha
export const CONFLICT_TOAST = '内容已被他人修改'
export function registerCollabBookWriter(w: (pid, book, bookText, fullContent) => boolean)
```

1. `bookDiff(oldMd, newMd)`：`none` → true；
2. `review=true`：变化块 old→new 经 `layout-view/mode/toCritic` 生成 CriticMarkup（`block` 时对该块；`multi` 时对整书，toCritic 按行 LCS，块边界由空行保持）；
3. 协同在线（`selectCollabActive`）：**不走 HTTP**，注册的写入器（`collab/useCollabMirror.writeCollabBook`）对该书 Y.Text（无书房间则 content 房间）
   `applyMinimal` diff-apply —— 与源码视图同一条路，服务端去抖落盘后经房间下发；Y.Text 模型不变；无房间可写时退回 `setContent`；
4. `block` → 既有 `patchBlock(id, markdown)`（乐观替换 / 失败回滚规则同 blocks.ts）；
5. `multi` → 乐观 `setContent(replaceBook(content, book, bookText))` → `api.putDoc(pid, book, { content, base_sha })` → 以返回 `ast/content/sha` 为准
   （旧后端无返回则 saved 只换本书并 scheduleAst）；失败回滚 content/saved；**409 → toast「内容已被他人修改」+ GET /projects/{pid} 刷正文 + loadAst(fromDisk)**。

`lib/api.ts`：`putDoc(id, book, { content, base_sha? }) → PutDocResult { ok, backup, backups, ast?, content?, changed_lines?, sha? }`；
`DocBook { content, offset, sha? }`（prep-kernel 落地后对齐）。

## 6. 集成要求（U1–U4）

- 编辑器只持有 `bookDoc.doc`；保存 = `fromBookDoc(view.state.doc)` → `saveBook(book, md, { review: selectEditorMode(s) === 'review' })`。
- 新建块时 `blockId=null`（bookDiff 会判 `multi`，PUT 后以返回 AST 重建 doc）；不得在 doc 文本里写段号 / 权项号。
- 下 / 上标输入命令创建 mark 时不设 `src`（序列化走 `_x` / `_{…}` 规则）。
- 表格编辑经 prosemirror-tables 命令；`collapseMerges` / `expandMerges`（table/gfm.ts）已按节点自身 schema 取类型，可直接用于 bookSchema。
