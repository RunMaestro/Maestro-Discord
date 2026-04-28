#!/usr/bin/env bash
# Maestro Discord Bot installer.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RunMaestro/Maestro-Discord/main/install.sh | bash
# Re-run to upgrade to the latest release. Existing config is preserved.

set -euo pipefail

REPO="${MAESTRO_DISCORD_REPO:-RunMaestro/Maestro-Discord}"
INSTALL_DIR="${MAESTRO_DISCORD_HOME:-$HOME/.local/share/maestro-discord}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/maestro-discord"
BIN_DIR="${MAESTRO_DISCORD_BIN_DIR:-$HOME/.local/bin}"
VERSION="${MAESTRO_DISCORD_VERSION:-latest}"
NODE_MIN_MAJOR=22

c_red()    { printf '\033[31m%s\033[0m' "$*"; }
c_green()  { printf '\033[32m%s\033[0m' "$*"; }
c_yellow() { printf '\033[33m%s\033[0m' "$*"; }
c_blue()   { printf '\033[34m%s\033[0m' "$*"; }
c_bold()   { printf '\033[1m%s\033[0m' "$*"; }

info() { printf '%s %s\n' "$(c_blue '==>')" "$*"; }
ok()   { printf '%s %s\n' "$(c_green '✓')" "$*"; }
warn() { printf '%s %s\n' "$(c_yellow '!')" "$*" >&2; }
die()  { printf '%s %s\n' "$(c_red '✗')" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1${2:+ — $2}"
}

detect_os() {
  case "$(uname -s)" in
    Linux)  echo linux ;;
    Darwin) echo macos ;;
    *)      die "Unsupported OS: $(uname -s). Linux and macOS only." ;;
  esac
}

check_node() {
  require_cmd node "install Node.js ${NODE_MIN_MAJOR}+ from https://nodejs.org/"
  require_cmd npm "install Node.js ${NODE_MIN_MAJOR}+ from https://nodejs.org/"
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -lt "$NODE_MIN_MAJOR" ]; then
    die "Node.js ${NODE_MIN_MAJOR}+ required (found $(node --version))."
  fi
  ok "Node.js $(node --version)"
}

check_maestro_cli() {
  if command -v maestro-cli >/dev/null 2>&1; then
    ok "maestro-cli found ($(maestro-cli --version 2>/dev/null | head -n1 || echo 'version unknown'))"
  else
    warn "maestro-cli not found on PATH. The bot will fail to relay messages until it is installed."
    warn "See https://docs.runmaestro.ai/cli for instructions."
  fi
}

resolve_release() {
  local api_url tag
  if [ "$VERSION" = "latest" ]; then
    api_url="https://api.github.com/repos/${REPO}/releases/latest"
  else
    api_url="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
  fi
  tag="$(curl -fsSL "$api_url" | sed -nE 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n1)"
  [ -n "$tag" ] || die "Could not resolve release tag from ${api_url}"
  echo "$tag"
}

download_release() {
  local tag="$1" dest="$2"
  local url="https://github.com/${REPO}/releases/download/${tag}/maestro-discord-${tag}.tar.gz"
  info "Downloading ${tag} from ${url}"
  curl -fsSL "$url" -o "$dest" || die "Download failed: $url"
}

install_release() {
  local tag="$1" tarball="$2"
  local staging
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' RETURN
  tar -xzf "$tarball" -C "$staging"
  local extracted
  extracted="$(find "$staging" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  [ -n "$extracted" ] || extracted="$staging"

  mkdir -p "$INSTALL_DIR"
  local backup=""
  if [ -d "$INSTALL_DIR/dist" ]; then
    backup="${INSTALL_DIR}.backup.$(date +%s)"
    mv "$INSTALL_DIR" "$backup"
    mkdir -p "$INSTALL_DIR"
    trap 'rm -rf "$INSTALL_DIR"; mv "$backup" "$INSTALL_DIR"; warn "Restored previous install from $backup"' ERR
    info "Backed up previous install to $backup"
  fi

  cp -R "$extracted"/. "$INSTALL_DIR"/
  printf '%s\n' "$tag" > "$INSTALL_DIR/.version"

  if [ -n "$backup" ] && [ -f "$backup/maestro-bot.db" ] && [ ! -f "$INSTALL_DIR/maestro-bot.db" ]; then
    cp "$backup/maestro-bot.db" "$INSTALL_DIR/maestro-bot.db"
    info "Preserved SQLite database"
  fi

  trap - ERR
  ok "Extracted release to $INSTALL_DIR"
}

install_deps() {
  info "Installing production dependencies (npm ci --omit=dev)…"
  (cd "$INSTALL_DIR" && npm ci --omit=dev --no-audit --no-fund --silent)
  ok "Dependencies installed"
}

prompt_var() {
  local desc="$2" default="${3:-}" current="${!1:-}"
  if [ -n "$current" ]; then
    echo "$current"
    return
  fi
  local prompt="  ${desc}"
  [ -n "$default" ] && prompt="${prompt} [${default}]"
  prompt="${prompt}: "
  local value=""
  if [ -r /dev/tty ]; then
    read -r -p "$prompt" value </dev/tty || true
  fi
  [ -z "$value" ] && value="$default"
  echo "$value"
}

write_config() {
  mkdir -p "$CONFIG_DIR"
  local env_file="$CONFIG_DIR/.env"
  if [ -f "$env_file" ]; then
    ok "Config exists at $env_file (preserving)"
    ln -sf "$env_file" "$INSTALL_DIR/.env"
    return
  fi

  if [ ! -r /dev/tty ]; then
    info "Non-interactive shell — writing template to $env_file (edit before starting)"
    cp "$INSTALL_DIR/.env.example" "$env_file"
    ln -sf "$env_file" "$INSTALL_DIR/.env"
    return
  fi

  info "Configuring $env_file"
  echo "  Find these values in https://discord.com/developers/applications"
  local token client_id guild_id allowed
  token="$(prompt_var DISCORD_BOT_TOKEN 'Discord bot token')"
  client_id="$(prompt_var DISCORD_CLIENT_ID 'Discord application (client) ID')"
  guild_id="$(prompt_var DISCORD_GUILD_ID 'Discord guild (server) ID')"
  allowed="$(prompt_var DISCORD_ALLOWED_USER_IDS 'Allowed user IDs (comma-separated, optional)')"

  local tmp_env
  tmp_env="$(mktemp "${env_file}.XXXXXX")"
  chmod 600 "$tmp_env"
  {
    printf '# Generated by install.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'DISCORD_BOT_TOKEN=%s\n' "$token"
    printf 'DISCORD_CLIENT_ID=%s\n' "$client_id"
    printf 'DISCORD_GUILD_ID=%s\n' "$guild_id"
    printf 'DISCORD_ALLOWED_USER_IDS=%s\n' "$allowed"
    printf 'API_PORT=3457\n'
    printf 'DISCORD_MENTION_USER_ID=\n'
    printf 'FFMPEG_PATH=ffmpeg\n'
    printf 'WHISPER_CLI_PATH=whisper-cli\n'
    printf 'WHISPER_MODEL_PATH=models/ggml-base.en.bin\n'
  } > "$tmp_env"
  mv "$tmp_env" "$env_file"
  ln -sf "$env_file" "$INSTALL_DIR/.env"
  ok "Wrote $env_file"
}

deploy_commands() {
  if [ ! -r /dev/tty ]; then
    warn "Skipping slash command deployment in non-interactive mode. Run 'maestro-discord-ctl deploy' later."
    return
  fi
  info "Deploying slash commands to Discord"
  if (cd "$INSTALL_DIR" && node dist/deploy-commands.js); then
    ok "Slash commands deployed"
  else
    warn "Slash command deployment failed. Edit $CONFIG_DIR/.env and re-run 'maestro-discord-ctl deploy'."
  fi
}

install_ctl() {
  mkdir -p "$BIN_DIR"
  local ctl="$INSTALL_DIR/bin/maestro-discord-ctl.sh"
  [ -f "$ctl" ] || die "Control script missing at $ctl"
  chmod +x "$ctl"
  ln -sf "$ctl" "$BIN_DIR/maestro-discord-ctl"
  ok "Installed maestro-discord-ctl → $BIN_DIR/maestro-discord-ctl"
  case ":$PATH:" in
    *":$BIN_DIR:"*) : ;;
    *) warn "$BIN_DIR is not on your PATH. Add it to your shell profile." ;;
  esac
}

install_service_linux() {
  command -v systemctl >/dev/null 2>&1 || { warn "systemctl not found — skipping service install."; return; }
  local unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  mkdir -p "$unit_dir"
  local template="$INSTALL_DIR/templates/maestro-discord.service"
  [ -f "$template" ] || { warn "Service template missing at $template"; return; }
  sed \
    -e "s|@INSTALL_DIR@|$INSTALL_DIR|g" \
    -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" \
    -e "s|@NODE_BIN@|$(command -v node)|g" \
    "$template" > "$unit_dir/maestro-discord.service"
  systemctl --user daemon-reload || true
  ok "Installed systemd unit → $unit_dir/maestro-discord.service"
  echo "    Enable on login:  systemctl --user enable --now maestro-discord"
  echo "    (and optionally:  loginctl enable-linger \$USER)"
}

install_service_macos() {
  local plist_dir="$HOME/Library/LaunchAgents"
  mkdir -p "$plist_dir"
  mkdir -p "$INSTALL_DIR/logs"
  local template="$INSTALL_DIR/templates/sh.maestro.discord.plist"
  [ -f "$template" ] || { warn "Plist template missing at $template"; return; }
  sed \
    -e "s|@INSTALL_DIR@|$INSTALL_DIR|g" \
    -e "s|@NODE_BIN@|$(command -v node)|g" \
    "$template" > "$plist_dir/sh.maestro.discord.plist"
  ok "Installed launchd plist → $plist_dir/sh.maestro.discord.plist"
  echo "    Load at login:  launchctl load -w $plist_dir/sh.maestro.discord.plist"
}

install_service() {
  case "$(detect_os)" in
    linux) install_service_linux ;;
    macos) install_service_macos ;;
  esac
}

main() {
  c_bold 'Maestro Discord Bot installer'
  echo
  echo

  require_cmd curl
  require_cmd tar
  require_cmd sed
  check_node
  check_maestro_cli

  local tag tarball
  tag="$(resolve_release)"
  info "Target release: ${tag}"

  tarball="$(mktemp)"
  trap 'rm -f "$tarball"' EXIT
  download_release "$tag" "$tarball"
  install_release "$tag" "$tarball"
  install_deps
  install_ctl
  write_config
  deploy_commands
  install_service

  echo
  ok "$(c_bold 'Install complete') — version $(c_green "$tag")"
  echo
  echo "  Start:  $(c_bold 'maestro-discord-ctl start')"
  echo "  Logs:   $(c_bold 'maestro-discord-ctl logs')"
  echo "  Config: $CONFIG_DIR/.env"
  echo
}

main "$@"
