import Database from 'better-sqlite3';
import path from 'path';
import { ensureOwnerUserIdColumn, ensureReadOnlyColumn } from './migrations';

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

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_threads (
    thread_id  TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    agent_id   TEXT NOT NULL,
    owner_user_id TEXT,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
ensureOwnerUserIdColumn(db);
ensureReadOnlyColumn(db);

export interface AgentChannel {
  channel_id: string;
  guild_id: string;
  agent_id: string;
  agent_name: string;
  session_id: string | null;
  read_only: number;
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

  getByAgentId(agentId: string): AgentChannel | undefined {
    return db.prepare('SELECT * FROM agent_channels WHERE agent_id = ?')
      .get(agentId) as AgentChannel | undefined;
  },

  updateSession(channelId: string, sessionId: string | null): void {
    db.prepare('UPDATE agent_channels SET session_id = ? WHERE channel_id = ?')
      .run(sessionId, channelId);
  },

  setReadOnly(channelId: string, readOnly: boolean): void {
    db.prepare('UPDATE agent_channels SET read_only = ? WHERE channel_id = ?')
      .run(readOnly ? 1 : 0, channelId);
  },

  remove(channelId: string): void {
    db.prepare('DELETE FROM agent_channels WHERE channel_id = ?').run(channelId);
  },

  getByAgentId(agentId: string): AgentChannel[] {
    return db.prepare('SELECT * FROM agent_channels WHERE agent_id = ?')
      .all(agentId) as AgentChannel[];
  },

  listByGuild(guildId: string): AgentChannel[] {
    return db.prepare('SELECT * FROM agent_channels WHERE guild_id = ?')
      .all(guildId) as AgentChannel[];
  },
};

export interface AgentThread {
  thread_id:  string;
  channel_id: string;
  agent_id:   string;
  owner_user_id: string | null;
  session_id: string | null;
  created_at: number;
}

export const threadDb = {
  register(threadId: string, channelId: string, agentId: string, ownerUserId: string): void {
    db.prepare(`
      INSERT INTO agent_threads (thread_id, channel_id, agent_id, owner_user_id)
      VALUES (?, ?, ?, ?)
    `).run(threadId, channelId, agentId, ownerUserId);
  },

  get(threadId: string): AgentThread | undefined {
    return db.prepare('SELECT * FROM agent_threads WHERE thread_id = ?')
      .get(threadId) as AgentThread | undefined;
  },

  updateSession(threadId: string, sessionId: string | null): void {
    db.prepare('UPDATE agent_threads SET session_id = ? WHERE thread_id = ?')
      .run(sessionId, threadId);
  },

  listByChannel(channelId: string): AgentThread[] {
    return db.prepare('SELECT * FROM agent_threads WHERE channel_id = ? ORDER BY created_at DESC')
      .all(channelId) as AgentThread[];
  },

  remove(threadId: string): void {
    db.prepare('DELETE FROM agent_threads WHERE thread_id = ?').run(threadId);
  },

  getByAgentId(agentId: string): AgentThread[] {
    return db.prepare('SELECT * FROM agent_threads WHERE agent_id = ?')
      .all(agentId) as AgentThread[];
  },

  removeByChannel(channelId: string): void {
    db.prepare('DELETE FROM agent_threads WHERE channel_id = ?').run(channelId);
  },
};
