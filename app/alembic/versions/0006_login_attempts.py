"""login_attempts: журнал попыток входа в админку (блокировка перебора
пароля по IP/логину и разбор инцидентов).

Новая таблица, существующих данных не касается. Идемпотентна: если таблицу
уже создал create_all() при старте api, ничего лишнего не делает.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "login_attempts" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "login_attempts",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("username", sa.String(64), nullable=False),
            sa.Column("ip", sa.String(64), nullable=False),
            sa.Column("success", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )
    existing = {i["name"] for i in sa.inspect(bind).get_indexes("login_attempts")}
    for name, column in (
        ("ix_login_attempts_username", "username"),
        ("ix_login_attempts_ip", "ip"),
        ("ix_login_attempts_created_at", "created_at"),
    ):
        if name not in existing:
            op.create_index(name, "login_attempts", [column])


def downgrade() -> None:
    op.drop_index("ix_login_attempts_created_at", table_name="login_attempts")
    op.drop_index("ix_login_attempts_ip", table_name="login_attempts")
    op.drop_index("ix_login_attempts_username", table_name="login_attempts")
    op.drop_table("login_attempts")
