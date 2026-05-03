#!/usr/bin/env bash
# Maestro Discord Bot installer.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RunMaestro/Maestro-Discord/main/install.sh | bash
# Re-run to upgrade to the latest release. Existing config is preserved.

set -Eeuo pipefail

REPO="${MAESTRO_DISCORD_REPO:-RunMaestro/Maestro-Discord}"
INSTALL_DIR="${MAESTRO_DISCORD_HOME:-$HOME/.local/share/maestro-discord}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/maestro-discord"
BIN_DIR="${MAESTRO_DISCORD_BIN_DIR:-$HOME/.local/bin}"
VERSION="${MAESTRO_DISCORD_VERSION:-latest}"
NODE_MIN_MAJOR=22
RELEASE_BACKUP=""

VOICE_FFMPEG=""
VOICE_WHISPER=""
VOICE_MODEL=""
DEFAULT_MODEL_NAME="ggml-base.en.bin"
DEFAULT_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${DEFAULT_MODEL_NAME}"

rollback_install() {
  if [ -n "$RELEASE_BACKUP" ] && [ -d "$RELEASE_BACKUP" ]; then
    rm -rf "$INSTALL_DIR"
    mv "$RELEASE_BACKUP" "$INSTALL_DIR"
    warn "Restored previous install from $RELEASE_BACKUP"
  fi
}

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

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

download_release() {
  local tag="$1" dest="$2"
  local url="https://github.com/${REPO}/releases/download/${tag}/maestro-discord-${tag}.tar.gz"
  local sha_url="${url}.sha256"
  info "Downloading ${tag} from ${url}"
  curl -fsSL "$url" -o "$dest" || die "Download failed: $url"

  local sha_file expected actual
  sha_file="$(mktemp)"
  if curl -fsSL "$sha_url" -o "$sha_file" 2>/dev/null; then
    expected="$(awk '{print $1}' "$sha_file")"
    rm -f "$sha_file"
    if [ -z "$expected" ]; then
      die "Empty checksum at $sha_url"
    fi
    if ! actual="$(sha256_of "$dest")"; then
      warn "No sha256sum/shasum on PATH — skipping checksum verification"
      return
    fi
    if [ "$expected" != "$actual" ]; then
      die "Checksum mismatch for $url (expected $expected, got $actual)"
    fi
    ok "Verified SHA-256 checksum"
  else
    rm -f "$sha_file"
    warn "Checksum file not published at $sha_url — skipping verification"
  fi
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
  if [ -d "$INSTALL_DIR/dist" ]; then
    RELEASE_BACKUP="${INSTALL_DIR}.backup.$(date +%s)"
    mv "$INSTALL_DIR" "$RELEASE_BACKUP"
    mkdir -p "$INSTALL_DIR"
    info "Backed up previous install to $RELEASE_BACKUP"
  fi

  cp -R "$extracted"/. "$INSTALL_DIR"/
  printf '%s\n' "$tag" > "$INSTALL_DIR/.version"

  if [ -n "$RELEASE_BACKUP" ] && [ -f "$RELEASE_BACKUP/maestro-bot.db" ] && [ ! -f "$INSTALL_DIR/maestro-bot.db" ]; then
    cp "$RELEASE_BACKUP/maestro-bot.db" "$INSTALL_DIR/maestro-bot.db"
    info "Preserved SQLite database"
  fi

  # Migrate .env from a legacy install (e.g. manual git clone) into the XDG
  # config dir so write_config will preserve it instead of writing a template.
  if [ -n "$RELEASE_BACKUP" ] \
     && [ -f "$RELEASE_BACKUP/.env" ] \
     && [ ! -L "$RELEASE_BACKUP/.env" ] \
     && [ ! -f "$CONFIG_DIR/.env" ]; then
    mkdir -p "$CONFIG_DIR"
    cp "$RELEASE_BACKUP/.env" "$CONFIG_DIR/.env"
    chmod 600 "$CONFIG_DIR/.env"
    info "Migrated existing .env → $CONFIG_DIR/.env"
  fi

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

  local interactive=0
  [ -r /dev/tty ] && interactive=1
  local have_required=0
  if [ -n "${DISCORD_BOT_TOKEN:-}" ] \
     && [ -n "${DISCORD_CLIENT_ID:-}" ] \
     && [ -n "${DISCORD_GUILD_ID:-}" ]; then
    have_required=1
  fi

  if [ "$interactive" -eq 0 ] && [ "$have_required" -eq 0 ]; then
    info "Non-interactive shell — writing template to $env_file (edit before starting)"
    cp "$INSTALL_DIR/.env.example" "$env_file"
    chmod 600 "$env_file"
    ln -sf "$env_file" "$INSTALL_DIR/.env"
    return
  fi

  if [ "$interactive" -eq 1 ]; then
    info "Configuring $env_file"
    echo "  Find these values in https://discord.com/developers/applications"
  else
    info "Writing config from environment to $env_file"
  fi
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
    printf 'FFMPEG_PATH=%s\n' "${VOICE_FFMPEG:-ffmpeg}"
    printf 'WHISPER_CLI_PATH=%s\n' "${VOICE_WHISPER:-whisper-cli}"
    printf 'WHISPER_MODEL_PATH=%s\n' "${VOICE_MODEL:-models/${DEFAULT_MODEL_NAME}}"
  } > "$tmp_env"
  mv "$tmp_env" "$env_file"
  ln -sf "$env_file" "$INSTALL_DIR/.env"
  ok "Wrote $env_file"
}

config_complete() {
  local file="$1" key value
  [ -f "$file" ] || return 1
  for key in DISCORD_BOT_TOKEN DISCORD_CLIENT_ID DISCORD_GUILD_ID; do
    value="$(sed -nE "s/^${key}=([^#[:space:]]+).*/\1/p" "$file" | head -n1)"
    [ -n "$value" ] || return 1
    case "$value" in
      your_*) return 1 ;;
    esac
  done
  return 0
}

deploy_commands() {
  local env_file="$CONFIG_DIR/.env"
  if ! config_complete "$env_file"; then
    warn "Skipping slash command deployment — config at $env_file is incomplete or contains template values."
    warn "Edit it and run 'maestro-discord-ctl deploy' when ready."
    return
  fi
  info "Deploying slash commands to Discord"
  if (cd "$INSTALL_DIR" && node dist/deploy-commands.js); then
    ok "Slash commands deployed"
  else
    warn "Slash command deployment failed. Edit $env_file and re-run 'maestro-discord-ctl deploy'."
  fi
}

expand_tilde() {
  local p="$1"
  case "$p" in
    "~"|"~/"*) printf '%s' "${HOME}${p#\~}" ;;
    *) printf '%s' "$p" ;;
  esac
}

prompt_yes_no() {
  local prompt="$1" default="${2:-Y}" ans=""
  [ -r /dev/tty ] || { printf '%s' "$default"; return; }
  read -r -p "$prompt" ans </dev/tty || ans=""
  [ -z "$ans" ] && ans="$default"
  case "$ans" in
    y|Y|yes|YES) printf 'Y' ;;
    n|N|no|NO)   printf 'N' ;;
    *)           printf '%s' "$default" ;;
  esac
}

setup_voice_choose_model() {
  if [ -n "${MAESTRO_DISCORD_MODEL:-}" ]; then
    local m
    m="$(expand_tilde "$MAESTRO_DISCORD_MODEL")"
    if [ -f "$m" ]; then
      VOICE_MODEL="$m"
      ok "Using existing model from MAESTRO_DISCORD_MODEL: $m"
      return
    else
      warn "MAESTRO_DISCORD_MODEL=$m not found — falling back to download"
    fi
  fi

  if [ -r /dev/tty ]; then
    if [ "$(prompt_yes_no '  Already have a whisper model downloaded? [y/N] ' N)" = "Y" ]; then
      local input m
      while :; do
        read -r -p "  Absolute path to .bin model: " input </dev/tty || input=""
        if [ -z "$input" ]; then
          warn "No path entered — falling back to download"
          break
        fi
        m="$(expand_tilde "$input")"
        if [ -f "$m" ]; then
          VOICE_MODEL="$m"
          ok "Using existing model: $m"
          return
        fi
        warn "File not found: $m"
      done
    fi
  fi

  local target_dir="$INSTALL_DIR/models"
  local target="$target_dir/$DEFAULT_MODEL_NAME"
  mkdir -p "$target_dir"

  if [ -f "$target" ]; then
    ok "Model already present: $target"
    VOICE_MODEL="$target"
    return
  fi

  info "Downloading $DEFAULT_MODEL_NAME (~142 MB) → $target"
  local tmp
  tmp="$(mktemp "${target}.XXXXXX")"
  if curl -fL --progress-bar "$DEFAULT_MODEL_URL" -o "$tmp"; then
    mv "$tmp" "$target"
    ok "Model downloaded"
    VOICE_MODEL="$target"
  else
    rm -f "$tmp"
    warn "Model download failed — voice transcription will stay disabled until WHISPER_MODEL_PATH is set."
  fi
}

setup_voice() {
  if [ -f "$CONFIG_DIR/.env" ]; then
    return
  fi

  local ffmpeg_path whisper_path
  ffmpeg_path="$(command -v ffmpeg 2>/dev/null || true)"
  whisper_path="$(command -v whisper-cli 2>/dev/null || true)"

  if [ -z "$ffmpeg_path" ] || [ -z "$whisper_path" ]; then
    info "Voice transcription deps not on PATH — skipping voice setup"
    [ -z "$ffmpeg_path" ]  && warn "  ffmpeg not found"
    [ -z "$whisper_path" ] && warn "  whisper-cli not found"
    warn "Install both, then run 'maestro-discord-ctl update' to enable transcription."
    return
  fi

  ok "Found ffmpeg: $ffmpeg_path"
  ok "Found whisper-cli: $whisper_path"

  local enable=0
  if [ "${MAESTRO_DISCORD_VOICE:-}" = "1" ]; then
    enable=1
  elif [ "${MAESTRO_DISCORD_VOICE:-}" = "0" ]; then
    enable=0
  elif [ -r /dev/tty ]; then
    info "Configure voice transcription"
    [ "$(prompt_yes_no '  Enable voice transcription? [Y/n] ' Y)" = "Y" ] && enable=1
  else
    info "Non-interactive shell — skipping voice setup (set MAESTRO_DISCORD_VOICE=1 to opt in)"
  fi

  [ "$enable" -eq 1 ] || return

  VOICE_FFMPEG="$ffmpeg_path"
  VOICE_WHISPER="$whisper_path"
  setup_voice_choose_model
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
    -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" \
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
  trap 'rollback_install' ERR
  install_release "$tag" "$tarball"
  install_deps
  trap - ERR
  install_ctl
  setup_voice
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
