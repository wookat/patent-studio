"""case work items, assignments, deadlines and persisted notifications

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "work_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("assignee_principal_id", sa.Uuid(), nullable=True),
        sa.Column("reporter_principal_id", sa.Uuid(), nullable=False),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("priority", sa.Integer(), server_default="3", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="open", nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("figure_document_id", sa.Uuid(), nullable=True),
        sa.Column("release_id", sa.Uuid(), nullable=True),
        sa.Column("source_operation_id", sa.Uuid(), nullable=True),
        sa.Column("source_run_id", sa.Uuid(), nullable=True),
        sa.Column("official_no", sa.String(length=128), nullable=True),
        sa.Column("oa_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_document_id", sa.Uuid(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "type IN ('draft', 'review', 'figure', 'oa-response', 'search', 'client-confirm', 'deliver')",
            name=op.f("ck_work_items_type"),
        ),
        sa.CheckConstraint(
            "status IN ('open', 'in_progress', 'blocked', 'in_review', 'done', 'canceled')",
            name=op.f("ck_work_items_status"),
        ),
        sa.CheckConstraint("priority BETWEEN 1 AND 5", name=op.f("ck_work_items_priority")),
        sa.CheckConstraint("oa_deadline IS NULL OR type = 'oa-response'", name=op.f("ck_work_items_oa_deadline_type")),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assignee_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reporter_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["figure_document_id"], ["figure_documents.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["release_id"], ["releases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_operation_id"], ["operations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["response_document_id"], ["documents.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_work_items")),
    )
    op.create_index("ix_work_items_case_status_deadline", "work_items", ["case_id", "status", "deadline"], unique=False)
    op.create_index("ix_work_items_assignee_status", "work_items", ["assignee_principal_id", "status"], unique=False)
    op.alter_column("notifications", "user_id", existing_type=sa.Uuid(), nullable=True)
    op.add_column("notifications", sa.Column("case_id", sa.Uuid(), nullable=True))
    op.add_column("notifications", sa.Column("recipient_principal_id", sa.Uuid(), nullable=True))
    op.add_column("notifications", sa.Column("notification_type", sa.String(length=64), nullable=True))
    op.add_column("notifications", sa.Column("work_item_id", sa.Uuid(), nullable=True))
    op.add_column("notifications", sa.Column("proposal_id", sa.Uuid(), nullable=True))
    op.add_column("notifications", sa.Column("release_id", sa.Uuid(), nullable=True))
    op.add_column("notifications", sa.Column("payload", sa.JSON(), nullable=True))
    op.add_column("notifications", sa.Column("dedupe_key", sa.String(length=160), nullable=True))
    op.create_foreign_key(
        "fk_notifications_case_id_cases", "notifications", "cases", ["case_id"], ["id"], ondelete="RESTRICT"
    )
    op.create_foreign_key(
        "fk_notifications_recipient_principal_id_principals",
        "notifications",
        "principals",
        ["recipient_principal_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_notifications_work_item_id_work_items",
        "notifications",
        "work_items",
        ["work_item_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_notifications_proposal_id_proposals",
        "notifications",
        "proposals",
        ["proposal_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_notifications_release_id_releases",
        "notifications",
        "releases",
        ["release_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint("uq_notifications_dedupe_key", "notifications", ["dedupe_key"])
    op.create_index(
        "ix_notifications_recipient_unread",
        "notifications",
        ["recipient_principal_id", "read_at", "created_at"],
        unique=False,
    )
    op.create_index("ix_notifications_case_created", "notifications", ["case_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_notifications_case_created", table_name="notifications")
    op.drop_index("ix_notifications_recipient_unread", table_name="notifications")
    op.drop_constraint("uq_notifications_dedupe_key", "notifications", type_="unique")
    op.drop_constraint("fk_notifications_release_id_releases", "notifications", type_="foreignkey")
    op.drop_constraint("fk_notifications_proposal_id_proposals", "notifications", type_="foreignkey")
    op.drop_constraint("fk_notifications_work_item_id_work_items", "notifications", type_="foreignkey")
    op.drop_constraint("fk_notifications_recipient_principal_id_principals", "notifications", type_="foreignkey")
    op.drop_constraint("fk_notifications_case_id_cases", "notifications", type_="foreignkey")
    op.drop_column("notifications", "dedupe_key")
    op.drop_column("notifications", "payload")
    op.drop_column("notifications", "release_id")
    op.drop_column("notifications", "proposal_id")
    op.drop_column("notifications", "work_item_id")
    op.drop_column("notifications", "notification_type")
    op.drop_column("notifications", "recipient_principal_id")
    op.drop_column("notifications", "case_id")
    op.alter_column("notifications", "user_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_index("ix_work_items_assignee_status", table_name="work_items")
    op.drop_index("ix_work_items_case_status_deadline", table_name="work_items")
    op.drop_table("work_items")
