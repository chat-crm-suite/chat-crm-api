#!/usr/bin/env bash
# Fills the random secrets of an API env file (.env.prod, or .env in development).
#
# Usage:
#   ./deploy/gen-secrets.sh [--env FILE] [--prune]
#
#   --env FILE   env file to fill (default: <api repo>/.env.prod; created from
#                .env.prod.example when missing)
#   --prune      also delete variables nothing reads any more (see DEAD_KEYS)
#
# Secrets generated (hex, from openssl):
#   MYSQL_ROOT_PASSWORD, DB_PASSWORD, REDIS_PASSWORD, JWT_SECRET,
#   CREDENTIALS_ENCRYPTION_KEY (64 hex chars = AES-256 key)
# Mirrors kept in sync (the mysql image reads MYSQL_*, the API reads DB_*):
#   MYSQL_DATABASE <- DB_DATABASE, MYSQL_USER <- DB_USERNAME, MYSQL_PASSWORD <- DB_PASSWORD
#
# Behaviour:
#   - Only fills values that are missing, empty, a <placeholder>/CHANGE_ME or a
#     known weak default (root_password, 123456, ...). A strong existing value
#     is NEVER overwritten, so the script is safe to run again.
#   - To rotate one secret on purpose: empty its value in the file and re-run.
#       DB / MYSQL passwords         mysql reads them only when the data volume is
#                                    created; on a live volume the API loses access.
#       CREDENTIALS_ENCRYPTION_KEY   stored WhatsApp tokens become unreadable.
#       JWT_SECRET                   every session is closed.
#   - The mysql image refuses MYSQL_USER=root, so a root DB user drops the
#     MYSQL_USER/MYSQL_PASSWORD mirrors (the API then uses the root password).
#   - No value is ever printed. The file ends up chmod 600 and a timestamped copy
#     is kept outside the repo (BACKUP_DIR, default ~/.chat-crm-env-backups).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$API_DIR/.env.prod"
PRUNE=0
BACKUP_DIR="${BACKUP_DIR:-$HOME/.chat-crm-env-backups}"

# Never read by the code, set by the compose files, or only used by the
# headless bootstrap (the setup wizard POST /setup replaces it).
DEAD_KEYS=(
  DB_ROOT_PASSWORD WHATSAPP_VERIFY_TOKEN NODE_ENV PORT
  BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_PASSWORD BOOTSTRAP_COMPANY_NAME
  WHATSAPP_PHONE_NUMBER_ID WHATSAPP_ACCESS_TOKEN WHATSAPP_BUSINESS_ID
  WHATSAPP_WEBHOOK_URL WHATSAPP_API_VERSION
)

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_FILE="${2:?--env needs a file}"; shift 2 ;;
    --prune) PRUNE=1; shift ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

rand_hex() { # $1 = bytes
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$API_DIR/.env.prod.example" ] || { echo "missing $ENV_FILE and .env.prod.example" >&2; exit 1; }
  cp "$API_DIR/.env.prod.example" "$ENV_FILE"
  echo "created $ENV_FILE from .env.prod.example"
else
  umask 077
  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
  ENV_DIR="$(cd "$(dirname "$ENV_FILE")" && pwd)"
  BACKUP="$BACKUP_DIR/$(basename "$ENV_DIR")-$(basename "$ENV_FILE").bak-$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$BACKUP" && chmod 600 "$BACKUP"
  echo "backup: $BACKUP"
fi

get_kv() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

set_kv() { # $1 = key, $2 = value (passed through the environment, no quoting issues)
  if grep -qE "^$1=" "$ENV_FILE"; then
    KEY="$1" VAL="$2" awk '
      BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VAL"] }
      index($0, k "=") == 1 { print k "=" v; next }
      { print }' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  fi
}

del_kv() { grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE" || true; }

is_weak() { # $1 = value, $2 = minimum length
  local v="$1" min="${2:-16}" lower
  [ -z "$v" ] && return 0
  case "$v" in *"<"*|*">"*) return 0 ;; esac
  lower="$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    root_password|root|password|passw0rd|secret|admin|123456|12345678|test|nestjs_password)
      return 0 ;;
    # template filler, e.g. CHANGE_ME_segura_32_chars
    *change_me*|*changeme*|*cambia*|*example*|*placeholder*|*your_*|*todo*|*xxxx*)
      return 0 ;;
  esac
  [ "${#v}" -lt "$min" ]
}

CHANGED=()
KEPT=()
PRUNED=()

ensure() { # $1 = key, $2 = random bytes (hex => 2x chars)
  local key="$1" bytes="$2" cur
  cur="$(get_kv "$key")"
  if is_weak "$cur" $((bytes * 2 > 16 ? 16 : bytes * 2)); then
    set_kv "$key" "$(rand_hex "$bytes")"
    CHANGED+=("$key")
  else
    KEPT+=("$key")
  fi
}

# Legacy files kept the root password in DB_ROOT_PASSWORD: carry a strong one over.
if is_weak "$(get_kv MYSQL_ROOT_PASSWORD)" 16 && ! is_weak "$(get_kv DB_ROOT_PASSWORD)" 16; then
  set_kv MYSQL_ROOT_PASSWORD "$(get_kv DB_ROOT_PASSWORD)"
fi

if [ "$PRUNE" = "1" ]; then
  for key in "${DEAD_KEYS[@]}"; do
    if grep -qE "^$key=" "$ENV_FILE"; then
      del_kv "$key"
      PRUNED+=("$key")
    fi
  done
fi

# --- database -----------------------------------------------------------------
[ -n "$(get_kv DB_USERNAME)" ] || set_kv DB_USERNAME nestjs_user
[ -n "$(get_kv DB_DATABASE)" ] || set_kv DB_DATABASE chat_crm_db
DB_USER="$(get_kv DB_USERNAME)"

ensure MYSQL_ROOT_PASSWORD 16
set_kv MYSQL_DATABASE "$(get_kv DB_DATABASE)"

if [ "$DB_USER" = "root" ]; then
  # mysql:8 aborts with MYSQL_USER=root; the API logs in with the root password.
  set_kv DB_PASSWORD "$(get_kv MYSQL_ROOT_PASSWORD)"
  del_kv MYSQL_USER
  del_kv MYSQL_PASSWORD
  echo "note: DB_USERNAME=root -> MYSQL_USER/MYSQL_PASSWORD removed (mysql image rule)"
else
  ensure DB_PASSWORD 16
  set_kv MYSQL_USER "$DB_USER"
  set_kv MYSQL_PASSWORD "$(get_kv DB_PASSWORD)"
fi

# --- app secrets --------------------------------------------------------------
ensure REDIS_PASSWORD 16
ensure JWT_SECRET 32
ensure CREDENTIALS_ENCRYPTION_KEY 32

chmod 600 "$ENV_FILE"

# --- report (names only) ------------------------------------------------------
echo
echo "file: $ENV_FILE (chmod 600)"
[ ${#CHANGED[@]} -gt 0 ] && echo "generated: ${CHANGED[*]}" || echo "generated: (nothing, all strong)"
[ ${#KEPT[@]} -gt 0 ] && echo "kept:      ${KEPT[*]}"
[ ${#PRUNED[@]} -gt 0 ] && echo "pruned:    ${PRUNED[*]}"
echo "mirrored:  MYSQL_DATABASE$( [ "$DB_USER" = root ] || echo ' MYSQL_USER MYSQL_PASSWORD')"

if printf '%s\n' "${CHANGED[@]:-}" | grep -qE '^(MYSQL_ROOT_PASSWORD|DB_PASSWORD)$'; then
  echo
  echo "WARNING: new DB passwords only work on an EMPTY mysql volume. If the volume"
  echo "already holds data, restore the previous values from the backup above."
fi
