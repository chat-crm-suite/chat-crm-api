#!/usr/bin/env bash
# Fills the random secrets of an API env file (.env.prod, or .env in development).
#
# Usage:
#   ./deploy/gen-secrets.sh [--env FILE] [--prune] [--show-setup-token]
#                           [--show-platform-password] [--rotate KEY[,KEY]] [--yes-db]
#
#   --env FILE   env file to fill (default: <api repo>/.env.prod; created from
#                .env.prod.example when missing)
#   --prune      also delete variables nothing reads any more (see DEAD_KEYS)
#   --show-setup-token
#                print SETUP_TOKEN once at the end (the first-run setup screen
#                asks for it)
#   --show-platform-password
#                print PLATFORM_CONSOLE_PASSWORD once at the end (platform admins
#                type it to unlock the /platform console). With --show-setup-token
#                these are the only values this script ever prints
#   --rotate KEY[,KEY]
#                force-regenerate ONLY the named secrets (repeatable). Valid keys
#                are the generated ones listed below. Rotating MYSQL_ROOT_PASSWORD
#                or DB_PASSWORD also needs --yes-db; rotating JWT_SECRET closes
#                every session
#   --yes-db     acknowledge that new DB passwords only work on an EMPTY mysql
#                volume (see the warning under Behaviour)
#
# Secrets generated (hex, from openssl):
#   MYSQL_ROOT_PASSWORD, DB_PASSWORD, REDIS_PASSWORD, JWT_SECRET,
#   CREDENTIALS_ENCRYPTION_KEY (64 hex chars = AES-256 key),
#   SETUP_TOKEN (asked by the first-run setup; without it production generates a
#   random one and logs it once),
#   PLATFORM_CONSOLE_PASSWORD (24 bytes = 48 hex chars; unlocks the /platform
#   console. Write PLATFORM_CONSOLE_PASSWORD=disabled to keep the console off:
#   the script then leaves it alone and the API answers 404 on /platform/*)
# Mirrors kept in sync (the mysql image reads MYSQL_*, the API reads DB_*):
#   MYSQL_DATABASE <- DB_DATABASE, MYSQL_USER <- DB_USERNAME, MYSQL_PASSWORD <- DB_PASSWORD
#
# Behaviour:
#   - Only fills values that are missing, empty, a <placeholder>/CHANGE_ME or a
#     known weak default (root_password, 123456, ...). A strong existing value
#     is NEVER overwritten, so the script is safe to run again.
#   - To rotate one secret on purpose: --rotate KEY (or empty its value in the
#     file and re-run). Consequences:
#       DB / MYSQL passwords         mysql reads them only when the data volume is
#                                    created; on a live volume the API loses access.
#       CREDENTIALS_ENCRYPTION_KEY   stored WhatsApp tokens become unreadable.
#       JWT_SECRET                   every session is closed.
#       PLATFORM_CONSOLE_PASSWORD    the new password is needed to unlock the console.
#   - The mysql image refuses MYSQL_USER=root, so a root DB user drops the
#     MYSQL_USER/MYSQL_PASSWORD mirrors (the API then uses the root password).
#   - No secret is printed unless a --show-* flag asks for it. The file ends up
#     chmod 600 and a timestamped copy is kept outside the repo (BACKUP_DIR,
#     default ~/.chat-crm-env-backups).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$API_DIR/.env.prod"
PRUNE=0
SHOW_SETUP=0
SHOW_PLATFORM=0
YES_DB=0
ROTATE=()
BACKUP_DIR="${BACKUP_DIR:-$HOME/.chat-crm-env-backups}"

# Secrets this script generates (the only valid --rotate targets).
GENERATED_KEYS=(
  MYSQL_ROOT_PASSWORD DB_PASSWORD REDIS_PASSWORD JWT_SECRET
  CREDENTIALS_ENCRYPTION_KEY SETUP_TOKEN PLATFORM_CONSOLE_PASSWORD
)

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
    --show-setup-token) SHOW_SETUP=1; shift ;;
    --show-platform-password) SHOW_PLATFORM=1; shift ;;
    --yes-db) YES_DB=1; shift ;;
    --rotate)
      IFS=',' read -r -a rotate_keys <<< "${2:?--rotate needs KEY[,KEY]}"
      for rotate_key in "${rotate_keys[@]}"; do ROTATE+=("$rotate_key"); done
      shift 2 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done

rotating() { # $1 = key; succeeds when --rotate named it
  local key="$1" named
  [ ${#ROTATE[@]} -gt 0 ] || return 1
  for named in "${ROTATE[@]}"; do
    [ "$named" = "$key" ] && return 0
  done
  return 1
}

# Validate --rotate before touching the file.
if [ ${#ROTATE[@]} -gt 0 ]; then
  for rotate_key in "${ROTATE[@]}"; do
    known=0
    for generated in "${GENERATED_KEYS[@]}"; do
      [ "$rotate_key" = "$generated" ] && known=1
    done
    if [ "$known" = "0" ]; then
      echo "cannot rotate $rotate_key: not a generated secret (valid: ${GENERATED_KEYS[*]})" >&2
      exit 1
    fi
  done
  if { rotating MYSQL_ROOT_PASSWORD || rotating DB_PASSWORD; } && [ "$YES_DB" != "1" ]; then
    echo "WARNING: new DB passwords only work on an EMPTY mysql volume. If the volume" >&2
    echo "already holds data the API loses access to mysql. Re-run with --yes-db to confirm." >&2
    exit 1
  fi
fi

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
ROTATED=()

ensure() { # $1 = key, $2 = random bytes (hex => 2x chars)
  local key="$1" bytes="$2" cur
  cur="$(get_kv "$key")"
  if rotating "$key"; then
    set_kv "$key" "$(rand_hex "$bytes")"
    CHANGED+=("$key")
    ROTATED+=("$key")
  elif is_weak "$cur" $((bytes * 2 > 16 ? 16 : bytes * 2)); then
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

if [ "$DB_USER" = "root" ] && rotating DB_PASSWORD; then
  echo "DB_USERNAME=root: DB_PASSWORD mirrors MYSQL_ROOT_PASSWORD; rotate MYSQL_ROOT_PASSWORD instead" >&2
  exit 1
fi

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
ensure SETUP_TOKEN 16

# Explicit opt-out: PLATFORM_CONSOLE_PASSWORD=disabled keeps the /platform console
# off and is never replaced (only an explicit --rotate overrides it).
PLATFORM_DISABLED=0
platform_value="$(get_kv PLATFORM_CONSOLE_PASSWORD | tr '[:upper:]' '[:lower:]')"
if [ "$platform_value" = "disabled" ] && ! rotating PLATFORM_CONSOLE_PASSWORD; then
  PLATFORM_DISABLED=1
  KEPT+=("PLATFORM_CONSOLE_PASSWORD")
else
  ensure PLATFORM_CONSOLE_PASSWORD 24
fi

chmod 600 "$ENV_FILE"

# --- report (names only) ------------------------------------------------------
echo
echo "file: $ENV_FILE (chmod 600)"
[ ${#CHANGED[@]} -gt 0 ] && echo "generated: ${CHANGED[*]}" || echo "generated: (nothing, all strong)"
[ ${#KEPT[@]} -gt 0 ] && echo "kept:      ${KEPT[*]}"
[ ${#PRUNED[@]} -gt 0 ] && echo "pruned:    ${PRUNED[*]}"
[ ${#ROTATED[@]} -gt 0 ] && echo "rotated:   ${ROTATED[*]}"
echo "mirrored:  MYSQL_DATABASE$( [ "$DB_USER" = root ] || echo ' MYSQL_USER MYSQL_PASSWORD')"
if [ "$PLATFORM_DISABLED" = "1" ]; then
  echo "platform console: disabled (PLATFORM_CONSOLE_PASSWORD=disabled, left untouched)"
else
  echo "platform console: enabled (PLATFORM_CONSOLE_PASSWORD set)"
fi

if printf '%s\n' "${CHANGED[@]:-}" | grep -qE '^(MYSQL_ROOT_PASSWORD|DB_PASSWORD)$'; then
  echo
  echo "WARNING: new DB passwords only work on an EMPTY mysql volume. If the volume"
  echo "already holds data, restore the previous values from the backup above."
fi

if printf '%s\n' "${ROTATED[@]:-}" | grep -qx 'JWT_SECRET'; then
  echo
  echo "NOTE: JWT_SECRET rotated -> every session is closed; restart the API and sign in again."
fi

if [ "$SHOW_SETUP" = "1" ]; then
  echo
  echo "SETUP_TOKEN=$(get_kv SETUP_TOKEN)"
fi

if [ "$SHOW_PLATFORM" = "1" ]; then
  echo
  if [ "$PLATFORM_DISABLED" = "1" ]; then
    echo "PLATFORM_CONSOLE_PASSWORD is disabled: nothing to show"
  else
    echo "PLATFORM_CONSOLE_PASSWORD=$(get_kv PLATFORM_CONSOLE_PASSWORD)"
  fi
fi
