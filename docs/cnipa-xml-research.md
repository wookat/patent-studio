# CNIPA「WORD 转 XML 编辑器」一手拆解与 Patent Studio XML 导出方案（2026-09）

来源：老板给的[工具下载页](https://cponline.cnipa.gov.cn/GzfwYwblGlwhTMVC/GzfwYwblGlwhT/selectToolsById?weihuRid=157)。9 个文件全部下载并实际解包/阅读（安装包 327 MB、V4.3_2_20251218；五书模板 docx；两份用户手册；FAQ；模板说明；格式建议 .doc；两段操作视频逐帧抽样）。**未在 Windows 上安装运行**（本机 Linux），凡涉及运行时行为均标「未验证」。

## 1. 结论

1. **官方工具是 Word VSTO 插件，无法脱离 Windows + Word/WPS 运行**：安装包 = `PatentTool.vsto` + `PatentTool.dll`（.NET 4.6.1 VSTO，依赖 `Microsoft.Office.Tools.Word`、Word COM）+ VC 运行库 + `DocumentFormat.OpenXml.dll`。未发现命令行入口（10 KB 的 `StartWord.exe` 字符串里只有 `config.xml`，推断仅负责拉起 Word 并加载插件；未反编译确认）。→ 不可能把它塞进我们的 Docker。
2. **但目标格式完全公开且很简单**：安装包内 `dtdandxsl.zip` 含官方 `cn-application-body-20080416.dtd`（WIPO ST.36 派生，230 个元素）+ 官方预览用 `showxml.xsl` + `OMML2MML.XSL`。输出是 5 个独立 XML（100001 权利要求书 / 100002 说明书 / 100003 说明书附图 / 100004 说明书摘要 / 100005 摘要附图）+ 各自 jpg 图片目录，打成 zip 上传"专利业务办理系统"。
3. **content.md 的结构与 DTD 一一对应**（`## 权利要求书` 编号段 → `claim/claim-text`；`### 技术领域…具体实施方式` → `technical-field/background-art/disclosure/description-of-drawings/mode-for-invention`；`$$…$$` → `maths`；附图 → `figure/img`）。已用 lxml 按官方 DTD 校验手写的 5 书样例：**4/5 通过**，唯一失败是 DTD 本身 `cn-drawings` 内容模型非确定性（libxml 报 DTD 缺陷，非样例问题）。
4. **因此 Patent Studio 直出 XML 可行且比"DOCX → 官方插件"更稳**：官方插件的绝大多数 FAQ（软回车、页码进正文、浮动图、一段多段号、重复小标题、图片重名）都是"从排版好的 Word 反推结构"的固有问题；我们从结构化源文正向生成，这些问题天然不存在。
5. 剩余风险集中在**局方受理系统的隐性规则**（img 尺寸单位、jpg 300dpi、GB18030 字符集、公式必须同时给图和 MathML？、简单表格用 CALS 还是转图），只能靠一次真实"上传到专利业务办理系统 → 预览"来闭环，需要老板的 CPOnline 账号或一台 Windows 机器跑官方预览插件。

## 2. 安装包拆解（已验证）

```
word转xml-安装包-2025.12.18.zip  (327 MB, sha256 a5a73eda…)
├─ word转xml编辑器.msi / .exe        ← msiextract 解出 217 个文件
├─ .NET Framework 4.6.1 / VSTO 4.0 Runtime / VC_redist.x86
└─ APPDIR/
   ├─ PatentTool.vsto + PatentTool.dll + PatentTool.dll.manifest   ← Word 加载项本体（签名 CN=SIPONET\lijunling）
   ├─ WordToolKit.dll                 ← XML 装配：字符串里有 5 个骨架
   │    <cn-application-body lang="zh" country="CN"><cn-claims/></cn-application-body> …
   │    <!DOCTYPE cn-application-body SYSTEM "/dtdandxsl/cn-application-body-20080416.dtd">
   │    <?xml-stylesheet href="/dtdandxsl/showxml.xsl"?>
   ├─ DocumentFormat.OpenXml.dll      ← 读 docx
   ├─ OMML2MML.XSL                    ← Word 公式 → MathML2（微软官方 XSL）
   ├─ MathTypeGetMML.exe / MT6.dll    ← MathType 公式
   ├─ ChemEditor.exe / NCDK / osra    ← 化学式识别与编辑
   ├─ Tesseract / OpenCvSharp         ← OCR（生僻字、公式图）
   ├─ pdftoppm.exe                    ← 预览：`-f 1 -l 1 -r 300 -jpeg`
   ├─ Template/*.dotx                 ← 8 个单书模板（权利要求书/说明书/附图/摘要/摘要附图/序列表/外观×2）
   ├─ Manual/五书模板文件.docx        ← 同官网五书模板
   ├─ dtdandxsl.zip                   ← 见 §3
   └─ 出版质量单机版/CBQualityDanJi.exe (+JiebaNet 分词)  ← 出版质量检查（未研究）
```

运行要求（手册/FAQ 原文）：Windows 10+，MS Office 2013+ 或 WPS 专业版 2015+，8 GB 内存，5 GB 磁盘。

## 3. 官方 DTD 关键结构（`cn-application-body-20080416.dtd`）

```
cn-application-body[@lang="zh" @country="CN"]
 ├ cn-claims      (p*, claim+)          claim[@num @id @claim-type] > claim-text (#PCDATA|claim-text|claim-ref|b|i|u|sup|sub|br|maths|tables|img…)
 ├ description    (invention-title?, (technical-field|background-art|disclosure|description-of-drawings|mode-for-invention|industrial-applicability|(heading*,p+))+)
 │                 每节 = heading[@level 1-3]*, p+ ;  p[@num REQUIRED @Italic (1|0) REQUIRED]
 │                 p 内联：b i u sup sub br figref patcit nplcit crossref img chemistry maths tables pre …
 │                 maths[@num] > (img | (math|cn-mathf), img?)     tables[@num] > (img | (table|cn-tablef), img?)
 ├ cn-drawings    ((br?, cn-drawing-p*, figure+, pb?), cn-drawing-p*)+   figure[@num REQUIRED @id] > img
 └ cn-abstract    (p*, cn-abst-figure?)   cn-abst-figure > figure+
img[@file REQUIRED @he @wi REQUIRED @img-format (jpg|tif|st33|st35) REQUIRED @img-content @inline @orientation]
```

- 编号约定（DTD 注释）：段 `p/@num="0001"`、图 `figure/@id="f0001" @num="0001"`、标题 `heading/@id="h0001"`。
- `he/wi` 单位：DTD 未写；`showxml.xsl` 以 `@wi*4.25` 作像素宽，推断为 **mm**（ST.36 惯例）。未验证。
- 公式：`MATH_PLACEHOLDER=INCLUDE`（内嵌 MathML2），表格 `TABLE_PLACEHOLDER=IGNORE`（CALS 表未启用）→ 表格实际按 FAQ 走"M×N 简单表可转、复杂表转图"。手册 3.5.4：公式转换时"一次性转换为符合要求的图片，长宽与原对象一致"，并提取 MathML 显示——推断实际提交以 **jpg 图为主、MathML 为辅**。未验证局方是否强制要求 MathML。
- 图片：jpg，300 dpi，≤30 MB，≤16.5 cm × 24.5 cm（FAQ 问题 3/26）。
- 字符集：GB18030-2022 以内，超出者转图（FAQ 问题 2）。

## 4. 五书模板 docx（已拆）

- 5 个 `sectPr`，页眉分别为 `说明书摘要 / 摘要附图 / 权利要求书 / 说明书 / 说明书附图`（顺序与我们不同：我们按 100001→100005 即 权利要求书→说明书→附图→摘要→摘要附图），页脚为 PAGE 域，A4，边距上下 2.54 cm / 左右 3.17 cm（Word 默认，**非** CNIPA 25/25/15/15），正文宋体 + Times New Roman。
- 说明：插件靠"页眉文字 = 书名"切分五书，靠硬回车切段、`[0001]` 识别段号、`1.` 识别权项、`图1` 识别图号（手册 3.4、FAQ 15–21）。我们的 DOCX 页眉也是书名、段号也是 `[0001]` 格式，理论上可直接喂官方插件——**未验证**，需 Windows。

## 5. 与 Patent Studio 的映射（设计草案，SOP-02）

| content.md / `patent_docx` 已解析对象 | XML 目标 | 备注 |
|---|---|---|
| `# 标题` | `description/invention-title` | |
| `## 摘要` 段 | `100004: cn-abstract/p[@num=0001]` | 摘要 ≤300 字校验已有 |
| 摘要附图（设置里已选） | `100005: cn-abstract/cn-abst-figure/figure/img` | 手册 3.3.1 提示"摘要附图改为指定方式不再单独接收"→ 需确认是否仍要 100005（未验证） |
| `## 权利要求书` 每个 `N.` 段 | `100001: claim[@num=N @id=cN]/claim-text` | 段内换行 → `<br/>`；"权利要求X" → `claim-ref[@idref=cX]`（同文件内 IDREF 可校验，跨书引用不做） |
| `### 技术领域/背景技术/发明内容/附图说明/具体实施方式` | `100002: technical-field/background-art/disclosure/description-of-drawings/mode-for-invention`，各含 `heading[@level=1]` + `p[@num]` | 段号连续，与 DOCX 一致 |
| `$$…$$` 公式（现有 OMML 生成器） | `maths[@num]` > `img`(jpg 300dpi, 用 LibreOffice 渲染公式段落) + 可选 `math`(OMML→MathML via 官方 `OMML2MML.XSL`) | 先只出图（与官方插件行为一致），MathML 二期 |
| 下标 `sub_except` 解析结果 | `<sub>`/`<sup>` | 现有解析器直接复用 |
| 表格 | 简单 M×N：先转图（`tables/img`）；CALS 表 DTD 未启用 | 与 FAQ 问题 9 保持一致 |
| `figs/fig*.svg/emf/png` | `100003: figure[@num]/img[@file @he @wi @img-format=jpg]`；svg/emf → jpg 300dpi | 尺寸取设置里的图宽 cm → mm |
| 页眉/页脚/字体/边距 | **不进 XML** | XML 无版式；版式仍由 DOCX/PDF 预览承担 |

产物：`<案子>-xml.zip` = `100001.xml … 100005.xml` + 每书同名图片目录（图片名全案唯一，FAQ 问题 28），每个 XML 带 `<!DOCTYPE … "cn-application-body-20080416.dtd">`。

校验：后端用 lxml 加载随包附带的官方 DTD 做 `dtd.validate`；`cn-drawings` 的 DTD 非确定性错误单独忽略（已复现，是 DTD 缺陷）。前端"XML 预览"可用官方 `showxml.xsl` 做 XSLT → HTML，与局方预览同源。

实现位置：`backend/patent_docx/cnipa_xml.py`（纯函数，输入 `load_md()` 的解析结果 + settings，不触碰 builder.py，零漂移不受影响）+ `POST /api/projects/{pid}/export/xml` + 导出菜单一项 + `check_all` 增加"XML DTD 校验"项。预计一轮（1 个会话）可出可下载的 zip 与本地 DTD 校验通过。

## 6. 已验证 / 未验证

已验证（本机一手）：安装包内容与依赖；DTD 全文与元素/属性约束；五书模板结构；手册/FAQ 全文；lxml 载入官方 DTD 并校验 5 书样例（4 通过，1 为 DTD 自身缺陷）；`WordToolKit.dll` 字符串中的 5 书骨架与 DOCTYPE 写法。

未验证（需 Windows 或 CPOnline 账号）：官方插件对我们现有 DOCX 的识别率；`he/wi` 单位；公式是否必须附 MathML；摘要附图 100005 是否仍需提交；局方上传后的预览/形式审查是否接受我们生成的 XML。**建议老板提供一台 Windows（装 Office）或 CPOnline 测试账号，用方法案跑一次真实上传预览，作为 XML 导出功能的验收门。**

## 7. 下一步（如无异议按此执行）

1. 本轮：把官方 DTD/ENT/XSL 随仓库附带（`backend/patent_docx/cnipa_dtd/`，政府公开标准文件），实现 §5 的 `cnipa_xml.py` + 导出 API + DTD 校验，方法案/系统案各出一份 zip。
2. 验收门：Windows 上用官方插件"XML 导入"读回我们的 XML、或 CPOnline 上传预览；通过后再考虑 MathML 与 CALS 表。
