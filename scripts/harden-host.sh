#!/usr/bin/env bash
# Базовая защита самого сервера (хоста). Запускать от root на Ubuntu/Debian.
#   ./scripts/harden-host.sh            — только показать, что будет сделано
#   ./scripts/harden-host.sh --apply    — применить
#
# Что делает:
#   1. Файрвол ufw: всё входящее закрыто, кроме SSH, 80, 443, 21 (FTPS) и
#      пассивного диапазона FTP.
#   2. fail2ban: бан IP, подбирающих пароль к SSH.
#   3. Автоустановка обновлений безопасности (unattended-upgrades).
#   4. Права на .env (600) и подсказки по SSH.
# ВАЖНО: SSH-порт ниже должен совпадать с реальным, иначе потеряете доступ.
set -euo pipefail

SSH_PORT="${SSH_PORT:-22}"
FTP_PORT="${FTP_PORT:-21}"
PASV_RANGE="${FTP_PASV_PORTS:-30000-30009}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

run() {
  echo "+ $*"
  if [[ $APPLY -eq 1 ]]; then "$@"; fi
}

if [[ $APPLY -eq 1 && $EUID -ne 0 ]]; then
  echo "Запустите от root (sudo)." >&2; exit 1
fi

echo "SSH порт: $SSH_PORT | FTP: $FTP_PORT | PASV: $PASV_RANGE"
[[ $APPLY -eq 0 ]] && echo "(режим просмотра — ничего не меняется; добавьте --apply)"

run apt-get update -y
run apt-get install -y ufw fail2ban unattended-upgrades

run ufw default deny incoming
run ufw default allow outgoing
run ufw allow "${SSH_PORT}/tcp"
run ufw allow 80/tcp
run ufw allow 443/tcp
run ufw allow "${FTP_PORT}/tcp"
run ufw allow "${PASV_RANGE/-/:}/tcp"
run ufw --force enable

if [[ $APPLY -eq 1 ]]; then
  cat > /etc/fail2ban/jail.d/omegation.local <<JAIL
[sshd]
enabled  = true
port     = ${SSH_PORT}
maxretry = 4
findtime = 10m
bantime  = 1h
JAIL
  systemctl enable --now fail2ban
  systemctl restart fail2ban
  dpkg-reconfigure -f noninteractive unattended-upgrades || true
else
  echo "+ (fail2ban: jail sshd, 4 попытки/10 мин -> бан на 1 час)"
  echo "+ (unattended-upgrades: включить)"
fi

if [[ -f .env ]]; then run chmod 600 .env; fi

cat <<'TXT'

Дальше вручную (в скрипт не включено, чтобы не отрезать вам доступ):
  * вход по SSH только по ключу: в /etc/ssh/sshd_config  PasswordAuthentication no,
    PermitRootLogin prohibit-password; затем  systemctl reload ssh
  * Docker обходит ufw для опубликованных портов: публикуются только 80, 443, 21
    и пассивный диапазон FTP — это сделано намеренно; порты БД и api наружу не
    публикуются, не добавляйте их в docker-compose.yml.
TXT
