import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import { channelDb, threadDb } from '../db';
import { maestro, MaestroSession } from '../services/maestro';

export const data = new SlashCommandBuilder()
  .setName('session')
  .setDescription('Manage session threads for this agent channel')
  .addSubcommand((sub) =>
    sub
      .setName('new')
      .setDescription('Create a new session thread for this agent')
      .addStringOption((opt) =>
        opt.setName('name').setDescription('Name for this session thread').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List all session threads for this agent'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === 'new') {
    await handleNew(interaction);
  } else if (sub === 'list') {
    await handleList(interaction);
  }
}

async function validateAgentChannel(interaction: ChatInputCommandInteraction) {
  if (interaction.channel?.isThread()) {
    await interaction.reply({
      content: '❌ Run this command in the main agent channel, not inside a thread.',
      ephemeral: true,
    });
    return undefined;
  }
  const channelInfo = channelDb.get(interaction.channelId);
  if (!channelInfo) {
    await interaction.reply({
      content: '❌ This channel is not connected to an agent. Use `/agents connect` first.',
      ephemeral: true,
    });
    return undefined;
  }
  return channelInfo;
}

async function handleNew(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelInfo = await validateAgentChannel(interaction);
  if (!channelInfo) {
    return;
  }

  await interaction.deferReply({ ephemeral: false });

  const providedName = interaction.options.getString('name');
  const threadName =
    providedName ??
    `Session ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const thread = await (interaction.channel as TextChannel).threads.create({
    name: threadName,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Maestro session for agent ${channelInfo.agent_name}`,
  });

  threadDb.register(thread.id, interaction.channelId, channelInfo.agent_id, interaction.user.id);

  await thread.send(
    `🤖 **${channelInfo.agent_name}** — ready for a new session.\nType your first message to begin. This thread is linked to a dedicated Maestro session.\nOnly <@${interaction.user.id}> can interact with the agent in this thread.`,
  );

  await interaction.editReply(
    `🧵 Session thread created: <#${thread.id}>\nChat with **${channelInfo.agent_name}** inside that thread.`,
  );
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const channelInfo = await validateAgentChannel(interaction);
  if (!channelInfo) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const dbThreads = threadDb.listByChannel(interaction.channelId);
  if (dbThreads.length === 0) {
    await interaction.editReply('No session threads yet. Use `/session new` to create one.');
    return;
  }

  let maestroSessions: MaestroSession[] = [];
  try {
    maestroSessions = await maestro.listSessions(channelInfo.agent_id);
  } catch {
    // fall through with empty list
  }

  const sessionMap = new Map<string, MaestroSession>(maestroSessions.map((s) => [s.sessionId, s]));

  const lines = dbThreads.map((t) => {
    const maestroInfo = sessionMap.get(t.session_id ?? '');
    const shortId = t.session_id ? t.session_id.slice(0, 8) : 'no session yet';
    const stats = maestroInfo
      ? `${maestroInfo.messageCount} msgs · $${maestroInfo.costUsd.toFixed(4)} · ${new Date(maestroInfo.modifiedAt).toLocaleDateString()}`
      : 'No messages yet';
    return `<#${t.thread_id}> — \`${shortId}\` · ${stats}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`Sessions — ${channelInfo.agent_name}`)
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: 'Each thread is an independent Maestro session' });

  await interaction.editReply({ embeds: [embed] });
}
