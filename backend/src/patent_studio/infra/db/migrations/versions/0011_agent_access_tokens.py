"""scoped bearer tokens for registered agents

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_access_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("principal_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("case_id", sa.Uuid(), nullable=True),
        sa.Column("token_prefix", sa.String(length=16), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('active', 'revoked')", name=op.f("ck_agent_access_tokens_status")),
        sa.ForeignKeyConstraint(["principal_id"], ["principals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agent_access_tokens")),
        sa.UniqueConstraint("token_hash", name="uq_agent_access_tokens_hash"),
    )
    op.create_index(
        "ix_agent_access_tokens_principal_status",
        "agent_access_tokens",
        ["principal_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_agent_access_tokens_scope",
        "agent_access_tokens",
        ["organization_id", "case_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_agent_access_tokens_scope", table_name="agent_access_tokens")
    op.drop_index("ix_agent_access_tokens_principal_status", table_name="agent_access_tokens")
    op.drop_table("agent_access_tokens")
