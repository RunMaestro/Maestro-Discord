import { promises as fs } from 'fs';
import path from 'path';
import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import { channelDb } from '../channelsDb';
import { maestro } from '../../../core/maestro';

export const data = new SlashCommandBuilder()
  .setName('auto-run')
  .setDescription("Launch one of this agent's Auto Run documents")
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription("Configure and launch an Auto Run for this channel's agent")
      .addStringOption((opt) =>
        opt
          .setName('doc')
          .setDescription('Auto Run document (filename or path)')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((opt) =>
        opt.setName('prompt').setDescription('Override the default prompt').setRequired(false),
      )
      .addIntegerOption((opt) =>
        opt
          .setName('max_loops')
          .setDescription('Loop the run up to N times')
          .setMinValue(1)
          .setMaxValue(50)
          .setRequired(false),
      )
      .addBooleanOption((opt) =>
        opt
          .setName('reset_on_completion')
          .setDescription('Reset all task checkboxes when the run finishes')
          .setRequired(false),
      ),
  );

async function getAgentFolder(agentId: string): Promise<string | null> {
  try {
    const agent = await maestro.showAgent(agentId);
    const folder = agent.autoRunFolderPath;
    return typeof folder === 'string' ? folder : null;
  } catch {
    return null;
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'doc') return interaction.respond([]);

  const channelInfo = channelDb.get(interaction.channelId);
  if (!channelInfo) return interaction.respond([]);

  const folder = await getAgentFolder(channelInfo.agent_id);
  if (!folder) return interaction.respond([]);

  let entries: string[];
  try {
    const dirents = await fs.readdir(folder, { withFileTypes: true });
    entries = dirents
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
      .map((d) => d.name);
  } catch {
    return interaction.respond([]);
  }

  const value = focused.value.toLowerCase();
  await interaction.respond(
    entries
      .filter((n) => n.toLowerCase().includes(value))
      .slice(0, 25)
      .map((n) => ({ name: n.slice(0, 100), value: n })),
  );
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub !== 'start') return;

  const channelInfo = channelDb.get(interaction.channelId);
  if (!channelInfo) {
    await interaction.reply({
      content: '❌ This channel is not connected to an agent. Use `/agents new` first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const doc = interaction.options.getString('doc', true);
  const prompt = interaction.options.getString('prompt') ?? undefined;
  const maxLoops = interaction.options.getInteger('max_loops') ?? undefined;
  const resetOnCompletion =
    interaction.options.getBoolean('reset_on_completion') ?? undefined;

  // Resolve any relative path (filename or subpath) against the agent's Auto Run folder.
  let docPath = doc;
  if (!path.isAbsolute(doc)) {
    const folder = await getAgentFolder(channelInfo.agent_id);
    if (folder) docPath = path.join(folder, doc);
  }

  try {
    await maestro.startAutoRun({
      agentId: channelInfo.agent_id,
      docs: [docPath],
      prompt,
      maxLoops,
      resetOnCompletion,
    });
  } catch (err) {
    await interaction.editReply(
      `❌ Auto Run failed to launch: ${(err as Error).message.slice(0, 1500)}`,
    );
    return;
  }

  const lines: string[] = [
    `▶️ Launched Auto Run for **${channelInfo.agent_name}** with \`${path.basename(docPath)}\`.`,
  ];
  if (maxLoops != null) lines.push(`Looping up to ${maxLoops} times.`);
  if (prompt) lines.push('Custom prompt set.');
  if (resetOnCompletion) lines.push('Tasks will reset on completion.');
  lines.push('Watch the agent channel for progress.');

  await interaction.editReply(lines.join('\n'));
}
