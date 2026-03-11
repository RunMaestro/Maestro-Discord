import { Message, TextChannel, ThreadAutoArchiveDuration } from 'discord.js';
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

    const botUserId = deps.getBotUserId(message);
    if (!botUserId) return;

    if (!message.channel.isThread()) {
      const channelInfo = deps.channelDb.get(message.channel.id);
      if (!channelInfo) return;

      const mentionedByMetadata = message.mentions.users.has(botUserId);
      const mentionedByContent =
        message.content.includes(`<@${botUserId}>`) ||
        message.content.includes(`<@!${botUserId}>`);
      if (!mentionedByMetadata && !mentionedByContent) return;

      const authorName = message.member?.displayName ?? message.author.username ?? message.author.id;
      const safeAuthorName = authorName.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const threadName = `${safeAuthorName || 'user'}-${timestamp}`.slice(0, 100);

      const thread = await (message.channel as TextChannel).threads.create({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        reason: `Mention-triggered thread for ${message.author.id}`,
      });

      deps.threadDb.register(thread.id, message.channel.id, channelInfo.agent_id, message.author.id);
      await thread.send(`This thread is bound to <@${message.author.id}>.`);
      return;
    }

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
