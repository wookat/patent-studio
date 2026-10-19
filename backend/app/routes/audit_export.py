# -*- coding: utf-8 -*-
"""Z33 案卷审计导出（notify-audit-backend 域）：GET /api/projects/{pid}/audit/export?fmt=json|csv。

导出事件 + 确认 + 提案 + 版本；不含凭证（share token / PAT / IP / UA / 提案正文均不落）。
viewer 可读（与 /timeline 同门槛——案内审计轨迹对案件参与者透明）。"""

import urllib.parse

from fastapi import APIRouter, Request, Response

from app.domain import audit_export

router = APIRouter(prefix="/api/projects/{pid}/audit", tags=["audit"])


@router.get("/export")
def export_audit(pid: str, request: Request, fmt: str = "json"):
    project = request.app.state.store.get(pid)
    doc = audit_export.build_audit(project.dir, pid)
    if fmt == "csv":
        name = urllib.parse.quote(f"审计轨迹-{project.title}.csv")
        return Response(
            audit_export.to_csv(doc),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{name}"},
        )
    return doc
