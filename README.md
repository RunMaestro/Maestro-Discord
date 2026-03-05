# Discord Maestro Bot

[![Made with Maestro](https://raw.githubusercontent.com/RunMaestro/Maestro/main/docs/assets/made-with-maestro.svg)](https://github.com/RunMaestro/Maestro)

A Discord bot that connects your server to [Maestro](https://maestro.sh) AI agents through `maestro-cli`.

## What it does

- Creates dedicated agent channels in Discord
- Forwards messages to Maestro agents and posts responses back
- Queues messages per-channel for orderly processing

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

## Slash commands

| Command | Description |
|---|---|
| `/health` | Verify Maestro CLI is installed and working |
| `/agents list` | Show all available agents |
| `/agents new <agent-id>` | Create a dedicated channel for an agent |
| `/agents disconnect` | (Run inside an agent channel) Remove and delete the channel |
| `/session` | Show session info for the current agent channel |

When an agent channel is created, it spins up a dedicated thread for that agent. Type messages inside the thread. Messages are relayed to the agent and the response is posted back. A ⏳ reaction indicates a message is waiting in the queue.

## Discord bot permissions

- Read Messages / View Channels
- Send Messages
- Manage Channels
- Add Reactions
- Read Message History

## Security note

Only invite this bot to private servers you trust. There is currently no security mechanism to restrict access to agent channels.

## Troubleshooting

- If `/health` fails, ensure `maestro-cli` is on your PATH and you are logged in.
- If commands don’t appear, re-run `npm run deploy-commands` after updating your bot or application settings.
