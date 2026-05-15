import { db } from '../../core/db';

export interface TelegramAgentTopic {
  topic_id: number;
  chat_id: string;
  agent_id: string;
  session_id: string | null;
  created_at: number;
}

export const topicDb = {
  register(topicId: number, chatId: string, agentId: string): void {
    // Idempotent: ignore conflicts on (chat_id, topic_id) so reprocessing the
    // same forum topic doesn't throw. created_at is preserved from the first
    // insert via INSERT OR IGNORE.
    db.prepare(
      `INSERT OR IGNORE INTO telegram_agent_topics (topic_id, chat_id, agent_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(topicId, chatId, agentId, Date.now());
  },

  get(chatId: string, topicId: number): TelegramAgentTopic | undefined {
    return db
      .prepare('SELECT * FROM telegram_agent_topics WHERE chat_id = ? AND topic_id = ?')
      .get(chatId, topicId) as TelegramAgentTopic | undefined;
  },

  getByAgentId(agentId: string): TelegramAgentTopic[] {
    // ORDER BY created_at ASC so topics[0] is the original/default topic for
    // the agent. findOrCreateAgentChannel relies on this ordering to return a
    // stable channelId for /api/send.
    return db
      .prepare('SELECT * FROM telegram_agent_topics WHERE agent_id = ? ORDER BY created_at ASC')
      .all(agentId) as TelegramAgentTopic[];
  },

  updateSession(chatId: string, topicId: number, sessionId: string | null): void {
    db.prepare(
      'UPDATE telegram_agent_topics SET session_id = ? WHERE chat_id = ? AND topic_id = ?',
    ).run(sessionId, chatId, topicId);
  },

  remove(chatId: string, topicId: number): void {
    db.prepare('DELETE FROM telegram_agent_topics WHERE chat_id = ? AND topic_id = ?').run(
      chatId,
      topicId,
    );
  },

  listByChat(chatId: string): TelegramAgentTopic[] {
    return db
      .prepare('SELECT * FROM telegram_agent_topics WHERE chat_id = ? ORDER BY created_at DESC')
      .all(chatId) as TelegramAgentTopic[];
  },
};
