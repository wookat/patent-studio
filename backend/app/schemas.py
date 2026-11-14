# -*- coding: utf-8 -*-
"""W5 响应 / 请求模型（docs/plan/21 §4 / §7.4.8）；与 frontend/src/types/ 的域文件逐字段对应
（deadlines / notify / public-share / timeline / org，字段名、可空性、Literal 值）。

prep 只定形状；单元实现路由时 `response_model=` 引用此处，不得另造同名模型。改动字段必须同步对应 types 文件
并更新 frontend/src/store/README.md。时间戳一律 epoch 秒（float）；日期一律 `YYYY-MM-DD`（Asia/Shanghai，后端权威）。
"""

from typing import Literal

from pydantic import BaseModel, Field

from app.domain.cases import CaseStatus


class Actor(BaseModel):
    id: str
    display_name: str
    # 账户预设头像色名（'' = 未选，前端按名派生），供期限中心等处头像与顶栏 / 台账同色
    avatar_color: str = ""


# ---------- 期限（deadlines-backend） ----------

DeadlineKind = Literal[
    "oa_reply", "exam_request", "priority", "annual_fee", "review_due", "divisional", "reexam", "publication", "custom"
]
DeadlineRange = Literal["today", "7d", "30d", "overdue", "all"]
DeadlineStatus = Literal["upcoming", "due_soon", "overdue", "done"]


class LegalBasis(BaseModel):
    text: str
    url: str


class Extension(BaseModel):
    months: int
    requested_at: str


class DeadlineItem(BaseModel):
    id: str
    pid: str
    case_no: str | None = None
    title: str
    kind: DeadlineKind
    due: str
    base_date: str | None = None
    rule: str | None = None
    legal_basis: LegalBasis | None = None
    source: Literal["auto", "manual"]
    override_reason: str | None = None
    status: DeadlineStatus
    days_left: int
    owner: Actor | None = None
    client: str | None = None
    done: bool = False
    done_at: float | None = None
    extensions: list[Extension] = Field(default_factory=list)
    # R77-01：行级写操作门控用——当前用户在 pid 案的角色；off/匿名 ⇒ None（前端视为可写）
    my_role: str | None = None
    # Z22：届满年份的节假日表是否已核对（False ⇒ 只按周末顺延过，届满日有不确定性）
    holidays_verified: bool = True


class DeadlineListResponse(BaseModel):
    items: list[DeadlineItem]
    counts: dict[Literal["today", "7d", "30d", "overdue"], int]
    holidays_missing: bool = False


class DeadlineOverrideIn(BaseModel):
    due: str | None = None
    override_reason: str = Field(min_length=1, max_length=500)


class DeadlineDoneIn(BaseModel):
    done: bool = True


# ---------- 通知 / 催办（notify-audit-backend） ----------

NotificationKind = Literal["mention", "assign", "deadline", "confirm", "ai", "nudge", "system"]


class Notification(BaseModel):
    id: str
    kind: NotificationKind
    title: str
    body: str = ""
    href: str | None = None
    pid: str | None = None
    actor: Actor | None = None
    read: bool = False
    created_at: float


class NotificationListResponse(BaseModel):
    items: list[Notification]
    unread: int
    has_more: bool = False


class ReadAllResult(BaseModel):
    updated: int


class NudgeIn(BaseModel):
    deadline_id: str | None = None
    user_id: str | None = None
    message: str | None = Field(default=None, max_length=500)


class WebhookTestIn(BaseModel):
    url: str | None = None  # 空 = 用已存 settings.notify_webhook_url


class WebhookTestResult(BaseModel):
    ok: bool
    detail: str = ""


class NudgeResult(BaseModel):
    notified: int


# ---------- 客户公开审阅（share-confirm-backend） ----------

PublicShareScope = Literal["read", "comment", "confirm"]
# 客户看哪份正文（W9 domain-02）：original = 撰写人已定正文（未决修订按拒绝）；final = 含未决修订（按接受渲染）
PublicShareBaseline = Literal["original", "final"]


class PublicShareLink(BaseModel):
    token: str
    pid: str
    scope: PublicShareScope
    baseline: PublicShareBaseline = "original"
    allow_download: bool = False
    expires_at: float | None = None
    revoked: bool = False
    created_by: Actor
    created_at: float
    visits: int = 0
    last_visit_at: float | None = None


class PublicShareLinkIn(BaseModel):
    scope: PublicShareScope = "comment"
    baseline: PublicShareBaseline = "original"
    ttl_days: int | None = Field(default=30, ge=1, le=365)
    allow_download: bool = False


class Confirmation(BaseModel):
    version: int
    sha: str
    content_sha: str | None = None
    name: str
    note: str | None = None
    confirmed_at: float


class PublicShareMeta(BaseModel):
    org_name: str
    title: str
    case_no: str | None = None
    status: CaseStatus
    version: int
    sha: str
    content_sha: str
    scope: PublicShareScope
    baseline: PublicShareBaseline = "original"
    # 当前正文里尚未接受 / 拒绝的修订数（ins / del / sub）；>0 时客户页提示本审阅版按 baseline 渲染
    pending_revisions: int = 0
    # studio.json settings.sub_except：客户页版面渲染行内格式时这些子串内的 `_` 不作下标
    sub_except: list[str] = []
    allow_download: bool
    expires_at: float | None = None
    confirmation: Confirmation | None = None
    pdf_ready: bool = False


class PublicAnchor(BaseModel):
    block_id: str
    line: int
    quote: str = ""
    book: Literal["abstract", "claims", "description"] | None = None


class PublicCommentIn(BaseModel):
    anchor: PublicAnchor
    body: str = Field(min_length=1, max_length=4000)
    guest_name: str = Field(min_length=1, max_length=64)


class PublicConfirmIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=2000)


# ---------- 时间线 / 备注 / 审阅指派（share-confirm-backend） ----------

TimelineEventKind = Literal[
    "case.created",
    "case.status",
    "note",
    "share.created",
    "share.confirmed",
    "deliver.filed",
    "oa.round",
    "deadline.done",
    "deadline.undone",
    "deadline.override",
    "review.assigned",
    "export.downloaded",
    "ai.proposal",
]


class TimelineEvent(BaseModel):
    id: str
    kind: TimelineEventKind
    ts: float
    actor: Actor | None = None
    text: str
    mentions: list[str] = Field(default_factory=list)
    data: dict = Field(default_factory=dict)


class TimelineResponse(BaseModel):
    items: list[TimelineEvent]


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class ReviewAssignIn(BaseModel):
    user_id: str
    due: str | None = None


class ReviewAssignResult(BaseModel):
    deadline_id: str | None = None


# ---------- 机构审计 / 设置 / AI 用量（notify-audit-backend / agent-core-backend） ----------

OrgAuditKind = Literal[
    "auth.login",
    "case.created",
    "case.deleted",
    "case.status",
    "member.changed",
    "admin.user",
    "share.created",
    "share.revoked",
    "share.confirmed",
    "export.downloaded",
    "ai.sent",
    "ai.egress_toggle",
    "org.ai_policy",
    "deliver.filed",
    "oa.round",
    "deadline.done",
    "deadline.undone",
    "deadline.override",
    "deadline.nudge",
    "comment.assign",
]


class OrgAuditEvent(BaseModel):
    id: str
    ts: float
    kind: OrgAuditKind
    actor: Actor | None = None
    pid: str | None = None
    data: dict = Field(default_factory=dict)


class OrgAuditResponse(BaseModel):
    items: list[OrgAuditEvent]
    total: int


class DefaultCollab(BaseModel):
    editor_mode: Literal["edit", "review"] = "edit"
    allow_viewer_comment: bool = True


class Smtp(BaseModel):
    host: str = ""
    port: int = 587
    user: str = ""
    from_: str = Field(default="", alias="from")
    enabled: bool = False

    model_config = {"populate_by_name": True}


class OrgSettings(BaseModel):
    ai_enabled: bool = True
    default_collab: DefaultCollab = Field(default_factory=DefaultCollab)
    smtp: Smtp | None = None
    ai_daily_tokens: int = Field(default=200_000, ge=0)


class OrgSettingsPatch(BaseModel):
    ai_enabled: bool | None = None
    default_collab: DefaultCollab | None = None
    smtp: Smtp | None = None
    ai_daily_tokens: int | None = Field(default=None, ge=0)


class AiUsageByProject(BaseModel):
    pid: str
    title: str
    today_tokens: int


class AiUsageByModel(BaseModel):
    model: str
    tokens: int
    calls: int


class AiUsageSummary(BaseModel):
    today_tokens: int
    budget: int
    by_project: list[AiUsageByProject] = Field(default_factory=list)
    by_model: list[AiUsageByModel] = Field(default_factory=list)


# ---------- OA 轮次（oa-import-backend） ----------

OaRoundKind = Literal["first", "subsequent", "reexam", "rejection"]
OaDelivery = Literal["electronic", "mail"]


class OaRound(BaseModel):
    id: str
    kind: OaRoundKind
    issued_on: str
    delivery: OaDelivery
    deadline_id: str | None = None
    items: int = 0
    extensions: list[Extension] = Field(default_factory=list)
    filed_on: str | None = None
    created_at: float


class OaRoundIn(BaseModel):
    kind: OaRoundKind
    issued_on: str
    delivery: OaDelivery = "electronic"


class OaRoundPatch(BaseModel):
    kind: OaRoundKind | None = None
    issued_on: str | None = None
    delivery: OaDelivery | None = None
    extension_months: int | None = Field(default=None, ge=1, le=2)


class OaRoundsResponse(BaseModel):
    rounds: list[OaRound]


# ---------- 递交页字段级错误（preflight-backend） ----------


class DeliverError(BaseModel):
    field: str
    code: str
    message: str


class DeliverErrorsResponse(BaseModel):
    errors: list[DeliverError]


# ---------- 构建 tagged PDF 开关（three-view） ----------


class BuildTagged(BaseModel):
    pdf_tagged: bool = False
