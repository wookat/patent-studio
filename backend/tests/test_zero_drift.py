# -*- coding: utf-8 -*-
"""零漂移回归：默认设置下两案 word/document.xml 必须与附件原脚本基准逐字节一致。

基准（原环境 python-docx 1.2.0 + 附件代码；本机复现一致）：
  method  f58e308dc5dcb3c594eccd11142691e5
  system  75b57c286a75b32527c301e1c8c700f4
基线刷新：b12a541 换 examples 语料（指纹私钥/神经网络可视化）后重录；
Windows 序列化微差基线待在该平台重录（旧值属已退役语料，已移除）。
"""

import hashlib
import os
import zipfile

import pytest

from app.domain.projects import ProjectStore
from patent_studio.kernel import build_patent
from patent_studio.kernel.builder import build_patent_ex

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = os.path.join(ROOT, "examples")

BASELINE = {
    "method": {"f58e308dc5dcb3c594eccd11142691e5"},
    "system": {"75b57c286a75b32527c301e1c8c700f4"},
}


def _md5_document_xml(path):
    with zipfile.ZipFile(path) as z:
        return hashlib.md5(z.read("word/document.xml")).hexdigest()


def _legacy_config(name, out):
    """与 examples/<name>/build_docx.py 中 CONFIG 完全相同的字典（不含 style）。"""
    here = os.path.join(EXAMPLES, name)
    figs = {
        "method": [("fig1.png", 15.0), ("fig2.png", 15.0), ("fig3.png", 15.0)],
        "system": [
            ("fig1.png", 15.0),
            ("fig2.png", 15.0),
            ("fig3.png", 15.0),
            ("fig4.png", 15.0),
            ("fig5.png", 15.0),
            ("fig6.png", 15.0),
        ],
    }[name]
    return {
        "content_md": os.path.join(here, "content.md"),
        "out": out,
        "figs_dir": os.path.join(here, "figs"),
        "abstract_figure": ("fig1.png", 14.5),
        "spec_figures": figs,
    }


@pytest.mark.parametrize("name", sorted(BASELINE))
def test_legacy_config_matches_baseline(name, tmp_path):
    out = str(tmp_path / f"{name}.docx")
    build_patent(_legacy_config(name, out))
    assert _md5_document_xml(out) in BASELINE[name]


@pytest.mark.parametrize("name", sorted(BASELINE))
def test_studio_json_default_settings_matches_baseline(name, tmp_path):
    """经 Studio 的 studio.json → CONFIG 路径（style 为默认）构建，同样必须零漂移。"""
    store = ProjectStore(EXAMPLES)
    proj = store.get(name)
    cfg = store.build_config(
        proj, out=str(tmp_path / f"{name}.docx"), content_md=os.path.join(EXAMPLES, name, "content.md")
    )
    build_patent_ex(cfg)
    assert _md5_document_xml(cfg["out"]) in BASELINE[name]


def test_style_override_changes_output(tmp_path):
    """反向验证：改动一个 style 项后输出必须变化，证明设置确实驱动内核。"""
    cfg = _legacy_config("system", str(tmp_path / "a.docx"))
    cfg["style"] = {"page": {"margin_left_mm": 30}}
    build_patent_ex(cfg)
    assert _md5_document_xml(cfg["out"]) not in BASELINE["system"]

    cfg2 = _legacy_config("system", str(tmp_path / "b.docx"))
    cfg2["style"] = {"footer": {"year_text": "2026.01"}}
    build_patent_ex(cfg2)
    with zipfile.ZipFile(cfg2["out"]) as z:
        footers = b"".join(z.read(n) for n in z.namelist() if n.startswith("word/footer"))
    assert b"2026.01" in footers and b"2023.03" not in footers
