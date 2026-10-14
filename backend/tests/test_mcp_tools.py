# -*- coding: utf-8 -*-
"""W4-E E3-mcp-tools（docs/plan/17 §4.2–4.4）：7 个管理工具 + 5 个语义工具，全部经官方 MCP 客户端调用两案。

- stdio（AUTH=off）：get_case / set_case_status / list_attachments / read_attachment_text / 五个语义工具，
  method 与 system 两案都跑；断言值来自 examples 两案的 preflight 实测（同 scripts/mcp_eval_questions.json 标准答案）。
- HTTP（AUTH=on）：ACL —— viewer 调 set_case_status / set_figure_width 403（error:forbidden 进审计），owner 可写，
  语义工具 viewer 可读；set_case_status 的 git 提交作者 = PAT 绑定用户。
"""

import asyncio
import importlib
import json
import os
import shutil

import test_mcp
from mcp.client.client import Client

from app.domain import comments, history
from app.mcp import audit, schemas

ROOT = test_mcp.ROOT
DOCX_FIXTURE = os.path.join(test_mcp.BACKEND, "tests", "fixtures", "import_native.docx")
SEMANTIC = ("get_claim_tree", "get_support_map", "get_figures", "get_terms", "context_pack")


def _pdf(text: str) -> bytes:
    """最小的未压缩单页 PDF（Helvetica，ASCII 正文），pdftotext 可读。"""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out.encode()))
        out += f"{i} 0 obj\n{o}\nendobj\n"
    xref = len(out.encode())
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offs)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    return out.encode()


def _projects(tmp_path):
    """两案都复制（test_mcp._projects 只有 method）；method 放四种附件。"""
    projects = tmp_path / "projects"
    projects.mkdir()
    for pid in ("method", "system"):
        shutil.copytree(
            os.path.join(ROOT, "examples", pid),
            projects / pid,
            ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"),
        )
    att = projects / "method" / "attachments"
    att.mkdir()
    shutil.copy(DOCX_FIXTURE, att / "prior.docx")
    (att / "note.md").write_text("# 交底书\n\n" + "一段文字。" * 50, encoding="utf-8")
    (att / "prior.pdf").write_bytes(_pdf("Prior art PS-E3 hello"))
    (att / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    return projects


def _call(c, name, args):
    async def go():
        return (await c.call_tool(name, args)).structured_content

    return go()


def _size(obj) -> int:
    """与 pydantic model_dump_json 同为紧凑序列化（max_chars 按它算）。"""
    return len(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def _rows(sc):
    """list 返回体被 SDK 包成 {"result": [...]}。"""
    return sc["result"] if isinstance(sc, dict) and set(sc) == {"result"} else sc


# ---------------------------------------------------------------- stdio / AUTH=off ----


def test_stdio_case_and_attachments_both_projects(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)

    async def run():
        out = {}
        async with Client(test_mcp._stdio_params(projects)) as c:
            for pid in ("method", "system"):
                out[f"case_{pid}"] = await _call(c, "get_case", {"pid": pid})
            out["set"] = await _call(c, "set_case_status", {"pid": "method", "status": "filed", "note": "递交完成"})
            out["set_same"] = test_mcp._tool_error(
                await c.call_tool("set_case_status", {"pid": "method", "status": "filed"})
            )
            out["set_bad"] = await c.call_tool("set_case_status", {"pid": "method", "status": "nope"})
            out["after"] = await _call(c, "get_case", {"pid": "method"})
            out["atts"] = await _call(c, "list_attachments", {"pid": "method"})
            out["atts_sys"] = await _call(c, "list_attachments", {"pid": "system"})
            for n in ("prior.docx", "note.md", "prior.pdf"):
                out[n] = await _call(c, "read_attachment_text", {"pid": "method", "name": n})
            out["md_cut"] = await _call(
                c, "read_attachment_text", {"pid": "method", "name": "note.md", "max_chars": 20}
            )
            out["png"] = test_mcp._tool_error(
                await c.call_tool("read_attachment_text", {"pid": "method", "name": "pic.png"})
            )
            out["missing"] = test_mcp._tool_error(
                await c.call_tool("read_attachment_text", {"pid": "method", "name": "x.docx"})
            )
            out["bad_pid"] = test_mcp._tool_error(await c.call_tool("get_case", {"pid": "nope"}))
        return out

    o = asyncio.run(run())

    for pid in ("method", "system"):
        assert o[f"case_{pid}"]["status"] == "drafting" and "next_deadline" in o[f"case_{pid}"]
    assert o["set"]["status"] == "filed" and o["after"]["status"] == "filed"
    assert o["set_same"]["kind"] == "conflict"
    assert o["set_bad"].is_error  # Literal 校验：非法状态在参数层被拒
    assert o["bad_pid"]["kind"] == "not_found"
    log = history.log(str(projects / "method"))
    assert (
        log
        and log[0]["message"].startswith("case:")
        and "drafting" in log[0]["message"]
        and "filed" in log[0]["message"]
        and "递交完成" in log[0]["message"]
    )

    assert [a["name"] for a in o["atts"]["items"]] == ["note.md", "pic.png", "prior.docx", "prior.pdf"]
    assert o["atts_sys"] == {"items": []}
    assert (
        o["prior.docx"]["kind"] == "docx"
        and "示例装置" in o["prior.docx"]["text"]
        and "权利要求1所述的示例装置" in o["prior.docx"]["text"]
        and not o["prior.docx"]["truncated"]
    )
    assert o["note.md"]["kind"] == "text" and o["note.md"]["text"].startswith("# 交底书")
    if shutil.which("pdftotext"):  # pdf 抽取依赖 poppler-utils，本机缺失时走 unsupported 分支
        assert o["prior.pdf"]["kind"] == "pdf" and "Prior art PS-E3 hello" in o["prior.pdf"]["text"]
    else:  # 无 poppler：工具按 unsupported 失败关闭（审计行已断言 error:unsupported）
        assert o["prior.pdf"] is None
    assert o["md_cut"]["truncated"] and len(o["md_cut"]["text"]) == 20 and o["md_cut"]["chars"] == o["note.md"]["chars"]
    assert o["png"]["kind"] == "unsupported" and o["png"]["detail"] == "pic.png"
    assert o["missing"]["kind"] == "not_found"

    rows = {(r["tool"], r["result"]) for r in audit.tail(str(projects / "method"), 200)}
    assert {
        ("get_case", "ok"),
        ("set_case_status", "ok"),
        ("set_case_status", "error:conflict"),
        ("list_attachments", "ok"),
        ("read_attachment_text", "ok"),
        ("read_attachment_text", "ok:truncated"),
        ("read_attachment_text", "error:unsupported"),
        ("read_attachment_text", "error:not_found"),
    } <= rows


def test_stdio_semantic_tools_both_projects(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)

    async def run():
        out = {}
        async with Client(test_mcp._stdio_params(projects)) as c:
            for pid in ("method", "system"):
                for name in SEMANTIC[:4]:
                    out[f"{pid}.{name}"] = _rows(await _call(c, name, {"pid": pid}))
            out["m.pack7"] = await _call(c, "context_pack", {"pid": "method", "claim_id": "7"})
            out["m.pack3"] = await _call(c, "context_pack", {"pid": "method", "claim_id": "claims/3"})
            out["s.pack3_small"] = await _call(c, "context_pack", {"pid": "system", "claim_id": "3", "max_chars": 3000})
            out["s.pack3"] = await _call(c, "context_pack", {"pid": "system", "claim_id": "3", "max_chars": 40000})
            out["s.pack2"] = await _call(c, "context_pack", {"pid": "system", "claim_id": "2"})
            out["nf"] = test_mcp._tool_error(await c.call_tool("context_pack", {"pid": "method", "claim_id": "99"}))
            out["nf2"] = test_mcp._tool_error(await c.call_tool("context_pack", {"pid": "method", "claim_id": "abc"}))
            out["bad_pid"] = test_mcp._tool_error(await c.call_tool("get_terms", {"pid": "nope"}))
        return out

    o = asyncio.run(run())

    # 权利要求树：独立项（无引用/多引用择一）为根，从属项嵌套（新语料：M=10 权 S=3 权）
    def flat(nodes):
        for n in nodes:
            yield n
            yield from flat(n["children"])

    m_tree = o["method.get_claim_tree"]
    assert [n["num"] for n in m_tree] == [1, 8, 9, 10]
    assert sorted(n["num"] for n in flat(m_tree)) == list(range(1, 11))
    by = {n["num"]: n for n in flat(m_tree)}
    assert by[2]["refs"] == [1] and by[3]["refs"] == [2] and by[6]["refs"] == [5]
    assert by[10]["refs"] == list(range(1, 8))  # 权10 择一引用 1～7 → 独立根
    assert [c["num"] for c in by[1]["children"]] == [2, 5, 7]
    assert [c["num"] for c in by[2]["children"]] == [3, 4] and [c["num"] for c in by[5]["children"]] == [6]
    assert all(not n["issues"] for n in by.values())  # 新语料权项无引用类诊断
    assert by[1]["text"].startswith("1.一种") and by[1]["category"].endswith("方法")
    s_tree = o["system.get_claim_tree"]
    assert [n["num"] for n in s_tree] == [1, 3]
    by_s = {n["num"]: n for n in flat(s_tree)}
    assert [c["num"] for c in by_s[1]["children"]] == [2] and by_s[2]["refs"] == [1]
    assert by_s[1]["text"].startswith("1.神经网络模型的可视化建模方法")

    # 支持性：新语料权项术语均有说明书支持
    rows = o["system.get_support_map"]
    assert set(rows[0]) == set(schemas.SupportRow.model_fields)
    assert all(r["supported"] for r in rows)
    assert all(r["supported"] for r in o["method.get_support_map"])

    # 附图标记表：figures × numerals（新语料 M=3 图无标记；S=6 图带标记号段）
    m_figs = {f["num"]: f for f in o["method.get_figures"]}
    assert sorted(m_figs) == [1, 2, 3] and m_figs[1]["file"] == "fig1.png" and m_figs[1]["caption"] is not None
    s_figs = {f["num"]: f for f in o["system.get_figures"]}
    assert sorted(s_figs) == [1, 2, 3, 4, 5, 6]
    assert [m["num"] for m in s_figs[3]["markers"]] == ["204", "206"]
    assert [m["num"] for m in s_figs[4]["markers"]] == ["218", "220", "221", "223"]
    assert [m["num"] for m in s_figs[5]["markers"]] == ["601", "602", "603", "604"]
    assert [m["num"] for m in s_figs[6]["markers"]] == ["601", "602", "603", "604"]

    # 术语：定义句取说明书/权项「X 为 …」，claims 来自 support_map
    tm = {r["name"]: r for r in o["method.get_terms"]}
    assert set(tm["私钥生成方法作"]) == set(schemas.TermRow.model_fields)
    assert "智能合约" in tm["私钥生成方法作"]["definition"] and tm["私钥生成方法作"]["definition_line"]
    assert tm["私钥生成方法作"]["claims"] == [10]
    assert tm["私钥生成方法"]["claims"] == [2, 3, 4, 5, 6, 7]
    ts_ = {r["name"]: r for r in o["system.get_terms"]}
    assert "接口" in ts_["深度学习框架"]["definition"] and ts_["深度学习框架"]["claims"] == [1, 3]
    assert {r["name"] for r in o["system.get_terms"]} >= {"可视化控件", "节点集合", "依赖关系集合"}

    # context_pack：正文 + 依赖链 + 支持段落（段号）+ 附图 + 术语 + 未决批注 + 诊断
    p7 = o["m.pack7"]
    assert set(p7) == set(schemas.ContextPack.model_fields) and p7["pid"] == "method"
    assert p7["claim"]["num"] == 7 and p7["claim"]["children"] == []
    assert [c["num"] for c in p7["chain"]] == [1]
    assert p7["support"] and all(s["para_no"].startswith("[00") and s["text"] and s["terms"] for s in p7["support"])
    assert p7["support"] == sorted(p7["support"], key=lambda s: s["line"])
    assert p7["comments"] == [] and _size(p7) <= 12000
    assert o["m.pack3"]["claim"]["num"] == 3 and [c["num"] for c in o["m.pack3"]["chain"]] == [1, 2]
    p3s = o["s.pack3"]
    assert [c["num"] for c in p3s["chain"]] == [] and not p3s["truncated"]
    assert {f["num"] for f in p3s["figures"]} == {5, 6}  # 权3（装置）支持段引用图5/图6
    small = o["s.pack3_small"]
    assert small["truncated"] and small["claim"] == p3s["claim"] and small["chain"] == p3s["chain"]
    assert len(small["support"]) < len(p3s["support"]) and _size(small) <= 3000 + 600
    p2 = o["s.pack2"]
    assert p2["claim"]["num"] == 2 and [c["num"] for c in p2["chain"]] == [1]
    assert any("深度学习框架" in s["text"] for s in p2["support"])
    assert o["nf"]["kind"] == "not_found" and o["nf2"]["kind"] == "not_found" and o["bad_pid"]["kind"] == "not_found"

    rows = {(r["tool"], r["result"]) for r in audit.tail(str(projects / "method"), 200)}
    assert {(n, "ok") for n in SEMANTIC} <= rows and ("context_pack", "error:not_found") in rows
    # 截断调用落在 system 案 → 审计也记在 system 侧
    srows = {(r["tool"], r["result"]) for r in audit.tail(str(projects / "system"), 200)}
    assert ("context_pack", "ok:truncated") in srows


def test_stdio_context_pack_comments_unresolved_only(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    d = str(projects / "method")

    async def run():
        async with Client(test_mcp._stdio_params(projects)) as c:
            keep = await _call(
                c,
                "add_comment",
                {
                    "pid": "method",
                    "body": "冷启动阶段的定义要写进说明书",
                    "anchor": {"block_id": "claims/8", "line": 37, "quote": "冷启动"},
                },
            )
            done = await _call(
                c,
                "add_comment",
                {"pid": "method", "body": "已处理", "anchor": {"block_id": "claims/8", "line": 37, "quote": "冷启动"}},
            )
            other = await _call(
                c,
                "add_comment",
                {"pid": "method", "body": "别的权项", "anchor": {"block_id": "claims/2", "line": 15, "quote": "根据"}},
            )
            store = comments.load(d)
            comments.resolve(next(x for x in store if x.id == done["id"]), True)
            comments.save(d, store)
            pack = await _call(c, "context_pack", {"pid": "method", "claim_id": "8"})
            return keep, done, other, pack

    keep, done, other, pack = asyncio.run(run())
    assert [c["id"] for c in pack["comments"]] == [keep["id"]]
    assert pack["comments"][0]["text"] == "冷启动阶段的定义要写进说明书" and pack["comments"][0]["book"] == "claims"
    assert set(pack["comments"][0]) == {"id", "book", "line", "quote", "text", "author", "created_at"}


# ---------------------------------------------------------------- HTTP / AUTH=on ----


def _reload_on(tmp_path, monkeypatch):
    """test_mcp._reload_app 之后再重载四个工具模块 + server + main：它们持有的 tools.open_project_for /
    run_audited 必须是重载后 app.domain.projects.ProjectError 的那一份。"""
    from app import main
    from app.mcp import server, tools_attachments, tools_case, tools_figures, tools_semantic

    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(_projects(tmp_path)))
    monkeypatch.setenv("PATENT_STUDIO_AUTH", "on")
    monkeypatch.setenv("PATENT_STUDIO_SECRET", test_mcp.SECRET)
    test_mcp._reload_app()
    for m in (tools_figures, tools_case, tools_attachments, tools_semantic, server):
        importlib.reload(m)
    return importlib.reload(main)


def test_on_http_acl_and_author(tmp_path, monkeypatch):
    main = _reload_on(tmp_path, monkeypatch)
    projects = tmp_path / "projects"
    try:
        su, owner, viewer = test_mcp._users(main)
        owner_tok, viewer_tok = test_mcp._pat(owner)["token"], test_mcp._pat(viewer)["token"]

        async def run(base):
            out = {}
            async with test_mcp._http_client(base, viewer_tok) as c:
                out["v_case"] = await _call(c, "get_case", {"pid": "method"})
                out["v_figs"] = await _call(c, "list_figures", {"pid": "method"})
                out["v_atts"] = await _call(c, "list_attachments", {"pid": "method"})
                out["v_pack"] = await _call(c, "context_pack", {"pid": "method", "claim_id": "1"})
                out["v_set"] = test_mcp._tool_error(
                    await c.call_tool("set_case_status", {"pid": "method", "status": "filed"})
                )
                out["v_width"] = test_mcp._tool_error(
                    await c.call_tool("set_figure_width", {"pid": "method", "name": "fig1.png", "width": 10})
                )
                out["v_order"] = test_mcp._tool_error(
                    await c.call_tool("set_figure_order", {"pid": "method", "order": []})
                )
            async with test_mcp._http_client(base, owner_tok) as c:
                out["o_set"] = await _call(c, "set_case_status", {"pid": "method", "status": "filed"})
                out["o_width"] = await _call(c, "set_figure_width", {"pid": "method", "name": "fig1.png", "width": 10})
            return out

        with test_mcp._serve(main.app) as base:
            o = asyncio.run(run(base))
    finally:
        for k in ("PATENT_PROJECTS_DIR", "PATENT_STUDIO_AUTH", "PATENT_STUDIO_SECRET"):
            monkeypatch.delenv(k)
        _reload_after_on()

    assert o["v_case"]["status"] == "drafting" and len(o["v_figs"]["figures"]) == 3
    assert [a["name"] for a in o["v_atts"]["items"]] == ["note.md", "pic.png", "prior.docx", "prior.pdf"]
    assert o["v_pack"]["claim"]["num"] == 1 and o["v_pack"]["chain"] == []
    assert o["v_set"]["kind"] == "forbidden" and "agent" in o["v_set"]["message"]
    assert o["v_width"]["kind"] == "forbidden" and o["v_order"]["kind"] == "forbidden"
    assert o["o_set"]["status"] == "filed"
    assert any(f["name"] == "fig1.png" and f["width"] == 10 for f in o["o_width"]["figures"])
    d = str(projects / "method")
    case_commit = next(v for v in history.log(d) if v["message"].startswith("case:"))
    assert case_commit["author"] == "张律师"  # PAT 绑定用户 = 状态事件作者（同 REST）
    who = {(r["who"], r["tool"], r["result"]) for r in audit.tail(d, 200)}
    assert ("小王", "set_case_status", "error:forbidden") in who
    assert ("小王", "set_figure_width", "error:forbidden") in who
    assert ("小王", "context_pack", "ok") in who
    assert ("张律师", "set_case_status", "ok") in who and ("张律师", "set_figure_width", "ok") in who


def _reload_after_on():
    from app import main
    from app.mcp import server, tools_attachments, tools_case, tools_figures, tools_semantic

    test_mcp._reload_app()
    for m in (tools_figures, tools_case, tools_attachments, tools_semantic, server):
        importlib.reload(m)
    importlib.reload(main)
