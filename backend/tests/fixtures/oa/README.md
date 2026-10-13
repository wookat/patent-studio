# OA PDF fixtures（W5 oa-import-backend）

- `oa_text.pdf`：带文本层的审查意见通知书样例（手写 PDF，Helvetica，英文三条意见），用于 `POST /oa/parse` 的 PDF 文本抽取路径。
- `oa_scan.pdf`：无文本层（仅一张空白图）的扫描件样例，`POST /oa/parse` 返回 400 `oa.pdf_no_text`。
- `notice_synthetic.md` → `notice_synthetic.pdf`：合成中文一通（3 条意见：新颖性 / 创造性 / 不清楚；引用对比文件 1、2），
  经 LibreOffice 转 PDF，pypdf 可抽出中文文字层；用于 claims / refs / kind / confidence 与轮次挂接用例。

前两个文件由 `python3 make_fixtures.py` 生成（确定性，无时间戳）；合成夹具用 `python3 make_fixtures.py --synthetic`
（需 soffice，输出含 LibreOffice 版本 / 时间戳，改 md 后重生成即可）。不要手改 PDF。
