"""durable runs, ordered run events and approval inbox

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.String(length=128), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("triggered_by_principal_id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=24), server_default="queued", nullable=False),
        sa.Column("fencing_epoch", sa.Integer(), server_default="1", nullable=False),
        sa.Column("temporal_workflow_id", sa.String(length=256), nullable=True),
        sa.Column("temporal_run_id", sa.String(length=256), nullable=True),
        sa.Column("error_summary", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'canceled')",
            name=op.f("ck_runs_status"),
        ),
        sa.CheckConstraint("fencing_epoch > 0", name=op.f("ck_runs_fencing_epoch")),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["triggered_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["operation_id"], ["operations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_runs")),
        sa.UniqueConstraint("run_id", name="uq_runs_run_id"),
    )
    op.create_index("ix_runs_case_status", "runs", ["case_id", "status"], unique=False)
    op.create_index("ix_runs_principal_created", "runs", ["triggered_by_principal_id", "created_at"], unique=False)
    op.create_table(
        "run_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("activity_key", sa.String(length=160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("seq > 0", name=op.f("ck_run_events_seq")),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_run_events")),
        sa.UniqueConstraint("run_id", "seq", name="uq_run_events_run_seq"),
        sa.UniqueConstraint("run_id", "activity_key", name="uq_run_events_activity"),
    )
    op.create_index("ix_run_events_run_seq", "run_events", ["run_id", "seq"], unique=False)
    op.create_table(
        "approvals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("approver_principal_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("decided_by_principal_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name=op.f("ck_approvals_status")),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approver_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["decided_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_approvals")),
    )
    op.create_index("ix_approvals_approver_status", "approvals", ["approver_principal_id", "status"], unique=False)
    op.create_index("ix_approvals_run_status", "approvals", ["run_id", "status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_approvals_run_status", table_name="approvals")
    op.drop_index("ix_approvals_approver_status", table_name="approvals")
    op.drop_table("approvals")
    op.drop_index("ix_run_events_run_seq", table_name="run_events")
    op.drop_table("run_events")
    op.drop_index("ix_runs_principal_created", table_name="runs")
    op.drop_index("ix_runs_case_status", table_name="runs")
    op.drop_table("runs")
