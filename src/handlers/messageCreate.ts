import { Message, TextChannel, ThreadAutoArchiveDuration } from 'discord.js';
import { channelDb, threadDb } from '../db';
import { enqueue } from '../services/queue';

type MessageCreateDeps = {
  channelDb: Pick<typeof channelDb, 'get'>;
  threadDb: Pick<typeof threadDb, 'get' | 'register'>;
  getBotUserId: (message: Message) => string | undefined;
  enqueue: (message: Message) => void;
  logger?: Pick<Console, 'warn' | 'error'>;
};

export function createMessageCreateHandler(deps: MessageCreateDeps) {
  return async function handleMessageCreate(message: Message): Promise<void> {
    // Ignore bots (including self) and DMs
    if (message.author.bot) return;
    if (!message.guild) return;

    // Ignore empty messages (no text and no attachments)
    if (!message.content.trim() && message.attachments.size === 0) return;

    const botUserId = deps.getBotUserId(message);
    if (!botUserId) {
      if (deps.logger?.warn) {
        deps.logger.warn('messageCreate: bot user ID missing, skipping message handling');
      } else {
        console.warn('messageCreate: bot user ID missing, skipping message handling');
      }
      return;
    }

    if (!message.channel.isThread()) {
      const channelInfo = deps.channelDb.get(message.channel.id);
      if (!channelInfo) {
        console.debug(`[mention] channel ${message.channel.id} not registered, ignoring`);
        return;
      }

      // Detect both direct user mentions (@bot) and role mentions (@BotRole)
      const mentionedByUser = message.mentions.users.has(botUserId);
      const botRoleId = message.guild?.members?.me?.roles.botRole?.id;
      const mentionedByRole = !!(botRoleId && message.mentions.roles?.has(botRoleId));
      const mentionedByContent =
        message.content.includes(`<@${botUserId}>`) ||
        message.content.includes(`<@!${botUserId}>`) ||
        (!!botRoleId && message.content.includes(`<@&${botRoleId}>`));
      console.debug(`[mention] botUserId=${botUserId} botRoleId=${botRoleId} user=${mentionedByUser} role=${mentionedByRole} content=${mentionedByContent} raw=${JSON.stringify(message.content)}`);
      if (!mentionedByUser && !mentionedByRole && !mentionedByContent) return;

      try {
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

        // Forward the triggering message to the agent via the new thread
        // Strip the bot mention prefix so the agent gets clean content
        const mentionPattern = botRoleId
          ? new RegExp(`<@!?${botUserId}>|<@&${botRoleId}>`, 'g')
          : new RegExp(`<@!?${botUserId}>`, 'g');
        const cleanContent = message.content.replace(mentionPattern, '').trim();
        if (cleanContent || message.attachments.size > 0) {
          // Re-upload attachments so the thread message has real discord.js
          // Attachment objects (sending bare URLs produces attachments.size===0).
          const files = [...message.attachments.values()].map(a => ({
            attachment: a.url,
            name: a.name,
          }));
          const threadMessage = await thread.send({
            content: cleanContent || undefined,
            files: files.length > 0 ? files : undefined,
          });
          deps.enqueue(threadMessage);
        }
      } catch (err) {
        const log = deps.logger?.error ?? console.error;
        log('messageCreate: failed to create thread for mention:', err);
        try {
          await message.reply('❌ Failed to create a thread for this mention.');
        } catch {
          // Reply may also fail if permissions are missing
        }
      }
      return;
    }

    const threadInfo = deps.threadDb.get(message.channel.id);
    if (!threadInfo) return;

    const ownerUserId = threadInfo.owner_user_id?.trim();
    if (ownerUserId && ownerUserId !== message.author.id) return;

    deps.enqueue(message);
  };
}

export const handleMessageCreate = createMessageCreateHandler({
  channelDb,
  threadDb,
  getBotUserId: (message) => message.client.user?.id,
  enqueue,
  logger: console,
});
