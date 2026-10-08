"""
Консольная утилита для управления учётными записями админки.

Нужна прежде всего для создания самой первой учётной записи: через веб
залогиниться некому, пока в базе нет ни одного пользователя. Дальше
пользователей (viewer/editor/full) можно создавать и через раздел
«Пользователи» в самой админке — этот скрипт для случая, когда веб ещё
недоступен, или для восстановления доступа с сервера напрямую.

Запуск внутри контейнера api (или локально, если настроен DATABASE_URL):

    docker compose exec api python manage_users.py create-user admin --role full
    docker compose exec api python manage_users.py list-users
    docker compose exec api python manage_users.py set-password admin
    docker compose exec api python manage_users.py set-role admin viewer
    docker compose exec api python manage_users.py deactivate admin
    docker compose exec api python manage_users.py activate admin
    docker compose exec api python manage_users.py admin-url
    docker compose exec api python manage_users.py login-log --limit 50
    docker compose exec api python manage_users.py revoke-sessions admin

Пароль запрашивается интерактивно (getpass), не передаётся аргументом
командной строки — не остаётся в истории шелла/логах.
"""
import argparse
import getpass
import sys

from admin_auth import ROLE_LEVELS, hash_password, revoke_user_sessions
from database import SessionLocal, init_db
from models import LoginAttempt, User
from security import configured_admin_uid, validate_password_strength


def _read_password(prompt: str = "Пароль: ", username: str = None) -> str:
    while True:
        password = getpass.getpass(prompt)
        problem = validate_password_strength(password, username)
        if problem:
            print(problem, file=sys.stderr)
            continue
        confirm = getpass.getpass("Повторите пароль: ")
        if password != confirm:
            print("Пароли не совпадают, попробуйте снова.", file=sys.stderr)
            continue
        return password


def cmd_create_user(args):
    db = SessionLocal()
    try:
        existing = db.query(User).filter_by(username=args.username).one_or_none()
        if existing is not None:
            print(f"Пользователь «{args.username}» уже существует.", file=sys.stderr)
            sys.exit(1)

        password = _read_password(username=args.username)
        user = User(
            username=args.username,
            password_hash=hash_password(password),
            role=args.role,
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"Создан пользователь «{args.username}» с ролью «{args.role}».")
    finally:
        db.close()


def cmd_list_users(args):
    db = SessionLocal()
    try:
        users = db.query(User).order_by(User.username).all()
        if not users:
            print("Пользователей пока нет.")
            return
        for u in users:
            status = "активен" if u.is_active else "отключён"
            last_login = u.last_login_at.isoformat() if u.last_login_at else "никогда"
            print(f"{u.id:>4}  {u.username:<24} роль={u.role:<8} {status:<10} последний вход: {last_login}")
    finally:
        db.close()


def _get_user_or_exit(db, username: str) -> User:
    user = db.query(User).filter_by(username=username).one_or_none()
    if user is None:
        print(f"Пользователь «{username}» не найден.", file=sys.stderr)
        sys.exit(1)
    return user


def cmd_set_password(args):
    db = SessionLocal()
    try:
        user = _get_user_or_exit(db, args.username)
        password = _read_password(username=args.username)
        user.password_hash = hash_password(password)
        db.commit()
        closed = revoke_user_sessions(db, user.id)
        print(f"Закрыто активных сессий: {closed}.")
        print(f"Пароль пользователя «{args.username}» обновлён.")
    finally:
        db.close()


def cmd_set_role(args):
    db = SessionLocal()
    try:
        user = _get_user_or_exit(db, args.username)
        user.role = args.role
        db.commit()
        print(f"Роль пользователя «{args.username}» изменена на «{args.role}».")
    finally:
        db.close()


def cmd_set_active(args, active: bool):
    db = SessionLocal()
    try:
        user = _get_user_or_exit(db, args.username)
        user.is_active = active
        db.commit()
        if not active:
            revoke_user_sessions(db, user.id)
        print(f"Пользователь «{args.username}» {'активирован' if active else 'отключён'}.")
    finally:
        db.close()


def cmd_admin_url(args):
    uid = configured_admin_uid()
    if not uid:
        print(
            "ADMIN_URL_UID не задан или некорректен (нужно 24–64 символа A-Z a-z 0-9 _ -).\n"
            "Админ-API сейчас закрыто для всех. Сгенерируйте значение:\n"
            "    openssl rand -hex 24\n"
            "и впишите в .env как ADMIN_URL_UID=..., затем: docker compose up -d api",
            file=sys.stderr,
        )
        sys.exit(1)
    print(f"Путь входа в админку:  /console/{uid}/login")
    print("Полный адрес: https://<ваш-домен>/console/" + uid + "/login")


def cmd_login_log(args):
    db = SessionLocal()
    try:
        rows = (
            db.query(LoginAttempt)
            .order_by(LoginAttempt.created_at.desc(), LoginAttempt.id.desc())
            .limit(args.limit)
            .all()
        )
        if not rows:
            print("Попыток входа пока не было.")
            return
        for r in rows:
            mark = "OK  " if r.success else "FAIL"
            print(f"{r.created_at.isoformat()}  {mark}  {r.ip:<40} {r.username}")
    finally:
        db.close()


def cmd_revoke_sessions(args):
    db = SessionLocal()
    try:
        user = _get_user_or_exit(db, args.username)
        closed = revoke_user_sessions(db, user.id)
        print(f"Закрыто сессий пользователя «{args.username}»: {closed}.")
    finally:
        db.close()


def build_parser():
    parser = argparse.ArgumentParser(description="Управление учётными записями админки")
    sub = parser.add_subparsers(dest="command", required=True)

    p_create = sub.add_parser("create-user", help="создать пользователя")
    p_create.add_argument("username")
    p_create.add_argument("--role", choices=sorted(ROLE_LEVELS), default="viewer")
    p_create.set_defaults(func=cmd_create_user)

    p_list = sub.add_parser("list-users", help="список пользователей")
    p_list.set_defaults(func=cmd_list_users)

    p_pass = sub.add_parser("set-password", help="сменить пароль")
    p_pass.add_argument("username")
    p_pass.set_defaults(func=cmd_set_password)

    p_role = sub.add_parser("set-role", help="сменить роль")
    p_role.add_argument("username")
    p_role.add_argument("role", choices=sorted(ROLE_LEVELS))
    p_role.set_defaults(func=cmd_set_role)

    p_deact = sub.add_parser("deactivate", help="отключить учётную запись")
    p_deact.add_argument("username")
    p_deact.set_defaults(func=lambda args: cmd_set_active(args, False))

    p_act = sub.add_parser("activate", help="включить учётную запись")
    p_act.add_argument("username")
    p_act.set_defaults(func=lambda args: cmd_set_active(args, True))

    p_url = sub.add_parser("admin-url", help="показать секретный путь входа в админку")
    p_url.set_defaults(func=cmd_admin_url)

    p_log = sub.add_parser("login-log", help="журнал попыток входа")
    p_log.add_argument("--limit", type=int, default=50)
    p_log.set_defaults(func=cmd_login_log)

    p_rev = sub.add_parser("revoke-sessions", help="закрыть все сессии пользователя")
    p_rev.add_argument("username")
    p_rev.set_defaults(func=cmd_revoke_sessions)

    return parser


def main():
    init_db()
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
