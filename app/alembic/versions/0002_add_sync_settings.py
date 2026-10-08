"""add sync_settings — таблица настроек синхронизации (раздел админки
"Синхронизация"): периодичность, вкл/выкл автосинхронизации, вкл/выкл
скачивания фото.

Новая таблица, конфликтов с уже существующими данными нет — безопасно
выполнять `alembic upgrade head` на живой базе, уже помеченной как 0001
(через `alembic stamp 0001`).

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("auto_sync_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("download_images_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sync_settings")
