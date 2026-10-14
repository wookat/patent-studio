"""document revisions and working copies

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("book", sa.String(length=16), nullable=False),
        sa.Column("current_revision_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("book IN ('abstract', 'claims', 'description')", name=op.f("ck_documents_book")),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_documents_case_id_cases"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_documents")),
        sa.UniqueConstraint("case_id", "book", name="uq_documents_case_book"),
    )
    op.create_index("ix_documents_case", "documents", ["case_id"], unique=False)

    op.create_table(
        "document_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("parent_revision_id", sa.Uuid(), nullable=True),
        sa.Column("author_principal_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("content_key", sa.String(length=512), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("content_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("revision_no > 0", name=op.f("ck_document_revisions_revision_no")),
        sa.CheckConstraint(
            "source IN ('manual', 'agent', 'migration')", name=op.f("ck_document_revisions_source")
        ),
        sa.CheckConstraint("content_size >= 0", name=op.f("ck_document_revisions_content_size")),
        sa.CheckConstraint(
            "content_sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_document_revisions_content_sha256")
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_document_revisions_document_id_documents"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "parent_revision_id"],
            ["document_revisions.document_id", "document_revisions.id"],
            name="fk_document_revisions_parent",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["author_principal_id"],
            ["principals.id"],
            name=op.f("fk_document_revisions_author_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_document_revisions")),
        sa.UniqueConstraint("document_id", "id", name="uq_document_revisions_document_id"),
        sa.UniqueConstraint("document_id", "revision_no", name="uq_document_revisions_number"),
    )
    op.create_index(
        "ix_document_revisions_document_order", "document_revisions", ["document_id", "revision_no"], unique=False
    )
    op.create_foreign_key(
        "fk_documents_current_revision",
        "documents",
        "document_revisions",
        ["id", "current_revision_id"],
        ["document_id", "id"],
        ondelete="RESTRICT",
    )

    op.create_table(
        "working_copies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("principal_id", sa.Uuid(), nullable=False),
        sa.Column("base_revision_id", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("content_key", sa.String(length=512), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("content_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("version > 0", name=op.f("ck_working_copies_version")),
        sa.CheckConstraint("content_size >= 0", name=op.f("ck_working_copies_content_size")),
        sa.CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_working_copies_content_sha256")),
        sa.ForeignKeyConstraint(
            ["document_id"], ["documents.id"], name=op.f("fk_working_copies_document_id_documents"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["document_id", "base_revision_id"],
            ["document_revisions.document_id", "document_revisions.id"],
            name="fk_working_copies_base_revision",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["principal_id"],
            ["principals.id"],
            name=op.f("fk_working_copies_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_working_copies")),
    )
    op.create_index("ix_working_copies_document", "working_copies", ["document_id"], unique=False)
    op.create_index("ix_working_copies_principal", "working_copies", ["principal_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_working_copies_principal", table_name="working_copies")
    op.drop_index("ix_working_copies_document", table_name="working_copies")
    op.drop_table("working_copies")
    op.drop_constraint("fk_documents_current_revision", "documents", type_="foreignkey")
    op.drop_index("ix_document_revisions_document_order", table_name="document_revisions")
    op.drop_table("document_revisions")
    op.drop_index("ix_documents_case", table_name="documents")
    op.drop_table("documents")
