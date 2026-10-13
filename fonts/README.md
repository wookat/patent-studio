# fonts/

**本仓库不分发字体文件。** 历史上此处曾随仓携带宋体/黑体/Times New Roman 等受限字体，已移除；
开源版本一律使用开源字体，DOCX 内写入的字体名（`宋体` / `黑体` / `Times New Roman` / `Cambria Math` /
`Courier New`）保持不变——字体名只是引用，最终 Word/WPS 端用本机真实字体打开，排版不受影响。

LibreOffice 转 PDF 预览的字体策略由 `docker/fonts-cjk-alias.conf` 声明：

| DOCX 字体名 | 开源替身（Debian 包） | 度量 |
|---|---|---|
| 宋体 / SimSun / 仿宋 / 楷体 | AR PL UMing CN（`fonts-arphic-uming`）→ Noto Serif CJK 兜底 | 行高 1.05 em |
| 黑体 / SimHei | WenQuanYi Micro Hei（`fonts-wqy-microhei`）→ Noto Sans CJK 兜底 | 行高 1.17 em |
| Times New Roman | Liberation Serif（`fonts-liberation2`） | 度量兼容 |
| Courier New | Liberation Mono | 度量兼容 |
| Arial | Liberation Sans | 度量兼容 |
| Cambria / Cambria Math | Caladea（`fonts-crosextra-caladea`）/ Liberation Serif | 度量兼容 |
| Symbol | OpenSymbol（`fonts-opensymbol`） | — |

- 别名用 `<accept>` 而非 `<prefer>`：**用户自装的授权真字体会自动优先**。
  想要与 Word 完全相同的预览字形，把自己持有授权的 SimSun/SimHei 等放入 `~/.fonts` 再 `fc-cache -f` 即可。
- `make fonts` 只安装别名配置；Dockerfile 已改装 Debian 开源字体包。
- 验证：`pdffonts out.pdf` 应出现 `UMingCN`/`WenQuanYiMicroHei`/`LiberationSerif`；若出现 `SimSun`/`SimHei`
  说明命中了本机自装的授权字体，属预期。
