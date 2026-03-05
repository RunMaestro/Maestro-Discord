import { Message } from 'discord.js';
import { channelDb } from '../db';
import { enqueue } from '../services/queue';

export async function handleMessageCreate(message: Message): Promise<void> {
  // Ignore bots (including self) and DMs
  if (message.author.bot) return;
  if (!message.guild) return;

  // Only handle messages in registered agent channels
  const channelInfo = channelDb.get(message.channel.id);
  if (!channelInfo) return;

  // Ignore empty messages (e.g. attachments-only)
  if (!message.content.trim()) return;

  enqueue(message);
}
