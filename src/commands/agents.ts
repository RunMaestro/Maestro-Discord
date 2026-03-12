import {
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
          .setDescription('Agent ID or unique prefix (from /agents list)')
          .setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName('disconnect').setDescription('Remove this agent channel (deletes the channel)'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    await handleList(interaction);
  } else if (sub === 'new') {
    await handleNew(interaction);
  } else if (sub === 'disconnect') {
    await handleDisconnect(interaction);
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
    (a) => `**${a.name}**\n\`${a.id}\`  •  ${a.toolType}  •  \`${a.cwd}\``
  );

  // Split into chunks that fit Discord's 4096-char embed description limit
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const addition = current ? '\n\n' + line : line;
    if (current.length + addition.length > 4096) {
      chunks.push(current);
      current = line;
    } else {
      current += addition;
    }
  }
  if (current) chunks.push(current);

  // Discord allows up to 10 embeds per message
  const visibleChunks = chunks.slice(0, 10);
  const truncated = chunks.length > 10;
  const embeds = visibleChunks.map((chunk, i) => {
    const embed = new EmbedBuilder().setColor(0x5865f2).setDescription(chunk);
    if (i === 0) embed.setTitle('Maestro Agents');
    if (i === visibleChunks.length - 1) {
      const footerText = truncated
        ? `Showing ${visibleChunks.length} of ${chunks.length} pages — some agents are hidden. Use /agents new <agent-id> to start a conversation`
        : 'Use /agents new <agent-id> to start a conversation';
      embed.setFooter({ text: footerText });
    }
    return embed;
  });

  await interaction.editReply({ embeds });
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
