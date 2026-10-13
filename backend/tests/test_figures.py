# -*- coding: utf-8 -*-
"""R2 A1-figures-api：/api/projects/{pid}/figures* 六路由（docs/plan/05-r2-figures-preflight-design.md §2/§3.1/§5）。

两案复制到临时目录当案子，不触碰仓库文件（zero-drift）；临时新案走 POST /api/projects。
W4-C：附图真源 = docs/figures.md（15 §2）；响应 settings.spec_figures / abstract_figure 是它的派生视图，
_studio() 读的也是「studio.json + figures.md 派生」的持久化状态。
"""
import io
import json
import os
import re
import shutil
import zipfile

import pytest
from fastapi.testclient import TestClient

from patent_docx.figures_md import DEFAULT_ABSTRACT_WIDTH

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# 1×1 灰度 PNG（PIL 生成）：上传入口用构建同一套识图器验内容，伪头部 + 零字节会被 400 拒掉
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x00\x00\x00\x00:~\x9bU"
       b"\x00\x00\x00\nIDATx\x9cc\xf8\x0f\x00\x01\x01\x01\x00\xb18\xf6\x14\x00\x00\x00\x00IEND\xaeB`\x82")
FAKE_PNG = b"not really a png\n"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    projects = tmp_path / "projects"
    projects.mkdir()
    for case in ("method", "system"):
        shutil.copytree(os.path.join(ROOT, "examples", case), projects / case,
                        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*",
                                                      "abstract.md", "claims.md", "description.md"))
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    import importlib

    from app import config, main
    from app.domain import figures
    from app.domain import projects as projects_mod
    from app.routes import figures as routes_figures

    # 其它用例会 reload app.domain.projects，ProjectError 类身份会变；这里按依赖链一起 reload（同 test_api）
    importlib.reload(config)
    importlib.reload(projects_mod)
    importlib.reload(figures)
    importlib.reload(routes_figures)
    importlib.reload(main)
    return TestClient(main.app), projects


def _studio(projects, pid):
    """持久化的运行时设置：studio.json（非附图字段）+ docs/figures.md 派生的 spec_figures / abstract_figure。"""
    from patent_docx import figures_md

    with open(projects / pid / "studio.json", encoding="utf-8") as f:
        s = json.load(f)
    assert not ({"spec_figures", "abstract_figure"} & set(s)), "附图字段不应再写回 studio.json"
    return {**s, **figures_md.read(str(projects / pid)).legacy_view()}


def _upload(c, pid, *files):
    return c.post(f"/api/projects/{pid}/figures", files=[("files", (n, io.BytesIO(PNG), "image/png")) for n in files])


# ---------------- GET：两案形状 ----------------

@pytest.mark.parametrize("pid,nfig", [("method", 6), ("system", 5)])
def test_list_examples(client, pid, nfig):
    c, projects = client
    r = c.get(f"/api/projects/{pid}/figures")
    assert r.status_code == 200
    j = r.json()
    assert j["settings"] == _studio(projects, pid)
    figs = j["figures"]
    names = [f"fig{i}.emf" for i in range(1, nfig + 1)]
    assert [f["name"] for f in figs] == [f for f, _w in j["settings"]["spec_figures"]] == names
    assert [f["num"] for f in figs] == list(range(1, nfig + 1))
    f1 = figs[0]
    assert set(f1) == {"name", "ext", "size", "num", "alt", "width", "is_abstract", "abstract_width", "preview",
                       "companions", "marks"}
    assert f1["alt"].startswith("图1")
    assert f1["ext"] == ".emf" and f1["size"] == os.path.getsize(projects / pid / "figs" / "fig1.emf")
    assert f1["width"] == 15.0 and f1["is_abstract"] is True and f1["abstract_width"] == 14.5
    assert f1["preview"] == "fig1.png" and f1["companions"] == ["fig1.png", "fig1.svg"]
    assert all(not f["is_abstract"] and f["abstract_width"] is None for f in figs[1:])


def test_list_unknown_project(client):
    c, _ = client
    assert c.get("/api/projects/nope/figures").status_code == 404
    assert c.get("/api/projects/nope/figures/export.zip").status_code == 404


def test_list_unlisted_file_after_spec(client):
    """未编入 spec 的文件排在最后，num/width 为 null；纯 .svg 不成图。"""
    c, projects = client
    (projects / "method" / "figs" / "extra9.png").write_bytes(PNG)
    (projects / "method" / "figs" / "lonely.svg").write_bytes(b"<svg/>")
    figs = c.get("/api/projects/method/figures").json()["figures"]
    assert [f["name"] for f in figs][-1] == "extra9.png" and len(figs) == 7
    assert figs[-1]["num"] is None and figs[-1]["width"] is None and figs[-1]["preview"] == "extra9.png"


# ---------------- POST：上传 ----------------

def test_upload_new_stem_appends_spec(client):
    c, projects = client
    r = _upload(c, "method", "流程图.png", "block.jpg")
    assert r.status_code == 200, r.text
    j = r.json()
    names = [f["name"] for f in j["figures"]]
    assert names[-2:] == ["fig7.png", "block.jpg"]  # 非法 stem → fig<N>；合法原名保留
    assert j["settings"]["spec_figures"][-2:] == [["fig7.png", 15.0], ["block.jpg", 15.0]]
    assert _studio(projects, "method") == j["settings"]
    assert j["figures"][-2]["num"] == 7 and j["figures"][-1]["num"] == 8
    assert (projects / "method" / "figs" / "fig7.png").read_bytes() == PNG


def test_upload_companion_keeps_settings(client):
    c, projects = client
    before = _studio(projects, "method")
    r = _upload(c, "method", "fig2.jpg")
    assert r.status_code == 200
    j = r.json()
    assert j["settings"] == before
    f2 = j["figures"][1]
    assert f2["name"] == "fig2.emf" and "fig2.jpg" in f2["companions"] and f2["preview"] == "fig2.png"


def test_upload_skips_bad_files_and_reports(client):
    """批6：批量上传改逐件跳过——坏件进 skipped 名单，其余正常写入（整批拒死改为部分成功）。"""
    c, projects = client
    r = c.post("/api/projects/method/figures", files=[("files", ("a.svg", io.BytesIO(b"<svg/>"), "image/svg+xml"))])
    assert r.status_code == 200
    assert [s["name"] for s in r.json()["skipped"]] == ["a.svg"]
    assert ".svg" in r.json()["skipped"][0]["reason"]
    r = _upload(c, "method", "new1.png", "fig1.emf")
    assert r.status_code == 200
    j = r.json()
    assert (projects / "method" / "figs" / "new1.png").exists()  # 有效件仍写入
    assert [s["name"] for s in j["skipped"]] == ["fig1.emf"] and "已存在" in j["skipped"][0]["reason"]
    r = _upload(c, "method", "same.png", "same.png")
    assert r.status_code == 200  # 全跳过也 200：名单交代一切
    assert len(r.json()["skipped"]) == 1  # same.png 同名同批第二件跳过（第一件已写）
    assert c.post("/api/projects/method/figures").status_code == 422  # 缺 files 字段


def test_upload_too_large_413(client, monkeypatch):
    """上传上限与附件一致（monkeypatch 缩小口径验证 413；此前无上限）。"""
    c, projects = client
    from app.routes import figures as routes_figures
    monkeypatch.setattr(routes_figures, "ATTACHMENT_MAX_BYTES", 1024)
    r = c.post("/api/projects/method/figures",
               files=[("files", ("big.png", io.BytesIO(PNG + b"x" * 2048), "image/png"))])
    d = r.json()["detail"]
    assert r.status_code == 413 and d["kind"] == "figures" and d["detail"] == "big.png"


def test_upload_skips_undecodable_image(client):
    """后缀合法但内容不是图（W12 R2-02 → 批6 逐件跳过语义）：坏件进 skipped，同批合法图照写。"""
    c, projects = client
    for i, (name, data) in enumerate((("R2invalid.png", FAKE_PNG), ("trunc.png", PNG[:20]), ("empty.jpg", b""))):
        r = c.post("/api/projects/method/figures", files=[
            ("files", (f"ok{i}.png", io.BytesIO(PNG), "image/png")),
            ("files", (name, io.BytesIO(data), "image/png")),
        ])
        assert r.status_code == 200, (name, r.text)
        assert [s["name"] for s in r.json()["skipped"]] == [name]
        assert f"附图无法读取：{name}（不是有效的图片文件" in r.json()["skipped"][0]["reason"]
        assert not (projects / "method" / "figs" / name).exists()
        assert (projects / "method" / "figs" / f"ok{i}.png").exists()


# ---------------- PUT /order ----------------

def test_reorder(client):
    c, projects = client
    c.put("/api/projects/method/figures/fig3.emf", json={"width": 9.5})
    order = [f"fig{i}.emf" for i in (3, 1, 2, 6, 5, 4)]
    r = c.put("/api/projects/method/figures/order", json={"order": order})
    assert r.status_code == 200
    j = r.json()
    assert [f for f, _w in j["settings"]["spec_figures"]] == order
    assert j["settings"]["spec_figures"][0] == ["fig3.emf", 9.5]  # 宽度随文件走
    assert [f["name"] for f in j["figures"]] == order and j["figures"][0]["num"] == 1
    assert _studio(projects, "method")["spec_figures"] == j["settings"]["spec_figures"]
    ast = c.get("/api/projects/method/ast").json()
    assert ast["figures"][0]["file"] == "fig3.emf" and ast["figures"][0]["num"] == 1


@pytest.mark.parametrize("order,frag", [
    ([f"fig{i}.emf" for i in range(1, 6)], "缺 fig6.emf"),
    ([f"fig{i}.emf" for i in range(1, 7)] + ["fig9.emf"], "多出 fig9.emf"),
    ([f"fig{i}.emf" for i in range(1, 6)] + ["fig5.emf"], "重复 fig5.emf"),
])
def test_reorder_422(client, order, frag):
    c, projects = client
    before = _studio(projects, "method")
    r = c.put("/api/projects/method/figures/order", json={"order": order})
    assert r.status_code == 422
    d = r.json()["detail"]
    assert d["kind"] == "figures" and d["line"] is None and d["message"] == "order 必须是当前全部附图的排列"
    assert frag in d["detail"]
    assert _studio(projects, "method") == before


# ---------------- PUT /{name} ----------------

def test_update_width_and_abstract(client):
    c, projects = client
    r = c.put("/api/projects/method/figures/fig2.emf", json={"width": 12})
    assert r.status_code == 200 and r.json()["settings"]["spec_figures"][1] == ["fig2.emf", 12.0]
    assert r.json()["figures"][1]["width"] == 12.0

    r = c.put("/api/projects/method/figures/fig3.emf", json={"abstract": True})
    j = r.json()
    assert j["settings"]["abstract_figure"] == ["fig3.emf", 14.5]
    assert [f["is_abstract"] for f in j["figures"]] == [False, False, True, False, False, False]
    assert j["figures"][2]["abstract_width"] == 14.5

    r = c.put("/api/projects/method/figures/fig3.emf", json={"abstract_width": 10})
    assert r.json()["settings"]["abstract_figure"] == ["fig3.emf", 10.0]
    r = c.put("/api/projects/method/figures/fig1.emf", json={"abstract": True, "abstract_width": 8})
    assert r.json()["settings"]["abstract_figure"] == ["fig1.emf", 8.0]
    r = c.put("/api/projects/method/figures/fig3.emf", json={"abstract": False})
    assert r.json()["settings"]["abstract_figure"] == ["fig1.emf", 8.0]  # 不是摘要图，无影响
    r = c.put("/api/projects/method/figures/fig6.emf", json={"abstract": True})
    assert r.json()["settings"]["abstract_figure"] == ["fig6.emf", 14.5]
    # abstract:false → 摘要图置空，但 normalize_settings 对 None 回落到默认（首张可编入文件，14.5）：
    # 内核要求摘要附图必须存在，所以持久化结果是「回到默认」而不是 null
    r = c.put("/api/projects/method/figures/fig6.emf", json={"abstract": False})
    assert r.json()["settings"]["abstract_figure"] == ["fig1.emf", 14.5]
    assert _studio(projects, "method")["abstract_figure"] == ["fig1.emf", 14.5]


def test_update_width_rejects_over_max(client):
    """R37-01：宽度上限 = A4 版心 17cm（前端 CmInput max 同口径）；0 / 负数 / 超界均 400。"""
    c, _ = client
    for bad in (0, -1, 17.5, 1512):
        r = c.put("/api/projects/method/figures/fig2.emf", json={"width": bad})
        assert r.status_code == 422, (bad, r.text)
        assert "0–17" in r.json()["detail"]["message"]
    r = c.put("/api/projects/method/figures/fig2.emf", json={"width": 17})
    assert r.status_code == 200 and r.json()["figures"][1]["width"] == 17.0


def test_update_unlisted_file_appends(client):
    c, projects = client
    (projects / "method" / "figs" / "extra.png").write_bytes(PNG)
    r = c.put("/api/projects/method/figures/extra.png", json={"width": 7})
    assert r.status_code == 200 and r.json()["settings"]["spec_figures"][-1] == ["extra.png", 7.0]


def test_update_marks(client):
    """W15 批85-D：marks（标号→名称）表读写——写后 GET 透出、figures.md 落 marks: 节、校验口径同 figures_md.MARK_RE。"""
    c, projects = client
    # 写入 + GET 透出（保持顺序）
    r = c.put("/api/projects/method/figures/fig1.emf", json={"marks": {"101": "数据接入模块", "102": "预处理模块"}})
    assert r.status_code == 200, r.text
    item = next(f for f in r.json()["figures"] if f["name"] == "fig1.emf")
    assert item["marks"] == {"101": "数据接入模块", "102": "预处理模块"}
    # figures.md 落盘
    txt = (projects / "method" / "docs" / "figures.md").read_text(encoding="utf-8")
    assert "marks:" in txt and "- 101 数据接入模块" in txt and "- 102 预处理模块" in txt
    # 修改 + 清空
    r = c.put("/api/projects/method/figures/fig1.emf", json={"marks": {"103": "控制模块"}})
    assert next(f for f in r.json()["figures"] if f["name"] == "fig1.emf")["marks"] == {"103": "控制模块"}
    r = c.put("/api/projects/method/figures/fig1.emf", json={"marks": {}})
    assert next(f for f in r.json()["figures"] if f["name"] == "fig1.emf")["marks"] == {}
    assert "marks:" not in (projects / "method" / "docs" / "figures.md").read_text(encoding="utf-8")
    # 校验：标记号非 3-4 位 / 名称为空 / 未编入的图 → 422
    assert c.put("/api/projects/method/figures/fig1.emf", json={"marks": {"10": "x"}}).status_code == 422
    assert c.put("/api/projects/method/figures/fig1.emf", json={"marks": {"101": " "}}).status_code == 422
    (projects / "method" / "figs" / "loose.png").write_bytes(PNG)
    assert c.put("/api/projects/method/figures/loose.png", json={"marks": {"101": "x"}}).status_code == 422


def test_update_errors(client):
    c, _ = client
    r = c.put("/api/projects/method/figures/fig1.emf", json={"width": 0})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "figures"
    assert c.put("/api/projects/method/figures/fig9.emf", json={"width": 1}).status_code == 404
    assert c.put("/api/projects/method/figures/fig1.svg", json={"width": 1}).status_code == 404
    # %2F 解码后不匹配 {name}：无 frontend/dist 时 404，有 dist（StaticFiles 挂在 /）时 405
    assert c.put("/api/projects/method/figures/..%2Fcontent.md", json={"width": 1}).status_code in (400, 404, 405)


# ---------------- DELETE ----------------

def test_delete_referenced_409(client):
    c, projects = client
    content = (projects / "method" / "content.md").read_text(encoding="utf-8").split("\n")
    expected_lines = [i for i, ln in enumerate(content, 1) if re.search(r"图3(?!\d)", ln)]
    assert len(expected_lines) == 2
    r = c.delete("/api/projects/method/figures/fig3.emf")
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["kind"] == "figure-referenced" and d["message"] == "图3 被引用 2 处，先删除或改写引用再删图"
    assert d["line"] == expected_lines[0] and d["detail"] == "、".join(f"L{n}" for n in expected_lines)
    assert [r_["line"] for r_ in d["refs"]] == expected_lines
    assert all(r_["book"] == "description" and "图3" in r_["text"] for r_ in d["refs"])
    assert (projects / "method" / "figs" / "fig3.emf").exists()
    assert len(_studio(projects, "method")["spec_figures"]) == 6


def test_delete_referenced_num_follows_spec_order(client):
    """图号由 spec 顺序决定：把 fig6 排到首位后它就是「图1」，删除时报的是图1 的引用行。"""
    c, projects = client
    order = [f"fig{i}.emf" for i in (6, 1, 2, 3, 4, 5)]
    assert c.put("/api/projects/method/figures/order", json={"order": order}).status_code == 200
    r = c.delete("/api/projects/method/figures/fig6.emf")
    assert r.status_code == 409 and r.json()["detail"]["message"].startswith("图1 ")


def test_delete_unreferenced_removes_companions_and_settings(client):
    c, projects = client
    _upload(c, "method", "fig7.png", "fig7.emf")  # fig7.emf 主文件 + fig7.png 伴生（同批）
    j = c.get("/api/projects/method/figures").json()
    assert j["figures"][-1]["name"] == "fig7.emf" and j["figures"][-1]["companions"] == ["fig7.png"]
    c.put("/api/projects/method/figures/fig7.emf", json={"abstract": True})
    r = c.delete("/api/projects/method/figures/fig7.emf")
    assert r.status_code == 200
    j = r.json()
    assert [f["name"] for f in j["figures"]] == [f"fig{i}.emf" for i in range(1, 7)]
    assert j["settings"]["abstract_figure"] == ["fig1.emf", 14.5]  # 删掉摘要图 → 回落默认（见 test_update）
    assert j["settings"]["spec_figures"] == [[f"fig{i}.emf", 15.0] for i in range(1, 7)]
    assert not (projects / "method" / "figs" / "fig7.emf").exists()
    assert not (projects / "method" / "figs" / "fig7.png").exists()
    assert _studio(projects, "method") == j["settings"]
    assert c.delete("/api/projects/method/figures/fig7.emf").status_code == 404


def test_delete_guard_on_new_project(client):
    """新案模板：fig1.png 被「图1」引用两处（附图说明 + 具体实施方式）。"""
    c, _ = client
    assert c.post("/api/projects", json={"id": "t1", "title": "测试案"}).status_code == 201
    r = c.delete("/api/projects/t1/figures/fig1.png")
    assert r.status_code == 409 and len(r.json()["detail"]["refs"]) == 2
    md = c.get("/api/projects/t1/content").json()["content"].replace("图1", "图9")
    c.put("/api/projects/t1/content", json={"content": md})
    r = c.delete("/api/projects/t1/figures/fig1.png")
    assert r.status_code == 200 and r.json()["figures"] == [] and r.json()["settings"]["spec_figures"] == []


def test_delete_guard_falls_back_when_ast_invalid(client):
    """content.md 结构不成立时仍守卫：按全文行扫「图N」。"""
    c, _ = client
    c.post("/api/projects", json={"id": "t2", "title": "x"})
    c.put("/api/projects/t2/content", json={"content": "没有标题\n如图1所示\n"})
    r = c.delete("/api/projects/t2/figures/fig1.png")
    assert r.status_code == 409 and r.json()["detail"]["refs"] == [{"book": None, "line": 2, "text": "如图1所示"}]


def test_delete_inline_referenced_409(client):
    """W18 批B：说明书内嵌图（![](figs/x) 独立行）也挡删除——stem 同组命中，消息主语为文件名。"""
    c, projects = client
    md = c.get("/api/projects/method/content").json()["content"]
    anchor = "### 技术领域\n"
    assert anchor in md
    md = md.replace(anchor, anchor + "![内嵌示意](figs/fig7.png){width=12}\n", 1)
    assert c.put("/api/projects/method/content", json={"content": md}).status_code == 200
    _upload(c, "method", "fig7.png")
    line_no = md.split("\n").index("![内嵌示意](figs/fig7.png){width=12}") + 1
    r = c.delete("/api/projects/method/figures/fig7.png")
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["kind"] == "figure-referenced" and "内嵌图 fig7.png 被引用 1 处" in d["message"]
    assert d["refs"] == [{"book": "description", "line": line_no,
                          "text": "![内嵌示意](figs/fig7.png){width=12}"}]
    assert (projects / "method" / "figs" / "fig7.png").exists()
    # 无图号的内嵌引用放行后仍可删
    md = md.replace("![内嵌示意](figs/fig7.png){width=12}\n", "", 1)
    assert c.put("/api/projects/method/content", json={"content": md}).status_code == 200
    assert c.delete("/api/projects/method/figures/fig7.png").status_code == 200


# ---------------- export.zip ----------------

def test_export_zip_members_follow_spec(client):
    c, projects = client
    order = [f"fig{i}.emf" for i in (2, 1, 3, 4, 5, 6)]
    c.put("/api/projects/method/figures/order", json={"order": order})
    r = c.get("/api/projects/method/figures/export.zip")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"].startswith('attachment; filename="method-figures.zip"')
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert z.namelist() == order
        assert z.read("fig2.emf") == (projects / "method" / "figs" / "fig2.emf").read_bytes()


def test_export_zip_includes_abstract_not_in_spec(client):
    c, projects = client
    from patent_docx import figures_md

    doc = figures_md.read(str(projects / "method"))
    doc.spec = doc.spec[:5]
    doc.abstract = figures_md.Figure(file="fig6.emf", width=14.5)
    figures_md.write(str(projects / "method"), doc)
    with zipfile.ZipFile(io.BytesIO(c.get("/api/projects/method/figures/export.zip").content)) as z:
        assert z.namelist() == [f"fig{i}.emf" for i in range(1, 7)]


# ---------------- C2：直接操作 FiguresDoc，alt 随文件走 ----------------

def _md(projects, pid="method"):
    return (projects / pid / "docs" / "figures.md").read_text(encoding="utf-8")


def test_mutations_keep_alt_and_write_figures_md_only(client):
    """重排 / 改宽 / 摘要图 / 上传 / 删除 都只改 docs/figures.md 对应行；alt 原样保留，studio.json 不写附图字段。"""
    from patent_docx import figures_md

    c, projects = client
    before = figures_md.read(str(projects / "method"))
    alt_of = {f.file: f.alt for f in before.spec}
    assert alt_of["fig4.emf"] == "图4 本发明实施例的e过程监控与告警自动回退状态机的状态迁移图"
    studio_before = (projects / "method" / "studio.json").read_bytes()

    # 重排：alt / width 跟着文件，图号重算
    order = [f"fig{i}.emf" for i in (4, 1, 2, 3, 5, 6)]
    r = c.put("/api/projects/method/figures/order", json={"order": order})
    assert r.status_code == 200
    figs = {f["name"]: f for f in r.json()["figures"]}
    assert figs["fig4.emf"]["num"] == 1 and figs["fig4.emf"]["alt"] == alt_of["fig4.emf"]
    doc = figures_md.read(str(projects / "method"))
    assert [(f.file, f.alt) for f in doc.spec] == [(n, alt_of[n]) for n in order]
    assert _md(projects).splitlines()[2] == f"![{alt_of['fig4.emf']}](figs/fig4.emf){{width=15}}"

    # 改宽 / 摘要图宽：只动数字
    r = c.put("/api/projects/method/figures/fig4.emf", json={"width": 9.5, "abstract": True, "abstract_width": 7})
    assert r.status_code == 200
    doc = figures_md.read(str(projects / "method"))
    assert doc.spec[0].width == 9.5 and doc.spec[0].alt == alt_of["fig4.emf"]
    assert (doc.abstract.file, doc.abstract.width) == ("fig4.emf", 7.0)
    assert f"![{alt_of['fig4.emf']}](figs/fig4.emf){{width=9.5}}" in _md(projects)
    assert "![](figs/fig4.emf){width=7}" in _md(projects)
    # 取消摘要图 → 回落到第一张可入 DOCX 的图（内核要求摘要图非空）
    r = c.put("/api/projects/method/figures/fig4.emf", json={"abstract": False})
    assert r.json()["settings"]["abstract_figure"] == ["fig1.emf", DEFAULT_ABSTRACT_WIDTH]

    # 上传：追加一行 width=15，其它行不动
    r = _upload(c, "method", "fig7.png")
    assert r.status_code == 200
    doc = figures_md.read(str(projects / "method"))
    assert [(f.file, f.alt) for f in doc.spec[:6]] == [(n, alt_of[n]) for n in order]
    assert (doc.spec[6].file, doc.spec[6].width, doc.spec[6].alt) == ("fig7.png", 15.0, "图7")

    # 删除未被引用的图：删行，其余 alt 不变
    r = c.delete("/api/projects/method/figures/fig7.png")
    assert r.status_code == 200
    doc = figures_md.read(str(projects / "method"))
    assert [(f.file, f.alt, f.width) for f in doc.spec] == \
        [(n, alt_of[n], 9.5 if n == "fig4.emf" else 15.0) for n in order]

    assert (projects / "method" / "studio.json").read_bytes() == studio_before
    assert r.json()["settings"] == _studio(projects, "method")


def test_delete_abstract_figure_falls_back_to_first(client):
    """删掉正当摘要图的图（且未被引用）→ 摘要图回落到剩下的第一张；alt 不变。"""
    from patent_docx import figures_md

    c, projects = client
    _upload(c, "method", "fig7.png")
    c.put("/api/projects/method/figures/fig7.png", json={"abstract": True, "abstract_width": 6})
    assert figures_md.read(str(projects / "method")).abstract.file == "fig7.png"
    r = c.delete("/api/projects/method/figures/fig7.png")
    assert r.status_code == 200
    doc = figures_md.read(str(projects / "method"))
    assert (doc.abstract.file, doc.abstract.width) == ("fig1.emf", DEFAULT_ABSTRACT_WIDTH)
    assert [f.file for f in doc.spec] == [f"fig{i}.emf" for i in range(1, 7)]
    assert doc.spec[0].alt.startswith("图1 本发明")


def test_reorder_error_leaves_figures_md_untouched(client):
    c, projects = client
    before = _md(projects)
    r = c.put("/api/projects/method/figures/order", json={"order": ["fig1.emf"]})
    assert r.status_code == 422 and r.json()["detail"]["kind"] == "figures"
    r = c.put("/api/projects/method/figures/fig1.emf", json={"width": -1})
    assert r.status_code == 422
    assert _md(projects) == before


# ---------------- PUT /{name}/image：整组换图（被引可换） ----------------

def _replace(c, pid, name, *files):
    return c.put(f"/api/projects/{pid}/figures/{name}/image",
                 files=[("files", (n, io.BytesIO(b), "image/png")) for n, b in files])


def test_replace_referenced_same_name(client):
    """被「图3」引用的 fig3.emf 同名字节替换 → 200（引用按编号不受影响），spec/删除守卫不拦。"""
    c, projects = client
    before = _studio(projects, "method")
    r = _replace(c, "method", "fig3.emf", ("fig3.emf", PNG))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["settings"] == before  # spec/abstract 未动
    assert (projects / "method" / "figs" / "fig3.emf").read_bytes() == PNG
    assert any(f["name"] == "fig3.emf" and f["num"] == 3 for f in j["figures"])


def test_replace_ext_change_rewrites_spec(client):
    """fig4.emf → 上传 fig4.png：主文件名变化 → spec.file 同步改，「图4」引用不受影响，旧组文件删除。"""
    from patent_docx import figures_md

    c, projects = client
    assert (projects / "method" / "figs" / "fig4.svg").exists()  # 种子伴生：换图未带即应删
    r = _replace(c, "method", "fig4.emf", ("fig4.png", PNG))
    assert r.status_code == 200, r.text
    j = r.json()
    doc = figures_md.read(str(projects / "method"))
    assert [f.file for f in doc.spec][3] == "fig4.png"
    assert j["settings"]["spec_figures"][3] == ["fig4.png", 15.0]
    assert not (projects / "method" / "figs" / "fig4.emf").exists()
    assert not (projects / "method" / "figs" / "fig4.svg").exists()  # 旧组未再传的伴生删除
    assert (projects / "method" / "figs" / "fig4.png").read_bytes() == PNG


def test_replace_group_with_companion(client):
    """fig2.emf+伴生组整组替换：emf 主文件 + 新 png 伴生 → preview/companions 反映新组。"""
    c, projects = client
    emf = (projects / "method" / "figs" / "fig2.emf").read_bytes()  # 真 emf 字节（probe_image 须可解）
    r = _replace(c, "method", "fig2.emf", ("fig2.emf", emf), ("fig2.png", PNG))
    assert r.status_code == 200, r.text
    f2 = next(f for f in r.json()["figures"] if f["name"] == "fig2.emf")
    assert "fig2.png" in f2["companions"] and f2["preview"] == "fig2.png"
    assert (projects / "method" / "figs" / "fig2.emf").read_bytes() == emf
    assert not (projects / "method" / "figs" / "fig2.svg").exists()  # 旧组伴生未再传 → 删除


def test_replace_rejects_wrong_stem_and_keeps_files(client):
    c, projects = client
    before_files = sorted(p.name for p in (projects / "method" / "figs").iterdir())
    before = _studio(projects, "method")
    r = _replace(c, "method", "fig3.emf", ("fig5.png", PNG))
    assert r.status_code == 422 and "同组" in r.json()["detail"]["message"]
    assert sorted(p.name for p in (projects / "method" / "figs").iterdir()) == before_files
    assert _studio(projects, "method") == before


def test_replace_rejects_undecodable_and_missing(client):
    c, _ = client
    r = _replace(c, "method", "fig3.emf", ("fig3.png", FAKE_PNG))
    assert r.status_code == 400 and "无法读取" in r.json()["detail"]
    assert c.put("/api/projects/method/figures/fig9.emf/image",
                 files=[("files", ("fig9.png", io.BytesIO(PNG), "image/png"))]).status_code == 404


# ---------------- figures-src：绘制图源（W16） ----------------

MMD = "flowchart TB\n  S101[\"接收请求 101\"]\n  S102[\"解析参数 102\"]\n  S101 --> S102\n"


def test_figsrc_crud(client):
    c, projects = client
    assert c.get("/api/projects/method/figures-src").json() == {"sources": []}
    r = c.put("/api/projects/method/figures-src/flow1.mmd", json={"source": MMD})
    assert r.status_code == 200 and r.json()["name"] == "flow1.mmd"
    assert (projects / "method" / "figs-src" / "flow1.mmd").read_text(encoding="utf-8") == MMD
    assert c.get("/api/projects/method/figures-src").json()["sources"][0]["name"] == "flow1.mmd"
    assert c.get("/api/projects/method/figures-src/flow1.mmd").json()["source"] == MMD
    r = c.delete("/api/projects/method/figures-src/flow1.mmd")
    assert r.status_code == 200 and r.json()["deleted"] == "flow1.mmd"
    assert c.get("/api/projects/method/figures-src/flow1.mmd").status_code == 404


def test_figsrc_validation(client):
    c, _ = client
    for bad in ("../x.mmd", "a/b.mmd", "noext", "中文.mmd", "x.mmd/extra"):
        assert c.put(f"/api/projects/method/figures-src/{bad}", json={"source": MMD}).status_code in (400, 404, 405)
    assert c.put("/api/projects/method/figures-src/ok.mmd", json={"source": "  \n"}).status_code == 400
    assert c.put("/api/projects/method/figures-src/ok.mmd",
                 json={"source": "x" * (256 * 1024 + 1)}).status_code == 413
    assert c.delete("/api/projects/method/figures-src/missing.mmd").status_code == 404


def test_figsrc_dedupe_same_num(tmp_path):
    """figN-<slug> 同号多源按 mtime 留最新——多轮 s1 各写不同 slug 变体不再全晋级
    （ddpm 实案：14 源渲成 图1..图14，附图说明只声明 5 图）。"""
    import types

    from app.domain import figures as fmod
    src_dir = tmp_path / "figs-src"
    src_dir.mkdir()
    for i, name in enumerate(["fig1-a.mmd", "fig1-b.mmd", "fig2-x.mmd", "free.mmd"]):
        p = src_dir / name
        p.write_text("x", encoding="utf-8")
        os.utime(p, (100 + i, 100 + i))  # fig1-b 最新
    proj = types.SimpleNamespace(figsrc_dir=str(src_dir))
    kept, losers = fmod._dedupe_figsrc(proj, fmod._figsrc_files(proj))
    assert kept == ["fig1-b.mmd", "fig2-x.mmd", "free.mmd"]
    assert losers == ["fig1-a.mmd"]


# ---------------- mmd 标签去引号 + 图块限高（往复轮74） ----------------

def test_mmd_quoted_labels_unwrapped():
    from patent_docx import mmd_render
    g = mmd_render.parse_mmd('flowchart TB\n  subgraph LG["图例"]\n  end\n'
                             '  A["微调模块 109"] -->|是否可行| B{"被遮盖替换策略"}\n')
    assert g.nodes["A"].label == "微调模块 109"
    assert g.nodes["B"].label == "被遮盖替换策略"
    assert g.clusters["LG"]["label"] == "图例"
    assert g.edges[0][2] == "是否可行"


def test_mmd_legend_box_not_clipped_off_canvas():
    """图例子图停角按画框外扩包围盒选角——修复前只按成员包围盒，顶部候选把
    簇标题/框边裁出画布（ddpm fig3 图例框冒顶实案）。修复后顶带应全白。"""
    from patent_docx import mmd_render
    src = (
        "flowchart TD\n"
        '  X["加噪图像输入"] --> DS["下采样子层"]\n'
        '  T["时间嵌入注入单元 107"] -->|时间嵌入注入| INJ((⊕))\n'
        "  DS --> INJ\n"
        '  INJ --> SA["自注意力层 106"]\n'
        '  SA --> US["上采样子层"]\n'
        "  DS -->|跳跃连接| CAT((⊕))\n"
        "  US --> CAT\n"
        '  CAT --> OUT["噪声预测输出"]\n'
        '  subgraph NET["去噪网络 104"]\n'
        '    subgraph UNET["U-Net骨干网络 105"]\n'
        "      DS\n      SA\n      US\n    end\n  end\n"
        "  subgraph LEG[图例]\n    L1((⊕ 特征相加))\n  end\n"
    )
    img = mmd_render.render_mmd(src).convert("L")
    w, _ = img.size
    # 修复前：图例簇标题/框边贴 y≈0 被裁——顶带出现黑像素；修复后停角留足 44·SS 标头
    assert img.crop((0, 0, w, 12)).getextrema()[0] > 200


def test_add_figure_clamps_tall_image(tmp_path):
    from io import BytesIO

    from docx.shared import Cm
    from PIL import Image

    from patent_docx.builder import PatentBuilder

    tall, wide = tmp_path / "tall.png", tmp_path / "wide.png"
    Image.new("RGB", (100, 400), "white").save(tall)
    Image.new("RGB", (400, 100), "white").save(wide)
    b = PatentBuilder()
    b.add_figure(str(tall), "图1", 15.0)
    b.add_figure(str(wide), "图2", 15.0)
    buf = BytesIO()
    b.doc.save(buf)
    xml = zipfile.ZipFile(BytesIO(buf.getvalue())).read("word/document.xml").decode()
    exts = re.findall(r'<wp:extent cx="(\d+)" cy="(\d+)"/>', xml)
    assert len(exts) == 2
    cmtall = Cm(19.5).emu
    assert int(exts[0][1]) == cmtall and int(exts[0][0]) < cmtall  # 纵图限高
    assert int(exts[1][0]) == Cm(15).emu  # 横图仍按宽


def test_promote_figsrc_claims_declared_positions(tmp_path, monkeypatch):
    """figN-<slug>.png 按图源名占位图号 N 而非节尾追加——convert 抽图占据 spec 1-4 时，
    5 张图源图仍落 图1-图5 声明位、抽图退素材；摘要图脱 spec 时回指首图（unet-seg 实案）。"""
    import types

    from app.domain import figures as fmod
    from patent_docx import figures_md, mmd_render

    proj_dir = tmp_path / "proj"
    (proj_dir / "figs").mkdir(parents=True)
    (proj_dir / "figs-src").mkdir()
    (proj_dir / "content.md").write_text(
        "### 附图说明\n\n" + "\n\n".join(f"图{i}为新图{i}。" for i in range(1, 6)),
        encoding="utf-8")
    for n in ("fig1.tiff", "fig2.png", "fig3.png", "fig4.png"):
        (proj_dir / "figs" / n).write_bytes(b"img")
    figures_md.write(str(proj_dir), figures_md.FiguresDoc(
        spec=[figures_md.Figure(file=n, width=15)
              for n in ("fig1.tiff", "fig2.png", "fig3.png", "fig4.png")],
        abstract=figures_md.Figure(file="fig1.tiff", width=14.5)))
    for i, s in enumerate(("flow", "arch", "tile", "weight", "aug"), 1):
        (proj_dir / "figs-src" / f"fig{i}-{s}.mmd").write_text("flowchart TB\nA-->B",
                                                             encoding="utf-8")
    proj = types.SimpleNamespace(dir=str(proj_dir),
                                 figs_dir=str(proj_dir / "figs"),
                                 figsrc_dir=str(proj_dir / "figs-src"))
    store = types.SimpleNamespace(get=lambda pid: proj,
                                  read_content=lambda pid: (
                                      proj_dir / "content.md").read_text(encoding="utf-8"))
    monkeypatch.setattr(mmd_render, "render_to",
                        lambda src, tgt: open(tgt, "wb").write(b"png"))
    monkeypatch.setattr(fmod, "_derived_png_fresh", lambda tgt, src, src_name="": False)

    rendered = fmod.promote_figure_sources(store, "x")
    assert len(rendered) == 5
    doc = figures_md.read(str(proj_dir))
    assert [f.file for f in doc.spec] == [
        "fig1-flow.png", "fig2-arch.png", "fig3-tile.png",
        "fig4-weight.png", "fig5-aug.png"]
    assert doc.abstract.file == "fig1-flow.png"
    # 抽图退素材：文件还在 figs/ 但不再进附图节
    assert (proj_dir / "figs" / "fig1.tiff").exists()


def test_promote_figsrc_nonnumbered_appends(tmp_path, monkeypatch):
    """非 figN- 前缀图源仍按序追加到节尾——既有收录不被打乱。"""
    import types

    from app.domain import figures as fmod
    from patent_docx import figures_md, mmd_render

    proj_dir = tmp_path / "proj"
    (proj_dir / "figs").mkdir(parents=True)
    (proj_dir / "figs-src").mkdir()
    (proj_dir / "content.md").write_text("### 附图说明\n\n图1为旧图一。\n\n图2为新图二。",
                                       encoding="utf-8")
    (proj_dir / "figs" / "fig1.png").write_bytes(b"img-not-template")
    figures_md.write(str(proj_dir), figures_md.FiguresDoc(
        spec=[figures_md.Figure(file="fig1.png", width=15)],
        abstract=figures_md.Figure(file="fig1.png", width=14.5)))
    (proj_dir / "figs-src" / "free-style.mmd").write_text("flowchart TB\nA-->B",
                                                        encoding="utf-8")
    proj = types.SimpleNamespace(dir=str(proj_dir),
                                 figs_dir=str(proj_dir / "figs"),
                                 figsrc_dir=str(proj_dir / "figs-src"))
    store = types.SimpleNamespace(get=lambda pid: proj,
                                  read_content=lambda pid: (
                                      proj_dir / "content.md").read_text(encoding="utf-8"))
    monkeypatch.setattr(mmd_render, "render_to",
                        lambda src, tgt: open(tgt, "wb").write(b"png"))
    monkeypatch.setattr(fmod, "_derived_png_fresh", lambda tgt, src, src_name="": False)

    fmod.promote_figure_sources(store, "x")
    doc = figures_md.read(str(proj_dir))
    assert [f.file for f in doc.spec] == ["fig1.png", "free-style.png"]
    assert doc.abstract.file == "fig1.png"


def test_mmd_chained_edges_expand():
    """往复轮102：mmd 链式边 `A -->|x| B -->|y| C` 逐段展开——unet-seg fig2 实案
    （模型整行链式 21 节点仅 4 边存活、rank0 塌条）。扇出 `A & B --> C` 仍走旧路。"""
    from patent_docx import mmd_render
    src = ('flowchart TD\n'
           '  IN[输入] --> D1[单元1] -->|下采样| D2[单元2] -->|下采样| DB[瓶颈]\n'
           '  DB --> U[上卷积] --> J((⊕ 拼接)) --> E[卷积] --> OUT[输出]\n'
           '  D1 -->|裁剪拼接| J\n')
    g = mmd_render.parse_mmd(src)
    pairs = {(a, b) for a, b, _ in g.edges}
    assert {('IN', 'D1'), ('D1', 'D2'), ('D2', 'DB'), ('DB', 'U'),
            ('U', 'J'), ('J', 'E'), ('E', 'OUT'), ('D1', 'J')} <= pairs
    labs = {l for _, _, l in g.edges}
    assert '下采样' in labs and '裁剪拼接' in labs
    # & 扇出不进链式切分
    g2 = mmd_render.parse_mmd('flowchart TD\n  A & B --> C\n')
    assert {(a, b) for a, b, _ in g2.edges} == {('A', 'C'), ('B', 'C')}
    # 虚线带标签链
    g3 = mmd_render.parse_mmd('flowchart TD\n  A -.级联.-> B -.再传.-> C\n')
    assert g3.edges == [('A', 'B', '级联'), ('B', 'C', '再传')]


def test_mmd_serial_nodes_centered_on_axis():
    """往复轮103：串联节点按带内轴心居中——unet-seg fig2/3 实案
    （旧按左缘顺排、宽差节点中心错位，串联边只能斜画）。"""
    from patent_docx import mmd_render
    src = ('flowchart TD\n'
           '  A[短] --> B[一个很长很长的节点标签] -->|步骤| C[中]\n'
           '  P[并联甲] --> Q[汇合]\n'
           '  R[并联乙] --> Q\n')
    img = mmd_render.render_mmd(src, engine="pil")
    g = img.graph
    def cx(n):
        return n.x + n.w / 2
    A, B, C = (g.nodes[i] for i in 'ABC')
    assert abs(cx(A) - cx(B)) < mmd_render.SS * 20   # 串联链垂直共轴（旧左排 A 中心必偏左 >半个 B 宽）
    assert abs(cx(B) - cx(C)) < mmd_render.SS * 20
    P_, R_, Q_ = (g.nodes[i] for i in ('P', 'R', 'Q'))
    lo, hi = min(P_.x, R_.x), max(P_.x + P_.w, R_.x + R_.w)
    assert abs((lo + hi) / 2 - cx(Q_)) < (hi - lo) * 0.3   # 并联组中心对中到下游


def test_mmd_giant_cluster_band_split():
    """往复轮106a：跨大半 rank 轴的巨簇禁劈带会把串行长链焊成细条——
    yolo fig3 实案（12 层全包 subgraph → 3606×548）。带退化时放开巨簇，
    簇框按带分段出框。"""
    from patent_docx import mmd_render
    chain = ' -->|x| '.join(f'L{i}[层{i}]' for i in range(1, 13))
    src = ('flowchart LR\n'
           '  subgraph NET[网络 103]\n    ' + chain + '\n  end\n'
           '  IN[输入] -->|输入| L1\n'
           '  L12 -->|输出| OUT[输出]\n')
    img = mmd_render.render_mmd(src, engine="pil")
    w, h = img.size
    assert max(w, h) / min(w, h) < 5.0            # 不再塌成单条
    g = img.graph
    bands = {g.nodes[f'L{i}']._band for i in range(1, 13)}
    assert len(bands) >= 2                        # 巨簇被分段
    edges = {e[:2] for e in g.edges}
    assert ('IN', 'L1') in edges and ('L12', 'OUT') in edges


def test_mmd_bidir_edge_parses_and_draws():
    """往复轮106b：`A <-->|lab| B` 双向边整体丢失根修——ddpm fig5 实案
    CPU <-->|程序执行与数据读写| MEM 曾整条丢边，处理器孤悬图外。"""
    from patent_docx import mmd_render
    src = ('flowchart TB\n'
           '  subgraph MEM[存储器]\n'
           '    PG1[程序单元 101]\n    PG2[程序单元 102]\n  end\n'
           '  CPU[处理器] <-->|读写| MEM\n')
    g = mmd_render.parse_mmd(src)
    assert ('CPU', 'MEM', '读写') in g.edges      # 双向边不再丢失
    assert ('CPU', 'MEM') in g.bidir
    img = mmd_render.render_mmd(src, engine="pil")
    g2 = img.graph
    # 无边簇成员并入簇分量——单点分量各成窗口曾是横排细条元凶
    assert {g2.nodes[i]._comp for i in ('CPU', 'PG1', 'PG2', 'MEM')} == {0}


def test_mmd_edge_to_cluster_routes_members_rank():
    """往复轮106c：边指簇 id 时簇成员随幽灵端点沉层——CPU-->MEM 让
    存储器整体在处理器之下，不与 CPU 同排。"""
    from patent_docx import mmd_render
    src = ('flowchart TB\n'
           '  subgraph MEM[存储器]\n'
           '    PG1[单元甲]\n    PG2[单元乙]\n  end\n'
           '  CPU[处理器] -->|读写| MEM\n')
    img = mmd_render.render_mmd(src, engine="pil")
    g = img.graph
    assert g.nodes['CPU'].rank < g.nodes['PG1'].rank
    assert g.nodes['PG1'].rank == g.nodes['PG2'].rank


def test_promote_figsrc_image_to_grayscale_png(tmp_path, monkeypatch):
    """往复轮104：figs-src 图片源晋级——PIL 转灰度 PNG 占图号位（CNIPA 附图不得彩色；
    unet-seg 论文抽出的结果照片 fig4.png 彩图 512² 实案）。"""
    import types

    from PIL import Image

    from app.domain import figures as fmod
    from patent_docx import figures_md

    proj_dir = tmp_path / "proj"
    (proj_dir / "figs").mkdir(parents=True)
    (proj_dir / "figs-src").mkdir()
    (proj_dir / "content.md").write_text(
        "### 附图说明\n\n图1为流程图。\n\n图2为分割结果照片。", encoding="utf-8")
    img = Image.new("RGB", (32, 24), (200, 30, 40))
    img.save(proj_dir / "figs-src" / "fig2-seg-result.png")
    (proj_dir / "figs-src" / "fig1-flow.mmd").write_text("flowchart TB\nA-->B",
                                                       encoding="utf-8")
    proj = types.SimpleNamespace(dir=str(proj_dir),
                                 figs_dir=str(proj_dir / "figs"),
                                 figsrc_dir=str(proj_dir / "figs-src"))
    store = types.SimpleNamespace(get=lambda pid: proj,
                                  read_content=lambda pid: (
                                      proj_dir / "content.md").read_text(encoding="utf-8"))
    from patent_docx import mmd_render
    monkeypatch.setattr(mmd_render, "render_to",
                        lambda src, tgt: open(tgt, "wb").write(b"png"))

    rendered = fmod.promote_figure_sources(store, "x")
    assert "fig2-seg-result.png" in rendered
    with Image.open(proj_dir / "figs" / "fig2-seg-result.png") as out:
        assert out.mode == "L"          # 彩色源已归一灰度
        assert out.size == (32, 24)
    doc = figures_md.read(str(proj_dir))
    assert [f.file for f in doc.spec] == ["fig1-flow.png", "fig2-seg-result.png"]


def test_figsrc_image_source_upload_and_delete(tmp_path):
    """往复轮104：save_figure_image_source 收二进制写图，.mmd 名拒收走文本口。"""
    import types

    from app.domain import figures as fmod

    proj_dir = tmp_path / "proj"
    proj_dir.mkdir()
    proj = types.SimpleNamespace(dir=str(proj_dir),
                                 figsrc_dir=str(proj_dir / "figs-src"))
    store = types.SimpleNamespace(get=lambda pid: proj)

    out = fmod.save_figure_image_source(store, "x", "fig3-photo.tiff", b"\x00\x01binary")
    assert out["name"] == "fig3-photo.tiff"
    assert (proj_dir / "figs-src" / "fig3-photo.tiff").read_bytes() == b"\x00\x01binary"
    from app.domain.projects import ProjectError
    with pytest.raises(ProjectError):
        fmod.save_figure_image_source(store, "x", "fig3-x.mmd", b"flowchart TB\nA-->B")
    assert fmod.delete_figure_source(store, "x", "fig3-photo.tiff")["deleted"] == "fig3-photo.tiff"


def test_promote_figsrc_spec_renders_png_with_tag(tmp_path):
    """.spec 图源晋级：promote 调 render_spec_to（JSON 字符串路径）出 PNG 并打
    figspec_version 印记——回归 render_figspec 对 str 输入崩 'str' object
    has no attribute 'get' 的缺陷（E2E 实测：PUT .spec→构建→PNG 不重渲）。"""
    import json
    import types

    from app.domain import figures as fmod
    from patent_docx import figures_md, figspec
    from PIL import Image

    proj_dir = tmp_path / "proj"
    (proj_dir / "figs").mkdir(parents=True)
    (proj_dir / "figs-src").mkdir()
    (proj_dir / "content.md").write_text("### 附图说明\n\n图1为分层框图。", encoding="utf-8")
    figures_md.write(str(proj_dir), figures_md.FiguresDoc(spec=[], abstract=None))
    spec = {"bands": [{"title": "输入层", "blocks": [{"id": "A", "label": "输入模块 101"}]},
                      {"title": "输出层", "blocks": [{"id": "B", "label": "输出模块 102"}]}],
            "edges": [{"from": "A", "to": "B"}]}
    (proj_dir / "figs-src" / "fig1-net.spec").write_text(
        json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    proj = types.SimpleNamespace(dir=str(proj_dir),
                                 figs_dir=str(proj_dir / "figs"),
                                 figsrc_dir=str(proj_dir / "figs-src"))
    store = types.SimpleNamespace(get=lambda pid: proj,
                                  read_content=lambda pid: (
                                      proj_dir / "content.md").read_text(encoding="utf-8"))

    rendered = fmod.promote_figure_sources(store, "x")
    assert rendered == ["fig1-net.png"]
    tgt = proj_dir / "figs" / "fig1-net.png"
    assert tgt.exists()
    with Image.open(tgt) as im:
        assert im.info.get("figspec_version") == figspec.RENDER_VERSION
    doc = figures_md.read(str(proj_dir))
    assert [f.file for f in doc.spec] == ["fig1-net.png"]


def test_preview_figure_source_spec_and_mmd(tmp_path):
    """preview_figure_source：{开头走 figspec，其余走 mmd_render；坏图源 → ProjectError。"""
    import types

    from app.domain import figures as fmod
    from app.domain.projects import ProjectError
    from PIL import Image

    proj = types.SimpleNamespace(dir=str(tmp_path))
    store = types.SimpleNamespace(get=lambda pid: proj)

    spec = json.dumps({"bands": [{"title": "层", "blocks": [{"id": "A", "label": "输入 101"}]}],
                       "edges": []}, ensure_ascii=False)
    png = fmod.preview_figure_source(store, "x", spec)
    with Image.open(io.BytesIO(png)) as im:
        assert im.format == "PNG" and im.width > 0

    mmd_png = fmod.preview_figure_source(store, "x", "flowchart TB\n  A[输入] --> B[输出]\n")
    with Image.open(io.BytesIO(mmd_png)) as im:
        assert im.format == "PNG" and im.width > 0

    with pytest.raises(ProjectError):
        fmod.preview_figure_source(store, "x", "")
    with pytest.raises(ProjectError):
        fmod.preview_figure_source(store, "x", "not-a-diagram @@@")


def test_mmd_to_spec_convert(tmp_path):
    """mmd_to_spec_source：subgraph→band / rank→层 / -.->→dashed / diamond 全携带；
    坏图源 → ProjectError。"""
    import types

    from app.domain import figures as fmod
    from app.domain.projects import ProjectError

    proj = types.SimpleNamespace(dir=str(tmp_path))
    store = types.SimpleNamespace(get=lambda pid: proj)

    mmd = """flowchart TB
  subgraph SG[网络层]
    A[学生网络 101] --> B[投影头 102]
  end
  X[输入 100] --> A
  B -.参数更新.-> A
  D{判据} --> X
"""
    out = json.loads(fmod.mmd_to_spec_source(store, "x", mmd))
    titles = [b["title"] for b in out["bands"]]
    assert "网络层" in titles
    ids = {blk["id"] for band in out["bands"] for blk in band["blocks"]}
    assert ids == {"A", "B", "X", "D"}
    shapes = {blk["id"]: blk.get("shape") for band in out["bands"] for blk in band["blocks"]}
    assert shapes["D"] == "diamond" and shapes["A"] is None
    edged = {(e["from"], e["to"], e.get("dashed", False)) for e in out["edges"]}
    assert ("B", "A", True) in edged and ("X", "A", False) in edged
    # 转出结果本身就是合法 spec
    from patent_docx import figspec
    assert figspec.validate_figspec(out) is None
    # 转出的 spec 可直接渲染
    img = figspec.render_figspec(json.dumps(out))
    assert img.width > 0

    lr = fmod.mmd_to_spec_source(store, "x", "flowchart LR\n  A --> B --> C\n")
    lo = json.loads(lr)
    assert len(lo["bands"]) == 1 and [b["id"] for b in lo["bands"][0]["blocks"]] == ["A", "B", "C"]

    with pytest.raises(ProjectError):
        fmod.mmd_to_spec_source(store, "x", "")
    with pytest.raises(ProjectError):
        fmod.mmd_to_spec_source(store, "x", "%%%")


def test_figspec_weight_and_spacer():
    """weight 拉宽块、spacer 隐形占位且可作汇边节点——回归声明式布局旋钮。"""
    import json

    from patent_docx import figspec

    base = {"bands": [{"title": "", "blocks": [{"id": "A", "label": "模块一"},
                                             {"id": "B", "label": "模块二"}]}],
            "edges": []}
    weighted = {"bands": [{"title": "", "blocks": [{"id": "A", "label": "模块一", "weight": 3},
                                                 {"id": "B", "label": "模块二"}]}],
                "edges": []}
    # parse 保留 weight（=1 不写出，!=1 携带）
    g = figspec.parse_figspec(weighted)
    assert g["bands"][0]["blocks"][0]["weight"] == 3.0
    assert "weight" not in g["bands"][0]["blocks"][1]
    g1, g3 = figspec.parse_figspec(base), figspec.parse_figspec(weighted)
    figspec.render_figspec(g1)
    figspec.render_figspec(g3)
    aw1 = g1["nodes"]["A"]["_b"]["w"]
    aw3 = g3["nodes"]["A"]["_b"]["w"]
    assert aw3 > aw1 * 2  # weight=3 明显拉宽

    # spacer：隐形占位、不占文字、可作边端点
    sp = {"bands": [{"title": "", "blocks": [{"id": "A", "label": "左"},
                                            {"id": "S", "label": "", "shape": "spacer", "weight": 2},
                                            {"id": "B", "label": "右"}]}],
          "edges": [{"from": "A", "to": "S"}, {"from": "S", "to": "B"}]}
    assert figspec.validate_figspec(sp) is None
    img = figspec.render_figspec(sp)
    assert img.width > 0
    gs = figspec.parse_figspec(sp)
    figspec.render_figspec(gs)
    assert gs["nodes"]["S"]["_b"]["_lines"] == []
    # 非法 weight
    assert figspec.validate_figspec({"bands": [{"blocks": [{"id": "A", "weight": 0}]}]}) is not None
    assert figspec.validate_figspec({"bands": [{"blocks": [{"id": "A", "weight": "x"}]}]}) is not None


def test_spec_templates_all_render():
    """spec_templates 模板库：12 类骨架全部过校验+可渲染，catalog 非空。"""
    from patent_docx import figspec, spec_templates

    assert len(spec_templates.TEMPLATES) >= 10
    for name, t in spec_templates.TEMPLATES.items():
        assert t["kind"] and t["when"], name
        assert figspec.validate_figspec(t["spec"]) is None, name
        img = figspec.render_figspec(t["spec"])
        assert img.width > 0 and img.height > 0, name
    cat = spec_templates.catalog()
    for name in spec_templates.TEMPLATES:
        assert name in cat
    assert spec_templates.get("method_flow") is not None
    assert spec_templates.get("nonexist") is None


# ---------------- 附图图库（docs/figure-library 只读） ----------------

def test_figlib_manifest_and_image(client):
    c, _ = client
    import json
    from app.routes import figlib

    m = json.loads((figlib.LIB_DIR / "manifest.json").read_text(encoding="utf-8"))
    r = c.get("/api/figlib")
    assert r.status_code == 200
    body = r.json()
    assert body["figures"] == m["figures"]
    f = m["figures"][0]
    r2 = c.get(f"/api/figlib/img/{f['file']}")
    assert r2.status_code == 200 and r2.headers["content-type"] == "image/png"
    assert r2.content[:8] == bytes.fromhex("89504e470d0a1a0a")


def test_figlib_traversal(client):
    c, _ = client
    assert c.get("/api/figlib/img/../../main.py").status_code in (404, 422)
    assert c.get("/api/figlib/img/nope/x.png").status_code == 404
