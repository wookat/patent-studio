"""figures proposals change sets and release snapshots

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("document_revisions", "source", type_=sa.String(length=32))
    op.drop_constraint(op.f("ck_document_revisions_source"), "document_revisions", type_="check")
    op.create_check_constraint(
        op.f("ck_document_revisions_source"),
        "document_revisions",
        "source IN ('manual', 'agent', 'migration', 'agent_suggested_accepted')",
    )

    op.create_table(
        "figure_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("anchor", sa.String(length=256), nullable=True),
        sa.Column("figure_no", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=300), server_default="", nullable=False),
        sa.Column("current_revision_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("figure_no IS NULL OR figure_no > 0", name=op.f("ck_figure_documents_figure_no")),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_figure_documents_case_id_cases"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            name=op.f("fk_figure_documents_document_id_documents"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_figure_documents")),
        sa.UniqueConstraint("case_id", "figure_no", name="uq_figure_documents_case_number"),
    )
    op.create_index("ix_figure_documents_case", "figure_documents", ["case_id"], unique=False)

    op.create_table(
        "figure_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("figure_document_id", sa.Uuid(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("parent_revision_id", sa.Uuid(), nullable=True),
        sa.Column("author_principal_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("content_key", sa.String(length=512), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("content_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("revision_no > 0", name=op.f("ck_figure_revisions_revision_no")),
        sa.CheckConstraint(
            "source IN ('manual', 'agent', 'migration', 'agent_suggested_accepted')",
            name=op.f("ck_figure_revisions_source"),
        ),
        sa.CheckConstraint("content_size >= 0", name=op.f("ck_figure_revisions_content_size")),
        sa.CheckConstraint("content_sha256 ~ '^[0-9a-f]{64}$'", name=op.f("ck_figure_revisions_content_sha256")),
        sa.ForeignKeyConstraint(
            ["figure_document_id"],
            ["figure_documents.id"],
            name=op.f("fk_figure_revisions_figure_document_id_figure_documents"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["figure_document_id", "parent_revision_id"],
            ["figure_revisions.figure_document_id", "figure_revisions.id"],
            name="fk_figure_revisions_parent",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["author_principal_id"],
            ["principals.id"],
            name=op.f("fk_figure_revisions_author_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_figure_revisions")),
        sa.UniqueConstraint("figure_document_id", "id", name="uq_figure_revisions_figure_id"),
        sa.UniqueConstraint("figure_document_id", "revision_no", name="uq_figure_revisions_number"),
    )
    op.create_index(
        "ix_figure_revisions_figure_order", "figure_revisions", ["figure_document_id", "revision_no"], unique=False
    )
    op.create_foreign_key(
        "fk_figure_documents_current_revision",
        "figure_documents",
        "figure_revisions",
        ["id", "current_revision_id"],
        ["figure_document_id", "id"],
        ondelete="RESTRICT",
    )

    op.create_table(
        "proposals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("proposer_principal_id", sa.Uuid(), nullable=True),
        sa.Column("proposer_agent_key", sa.String(length=128), nullable=True),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("document_revision_id", sa.Uuid(), nullable=True),
        sa.Column("figure_revision_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="draft", nullable=False),
        sa.Column("result_content_key", sa.String(length=512), nullable=True),
        sa.Column("result_content_sha256", sa.String(length=64), nullable=True),
        sa.Column("result_content_size", sa.Integer(), nullable=True),
        sa.Column("result_content_type", sa.String(length=128), nullable=True),
        sa.Column("accepted_by_principal_id", sa.Uuid(), nullable=True),
        sa.Column("accepted_document_revision_id", sa.Uuid(), nullable=True),
        sa.Column("accepted_figure_revision_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "((proposer_principal_id IS NOT NULL AND proposer_agent_key IS NULL) OR "
            "(proposer_principal_id IS NULL AND proposer_agent_key IS NOT NULL))",
            name=op.f("ck_proposals_proposer_source"),
        ),
        sa.CheckConstraint("target_kind IN ('document', 'figure')", name=op.f("ck_proposals_target_kind")),
        sa.CheckConstraint(
            "((target_kind = 'document' AND document_revision_id IS NOT NULL AND figure_revision_id IS NULL) OR "
            "(target_kind = 'figure' AND document_revision_id IS NULL AND figure_revision_id IS NOT NULL))",
            name=op.f("ck_proposals_target_revision"),
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'submitted', 'accepted', 'rejected', 'superseded')",
            name=op.f("ck_proposals_status"),
        ),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name=op.f("fk_proposals_case_id_cases"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["proposer_principal_id"],
            ["principals.id"],
            name=op.f("fk_proposals_proposer_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["document_revision_id"],
            ["document_revisions.id"],
            name=op.f("fk_proposals_document_revision_id_document_revisions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["figure_revision_id"],
            ["figure_revisions.id"],
            name=op.f("fk_proposals_figure_revision_id_figure_revisions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_by_principal_id"],
            ["principals.id"],
            name=op.f("fk_proposals_accepted_by_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_document_revision_id"],
            ["document_revisions.id"],
            name=op.f("fk_proposals_accepted_document_revision_id_document_revisions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_figure_revision_id"],
            ["figure_revisions.id"],
            name=op.f("fk_proposals_accepted_figure_revision_id_figure_revisions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_proposals")),
    )
    op.create_index("ix_proposals_case_status", "proposals", ["case_id", "status"], unique=False)

    op.create_table(
        "change_sets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("proposal_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["proposal_id"], ["proposals.id"], name=op.f("fk_change_sets_proposal_id_proposals"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_change_sets")),
        sa.UniqueConstraint("proposal_id", name=op.f("uq_change_sets_proposal_id")),
    )
    op.create_table(
        "proposal_changes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("change_set_id", sa.Uuid(), nullable=False),
        sa.Column("target_anchor", sa.String(length=256), nullable=False),
        sa.Column("payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("length(trim(target_anchor)) > 0", name=op.f("ck_proposal_changes_target_anchor")),
        sa.ForeignKeyConstraint(
            ["change_set_id"],
            ["change_sets.id"],
            name=op.f("fk_proposal_changes_change_set_id_change_sets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_proposal_changes")),
    )
    op.create_index("ix_proposal_changes_change_set", "proposal_changes", ["change_set_id"], unique=False)

    op.create_table(
        "releases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("case_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="created", nullable=False),
        sa.Column("created_by_principal_id", sa.Uuid(), nullable=False),
        sa.Column("sealed_by_principal_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("sealed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('created', 'sealed')", name=op.f("ck_releases_status")),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"], name=op.f("fk_releases_case_id_cases"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["created_by_principal_id"],
            ["principals.id"],
            name=op.f("fk_releases_created_by_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sealed_by_principal_id"],
            ["principals.id"],
            name=op.f("fk_releases_sealed_by_principal_id_principals"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_releases")),
    )
    op.create_index("ix_releases_case_status", "releases", ["case_id", "status"], unique=False)
    op.create_table(
        "release_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("release_id", sa.Uuid(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("item_kind", sa.String(length=16), nullable=False),
        sa.Column("document_revision_id", sa.Uuid(), nullable=True),
        sa.Column("figure_revision_id", sa.Uuid(), nullable=True),
        sa.Column("content_key", sa.String(length=512), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("content_size", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.CheckConstraint("item_kind IN ('document', 'figure')", name=op.f("ck_release_items_item_kind")),
        sa.CheckConstraint(
            "((item_kind = 'document' AND document_revision_id IS NOT NULL AND figure_revision_id IS NULL) OR "
            "(item_kind = 'figure' AND document_revision_id IS NULL AND figure_revision_id IS NOT NULL))",
            name=op.f("ck_release_items_item_revision"),
        ),
        sa.ForeignKeyConstraint(
            ["release_id"], ["releases.id"], name=op.f("fk_release_items_release_id_releases"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["document_revision_id"],
            ["document_revisions.id"],
            name=op.f("fk_release_items_document_revision_id_document_revisions"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["figure_revision_id"],
            ["figure_revisions.id"],
            name=op.f("fk_release_items_figure_revision_id_figure_revisions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_release_items")),
        sa.UniqueConstraint("release_id", "ordinal", name="uq_release_items_order"),
    )
    op.create_index("ix_release_items_release", "release_items", ["release_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_release_items_release", table_name="release_items")
    op.drop_table("release_items")
    op.drop_index("ix_releases_case_status", table_name="releases")
    op.drop_table("releases")
    op.drop_index("ix_proposal_changes_change_set", table_name="proposal_changes")
    op.drop_table("proposal_changes")
    op.drop_table("change_sets")
    op.drop_index("ix_proposals_case_status", table_name="proposals")
    op.drop_table("proposals")
    op.drop_constraint("fk_figure_documents_current_revision", "figure_documents", type_="foreignkey")
    op.drop_index("ix_figure_revisions_figure_order", table_name="figure_revisions")
    op.drop_table("figure_revisions")
    op.drop_index("ix_figure_documents_case", table_name="figure_documents")
    op.drop_table("figure_documents")
    op.drop_constraint(op.f("ck_document_revisions_source"), "document_revisions", type_="check")
    op.create_check_constraint(
        op.f("ck_document_revisions_source"), "document_revisions", "source IN ('manual', 'agent', 'migration')"
    )
    op.alter_column("document_revisions", "source", type_=sa.String(length=16))
