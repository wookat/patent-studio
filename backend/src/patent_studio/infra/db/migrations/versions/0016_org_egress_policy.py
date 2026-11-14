"""org egress policy: per-organization AI outbound authorization record (C0/P03)

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-20

部署全局 org.json 只是更严的闸门；真实机构作用域的外发授权记在 PG organizations.egress_policy（JSONB）：
{ai_egress: bool, training_consent: bool, note: str, version: int, updated_by: uuid, updated_at: iso}
NULL = 未配置（按未禁处理，与部署默认 ai_enabled=True 口径一致）；training_consent 独立默认关。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("egress_policy", sa.dialects.postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "egress_policy")
