"""add FTP price-import support: parts.ftp_price / ftp_price_updated_at,
sync_log.source, sync_settings.ftp_* — раздел админки "Синхронизация",
блок "Цены с FTP".

Новые колонки/таблица не конфликтуют с существующими данными — безопасно
выполнять `alembic upgrade head` на живой базе.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("parts", sa.Column("ftp_price", sa.Numeric(12, 2), nullable=True))
    op.add_column("parts", sa.Column("ftp_price_updated_at", sa.DateTime(timezone=True), nullable=True))

    op.add_column(
        "sync_log",
        sa.Column("source", sa.String(16), nullable=False, server_default="ozon"),
    )

    op.add_column(
        "sync_settings",
        sa.Column("ftp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "sync_settings",
        sa.Column("ftp_interval_minutes", sa.Integer(), nullable=False, server_default="1440"),
    )
    op.add_column("sync_settings", sa.Column("ftp_host", sa.String(255), nullable=True))
    op.add_column(
        "sync_settings",
        sa.Column("ftp_port", sa.Integer(), nullable=False, server_default="21"),
    )
    op.add_column("sync_settings", sa.Column("ftp_user", sa.String(255), nullable=True))
    op.add_column("sync_settings", sa.Column("ftp_password", sa.String(500), nullable=True))
    op.add_column("sync_settings", sa.Column("ftp_remote_path", sa.String(1000), nullable=True))
    op.add_column(
        "sync_settings",
        sa.Column("ftp_use_tls", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("sync_settings", "ftp_use_tls")
    op.drop_column("sync_settings", "ftp_remote_path")
    op.drop_column("sync_settings", "ftp_password")
    op.drop_column("sync_settings", "ftp_user")
    op.drop_column("sync_settings", "ftp_port")
    op.drop_column("sync_settings", "ftp_host")
    op.drop_column("sync_settings", "ftp_interval_minutes")
    op.drop_column("sync_settings", "ftp_enabled")
    op.drop_column("sync_log", "source")
    op.drop_column("parts", "ftp_price_updated_at")
    op.drop_column("parts", "ftp_price")
