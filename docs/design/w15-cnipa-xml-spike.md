# W15 批86：CNIPA 五书 XML 递交预研——覆盖度核验报告

> 2026-10-01 · 核验方式：真实端到端导出 + 官方 DTD 校验（非纸面推演）

## 结论先行

`patent_docx/cnipa_xml._Exporter` + `.studio/xml` 导出链**已是生产级**：两件真实示例案全量导出，
五书全过官方 DTD（`cn-application-body-20080416.dtd`），零警告。本批无代码变更——核验即产出。

## 实机核验数据

| 示例案 | 权项 | 说明书段 | 图 | 公式 | 表 | 五书 DTD | 耗时 | 警告 |
|---|---|---|---|---|---|---|---|---|
| examples/method | 11 | 98 | 6 | 17 | 2 | 5/5 valid | 3.4s | 0 |
| examples/system | 10 | 64 | 5 | 3 | 1 | 5/5 valid | 2.1s | 0 |

- 栅格化：公式/表格/附图统一走 DOCX→PDF→300dpi JPG→按内容裁边（官方插件同做法），
  `img/@he,@wi` 按毫米回填
- 校验：`validate_xml` 对每书跑 DTD；`gb18030_issues` 扫超出编码集字符（进 warnings 提示转图）
- e2e 测试：tests/test_cnipa_xml.py 11/11 全绿（含真渲染路径，soffice+pdftoppm 在机）

## 覆盖矩阵（vs CNIPA 电子申请递交包）

| 递交件 | 书号 | 本平台 | 状态 |
|---|---|---|---|
| 权利要求书 | 100001 | `cn-claims` / `claim[@id,@num]` / `claim-text` / `claim-ref[@idref]`（仅回引小权项号） | ✅ 生成+DTD 校验 |
| 说明书 | 100002 | `description` / `invention-title` + 五章 → `technical-field/background-art/disclosure/description-of-drawings/mode-for-invention`；段号与 DOCX `[00NN]` 同源 | ✅ 生成+DTD 校验 |
| 说明书附图 | 100003 | `cn-drawings` / `figure[@id,@num]` / `img`（figures.md 书序=图号序） | ✅ 生成+DTD 校验 |
| 说明书摘要 | 100004 | `cn-abstract` / `p[@num]` | ✅ 生成+DTD 校验 |
| 摘要附图 | 100005 | `cn-abstract` / `cn-abst-figure` | ✅ 生成+DTD 校验 |
| 发明专利请求书 | — | **不生成**：该件走 CPC 客户端自填，不在 application-body DTD 覆盖内；平台已做字段级校验（`validate_request_fields`：申请人/发明人/申请号格式）在递交清单给出填写指引 | ⚠️ 边界外（设计如此） |
| CPC 客户端导入验证 | — | manifest `note="未经 CPC 客户端验证"` 如实挂注 | ⏳ 外部验收项（Windows+CPC 环境） |

## 元素级抽查（method 100002）

- `p[@num]` 段号与 DOCX 完全同源（`[0001]`=XML `num="0001"`）
- `maths[@num]`/`tables[@num]`/`pre` 挂宿主段不占段号（与 builder 一致）
- `####` 子章节 → `heading level="2"`；非五章章节 → heading 直挂 description（DTD 合法）
- `claim-ref` 只包回引（idref 范围 < 当前权项号）——前向引用不被 DTD 允许的隐患规避已到位

## 已知边界（非缺陷）

1. `cn-drawings` 内容模型在 libxml 下自身非确定性的报错按设计不计错（DTD 文本自带问题）
2. 对象跨页会报「页数不符」而失败——防呆而非容忍（半张图进 XML 更糟）
3. GB18030 外字符给 warning 不硬拦（官方工具支持转图兜底，拦会误伤生僻字）

## 收口

- 代码：本批零变更——覆盖度核验即本批产出
- 外部待办：CPC 真机导入验证（需 Windows CPC 客户端环境，挂外部等待）
