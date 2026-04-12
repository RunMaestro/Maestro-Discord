import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureOwnerUserIdColumn } from '../db/migrations';

test('ensureOwnerUserIdColumn adds owner_user_id and is safe to rerun', () => {
  const database = new Database(':memory:');

  database.exec(`
    CREATE TABLE agent_threads (
      thread_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  ensureOwnerUserIdColumn(database);
  ensureOwnerUserIdColumn(database);

  const columns = database.prepare('PRAGMA table_info(agent_threads)').all() as Array<{
    name: string;
  }>;

  assert.ok(columns.some((column) => column.name === 'owner_user_id'));
});
