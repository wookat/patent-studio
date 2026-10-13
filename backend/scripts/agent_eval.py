# -*- coding: utf-8 -*-
"""智能体评估（docs/plan/19 §6、21 §6.3 / §7.4.8）。

    uv run python scripts/agent_eval.py --provider mock              # 确定性判分，全部 100% 才 exit 0（进 make check）
    uv run python scripts/agent_eval.py --provider real -o out.json  # 真模型：读 PATENT_STUDIO_AI_KEY，输出 §6.3 指标

每个（案例 × 场景）在 examples/ 的独立临时拷贝上运行 `agent.loop.run_scenario`，然后把待确认提案全部 apply，判分：

    no_direct_write  job 运行期间 content.md 与 docs/*.md md5 不变（提案落地只发生在 apply）
    roundtrip        apply 后 critic.reject(new) 与 critic.reject(old) 相等（critic 逐字节；patch 忽略空行）
    preflight_delta  apply 后 preflight error 数不增加
    anchor_hit       块锚点存在且行号落在块内；有 quote 的批注 quote 命中锚点行
    no_legal_verdict 批注 / 修订 / 生成文本不含结论式法律措辞

real 模式在此之上再给出 §6.3 的 19 项指标（召回 / 误报 / 时延 / tokens / 人工项标 null），key 只从环境变量读、不入输出。
"""
from __future__ import annotations

import argparse
import asyncio
import glob
import hashlib
import json
import os
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from app import config  # noqa: E402
from app.agent import loop, proposals, registry  # noqa: E402
from app.agent.types import SCENARIO_BY_ID, BlockAnchor  # noqa: E402
from app.ai.client import MODELS, AiClient, OpenAICompatProvider  # noqa: E402
from app.ai.jobs import JobStore  # noqa: E402
from app.ai.mock import MockProvider  # noqa: E402
from app.domain.projects import ProjectStore  # noqa: E402
from app.mcp import tools_semantic  # noqa: E402
from patent_studio.kernel import critic  # noqa: E402

CASES = ("method", "system")
CRITERIA = ("no_direct_write", "roundtrip", "preflight_delta", "anchor_hit", "no_legal_verdict")
IGNORE = shutil.ignore_patterns("*.docx", "*.pdf", ".studio", "*.bak-*", "__pycache__")


def _md5s(project_dir: str) -> dict[str, str]:
    files = [os.path.join(project_dir, "content.md"), *glob.glob(os.path.join(project_dir, "docs", "*.md"))]
    return {os.path.relpath(f, project_dir): hashlib.md5(open(f, "rb").read()).hexdigest() for f in files}


def _errors(store, pid: str) -> int:
    return sum(1 for it in tools_semantic.derive(store, pid).report["items"] if it["severity"] == "error")


def _nonblank(text: str) -> list[str]:
    return [ln for ln in text.split("\n") if ln.strip()]


def _anchor_ok(d: tools_semantic.Derived, prop) -> bool:
    if not isinstance(prop.anchor, BlockAnchor):
        return True
    hit = loop._block_ranges(d.ast).get(prop.anchor.block_id)
    return hit is not None and hit[1] <= prop.anchor.line_start <= prop.anchor.line_end <= hit[2]


async def run_one(case: str, scenario: str, ai: AiClient, workdir: str) -> dict:
    projects = os.path.join(workdir, f"{case}-{scenario}")
    os.makedirs(projects)
    shutil.copytree(os.path.join(ROOT, "examples", case), os.path.join(projects, case), ignore=IGNORE)
    store, jobs = ProjectStore(projects), JobStore(projects)
    p = store.get(case)
    err_before = _errors(store, case)  # 首次派生会把 content.md 物化为 docs/*.md，基线取物化后
    before = _md5s(p.dir)
    t0 = time.perf_counter()
    job = jobs.create(f"agent:{scenario}", case)
    await jobs.run(job, lambda: loop.run_scenario(case, scenario, {}, job, store=store, jobs=jobs, ai=ai))
    job = jobs.get(job.id)
    elapsed = time.perf_counter() - t0
    row = {"case": case, "scenario": scenario, "status": job.status, "error": job.error, "seconds": round(elapsed, 2),
           "steps": [s["kind"] for s in job.steps], "proposals": 0, "comments": 0,
           "tokens": sum((job.result or {}).get("usage", {}).values()) if job.result else 0}
    after = _md5s(p.dir)
    checks = {"no_direct_write": after == before, "roundtrip": True, "preflight_delta": True, "anchor_hit": True,
              "no_legal_verdict": job.status == "done"}
    props = proposals.load(p.dir, case, None)
    row["proposals"] = len(props)
    row["comments"] = sum(1 for q in props if q.kind == "comment")
    d = tools_semantic.derive(store, case)
    for q in props:
        checks["anchor_hit"] &= _anchor_ok(d, q)
        for c in q.checks:
            if c.name in ("anchor_hit", "no_legal_verdict") and not c.ok:
                checks[c.name] = False
        text = q.comment_body or q.critic_markdown or ""
        if q.patch is not None:
            text += "\n".join(b.markdown for b in getattr(q.patch, "blocks", []) or []) + str(
                getattr(q.patch, "content", "") or "")
        if loop.has_legal_verdict(text):
            checks["no_legal_verdict"] = False
    orig = store.read_content(case)
    for q in props:
        if q.state != "pending":
            continue
        try:
            r = await proposals.apply(store, case, q.id)
        except Exception as e:  # noqa: BLE001 —— 评估要把失败记成分数而不是中断
            row.setdefault("apply_errors", []).append(f"{q.id}: {e}")
            checks["roundtrip"] = False
            continue
        if q.kind == "critic" and critic.reject(r.content) != critic.reject(orig):
            checks["roundtrip"] = False
        if q.kind == "patch" and isinstance(q.anchor, BlockAnchor) and \
                _nonblank(critic.reject(r.content)) != _nonblank(critic.reject(orig)):
            checks["roundtrip"] = False
        if q.kind == "patch" and isinstance(q.anchor, BlockAnchor) and "{++" not in r.content:
            checks["roundtrip"] = False
        orig = store.read_content(case)
    try:
        checks["preflight_delta"] = _errors(store, case) <= err_before
    except Exception as e:  # noqa: BLE001
        checks["preflight_delta"] = False
        row["preflight_error"] = str(e)
    row["checks"] = checks
    return row


def _role_models() -> dict[str, str]:
    roles = ("plan", "critique", "draft", "interactive")
    return {role: MODELS["heavy" if role in loop.HEAVY_ROLES else "interactive"] for role in roles} | {
        "fallback": MODELS["fallback"]}


def summarize(rows: list[dict]) -> dict:
    summary = {}
    for c in CRITERIA:
        ok = sum(1 for r in rows if r["checks"][c])
        summary[c] = {"pass": ok, "total": len(rows), "rate": round(ok / len(rows), 4) if rows else None}
    return summary


def real_metrics(rows: list[dict]) -> dict:
    """19 §6.3 的 19 项：确定性项自动算；召回 / 误报 / 人工项要样例库与人工评审，这里给出可算的与 null 占位。"""
    def by(s):
        return [r for r in rows if r["scenario"] == s]

    def p50(vals):
        vals = sorted(v for v in vals if v is not None)
        return vals[len(vals) // 2] if vals else None

    s2 = by("s2")
    return {
        "no_direct_write_rate": summarize(rows)["no_direct_write"]["rate"],
        "roundtrip_rate": summarize(rows)["roundtrip"]["rate"],
        "preflight_delta_rate": summarize(rows)["preflight_delta"]["rate"],
        "anchor_hit_rate": summarize(rows)["anchor_hit"]["rate"],
        "no_legal_verdict_rate": summarize(rows)["no_legal_verdict"]["rate"],
        "job_done_rate": round(sum(1 for r in rows if r["status"] == "done") / len(rows), 4) if rows else None,
        "defect_recall_e2": None, "defect_recall_e4": None, "defect_recall_e5": None,
        "false_positive_rate_e2": None,
        "comments_per_case_e2_max": max((r["comments"] for r in s2), default=None),
        "comments_per_case_e2_le_15": all(r["comments"] <= 15 for r in s2) if s2 else None,
        "out_of_scope_features_e7": None,
        "human_score_e6": None, "human_score_e9": None, "human_score_e10": None,
        "s2_tokens_max": max((r["tokens"] for r in s2), default=None),
        "s2_seconds_max": max((r["seconds"] for r in s2), default=None),
        "s6_seconds_p50": p50([r["seconds"] for r in by("s6")]),
    }


async def main_async(args) -> int:
    if args.provider == "mock":
        ai = AiClient(MockProvider())
    else:
        if not config.AI_KEY:
            print("缺少 PATENT_STUDIO_AI_KEY，真模型评估无法运行（mock 请用 --provider mock）", file=sys.stderr)
            return 2
        ai = AiClient(OpenAICompatProvider(config.AI_KEY))
    scenarios = args.scenario or list(registry.SCENARIO_IDS)
    for s in scenarios:
        if s not in SCENARIO_BY_ID:
            print(f"未知场景：{s}", file=sys.stderr)
            return 2
    cases = args.case or list(CASES)
    workdir = tempfile.mkdtemp(prefix="agent-eval-")
    rows = []
    try:
        for case in cases:
            for s in scenarios:
                row = await run_one(case, s, ai, workdir)
                rows.append(row)
                flags = " ".join(f"{k}={'✓' if v else '✗'}" for k, v in row["checks"].items())
                print(f"{case:7s} {s:4s} {row['status']:12s} {row['seconds']:6.2f}s  {flags}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    summary = summarize(rows)
    out = {"provider": args.provider, "models": None if args.provider == "mock" else _role_models(),
           "summary": summary, "rows": rows}
    if args.provider == "real":
        out["metrics"] = real_metrics(rows)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False))
    failed = [c for c in CRITERIA if summary[c]["rate"] != 1.0]
    if args.provider == "mock" and failed:
        print(f"确定性判分未达 100%：{failed}", file=sys.stderr)
        return 1
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--provider", choices=("mock", "real"), default="mock")
    ap.add_argument("--scenario", action="append", help="只跑指定场景（可重复）")
    ap.add_argument("--case", action="append", choices=CASES, help="只跑指定案例（可重复）")
    ap.add_argument("-o", "--output", help="结果 JSON 路径")
    args = ap.parse_args(argv)
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
