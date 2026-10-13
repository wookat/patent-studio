# -*- coding: utf-8 -*-
"""生成 神经网络模型的可视化建模方法和装置（CN109002879B，已公开专利）申请 Word 文档；排版由 patent_studio.kernel 完成。"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from patent_studio.kernel import build_patent

CONFIG = {
    "content_md": os.path.join(HERE, "content.md"),
    "out": os.path.join(HERE, "申请文件-神经网络模型的可视化建模方法和装置.docx"),
    "figs_dir": os.path.join(HERE, "figs"),
    "abstract_figure": ("fig1.png", 14.5),
    "spec_figures": [("fig1.png", 15.0),
                     ("fig2.png", 15.0),
                     ("fig3.png", 15.0),
                     ("fig4.png", 15.0),
                     ("fig5.png", 15.0),
                     ("fig6.png", 15.0)],
}

if __name__ == "__main__":
    build_patent(CONFIG)
