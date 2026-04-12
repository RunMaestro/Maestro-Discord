# Maestro-to-Discord Messaging API

Maestro agents can send messages to Discord using the `maestro-discord` CLI.
The bot exposes a local HTTP API that the CLI calls.

## Setup

The API server starts automatically with the bot on port 3457 (configurable via `API_PORT` in `.env`).

## CLI usage

```bash
# Send a message to an agent's Discord channel
maestro-discord --agent <agent-id> --message "Hello from Maestro"

# Send with @mention (pings the user set in DISCORD_MENTION_USER_ID)
maestro-discord --agent <agent-id> --message "Build complete!" --mention

# Use a custom port
maestro-discord --agent <agent-id> --message "Hello" --port 4000
```

If the agent doesn't have a connected Discord channel yet, one is created automatically.

## Health check

```bash
curl http://127.0.0.1:3457/api/health
```

Returns `{"success":true,"status":"ok","uptime":123.45}` when the bot is connected.

## API endpoints

### POST /api/send

Sends a message to an agent's Discord channel (auto-creates if needed).

Request: `Content-Type: application/json`

```json
{ "agentId": "string", "message": "string", "mention": false }
```

### GET /api/health

Returns bot status: `{"success":true,"status":"ok","uptime":123.45}`

Returns `503` with `"status":"not_ready"` if the bot is disconnected.

## Error codes

| Status | Meaning                                         |
| ------ | ----------------------------------------------- |
| `200`  | Success                                         |
| `400`  | Missing/invalid fields or malformed JSON        |
| `404`  | Agent not found in Maestro                      |
| `405`  | Method not allowed                              |
| `413`  | Request body exceeds 1 MB                       |
| `415`  | Wrong Content-Type (must be `application/json`) |
| `429`  | Rate limited by Discord after 3 retries         |
| `500`  | Internal server error                           |
| `503`  | Bot not connected to Discord                    |
