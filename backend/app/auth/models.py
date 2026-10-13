# -*- coding: utf-8 -*-
"""R6 数据模型（docs/plan/07 §2）：users / projects_acl / share_links；R7 personal_access_token（docs/plan/10 §3.4）；
W4-B（docs/plan/14 §2）：project_access / pending_invites / share_accepts / project_collab_settings；
W5（docs/plan/21 §7.4.8）：notifications / public_share_links / org_audit_events
（全部新表，create_all 自动建）。

只在 PATENT_STUDIO_AUTH=on 时被 C1 的 db.py 导入；off 模式下本模块不加载。
"""
import uuid
from datetime import datetime

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(SQLAlchemyBaseUserTableUUID, Base):
    display_name: Mapped[str] = mapped_column(String(64), default="")
    # W4-E E2（docs/plan/17 §3）：头衔（代理师 / 发明人 / 管理员…，展示用）、头像色（预设名，见 AVATAR_COLORS）、
    # 最近登录（on_after_login 写）。旧库由 db.init_db 的 ADD COLUMN 补齐（USER_ADDED_COLUMNS）。
    title: Mapped[str] = mapped_column(String(32), default="", server_default="")
    avatar_color: Mapped[str] = mapped_column(String(16), default="", server_default="")
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # R71-01：改密时刻（unix 秒，int 精度——JWT iat 只有秒）。签发时刻更早的会话令牌一律失效。
    password_changed_at: Mapped[float | None] = mapped_column(Float, nullable=True)


# 已发布过的 users 表之后新增的列：(列名, SQLite 列定义)。create_all 只建缺表不加列，init_db 逐列 ALTER TABLE。
USER_ADDED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("title", "VARCHAR(32) NOT NULL DEFAULT ''"),
    ("avatar_color", "VARCHAR(16) NOT NULL DEFAULT ''"),
    ("last_login_at", "DATETIME"),
    ("password_changed_at", "FLOAT"),
)


class ProjectAcl(Base):
    __tablename__ = "projects_acl"

    project_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))  # owner | agent | editor | reviewer | viewer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareLink(Base):
    __tablename__ = "share_links"

    token: Mapped[str] = mapped_column(String(48), primary_key=True)  # secrets.token_urlsafe(24)
    project_id: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(16))  # agent | editor | reviewer | viewer（不允许 owner）
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PersonalAccessToken(Base):
    """MCP 个人访问令牌：明文 pat_ + 32 hex 仅创建时返回一次，库中只存 sha256 与展示用前缀。"""

    __tablename__ = "personal_access_token"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # uuid4 hex
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    prefix: Mapped[str] = mapped_column(String(12))  # "pat_" + 8 hex
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectAccess(Base):
    """访问记录（14 §2.1；B1）：打开工作台 / 领取链接时 upsert，同用户 30 分钟内算一次。"""

    __tablename__ = "project_access"

    project_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    count: Mapped[int] = mapped_column(Integer, default=1)


class PendingInvite(Base):
    """邮箱邀请（14 §2；B2）：邮箱存小写；对方注册 / 登录时消费成 projects_acl 行。"""

    __tablename__ = "pending_invites"

    project_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(320), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))  # agent | editor | reviewer | viewer
    invited_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareAccept(Base):
    """经分享链接进入的人（14 §2；`ShareLink.accepted_by[]`）。"""

    __tablename__ = "share_accepts"

    token: Mapped[str] = mapped_column(ForeignKey("share_links.token", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProjectCollabSettings(Base):
    """协作设置（14 D8；B1）：缺行 ⇒ 全 true；服务端只存不拦，前端按字段隐藏入口。"""

    __tablename__ = "project_collab_settings"

    project_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    allow_download: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_copy: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_comment: Mapped[bool] = mapped_column(Boolean, default=True)


# ---------- W5（docs/plan/21 §7.4.8）：notify-audit-backend / share-confirm-backend 的表；全部新表 ----------

class Notification(Base):
    """站内通知（schemas.Notification）：kind ∈ NotificationKind；href 是前端 hash 路由；read_at 为 None ⇒ 未读。"""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read_created", "user_id", "read_at", "created_at"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    href: Mapped[str | None] = mapped_column(String(300), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PublicShareLink(Base):
    """免登录客户审阅链接（schemas.PublicShareLink）：与 share_links（登录态邀请）分表；
    scope read|comment|confirm。"""

    __tablename__ = "public_share_links"
    __table_args__ = (Index("ix_public_share_links_project_revoked", "project_id", "revoked"),)

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(64), index=True)
    scope: Mapped[str] = mapped_column(String(8), default="comment")
    allow_download: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    visits: Mapped[int] = mapped_column(Integer, default=0)
    last_visit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 客户看哪份正文：original = 撰写人已定正文（未决修订按拒绝）；final = 含未决修订（按接受渲染）。W9 domain-02。
    baseline: Mapped[str] = mapped_column(String(8), default="original", server_default="original")


# public_share_links 发布后新增的列（同 USER_ADDED_COLUMNS 机制）
PUBLIC_LINK_ADDED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("baseline", "VARCHAR(8) NOT NULL DEFAULT 'original'"),
)


class OrgAuditEvent(Base):
    """机构审计（schemas.OrgAuditEvent）：events 总线 "*" 订阅者写入；data 为 JSON 文本（不存外部全文，只存字数）。
    """

    __tablename__ = "org_audit_events"
    __table_args__ = (Index("ix_org_audit_events_ts_kind", "ts", "kind"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("user.id", ondelete="SET NULL"), nullable=True,
                                                            index=True)
    project_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    data: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
