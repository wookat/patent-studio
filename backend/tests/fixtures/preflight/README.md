# preflight 人为造错样例（docs/plan/05-r2-figures-preflight-design.md §4.3）

| 文件 | 造错 | 预期规则 |
|---|---|---|
| cycle.md | 权3↔权4 互相引用 | claims.cycle（error）+ claims.forward_ref（权3） |
| numerals.md | 101 两个名称；图例 102 定义两次 | numerals.inconsistent、numerals.legend_conflict |
| figures.md + figures.studio.json | 正文引用图3（只有 2 图）；图2 无题注无引用 | figures.ref_missing、figures.unreferenced、figures.caption_missing |
| support.md | 权1「所述量子纠缠器」说明书无「量子」 | claims.unsupported_term |

全部可被 `parse_ast` 解析（test_r2_prep.py 守着）；不进 make zero-drift。

## w5/（docs/plan/21-w5-spec.md §2.1 R-CHK-02 / R-FIG-02，test_preflight_w5.py）

| 文件 | 造错 | 预期规则 |
|---|---|---|
| w5/form_bad.md | 摘要无问题/效果；权1 无「其特征在于」且含「如图1」；权2「最先进」；发明内容在背景技术前且含宣传语 | abstract.elements_missing、claims.no_characterized、claims.figure_ref、claims.promo_wording、spec.section_order、spec.promo_wording |
| w5/form_missing.md | 说明书缺背景技术、附图说明（无附图故不要求） | spec.section_missing（error） |
| w5/form_ok.md | 五段齐全有序、摘要四要素、独权两部分式、「最佳实施」惯用语 | 无新增 code |
| w5/marks.md + marks.figures.md | 图1 表有 103 正文未用；正文 104 不在图1 表；图2 表与正文一致 | numerals.mark_not_in_spec、numerals.spec_not_in_marks |
| w5/marks.md + marks_ok.figures.md | 图1 表与正文一致；图2 无表 | 无 |
