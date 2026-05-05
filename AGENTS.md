# Agent Guide

This repo is **Maestro Bridge** — a chat-platform-to-Maestro bridge built around a provider-agnostic kernel. Discord is the first provider; Slack/Teams plug in alongside it without touching the kernel. CLAUDE.md is a symlink to this file.

## Development workflow

- Install deps: `npm install`
- Run in dev: `npm run dev`
- Deploy slash commands (Discord): `npm run deploy-commands`
- Build: `npm run build`
- Production: `npm run build` then `npm start`
- Run tests: `npm test`

## Project layout

### Core (provider-agnostic kernel)

- `src/core/types.ts` — `BridgeProvider`, `IncomingMessage`, `ConversationRecord`, `ChannelTarget`, `OutgoingMessage`, `KernelContext`
- `src/core/queue.ts` — per-conversation FIFO message queue, typed on `IncomingMessage`
- `src/core/api.ts` — internal HTTP API server (`POST /api/send`, `GET /api/health`)
- `src/core/providers.ts` — provider registry (loads adapters by name from `ENABLED_PROVIDERS`)
- `src/core/db/index.ts` — SQLite registry with composite PK `(provider, channel_id)`
- `src/core/db/migrations.ts` — idempotent schema upgrades
- `src/core/maestro.ts` — `maestro-cli` wrapper
- `src/core/transcription.ts` — generic ffmpeg + whisper pipeline
- `src/core/attachments.ts` — provider-agnostic attachment download
- `src/core/logger.ts`, `src/core/config.ts`, `src/core/splitMessage.ts`

### Discord provider

- `src/providers/discord/adapter.ts` — implements `BridgeProvider`
- `src/providers/discord/messageCreate.ts` — Discord message → `IncomingMessage`
- `src/providers/discord/voice.ts` — Discord voice-message detection
- `src/providers/discord/commands/` — slash command handlers
- `src/providers/discord/deploy.ts` — registers slash commands with Discord API
- `src/providers/discord/channelsDb.ts` — `provider='discord'`-bound wrapper around the core channel registry
- `src/providers/discord/threadsDb.ts` — Discord-only thread registry (`discord_agent_threads`)
- `src/providers/discord/embed.ts` — Discord embed limit helpers
- `src/providers/discord/config.ts` — `DISCORD_*` env loading

### CLI

- `src/cli/maestro-bridge.ts` — verb dispatcher (`send`, `notify`, `status`)
- `src/cli/lib.ts` — shared HTTP client for `/api/send`
- `src/cli/verbs/` — individual verb implementations

The `maestro-discord` binary is registered as an alias of `maestro-bridge` for back-compat.

### Entry point

- `src/index.ts` — kernel orchestrator: builds providers, starts each with kernel ctx, starts the HTTP API, wires graceful shutdown

## HTTP API

Local API on `127.0.0.1:API_PORT` (default 3457). See [docs/api.md](docs/api.md) for endpoints, request format, and error codes.

## Adding a new provider

1. Create `src/providers/<name>/adapter.ts` exporting a class that implements `BridgeProvider` from `src/core/types.ts`.
2. Register the provider name in `src/core/providers.ts` (`loadProvider` switch).
3. Add a section to `.env.example` for the provider's credentials.
4. Provider modules own their own DB tables, command surface, and event handling; the kernel only sees `IncomingMessage` and calls back via `BridgeProvider.send` / `react` / `sendTyping`.

## Project notes

- Source lives in `src/` and is TypeScript.
- Env vars are documented in `.env.example`. Keep it in sync with `.env` usage.
- `ENABLED_PROVIDERS` is a comma-separated list (default `discord`); each provider validates its own creds at `start()`, so a disabled provider doesn't fail the bridge on missing env.
- Tests use Node.js built-in test runner (`node --test`), not Jest/Vitest.
- The Discord adapter uses `isSendable()` type guards for channel safety.

## Expectations for changes

- Follow existing patterns in `src/core/` and `src/providers/discord/` before introducing new abstractions.
- Provider-specific code (Discord types, slash commands, threads) lives in `src/providers/discord/` — keep `src/core/` free of `discord.js` imports.
- Keep changes minimal and focused.
- Update docs when behavior or setup changes.
