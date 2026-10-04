#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ -z "${LOLIPOP_FTP_HOST:-}" || -z "${LOLIPOP_FTP_USER:-}" || -z "${LOLIPOP_FTP_PASSWORD:-}" || -z "${LOLIPOP_TREND_DIR:-}" ]]; then
  echo 'Overseas collection requires the existing Lolipop FTP secrets.' >&2
  exit 1
fi
collection_tmp=$(mktemp -d)
trap 'rm -rf "$collection_tmp"' EXIT
lftp -u "$LOLIPOP_FTP_USER","$LOLIPOP_FTP_PASSWORD" "$LOLIPOP_FTP_HOST" <<LFTP
set cmd:fail-exit yes
set ftp:ssl-force true
set ftp:ssl-protect-data true
set ssl:verify-certificate yes
cd "$LOLIPOP_TREND_DIR"
get config.php -o "$collection_tmp/config.php"
bye
LFTP
php scripts/collect-overseas.php "$collection_tmp/config.php" "$@"
