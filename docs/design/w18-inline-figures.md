# W18 说明书内嵌图（图文混排）设计方案

> 2026-10 Thomas 需求：「为什么附图不能直接插入文档和论文中」→ 批准后实施。
> 目标：说明书正文里可以插图片块（论文式图文混排），供发明人预览/非递交场景阅读。

## 0. 现状与根因

- 附图只活在 `docs/figures.md`（独立第五书），`content.md`/description.md 里写 `![..](figs/x)` **被解析成普通段落字面文本**（ast.py 无 figure 块类型），编辑器里显示的是那一行 markdown 源码。
- `ps_figure` 节点只进 `book='figures'` 的 doc（无 Markdown 形态），description doc 不可放。
- DOCX builder 的 spec 项类型只有 str/("e"|"t"|"c"|"h"|"sub")——description 部分无图渲染路径。

## 1. 语义契约

- **语法**：description.md 独立行 `![alt](figs/<file>){width=N}`（与 figures.md 同语法）→ description 书的 `figure` 块（kind=`figure`，book=`description`）。
- **真源不变**：`figs/` 文件唯一真源；内嵌图块只引用文件，不复制、不进 figures.md、不占「图N」编号（alt 里的「图N」只是文本）。
- **递交边界**：CNIPA 五书结构不变——内嵌图出现在**版面/PDF 预览与 DOCX description 部分**；XML 递交包**剔除**内嵌图（按「图N」引用语义不变），并在导出报告里标注剔除数（诚实口径，不静默）。
- **体检**：内嵌图引用 `figs/` 不存在文件 → 新增 `figures.inline_missing` 提示；其余 numerals/alt 规则不受影响（内嵌图不进 captions_of）。

## 2. 链路改造

| 层 | 文件 | 改动 |
|---|---|---|
| 解析 | `patent_docx/ast.py` | description 块解析认 `![..](..)` 独立行 → `kind='figure'`（file/width/alt attrs，blockId `description/fign`） |
| 解析 | `patent_docx/content.py` | spec item 新增 `("f", file, width_cm)` 元组 |
| 序列化 | `frontend/.../fromBookDoc.ts` | description doc 内 `ps_figure` → `![alt](file){width}` 行 |
| 反解 | `frontend/.../toBookDoc.ts` | description `figure` 块 → `ps_figure` 节点 |
| 编辑 | `LayoutView` slash 菜单 | description 书新增「插图…」项 → figs/ 文件选择 → 插 `ps_figure` |
| 渲染 | figure nodeview | 现有附图书 nodeview 泛化到 description doc（img src=api.figureUrl） |
| DOCX | `patent_docx/builder.py` | `item[0]=="f"` → `b.add_figure(figs/file, alt or '', width)`（复用现方法） |
| XML | `cnipa_xml.py` | description 内嵌图剔除 + 报告计数 |
| 体检 | `preflight.py` | `figures.inline_missing` 规则 |

## 3. 分批

- **批A（本 PR）**：解析+序列化+版面渲染+slash 插入+DOCX description 内嵌（预览链全通）
- **批B**：XML 剔除报告 + `figures.inline_missing` 体检 + 附图删除守卫把内嵌引用计入（figs 文件被引用禁删）

## 4. 风险

- golden/AST 测试需按新块类型扩展（非改断言凑数，是补新覆盖）。
- 「图N」编号语义：内嵌图不占编号；若用户 alt 写「图1」与 figures.md 撞语义 → 文档注明建议 alt 写描述语不写图号（或后续加 lint）。
- 老案卷不含 `![]` 行 → 零行为变化（向后兼容天然成立）。
