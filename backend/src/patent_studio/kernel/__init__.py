# -*- coding: utf-8 -*-
"""patent_studio.kernel —— CN 发明专利申请文件（Word）通用生成工具。

内容源：content.md（Markdown，约定见 content 模块 docstring）
排版：五部分（说明书摘要/摘要附图/权利要求书/说明书/说明书附图）各起新页、
     权利要求书与说明书独立页码、说明书段号 [0001] 自动连续编号、
     行内真下标、独立公式 OMML 原生 Word 公式、A4 宋体/黑体版式。

用法：
    from patent_studio.kernel import build_patent
    build_patent(config)   # config 见 builder.build_patent docstring
"""
from .builder import build_patent
from .content import dump_md, load_md

__all__ = ["build_patent", "load_md", "dump_md"]
