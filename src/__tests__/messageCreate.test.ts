import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageCreateHandler } from '../handlers/messageCreate';

function makeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    author: { bot: false, id: 'user-1', username: 'test-user' },
    member: { displayName: 'Test User' },
    guild: { id: 'guild-1' },
    content: 'hello',
    attachments: { size: 0, values: () => [] },
    mentions: { users: { has: () => false } },
    channel: {
      id: 'thread-1',
      isThread: () => true,
    },
    ...overrides,
  } as unknown;
}

function createDeps(enqueue: () => void) {
  return {
    channelDb: { get: () => ({ agent_id: 'agent-1' }) as any },
    threadDb: {
      get: () => ({ thread_id: 'thread-1' }) as any,
      register: () => undefined,
    },
    getBotUserId: () => 'bot-1',
    enqueue,
  };
}

test('handleMessageCreate ignores bot messages', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(makeMessage({ author: { bot: true } }) as any);
  assert.equal(enqueued, 0);
});

test('handleMessageCreate ignores DMs', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(makeMessage({ guild: null }) as any);
  assert.equal(enqueued, 0);
});

test('handleMessageCreate ignores messages with no text and no attachments', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(makeMessage({ content: '   ', attachments: { size: 0, values: () => [] } }) as any);
  assert.equal(enqueued, 0);
});

test('handleMessageCreate allows attachment-only messages (no text)', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(makeMessage({
    content: '',
    attachments: { size: 1, values: () => [{ url: 'https://example.com/file.png', name: 'file.png' }] },
  }) as any);
  assert.equal(enqueued, 1);
});

test('handleMessageCreate ignores non-thread channels', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(
    makeMessage({
      channel: { id: 'channel-1', isThread: () => false, threads: { create: async () => undefined } },
    }) as any
  );
  assert.equal(enqueued, 0);
});

test('handleMessageCreate ignores unregistered threads', async () => {
  let enqueued = 0;
  const deps = createDeps(() => { enqueued += 1; });
  deps.threadDb.get = () => undefined;
  const handler = createMessageCreateHandler(deps);

  await handler(makeMessage() as any);
  assert.equal(enqueued, 0);
});

test('handleMessageCreate enqueues messages for registered threads', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(makeMessage() as any);
  assert.equal(enqueued, 1);
});

test('handleMessageCreate enqueues messages for registered threads from the owner', async () => {
  let enqueued = 0;
  const deps = createDeps(() => { enqueued += 1; });
  deps.threadDb.get = () => ({ thread_id: 'thread-1', owner_user_id: 'user-1' }) as any;
  const handler = createMessageCreateHandler(deps);

  await handler(makeMessage({ author: { bot: false, id: 'user-1', username: 'owner-user' } }) as any);
  assert.equal(enqueued, 1);
});

test('handleMessageCreate silently ignores registered thread messages from non-owner', async () => {
  let enqueued = 0;
  const deps = createDeps(() => { enqueued += 1; });
  deps.threadDb.get = () => ({ thread_id: 'thread-1', owner_user_id: 'owner-1' }) as any;
  const handler = createMessageCreateHandler(deps);

  await handler(makeMessage({ author: { bot: false, id: 'user-2', username: 'other-user' } }) as any);
  assert.equal(enqueued, 0);
});

test('handleMessageCreate creates and registers a thread for bot mentions in registered channels', async () => {
  let enqueued = 0;
  const registerCalls: unknown[][] = [];
  const sentMessages: string[] = [];
  const deps = createDeps(() => { enqueued += 1; });
  deps.threadDb.register = (...args: unknown[]) => {
    registerCalls.push(args);
  };

  const handler = createMessageCreateHandler(deps as any);
  await handler(
    makeMessage({
      content: 'hello <@bot-1>',
      channel: {
        id: 'channel-1',
        isThread: () => false,
        threads: {
          create: async ({ name }: { name: string }) => {
            assert.ok(name.includes('Test-User'));
            return {
              id: 'thread-new-1',
              send: async (msg: string | { content?: string; files?: string[] }) => {
                const text = typeof msg === 'string' ? msg : (msg.content ?? '');
                sentMessages.push(text);
                return { id: 'msg-forwarded', content: text, attachments: { size: 0, values: () => [] } };
              },
            };
          },
        },
      },
    }) as any
  );

  assert.equal(enqueued, 1);
  assert.deepEqual(registerCalls, [['thread-new-1', 'channel-1', 'agent-1', 'user-1']]);
  assert.deepEqual(sentMessages, ['This thread is bound to <@user-1>.', 'hello']);
});

test('handleMessageCreate creates and registers a thread when mention metadata includes bot', async () => {
  const registerCalls: unknown[][] = [];
  const deps = createDeps(() => undefined);
  deps.threadDb.register = (...args: unknown[]) => {
    registerCalls.push(args);
  };
  const handler = createMessageCreateHandler(deps as any);

  await handler(
    makeMessage({
      author: { bot: false, id: 'user-42', username: 'alice' },
      mentions: { users: { has: (id: string) => id === 'bot-1' } },
      channel: {
        id: 'channel-1',
        isThread: () => false,
        threads: {
          create: async () => ({
            id: 'thread-new-2',
            send: async (msg: string | { content?: string; files?: string[] }) => {
              const text = typeof msg === 'string' ? msg : (msg.content ?? '');
              return { id: 'msg-fwd', content: text, attachments: { size: 0, values: () => [] } };
            },
          }),
        },
      },
    }) as any
  );

  assert.deepEqual(registerCalls, [['thread-new-2', 'channel-1', 'agent-1', 'user-42']]);
});

test('handleMessageCreate ignores non-thread channel messages without bot mention', async () => {
  let created = 0;
  const deps = createDeps(() => undefined);
  const handler = createMessageCreateHandler(deps);

  await handler(
    makeMessage({
      content: 'hello there',
      channel: {
        id: 'channel-1',
        isThread: () => false,
        threads: {
          create: async () => {
            created += 1;
            return { id: 'thread-x', send: async () => undefined };
          },
        },
      },
    }) as any
  );

  assert.equal(created, 0);
});
