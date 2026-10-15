"""release artifacts: built delivery outputs pinned to a sealed release

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "release_artifacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("release_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=200), nullable=False),
        sa.Column("content_key", sa.String(length=512), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("content_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("inputs", sa.JSON(), nullable=False),
        sa.Column("built_by_principal_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("content_size >= 0", name=op.f("ck_release_artifacts_content_size")),
        sa.CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_release_artifacts_content_sha256")),
        sa.ForeignKeyConstraint(["release_id"], ["releases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["built_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_release_artifacts")),
        sa.UniqueConstraint("release_id", "filename", name="uq_release_artifacts_name"),
    )
    op.create_index(
        "ix_release_artifacts_release",
        "release_artifacts",
        ["release_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_release_artifacts_release", table_name="release_artifacts")
    op.drop_table("release_artifacts")
