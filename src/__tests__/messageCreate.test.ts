import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageCreateHandler } from '../handlers/messageCreate';

function makeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    author: { bot: false },
    guild: { id: 'guild-1' },
    content: 'hello',
    channel: {
      id: 'thread-1',
      isThread: () => true,
    },
    ...overrides,
  } as unknown;
}

function createDeps(enqueue: () => void) {
  return {
    channelDb: { get: () => undefined },
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

test('handleMessageCreate ignores empty messages', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(makeMessage({ content: '   ' }) as any);
  assert.equal(enqueued, 0);
});

test('handleMessageCreate ignores non-thread channels', async () => {
  let enqueued = 0;
  const handler = createMessageCreateHandler(createDeps(() => { enqueued += 1; }));

  await handler(
    makeMessage({ channel: { id: 'channel-1', isThread: () => false } }) as any
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
