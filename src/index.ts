import { Client, GatewayIntentBits, Interaction } from 'discord.js';
import { config } from './config';
import * as health from './commands/health';
import * as agents from './commands/agents';
import * as session from './commands/session';
import './db'; // ensure DB is initialized on startup
import { handleMessageCreate } from './handlers/messageCreate';

const commands = new Map([
  [health.data.name, health],
  [agents.data.name, agents],
  [session.data.name, session],
]);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = commands.get(interaction.commandName) as { autocomplete?: (i: typeof interaction) => Promise<void> };
    if (cmd?.autocomplete) {
      try {
        await cmd.autocomplete(interaction);
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (
    config.allowedUserIds.length > 0 &&
    !config.allowedUserIds.includes(interaction.user.id)
  ) {
    await interaction.reply({
      content: '❌ You are not authorized to use this bot.',
      ephemeral: true,
    });
    return;
  }

  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error('Command error:', err);
    const msg = { content: '❌ An error occurred.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

client.on('messageCreate', handleMessageCreate);

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  client.destroy();
  process.exit(0);
});

client.login(config.token);
