import { Message } from 'discord.js';
import { threadDb } from '../db';
import { enqueue } from '../services/queue';

export async function handleMessageCreate(message: Message): Promise<void> {
  // Ignore bots (including self) and DMs
  if (message.author.bot) return;
  if (!message.guild) return;

  // Ignore empty messages (e.g. attachments-only)
  if (!message.content.trim()) return;

  // Only handle messages in registered session threads
  if (!message.channel.isThread()) return;

  const threadInfo = threadDb.get(message.channel.id);
  if (!threadInfo) return;

  enqueue(message);
}
