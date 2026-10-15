"""materials, source anchors and facts: sourced evidence for ingest and drafting

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "materials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("source_url", sa.String(length=2000), nullable=True),
        sa.Column("content_key", sa.String(length=512), nullable=True),
        sa.Column("content_sha256", sa.String(length=64), nullable=True),
        sa.Column("content_size", sa.Integer(), nullable=True),
        sa.Column("content_type", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
        sa.Column("created_by_principal_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('upload', 'url', 'text')", name=op.f("ck_materials_kind")),
        sa.CheckConstraint("status IN ('active', 'archived')", name=op.f("ck_materials_status")),
        sa.CheckConstraint(
            "(kind = 'url' AND source_url IS NOT NULL AND content_key IS NULL) OR "
            "(kind IN ('upload', 'text') AND content_key IS NOT NULL AND source_url IS NULL)",
            name=op.f("ck_materials_kind_payload"),
        ),
        sa.CheckConstraint("content_key IS NULL OR content_size >= 0", name=op.f("ck_materials_content_size")),
        sa.CheckConstraint(
            "content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_materials_content_sha256"),
        ),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_materials")),
    )
    op.create_index("ix_materials_case_status", "materials", ["case_id", "status"], unique=False)

    op.create_table(
        "source_anchors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("locator", postgresql.JSONB(), nullable=False),
        sa.Column("excerpt_key", sa.String(length=512), nullable=True),
        sa.Column("excerpt_sha256", sa.String(length=64), nullable=True),
        sa.Column("excerpt_size", sa.Integer(), nullable=True),
        sa.Column("excerpt_type", sa.String(length=128), nullable=True),
        sa.Column("created_by_principal_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("excerpt_key IS NULL OR excerpt_size >= 0", name=op.f("ck_source_anchors_excerpt_size")),
        sa.CheckConstraint(
            "excerpt_sha256 IS NULL OR excerpt_sha256 ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_source_anchors_excerpt_sha256"),
        ),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_source_anchors")),
    )
    op.create_index("ix_source_anchors_material", "source_anchors", ["material_id"], unique=False)

    op.create_table(
        "facts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=True),
        sa.Column("anchor_id", sa.Uuid(), nullable=True),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("rejection_reason", sa.String(length=1000), nullable=True),
        sa.Column("proposed_by_principal_id", sa.Uuid(), nullable=False),
        sa.Column("decided_by_principal_id", sa.Uuid(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'confirmed', 'rejected')", name=op.f("ck_facts_status")),
        sa.CheckConstraint(
            "status <> 'confirmed' OR anchor_id IS NOT NULL", name=op.f("ck_facts_confirmed_has_anchor")
        ),
        sa.CheckConstraint("anchor_id IS NULL OR material_id IS NOT NULL", name=op.f("ck_facts_anchor_has_material")),
        sa.CheckConstraint(
            "(status = 'pending' AND decided_by_principal_id IS NULL AND decided_at IS NULL) OR "
            "(status <> 'pending' AND decided_by_principal_id IS NOT NULL AND decided_at IS NOT NULL)",
            name=op.f("ck_facts_decision"),
        ),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["anchor_id"], ["source_anchors.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["proposed_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["decided_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_facts")),
    )
    op.create_index("ix_facts_case_status", "facts", ["case_id", "status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_facts_case_status", table_name="facts")
    op.drop_table("facts")
    op.drop_index("ix_source_anchors_material", table_name="source_anchors")
    op.drop_table("source_anchors")
    op.drop_index("ix_materials_case_status", table_name="materials")
    op.drop_table("materials")
