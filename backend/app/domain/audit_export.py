# -*- coding: utf-8 -*-
"""案卷审计轨迹导出（Z33）：一案的事件 + 确认 + 提案 + 版本 汇总为 JSON / CSV。

字段只放元数据（actor/kind/version/sha/state 等），不放凭证：share token、IP/UA、
提案正文 / critic_markdown / patch 内容、PAT 一律不落——确认链只留版本指纹。
"""

import csv
import io
import json
import os
from datetime import UTC, datetime

from app.domain import cases, history, timeline
from app.mcp import audit as mcp_audit

_PROPOSALS_DIR = os.path.join(".studio", "ai-proposals")


def _proposals(project_dir: str) -> list[dict]:
    """ai-proposals/*.jsonl 同 id 取最后一行；只留元数据，正文 / patch 不导出。"""
    d = os.path.join(project_dir, _PROPOSALS_DIR)
    if not os.path.isdir(d):
        return []
    last: dict[str, dict] = {}
    for name in sorted(os.listdir(d)):
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(d, name), encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                last[row["id"]] = {
                    "id": row.get("id"),
                    "job_id": row.get("job_id"),
                    "scenario": row.get("scenario"),
                    "kind": row.get("kind"),
                    "state": row.get("state"),
                    "model": row.get("model"),
                    "by": row.get("by"),
                    "ts": row.get("ts"),
                    "created_at": row.get("created_at"),
                }
    return sorted(last.values(), key=lambda r: r.get("created_at") or 0)


def _confirmations(project_dir: str) -> list[dict]:
    case = cases.ensure_case(project_dir)
    return [
        {
            "version": c.version,
            "sha": c.sha,
            "content_sha": c.content_sha,
            "name": c.name,
            "note": c.note,
            "confirmed_at": c.confirmed_at,
            "actor": c.actor,
        }
        for c in case.confirmations
    ]


def _versions(project_dir: str) -> list[dict]:
    return [
        {
            "sha": v["sha"],
            "at": v["at"],
            "message": v["message"],
            "author": v["author"],
            "added": v["added"],
            "deleted": v["deleted"],
        }
        for v in history.log(project_dir)
    ]


def _events(project_dir: str) -> list[dict]:
    out = []
    for it in timeline.merged(project_dir):
        out.append(
            {
                "id": it.get("id"),
                "kind": it.get("kind"),
                "ts": it.get("ts"),
                "actor": it.get("actor"),
                "text": it.get("text"),
                "data": it.get("data") or {},
            }
        )
    # MCP 工具调用日志（含非写工具——时间线只摘写工具，导出要全量留痕）
    for rec in mcp_audit.tail(project_dir, limit=2000):
        out.append(
            {
                "id": None,
                "kind": "mcp.tool",
                "ts": rec.get("ts"),
                "actor": {"id": rec.get("who"), "display_name": rec.get("who")},
                "text": rec.get("tool"),
                "data": {"result": rec.get("result"), "args": rec.get("args") or {}},
            }
        )
    return out


def build_audit(project_dir: str, pid: str) -> dict:
    return {
        "pid": pid,
        "exported_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "events": _events(project_dir),
        "confirmations": _confirmations(project_dir),
        "proposals": _proposals(project_dir),
        "versions": _versions(project_dir),
    }


def to_csv(doc: dict) -> str:
    """扁平 CSV：section,ts,actor,summary,extra(json)。UTF-8 BOM（Excel 中文不乱码）。"""
    buf = io.StringIO()
    buf.write("\ufeff")
    w = csv.writer(buf)
    w.writerow(["section", "ts", "actor", "summary", "extra"])
    for ev in doc["events"]:
        actor = (ev.get("actor") or {}).get("display_name") or ""
        w.writerow(
            [
                "event",
                ev.get("ts"),
                actor,
                f"{ev.get('kind')}：{ev.get('text') or ''}",
                json.dumps(ev.get("data") or {}, ensure_ascii=False, sort_keys=True),
            ]
        )
    for c in doc["confirmations"]:
        w.writerow(
            [
                "confirmation",
                c.get("confirmed_at"),
                c.get("name") or "",
                f"确认定稿 v{c.get('version')} sha={c.get('sha')}",
                json.dumps({"note": c.get("note"), "actor": c.get("actor")}, ensure_ascii=False),
            ]
        )
    for p in doc["proposals"]:
        w.writerow(
            [
                "proposal",
                p.get("ts") or p.get("created_at"),
                p.get("by") or "",
                f"{p.get('kind')} {p.get('state')}",
                json.dumps(
                    {"id": p.get("id"), "job_id": p.get("job_id"), "scenario": p.get("scenario")}, ensure_ascii=False
                ),
            ]
        )
    for v in doc["versions"]:
        w.writerow(
            [
                "version",
                v.get("at"),
                v.get("author") or "",
                f"{v.get('sha')[:10]} {v.get('message')}",
                json.dumps({"added": v.get("added"), "deleted": v.get("deleted")}, ensure_ascii=False),
            ]
        )
    return buf.getvalue()
