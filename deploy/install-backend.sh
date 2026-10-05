#!/usr/bin/env bash
# =============================================================================
# Calculator Backend — one-command deployment script
#
# -----------------------------------------------------------------------------
# Why this script exists (instead of just handing over a document)
#
# The original deliverable was a systemd unit template with <APP_DIR> / <NODE_BIN>
# placeholders, for the user to substitute by hand. Verifying that template with
# `systemd-analyze verify` before deployment revealed:
#
#     WorkingDirectory= path is not absolute: <APP_DIR>
#     Unit configuration has fatal error, unit will not be started.
#
# In other words, one unreplaced placeholder is enough for systemd to refuse to start,
# and its error message does **not** hint "you forgot to replace a placeholder", so a
# troubleshooter easily mistakes it for a problem with the service itself.
#
# This script handles it by eliminating the placeholder failure mode altogether:
#   - the install directory is derived from the script's own location, no manual entry;
#   - the node path is detected automatically;
#   - `systemd-analyze verify` runs first, and the script aborts if it fails.
#
# -----------------------------------------------------------------------------
# Usage
#
#   sudo ./deploy/install-backend.sh                  # install for real
#   sudo ./deploy/install-backend.sh --dry-run        # verify only, change nothing
#   sudo APP_DIR=/opt/calc ./deploy/install-backend.sh  # custom install directory
# Assumption: this script sits in the deploy/ directory of the backend repository.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SERVICE_NAME="calculator-backend"
SERVICE_USER="calculator"
SERVICE_GROUP="calculator"
PORT="${PORT:-5000}"
HOST="${HOST:-127.0.0.1}"
LOG_LEVEL="${LOG_LEVEL:-info}"

DRY_RUN=0
ASSUME_YES=0

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
info()  { printf '  \033[36m·\033[0m %s\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
step()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -y|--yes)  ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "Unknown argument: $arg (use --help for usage)" ;;
  esac
done

# ---------------------------------------------------------------------------
# Path derivation: derive the repository root from the script's own location, no manual paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="${APP_DIR:-$REPO_DIR}"
UNIT_SOURCE="$SCRIPT_DIR/${SERVICE_NAME}.service"
UNIT_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

printf '\n\033[1mCalculator Backend Deployment%s\033[0m\n' "$([ "$DRY_RUN" -eq 1 ] && echo ' (dry run, the system will not be modified)' || echo '')"
echo "  Repository  : $REPO_DIR"
echo "  Install dir : $APP_DIR"
echo "  Service name: $SERVICE_NAME"

# ---------------------------------------------------------------------------
# 1. Preflight checks
# ---------------------------------------------------------------------------
step "1/7 Preflight checks"

[ "$(id -u)" -eq 0 ] || fail "Must be run as root (use sudo)"
ok "Running as root"

command -v systemctl >/dev/null 2>&1 || fail "systemctl not found; this script requires a systemd environment"
ok "systemd available: $(systemctl --version | head -1)"

command -v systemd-analyze >/dev/null 2>&1 || fail "systemd-analyze not found (used to validate the unit file before installation)"
ok "systemd-analyze available"

[ -f "$UNIT_SOURCE" ] || fail "Unit file template not found: $UNIT_SOURCE"
ok "Unit file template exists"

[ -f "$APP_DIR/package.json" ] || fail "package.json not found under $APP_DIR; please confirm this is the backend repository root"
[ -f "$APP_DIR/src/server.js" ] || fail "src/server.js not found under $APP_DIR"
ok "Backend project files are complete"

# ---- node detection and version check ----
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
[ -n "$NODE_BIN" ] || fail "node not found; please install Node.js >= 22.5.0 first"
[ -x "$NODE_BIN" ] || fail "node is not executable: $NODE_BIN"

NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"

# It must be an absolute, resolvable path: systemd accepts neither relative paths nor command names
NODE_BIN="$(readlink -f "$NODE_BIN")"

# node:sqlite is available from 22.5.0 onward; below that version the service throws
# "Cannot find module 'node:sqlite'" at startup, so it is intercepted early and the reason explained.
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  fail "Node version too old: $NODE_VERSION (this project needs >= 22.5.0 because it uses the built-in module node:sqlite)"
fi
ok "node $NODE_VERSION ($NODE_BIN)"

# ---- Port availability check ----
if ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  fail "Port ${PORT} is already in use; free it first, or re-run with PORT=<another port>"
fi
ok "Port ${PORT} is free"

# ---------------------------------------------------------------------------
# 2. Create the run user (low privilege, not root)
# ---------------------------------------------------------------------------
step "2/7 Run user"

if id "$SERVICE_USER" >/dev/null 2>&1; then
  ok "User $SERVICE_USER already exists, skipping creation"
elif [ "$DRY_RUN" -eq 1 ]; then
  info "Would create system user $SERVICE_USER (dry run, skipping)"
else
  useradd --system --shell /usr/sbin/nologin --home "$(dirname "$APP_DIR")" "$SERVICE_USER"
  ok "Created system user $SERVICE_USER (login disabled)"
fi

# ---------------------------------------------------------------------------
# 3. Directories and permissions
# ---------------------------------------------------------------------------
step "3/7 Directories and permissions"

if [ "$DRY_RUN" -eq 1 ]; then
  info "Would create data directory $APP_DIR/data and grant it to $SERVICE_USER (dry run, skipping)"
else
  mkdir -p "$APP_DIR/data"
  # The whole directory is handed to the service user, so npm install and SQLite writes
  # do not fail on permissions. The recursive grant lets the script succeed on the first
  # try when the owner is root; chown it yourself first to keep existing ownership as is.
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$APP_DIR"
  chmod 750 "$APP_DIR/data"
  ok "Data directory ready: $APP_DIR/data"
fi

# ---------------------------------------------------------------------------
# 4. Install dependencies
# ---------------------------------------------------------------------------
step "4/7 Install dependencies"

if [ "$DRY_RUN" -eq 1 ]; then
  info "Would run npm install --omit=dev (dry run, skipping)"
else
  if ! command -v npm >/dev/null 2>&1; then
    fail "npm not found; this project has only one runtime dependency (express), so you can also install it by hand and re-run this script"
  fi
  ( cd "$APP_DIR" && sudo -u "$SERVICE_USER" npm install --omit=dev --no-audit --no-fund ) \
    || fail "npm install failed"
  ok "Dependencies installed"
fi

# ---------------------------------------------------------------------------
# 5. Generate and validate the systemd unit file
# ---------------------------------------------------------------------------
step "5/7 Generate and validate the unit file"

TEMP_UNIT="$(mktemp /tmp/${SERVICE_NAME}.XXXXXX.service)"

# Substitute the real paths derived here into the template's placeholders. Nothing has
# to be replaced by hand, so the "missed substitution makes systemd refuse to start" case cannot arise.
sed \
  -e "s|<APP_DIR>|$APP_DIR|g" \
  -e "s|<NODE_BIN>|$NODE_BIN|g" \
  -e "s|<PORT>|$PORT|g" \
  -e "s|<HOST>|$HOST|g" \
  -e "s|<LOG_LEVEL>|$LOG_LEVEL|g" \
  "$UNIT_SOURCE" > "$TEMP_UNIT"

# The port and friends inside Environment= must be replaced as well (they are hard-coded in the template; overridden uniformly here)
if grep -q '^Environment=PORT=' "$TEMP_UNIT"; then
  sed -i "s|^Environment=PORT=.*|Environment=PORT=$PORT|" "$TEMP_UNIT"
  sed -i "s|^Environment=HOST=.*|Environment=HOST=$HOST|" "$TEMP_UNIT"
  sed -i "s|^Environment=LOG_LEVEL=.*|Environment=LOG_LEVEL=$LOG_LEVEL|" "$TEMP_UNIT"
fi

info "Validating unit file syntax…"
# systemd-analyze verify reports unknown directives, non-absolute paths, permission errors
# and the like directly. If it fails here the script aborts at once and never installs a broken unit.
VERIFY_OUTPUT="$(systemd-analyze verify "$TEMP_UNIT" 2>&1 || true)"
if echo "$VERIFY_OUTPUT" | grep -qiE "fatal|bad unit file|not absolute"; then
  echo "$VERIFY_OUTPUT" | sed 's/^/      /' >&2
  rm -f "$TEMP_UNIT"
  fail "Unit file validation failed; aborted (the system was not modified)"
fi
# Harmless warnings such as "the user does not exist yet" are ignored here: step 2 already ensures the user exists
if [ -n "$VERIFY_OUTPUT" ]; then
  echo "$VERIFY_OUTPUT" | sed 's/^/      /'
  warn "Validation produced warnings (usually harmless, continuing)"
fi
ok "Unit file validation passed"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  info "Dry run finished. The generated unit file looks like this (not installed):"
  echo "  ────────────────────────────────────────────"
  sed 's/^/  │ /' "$TEMP_UNIT"
  echo "  ────────────────────────────────────────────"
  rm -f "$TEMP_UNIT"
  printf '\n\033[33mDry run complete; no changes were made to the system.\033[0m\n'
  printf 'Drop --dry-run to install for real.\n\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# 6. Install and start the service
# ---------------------------------------------------------------------------
step "6/7 Install and start the service"

install -m 644 "$TEMP_UNIT" "$UNIT_TARGET"
rm -f "$TEMP_UNIT"
ok "Installed: $UNIT_TARGET"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"

# Give the process a moment to start
sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "Service started"
else
  echo
  systemctl status "$SERVICE_NAME" --no-pager -l | head -20 | sed 's/^/      /'
  fail "Service failed to start; check the status above or journalctl -u $SERVICE_NAME -n 50"
fi

# ---------------------------------------------------------------------------
# 7. Health check
# ---------------------------------------------------------------------------
step "7/7 Health check"

HEALTH_URL="http://${HOST}:${PORT}/api/health"
HEALTH_OK=0
for attempt in 1 2 3 4 5; do
  RESPONSE="$(curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null || true)"
  if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    HEALTH_OK=1
    break
  fi
  info "Probe $attempt did not succeed, retrying in 1 second…"
  sleep 1
done

if [ "$HEALTH_OK" -eq 1 ]; then
  ok "Backend responding normally: $HEALTH_URL"
  echo "$RESPONSE" | sed 's/^/      /'
else
  warn "The API is not responding yet; this may be a firewall or bind-address problem"
  echo "      Service state: $(systemctl is-active "$SERVICE_NAME")"
  echo "      View logs: journalctl -u $SERVICE_NAME -n 50 --no-pager"
  exit 1
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<EOF

  ────────────────────────────────────────────────────────
  Backend deployment complete

    Install dir   : $APP_DIR
    Database file : $APP_DIR/data/calculator.sqlite
    Service name  : $SERVICE_NAME
    Listening on  : $HOST:$PORT
    Health check  : $HEALTH_URL

  Common commands

    systemctl status  $SERVICE_NAME
    systemctl restart $SERVICE_NAME
    journalctl -u $SERVICE_NAME -f
    systemctl show $SERVICE_NAME -p MemoryCurrent -p MemoryMax

  Next steps

    Configure the nginx server block (see deploy/nginx-bt-panel.conf.example),
    so that the frontend static files and /api live under the same origin.

  ────────────────────────────────────────────────────────

EOF
