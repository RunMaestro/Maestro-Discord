import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../commands/session';

afterEach(() => {
  mock.restoreAll();
});

// --- Helpers ---

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'ch-1',
    user: { id: 'user-1' },
    guild: {
      id: 'guild-1',
      channels: {
        cache: { get: () => undefined },
      },
    },
    channel: {
      isThread: () => false,
      threads: {
        create: mock.fn(async (opts: Record<string, unknown>) => ({
          id: 'thread-new-1',
          name: opts.name,
          send: mock.fn(async () => ({})),
        })),
      },
    },
    options: {
      getSubcommand: () => 'new',
      getString: () => null,
    },
    deferReply: mock.fn(async () => {}),
    editReply: mock.fn(async () => {}),
    reply: mock.fn(async () => {}),
    ...overrides,
  } as any;
}

// --- /session new ---

test('session new creates a thread and registers it', async () => {
  const { channelDb, threadDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));
  const registerMock = mock.method(threadDb, 'register', () => {});

  const interaction = makeInteraction({
    options: {
      getSubcommand: () => 'new',
      getString: () => null,
    },
  });

  await execute(interaction);

  assert.equal(interaction.deferReply.mock.callCount(), 1);
  assert.equal(registerMock.mock.callCount(), 1);
  assert.equal(registerMock.mock.calls[0].arguments[0], 'thread-new-1');
  assert.equal(registerMock.mock.calls[0].arguments[1], 'ch-1');
  assert.equal(registerMock.mock.calls[0].arguments[2], 'agent-1');
  assert.equal(registerMock.mock.calls[0].arguments[3], 'user-1');

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(typeof reply === 'string');
  assert.ok(reply.includes('Session thread created'));
});

test('session new uses provided name', async () => {
  const { channelDb, threadDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));
  mock.method(threadDb, 'register', () => {});

  const createMock = mock.fn(async (opts: Record<string, unknown>) => ({
    id: 'thread-named',
    name: opts.name,
    send: mock.fn(async () => ({})),
  }));

  const interaction = makeInteraction({
    channel: {
      isThread: () => false,
      threads: { create: createMock },
    },
    options: {
      getSubcommand: () => 'new',
      getString: (name: string) => (name === 'name' ? 'My Custom Session' : null),
    },
  });

  await execute(interaction);

  const createOpts = createMock.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.equal(createOpts.name, 'My Custom Session');
});

test('session new rejects when used in a thread', async () => {
  const interaction = makeInteraction({
    channel: { isThread: () => true },
    options: { getSubcommand: () => 'new', getString: () => null },
  });

  await execute(interaction);

  assert.equal(interaction.reply.mock.callCount(), 1);
  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.content.includes('main agent channel'));
});

test('session new rejects when not in an agent channel', async () => {
  const { channelDb } = await import('../db');
  mock.method(channelDb, 'get', () => undefined);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'new', getString: () => null },
  });

  await execute(interaction);

  assert.equal(interaction.reply.mock.callCount(), 1);
  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.content.includes('not connected to an agent'));
});

// --- /session list ---

test('session list shows threads with session info', async () => {
  const { channelDb, threadDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));
  mock.method(threadDb, 'listByChannel', () => [
    {
      thread_id: 'thread-1',
      channel_id: 'ch-1',
      agent_id: 'agent-1',
      session_id: 'sess-abc123',
      owner_user_id: 'user-1',
      created_at: 1000,
    },
  ]);

  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listSessions', async () => [
    {
      sessionId: 'sess-abc123',
      sessionName: 'Test',
      modifiedAt: '2026-04-01',
      messageCount: 5,
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
      durationSeconds: 60,
      starred: false,
    },
  ]);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'list' },
  });

  await execute(interaction);

  assert.equal(interaction.deferReply.mock.callCount(), 1);
  assert.equal(interaction.editReply.mock.callCount(), 1);

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(reply.embeds);
  const embedData = reply.embeds[0].data;
  assert.ok(embedData.title.includes('TestBot'));
  assert.ok(embedData.description.includes('sess-abc'));
  assert.ok(embedData.description.includes('5 msgs'));
});

test('session list shows empty message when no threads exist', async () => {
  const { channelDb, threadDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));
  mock.method(threadDb, 'listByChannel', () => []);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'list' },
  });

  await execute(interaction);

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(typeof reply === 'string');
  assert.ok(reply.includes('No session threads'));
});

test('session list handles maestro session fetch failure gracefully', async () => {
  const { channelDb, threadDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));
  mock.method(threadDb, 'listByChannel', () => [
    {
      thread_id: 'thread-1',
      channel_id: 'ch-1',
      agent_id: 'agent-1',
      session_id: 'sess-1',
      owner_user_id: 'user-1',
      created_at: 1000,
    },
  ]);

  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listSessions', async () => {
    throw new Error('CLI error');
  });

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'list' },
  });

  await execute(interaction);

  // Should still render the embed without maestro session details
  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(reply.embeds);
  assert.ok(reply.embeds[0].data.description.includes('No messages yet'));
});

test('session list rejects when used in a thread', async () => {
  const interaction = makeInteraction({
    channel: { isThread: () => true },
    options: { getSubcommand: () => 'list' },
  });

  await execute(interaction);

  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.content.includes('main agent channel'));
});

test('session list rejects non-agent channels', async () => {
  const { channelDb } = await import('../db');
  mock.method(channelDb, 'get', () => undefined);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'list' },
  });

  await execute(interaction);

  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.content.includes('not connected to an agent'));
});
