import { Message } from 'discord.js';
import { channelDb, threadDb } from '../db';
import { enqueue } from '../services/queue';

type MessageCreateDeps = {
  channelDb: Pick<typeof channelDb, 'get'>;
  threadDb: Pick<typeof threadDb, 'get' | 'register'>;
  getBotUserId: (message: Message) => string | undefined;
  enqueue: (message: Message) => void;
};

export function createMessageCreateHandler(deps: MessageCreateDeps) {
  return async function handleMessageCreate(message: Message): Promise<void> {
    // Ignore bots (including self) and DMs
    if (message.author.bot) return;
    if (!message.guild) return;

    // Ignore empty messages (e.g. attachments-only)
    if (!message.content.trim()) return;

    // Only handle messages in registered session threads
    if (!message.channel.isThread()) return;

    const threadInfo = deps.threadDb.get(message.channel.id);
    if (!threadInfo) return;

    deps.enqueue(message);
  };
}

export const handleMessageCreate = createMessageCreateHandler({
  channelDb,
  threadDb,
  getBotUserId: (message) => message.client.user?.id,
  enqueue,
});
