import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(__dirname, '../../maestro-bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);

export interface AgentChannel {
  channel_id: string;
  guild_id: string;
  agent_id: string;
  agent_name: string;
  session_id: string | null;
  created_at: number;
}

export const channelDb = {
  register(channelId: string, guildId: string, agentId: string, agentName: string): void {
    db.prepare(`
      INSERT INTO agent_channels (channel_id, guild_id, agent_id, agent_name)
      VALUES (?, ?, ?, ?)
    `).run(channelId, guildId, agentId, agentName);
  },

  get(channelId: string): AgentChannel | undefined {
    return db.prepare('SELECT * FROM agent_channels WHERE channel_id = ?')
      .get(channelId) as AgentChannel | undefined;
  },

  updateSession(channelId: string, sessionId: string): void {
    db.prepare('UPDATE agent_channels SET session_id = ? WHERE channel_id = ?')
      .run(sessionId, channelId);
  },

  remove(channelId: string): void {
    db.prepare('DELETE FROM agent_channels WHERE channel_id = ?').run(channelId);
  },

  listByGuild(guildId: string): AgentChannel[] {
    return db.prepare('SELECT * FROM agent_channels WHERE guild_id = ?')
      .all(guildId) as AgentChannel[];
  },
};
