#!/usr/bin/env bash
# Installer / updater for osu-dash (Unix: macOS / Linux)
# Logs to startup.log, keeps console output concise and prompts with styled buttons.

set -euo pipefail

LOG_FILE="startup.log"
MARKER_FILE=".osu-dash-installed"

info() { echo -e "\033[1;34m[INFO]\033[0m $1"; }
ok() { echo -e "\033[1;32m[OK]\033[0m $1"; }
err() { echo -e "\033[1;31m[ERROR]\033[0m $1"; }

run_log() {
  # Run a command, append full output to log, print a compact status to console
  local title="$1"; shift
  info "$title"
  echo "--- $(date --iso-8601=seconds) - $title" >> "$LOG_FILE"
  { "$@" ; } >>"$LOG_FILE" 2>&1 || {
    echo "--- FAILURE: $title" >> "$LOG_FILE"
    err "$title failed. See $LOG_FILE for details."
    exit 1
  }
  ok "$title"
}

prompt_yesno() {
  # render nice buttons and read single key
  local prompt="$1"
  echo
  echo -e "\033[1;33m$prompt\033[0m"
  echo -e "  [\033[1;32mY\033[0m] Yes    [\033[1;31mN\033[0m] No"
  while true; do
    read -n1 -s key
    case "${key,,}" in
      y) echo; return 0 ;;
      n) echo; return 1 ;;
      '') ;;
      *) ;;
    esac
  done
}

ensure_log() { touch "$LOG_FILE"; }

ensure_log
info "Starting installer — logging to $LOG_FILE"

# Determine target Node
TARGET_NODE=""
if [ -f package.json ] && grep -q '"engines"' package.json; then
  TARGET_NODE=$(node -p "require('./package.json').engines && require('./package.json').engines.node || ''" ) || true
fi
if [ -z "$TARGET_NODE" ] && [ -f .nvmrc ]; then
  TARGET_NODE=$(cat .nvmrc || true)
fi
if [ -z "$TARGET_NODE" ]; then
  if command -v node >/dev/null 2>&1; then
    TARGET_NODE=$(node -v | sed 's/^v//')
    echo "$TARGET_NODE" > .nvmrc
    info "No target specified — using current Node $TARGET_NODE and writing .nvmrc"
  else
    TARGET_NODE=""
  fi
fi

CURRENT_NODE=""
if command -v node >/dev/null 2>&1; then
  CURRENT_NODE=$(node -v | sed 's/^v//')
fi

if [ -n "$TARGET_NODE" ]; then
  info "Target Node: $TARGET_NODE"
else
  info "No target Node set; will proceed to install latest Node if requested."
fi

if [ -z "$CURRENT_NODE" ] || [ "$CURRENT_NODE" != "$TARGET_NODE" ]; then
  if [ -z "$CURRENT_NODE" ]; then
    info "Node is not installed on this system."
  else
    info "Current Node: $CURRENT_NODE (target: $TARGET_NODE)"
  fi
  if prompt_yesno "Install/activate Node $TARGET_NODE?"; then
    # Prefer Volta where possible
    if command -v volta >/dev/null 2>&1; then
      run_log "Installing Node via Volta ($TARGET_NODE)" volta install node@"$TARGET_NODE"
    elif command -v nvm >/dev/null 2>&1; then
      run_log "Installing Node via nvm ($TARGET_NODE)" bash -lc "nvm install $TARGET_NODE && nvm use $TARGET_NODE"
    else
      info "Volta / nvm not found. Installing Volta (recommended)."
      if prompt_yesno "Install Volta (system-wide install via curl)?"; then
        run_log "Installing Volta" bash -lc "curl https://get.volta.sh -sSf | bash"
        export PATH="$HOME/.volta/bin:$PATH"
        run_log "Volta install: installing node $TARGET_NODE" volta install node@"$TARGET_NODE"
      else
        err "Node installation skipped — aborting."; exit 1
      fi
    fi
  else
    err "Node version mismatch — user declined install. Aborting."; exit 1
  fi
fi

# Install dependencies (idempotent)
if [ ! -f "$MARKER_FILE" ]; then
  if [ -f package-lock.json ] || [ -f pnpm-lock.yaml ]; then
    run_log "Installing dependencies (clean)" npm ci
  else
    run_log "Installing dependencies" npm install
  fi

  # Install pm2 globally
  if ! command -v pm2 >/dev/null 2>&1; then
    info "Installing pm2 globally"
    if npm install -g pm2 >>"$LOG_FILE" 2>&1; then
      ok "pm2 installed"
    else
      err "Failed to install pm2 globally. Please install manually or run with elevated privileges.";
    fi
  fi

  # Start via pm2
  if [ -f ecosystem.config.cjs ] || [ -f ecosystem.config.js ]; then
    run_log "Starting app via pm2" pm2 start ecosystem.config.cjs --update-env || pm2 start ecosystem.config.js --update-env
    run_log "Saving pm2 process list" pm2 save
    # Setup startup
    info "Configuring pm2 startup (may require sudo)"
    if pm2 startup | tee -a "$LOG_FILE" | sed -n 's/.*sudo //p' >/dev/null 2>&1; then
      # The pm2 startup command prints the command to run as sudo; attempt to run it
      start_cmd=$(pm2 startup | sed -n 's/.*sudo //p' | tail -n1)
      if [ -n "$start_cmd" ]; then
        info "Running: sudo $start_cmd"
        sudo $start_cmd >>"$LOG_FILE" 2>&1 || info "Run the above command manually if required."
      fi
    fi

  fi

  # Create marker
  cat > "$MARKER_FILE" <<EOF
installed_at: $(date --iso-8601=seconds)
node: $(node -v || echo "unknown")
log: $LOG_FILE
EOF
  ok "Initial setup complete"
else
  ok "Initial setup already performed; skipping installs."
fi

# Always check for updates
OLD_HEAD=$(git rev-parse HEAD || echo "")
run_log "Fetching updates" git fetch --all --prune
run_log "Pulling latest changes" git pull
NEW_HEAD=$(git rev-parse HEAD || echo "")
if [ "$OLD_HEAD" != "$NEW_HEAD" ]; then
  ok "Repository updated from $OLD_HEAD to $NEW_HEAD"
  # detect dependency changes
  changed=$(git diff --name-only $OLD_HEAD $NEW_HEAD || true)
  echo "$changed" >> "$LOG_FILE"
  if echo "$changed" | grep -E "package(-lock)?\.json|pnpm-lock.yaml|yarn.lock" >/dev/null 2>&1; then
    run_log "Dependencies changed: running npm ci" npm ci
  fi
  # restart pm2
  if command -v pm2 >/dev/null 2>&1; then
    run_log "Reloading application via pm2" pm2 reload ecosystem.config.cjs --update-env || pm2 reload ecosystem.config.js --update-env || pm2 restart all
  fi
else
  info "No updates found."
fi

ok "Done — see $LOG_FILE for full output"
