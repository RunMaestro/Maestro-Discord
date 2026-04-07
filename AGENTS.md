# Agent Guide

This repo is a Discord bot that bridges messages to Maestro agents via `maestro-cli`.
CLAUDE.md is a symlink to this file.

## Development workflow

- Install deps: `npm install`
- Run in dev: `npm run dev`
- Deploy slash commands: `npm run deploy-commands`
- Build: `npm run build`
- Production: `npm run build` then `npm start`
- Run tests: `npm test`

## Project layout

- `src/config.ts` — env var loading
- `src/db/index.ts` — SQLite channel registry (agent_channels table)
- `src/services/maestro.ts` — maestro-cli wrapper (listAgents, listSessions, send)
- `src/services/queue.ts` — per-channel FIFO message queue
- `src/services/logger.ts` — logging service
- `src/server.ts` — internal HTTP API server (POST /api/send, GET /api/health)
- `src/commands/` — slash command handlers (health, agents)
- `src/handlers/messageCreate.ts` — Discord message listener → queue
- `src/utils/splitMessage.ts` — splits long messages for Discord's 2000-char limit
- `src/deploy-commands.ts` — registers slash commands with Discord API
- `bin/maestro-discord.ts` — CLI tool for agent-to-Discord messaging

## HTTP API (src/server.ts)

The bot exposes a local HTTP API on `127.0.0.1:API_PORT` (default 3457).

### POST /api/send

Sends a message to an agent's Discord channel (auto-creates if needed).

Request: `Content-Type: application/json`
```json
{ "agentId": "string", "message": "string", "mention": false }
```

Responses:
- `200` — success: `{ "success": true, "channelId": "..." }`
- `400` — missing/invalid fields or malformed JSON
- `404` — agent not found in Maestro
- `413` — request body exceeds 1 MB
- `415` — wrong Content-Type (must be application/json)
- `429` — rate limited by Discord after 3 retries
- `503` — bot not connected to Discord

### GET /api/health

Returns bot status: `{ "success": true, "status": "ok", "uptime": 123.45 }`
Returns `503` with `"status": "not_ready"` if the bot is disconnected.

## Project notes

- Source lives in `src/` and is TypeScript.
- Env vars are defined in `.env.example`. Keep it in sync with `.env` usage.
- Avoid adding new runtime dependencies unless necessary.
- If you add new slash commands, update the deploy script and README.
- Tests use Node.js built-in test runner (`node --test`), not Jest/Vitest.
- The server uses `isSendable()` type guard for channel safety (not unsafe casts).

## Expectations for changes

- Follow existing patterns in `src/` before introducing new abstractions.
- Keep changes minimal and focused.
- Update docs when behavior or setup changes.
