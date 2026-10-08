"""постоянные адреса фото: part_images.uid + part_images.file_name

Каждое фото получает неизменный uid и публичный адрес /api/images/<uid>.
Адрес не меняется при замене самого файла (из админки или при смене фото
на Ozon) — меняется только file_name. Существующие строки переводятся
на новую схему: старый url (/uploads/<файл>) уходит в file_name, а url и
parts.primary_image заменяются на новый постоянный адрес. Старые прямые
ссылки /uploads/<файл> продолжают открываться (файлы остаются на месте).

Миграция идемпотентна: на свежей базе, где колонки уже создал create_all(),
ничего лишнего не делает.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-06
"""
import uuid

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

UPLOADS_PREFIX = "/uploads/"
STABLE_PREFIX = "/api/images/"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    columns = {c["name"] for c in inspector.get_columns("part_images")}
    if "uid" not in columns:
        op.add_column("part_images", sa.Column("uid", sa.String(32), nullable=True))
    if "file_name" not in columns:
        op.add_column("part_images", sa.Column("file_name", sa.String(255), nullable=True))

    # --- Перевод существующих строк на постоянные адреса ---
    rows = bind.execute(
        sa.text("SELECT id, url FROM part_images WHERE uid IS NULL")
    ).fetchall()
    for image_id, old_url in rows:
        uid = uuid.uuid4().hex
        new_url = f"{STABLE_PREFIX}{uid}"
        if old_url and old_url.startswith(UPLOADS_PREFIX):
            file_name = old_url[len(UPLOADS_PREFIX):]
            bind.execute(
                sa.text(
                    "UPDATE part_images SET uid = :uid, url = :url, file_name = :fn "
                    "WHERE id = :id"
                ),
                {"uid": uid, "url": new_url, "fn": file_name, "id": image_id},
            )
        else:
            # Внешняя ссылка, добавленная админом "по ссылке": файла у нас нет,
            # постоянный адрес будет перенаправлять на неё.
            bind.execute(
                sa.text(
                    "UPDATE part_images SET uid = :uid, url = :url, "
                    "source_url = COALESCE(source_url, :old) WHERE id = :id"
                ),
                {"uid": uid, "url": new_url, "old": old_url, "id": image_id},
            )
        # Главное фото карточки хранит тот же адрес, что и строка галереи.
        bind.execute(
            sa.text(
                "UPDATE parts SET primary_image = :new "
                "WHERE primary_image = :old AND id = "
                "(SELECT part_id FROM part_images WHERE id = :id)"
            ),
            {"new": new_url, "old": old_url, "id": image_id},
        )

    # Карточки, у которых главное фото лежит только в parts.primary_image
    # (в галерее строки для него нет) — заводим для него строку галереи.
    orphans = bind.execute(
        sa.text(
            "SELECT id, primary_image, primary_image_source_url FROM parts "
            "WHERE primary_image LIKE :prefix"
        ),
        {"prefix": UPLOADS_PREFIX + "%"},
    ).fetchall()
    for part_id, primary_image, primary_source in orphans:
        uid = uuid.uuid4().hex
        new_url = f"{STABLE_PREFIX}{uid}"
        bind.execute(
            sa.text(
                "INSERT INTO part_images "
                "(part_id, uid, url, file_name, source_url, sort_order, is_primary) "
                "VALUES (:part_id, :uid, :url, :fn, :src, 0, TRUE)"
            ),
            {
                "part_id": part_id, "uid": uid, "url": new_url,
                "fn": primary_image[len(UPLOADS_PREFIX):], "src": primary_source,
            },
        )
        bind.execute(
            sa.text("UPDATE parts SET primary_image = :new WHERE id = :id"),
            {"new": new_url, "id": part_id},
        )

    op.alter_column("part_images", "uid", existing_type=sa.String(32), nullable=False)
    index_names = {i["name"] for i in sa.inspect(bind).get_indexes("part_images")}
    if "ix_part_images_uid" not in index_names:
        op.create_index("ix_part_images_uid", "part_images", ["uid"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, url, file_name, source_url FROM part_images")
    ).fetchall()
    for image_id, stable_url, file_name, source_url in rows:
        old_url = f"{UPLOADS_PREFIX}{file_name}" if file_name else (source_url or stable_url)
        bind.execute(
            sa.text("UPDATE part_images SET url = :old WHERE id = :id"),
            {"old": old_url, "id": image_id},
        )
        bind.execute(
            sa.text(
                "UPDATE parts SET primary_image = :old "
                "WHERE primary_image = :stable AND id = "
                "(SELECT part_id FROM part_images WHERE id = :id)"
            ),
            {"old": old_url, "stable": stable_url, "id": image_id},
        )
    op.drop_index("ix_part_images_uid", table_name="part_images")
    op.drop_column("part_images", "file_name")
    op.drop_column("part_images", "uid")
