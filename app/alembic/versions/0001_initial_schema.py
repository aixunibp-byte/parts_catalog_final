"""initial schema — фиксирует текущую структуру БД как отправную точку
для Alembic. Соответствует models.py на момент внедрения миграций.

ВАЖНО для уже существующей (живой) базы: не запускайте upgrade напрямую —
таблицы уже созданы через create_all() и upgrade() попытается создать их
заново и упадёт с ошибкой "relation already exists". Вместо этого один раз
выполните `alembic stamp 0001`, чтобы просто пометить базу как находящуюся
на этой ревизии, без выполнения upgrade(). См. README.md.

Revision ID: 0001
Revises:
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "parts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ozon_product_id", sa.BigInteger(), nullable=False),
        sa.Column("ozon_sku", sa.BigInteger(), nullable=True),
        sa.Column("offer_id", sa.String(255), nullable=False),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("brand", sa.String(255), nullable=True),
        sa.Column("barcode", sa.String(64), nullable=True),
        sa.Column("category_id", sa.BigInteger(), nullable=True),
        sa.Column("category_name", sa.String(255), nullable=True),
        sa.Column("price", sa.Numeric(12, 2), nullable=True),
        sa.Column("old_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("currency_code", sa.String(8), nullable=True),
        sa.Column("weight", sa.Integer(), nullable=True),
        sa.Column("weight_unit", sa.String(8), nullable=True),
        sa.Column("depth", sa.Integer(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("dimension_unit", sa.String(8), nullable=True),
        sa.Column("moderate_status", sa.String(32), nullable=True),
        sa.Column("is_archived", sa.Boolean(), nullable=True),
        sa.Column("has_stock", sa.Boolean(), nullable=True),
        sa.Column("primary_image", sa.String(1000), nullable=True),
        sa.Column("primary_image_source_url", sa.String(1000), nullable=True),
        sa.Column("manual_override", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("ozon_product_id"),
        sa.UniqueConstraint("offer_id"),
    )
    op.create_index("ix_parts_ozon_product_id", "parts", ["ozon_product_id"])
    op.create_index("ix_parts_ozon_sku", "parts", ["ozon_sku"])
    op.create_index("ix_parts_offer_id", "parts", ["offer_id"])
    op.create_index("ix_parts_brand", "parts", ["brand"])

    op.create_table(
        "part_images",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("part_id", sa.Integer(), sa.ForeignKey("parts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False),
        sa.Column("source_url", sa.String(1000), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=True),
    )

    op.create_table(
        "part_attributes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("part_id", sa.Integer(), sa.ForeignKey("parts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ozon_attribute_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(500), nullable=True),
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("dictionary_value_id", sa.BigInteger(), nullable=True),
    )

    op.create_table(
        "part_stocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("part_id", sa.Integer(), sa.ForeignKey("parts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("warehouse_name", sa.String(255), nullable=True),
        sa.Column("present", sa.Integer(), nullable=True),
        sa.Column("reserved", sa.Integer(), nullable=True),
        sa.Column("stock_type", sa.String(32), nullable=True),
    )

    op.create_table(
        "sync_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(32), nullable=True),
        sa.Column("products_processed", sa.Integer(), nullable=True),
        sa.Column("products_failed", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
    )

    op.create_table(
        "admin_audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("part_id", sa.Integer(), sa.ForeignKey("parts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "site_content",
        sa.Column("key", sa.String(32), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("site_content")
    op.drop_table("admin_audit_log")
    op.drop_table("sync_log")
    op.drop_table("part_stocks")
    op.drop_table("part_attributes")
    op.drop_table("part_images")
    op.drop_index("ix_parts_brand", table_name="parts")
    op.drop_index("ix_parts_offer_id", table_name="parts")
    op.drop_index("ix_parts_ozon_sku", table_name="parts")
    op.drop_index("ix_parts_ozon_product_id", table_name="parts")
    op.drop_table("parts")
