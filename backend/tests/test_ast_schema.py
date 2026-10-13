# -*- coding: utf-8 -*-
"""AST JSON Schema 自身合法 + 两案样例片段（fixtures/ast_sample_*.json）通过校验（04-r1-design §3）。"""
import json
import os

import pytest
from jsonschema import Draft202012Validator

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(os.path.dirname(HERE), "src", "patent_studio", "kernel", "ast_schema.json")
SAMPLES = ["ast_sample_method.json", "ast_sample_system.json"]


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def schema():
    s = _load(SCHEMA_PATH)
    Draft202012Validator.check_schema(s)
    return s


def test_schema_enums_are_fixed(schema):
    d = schema["$defs"]
    assert d["DescriptionPart"]["enum"] == [
        "technical-field", "background-art", "disclosure",
        "description-of-drawings", "mode-for-invention", "other",
    ]
    assert d["ClaimKind"]["enum"] == ["independent", "dependent"]
    assert d["DescriptionBlockKind"]["enum"] == ["section", "subsection", "paragraph", "equation", "table",
                                                 "code", "figure"]
    assert schema["properties"]["version"] == {"const": 1}


@pytest.mark.parametrize("name", SAMPLES)
def test_sample_validates(schema, name):
    sample = _load(os.path.join(HERE, "fixtures", name))
    errors = sorted(Draft202012Validator(schema).iter_errors(sample), key=lambda e: list(e.path))
    assert not errors, "\n".join(f"{list(e.path)}: {e.message}" for e in errors)


@pytest.mark.parametrize("name", SAMPLES)
def test_sample_invariants(name):
    sample = _load(os.path.join(HERE, "fixtures", name))
    blocks = [sample["abstract"], *sample["claims"], *sample["description"]]
    ids = [b["id"] for b in blocks] + [f["id"] for f in sample["figures"]]
    assert len(ids) == len(set(ids))
    for b in blocks:
        assert b["lines"]["start"] <= b["lines"]["end"]
    for book, info in sample["books"].items():
        assert info["offset"] >= 1 and info["length"] >= 0, book
    offsets = [sample["books"][b]["offset"] for b in ("abstract", "claims", "description")]
    assert offsets == sorted(offsets) and len(set(offsets)) == 3


def test_sample_lines_match_examples():
    """样例块的书相对行 + offset 必须落在两案 content.md 的真实文本上。"""
    root = os.path.dirname(os.path.dirname(HERE))
    for name, ex in (("ast_sample_method.json", "method"), ("ast_sample_system.json", "system")):
        sample = _load(os.path.join(HERE, "fixtures", name))
        with open(os.path.join(root, "examples", ex, "content.md"), encoding="utf-8") as f:
            lines = f.read().split("\n")
        assert lines[sample["title"]["line"] - 1] == "# " + sample["title"]["text"]
        for book, heading in (("abstract", "## 摘要"), ("claims", "## 权利要求书"), ("description", "## 说明书")):
            assert lines[sample["books"][book]["offset"] - 1] == heading
        off = sample["books"]["description"]["offset"]
        for b in sample["description"]:
            if b["kind"] == "paragraph":
                assert lines[off + b["lines"]["start"] - 1] == b["text"]
            elif b["kind"] in ("section", "subsection"):
                prefix = "### " if b["kind"] == "section" else "#### "
                assert lines[off + b["lines"]["start"] - 1] == prefix + b["title"]
        coff = sample["books"]["claims"]["offset"]
        for c in sample["claims"]:
            for seg in c["segments"]:
                assert lines[coff + seg["line"] - 1] == seg["text"]
