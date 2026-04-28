#!/usr/bin/env bash
# Service wrapper for the Maestro Discord bot.
# Subcommands: start | stop | restart | status | logs | deploy | update | uninstall | version

set -euo pipefail

INSTALL_DIR="${MAESTRO_DISCORD_HOME:-$HOME/.local/share/maestro-discord}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/maestro-discord"
BIN_DIR="${MAESTRO_DISCORD_BIN_DIR:-$HOME/.local/bin}"
REPO="${MAESTRO_DISCORD_REPO:-RunMaestro/Maestro-Discord}"
SERVICE_NAME="maestro-discord"
LAUNCHD_LABEL="sh.maestro.discord"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"

die() { printf '✗ %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

detect_os() {
  case "$(uname -s)" in
    Linux)  echo linux ;;
    Darwin) echo macos ;;
    *)      echo unsupported ;;
  esac
}

usage() {
  cat <<'EOF'
maestro-discord-ctl — control the Maestro Discord bot service.

Usage:
  maestro-discord-ctl <command>

Commands:
  start       Start the bot service
  stop        Stop the bot service
  restart     Restart the bot service
  status      Show service status
  logs        Tail service logs (Ctrl+C to stop)
  deploy      Deploy slash commands to Discord
  update      Reinstall the latest release (preserves config)
  uninstall   Remove the bot, service files, and CLI symlink
  version     Print installed version

Environment:
  MAESTRO_DISCORD_HOME    Override install dir  (default: ~/.local/share/maestro-discord)
  XDG_CONFIG_HOME         Config dir parent     (default: ~/.config)
EOF
}

require_install() {
  [ -d "$INSTALL_DIR" ] || die "Not installed at $INSTALL_DIR. Run install.sh first."
}

cmd_start() {
  require_install
  case "$(detect_os)" in
    linux)
      systemctl --user start "$SERVICE_NAME"
      info "Started $SERVICE_NAME (systemd user)"
      ;;
    macos)
      [ -f "$LAUNCHD_PLIST" ] || die "Plist not installed: $LAUNCHD_PLIST"
      launchctl load -w "$LAUNCHD_PLIST" 2>/dev/null || launchctl start "$LAUNCHD_LABEL"
      info "Started $LAUNCHD_LABEL (launchd)"
      ;;
    *) die "Unsupported OS for service management" ;;
  esac
}

cmd_stop() {
  case "$(detect_os)" in
    linux)
      systemctl --user stop "$SERVICE_NAME" || true
      info "Stopped $SERVICE_NAME"
      ;;
    macos)
      launchctl unload -w "$LAUNCHD_PLIST" 2>/dev/null || launchctl stop "$LAUNCHD_LABEL" || true
      info "Stopped $LAUNCHD_LABEL"
      ;;
    *) die "Unsupported OS for service management" ;;
  esac
}

cmd_restart() {
  cmd_stop || true
  cmd_start
}

cmd_status() {
  case "$(detect_os)" in
    linux) systemctl --user status "$SERVICE_NAME" --no-pager || true ;;
    macos) launchctl list | grep -F "$LAUNCHD_LABEL" || echo "(not loaded)" ;;
    *) die "Unsupported OS for service management" ;;
  esac
}

cmd_logs() {
  case "$(detect_os)" in
    linux) journalctl --user -u "$SERVICE_NAME" -f --no-pager ;;
    macos)
      local log_file="$INSTALL_DIR/logs/maestro-discord.log"
      mkdir -p "$INSTALL_DIR/logs"
      [ -f "$log_file" ] || touch "$log_file"
      tail -f "$log_file"
      ;;
    *) die "Unsupported OS for log tailing" ;;
  esac
}

cmd_deploy() {
  require_install
  [ -f "$INSTALL_DIR/.env" ] || die "Config missing: $INSTALL_DIR/.env"
  (cd "$INSTALL_DIR" && node dist/deploy-commands.js)
}

cmd_update() {
  info "Re-running installer to pull the latest release"
  curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/install.sh" | bash
}

cmd_uninstall() {
  read -r -p "Remove $INSTALL_DIR, service files, and CLI symlink? [y/N] " ans
  case "${ans:-n}" in
    y|Y|yes|YES) ;;
    *) info "Aborted"; exit 0 ;;
  esac
  cmd_stop || true
  case "$(detect_os)" in
    linux)
      systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true
      rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/${SERVICE_NAME}.service"
      systemctl --user daemon-reload || true
      systemctl --user reset-failed "$SERVICE_NAME" 2>/dev/null || true
      ;;
    macos) rm -f "$LAUNCHD_PLIST" ;;
  esac
  rm -rf "$INSTALL_DIR"
  rm -f "$BIN_DIR/maestro-discord-ctl"
  info "Uninstalled. Config preserved at $CONFIG_DIR (delete manually if desired)."
}

cmd_version() {
  if [ -f "$INSTALL_DIR/.version" ]; then
    cat "$INSTALL_DIR/.version"
  else
    die "No version file at $INSTALL_DIR/.version"
  fi
}

main() {
  local sub="${1:-}"
  case "$sub" in
    start)     cmd_start ;;
    stop)      cmd_stop ;;
    restart)   cmd_restart ;;
    status)    cmd_status ;;
    logs)      cmd_logs ;;
    deploy)    cmd_deploy ;;
    update)    cmd_update ;;
    uninstall) cmd_uninstall ;;
    version)   cmd_version ;;
    -h|--help|help|"") usage ;;
    *)         usage; exit 2 ;;
  esac
}

main "$@"
