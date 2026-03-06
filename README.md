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

## How it works

- `/agents list` reads running agents from Maestro.
- `/agents new` creates a text channel under the **Maestro Agents** category.
- Messages in agent channels are queued and forwarded to `maestro-cli`.
- The bot adds a ⏳ reaction while waiting, shows typing, and splits long replies.
- After each response, it posts a small usage footer with tokens, cost, and context.

## Data storage

The bot stores channel ↔ agent mappings in a local SQLite database at `maestro-bot.db`.
Delete this file to reset all channel bindings.

## Discord bot permissions

- Read Messages / View Channels
- Send Messages
- Manage Channels
- Add Reactions
- Read Message History

## Security note

Only invite this bot to private servers you trust. There is currently no access control
beyond Discord permissions.

## Troubleshooting

- If `/health` fails, ensure `maestro-cli` is on your PATH and you are logged in.
- If commands don’t appear, re-run `npm run deploy-commands` after updating your bot or application settings.
