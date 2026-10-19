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
from pydantic import BaseModel, Field

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
    refs: list[int] = Field(default_factory=list)


@router.post("/claims/{num}/preview")
async def post_claim_preview(pid: str, num: int, body: ClaimPreviewIn, request: Request):
    tree, support = _tree_support(request, pid)
    return claim_preview(tree, support, num, body.refs)
