"""idempotent operations and transactional outbox

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "operations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.String(length=128), nullable=False),
        sa.Column("type", sa.String(length=128), nullable=False),
        sa.Column("principal_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("payload_key", sa.String(length=512), nullable=True),
        sa.Column("payload_sha256", sa.String(length=64), nullable=True),
        sa.Column("payload_size", sa.Integer(), nullable=True),
        sa.Column("payload_type", sa.String(length=128), nullable=True),
        sa.Column("error_summary", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')",
            name=op.f("ck_operations_status"),
        ),
        sa.CheckConstraint("payload_size IS NULL OR payload_size >= 0", name=op.f("ck_operations_payload_size")),
        sa.ForeignKeyConstraint(["principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_operations")),
        sa.UniqueConstraint("operation_id", name="uq_operations_operation_id"),
    )
    op.create_index("ix_operations_scope_status", "operations", ["organization_id", "case_id", "status"], unique=False)
    op.create_table(
        "outbox_events",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("payload_key", sa.String(length=512), nullable=True),
        sa.Column("payload_sha256", sa.String(length=64), nullable=True),
        sa.Column("payload_size", sa.Integer(), nullable=True),
        sa.Column("payload_type", sa.String(length=128), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by", sa.String(length=128), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("payload_size IS NULL OR payload_size >= 0", name=op.f("ck_outbox_events_payload_size")),
        sa.CheckConstraint("attempt_count >= 0", name=op.f("ck_outbox_events_attempt_count")),
        sa.ForeignKeyConstraint(["operation_id"], ["operations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id", name=op.f("pk_outbox_events")),
    )
    op.create_index("ix_outbox_claimable", "outbox_events", ["published_at", "lease_until", "created_at"], unique=False)
    op.create_index("ix_outbox_operation", "outbox_events", ["operation_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_outbox_operation", table_name="outbox_events")
    op.drop_index("ix_outbox_claimable", table_name="outbox_events")
    op.drop_table("outbox_events")
    op.drop_index("ix_operations_scope_status", table_name="operations")
    op.drop_table("operations")
