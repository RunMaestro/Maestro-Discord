import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  TextChannel,
} from 'discord.js';
import { maestro } from '../services/maestro';
import { channelDb } from '../db';

export const data = new SlashCommandBuilder()
  .setName('agents')
  .setDescription('Manage Maestro agents')
  .addSubcommand((sub) => sub.setName('list').setDescription('List all available agents'))
  .addSubcommand((sub) =>
    sub
      .setName('new')
      .setDescription('Create a dedicated channel for an agent')
      .addStringOption((opt) =>
        opt
          .setName('agent')
          .setDescription('Select an agent')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((sub) => sub.setName('disconnect').setDescription('Remove this agent channel (deletes the channel)'))
  .addSubcommand((sub) =>
    sub
      .setName('readonly')
      .setDescription('Toggle read-only mode for this agent channel')
      .addStringOption((opt) =>
        opt
          .setName('mode')
          .setDescription('Turn read-only on or off')
          .setRequired(true)
          .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })
      )
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();

  try {
    const agents = await maestro.listAgents();
    const filtered = agents.filter(
      (a) => a.name.toLowerCase().includes(focused) || a.id.toLowerCase().includes(focused)
    );
    await interaction.respond(
      filtered.slice(0, 25).map((a) => ({ name: `${a.name} (${a.toolType})`, value: a.id }))
    );
  } catch {
    await interaction.respond([]);
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    await handleList(interaction);
  } else if (sub === 'new') {
    await handleNew(interaction);
  } else if (sub === 'disconnect') {
    await handleDisconnect(interaction);
  } else if (sub === 'readonly') {
    await handleReadonly(interaction);
  }
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const agents = await maestro.listAgents();

  if (agents.length === 0) {
    await interaction.editReply('No agents found. Start an agent in Maestro first.');
    return;
  }

  const lines = agents.map(
    (a) => `**${a.name}** · \`${a.id}\` · ${a.toolType}`
  );

  // Build a single embed; Discord limits description to 4096 chars and
  // total embed content to 6000 chars per message.  With compact one-line
  // entries (~60 chars each) this comfortably fits ~65 agents.
  const MAX_DESC = 4096;
  let description = '';
  let shown = 0;
  for (const line of lines) {
    const addition = description ? '\n' + line : line;
    if (description.length + addition.length > MAX_DESC) break;
    description += addition;
    shown++;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Maestro Agents')
    .setDescription(description);

  const footerParts: string[] = [];
  if (shown < agents.length) {
    footerParts.push(`Showing ${shown} of ${agents.length} agents`);
  }
  footerParts.push('Use /agents new <agent-id> to start a conversation');
  embed.setFooter({ text: footerParts.join(' · ') });

  await interaction.editReply({ embeds: [embed] });
}

async function handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const agentInput = interaction.options.getString('agent', true);
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command must be used in a server.');
    return;
  }

  const agents = await maestro.listAgents();
  const agent = agents.find(
    (a) => a.id === agentInput || a.id.startsWith(agentInput) || a.name === agentInput
  );

  if (!agent) {
    await interaction.editReply(
      `❌ No agent found matching \`${agentInput}\`. Use \`/agents list\` to see available agents.`
    );
    return;
  }

  // Find or create "Maestro Agents" category
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === 'Maestro Agents'
  );
  if (!category) {
    category = await guild.channels.create({
      name: 'Maestro Agents',
      type: ChannelType.GuildCategory,
    });
  }

  const channelName = `agent-${agent.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  const channel = (await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Maestro agent: ${agent.name} (${agent.id}) | ${agent.toolType} | ${agent.cwd}`,
  })) as TextChannel;

  channelDb.register(channel.id, guild.id, agent.id, agent.name);

  await interaction.editReply(
    `✅ Created <#${channel.id}> for agent **${agent.name}**.\n` +
      `Type your messages there to chat with the agent.`
  );

  await channel.send(
    `**${agent.name}** is ready.\n` +
      `Type any message here and it will be sent to this agent.\n` +
      `-# Agent: \`${agent.id}\` • ${agent.toolType} • \`${agent.cwd}\``
  );
}

async function handleReadonly(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelInfo = channelDb.get(interaction.channelId);
  if (!channelInfo) {
    await interaction.reply({ content: 'This channel is not an agent channel.', ephemeral: true });
    return;
  }

  const mode = interaction.options.getString('mode', true);
  const readOnly = mode === 'on';
  channelDb.setReadOnly(interaction.channelId, readOnly);

  const embed = new EmbedBuilder()
    .setColor(readOnly ? 0xf0b232 : 0x57f287)
    .setDescription(
      readOnly
        ? `📖 **${channelInfo.agent_name}** is now in **read-only** mode. The agent cannot modify files.`
        : `✏️ **${channelInfo.agent_name}** is back to **read-write** mode.`
    );

  await interaction.reply({ embeds: [embed] });
}

async function handleDisconnect(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelInfo = channelDb.get(interaction.channelId);
  if (!channelInfo) {
    await interaction.reply({ content: 'This channel is not an agent channel.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: `Disconnecting **${channelInfo.agent_name}**...`, ephemeral: true });
  channelDb.remove(interaction.channelId);

  setTimeout(async () => {
    try {
      await interaction.channel?.delete();
    } catch {
      // Channel may already be gone
    }
  }, 2000);
}
