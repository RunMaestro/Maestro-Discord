import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { execute } from '../providers/discord/commands/auto-run';

afterEach(() => {
  mock.restoreAll();
});

interface MockInteraction {
  channelId: string;
  options: {
    getSubcommand: () => string;
    getString: (name: string, required?: boolean) => string | null;
    getInteger: (name: string) => number | null;
    getBoolean: (name: string) => boolean | null;
  };
  deferReply: ReturnType<typeof mock.fn>;
  editReply: ReturnType<typeof mock.fn>;
  reply: ReturnType<typeof mock.fn>;
}

function makeInteraction(
  options: Record<string, string | number | boolean | null> = {},
): MockInteraction {
  return {
    channelId: 'ch-1',
    options: {
      getSubcommand: () => 'start',
      getString: (name: string) => (options[name] as string | null) ?? null,
      getInteger: (name: string) => (options[name] as number | null) ?? null,
      getBoolean: (name: string) => (options[name] as boolean | null) ?? null,
    },
    deferReply: mock.fn(async () => {}),
    editReply: mock.fn(async () => {}),
    reply: mock.fn(async () => {}),
  };
}

test('auto-run start rejects channels not connected to an agent', async () => {
  const { channelDb } = await import('../providers/discord/channelsDb');
  mock.method(channelDb, 'get', () => undefined);

  const i = makeInteraction({ doc: 'plan.md' });
  await execute(i as unknown as Parameters<typeof execute>[0]);

  const reply = i.reply.mock.calls[0].arguments[0] as { content: string };
  assert.ok(reply.content.includes('not connected to an agent'));
});

test('auto-run start resolves a bare filename against the agent Auto Run folder', async () => {
  const { channelDb } = await import('../providers/discord/channelsDb');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));

  const { maestro } = await import('../core/maestro');
  mock.method(maestro, 'showAgent', async () => ({
    id: 'agent-1',
    name: 'TestBot',
    toolType: 'claude',
    cwd: '/proj',
    autoRunFolderPath: '/agents/auto-run-docs',
  }));

  const startMock = mock.method(maestro, 'startAutoRun', async () => '');

  const i = makeInteraction({ doc: 'plan.md' });
  await execute(i as unknown as Parameters<typeof execute>[0]);

  assert.equal(startMock.mock.callCount(), 1);
  const opts = startMock.mock.calls[0].arguments[0] as { docs: string[] };
  assert.deepEqual(opts.docs, [path.join('/agents/auto-run-docs', 'plan.md')]);
});

test('auto-run start resolves a relative subpath against the agent Auto Run folder', async () => {
  const { channelDb } = await import('../providers/discord/channelsDb');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));

  const { maestro } = await import('../core/maestro');
  mock.method(maestro, 'showAgent', async () => ({
    id: 'agent-1',
    name: 'TestBot',
    toolType: 'claude',
    cwd: '/proj',
    autoRunFolderPath: '/agents/auto-run-docs',
  }));

  const startMock = mock.method(maestro, 'startAutoRun', async () => '');

  const i = makeInteraction({ doc: 'subdir/doc.md' });
  await execute(i as unknown as Parameters<typeof execute>[0]);

  assert.equal(startMock.mock.callCount(), 1);
  const opts = startMock.mock.calls[0].arguments[0] as { docs: string[] };
  assert.deepEqual(opts.docs, [path.join('/agents/auto-run-docs', 'subdir/doc.md')]);
});

test('auto-run start preserves an absolute path verbatim', async () => {
  const { channelDb } = await import('../providers/discord/channelsDb');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));

  const { maestro } = await import('../core/maestro');
  // showAgent should not even be called when the path is absolute.
  const showAgentMock = mock.method(maestro, 'showAgent', async () => {
    throw new Error('should not be called');
  });
  const startMock = mock.method(maestro, 'startAutoRun', async () => '');

  const i = makeInteraction({ doc: '/abs/path/doc.md' });
  await execute(i as unknown as Parameters<typeof execute>[0]);

  assert.equal(showAgentMock.mock.callCount(), 0);
  assert.equal(startMock.mock.callCount(), 1);
  const opts = startMock.mock.calls[0].arguments[0] as { docs: string[] };
  assert.deepEqual(opts.docs, ['/abs/path/doc.md']);
});

test('auto-run start uses the doc as-is when showAgent fails to resolve a folder', async () => {
  const { channelDb } = await import('../providers/discord/channelsDb');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));

  const { maestro } = await import('../core/maestro');
  // showAgent throws — getAgentFolder should swallow and return null.
  mock.method(maestro, 'showAgent', async () => {
    throw new Error('cli unavailable');
  });
  const startMock = mock.method(maestro, 'startAutoRun', async () => '');

  const i = makeInteraction({ doc: 'plan.md' });
  await execute(i as unknown as Parameters<typeof execute>[0]);

  assert.equal(startMock.mock.callCount(), 1);
  const opts = startMock.mock.calls[0].arguments[0] as { docs: string[] };
  assert.deepEqual(opts.docs, ['plan.md']);
});

test('auto-run start uses the doc as-is when autoRunFolderPath is missing', async () => {
  const { channelDb } = await import('../providers/discord/channelsDb');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));

  const { maestro } = await import('../core/maestro');
  mock.method(maestro, 'showAgent', async () => ({
    id: 'agent-1',
    name: 'TestBot',
    toolType: 'claude',
    cwd: '/proj',
    // autoRunFolderPath intentionally absent
  }));
  const startMock = mock.method(maestro, 'startAutoRun', async () => '');

  const i = makeInteraction({ doc: 'plan.md' });
  await execute(i as unknown as Parameters<typeof execute>[0]);

  assert.equal(startMock.mock.callCount(), 1);
  const opts = startMock.mock.calls[0].arguments[0] as { docs: string[] };
  assert.deepEqual(opts.docs, ['plan.md']);
});

test('auto-run start surfaces errors from startAutoRun', async () => {
  const { channelDb } = await import('../providers/discord/channelsDb');
  mock.method(channelDb, 'get', () => ({
    channel_id: 'ch-1',
    agent_id: 'agent-1',
    agent_name: 'TestBot',
  }));

  const { maestro } = await import('../core/maestro');
  mock.method(maestro, 'showAgent', async () => ({
    id: 'agent-1',
    name: 'TestBot',
    toolType: 'claude',
    cwd: '/proj',
    autoRunFolderPath: '/agents/auto-run-docs',
  }));
  mock.method(maestro, 'startAutoRun', async () => {
    throw new Error('boom');
  });

  const i = makeInteraction({ doc: 'plan.md' });
  await execute(i as unknown as Parameters<typeof execute>[0]);

  const reply = i.editReply.mock.calls[0].arguments[0];
  assert.equal(typeof reply, 'string');
  assert.ok((reply as string).includes('Auto Run failed to launch'));
  assert.ok((reply as string).includes('boom'));
});
