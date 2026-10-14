# -*- coding: utf-8 -*-
"""OA 轮次记录 + 答复期限登记（docs/plan/21 §2.1 R-OA-02、§2.2 R-OA-05；单元 oa-import-backend）。

<project>/.studio/oa/rounds/<n>.json
  {n, id, kind: first|subsequent|reexam|rejection, issued_on, delivery: electronic|mail, notice_text_sha, items[],
   reply_refs[], filed_on, extensions[{months, requested_at}], deadline_id, created_at}
  n 从 1 递增；id = str(n)（API 路径参数）；items 为该轮拆条结果（parse.OaItem）；reply_refs 为答复稿引用
  （history 版本 / 意见陈述书文件名，由 OA 面板写入）；filed_on 为答复递交日（填了 ⇒ 期限标 done；
  rejection 轮次的 filed_on = 复审请求递交日）。

期限统一走 deadlines 规则引擎（deadlines.add(pid, rule, issued_on, extra, project_dir=…)，规则见 rules.json）：
  first ⇒ oa_first_reply（4 个月）、subsequent ⇒ oa_subsequent_reply（2 个月）、reexam ⇒ reexam_notice_reply（1 个月）、
  rejection ⇒ reexam_request（驳回决定发文后 3 个月内提出复审请求；法定期限不可延期）；
  送达日 / 延期 / 节假日顺延都由 deadlines.compute 计算；期限 id = OaRound.deadline_id（"oa-<n>"），重复登记幂等覆盖，
  人工改期（source=manual）的条目不覆盖。
"""

import hashlib
import json
import os
import time
from datetime import date

from app import atomic, deadlines
from app.deadlines import compute
from app.domain import cases

ROUNDS_DIR = os.path.join(".studio", "oa", "rounds")
MAIL_DAYS = compute.MAIL_DAYS
RULE_OF = {
    "first": "oa_first_reply",
    "subsequent": "oa_subsequent_reply",
    "reexam": "reexam_notice_reply",
    "rejection": "reexam_request",
}
KIND_LABEL = {
    "first": "第一次审查意见通知书",
    "subsequent": "审查意见通知书",
    "reexam": "复审通知书",
    "rejection": "驳回决定",
}
DELIVERY_LABEL = {"electronic": "电子送达", "mail": "邮寄送达"}


class RoundError(Exception):
    def __init__(self, message: str, status: int = 400, kind: str = "validation"):
        super().__init__(message)
        self.status = status
        self.kind = kind


# ---------- 文件 ----------


def rounds_dir(project_dir: str) -> str:
    return os.path.join(project_dir, ROUNDS_DIR)


def _path(project_dir: str, n: int) -> str:
    return os.path.join(rounds_dir(project_dir), f"{n}.json")


def list_rounds(project_dir: str) -> list[dict]:
    d = rounds_dir(project_dir)
    if not os.path.isdir(d):
        return []
    out = []
    for name in sorted(os.listdir(d), key=lambda s: int(s[:-5]) if s[:-5].isdigit() else 0):
        if name.endswith(".json") and name[:-5].isdigit():
            try:
                with open(os.path.join(d, name), encoding="utf-8") as f:
                    out.append(json.load(f))
            except ValueError as e:
                raise RoundError(f"OA 轮次文件 {name} 无法读取：{e}", 422) from e
    return out


def load_round(project_dir: str, rid: str) -> dict:
    if not rid.isdigit() or not os.path.isfile(_path(project_dir, int(rid))):
        raise RoundError(f"OA 轮次 {rid} 不存在", 404, "not_found")
    try:
        with open(_path(project_dir, int(rid)), encoding="utf-8") as f:
            return json.load(f)
    except ValueError as e:
        raise RoundError(f"OA 轮次文件无法读取：{e}", 422) from e


def save_round(project_dir: str, rnd: dict) -> dict:
    atomic.write_json(_path(project_dir, rnd["n"]), rnd)
    return rnd


def create_round(project_dir: str, *, kind: str, issued_on: str, delivery: str) -> dict:
    n = max((r["n"] for r in list_rounds(project_dir)), default=0) + 1
    rnd = {
        "n": n,
        "id": str(n),
        "kind": kind,
        "issued_on": _iso(issued_on),
        "delivery": delivery,
        "notice_text_sha": None,
        "items": [],
        "reply_refs": [],
        "filed_on": None,
        "extensions": [],
        "deadline_id": f"oa-{n}",
        "created_at": time.time(),
    }
    register_deadline(project_dir, rnd)
    return save_round(project_dir, rnd)


def update_round(
    project_dir: str,
    rid: str,
    *,
    kind: str | None = None,
    issued_on: str | None = None,
    delivery: str | None = None,
    extension_months: int | None = None,
    filed_on: str | None = None,
    reply_refs: list[str] | None = None,
) -> dict:
    rnd = load_round(project_dir, rid)
    if kind is not None:
        rnd["kind"] = kind
    if issued_on is not None:
        rnd["issued_on"] = _iso(issued_on)
    if delivery is not None:
        rnd["delivery"] = delivery
    if filed_on is not None:
        rnd["filed_on"] = _iso(filed_on)
    if reply_refs is not None:
        rnd["reply_refs"] = list(reply_refs)
    if extension_months is not None:
        _append_extension(rnd, extension_months)
    if rnd["kind"] == "rejection" and rnd["extensions"]:
        # kind 被改成驳回决定：复审请求期限为法定期限，既有延期记录作废
        rnd["extensions"] = []
    register_deadline(project_dir, rnd)
    return save_round(project_dir, rnd)


def extend_round(project_dir: str, rid: str, months: int) -> dict:
    rnd = load_round(project_dir, rid)
    _append_extension(rnd, months)
    register_deadline(project_dir, rnd)
    return save_round(project_dir, rnd)


def _append_extension(rnd: dict, months: int) -> None:
    """延长期限请求：每次 1 或 2 个月，累计不超过 2 个月（细则第 6 条；复审阶段同）。
    驳回决定的复审请求期限是法定期限（提出复审请求 3 个月），不在可延展的指定期限内 ⇒ 拒绝。"""
    if rnd["kind"] == "rejection":
        raise RoundError("复审请求期限为法定期限，不可延期", 422)
    if months not in (1, 2):
        raise RoundError("延期只能申请 1 或 2 个月")
    if sum(e["months"] for e in rnd["extensions"]) + months > 2:
        raise RoundError("累计延期不能超过 2 个月", 409, "conflict")
    rnd["extensions"].append({"months": months, "requested_at": cases.local_today().isoformat()})


def attach_items(project_dir: str, rid: str, text: str, items: list[dict]) -> dict:
    rnd = load_round(project_dir, rid)
    rnd["items"] = items
    rnd["notice_text_sha"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return save_round(project_dir, rnd)


def delete_round(project_dir: str, rid: str) -> None:
    rnd = load_round(project_dir, rid)
    with atomic.studio_lock(project_dir, "case"):
        case = cases.load_case(project_dir)
        kept = [d for d in case.deadlines if d.id != rnd["deadline_id"]]
        if len(kept) != len(case.deadlines):
            cases.save_case(project_dir, case.model_copy(update={"deadlines": kept}))
    os.remove(_path(project_dir, rnd["n"]))


def to_api(rnd: dict) -> dict:
    """schemas.OaRound 形状（items 只给条数；全文用 GET /rounds/{rid}）。"""
    return {
        "id": rnd["id"],
        "kind": rnd["kind"],
        "issued_on": rnd["issued_on"],
        "delivery": rnd["delivery"],
        "deadline_id": rnd["deadline_id"],
        "items": len(rnd["items"]),
        "extensions": rnd["extensions"],
        "filed_on": rnd["filed_on"],
        "created_at": rnd["created_at"],
    }


# ---------- 期限 ----------


def _iso(v: str) -> str:
    try:
        return date.fromisoformat(v).isoformat()
    except ValueError:
        raise RoundError(f"日期须为 YYYY-MM-DD：{v!r}")


def add_months(d: date, months: int) -> date:
    return compute.add_months(d, months)


def served_on(issued_on: date, delivery: str) -> date:
    return compute.deemed_received(issued_on, delivery)


def _extension_months(rnd: dict) -> int:
    return sum(e["months"] for e in rnd["extensions"])


def reply_due(rnd: dict) -> tuple[str, bool]:
    computed = compute.compute(
        compute.rule(RULE_OF[rnd["kind"]]),
        date.fromisoformat(rnd["issued_on"]),
        delivery=rnd["delivery"],
        extension_months=_extension_months(rnd),
    )
    return computed.due.isoformat(), computed.holidays_verified


def register_deadline(project_dir: str, rnd: dict) -> cases.Deadline:
    """经 deadlines.add 把本轮答复/请求期限写进 case.json.deadlines[]（id = deadline_id，重复登记覆盖，manual 不覆盖）。
    驳回决定轮次的期限是「提出复审请求」而非答复——措辞按 kind 分叉。"""
    ext = "".join(f"，延期 {e['months']} 个月" for e in rnd["extensions"])
    if rnd["kind"] == "rejection":
        action = "复审请求"
        note = f"{action}（驳回决定发文 {rnd['issued_on']}，{DELIVERY_LABEL[rnd['delivery']]}{ext}）"
    else:
        action = f"答复{KIND_LABEL[rnd['kind']]}"
        note = f"{action}（发文 {rnd['issued_on']}，{DELIVERY_LABEL[rnd['delivery']]}{ext}）"
    return deadlines.add(
        os.path.basename(os.path.normpath(project_dir)),
        RULE_OF[rnd["kind"]],
        rnd["issued_on"],
        {
            "delivery": rnd["delivery"],
            "round_id": rnd["id"],
            "deadline_id": rnd["deadline_id"],
            "extension_months": _extension_months(rnd),
            "done": rnd["filed_on"] is not None,
            "note": note,
            "title": f"{action}（第 {rnd['n']} 轮）",
        },
        project_dir=project_dir,
    )
