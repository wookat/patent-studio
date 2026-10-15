# -*- coding: utf-8 -*-
"""B2-reviewer-invites：reviewer 写入校验（docs/plan/14 §5）。

  original(new) == original(base) 且 tokens(base) ⊆ tokens(new)；整行 {++…++} 视为插入行。
路由级用例（reviewer PUT /content 加 {++x++} ⇒ 200，改字 ⇒ 403）复用 test_auth 的 on / _register / _login。
"""

import pytest
import test_legacy_auth as test_auth
from fastapi.testclient import TestClient

on = test_auth.on  # pytest fixture
_register, _login = test_auth._register, test_auth._login

BASE = "# 标题\n\n1. 一种方法，包括步骤 A。\n\n{--旧句--}原文{>>他人批注<<}\n"

CASES = [
    ("保存不改动", BASE, True),
    ("加插入", BASE.replace("步骤 A", "步骤 A{++和步骤 B++}"), True),
    ("加替换", BASE.replace("步骤 A", "{~~步骤 A~>步骤 A'~~}"), True),
    ("加批注", BASE + "{>>请核对<<}", True),
    ("加高亮", BASE.replace("原文", "{==原文==}"), True),
    ("整行插入新权项", BASE.replace("步骤 A。\n", "步骤 A。\n{++2. 根据权利要求 1 的方法。++}\n"), True),
    ("整行批注", BASE.replace("步骤 A。\n", "步骤 A。\n{>>整段批注<<}\n"), True),
    ("整块插入（insert_block 补分隔空行）", BASE.replace("步骤 A。\n\n", "步骤 A。\n\n{++2. 新权项。++}\n\n"), True),
    ("整块插入多行", BASE.replace("步骤 A。\n\n", "步骤 A。\n\n{++2. 新权项，++}\n{++包括步骤 B。++}\n\n"), True),
    ("整块插入夹带多一个空行", BASE.replace("步骤 A。\n\n", "步骤 A。\n\n{++2. 新权项。++}\n\n\n"), False),
    ("直接改字", BASE.replace("步骤 A", "步骤 B"), False),
    ("裸插入空行", BASE.replace("步骤 A。\n", "步骤 A。\n\n"), False),
    ("裸插入新行", BASE.replace("步骤 A。\n", "步骤 A。\n2. 新权项。\n"), False),
    ("删原文行", BASE.replace("\n\n{--旧句--}原文{>>他人批注<<}", ""), False),
    ("用 {--x--} 夹带正文", BASE.replace("步骤 A", "步骤 A{--夹带--}"), False),
    ("接受他人删除", BASE.replace("{--旧句--}", ""), False),
    ("拒绝他人删除", BASE.replace("{--旧句--}", "旧句"), False),
    ("删他人批注", BASE.replace("{>>他人批注<<}", ""), False),
    ("改他人删除为替换", BASE.replace("{--旧句--}", "{~~旧句~>新句~~}"), False),
    ("挪动他人标记", BASE.replace("{--旧句--}原文", "原文{--旧句--}"), False),
]


@pytest.mark.parametrize("name,new,ok", CASES, ids=[c[0] for c in CASES])
def test_reviewer_allowed(name, new, ok):
    from app.auth import acl

    assert acl.reviewer_allowed(BASE, new) is ok


def test_reviewer_allowed_keeps_existing_suggestion_and_adds_more():
    from app.auth import acl

    base = "a{++b++}c\n"
    assert acl.reviewer_allowed(base, "a{++b++}c{>>批注<<}\n") is True
    assert acl.reviewer_allowed(base, "a{++b++}{++b++}c\n") is True  # 同 token 重复算新增
    assert acl.reviewer_allowed("a{++b++}{++b++}c\n", "a{++b++}c\n") is False  # 少一份基线 token


def _setup(on):
    anon = TestClient(on.app)
    _register(anon, "su@example.com")
    _register(anon, "rev@example.com")
    _register(anon, "view@example.com")
    su, rev, view = _login(on, "su@example.com"), _login(on, "rev@example.com"), _login(on, "view@example.com")
    members = "/api/projects/method/members"
    assert su.put(members, json={"email": "rev@example.com", "role": "reviewer"}).status_code == 200
    assert su.put(members, json={"email": "view@example.com", "role": "viewer"}).status_code == 200
    return su, rev, view


def _403_reviewer(r):
    assert r.status_code == 403, r.text
    d = r.json()["detail"]
    assert d["kind"] == "forbidden" and d["detail"] == "reviewer"


def test_reviewer_routes_content(on):
    su, rev, view = _setup(on)
    content = rev.get("/api/projects/method/content").json()["content"]

    # 纯建议 / 批注 ⇒ 200 且落盘
    r = rev.put("/api/projects/method/content", json={"content": content + "{>>批注<<}"})
    assert r.status_code == 200, r.text
    saved = rev.get("/api/projects/method/content").json()["content"]
    assert saved.endswith("{>>批注<<}") or "{>>批注<<}" in saved
    # 建议之上再加插入 ⇒ 200；接受自己刚加的批注（删掉）⇒ 仍是删基线 token ⇒ 403
    r = rev.put("/api/projects/method/content", json={"content": saved.replace("{>>批注<<}", "{>>批注<<}{++补++}")})
    assert r.status_code == 200, r.text
    saved = rev.get("/api/projects/method/content").json()["content"]
    _403_reviewer(rev.put("/api/projects/method/content", json={"content": saved.replace("{>>批注<<}", "")}))
    # 直接改字 ⇒ 403，没落盘
    _403_reviewer(rev.put("/api/projects/method/content", json={"content": saved.replace("方法", "方案", 1)}))
    assert rev.get("/api/projects/method/content").json()["content"] == saved

    # viewer 仍 403（editor 门槛）；owner 直接改字 200
    r = view.put("/api/projects/method/content", json={"content": saved})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"
    assert su.put("/api/projects/method/content", json={"content": saved.replace("方法", "方案", 1)}).status_code == 200


def test_reviewer_routes_docs(on):
    su, rev, view = _setup(on)
    book = rev.get("/api/projects/method/docs/abstract").json()["content"]

    body = book.rstrip("\n")
    r = rev.put("/api/projects/method/docs/abstract", json={"content": body + "{++（补充）++}" + book[len(body) :]})
    assert r.status_code == 200, r.text
    assert "{++（补充）++}" in rev.get("/api/projects/method/docs/abstract").json()["content"]
    _403_reviewer(rev.put("/api/projects/method/docs/abstract", json={"content": "x"}))
    r = view.put("/api/projects/method/docs/abstract", json={"content": book})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"


def test_reviewer_routes_blocks(on):
    su, rev, view = _setup(on)
    ast = rev.get("/api/projects/method/ast").json()
    block = ast["claims"][0]
    content = rev.get("/api/projects/method/content").json()["content"]
    lines = content.split("\n")
    off = ast["books"]["claims"]["offset"]
    md = "\n".join(lines[off + block["lines"]["start"] - 1 : off + block["lines"]["end"]])

    # 块补丁：块内加插入 / 批注 ⇒ 200 且落盘
    r = rev.post(
        f"/api/projects/method/blocks/{block['id']}", json={"markdown": md + "{++；还包括步骤 Z++}{>>请补充步骤 Z<<}"}
    )
    assert r.status_code == 200, r.text
    assert "{++；还包括步骤 Z++}" in rev.get("/api/projects/method/content").json()["content"]
    # 直接改块 / 删块 / 裸插块 ⇒ 403，都没落盘
    saved = rev.get("/api/projects/method/content").json()["content"]
    _403_reviewer(rev.post(f"/api/projects/method/blocks/{block['id']}", json={"markdown": "1. 改了"}))
    _403_reviewer(rev.delete(f"/api/projects/method/blocks/{block['id']}"))
    _403_reviewer(
        rev.post(
            "/api/projects/method/blocks",
            json={"kind": "claim", "after_block_id": block["id"], "book": "claims", "markdown": "2. 裸新权项。"},
        )
    )
    assert rev.get("/api/projects/method/content").json()["content"] == saved
    # 整块 {++…++} 经 POST /blocks 插入（insert_block 补的分隔空行随块计入）⇒ 200 且落盘
    r = rev.post(
        "/api/projects/method/blocks",
        json={"kind": "claim", "after_block_id": block["id"], "book": "claims", "markdown": "{++2. 建议新增权项。++}"},
    )
    assert r.status_code == 200, r.text
    saved = rev.get("/api/projects/method/content").json()["content"]
    assert "\n{++2. 建议新增权项。++}\n" in saved
    # 整行 {++…++} 新权项经 PUT /content ⇒ 200；同一件事裸写 ⇒ 403
    at = saved.index("\n", saved.index("## 权利要求书") + 1) + 1
    bare, marked = saved[:at] + "2. 裸新权项。\n" + saved[at:], saved[:at] + "{++2. 新权项。++}\n" + saved[at:]
    _403_reviewer(rev.put("/api/projects/method/content", json={"content": bare}))
    r = rev.put("/api/projects/method/content", json={"content": marked})
    assert r.status_code == 200, r.text
    # viewer 仍 403
    r = view.post(f"/api/projects/method/blocks/{block['id']}", json={"markdown": md})
    assert r.status_code == 403 and r.json()["detail"]["detail"] == "reviewer"


def test_critic_unsaved_marks_get_current_author_immediately(on):
    """W11 C14：/critic 带未落盘正文时，尚无记录的新标记先按请求者填 author·at；落盘后以 marks.json 为准，
    别人的旧标记不受影响。"""
    su, rev, _view = _setup(on)
    content = rev.get("/api/projects/method/content").json()["content"]
    first = content.replace("本申请提供一种", "本申请{++首次++}提供一种", 1)
    assert su.put("/api/projects/method/content", json={"content": first}).status_code == 200

    draft = first.replace("提供一种", "提供{~~一种~>一类~~}", 1)
    marks = rev.post("/api/projects/method/critic", json={"content": draft}).json()["marks"]
    by_kind = {m["kind"]: m for m in marks}
    assert by_kind["ins"]["author"] == "su@example.com"
    assert by_kind["sub"]["author"] == "rev@example.com" and isinstance(by_kind["sub"]["at"], float)
    # 落盘前用「读盘」口径查，仍是无记录 ⇒ None
    saved_view = rev.post("/api/projects/method/critic", json={}).json()["marks"]
    assert [m["kind"] for m in saved_view] == ["ins"]
