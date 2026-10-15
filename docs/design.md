# 知撰（Patent Studio）设计说明

> 目标：给 `patent_docx`（content.md → DOCX 排版内核）套一个"所见即所得"的本地 Web 编辑器 + 可视化设置面板，
> 预览是 **真实 DOCX 经 LibreOffice 转出的 PDF**，默认设置下排版内核输出与原脚本**逐字节一致**。

## 0. 前置调研结论（本机实测，2026-09-03）

| 项 | 结果 |
| --- | --- |
| 原脚本 `python3 build_docx.py`（python-docx 1.2.0） | 方法案 0.43 s，系统案 0.33 s |
| `soffice --headless --convert-to pdf`（LibreOffice 7.3.7，独立 UserInstallation profile） | 方法案 2.5~2.7 s（22 页），系统案 1.9 s（15 页） |
| 单次"build + soffice"端到端 | **≈ 3 s**（远低于预期 5~15 s，仍做 latest-wins 队列合并） |
| 基准 md5（`word/document.xml`） | 方法案 `7d0067e886b3258ec55d53136fb2d760`，系统案 `65b9d56f1c300bdd1bb1f675002c6731` —— **与老板给的参考值完全一致** |
| 字体 | 本机初始无宋体/黑体；LibreOffice 把宋体回退到 AR PL UMing（`pdffonts` 证实），黑体回退到 DejaVu/Noto。后续已把真实 SimSun/SimHei 放入 `fonts/` 并内置到镜像（见 §8） |
| `check_all.py` | 硬依赖老板机器：`~/.fonts/simsun.ttf`（make_figs.py 第 27 行）、`/home/ubuntu/patent_survey/txt`、`corpus_audit.py`；语料审计部分在缺文件时自动降级为"0 条嫌疑"，附图越界检查在缺 simsun.ttf 时抛异常 |

## 1. 架构

```
┌──────────────────────────── 浏览器 (React + TS + Vite) ────────────────────────────┐
│  顶栏：案子切换 │ 保存 │ 构建状态(构建中/已更新/错误 + 耗时) │ 导出 DOCX/PDF │ 回归 │ 设置 │ 主题 │
│  ┌────────────────────────┐ ┌───────────────────────────┐ ┌──────────────────────┐ │
│  │ CodeMirror 6 编辑器     │ │ pdf.js 分页预览            │ │ 设置面板 (Sheet)      │ │
│  │ markdown 高亮/查找替换   │ │ 保持页码+滚动位置          │ │ 表单 ⇄ style JSON     │ │
│  │ 错误行高亮 + 跳转        │ │ 错误面板(可读+行号跳转)     │ │ 导入/导出/恢复默认     │ │
│  └────────────────────────┘ └───────────────────────────┘ └──────────────────────┘ │
│  桌面：左右分栏可拖拽 (react-resizable-panels)；移动端：编辑/预览 Tab 单栏                 │
└────────────────────────────────────────────┬───────────────────────────────────────┘
                                    REST(JSON) │ 防抖 1.2 s，AbortController 取消旧请求
┌────────────────────────────────────────────▼───────────────────────────────────────┐
│ FastAPI (backend/app)                                                              │
│  projects.py  ── 列表/读写 content.md（保存前备份 content.md.bak-时间戳）/ studio.json │
│  builder.py   ── latest-wins 队列：每案 seq 号；拿到锁后若已有更新请求则直接 superseded │
│                  build_patent(CONFIG+style) → out.docx → soffice → out.pdf → stats   │
│  errors.py    ── 异常 → {message, line, hint}（摘要超限/公式解析/缺图/未知章节）       │
│  check.py     ── 拷贝 examples 到临时目录 → 为每案 build → 运行 check_all.py → 输出    │
│  static       ── 生产模式下托管 frontend/dist                                        │
└────────────────────────────────────────────┬───────────────────────────────────────┘
                                             │ import
┌────────────────────────────────────────────▼───────────────────────────────────────┐
│ backend/src/patent_studio/kernel（排版内核，原代码 + 参数化）                                        │
│  style.py   DEFAULT_STYLE（全部原硬编码值）+ merge_style(overrides)                    │
│  builder.py PatentBuilder(style=...)；build_patent(CONFIG) 向下兼容（无 style 键=默认） │
│  content.py / omml.py 不改                                                           │
└────────────────────────────────────────────────────────────────────────────────────┘
                     LibreOffice(soffice --headless) + 开源中文字体(AR PL UMing/WQY) + fontconfig 兜底别名 → Dockerfile
```

目录：

```
backend/src/patent_studio/kernel/   排版内核（可被 examples/*/build_docx.py 通过 examples/patent_docx 符号链接原样导入）
backend/app/           FastAPI
backend/tests/         pytest：零漂移 md5 回归 + API 测试
examples/method|system 示例案子（content.md + figs/ + build_docx.py + make_figs.py + studio.json）
examples/check_all.py  原回归脚本（原样，相对路径 method/ system/ 在 examples/ 下成立）
frontend/              Vite + React + TS + Tailwind + shadcn/ui
docker/fonts-cjk-alias.conf  缺字体时 宋体/黑体 → UMing/WQY 别名（用户可自装授权字体覆盖）
```

## 2. 数据模型

一个"案子" = `PROJECTS_DIR/<id>/`：

- `content.md` —— 正文源（唯一事实）
- `figs/` —— 附图
- `studio.json` —— 该案配置（= 原 `build_docx.py` 的 CONFIG 去掉路径 + `style` 覆盖项）：

```json
{
  "abstract_figure": ["fig1.emf", 14.5],
  "spec_figures": [["fig1.emf", 15.0], ["fig2.emf", 15.0]],
  "sub_except": ["tsf_guard", "on_matured"],
  "abstract_limit": 300,
  "style": { "page": { "margin_left_mm": 25 } }     // 只存与默认不同的项（部分覆盖）
}
```

- `.studio/builds/<build_id>/out.docx|out.pdf` —— 预览产物（gitignore）
- `content.md.bak-YYYYmmdd-HHMMSS` —— 保存前自动备份（与现有习惯一致）

## 3. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | LibreOffice 版本、python-docx 版本、字体情况 |
| GET | `/api/projects` | `[{id, title, has_studio_json}]` |
| POST | `/api/projects` | `{id, title}` 新建空案子（模板 content.md） |
| GET | `/api/projects/{id}` | `{id, title, content, settings, figs:[{name, preview_url}]}` |
| PUT | `/api/projects/{id}/content` | `{content}` → 备份 + 写回；返回 `{backup}` |
| GET | `/api/projects/{id}/backups` | 备份列表 |
| GET/PUT | `/api/projects/{id}/settings` | 读/写 `studio.json`（PUT 校验 schema） |
| GET | `/api/settings/defaults` | 默认 style（供"恢复默认"/表单默认值） |
| POST | `/api/projects/{id}/build` | `{content?, settings?}` 用草稿内容+草稿设置构建；返回 `{ok, build_id, pdf_url, docx_url, stats:{abstract_chars, claims, paragraphs, pages}, timings:{build_ms, soffice_ms, total_ms}}` 或 `{ok:false, error:{message, line, hint}}`；被更新请求取代时 `{superseded:true}` |
| GET | `/api/projects/{id}/builds/{build_id}/out.pdf|out.docx` | 预览产物 |
| GET | `/api/projects/{id}/export?fmt=docx|pdf` | 用**已保存**内容+设置构建并以 `申请文件-<发明名称>.docx|pdf` 下载 |
| GET | `/api/projects/{id}/figs/{name}` | 附图文件（emf 无法在浏览器显示，面板缩略图优先取同名 png/svg） |
| POST | `/api/check` | 运行 `check_all.py`，返回 `{exit_code, stdout, duration_ms}` |

## 4. 设置项 ⇄ builder 参数映射

`DEFAULT_STYLE`（backend/src/patent_studio/kernel/style.py）——每一项的默认值就是原 builder.py 的硬编码值；
默认下 `build_patent(CONFIG)` 输出与原代码逐字节相同。

| 设置项（UI） | style 键 | 原 builder.py 位置 / 硬编码值 |
| --- | --- | --- |
| 正文中文字体 | `fonts.body_cjk` | `SONG = "宋体"` |
| 标题/页眉/页脚/段号中文字体 | `fonts.heading_cjk` | `HEI = "黑体"` |
| 西文字体 | `fonts.ascii` | `set_font` 默认 `"Times New Roman"` |
| 页眉/页脚/段号西文字体 | `fonts.label_ascii` | `ascii_name="SimHei"` |
| 伪代码等宽字体 | `fonts.mono` | `"Courier New"` |
| 正文字号 | `sizes.body` | `para(size=12)`、`num_para(size=12)` |
| 发明名称字号 | `sizes.title` | `b.para(title, size=14, ...)` |
| 章节标题 `###`/小节 `####` 字号 | `sizes.section_heading` / `sizes.subsection_heading` | `size=12` |
| 页眉字号 | `sizes.header` | `set_font(run, HEI, 14, ...)` |
| 页脚编号/年份字号 | `sizes.footer` | `set_font(r1, HEI, 9, ...)` |
| 页码字号 | `sizes.page_number` | `set_font(run, SONG, 10.5)` |
| 段号 `[0001]` 字号 | `sizes.para_number` | `set_font(run, HEI, 10.5, ...)` |
| 表格文字字号 | `sizes.table` | `add_math_text(p, txt, SONG, 10.5, ...)` |
| 公式字号 | `sizes.equation` | `append_omml(mid, text, 12)`、编号 `set_font(run, SONG, 12)` |
| 伪代码字号 | `sizes.code` | `Pt(10.5)` |
| 行距 | `paragraph.line_spacing` | `line_spacing = 1.3`（para/num_para/equation/pseudocode） |
| 首行缩进 pt | `paragraph.first_indent_pt` | `first_indent=24` |
| 段后间距（正文/标题/权项等） | `paragraph.space_after.*` | `space_after=6/8/12/4/8/2/0` |
| 页边距 mm（左25 上25 右15 下15） | `page.margin_{left,top,right,bottom}_mm` | `a4()` 的 `Cm(2.5)/Cm(1.5)` |
| 页眉距顶 / 页脚距底 | `page.header_distance_cm` / `page.footer_distance_cm` | `Cm(1.4)` / `Cm(0.2)` |
| 纸张 | `page.width_cm/height_cm` | `Cm(21.0)/Cm(29.7)` |
| 行网格 linePitch / 默认制表位 | `page.line_pitch` / `page.default_tab_stop` | `312` / `420` |
| 页眉文字（五部分标签） | `header.labels.{abstract,abstract_figure,claims,description,figures}` | `"说明书摘要"…` |
| 页眉字间距（≤3字 / >3字） | `header.spacing_short` / `header.spacing_long` | `"130"/"90"` |
| 页眉横线粗细/间距 | `header.rule_sz` / `header.rule_space` | `w:sz=8`, `w:space=6` |
| 页脚表格编号 100001~100005 | `footer.codes.{...}` | `PART_CODES` |
| 页脚年份文字 | `footer.year_text` | `"2023.03"` |
| 页脚横线粗细/间距 | `footer.rule_sz` / `footer.rule_space` | `w:sz=8`, `w:space=3` |
| 摘要字数上限 | `abstract_limit`（顶层） | `config.get("abstract_limit", 300)` |
| 各附图宽度 cm / 摘要附图 | 顶层 `spec_figures` / `abstract_figure` | 原 CONFIG 字段 |
| 表格默认样式（三线/重复表头/段号居左） | `table.defaults` | content.md 内 `<!-- 表格: … -->` 未声明时的默认值（原为全 False） |
| 表格单元段后 / 三线表线宽 | `table.cell_space_after` / `table.rule_outer_sz` / `table.rule_head_sz` | `Pt(2)`、`12`、`6` |
| 公式两侧留白 cm | `equation.side_cm` | `Cm(2.2)` |
| 下标解析例外 | 顶层 `sub_except` | `DEFAULT_SUB_EXCEPT` |

## 5. 零漂移回归方案

1. 基准：`examples/*/build_docx.py`（原脚本，不改）在本机产出的 `word/document.xml` md5 = 老板给的参考值（已验证一致）。
2. `backend/tests/test_zero_drift.py`：对两案分别用 (a) 原 `build_docx.py` 的 CONFIG、(b) `studio.json`（默认 style）经 Studio 的 build 路径，
   断言 `word/document.xml` md5 等于常量 `7d0067e8…` / `65b9d56f…`。任何 builder.py 改动都跑这条测试。
3. 另有反向测试：改一个 style 项（如左边距）后 md5 必须变化，证明设置确实驱动了内核。
4. `make zero-drift` 打印两案 md5 与基准对照，作为交付证据。

## 6. 构建管线与并发

- 前端：编辑停顿 1.2 s → `POST /build`（携带草稿 content + 草稿 settings）；新一轮触发时 `AbortController` 取消上一请求。
- 后端：每案维护 `seq`；请求进入时 `seq += 1` 记为 `mine`；等待全局构建锁；拿到锁后若 `mine < latest` 则直接返回 `superseded`（队列合并，只跑最后一次）。
- 构建在线程池执行：`build_patent` → 写 `.studio/builds/<id>/out.docx` → `soffice --headless -env:UserInstallation=<独立 profile> --convert-to pdf` → `pypdf` 统计页数。
- 保留最近 3 个 build 目录。
- 预览：pdf.js 加载新 PDF 后按页在原 canvas 上重绘，容器不重建 → 页码与滚动位置天然保持；页数变化只增删末尾 canvas。

## 7. 错误定位

| 异常 | 显示 | 行号 |
| --- | --- | --- |
| `AssertionError: 摘要超过300字：312` | 摘要超限（312/300） | `## 摘要` 后第一非空行 |
| OMML 解析异常（builder.equation 内包装成 `EquationError(formula)`） | 公式解析失败 + 原式 | 含 `$$<formula>$$` 的行 |
| `KeyError('附图说明')`（未知 `##` 节） | 未知章节 | 对应 `## ` 行 |
| `FileNotFoundError`（附图缺失） | 缺图 + 文件名，提示到设置面板 | — |
| 其他 | 异常类型 + 消息 + 最后一帧 | — |

## 8. 字体与渲染差异说明

DOCX 内声明的字体仍是 宋体/黑体/SimHei/Times New Roman（与递交件一致）。预览用 LibreOffice 渲染，字体来源分三级
（`docker/fonts-cjk-alias.conf`，`<accept>` 别名只在缺字体时生效）：

| 级别 | 宋体 | 黑体 | hhea 行高 | 实测方法案/系统案页数 |
| --- | --- | --- | --- | --- |
| 1. 用户自装的授权字体（历史上曾随仓 fonts/，已移除；自装到 ~/.fonts 或系统目录即可命中） | SimSun | SimHei | 1.00 em | **22 / 15**（本机 LO 7.3.7）；21 / 15（容器 LO 7.4.7） |
| 2. 开源替身（缺真实字体时） | AR PL UMing CN | WenQuanYi Micro Hei | 1.05 / 1.17 em | 22 / 15（LO 7.3，字形不同） |
| 3. Noto Serif/Sans CJK（仅 Unicode 兜底） | — | — | 1.44 em | **36** / — （不可作正文替身） |

结论（fontTools 读取 hhea + LibreOffice 实测）：LibreOffice 的"1.3 倍行距"按字体自身行高倍乘，Noto CJK 行高比 SimSun 高 44%，
用它当正文替身会把方法案撑到 36 页，因此最初设计里"宋体→Noto Serif CJK"的方案被推翻；开源版本不再随仓分发 SimSun/SimHei，
默认落在第 2 级开源替身（页数与真实字体一致，字形不同），用户自装授权字体后经 `<accept>` 别名自动回到第 1 级。
Word 的真实页数未在本环境实测（无 Word）；LO 7.3 与 7.4 分页有 1 页差异。西文 Times New Roman / Courier New 仍用度量兼容的 Liberation Serif / Mono。
