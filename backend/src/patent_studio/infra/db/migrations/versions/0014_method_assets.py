"""organization-private method library: method_assets + use records

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "method_assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=16), server_default="manual", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="draft", nullable=False),
        sa.Column("authorized_by_principal_id", sa.Uuid(), nullable=True),
        sa.Column("authorized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_principal_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'authorized', 'revoked')", name=op.f("ck_method_assets_status")),
        sa.CheckConstraint("source IN ('manual', 'curated')", name=op.f("ck_method_assets_source")),
        sa.CheckConstraint("length(trim(title)) > 0", name=op.f("ck_method_assets_title")),
        sa.CheckConstraint("length(trim(body)) > 0", name=op.f("ck_method_assets_body")),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["authorized_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_method_assets")),
    )
    op.create_index("ix_method_assets_org_status", "method_assets", ["organization_id", "status"], unique=False)

    op.create_table(
        "method_asset_uses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=True),
        sa.Column("principal_id", sa.Uuid(), nullable=False),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["asset_id"], ["method_assets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["principal_id"], ["principals.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_method_asset_uses")),
    )
    op.create_index("ix_method_asset_uses_asset", "method_asset_uses", ["asset_id", "used_at"], unique=False)


def downgrade() -> None:
    op.drop_table("method_asset_uses")
    op.drop_table("method_assets")
