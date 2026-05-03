# Discord Maestro Bot

[![Made with Maestro](https://raw.githubusercontent.com/RunMaestro/Maestro/main/docs/assets/made-with-maestro.svg)](https://github.com/RunMaestro/Maestro)

A Discord bot that connects your server to [Maestro](https://runmaestro.ai) AI agents through `maestro-cli`.

## Features

- Creates dedicated Discord channels for Maestro agents
- Per-user session threads — start one with `/session new` or by @mentioning the bot in an agent channel
- Queues messages per channel for orderly processing
- Streams agent replies back into Discord, including usage stats

## Prerequisites

- Linux or macOS
- Node.js 22+
- A Discord application + bot token
- [Maestro CLI](https://docs.runmaestro.ai/cli) on your `PATH`

## Install (production)

One command — downloads the latest tagged release, installs dependencies, prompts for Discord credentials, and registers a user-level service.

```bash
curl -fsSL https://raw.githubusercontent.com/RunMaestro/Maestro-Discord/main/install.sh | bash
```

After install:

```bash
maestro-discord-ctl start     # boot the bot
maestro-discord-ctl logs      # tail logs
maestro-discord-ctl status    # service status
maestro-discord-ctl update    # upgrade to latest release (preserves config)
maestro-discord-ctl uninstall # remove install + service files
```

Defaults:

| Path                          | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `~/.local/share/maestro-discord/` | Installed bot (built JS + dependencies) |
| `~/.config/maestro-discord/.env`  | Configuration (preserved across updates) |
| `~/.local/bin/maestro-discord-ctl` | Service control wrapper             |
| systemd user / launchd agent  | Auto-start unit                          |

Override any of these with `MAESTRO_DISCORD_HOME`, `XDG_CONFIG_HOME`, or `MAESTRO_DISCORD_BIN_DIR`. Pin a specific version with `MAESTRO_DISCORD_VERSION=v1.0.0`.

## Install (development from source)

1. Clone and install:

```bash
git clone https://github.com/RunMaestro/Maestro-Discord.git
cd Maestro-Discord
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Set these values in `.env`:

```
DISCORD_BOT_TOKEN=   # Bot token from Discord Developer Portal
DISCORD_CLIENT_ID=   # Application ID from Discord Developer Portal
DISCORD_GUILD_ID=    # Your server's ID (right-click server → Copy ID)
DISCORD_ALLOWED_USER_IDS=123,456  # Optional: comma-separated user IDs allowed to run slash commands
API_PORT=3457                     # Optional: port for internal API (default 3457)
DISCORD_MENTION_USER_ID=          # Optional: Discord user ID to @mention when --mention is used
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg                # Optional: path to ffmpeg binary
WHISPER_CLI_PATH=/opt/homebrew/bin/whisper-cli      # Optional: path to whisper-cli binary
WHISPER_MODEL_PATH=models/ggml-base.en.bin          # Optional: path to whisper.cpp model
```

3. Deploy slash commands:

```bash
npm run deploy-commands
```

4. Start the bot (dev mode):

```bash
npm run dev
```

### Install maestro-discord CLI (dev)

The `maestro-discord` CLI lets your Maestro agents reach out to you on Discord — for example, to ping you when a long-running task finishes. See [docs/api.md](docs/api.md) for usage.

After building the project (`npm run build`), create a shell wrapper.

macOS / Linux:

```bash
printf '#!/bin/bash\nnode "%s/dist/cli/maestro-discord.js" "$@"\n' "$(pwd)" | sudo tee /usr/local/bin/maestro-discord && sudo chmod +x /usr/local/bin/maestro-discord
```

Windows (PowerShell) — writes the wrapper to `%USERPROFILE%\bin` and adds it to your user `PATH`:

```powershell
$repoPath = (Get-Location).Path
$binDir = "$env:USERPROFILE\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
@"
@echo off
node "$repoPath\dist\cli\maestro-discord.js" %*
"@ | Out-File -FilePath "$binDir\maestro-discord.cmd" -Encoding ASCII

# Add $binDir to user PATH if it isn't already (restart your shell afterwards)
$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not ($userPath -split ';' -contains $binDir)) {
    [Environment]::SetEnvironmentVariable('PATH', "$binDir;$userPath", 'User')
}
```

Or use `npm link`:

```bash
npm link
```

## Voice Transcription (optional)

When a user posts a Discord **voice message** (the mic-button recording, not an arbitrary `.ogg` upload) in a session thread, the bot transcribes the audio with `whisper.cpp` and forwards the transcript to the agent. The original `.ogg` is **not** sent to the agent — only the transcribed text — and a `🎧` reaction marks the message while transcription runs.

If the dependencies below are missing, the bot starts normally and voice messages are forwarded as plain attachments with a one-line advisory; no other functionality is affected.

**Behavior notes:**

- Only messages flagged `IsVoiceMessage` by Discord are transcribed. Bare `.ogg` file uploads are routed through the normal attachment path.
- Voice attachments larger than 25 MB are rejected up-front (the per-channel queue would otherwise be blocked for several minutes of ffmpeg/whisper work).
- Mixed messages (voice + image/file) are supported: the transcription is forwarded as text and the non-voice attachments are downloaded for the agent as usual.

### Installation

1. Install [ffmpeg](https://ffmpeg.org/) and [whisper-cli](https://github.com/ggerganov/whisper.cpp). On macOS via Homebrew:

```bash
brew install ffmpeg whisper-cli
```

On Linux / Windows, install ffmpeg via your package manager and build `whisper-cli` from the [whisper.cpp](https://github.com/ggerganov/whisper.cpp) repo, or use [Linuxbrew](https://docs.brew.sh/Homebrew-on-Linux).

2. Download a whisper model. The default `WHISPER_MODEL_PATH=models/ggml-base.en.bin` is **relative to the bot's working directory**, so place it accordingly:

```bash
# Production install (curl-to-bash):
mkdir -p ~/.local/share/maestro-discord/models
curl -L -o ~/.local/share/maestro-discord/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# Or, for development from source — run from the repo root:
mkdir -p ./models
curl -L -o models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Or set `WHISPER_MODEL_PATH` to an absolute path in `.env` to keep the model anywhere you like.

3. **Use absolute paths in `.env` for `FFMPEG_PATH` and `WHISPER_CLI_PATH` when running under systemd / launchd.** The service units load `.env` via `EnvironmentFile=` (Linux) or an explicit `set -a; . .env` (macOS) and **do not inherit your login shell's `PATH`** — so bare names like `ffmpeg` or `whisper-cli` only resolve if the binaries live in `/usr/bin` or `/usr/local/bin`. Linuxbrew (`/home/linuxbrew/.linuxbrew/bin`) and other custom install locations require absolute paths:

```bash
# find them with:
which ffmpeg
which whisper-cli

# then set in ~/.config/maestro-discord/.env (production) or .env (source):
FFMPEG_PATH=/home/linuxbrew/.linuxbrew/bin/ffmpeg          # Linuxbrew
WHISPER_CLI_PATH=/home/linuxbrew/.linuxbrew/bin/whisper-cli
# or on macOS Homebrew:
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
WHISPER_CLI_PATH=/opt/homebrew/bin/whisper-cli
WHISPER_MODEL_PATH=/home/you/.local/share/maestro-discord/models/ggml-base.en.bin
```

The bot probes these at startup; any missing piece is logged as `⚠️ Transcription disabled: …` and transcription is skipped at runtime. After editing `.env`, restart with `maestro-discord-ctl restart`.

## Tests

```bash
npm test
```

Coverage:

```bash
npm run build && node --test --experimental-test-coverage dist/__tests__/**/*.test.js
```

## Slash commands

| Command                    | Description                                                   |
| -------------------------- | ------------------------------------------------------------- |
| `/health`                  | Verify Maestro CLI is installed and working                   |
| `/agents list`             | Show all available agents                                     |
| `/agents new <agent>`      | Create a dedicated channel for an agent (autocomplete)        |
| `/agents disconnect`       | (Run inside an agent channel) Remove and delete the channel   |
| `/agents readonly on\|off` | Toggle read-only mode for the current agent channel           |
| `/session new`             | Create a new owner-bound thread for the current agent channel |
| `/session list`            | List session threads for the current agent channel            |

## How it works

Mention the bot or run `/session new` in an agent channel to create a thread, then chat — messages are queued and forwarded to the agent via `maestro-cli`. See [docs/architecture.md](docs/architecture.md) for the full message flow, thread ownership model, and project layout.

## Maestro-to-Discord Messaging

Agents can push messages to Discord via the `maestro-discord` CLI / HTTP API. See [docs/api.md](docs/api.md) for usage, endpoints, and error codes.

## Data storage

The bot stores channel ↔ agent mappings in a local SQLite database at `maestro-bot.db`.
Delete this file to reset all channel bindings.

## Discord bot permissions

Invite the bot with both `bot` and `applications.commands` scopes:

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot+applications.commands&permissions=309237681232
```

This grants the following permissions:

- Manage Channels — create and delete agent channels (`/agents new`, `/agents disconnect`)
- View Channels
- Send Messages
- Attach Files — re-upload user attachments when forwarding to a session thread
- Add Reactions — `⏳`/`🎧` queue and transcription indicators
- Create Public Threads — owner-bound session threads
- Send Messages in Threads

Then enable **Message Content Intent** under Privileged Gateway Intents at:

```text
https://discord.com/developers/applications/<DISCORD_CLIENT_ID>/bot
```

Without this the bot will fail to connect with a "Used disallowed intents" error.

## Security

- Slash command access can be limited with `DISCORD_ALLOWED_USER_IDS`.
- Mention-created and `/session new` threads are bound to a single owner.
- In bound threads, non-owner messages are ignored without bot replies.

## Troubleshooting

- If `/health` fails, ensure `maestro-cli` is on your `PATH`.
- If commands don’t appear, re-run `npm run deploy-commands` after updating your bot or application settings.
