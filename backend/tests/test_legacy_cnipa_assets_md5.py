# -*- coding: utf-8 -*-
"""CNIPA 资产冻结门禁（docs/plan/21 §1.4 Q2 / §5.4）：
patent_studio/kernel/cnipa_dtd 下的 DTD / XSL 逐字节与 tests/golden/cnipa_assets_md5.json 一致；
tagged PDF 开关（lo.docx_to_pdf tagged=…）绝不能改变 CNIPA XML 走的 docx_to_pdf → pdftoppm 资产栅格路径。
"""

import hashlib
import json
import os

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOLDEN = os.path.join(BACKEND, "tests", "golden", "cnipa_assets_md5.json")
ASSETS = os.path.join(BACKEND, "src", "patent_studio", "kernel", "cnipa_dtd")


def _md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def test_cnipa_assets_match_golden():
    with open(GOLDEN, encoding="utf-8") as f:
        golden = json.load(f)
    actual = {n: _md5(os.path.join(ASSETS, n)) for n in sorted(os.listdir(ASSETS))}
    assert actual == golden, "CNIPA DTD/XSL 资产变了：这是冻结资产，若确属官方更新请同步更新 golden 并说明来源"
