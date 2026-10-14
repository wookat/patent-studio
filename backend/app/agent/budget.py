# -*- coding: utf-8 -*-
"""智能体预算（docs/plan/21 §6.2 / 19 §4.4、§4.8）：**唯一裁剪点**与每案日 token 预算。

裁剪：`clip(context_pack, scenario) -> (text, truncated)`，上限按场景（交互 / chat / S3–S6 / S9 / S10 8k，
S2 12k，S7 16k，S1 20k），硬上限 CONTEXT_MAX_CHARS=40k 字符；任何送给模型的案卷上下文都必须经过这里。
日预算：`settings.ai_daily_tokens`（案级 studio.json，缺省 config.AI_DAILY_TOKENS=200000），累计口径是
`.studio/ai-usage.jsonl` 里今天（本地日历日）成功调用的 total_tokens；超出时 heavy 场景 429 budget，
interactive（chat / rewrite / S4 / S5 / S6）放行。
"""

import time

from app import config
from app.agent import types
from app.ai.client import read_usage
from app.errors import kind_error

INTERACTIVE_CHARS = 8_000
CAPS: dict[str, int] = {"s1": 20_000, "s2": 12_000, "s7": 16_000}
HARD_CAP = types.CONTEXT_MAX_CHARS
CLIP_MARK = "\n…（上下文已按预算裁剪）"


def cap_for(scenario: str | None) -> int:
    return min(CAPS.get(scenario or "", INTERACTIVE_CHARS), HARD_CAP)


def clip(context_pack: str, scenario: str | None = None) -> tuple[str, bool]:
    """按场景上限截尾；返回 (text, truncated)。截断时末尾追加说明，使模型知道上下文不完整。"""
    cap = cap_for(scenario)
    if len(context_pack) <= cap:
        return context_pack, False
    keep = max(0, cap - len(CLIP_MARK))
    return context_pack[:keep] + CLIP_MARK, True


def daily_budget(settings: dict | None) -> int:
    v = (settings or {}).get("ai_daily_tokens")
    return int(v) if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else config.AI_DAILY_TOKENS


def _same_day(ts: float, now: float) -> bool:
    a, b = time.localtime(ts), time.localtime(now)
    return (a.tm_year, a.tm_yday) == (b.tm_year, b.tm_yday)


def today_rows(project_dir: str, now: float | None = None) -> list[dict]:
    now = time.time() if now is None else now
    return [
        r
        for r in read_usage(project_dir)
        if r.get("ok", True) and isinstance(r.get("ts"), (int, float)) and _same_day(float(r["ts"]), now)
    ]


def today_tokens(project_dir: str, now: float | None = None) -> int:
    return sum(int(r.get("total_tokens") or 0) for r in today_rows(project_dir, now))


def status(project_dir: str, settings: dict | None) -> dict:
    return {"today_tokens": today_tokens(project_dir), "budget": daily_budget(settings)}


def exhausted(project_dir: str, settings: dict | None) -> bool:
    b = daily_budget(settings)
    return b > 0 and today_tokens(project_dir) >= b


def check_heavy(project_dir: str, settings: dict | None) -> None:
    """heavy 场景入队前调用：日预算耗尽 ⇒ 429 budget。interactive 不调用本函数。"""
    if exhausted(project_dir, settings):
        st = status(project_dir, settings)
        raise kind_error(
            "budget",
            f"本案今日 AI 预算已用尽（{st['today_tokens']}/{st['budget']} tokens），"
            "重任务明天再试或调高 ai_daily_tokens",
            detail=st,
        )


__all__ = [
    "CAPS",
    "HARD_CAP",
    "INTERACTIVE_CHARS",
    "cap_for",
    "check_heavy",
    "clip",
    "daily_budget",
    "exhausted",
    "status",
    "today_tokens",
]
