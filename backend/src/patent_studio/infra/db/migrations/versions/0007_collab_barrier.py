"""collaboration update log and submission barriers

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "collab_rooms",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("working_copy_id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("last_seq", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_clock", sa.Integer(), server_default="0", nullable=False),
        sa.Column("checkpoint_seq", sa.Integer(), server_default="0", nullable=False),
        sa.Column("checkpoint_key", sa.String(length=512), nullable=True),
        sa.Column("checkpoint_sha256", sa.String(length=64), nullable=True),
        sa.Column("checkpoint_size", sa.Integer(), nullable=True),
        sa.Column("checkpoint_type", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("last_seq >= 0", name=op.f("ck_collab_rooms_last_seq")),
        sa.CheckConstraint("last_clock >= 0", name=op.f("ck_collab_rooms_last_clock")),
        sa.CheckConstraint("checkpoint_seq >= 0", name=op.f("ck_collab_rooms_checkpoint_seq")),
        sa.ForeignKeyConstraint(
            ["working_copy_id"],
            ["working_copies.id"],
            name=op.f("fk_collab_rooms_working_copy_id_working_copies"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_collab_rooms_case_id_cases"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collab_rooms")),
        sa.UniqueConstraint("working_copy_id", name="uq_collab_rooms_working_copy"),
    )
    op.create_index("ix_collab_rooms_case", "collab_rooms", ["case_id"], unique=False)
    op.create_table(
        "collab_updates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("room_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("clock", sa.Integer(), nullable=False),
        sa.Column("author_principal_id", sa.Uuid(), nullable=False),
        sa.Column("payload_key", sa.String(length=512), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("payload_size", sa.Integer(), nullable=False),
        sa.Column("payload_type", sa.String(length=128), nullable=False),
        sa.Column("flushed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("seq > 0", name=op.f("ck_collab_updates_seq")),
        sa.CheckConstraint("clock >= 0", name=op.f("ck_collab_updates_clock")),
        sa.CheckConstraint("payload_size >= 0", name=op.f("ck_collab_updates_payload_size")),
        sa.CheckConstraint("payload_sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_collab_updates_payload_sha256")),
        sa.ForeignKeyConstraint(
            ["room_id"], ["collab_rooms.id"], name=op.f("fk_collab_updates_room_id_collab_rooms"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["author_principal_id"],
            ["principals.id"],
            name=op.f("fk_collab_updates_author_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_collab_updates")),
        sa.UniqueConstraint("room_id", "seq", name="uq_collab_updates_room_seq"),
    )
    op.create_index("ix_collab_updates_room_seq", "collab_updates", ["room_id", "seq"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_collab_updates_room_seq", table_name="collab_updates")
    op.drop_table("collab_updates")
    op.drop_index("ix_collab_rooms_case", table_name="collab_rooms")
    op.drop_table("collab_rooms")
