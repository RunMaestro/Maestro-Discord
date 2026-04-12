# Discord Maestro Bot

[![Made with Maestro](https://raw.githubusercontent.com/RunMaestro/Maestro/main/docs/assets/made-with-maestro.svg)](https://github.com/RunMaestro/Maestro)

A Discord bot that connects your server to Maestro AI agents through `maestro-cli`.

## Features

- Creates dedicated Discord channels for Maestro agents
- Queues messages per channel for orderly processing
- Streams agent replies back into Discord, including usage stats

## Prerequisites

- Node.js 18+
- A Discord application + bot token
- Maestro CLI installed and authenticated

CLI docs: https://docs.runmaestro.ai/

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
DISCORD_BOT_TOKEN=   # Bot token from Discord Developer Portal
DISCORD_CLIENT_ID=   # Application ID from Discord Developer Portal
DISCORD_GUILD_ID=    # Your server's ID (right-click server → Copy ID)
DISCORD_ALLOWED_USER_IDS=123,456  # Optional: comma-separated user IDs allowed to run slash commands
API_PORT=3457                     # Optional: port for internal API (default 3457)
DISCORD_MENTION_USER_ID=          # Optional: Discord user ID to @mention when --mention is used
```

3. Deploy slash commands:

```bash
npm run deploy-commands
```

4. Start the bot (dev mode):

```bash
npm run dev
```

## Production run

```bash
npm run build
npm start
```

## Tests

```bash
node --test --import tsx
```

Coverage:

```bash
node --test --experimental-test-coverage --import tsx
```

## Slash commands

| Command                    | Description                                                   |
| -------------------------- | ------------------------------------------------------------- |
| `/health`                  | Verify Maestro CLI is installed and working                   |
| `/agents list`             | Show all available agents                                     |
| `/agents new <agent-id>`   | Create a dedicated channel for an agent                       |
| `/agents disconnect`       | (Run inside an agent channel) Remove and delete the channel   |
| `/agents readonly on\|off` | Toggle read-only mode for the current agent channel           |
| `/session new`             | Create a new owner-bound thread for the current agent channel |
| `/session list`            | List session threads for the current agent channel            |

## How it works

Mention the bot in an agent channel to create a thread, then chat — messages are queued and forwarded to the agent via `maestro-cli`. See [docs/architecture.md](docs/architecture.md) for the full message flow, thread ownership model, and project layout.

## Maestro-to-Discord Messaging

Agents can push messages to Discord via the `maestro-discord` CLI / HTTP API. See [docs/api.md](docs/api.md) for usage, endpoints, and error codes.

## Data storage

The bot stores channel ↔ agent mappings in a local SQLite database at `maestro-bot.db`.
Delete this file to reset all channel bindings.

## Discord bot permissions

Invite the bot with both `bot` and `applications.commands` scopes:

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot+applications.commands&permissions=11344
```

This grants the following permissions:

- Manage Channels
- Add Reactions
- View Channels
- Send Messages
- Manage Messages

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

- If `/health` fails, ensure `maestro-cli` is on your PATH and you are logged in.
- If commands don’t appear, re-run `npm run deploy-commands` after updating your bot or application settings.
