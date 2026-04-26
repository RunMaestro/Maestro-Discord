#!/bin/bash
# Setup script for Maestro Discord Homebrew service

set -e

echo "Maestro Discord - Homebrew Service Setup"
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
  echo "Error: Homebrew is not installed."
  echo "Install Homebrew from https://brew.sh and try again."
  exit 1
fi

# Check if .env file exists, if not create it from .env.example
ENV_FILE="$HOME/.config/maestro-discord.env"
mkdir -p "$(dirname "$ENV_FILE")"

if [ ! -f "$ENV_FILE" ]; then
  echo "Creating $ENV_FILE..."

  if [ -f .env.example ]; then
    cp .env.example "$ENV_FILE"
    echo "Created $ENV_FILE from .env.example"
  else
    echo "Error: .env.example not found"
    exit 1
  fi

  echo "Please edit $ENV_FILE with your Discord bot configuration:"
  echo "  - DISCORD_BOT_TOKEN"
  echo "  - DISCORD_CLIENT_ID"
  echo "  - DISCORD_GUILD_ID"
  echo "  - DISCORD_ALLOWED_USER_IDS (optional)"
  echo ""
  read -p "Press enter once you've configured the environment variables..."
else
  echo "Found existing $ENV_FILE"
fi

# Build the project
echo ""
echo "Building Maestro Discord..."
npm run build

# Deploy Discord commands
echo ""
echo "Deploying Discord slash commands..."
set -a
source "$ENV_FILE"
set +a
npm run deploy-commands

# Install or update Homebrew formula
echo ""
echo "Installing Maestro Discord via Homebrew..."
brew tap RunMaestro/maestro-discord . 2>/dev/null || true
brew install maestro-discord

# Create log directory
mkdir -p /opt/homebrew/var/log/maestro-discord

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Start the service: brew services start maestro-discord"
echo "2. Check status: brew services list"
echo "3. View logs: tail -f /opt/homebrew/var/log/maestro-discord/output.log"
echo "4. Stop the service: brew services stop maestro-discord"
echo ""
echo "To update environment variables later, edit:"
echo "  $ENV_FILE"
echo ""
echo "Then restart the service:"
echo "  brew services restart maestro-discord"
