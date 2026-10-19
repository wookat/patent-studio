# -*- coding: utf-8 -*-
"""Z32 成果度量：本案 agent:* Job/Proposal/usage 关联的纯聚合（不新增账本，仅本案口径）。

口径（全部证据可回溯，不用调用数/采纳率当质量排名）：
- jobs：按 id 去重；resumed = result.resumed 或任一步骤 data.resumed（Z14 恢复链路留痕）；
  duration_s = updated_at − created_at（含排队与中断间隔，≠ 模型推理时长，见 limits）。
- proposals：jsonl 同 id 取末行（函数内去重自证契约，调用方给重放行也不重复计数）后按
  state 分桶 pending/applied/dismissed；produced = 去重后全量。
- usage：read_usage 行数与 total_tokens 求和；token≠费用（无单价/币种采集 ⇒ cost.collected=False）。
- human_edits：人工改动量无采集管道 ⇒ collected=False。
返回 items 均带 id/job_id/state，前端可点回具体提案/任务；不输出正文与凭证——
job.error 只透出结构化 kind + 固定文案，原始 message 可能含上游响应正文/凭证，绝不外发。
"""

from app.ai.jobs import FINAL

# 度量不导出原始错误文本（AiError message 可能拼进上游响应正文，含正文/凭证/内部细节）
_SAFE_ERROR_MESSAGE = "任务失败；错误明细见任务时间线或服务端日志（度量不导出原始错误文本）"


def _safe_error(err) -> dict | None:
    """job.error → {kind, message}：kind 是 error_detail 的受控码（ai_*/internal），
    message 一律固定文案——原始 message/detail 不透出。"""
    if not isinstance(err, dict) or not err:
        return None
    kind = err.get("kind")
    return {"kind": kind if isinstance(kind, str) and kind else "internal", "message": _SAFE_ERROR_MESSAGE}


def _job_item(j: dict) -> dict:
    steps = j.get("steps") or []
    resumed = bool((j.get("result") or {}).get("resumed")) or any(
        bool((s.get("data") or {}).get("resumed")) for s in steps
    )
    duration = None
    if (
        j.get("status") in FINAL
        and isinstance(j.get("created_at"), (int, float))
        and isinstance(j.get("updated_at"), (int, float))
    ):
        d = j["updated_at"] - j["created_at"]
        duration = round(d, 1) if d >= 0 else None
    return {
        "id": j["id"],
        "kind": j["kind"],
        "status": j["status"],
        "progress": j.get("progress", 0.0),
        "created_at": j.get("created_at"),
        "updated_at": j.get("updated_at"),
        "duration_s": duration,
        "resumed": resumed,
        "proposal_ids": j.get("proposal_ids") or [],
        "error": _safe_error(j.get("error")),
    }


def _proposal_item(p: dict) -> dict:
    return {
        "id": p["id"],
        "job_id": p.get("job_id"),
        "scenario": p.get("scenario"),
        "kind": p.get("kind"),
        "state": p.get("state", "pending"),
        "model": p.get("model") or None,
        "created_at": p.get("created_at"),
    }


def case_metrics(jobs: list[dict], proposals: list[dict], usage_rows: list[dict]) -> dict:
    """聚合一案的 agent 成果。jobs = 全部 kind='agent:*' 任务（内部按 id 去重，后到者胜——同 id 重载覆盖）。"""
    by_id: dict[str, dict] = {}
    for j in jobs:
        if j.get("kind", "").startswith("agent:"):
            by_id[j["id"]] = j
    items = [_job_item(j) for j in sorted(by_id.values(), key=lambda x: x.get("created_at") or 0)]
    status_counts: dict[str, int] = {}
    for it in items:
        status_counts[it["status"]] = status_counts.get(it["status"], 0) + 1

    # jsonl 追加日志：同 id 末行 = 最新状态。proposals.load 已给 latest，函数内仍去重自证
    # 契约——直接把重放行列表传进来也不会把同一提案重复计入两个状态桶。
    last_by_id: dict[str, dict] = {}
    for p in proposals:
        last_by_id[p["id"] if p.get("id") else f"#{len(last_by_id)}"] = p
    p_items = [_proposal_item(p) for p in sorted(last_by_id.values(), key=lambda x: x.get("created_at") or 0)]
    p_states: dict[str, int] = {}
    for it in p_items:
        p_states[it["state"]] = p_states.get(it["state"], 0) + 1

    tokens = [int(r.get("total_tokens") or 0) for r in usage_rows]
    limits = [
        "样本仅本案 agent:* 任务与提案台账；非 agent 来源（手工批注、外部写入）不计入。",
        "耗时 = 任务创建到最近一次状态更新（含排队、等待人工、中断间隔），不等于模型推理时长。",
        "token 计数仅供量级参考；未采集单价/币种，费用无法折算。",
        "采纳率 / 调用数不构成质量排名依据。",
    ]
    if any(it["resumed"] for it in items):
        limits.append("含恢复续跑任务（resumed）：其耗时跨中断间隔，偏大。")
    no_prop = sum(1 for it in items if it["status"] == "done" and not it["proposal_ids"])
    if no_prop:
        limits.append(f"{no_prop} 个完成任务未产出提案——不计入待审/采纳/拒绝。")

    return {
        "sample": {"jobs": len(items), "proposals": len(p_items), "usage_rows": len(usage_rows)},
        "jobs": {
            "total": len(items),
            "queued": status_counts.get("queued", 0),
            "running": status_counts.get("running", 0),
            "done": status_counts.get("done", 0),
            "error": status_counts.get("error", 0),
            "interrupted": status_counts.get("interrupted", 0),
            "resumed": sum(1 for it in items if it["resumed"]),
            "items": items,
        },
        "proposals": {
            "produced": len(p_items),
            "pending": p_states.get("pending", 0),
            "applied": p_states.get("applied", 0),
            "dismissed": p_states.get("dismissed", 0),
            "items": p_items,
        },
        "usage": {"rows": len(usage_rows), "total_tokens": sum(tokens) if usage_rows else None},
        "cost": {"collected": False, "reason": "未采集单价与币种，token 数无法折算费用"},
        "human_edits": {"collected": False, "reason": "未采集人工改动量（提案采纳后的人工修订无结构化记录）"},
        "limits": limits,
    }
