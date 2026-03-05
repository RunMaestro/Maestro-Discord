import { REST, Routes } from 'discord.js';
import { config } from './config';
import * as health from './commands/health';
import * as agents from './commands/agents';
import * as session from './commands/session';

const commands = [health.data.toJSON(), agents.data.toJSON(), session.data.toJSON()];

const rest = new REST().setToken(config.token);

(async () => {
  console.log('Deploying slash commands...');
  await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
    body: commands,
  });
  console.log('Done.');
})();
