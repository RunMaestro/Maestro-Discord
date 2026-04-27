import { Message, TextChannel, ThreadChannel } from 'discord.js';

interface QueueEntry {
  message: Message;
  options?: EnqueueOptions;
}

export type EnqueueOptions = {
  contentOverride?: string;
  skipAttachments?: boolean;
};

export type QueueDeps = {
  maestro: {
    getAgentCwd: (agentId: string) => Promise<string | null>;
    send: (
      agentId: string,
      message: string,
      sessionId?: string,
      readOnly?: boolean,
    ) => Promise<{
      success: boolean;
      response: string | null;
      error?: string;
      sessionId?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalCostUsd?: number;
        contextUsagePercent?: number;
      };
    }>;
  };
  channelDb: {
    get: (channelId: string) =>
      | {
          channel_id: string;
          agent_id: string;
          session_id?: string | null;
          read_only?: number | boolean;
        }
      | undefined;
    updateSession: (channelId: string, sessionId: string) => void;
  };
  threadDb: {
    get: (threadId: string) =>
      | {
          thread_id: string;
          channel_id: string;
          agent_id: string;
          session_id?: string | null;
          owner_user_id?: string | null;
        }
      | undefined;
    updateSession: (threadId: string, sessionId: string) => void;
  };
  splitMessage: (text: string) => string[];
  downloadAttachments: (
    attachments: Message['attachments'],
    agentCwd: string,
  ) => Promise<{ downloaded: { originalName: string; savedPath: string }[]; failed: string[] }>;
  formatAttachmentRefs: (files: { originalName: string; savedPath: string }[]) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger: { error: (...args: any[]) => any };
};

export function createQueue(deps: QueueDeps) {
  const queues = new Map<string, QueueEntry[]>();
  const processing = new Set<string>();

  function enqueue(message: Message, options?: EnqueueOptions): void {
    const channelId = message.channel.id;
    if (!queues.has(channelId)) queues.set(channelId, []);
    queues.get(channelId)!.push({ message, options });

    if (!processing.has(channelId)) {
      void processNext(channelId);
    }
  }

  async function processNext(channelId: string): Promise<void> {
    const queue = queues.get(channelId);
    if (!queue || queue.length === 0) {
      processing.delete(channelId);
      return;
    }

    processing.add(channelId);
    const { message, options } = queue.shift()!;

    const isThread = message.channel.isThread();
    const threadInfo = isThread ? deps.threadDb.get(channelId) : undefined;
    const channelInfo = threadInfo
      ? deps.channelDb.get(threadInfo.channel_id)
      : deps.channelDb.get(channelId);

    if (!channelInfo) {
      processing.delete(channelId);
      return;
    }

    const agentId = threadInfo ? threadInfo.agent_id : channelInfo.agent_id;
    const sessionId = threadInfo
      ? (threadInfo.session_id ?? undefined)
      : (channelInfo.session_id ?? undefined);

    const channel = message.channel as TextChannel | ThreadChannel;

    let reaction: Awaited<ReturnType<Message['react']>> | undefined;
    try {
      reaction = await message.react('⏳');
    } catch {
      // Reaction may fail if message was deleted or bot lacks perms; continue anyway
    }

    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 8000);
    channel.sendTyping().catch(() => {});

    try {
      // Download attachments if present
      let attachmentRefs = '';
      if (!options?.skipAttachments && message.attachments.size > 0) {
        try {
          const agentCwd = await deps.maestro.getAgentCwd(agentId);
          if (agentCwd) {
            const result = await deps.downloadAttachments(message.attachments, agentCwd);
            attachmentRefs = deps.formatAttachmentRefs(result.downloaded);
            if (result.failed.length > 0) {
              await channel.send(
                `⚠️ Failed to download: ${result.failed.join(', ')}. Sending message without those files.`,
              );
            }
          } else {
            await channel.send('⚠️ Could not resolve agent working directory for file downloads.');
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          void deps.logger.error(
            'queue:attachment-download',
            `agent=${agentId} channel=${channelId} error=${errMsg}`,
          );
          await channel.send('⚠️ Failed to download attachments. Sending message without them.');
        }
      }

      const readOnly = !!channelInfo.read_only;
      const fullMessage = [options?.contentOverride ?? message.content, attachmentRefs]
        .filter(Boolean)
        .join('\n\n');
      const result = await deps.maestro.send(agentId, fullMessage, sessionId, readOnly);

      // Persist session ID from first response
      if (!sessionId && result.sessionId) {
        if (threadInfo) {
          deps.threadDb.updateSession(channelId, result.sessionId);
        } else {
          deps.channelDb.updateSession(channelId, result.sessionId);
        }
      }

      clearInterval(typingInterval);

      try {
        await reaction?.remove();
      } catch {
        // Ignore if already removed or no permission
      }

      if (!result.success || !result.response) {
        const reason = result.error ?? 'The agent could not complete this request.';
        const hint = readOnly
          ? '\n-# The agent is in **read-only** mode and cannot modify files.'
          : '';
        void deps.logger.error(
          'queue:agent-failure',
          `agent=${agentId} session=${sessionId ?? 'new'} channel=${channelId} reason=${reason}`,
        );
        await channel.send(`⚠️ ${reason}${hint}`);
      } else {
        const parts = deps.splitMessage(result.response);
        for (const part of parts) {
          await channel.send(part);
        }
      }

      const cost = (result.usage?.totalCostUsd ?? 0).toFixed(4);
      const ctx = (result.usage?.contextUsagePercent ?? 0).toFixed(1);
      const tokens = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      await channel.send(
        `-# 💬 ${tokens} tokens • $${cost} • ${ctx}% context${readOnly ? ' • 📖 read-only' : ''}`,
      );
    } catch (err) {
      clearInterval(typingInterval);
      try {
        await reaction?.remove();
      } catch {
        /* reaction cleanup is best-effort */
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      void deps.logger.error(
        'queue:send-error',
        `agent=${agentId} session=${sessionId ?? 'new'} channel=${channelId} error=${errMsg}`,
      );
      await channel.send(`❌ Failed to get response from agent:\n\`\`\`\n${errMsg}\n\`\`\``);
    }

    void processNext(channelId);
  }

  return { enqueue };
}
