import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { execute, autocomplete } from '../commands/agents';

afterEach(() => {
  mock.restoreAll();
});

// --- Helpers ---

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'ch-1',
    guild: {
      id: 'guild-1',
      channels: {
        cache: {
          find: () => undefined,
        },
        create: mock.fn(async (opts: Record<string, unknown>) => ({
          id: 'new-ch-1',
          name: opts.name,
          send: mock.fn(async () => ({})),
        })),
      },
    },
    channel: { delete: mock.fn(async () => {}) },
    user: { id: 'user-1' },
    options: {
      getSubcommand: () => 'list',
      getString: () => null,
    },
    deferReply: mock.fn(async () => {}),
    editReply: mock.fn(async () => {}),
    reply: mock.fn(async () => {}),
    ...overrides,
  } as any;
}

// --- /agents list ---

test('agents list shows agents in an embed', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => [
    { id: 'a-1', name: 'Alpha', toolType: 'claude', cwd: '/home' },
    { id: 'a-2', name: 'Beta', toolType: 'openai', cwd: '/work' },
  ]);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'list' },
  });

  await execute(interaction);

  assert.equal(interaction.deferReply.mock.callCount(), 1);
  assert.equal(interaction.editReply.mock.callCount(), 1);

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(reply.embeds);
  assert.equal(reply.embeds.length, 1);

  const embedData = reply.embeds[0].data;
  assert.ok(embedData.description.includes('Alpha'));
  assert.ok(embedData.description.includes('Beta'));
});

test('agents list shows message when no agents found', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => []);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'list' },
  });

  await execute(interaction);

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(typeof reply === 'string');
  assert.ok(reply.includes('No agents found'));
});

// --- /agents new ---

test('agents new creates a channel for a valid agent', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => [
    { id: 'agent-abc', name: 'TestBot', toolType: 'claude', cwd: '/proj' },
  ]);

  const { channelDb } = await import('../db');
  const registerMock = mock.method(channelDb, 'register', () => {});

  const interaction = makeInteraction({
    options: {
      getSubcommand: () => 'new',
      getString: (_name: string, _req: boolean) => 'agent-abc',
    },
  });

  await execute(interaction);

  assert.equal(registerMock.mock.callCount(), 1);
  assert.equal(registerMock.mock.calls[0].arguments[0], 'new-ch-1');
  assert.equal(registerMock.mock.calls[0].arguments[2], 'agent-abc');

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(typeof reply === 'string');
  assert.ok(reply.includes('Created'));
  assert.ok(reply.includes('TestBot'));
});

test('agents new rejects unknown agent', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => [
    { id: 'other-agent', name: 'Other', toolType: 'claude', cwd: '/' },
  ]);

  const interaction = makeInteraction({
    options: {
      getSubcommand: () => 'new',
      getString: (_name: string, _req: boolean) => 'nonexistent',
    },
  });

  await execute(interaction);

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(typeof reply === 'string');
  assert.ok(reply.includes('No agent found'));
});

test('agents new requires a guild', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => []);

  const interaction = makeInteraction({
    guild: null,
    options: {
      getSubcommand: () => 'new',
      getString: (_name: string, _req: boolean) => 'agent-1',
    },
  });

  await execute(interaction);

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(typeof reply === 'string');
  assert.ok(reply.includes('must be used in a server'));
});

test('agents new matches agent by prefix', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => [
    { id: 'agent-abc-123-full', name: 'PrefixBot', toolType: 'claude', cwd: '/proj' },
  ]);

  const { channelDb } = await import('../db');
  mock.method(channelDb, 'register', () => {});

  const interaction = makeInteraction({
    options: {
      getSubcommand: () => 'new',
      getString: (_name: string, _req: boolean) => 'agent-abc',
    },
  });

  await execute(interaction);

  const reply = interaction.editReply.mock.calls[0].arguments[0];
  assert.ok(reply.includes('PrefixBot'));
});

// --- /agents disconnect ---

test('agents disconnect removes channel and schedules deletion', async () => {
  const { channelDb, threadDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));
  const removeChannelMock = mock.method(channelDb, 'remove', () => {});
  mock.method(channelDb, 'listByAgentId', () => []);
  const removeThreadsMock = mock.method(threadDb, 'removeByChannel', () => {});
  mock.method(threadDb, 'getByAgentId', () => []);

  const { maestro } = await import('../services/maestro');
  // Return null so cleanupAgentFiles is never called (no real side effects)
  mock.method(maestro, 'getAgentCwd', async () => null);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'disconnect' },
  });

  await execute(interaction);

  assert.equal(removeChannelMock.mock.callCount(), 1);
  assert.equal(removeThreadsMock.mock.callCount(), 1);
  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.content.includes('Disconnecting'));
  assert.ok(reply.content.includes('TestBot'));
});

test('agents disconnect rejects non-agent channels', async () => {
  const { channelDb } = await import('../db');
  mock.method(channelDb, 'get', () => undefined);

  const interaction = makeInteraction({
    options: { getSubcommand: () => 'disconnect' },
  });

  await execute(interaction);

  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.content.includes('not an agent channel'));
});

// --- /agents readonly ---

test('agents readonly on sets read-only mode', async () => {
  const { channelDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_name: 'TestBot',
  }));
  const setReadOnlyMock = mock.method(channelDb, 'setReadOnly', () => {});

  const interaction = makeInteraction({
    options: {
      getSubcommand: () => 'readonly',
      getString: (name: string, _req: boolean) => {
        if (name === 'mode') return 'on';
        return null;
      },
    },
  });

  await execute(interaction);

  assert.equal(setReadOnlyMock.mock.callCount(), 1);
  assert.equal(setReadOnlyMock.mock.calls[0].arguments[1], true);

  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.embeds);
  const desc = reply.embeds[0].data.description;
  assert.ok(desc.includes('read-only'));
});

test('agents readonly off disables read-only mode', async () => {
  const { channelDb } = await import('../db');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_name: 'TestBot',
  }));
  const setReadOnlyMock = mock.method(channelDb, 'setReadOnly', () => {});

  const interaction = makeInteraction({
    options: {
      getSubcommand: () => 'readonly',
      getString: (name: string, _req: boolean) => {
        if (name === 'mode') return 'off';
        return null;
      },
    },
  });

  await execute(interaction);

  assert.equal(setReadOnlyMock.mock.callCount(), 1);
  assert.equal(setReadOnlyMock.mock.calls[0].arguments[1], false);

  const reply = interaction.reply.mock.calls[0].arguments[0];
  const desc = reply.embeds[0].data.description;
  assert.ok(desc.includes('read-write'));
});

test('agents readonly rejects non-agent channels', async () => {
  const { channelDb } = await import('../db');
  mock.method(channelDb, 'get', () => undefined);

  const interaction = makeInteraction({
    options: {
      getSubcommand: () => 'readonly',
      getString: () => 'on',
    },
  });

  await execute(interaction);

  const reply = interaction.reply.mock.calls[0].arguments[0];
  assert.ok(reply.content.includes('not an agent channel'));
});

// --- autocomplete ---

test('autocomplete filters agents by name', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => [
    { id: 'a-1', name: 'AlphaBot', toolType: 'claude', cwd: '/' },
    { id: 'a-2', name: 'BetaBot', toolType: 'openai', cwd: '/' },
  ]);

  const responses: unknown[] = [];
  const interaction = {
    options: { getFocused: () => 'alpha' },
    respond: mock.fn(async (items: unknown) => { responses.push(items); }),
  } as any;

  await autocomplete(interaction);

  assert.equal(interaction.respond.mock.callCount(), 1);
  const items = responses[0] as Array<{ name: string; value: string }>;
  assert.equal(items.length, 1);
  assert.ok(items[0].name.includes('AlphaBot'));
  assert.equal(items[0].value, 'a-1');
});

test('autocomplete returns empty on error', async () => {
  const { maestro } = await import('../services/maestro');
  mock.method(maestro, 'listAgents', async () => { throw new Error('CLI fail'); });

  const interaction = {
    options: { getFocused: () => '' },
    respond: mock.fn(async () => {}),
  } as any;

  await autocomplete(interaction);

  assert.equal(interaction.respond.mock.callCount(), 1);
  const items = interaction.respond.mock.calls[0].arguments[0];
  assert.deepEqual(items, []);
});
