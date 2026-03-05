import { Message, TextChannel, ThreadChannel } from 'discord.js';
import { maestro } from './maestro';
import { channelDb, threadDb } from '../db';
import { splitMessage } from '../utils/splitMessage';

interface QueueEntry {
  message: Message;
}

const queues = new Map<string, QueueEntry[]>();
const processing = new Set<string>();

export function enqueue(message: Message): void {
  const channelId = message.channel.id;
  if (!queues.has(channelId)) queues.set(channelId, []);
  queues.get(channelId)!.push({ message });

  if (!processing.has(channelId)) {
    // start processing asynchronously
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
  const { message } = queue.shift()!;

  // Resolve agent/session context — thread takes precedence over channel
  const isThread = message.channel.isThread();
  const threadInfo = isThread ? threadDb.get(channelId) : undefined;
  const channelInfo = threadInfo
    ? channelDb.get(threadInfo.channel_id)
    : channelDb.get(channelId);

  if (!channelInfo) {
    processing.delete(channelId);
    return;
  }

  const agentId = threadInfo ? threadInfo.agent_id : channelInfo.agent_id;
  const sessionId = threadInfo ? (threadInfo.session_id ?? undefined) : (channelInfo.session_id ?? undefined);

  const channel = message.channel as TextChannel | ThreadChannel;

  // React to show we're working
  let reaction: Awaited<ReturnType<Message['react']>> | undefined;
  try {
    reaction = await message.react('⏳');
  } catch {
    // Reaction may fail if message was deleted or bot lacks perms; continue anyway
  }

  // Show typing indicator while waiting
  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 8000);
  channel.sendTyping().catch(() => {});

  try {
    const result = await maestro.send(agentId, message.content, sessionId);

    // Persist session ID from first response
    if (!sessionId && result.sessionId) {
      if (threadInfo) {
        threadDb.updateSession(channelId, result.sessionId);
      } else {
        channelDb.updateSession(channelId, result.sessionId);
      }
    }

    clearInterval(typingInterval);

    // Remove the ⏳ reaction
    try {
      await reaction?.remove();
    } catch {
      // Ignore if already removed or no permission
    }

    // Post response, splitting if > 2000 chars
    const parts = splitMessage(result.response);
    for (const part of parts) {
      await channel.send(part);
    }

    // Post usage footer as a subtle follow-up
    const cost = result.usage.totalCostUsd.toFixed(4);
    const ctx = result.usage.contextUsagePercent.toFixed(1);
    await channel.send(
      `-# 💬 ${result.usage.inputTokens + result.usage.outputTokens} tokens • $${cost} • ${ctx}% context`
    );

  } catch (err) {
    clearInterval(typingInterval);
    try {
      await reaction?.remove();
    } catch {}

    const errMsg = err instanceof Error ? err.message : String(err);
    await channel.send(`❌ Failed to get response from agent:\n\`\`\`\n${errMsg}\n\`\`\``);
  }

  // Process the next item in queue
  void processNext(channelId);
}
