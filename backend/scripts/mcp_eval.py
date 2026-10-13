# -*- coding: utf-8 -*-
"""W4-E 理解实验（docs/plan/17 §5）：同一模型在两种工具集下回答 20 道专利理解题，记准确率与工具调用次数。

用法（在 backend/ 下）：
    uv run python scripts/mcp_eval.py --grade-only                  # 不调模型：校验题库 + 判分器自测（CI 可跑）
    uv run python scripts/mcp_eval.py --toolset read_book --model X  # 只给 read_book
    uv run python scripts/mcp_eval.py --toolset semantic  --model X  # read_book + 语义工具
    uv run python scripts/mcp_eval.py --toolset both      --model X  # 两轮都跑，输出对照表

模型：OpenAI 兼容 chat/completions + function calling。端点 / key 只从环境变量取，不打印：
    MCP_EVAL_BASE_URL（默认 app.ai.client.BASE_URL）、MCP_EVAL_KEY（默认 PATENT_STUDIO_AI_KEY）。
    --model 必填；不用 claude-sonnet-4.6。
工具：进程内直接调 app.mcp.server.server.call_tool（同一套注册与审计，PATENT_PROJECTS_DIR 指向 examples/ 的拷贝）；
    READ_BOOK = ["read_book"]，
    SEMANTIC = READ_BOOK + get_claim_tree / get_support_map / get_figures / get_terms / context_pack。
题库：scripts/mcp_eval_questions.json（两案各 10 题；match 见文件头 note）。
输出：--out 目录写 <toolset>.jsonl（每题一行：id / type / answer / correct / tool_calls / tools / tokens）
    与 summary.json {toolset: {accuracy, by_type, tool_calls_total, tool_calls_avg, tokens}}；
    stdout 打一张 Markdown 对照表可直接贴进设计定稿。
判分：纯规则，不用模型判分（§5.3）：
    int_set      回答中出现的全部整数集合 == expect
    keywords_all expect 每项都出现（项内 a|b 任一即可）
    keywords_any expect 任一出现
    比较前去空白、全角→半角、大小写折叠。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import sys
import tempfile
import time
import unicodedata

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

QUESTIONS = os.path.join(BACKEND, "scripts", "mcp_eval_questions.json")
READ_BOOK = ["read_book"]
SEMANTIC = READ_BOOK + ["get_claim_tree", "get_support_map", "get_figures", "get_terms", "context_pack"]
TOOLSETS = {"read_book": READ_BOOK, "semantic": SEMANTIC}
MAX_STEPS = 12  # 单题最多工具往返
RETRY_STATUS = {429, 500, 502, 503, 504}
RETRY_MAX = 6
SYSTEM_PROMPT = (
    "你是专利代理师助手，只能通过给定工具读取案卷；不得猜测。"
    "按题目要求的形式简短作答（编号题只答编号，用逗号分隔）；答不出写「不确定」。"
)


# ---------------------------------------------------------------- 判分 ----

def _norm(s: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", s)).casefold()


def grade(match: str, expect: list, answer: str) -> bool:
    a = _norm(answer)
    if match == "int_set":
        return {int(x) for x in re.findall(r"\d+", a)} == set(expect)
    if match == "keywords_all":
        return all(any(_norm(alt) in a for alt in str(k).split("|")) for k in expect)
    if match == "keywords_any":
        return any(_norm(str(k)) in a for k in expect)
    raise ValueError(f"未知 match：{match}")


def load_questions(path: str = QUESTIONS) -> dict:
    with open(path, encoding="utf-8") as f:
        bank = json.load(f)
    for case in bank["cases"]:
        assert len(case["questions"]) == 10, f"{case['pid']} 须 10 题"
        for q in case["questions"]:
            assert q["match"] in ("int_set", "keywords_all", "keywords_any"), q["id"]
            assert q["type"] in ("dependency", "terminology", "support", "figure_marker", "defect"), q["id"]
    return bank


def self_test() -> None:
    assert grade("int_set", [2, 3, 4, 5, 6], "权利要求2、3、4、5和6")
    assert not grade("int_set", [2], "权利要求 2 与 3")
    assert grade("keywords_all", ["1034", "投注财富门控控制器", "投注财富门控"],
                 "1034：投注财富门控 / 投注财富门控控制器")
    assert grade("keywords_all", ["计算机设备", "1至8|1-8"], "一种计算机设备，引用权利要求1至8任一项")
    assert not grade("keywords_all", ["仅追加", "109"], "审计模块 109")
    assert grade("keywords_any", ["1/α", "1/alpha"], "阈值为 1/α")


# ---------------------------------------------------------------- 模型侧 ----

def _tool_specs(server_tools, names: list[str]) -> list[dict]:
    by = {t.name: t for t in server_tools}
    return [{"type": "function", "function": {"name": n, "description": by[n].description or "",
                                              "parameters": by[n].input_schema}} for n in names]


async def _call_tool(server, name: str, args: dict) -> str:
    res = await server.call_tool(name, args)
    if res.structured_content is not None:
        return json.dumps(res.structured_content, ensure_ascii=False)
    return "\n".join(getattr(c, "text", "") for c in res.content)


async def _chat(client, body: dict) -> dict:
    """429 / 5xx 指数退避重试（中转站限速常见）；其余状态码直接抛。"""
    for attempt in range(RETRY_MAX):
        r = await client.post("/v1/chat/completions", json=body, timeout=300)
        if r.status_code not in RETRY_STATUS or attempt == RETRY_MAX - 1:
            r.raise_for_status()
            return r.json()
        await asyncio.sleep(min(2 ** attempt * 5, 60))
    raise RuntimeError("unreachable")


async def ask(client, model: str, server, tools: list[dict], pid: str, question: str) -> dict:
    """一题一段对话：system + user → 工具循环 → 最终文本。返回 {answer, tool_calls, tools, tokens}。"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"案卷 pid={pid}。问题：{question}"}]
    calls: list[str] = []
    tokens = 0
    for _ in range(MAX_STEPS):
        data = await _chat(client, {"model": model, "messages": messages, "tools": tools, "temperature": 0})
        tokens += (data.get("usage") or {}).get("total_tokens", 0)
        msg = data["choices"][0]["message"]
        messages.append(msg)
        if not msg.get("tool_calls"):
            return {"answer": msg.get("content") or "", "tool_calls": len(calls), "tools": calls, "tokens": tokens}
        for tc in msg["tool_calls"]:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except ValueError:
                args = {}
            args.setdefault("pid", pid)
            calls.append(name)
            try:
                out = await _call_tool(server, name, args)
            except Exception as e:  # noqa: BLE001 — 工具错误原样回给模型，让它换招
                out = json.dumps({"error": str(e)}, ensure_ascii=False)
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out[:60000]})
    return {"answer": "（超出工具往返上限）", "tool_calls": len(calls), "tools": calls, "tokens": tokens}


async def run_toolset(toolset: str, model: str, bank: dict, out_dir: str) -> dict:
    import logging

    import httpx

    from app.ai.client import BASE_URL
    logging.getLogger("httpx").setLevel(logging.WARNING)
    from app.mcp.server import server

    base = os.environ.get("MCP_EVAL_BASE_URL") or BASE_URL
    key = os.environ.get("MCP_EVAL_KEY") or os.environ.get("PATENT_STUDIO_AI_KEY")
    if not key:
        sys.exit("缺 MCP_EVAL_KEY / PATENT_STUDIO_AI_KEY，无法调模型（--grade-only 不需要）")
    tools = _tool_specs(await server.list_tools(), TOOLSETS[toolset])
    rows: list[dict] = []
    async with httpx.AsyncClient(base_url=base.rstrip("/"), headers={"Authorization": f"Bearer {key}"}) as client:
        for case in bank["cases"]:
            for q in case["questions"]:
                t0 = time.perf_counter()
                res = await ask(client, model, server, tools, case["pid"], q["q"])
                ok = grade(q["match"], q["expect"], res["answer"])
                rows.append({"id": q["id"], "pid": case["pid"], "type": q["type"], "correct": ok,
                             "seconds": round(time.perf_counter() - t0, 1), **res})
                print(f"[{toolset}] {q['id']} {'✓' if ok else '✗'} calls={res['tool_calls']} {res['answer'][:60]!r}")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{toolset}.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    return summarize(rows)


def summarize(rows: list[dict]) -> dict:
    by_type: dict[str, list[bool]] = {}
    for r in rows:
        by_type.setdefault(r["type"], []).append(r["correct"])
    n = len(rows)
    return {
        "n": n,
        "accuracy": round(sum(r["correct"] for r in rows) / n, 3) if n else None,
        "by_type": {k: f"{sum(v)}/{len(v)}" for k, v in by_type.items()},
        "tool_calls_total": sum(r["tool_calls"] for r in rows),
        "tool_calls_avg": round(sum(r["tool_calls"] for r in rows) / n, 2) if n else None,
        "tokens": sum(r["tokens"] for r in rows),
    }


def markdown_table(summary: dict[str, dict], model: str) -> str:
    lines = [f"| 工具集（模型 {model}） | 准确率 | 依赖 | 术语 | 支持 | 附图标记 | 缺陷 "
             "| 工具调用总数 | 平均/题 | tokens |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for ts, s in summary.items():
        bt = s["by_type"]
        lines.append(f"| {ts} | {s['accuracy']} | {bt.get('dependency', '-')} | {bt.get('terminology', '-')} | "
                     f"{bt.get('support', '-')} | {bt.get('figure_marker', '-')} | {bt.get('defect', '-')} | "
                     f"{s['tool_calls_total']} | {s['tool_calls_avg']} | {s['tokens']} |")
    return "\n".join(lines)


# ---------------------------------------------------------------- 入口 ----

def _projects_copy() -> str:
    """examples/ 拷到临时目录做 PATENT_PROJECTS_DIR（读工具也会写 .studio/audit.jsonl，不能落回 examples/）。"""
    d = tempfile.mkdtemp(prefix="mcp-eval-")
    for pid in ("method", "system"):
        shutil.copytree(os.path.join(ROOT, "examples", pid), os.path.join(d, pid),
                        ignore=shutil.ignore_patterns("*.docx", ".studio", "*.bak-*"))
    return d


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--toolset", choices=["read_book", "semantic", "both"], default="both")
    ap.add_argument("--model")
    ap.add_argument("--out", default=os.path.join(BACKEND, "scripts", "mcp_eval_out"))
    ap.add_argument("--grade-only", action="store_true", help="只校验题库与判分器，不调模型")
    a = ap.parse_args(argv)
    bank = load_questions()
    self_test()
    if a.grade_only:
        n = sum(len(c["questions"]) for c in bank["cases"])
        print(f"题库 OK：{len(bank['cases'])} 案 {n} 题；判分器自测通过")
        return 0
    if not a.model:
        ap.error("--model 必填")
    projects = _projects_copy()
    os.environ["PATENT_PROJECTS_DIR"] = projects
    try:
        sets = ["read_book", "semantic"] if a.toolset == "both" else [a.toolset]
        summary = {ts: asyncio.run(run_toolset(ts, a.model, bank, a.out)) for ts in sets}
    finally:
        shutil.rmtree(projects, ignore_errors=True)
    with open(os.path.join(a.out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump({"model": a.model, **summary}, f, ensure_ascii=False, indent=2)
    print(markdown_table(summary, a.model))
    return 0


if __name__ == "__main__":
    sys.exit(main())
