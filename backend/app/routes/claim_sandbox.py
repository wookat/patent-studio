# -*- coding: utf-8 -*-
"""Z20 权项沙盘（只读）：

GET  /api/projects/{pid}/claims/{num}          —— 单项详情：独立/从属、当前引用、直接+全部下游、
                                                现状上游、支持术语锚点、命中规则（issues）
POST /api/projects/{pid}/claims/{num}/preview  —— 「若引用改为 refs」的安全预览（不写正文）；
                                                无效/缺失/自引/前向/循环引用逐项阻断并给出环路径。

两个端点都基于 /preflight 同源的 claim_tree/support_map（复用 _report），不新建权项树，
不产生任何写操作；结构调整须由代理人在编辑器修订正文，或走 ai-proposals 人工确认通道。
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app.domain.claim_sandbox import detail as claim_detail
from app.domain.claim_sandbox import preview as claim_preview

from .preflight import _report

router = APIRouter(prefix="/api/projects/{pid}", tags=["claims-sandbox"])


def _tree_support(request: Request, pid: str):
    report = _report(request.app.state.store, pid, None, None)
    return report.get("claim_tree") or [], report.get("support_map") or []


@router.get("/claims/{num}")
async def get_claim(pid: str, num: int, request: Request):
    tree, support = _tree_support(request, pid)
    return claim_detail(tree, support, num)


class ClaimPreviewIn(BaseModel):
    """refs 必须是严格的正整数列表：list[int] 默认会把 true→1、1.0→1、'1'→1 静默收编，
    故在 mode='before' 校验原始值——bool / 浮点 / 字符串 / ≤0 一律 422，预览不执行。
    合法空列表表示「移除全部引用 → 变独立权」；不设权项数上限（超大值走 missing 语义）。"""

    refs: list[int] = Field(default_factory=list)

    @field_validator("refs", mode="before")
    @classmethod
    def _strict_positive_refs(cls, v):
        if not isinstance(v, list):
            return v  # 交给 pydantic 自身的 list 校验报错
        for i, item in enumerate(v):
            if isinstance(item, bool) or not isinstance(item, int) or item < 1:
                raise ValueError(f"refs[{i}] 必须是正整数权项编号")
        return v


@router.post("/claims/{num}/preview")
async def post_claim_preview(pid: str, num: int, body: ClaimPreviewIn, request: Request):
    tree, support = _tree_support(request, pid)
    return claim_preview(tree, support, num, body.refs)
