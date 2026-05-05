# Maestro Bridge

[![Made with Maestro](https://raw.githubusercontent.com/RunMaestro/Maestro/main/docs/assets/made-with-maestro.svg)](https://github.com/RunMaestro/Maestro)

**Maestro Bridge** connects chat platforms to [Maestro](https://runmaestro.ai) AI agents through `maestro-cli`. Discord ships in the box; Slack, Teams, and others can be added by dropping in a provider adapter — the kernel is provider-agnostic.

> **Migrating from `discord-maestro`?** Same codebase, new name. The legacy `maestro-discord` binary is preserved as an alias and all `DISCORD_*` env vars work unchanged. See "Migration" below.

## Features

- Provider-pluggable kernel — Discord today, Slack/Teams next
- Creates dedicated channels for Maestro agents
- Per-user session threads (`/session new` or by mentioning the bot)
- Per-conversation FIFO queue with typing/reaction indicators
- Streams agent replies back into chat with usage stats
- Voice transcription pipeline (whisper.cpp) for Discord voice messages

## Prerequisites

- Node.js 18+
- A Discord application + bot token (if running the Discord provider)
- [Maestro CLI](https://docs.runmaestro.ai/cli) on your `PATH`

### Install the `maestro-bridge` CLI

The `maestro-bridge` CLI lets your Maestro agents reach out to chat — for example, to ping you when a long-running task finishes. See [docs/api.md](docs/api.md) for usage.

After building (`npm run build`), create a shell wrapper.

macOS / Linux:

```bash
printf '#!/bin/bash\nnode "%s/dist/cli/maestro-bridge.js" "$@"\n' "$(pwd)" | sudo tee /usr/local/bin/maestro-bridge && sudo chmod +x /usr/local/bin/maestro-bridge
```

Windows (PowerShell) — writes the wrapper to `%USERPROFILE%\bin` and adds it to your user `PATH`:

```powershell
$repoPath = (Get-Location).Path
$binDir = "$env:USERPROFILE\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
@"
@echo off
node "$repoPath\dist\cli\maestro-bridge.js" %*
"@ | Out-File -FilePath "$binDir\maestro-bridge.cmd" -Encoding ASCII

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

The legacy `maestro-discord` binary is registered as an alias to the same JS, so existing scripts keep working.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env
```

Set these values in `.env`:

```
# Core
ENABLED_PROVIDERS=discord    # comma-separated; default 'discord'
API_PORT=3457                # optional, default 3457

# Discord provider
DISCORD_BOT_TOKEN=           # Bot token from Discord Developer Portal
DISCORD_CLIENT_ID=           # Application ID from Discord Developer Portal
DISCORD_GUILD_ID=            # Your server's ID (right-click server → Copy ID)
DISCORD_ALLOWED_USER_IDS=123,456   # Optional: comma-separated allowed user IDs
DISCORD_MENTION_USER_ID=     # Optional: user ID to @mention when --mention is used

# Voice transcription (optional)
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
WHISPER_CLI_PATH=/opt/homebrew/bin/whisper-cli
WHISPER_MODEL_PATH=models/ggml-base.en.bin
```

3. Deploy slash commands (Discord):

```bash
npm run deploy-commands
```

4. Start the bridge (dev mode):

```bash
npm run dev
```

## Voice Transcription (optional)

When a user posts a Discord **voice message** (the mic-button recording, not an arbitrary `.ogg` upload) in a session thread, the bridge transcribes the audio with `whisper.cpp` and forwards the transcript to the agent. The original `.ogg` is **not** sent to the agent — only the transcribed text — and a `🎧` reaction marks the message while transcription runs.

If the dependencies below are missing, the bridge starts normally and voice messages are forwarded as plain attachments with a one-line advisory; no other functionality is affected.

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

2. Download a whisper model (skip if you already have one at the configured path):

```bash
mkdir -p ./models
curl -L -o models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

3. (Optional) Override the binary or model paths in `.env` if they're not on `PATH` or the default location:

```bash
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
WHISPER_CLI_PATH=/opt/homebrew/bin/whisper-cli
WHISPER_MODEL_PATH=models/ggml-base.en.bin
```

The bridge probes these at startup; any missing piece is logged as `⚠️ Transcription disabled: …` and transcription is skipped at runtime.

## Production run

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

Coverage:

```bash
npm run build && node --test --experimental-test-coverage dist/__tests__/**/*.test.js
```

## Slash commands (Discord)

| Command                    | Description                                                   |
| -------------------------- | ------------------------------------------------------------- |
| `/health`                  | Verify Maestro CLI is installed and working                   |
| `/agents list`             | Show all available agents                                     |
| `/agents new <agent>`      | Create a dedicated channel for an agent (autocomplete)        |
| `/agents show <agent>`     | Show an agent's stats and recent activity                     |
| `/agents disconnect`       | (Run inside an agent channel) Remove and delete the channel   |
| `/agents readonly on\|off` | Toggle read-only mode for the current agent channel           |
| `/session new`             | Create a new owner-bound thread for the current agent channel |
| `/session list`            | List session threads for the current agent channel            |
| `/playbook list`           | List playbooks (optionally filter by agent)                   |
| `/playbook show <id>`      | Show details for a playbook                                   |
| `/playbook run <id>`       | Run a playbook and post the completion summary in-channel     |
| `/auto-run start <doc>`    | Launch an Auto Run document for the current agent channel     |
| `/gist`                    | Publish the current agent's session transcript as a GitHub gist |
| `/notes synopsis`          | Post an AI-generated synopsis of recent activity              |
| `/notes history`           | Post a unified history feed across agents                     |

## How it works

Mention the bot or run `/session new` in an agent channel to create a thread, then chat — messages are queued and forwarded to the agent via `maestro-cli`. See [docs/architecture.md](docs/architecture.md) for the full message flow, the kernel/provider split, and how to add a new provider.

## Agent → chat messaging

Agents can push messages to chat via the `maestro-bridge` CLI / HTTP API. See [docs/api.md](docs/api.md) for usage, endpoints, and error codes.

## Migration from `discord-maestro`

This project was renamed from `discord-maestro` / `Maestro-Discord`. To smooth upgrades:

- The `maestro-discord` binary is preserved as an alias of `maestro-bridge`. Existing scripts that call `maestro-discord send …` keep working unchanged.
- All `DISCORD_*` env vars are unchanged. New optional `ENABLED_PROVIDERS` defaults to `discord`.
- The SQLite database upgrades automatically on first start: `agent_channels` gains a `provider` column (existing rows default to `discord`); `agent_threads` is renamed to `discord_agent_threads` with rows preserved. No manual migration needed.
- The HTTP `/api/send` endpoint accepts an optional `provider` field that defaults to `discord`; existing callers are unaffected.

## Data storage

The bridge stores channel ↔ agent mappings in a local SQLite database at `maestro-bot.db`.
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
