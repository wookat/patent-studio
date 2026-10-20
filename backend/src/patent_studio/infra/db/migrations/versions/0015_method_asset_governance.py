"""method asset governance: type / provenance / authorized_scope / de-identification confirmation

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-19

复核项6：source='manual' 不是可追溯来源——补最小元数据列：
- asset_type        方法卡类型（method=撰写方法 / expression=表达）；既有行回填 'method'
- provenance        真实来源说明（人工填写；既有行留 NULL，不填假来源）
- authorized_scope  授权使用范围（人工填写；既有行留 NULL）
- deidentified_confirmed  人工脱敏声明；既有行一律 False（未确认），未确认禁止授权

复核追加：仅置未确认不够——0014 既有 status='authorized' 旧卡未补治理元数据
仍会被默认检索/使用。迁移时把 authorized 降为 draft 并清空旧授权人/时间；
revoked 保持撤销（不复活）。旧卡须补登确认 + 重新授权后才恢复检索/使用。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "method_assets",
        sa.Column("asset_type", sa.String(length=16), server_default="method", nullable=False),
    )
    op.add_column("method_assets", sa.Column("provenance", sa.String(length=500), nullable=True))
    op.add_column("method_assets", sa.Column("authorized_scope", sa.String(length=500), nullable=True))
    op.add_column(
        "method_assets",
        sa.Column("deidentified_confirmed", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_method_assets_asset_type"),
        "method_assets",
        "asset_type IN ('method', 'expression')",
    )
    # 0014 的 authorized 旧卡治理元数据未补齐——降为 draft 并清空旧授权痕迹，
    # 防止未补登的来源不明卡继续可检索/可使用；revoked 行不动（不复活）。
    op.execute(
        "UPDATE method_assets SET status = 'draft', authorized_by_principal_id = NULL, "
        "authorized_at = NULL WHERE status = 'authorized'"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_method_assets_asset_type"), "method_assets", type_="check")
    op.drop_column("method_assets", "deidentified_confirmed")
    op.drop_column("method_assets", "authorized_scope")
    op.drop_column("method_assets", "provenance")
    op.drop_column("method_assets", "asset_type")
