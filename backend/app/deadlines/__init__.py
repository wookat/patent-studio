# -*- coding: utf-8 -*-
"""W5 deadlines-backend：法定期限（docs/plan/21-w5-spec.md §1.3 A1/A2/A5，§2.1 R-HOME-05/06、R-CASE-02）。

holidays/<year>.json：{"year", "source", "verified", "holidays": ["YYYY-MM-DD"...], "workdays": ["YYYY-MM-DD"...]}
—— holidays 为法定放假日（含调休放假），workdays 为调休上班的周末；verified=false 表示尚未按国办通知核对，
期限计算把它视为「无表」：只按周末顺延，并在响应 holidays_missing 里标出。
规则表 rules.json 与计算见 compute.py；本模块把规则套到 case.json（recompute）并给 oa 单元 add() 契约。
"""

from collections.abc import Callable
from datetime import date

from app import atomic
from app.deadlines import compute
from app.deadlines.tables import HOLIDAYS_DIR, load_holidays
from app.domain import cases

__all__ = ["HOLIDAYS_DIR", "load_holidays", "recompute", "add", "base_dates"]

# 规则届满前「已发生的事实」：一旦 dates.* 填了，对应 auto 期限视为已完成
FULFILLED_BY: dict[str, Callable[[cases.Dates], str | None]] = {
    "priority": lambda d: d.filed,
    "publication": lambda d: d.publication,
    "exam_request": lambda d: d.exam_request,
}
# oa 单元的简写：add(pid, "oa_reply", base, {"round": n}) 按轮次选规则
OA_REPLY_RULES = {1: "oa_first_reply"}


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def base_dates(case: cases.Case) -> dict[str, date | None]:
    """规则 base_date 名 → 案件里的日期。effective_filing 按细则第十二条：有优先权取最早优先权日。"""
    priority = min((date.fromisoformat(p.date) for p in case.priority), default=None)
    filed = _d(case.dates.filed)
    return {
        "dates.filed": filed,
        "priority": priority,
        "effective_filing": priority or filed,
        "dates.grant": _d(case.dates.grant),
    }


def _auto(
    rule: compute.Rule,
    computed: compute.Computed,
    *,
    prev: cases.Deadline | None,
    title: str | None = None,
    done: bool | None = None,
) -> cases.Deadline:
    lb = rule.legal_basis
    return cases.Deadline(
        id=prev.id if prev else rule.id,
        kind=rule.kind,
        title=title or rule.title,
        due=computed.due.isoformat(),
        base_date=computed.base.isoformat(),
        rule=rule.id,
        note=prev.note if prev else "",
        source="auto",
        done=prev.done if done is None and prev else bool(done),
        done_at=prev.done_at if prev else None,
        legal_basis=cases.LegalBasis(law=lb.law, article=lb.article, url=lb.url),
    )


def recompute(case: cases.Case) -> tuple[cases.Case, bool]:
    """按 dates.* / priority 重算案件类规则（base_date ≠ event）的 auto 期限：
    - 基准日在 ⇒ 写入 / 覆盖同 id 的 auto 条目（保留 done / note）；基准日没了 ⇒ 删掉该 auto 条目；
    - 同 id 若已被人工改期（source=manual）⇒ 原样保留，不覆盖；
    - oa 单元经 add() 写入的 event 类 auto 期限不在此重算。
    返回 (case, 涉及年份的节假日表是否全部已核对)。"""
    bases = base_dates(case)
    holidays_ok = True
    for rule in compute.RULES.values():
        if rule.base_date == "event":
            continue
        prev = case.deadline(rule.id)
        if prev is not None and prev.source == "manual":
            continue
        base = bases[rule.base_date]
        if base is None:
            if prev is not None:
                case = case.model_copy(update={"deadlines": [d for d in case.deadlines if d.id != rule.id]})
            continue
        anniversary = _d(case.dates.filed) if "anniversary_of" in rule.offset else None
        if "anniversary_of" in rule.offset and anniversary is None:
            continue
        computed = compute.compute(rule, base, anniversary_of=anniversary)
        holidays_ok = holidays_ok and computed.holidays_verified
        fact = FULFILLED_BY.get(rule.id)
        done = True if fact and fact(case.dates) else None
        case = cases.replace_deadline(case, _auto(rule, computed, prev=prev, done=done))
    return case, holidays_ok


def add(pid: str, kind: str, base: str, extra: dict | None = None, *, project_dir: str | None = None) -> cases.Deadline:
    """oa 单元调用契约（routes_oa /rounds 落一轮 OA 后调用；同步函数，直接落盘 case.json）。

    add(pid, kind, base, extra) -> cases.Deadline
      pid   : 项目 id（case.json 在 <PROJECTS_DIR>/<pid>/）
      kind  : rules.json 里 base_date == "event" 的规则 id
              （"oa_first_reply" | "oa_subsequent_reply" | "reexam_request"），
              或简写 "oa_reply"（按 extra["round"] 选规则：1 ⇒ oa_first_reply，其余 ⇒ oa_subsequent_reply）
      base  : 发文日 "YYYY-MM-DD"（通知书上的发文日，不是收到日）
      extra : {"delivery": "electronic" | "mail"  # 送达方式，默认 electronic；mail ⇒ 发文日 +15 日推定送达
               "round": int,                        # OA 轮次（kind="oa_reply" 时必填）
               "round_id": str,                     # 该轮 OaRound.id；期限 id = f"{rule}:{round_id}"，重复调用幂等覆盖
               "deadline_id": str,                  # 显式指定期限 id（oa/rounds.py 用 OaRound.deadline_id）
               "extension_months": int,             # 已批准延长期限月数（细则第六条）
               "done": bool,                        # 已答复（filed_on 已填）
               "note": str,                         # 备注（默认“送达方式：…”）
               "title": str}                        # 覆盖默认标题（可选）
      project_dir : 案卷目录（省略 ⇒ cases.project_dir(pid)）
    返回写入的 Deadline（source="auto"，legal_basis 来自规则）。同 id 已被人工改期（manual）⇒ 不覆盖，返回现存那条。
    不 emit 事件；oa.round 事件由 oa 单元自己发。
    """
    extra = extra or {}
    rule_id = kind
    if kind == "oa_reply":
        rule_id = OA_REPLY_RULES.get(int(extra["round"]), "oa_subsequent_reply")
    rule = compute.rule(rule_id)
    if rule.base_date != "event":
        raise ValueError(f"规则 {rule_id} 不是事件类期限，应由 recompute 按 dates.* 生成")
    delivery = extra.get("delivery", "electronic")
    computed = compute.compute(
        rule, date.fromisoformat(base), delivery=delivery, extension_months=int(extra.get("extension_months") or 0)
    )
    project_dir = project_dir or cases.project_dir(pid)
    did = extra.get("deadline_id") or (
        f"{rule_id}:{extra['round_id']}" if extra.get("round_id") else f"{rule_id}:{base}"
    )
    # R93：manual 守卫与 load→replace→save 都在锁内——锁外取到的 case 可能已陈旧
    with atomic.studio_lock(project_dir, "case"):
        case = cases.ensure_case(project_dir)
        prev = case.deadline(did)
        if prev is not None and prev.source == "manual":
            return prev
        item = _auto(rule, computed, prev=prev, title=extra.get("title"), done=extra.get("done"))
        note = extra.get("note") or (prev.note if prev else f"送达方式：{delivery}")
        item = item.model_copy(update={"id": did, "note": note})
        cases.save_case(project_dir, cases.replace_deadline(case, item))
        return item
