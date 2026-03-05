# Discord Maestro Bot

A Discord bot that bridges your Discord server with [Maestro](https://maestro.sh) AI agents via the `maestro-cli`.

## Prerequisites

- Node.js 18+ (use nvm if preferred)
- [Maestro](https://maestro.sh) installed with `maestro-cli` available on PATH
- A Discord application and bot token (see Discord Developer docs)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your values:

```
DISCORD_BOT_TOKEN=   # Bot token from Discord Developer Portal
DISCORD_CLIENT_ID=   # Application ID from Discord Developer Portal
DISCORD_GUILD_ID=    # Your server's ID (right-click server → Copy ID)
```

3. Deploy slash commands to your server:

```bash
npm run deploy-commands
```

4. Start the bot:

```bash
npm run dev
```

## Commands

| Command | Description |
|---|---|
| `/health` | Verify Maestro CLI is installed and working |
| `/agents list` | Show all available agents |
| `/agents new <agent-id>` | Create a dedicated channel for an agent |
| `/agents disconnect` | (Run inside an agent channel) Remove and delete the channel |

Once an agent channel is created, type messages in it — they are relayed to the agent and the response is posted back. Messages are queued per-channel and processed one at a time. A ⏳ reaction indicates a message is waiting in the queue.

## Bot Permissions Required

- Read Messages / View Channels
- Send Messages
- Manage Channels (to create/delete agent channels)
- Add Reactions
- Read Message History
