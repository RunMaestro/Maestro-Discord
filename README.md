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

| Command | Description |
|---|---|
| `/health` | Verify Maestro CLI is installed and working |
| `/agents list` | Show all available agents |
| `/agents new <agent-id>` | Create a dedicated channel for an agent |
| `/agents disconnect` | (Run inside an agent channel) Remove and delete the channel |
| `/agents readonly on\|off` | Toggle read-only mode for the current agent channel |

## How it works

- `/agents list` reads running agents from Maestro.
- `/agents new` creates a text channel under the **Maestro Agents** category.
- Mention flow: in a registered agent channel, user mentions the bot (either `@bot` user mention or `@BotRole` role mention) and the bot creates a dedicated thread bound to that user. The triggering message is forwarded to the agent so the user gets an immediate response.
- Only the bound owner can trigger agent responses inside that thread. Messages from other users are silently ignored.
- `/session new` also creates an owner-bound thread for the command invoker.
- Messages in registered, owner-authorized threads are queued and forwarded to `maestro-cli`.
- The bot adds a ⏳ reaction while waiting, shows typing, and splits long replies.
- After each response, it posts a small usage footer with tokens, cost, and context.

## Maestro-to-Discord Messaging

Maestro agents can send messages to Discord using the `maestro-discord` CLI.
The bot exposes a local HTTP API that the CLI calls.

### Setup

The API server starts automatically with the bot on port 3457 (configurable via `API_PORT` in `.env`).

### Usage

```bash
# Send a message to an agent's Discord channel
maestro-discord --agent <agent-id> --message "Hello from Maestro"

# Send with @mention (pings the user set in DISCORD_MENTION_USER_ID)
maestro-discord --agent <agent-id> --message "Build complete!" --mention

# Use a custom port
maestro-discord --agent <agent-id> --message "Hello" --port 4000
```

If the agent doesn't have a connected Discord channel yet, one is created automatically.

### Health check

```bash
curl http://127.0.0.1:3457/api/health
```

Returns `{"success":true,"status":"ok","uptime":123.45}` when the bot is connected.

### API error codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Missing/invalid fields or malformed JSON |
| `404` | Agent not found in Maestro |
| `413` | Request body exceeds 1 MB |
| `415` | Wrong Content-Type (must be `application/json`) |
| `429` | Rate limited by Discord after 3 retries |
| `503` | Bot not connected to Discord |

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
