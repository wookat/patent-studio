# -*- coding: utf-8 -*-
"""生成 基于指纹信息的区块链电子钱包的私钥生成方法及系统（CN109840487A，已公开专利）申请 Word 文档；排版由 patent_docx 完成。"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from patent_docx import build_patent

CONFIG = {
    "content_md": os.path.join(HERE, "content.md"),
    "out": os.path.join(HERE, "申请文件-基于指纹信息的区块链电子钱包的私钥生成方法及系统.docx"),
    "figs_dir": os.path.join(HERE, "figs"),
    "abstract_figure": ("fig1.png", 14.5),
    "spec_figures": [("fig1.png", 15.0),
                     ("fig2.png", 15.0),
                     ("fig3.png", 15.0)],
}

if __name__ == "__main__":
    build_patent(CONFIG)
