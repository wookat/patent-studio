# -*- coding: utf-8 -*-
"""R2/R2.5 prep 骨架：preflight fixture 可解析、设计文档中的两案基线事实（05-r2 §1）。

figures 路由见 test_figures.py，preflight 见 test_preflight.py。
"""

import json
import os
import re

import pytest

from patent_studio.kernel import figures_md
from patent_studio.kernel.ast import parse_ast

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EXAMPLES = [os.path.join(ROOT, "examples", d) for d in ("method", "system")]
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "preflight")


def _load(d):
    with open(os.path.join(d, "content.md"), encoding="utf-8") as f:
        text = f.read()
    with open(os.path.join(d, "studio.json"), encoding="utf-8") as f:
        return parse_ast(text, json.load(f), figures=figures_md.read(d))


@pytest.mark.parametrize("name", ["cycle.md", "numerals.md", "figures.md", "support.md"])
def test_preflight_fixtures_parse(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        text = f.read()
    settings = None
    if name == "figures.md":
        with open(os.path.join(FIXTURES, "figures.studio.json"), encoding="utf-8") as f:
            settings = json.load(f)
    ast = parse_ast(text, settings)
    assert ast["claims"] and ast["description"]
    if name == "cycle.md":
        assert ast["claims"][2]["refs"][0]["targets"] == [4] and ast["claims"][3]["refs"][0]["targets"] == [3]
    if name == "figures.md":
        assert [f["num"] for f in ast["figures"]] == [1, 2] and ast["figures"][1]["caption"] is None


@pytest.mark.parametrize("d,nfig", [(EXAMPLES[0], 3), (EXAMPLES[1], 6)])
def test_examples_figure_refs_baseline(d, nfig):
    """05-r2 §1 E1/E2：两案每图都被「图N」引用；无越界引用。
    新语料（b12a541）附图说明均无题注 → figures.caption_missing 属真命中，显式记录。"""
    ast = _load(d)
    assert len(ast["figures"]) == nfig and all(f["caption"] is None for f in ast["figures"])
    nums = set()
    for b in ast["description"]:
        if b["kind"] == "paragraph":
            nums.update(int(m) for m in re.findall(r"图(\d+)", b["text"]))
    assert nums == set(range(1, nfig + 1))


@pytest.mark.parametrize("d", EXAMPLES)
def test_examples_claims_baseline(d):
    """05-r2 §1 E3：两案无前向引用、无循环；新语料（b12a541）两案均无多引多引权项。"""
    ast = _load(d)
    targets = {c["num"]: sorted({t for r in c["refs"] for t in r["targets"]}) for c in ast["claims"]}
    for c in ast["claims"]:
        if c["claim_kind"] == "dependent":
            assert all(t < c["num"] for t in targets[c["num"]]), c["num"]
    dependent = {c["num"] for c in ast["claims"] if c["claim_kind"] == "dependent"}
    multi = {n for n, t in targets.items() if len(t) > 1 and n in dependent}
    multi_multi = sorted(n for n in multi if any(t in multi for t in targets[n]))
    assert multi_multi == []
