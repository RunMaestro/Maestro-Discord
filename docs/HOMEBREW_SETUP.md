# Maestro Discord - Homebrew Service Setup

This guide covers setting up Maestro Discord as a Homebrew service that starts automatically when your macOS computer boots.

## Prerequisites

- macOS with Homebrew installed ([install Homebrew](https://brew.sh))
- Discord bot token and application ID
- Maestro CLI installed and configured

## Quick Start

```bash
# Run the automated setup script
./scripts/setup-homebrew-service.sh
```

The setup script will:
1. Create `~/.config/maestro-discord.env` with your configuration
2. Build the project
3. Deploy Discord slash commands
4. Install the Homebrew formula and service

## Manual Setup (if not using the script)

### 1. Configure Environment Variables

Create `~/.config/maestro-discord.env` with your Discord bot configuration:

```bash
export DISCORD_BOT_TOKEN=<your_bot_token>
export DISCORD_CLIENT_ID=<your_client_id>
export DISCORD_GUILD_ID=<your_guild_id>
export DISCORD_ALLOWED_USER_IDS=<optional_user_ids>
export API_PORT=3457
export FFMPEG_PATH='/opt/homebrew/bin/ffmpeg'
export WHISPER_CLI_PATH='/opt/homebrew/bin/whisper-cli'
export WHISPER_MODEL_PATH='./models/ggml-small.en.bin'
```

### 2. Build the Project

```bash
npm run build
```

### 3. Deploy Discord Commands

```bash
source ~/.config/maestro-discord.env
npm run deploy-commands
```

### 4. Install the Homebrew Formula

```bash
# Tap this repository as a Homebrew tap
brew tap RunMaestro/maestro-discord https://github.com/RunMaestro/Maestro-Discord

# Install the formula
brew install maestro-discord
```

### 5. Start the Service

```bash
brew services start maestro-discord
```

## Managing the Service

### Check Status

```bash
brew services list
```

### Start the Service

```bash
brew services start maestro-discord
```

### Stop the Service

```bash
brew services stop maestro-discord
```

### Restart the Service

```bash
brew services restart maestro-discord
```

### View Logs

The service logs are stored in `/opt/homebrew/var/log/`

```bash
# View output log
tail -f /opt/homebrew/var/log/maestro-discord.log

# View error log
tail -f /opt/homebrew/var/log/maestro-discord-error.log

# View both logs
tail -f /opt/homebrew/var/log/maestro-discord*.log
```

## Updating Environment Variables

1. Edit `~/.config/maestro-discord.env`:
   ```bash
   nano ~/.config/maestro-discord.env
   ```

2. Restart the service:
   ```bash
   brew services restart maestro-discord
   ```

## Uninstalling

```bash
# Stop the service
brew services stop maestro-discord

# Uninstall the formula
brew uninstall maestro-discord

# Remove the tap (optional)
brew untap RunMaestro/maestro-discord
```

## Troubleshooting

### Service won't start

1. Check the logs:
   ```bash
   tail -f /opt/homebrew/var/log/maestro-discord/error.log
   ```

2. Verify environment variables are set:
   ```bash
   cat ~/.config/maestro-discord.env
   ```

3. Test running the bot manually:
   ```bash
   source ~/.config/maestro-discord.env
   npm start
   ```

### Logs show permission errors

Ensure the log directory has correct permissions:

```bash
mkdir -p /opt/homebrew/var/log/maestro-discord
chmod 755 /opt/homebrew/var/log/maestro-discord
```

### Bot not responding to commands

1. Verify Discord commands were deployed:
   ```bash
   source ~/.config/maestro-discord.env
   npm run deploy-commands
   ```

2. Check that the bot has correct permissions in your Discord server
3. Ensure `DISCORD_GUILD_ID` matches your server

### Service restarts repeatedly

This usually indicates the bot is crashing. Check the error log:

```bash
tail -100 /opt/homebrew/var/log/maestro-discord/error.log
```

Common causes:
- Invalid Discord bot token
- Database connection issues
- Missing environment variables

## Differences from `run.sh`

| Feature | `run.sh` | Homebrew Service |
|---------|---------|-----------------|
| Manual start | ✓ | ✗ |
| Auto-start on boot | ✗ | ✓ |
| Background daemon | ✗ | ✓ |
| Restart on crash | ✗ | ✓ |
| Log management | Manual | Automatic |
| Environment config | Local file | `~/.config/maestro-discord.env` |

## Related Files

- Formula: `Formula/maestro-discord.rb`
- Launchd template: `launchd/com.maestro.discord.plist`
- Setup script: `scripts/setup-homebrew-service.sh`
- Environment template: `.env.example`
