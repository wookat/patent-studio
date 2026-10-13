# -*- coding: utf-8 -*-
"""审计日志 <project>/.studio/audit.jsonl（docs/plan/10 §3.5）：一行一条 {ts, who, tool, args, result}。"""
import json
import os
import time

FILE = "audit.jsonl"


def path(project_dir: str) -> str:
    return os.path.join(project_dir, ".studio", FILE)


def record(project_dir: str, who: str, tool: str, args: dict, result: str) -> dict:
    """args 只放标量摘要（如 block_id、direct、markdown_len），不放整段正文。result = ok | error:<kind>。"""
    entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "who": who, "tool": tool,
             "args": args, "result": result}
    p = path(project_dir)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def tail(project_dir: str, limit: int = 50) -> list[dict]:
    """最新在前。"""
    p = path(project_dir)
    if not os.path.isfile(p):
        return []
    with open(p, encoding="utf-8") as f:
        lines = f.read().splitlines()
    return [json.loads(ln) for ln in reversed(lines[-limit:]) if ln.strip()]
