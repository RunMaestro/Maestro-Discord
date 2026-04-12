# Architecture

## Message flow

1. `/agents list` reads running agents from Maestro.
2. `/agents new` creates a text channel under the **Maestro Agents** category.
3. Users mention the bot (`@bot` or `@BotRole`) in an agent channel to create a dedicated thread.
4. The triggering message is forwarded to the agent so the user gets an immediate response.
5. Messages in registered threads are queued and forwarded to `maestro-cli`.
6. The bot adds a ⏳ reaction while waiting, shows typing, and splits long replies.
7. After each response, the bot posts a usage footer with tokens, cost, and context.

## Thread ownership

Each thread is bound to the user who created it (via mention or `/session new`).

- Only the bound owner can trigger agent responses inside that thread.
- Messages from other users are silently ignored — no error reply, no forwarding.
- This prevents cross-talk and keeps each conversation scoped to one user.

## Read-only mode

`/agents readonly on` puts an agent channel into read-only mode. In this mode the bot relays messages from the agent (via the HTTP API) but does **not** forward user messages to the agent. Use `/agents readonly off` to resume normal two-way messaging.

## Project layout

| Path                            | Purpose                                                |
| ------------------------------- | ------------------------------------------------------ |
| `src/config.ts`                 | Environment variable loading                           |
| `src/db/index.ts`               | SQLite channel registry (`agent_channels` table)       |
| `src/services/maestro.ts`       | `maestro-cli` wrapper (listAgents, listSessions, send) |
| `src/services/queue.ts`         | Per-channel FIFO message queue                         |
| `src/services/logger.ts`        | Logging service                                        |
| `src/server.ts`                 | Internal HTTP API server                               |
| `src/commands/`                 | Slash command handlers                                 |
| `src/handlers/messageCreate.ts` | Discord message listener                               |
| `src/utils/splitMessage.ts`     | Splits long messages for Discord's 2000-char limit     |
| `src/deploy-commands.ts`        | Registers slash commands with Discord API              |
| `bin/maestro-discord.ts`        | CLI tool for agent-to-Discord messaging                |
