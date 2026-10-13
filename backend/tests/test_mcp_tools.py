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
    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
            "/Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
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
        shutil.copytree(os.path.join(ROOT, "examples", pid), projects / pid,
                        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
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
                await c.call_tool("set_case_status", {"pid": "method", "status": "filed"}))
            out["set_bad"] = await c.call_tool("set_case_status", {"pid": "method", "status": "nope"})
            out["after"] = await _call(c, "get_case", {"pid": "method"})
            out["atts"] = await _call(c, "list_attachments", {"pid": "method"})
            out["atts_sys"] = await _call(c, "list_attachments", {"pid": "system"})
            for n in ("prior.docx", "note.md", "prior.pdf"):
                out[n] = await _call(c, "read_attachment_text", {"pid": "method", "name": n})
            out["md_cut"] = await _call(c, "read_attachment_text",
                                        {"pid": "method", "name": "note.md", "max_chars": 20})
            out["png"] = test_mcp._tool_error(
                await c.call_tool("read_attachment_text", {"pid": "method", "name": "pic.png"}))
            out["missing"] = test_mcp._tool_error(
                await c.call_tool("read_attachment_text", {"pid": "method", "name": "x.docx"}))
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
    assert log and log[0]["message"].startswith("case:") and "drafting" in log[0]["message"] \
        and "filed" in log[0]["message"] and "递交完成" in log[0]["message"]

    assert [a["name"] for a in o["atts"]["items"]] == ["note.md", "pic.png", "prior.docx", "prior.pdf"]
    assert o["atts_sys"] == {"items": []}
    assert o["prior.docx"]["kind"] == "docx" and "示例装置" in o["prior.docx"]["text"] \
        and "权利要求1所述的示例装置" in o["prior.docx"]["text"] and not o["prior.docx"]["truncated"]
    assert o["note.md"]["kind"] == "text" and o["note.md"]["text"].startswith("# 交底书")
    assert o["prior.pdf"]["kind"] == "pdf" and "Prior art PS-E3 hello" in o["prior.pdf"]["text"]
    assert o["md_cut"]["truncated"] and len(o["md_cut"]["text"]) == 20 and o["md_cut"]["chars"] == o["note.md"]["chars"]
    assert o["png"]["kind"] == "unsupported" and o["png"]["detail"] == "pic.png"
    assert o["missing"]["kind"] == "not_found"

    rows = {(r["tool"], r["result"]) for r in audit.tail(str(projects / "method"), 200)}
    assert {("get_case", "ok"), ("set_case_status", "ok"), ("set_case_status", "error:conflict"),
            ("list_attachments", "ok"), ("read_attachment_text", "ok"), ("read_attachment_text", "ok:truncated"),
            ("read_attachment_text", "error:unsupported"), ("read_attachment_text", "error:not_found")} <= rows


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
            out["m.pack8"] = await _call(c, "context_pack", {"pid": "method", "claim_id": "8"})
            out["m.pack3"] = await _call(c, "context_pack", {"pid": "method", "claim_id": "claims/3"})
            out["m.pack8_small"] = await _call(c, "context_pack", {"pid": "method", "claim_id": "8", "max_chars": 3000})
            out["s.pack10"] = await _call(c, "context_pack", {"pid": "system", "claim_id": "10", "max_chars": 40000})
            out["s.pack6"] = await _call(c, "context_pack", {"pid": "system", "claim_id": "6"})
            out["nf"] = test_mcp._tool_error(await c.call_tool("context_pack", {"pid": "method", "claim_id": "99"}))
            out["nf2"] = test_mcp._tool_error(await c.call_tool("context_pack", {"pid": "method", "claim_id": "abc"}))
            out["bad_pid"] = test_mcp._tool_error(await c.call_tool("get_terms", {"pid": "nope"}))
        return out
    o = asyncio.run(run())

    # 权利要求树：独立项为根（M3 / S2），从属项嵌套；多引用只挂最小引用项下（M1）
    def flat(nodes):
        for n in nodes:
            yield n
            yield from flat(n["children"])
    m_tree = o["method.get_claim_tree"]
    assert [n["num"] for n in m_tree] == [1, 10, 11]
    assert sorted(n["num"] for n in flat(m_tree)) == list(range(1, 12))
    by = {n["num"]: n for n in flat(m_tree)}
    assert by[8]["refs"] == [2, 3, 4, 5, 6] and by[3]["refs"] == [2]  # M1 / M2
    assert 8 in [c["num"] for c in by[2]["children"]] and 3 in [c["num"] for c in by[2]["children"]]
    assert by[9]["issues"] and by[9]["issues"][0]["rule"] == "claims.multi_multi"  # M9
    assert by[1]["text"].startswith("1.一种") and by[1]["category"].endswith("方法")
    s_tree = o["system.get_claim_tree"]
    assert [n["num"] for n in s_tree] == [1, 9, 10]
    by_s = {n["num"]: n for n in flat(s_tree)}
    assert by_s[9]["category"] == "计算机设备" and by_s[9]["refs"] == list(range(1, 9))  # S3
    assert [i["rule"] for i in by_s[10]["issues"]] == ["claims.unsupported_term"]  # S9
    assert all(c["refs"] == [1] for c in by_s[1]["children"]) and len(by_s[1]["children"]) == 7  # S1

    # 支持性
    rows = o["system.get_support_map"]
    assert set(rows[0]) == set(schemas.SupportRow.model_fields)
    bad = [r for r in rows if not r["supported"]]
    assert [(r["term"], r["claims"]) for r in bad] == [("程序", [10])]
    assert all(r["supported"] for r in o["method.get_support_map"])

    # 附图标记表：figures × numerals（M7 / M8 / S6 / S7 / S8）
    m_figs = {f["num"]: f for f in o["method.get_figures"]}
    assert sorted(m_figs) == [1, 2, 3, 4, 5, 6] and m_figs[3]["file"] == "fig3.emf" and m_figs[3]["caption"]
    m3 = {m["num"]: m for m in m_figs[3]["markers"]}
    assert m3["1032"]["legend"] == "检索安全门控控制器" and m3["1032"]["consistent"]
    assert m3["1034"]["consistent"] is True and m3["1034"]["names"] == ["投注财富门控控制器"]  # M10：轮8 图例归一
    m4 = {m["num"]: m["legend"] for m in m_figs[4]["markers"]}
    assert m4["402"] == "告警状态" and m4["401"] == "正常运行状态"
    s_figs = {f["num"]: f for f in o["system.get_figures"]}
    s1 = {m["num"]: m["legend"] for m in s_figs[1]["markers"]}
    assert s1["107"] == "回放编排模块" and s1["109"] == "审计模块"
    s5 = {m["num"]: m["legend"] for m in s_figs[5]["markers"]}
    assert (s5["501"], s5["502"], s5["503"]) == ("腐蚀注入", "告警触发", "降级期")
    assert {m["num"]: m["legend"] for m in s_figs[2]["markers"]}["201"] == "无状态查询旁路"  # 只在标记表段出现

    # 术语：定义句取说明书 / 权项「X 为 …」（M4 / S4），claims 来自 support_map
    for pid in ("method", "system"):
        t = {r["name"]: r for r in o[f"{pid}.get_terms"]}
        assert set(t["安全锚输出"]) == set(schemas.TermRow.model_fields)
        assert "冻结基础预测模型的预测输出" in t["安全锚输出"]["definition"] and t["安全锚输出"]["definition_line"]
        assert 1 in t["安全锚输出"]["claims"]
    assert o["system.get_terms"] and {r["name"] for r in o["system.get_terms"]} >= {"风险轴", "信任系数"}

    # context_pack：正文 + 依赖链 + 支持段落（段号）+ 附图 + 术语 + 未决批注 + 诊断
    p8 = o["m.pack8"]
    assert set(p8) == set(schemas.ContextPack.model_fields) and p8["pid"] == "method"
    assert p8["claim"]["num"] == 8 and p8["claim"]["children"] == []
    assert [c["num"] for c in p8["chain"]] == [1, 2]
    assert any(i["rule"] == "chain.alternative" for i in p8["chain"][-1]["issues"])
    assert p8["support"] and all(s["para_no"].startswith("[00") and s["text"] and s["terms"] for s in p8["support"])
    assert p8["support"] == sorted(p8["support"], key=lambda s: s["line"])
    assert {f["num"] for f in p8["figures"]} <= {1, 2, 3, 4, 5, 6} and p8["figures"]
    assert {t["name"] for t in p8["terms"]} >= {"成熟反馈队列", "信任系数"}
    assert p8["comments"] == [] and _size(p8) <= 12000
    assert o["m.pack3"]["claim"]["num"] == 3 and [c["num"] for c in o["m.pack3"]["chain"]] == [1, 2]
    small = o["m.pack8_small"]
    assert small["truncated"] and small["claim"] == p8["claim"] and small["chain"] == p8["chain"]
    assert len(small["support"]) < len(p8["support"]) and _size(small) <= 3000 + 600
    p10 = o["s.pack10"]
    assert [c["num"] for c in p10["chain"]] == [1] and not p10["truncated"]
    assert [i["rule"] for i in p10["issues"] if i["block_id"] == "claims/10"] == ["claims.unsupported_term"]
    p6 = o["s.pack6"]
    assert p6["claim"]["num"] == 6 and any("回放编排" in s["text"] for s in p6["support"])  # S10 类支持段
    assert 4 in {f["num"] for f in p6["figures"]}  # 图 4 = 回放编排流程图
    assert o["nf"]["kind"] == "not_found" and o["nf2"]["kind"] == "not_found" and o["bad_pid"]["kind"] == "not_found"

    rows = {(r["tool"], r["result"]) for r in audit.tail(str(projects / "method"), 200)}
    assert {(n, "ok") for n in SEMANTIC} <= rows and ("context_pack", "ok:truncated") in rows
    assert ("context_pack", "error:not_found") in rows


def test_stdio_context_pack_comments_unresolved_only(tmp_path, monkeypatch):
    projects = _projects(tmp_path)
    monkeypatch.setenv("PATENT_PROJECTS_DIR", str(projects))
    monkeypatch.delenv("PATENT_STUDIO_AUTH", raising=False)
    d = str(projects / "method")

    async def run():
        async with Client(test_mcp._stdio_params(projects)) as c:
            keep = await _call(c, "add_comment", {"pid": "method", "body": "冷启动阶段的定义要写进说明书",
                                                  "anchor": {"block_id": "claims/8", "line": 37, "quote": "冷启动"}})
            done = await _call(c, "add_comment", {"pid": "method", "body": "已处理",
                                                  "anchor": {"block_id": "claims/8", "line": 37, "quote": "冷启动"}})
            other = await _call(c, "add_comment", {"pid": "method", "body": "别的权项",
                                                   "anchor": {"block_id": "claims/2", "line": 15, "quote": "根据"}})
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
                    await c.call_tool("set_case_status", {"pid": "method", "status": "filed"}))
                out["v_width"] = test_mcp._tool_error(
                    await c.call_tool("set_figure_width", {"pid": "method", "name": "fig1.emf", "width": 10}))
                out["v_order"] = test_mcp._tool_error(
                    await c.call_tool("set_figure_order", {"pid": "method", "order": []}))
            async with test_mcp._http_client(base, owner_tok) as c:
                out["o_set"] = await _call(c, "set_case_status", {"pid": "method", "status": "filed"})
                out["o_width"] = await _call(c, "set_figure_width", {"pid": "method", "name": "fig1.emf", "width": 10})
            return out
        with test_mcp._serve(main.app) as base:
            o = asyncio.run(run(base))
    finally:
        for k in ("PATENT_PROJECTS_DIR", "PATENT_STUDIO_AUTH", "PATENT_STUDIO_SECRET"):
            monkeypatch.delenv(k)
        _reload_after_on()

    assert o["v_case"]["status"] == "drafting" and len(o["v_figs"]["figures"]) == 6
    assert [a["name"] for a in o["v_atts"]["items"]] == ["note.md", "pic.png", "prior.docx", "prior.pdf"]
    assert o["v_pack"]["claim"]["num"] == 1 and o["v_pack"]["chain"] == []
    assert o["v_set"]["kind"] == "forbidden" and "agent" in o["v_set"]["message"]
    assert o["v_width"]["kind"] == "forbidden" and o["v_order"]["kind"] == "forbidden"
    assert o["o_set"]["status"] == "filed"
    assert any(f["name"] == "fig1.emf" and f["width"] == 10 for f in o["o_width"]["figures"])
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
