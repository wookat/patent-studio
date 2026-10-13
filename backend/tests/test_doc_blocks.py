# -*- coding: utf-8 -*-
"""W9 prep-kernel 后端契约（docs/plan/22 §2）：
- 块补丁 / 插入 / 删除 响应 ast 走 routes_ast._parse：审阅式补丁后 AST 文本不含 CriticMarkup 记号；
- PUT /docs/{book}：base_sha / 409 stale / 成功响应 ast+content+changed_lines+sha，GET 返回 sha；
  镜像 + history 同 save_content；
- GET /history/diff?format=blocks：blocks[] 按 b 版 AST 块归并（added / removed / changed）。"""
import hashlib
import json
import os
import shutil

import pytest
from fastapi.testclient import TestClient

from patent_docx import docset
from patent_docx.ast import parse_ast
from patent_docx.blockdiff import block_diff

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    shutil.copytree(os.path.join(ROOT, "examples", "method"), projects / "method",
                    ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    import importlib

    from app import config, main
    from app.domain import build, xml_export
    from app.domain import projects as projects_mod

    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(build)
    importlib.reload(xml_export)
    importlib.reload(main)
    c = TestClient(main.app)
    c.pdir = projects / "method"
    return c


def _disk(c, *parts):
    # 与服务端读口径一致（universal newlines）
    with open(c.pdir.joinpath(*parts), encoding="utf-8") as f:
        return f.read()


def _no_critic(obj):
    return "{++" not in json.dumps(obj, ensure_ascii=False) and "{--" not in json.dumps(obj, ensure_ascii=False)


# ---------------- T5：审阅式补丁后 AST 恒为 final 文本 ----------------

def test_patch_insert_delete_ast_is_critic_accepted(client):
    c = client
    ast = c.get("/api/projects/method/ast").json()
    p = ast["description"][1]
    r = c.post(f"/api/projects/method/blocks/{p['id']}", json={"markdown": p["text"] + "{++（审阅新增）++}{--旧--}"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "{++" in j["content"]  # 源码仍保留 CriticMarkup
    assert j["ast"]["description"][1]["text"] == p["text"] + "（审阅新增）"
    assert _no_critic(j["ast"]) and j["ast"] == c.get("/api/projects/method/ast").json()
    assert j["ast"]["description"][1]["inline"][0]["text"].startswith(p["text"][:3])

    r = c.post("/api/projects/method/blocks", json={"kind": "paragraph", "after_block_id": p["id"],
                                                    "markdown": "插入段{++带审阅++}。"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "{++带审阅++}" in j["content"]
    assert j["ast"]["description"][2]["text"] == "插入段带审阅。" and _no_critic(j["ast"])

    r = c.delete(f"/api/projects/method/blocks/{j['block_id']}")
    assert r.status_code == 200, r.text
    assert _no_critic(r.json()["ast"]) and r.json()["ast"]["description"][2]["kind"] == "section"


# ---------------- T6：整书保存契约 ----------------

def _sha(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def test_get_doc_returns_sha(client):
    c = client
    r = c.get("/api/projects/method/docs/claims")
    assert r.status_code == 200
    j = r.json()
    assert set(j) == {"book", "content", "offset", "sha"} and j["sha"] == _sha(j["content"])
    assert j["content"] == _disk(c, "docs", "claims.md")


def test_put_doc_stale_409_and_success_shape(client):
    c = client
    g = c.get("/api/projects/method/docs/description").json()
    new_body = g["content"].replace("技术领域", "技术领域", 1) + "\n新增末段{++审阅++}。\n"

    r = c.put("/api/projects/method/docs/description", json={"content": new_body, "base_sha": "0" * 40})
    assert r.status_code == 409
    assert r.json()["detail"]["kind"] == "stale" and r.json()["detail"]["sha"] == g["sha"]
    assert _disk(c, "docs", "description.md") == g["content"]  # 未写入

    r = c.put("/api/projects/method/docs/description", json={"content": new_body, "base_sha": g["sha"]})
    assert r.status_code == 200, r.text
    j = r.json()
    assert {"ok", "backup", "backups", "ast", "ast_error", "content", "changed_lines", "sha"} <= set(j)
    assert j["ok"] is True and j["ast_error"] is None
    assert j["content"] == _disk(c, "content.md")
    assert docset.split(j["content"]).book("description") == new_body == _disk(c, "docs", "description.md")
    assert j["sha"] == _sha(new_body) == c.get("/api/projects/method/docs/description").json()["sha"]
    n = len(new_body.split("\n")) - 1  # 以 \n 结尾 ⇒ 行数 = 换行数
    assert j["changed_lines"] == {"start": g["offset"] + 1, "end": g["offset"] + n}
    assert j["ast"] == c.get("/api/projects/method/ast").json() and _no_critic(j["ast"])
    assert j["ast"]["description"][-1]["text"] == "新增末段审阅。"
    # 无 base_sha ⇒ 不校验（旧客端兼容）
    r = c.put("/api/projects/method/docs/description", json={"content": g["content"]})
    assert r.status_code == 200 and r.json()["sha"] == g["sha"]
    # history 记录了两次 save（走 save_content）
    assert [v["message"] for v in c.get("/api/projects/method/history").json()[:2]] == ["save", "save"]


def test_put_doc_saves_even_when_ast_fails(client):
    c = client
    g = c.get("/api/projects/method/docs/claims").json()
    bad = g["content"] + "\n## 权利要求书\n重复书标题。\n"
    r = c.put("/api/projects/method/docs/claims", json={"content": bad, "base_sha": g["sha"]})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ast"] is None and j["ast_error"]["kind"] == "content" and j["sha"] == _sha(bad)
    assert _disk(c, "content.md") == j["content"] and "重复书标题。" in j["content"]


# ---------------- T7：history diff format=blocks ----------------

def test_block_diff_pure():
    md = _read_example()
    ast = parse_ast(md)
    assert block_diff(md, ast, md, ast) == []
    p = ast["description"][1]
    off = ast["books"]["description"]["offset"]
    lines = md.split("\n")
    s = off + p["lines"]["start"] - 1
    changed = "\n".join(lines[:s] + [lines[s] + "（改）"] + lines[s + 1:])
    out = block_diff(md, ast, changed, parse_ast(changed))
    assert out == [{"book": "description", "block_id": p["id"], "kind": "changed",
                    "lines": [off + p["lines"]["start"], off + p["lines"]["end"]]}]
    # 删掉该段 ⇒ removed，落点为其原起始行（空区间）
    e = off + p["lines"]["end"]
    removed = "\n".join(lines[:s] + lines[e + 1:])
    out = block_diff(md, ast, removed, parse_ast(removed))
    assert [(b["kind"], b["block_id"]) for b in out] == [("removed", p["id"])]
    lo, hi = out[0]["lines"]  # 空区间；落点在原段行或其前的空行（difflib 对空行归属二选一）
    assert hi == lo - 1 and lo in (s, s + 1)
    # 在其后插入新段 ⇒ added
    added = "\n".join(lines[:e] + ["", "全新一段。"] + lines[e:])
    ast2 = parse_ast(added)
    out = block_diff(md, ast, added, ast2)
    assert len(out) == 1 and out[0]["kind"] == "added" and out[0]["lines"] == [e + 2, e + 2]
    assert out[0]["block_id"] == ast2["description"][2]["id"]


def _read_example():
    with open(os.path.join(ROOT, "examples", "method", "content.md"), encoding="utf-8") as f:
        return f.read()


def test_history_diff_blocks_route(client):
    c = client
    md = _disk(c, "content.md")
    ast = c.get("/api/projects/method/ast").json()
    assert c.put("/api/projects/method/content", json={"content": md}).status_code == 200
    first = c.get("/api/projects/method/history").json()[0]["sha"]

    p = ast["description"][1]
    r = c.post(f"/api/projects/method/blocks/{p['id']}", json={"markdown": p["text"] + "（改）"})
    assert r.status_code == 200
    r = c.post("/api/projects/method/blocks", json={"kind": "paragraph", "book": "abstract", "markdown": "新摘要段。"})
    assert r.status_code == 200

    r = c.get(f"/api/projects/method/history/diff?a={first}")
    assert r.status_code == 200 and set(r.json()) == {"a", "b", "diff"}  # 旧契约不变

    r = c.get(f"/api/projects/method/history/diff?a={first}&format=blocks")
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["blocks_error"] is None and "+新摘要段。" in j["diff"]
    kinds = [(b["book"], b["kind"]) for b in j["blocks"]]
    assert ("abstract", "added") in kinds and ("description", "changed") in kinds
    for b in j["blocks"]:
        assert set(b) == {"book", "block_id", "kind", "lines"} and len(b["lines"]) == 2
    cur = c.get("/api/projects/method/ast").json()
    ids = {b["id"] for bk in ("claims", "description") for b in cur[bk]}
    ids |= {b["id"] for b in cur["abstract"]["paragraphs"]}
    assert all(b["block_id"] in ids for b in j["blocks"] if b["kind"] != "removed")

    r = c.get(f"/api/projects/method/history/diff?a={first}&format=xml")
    assert r.status_code == 422
