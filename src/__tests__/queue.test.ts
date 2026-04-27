import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, QueueDeps } from '../services/queueFactory';

// --- Helpers ---

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    content: 'hello',
    attachments: { size: 0, values: () => [] },
    channel: {
      id: 'thread-1',
      isThread: () => true,
      send: mock.fn(async () => {}),
      sendTyping: mock.fn(async () => {}),
    },
    react: mock.fn(async () => ({ remove: mock.fn(async () => {}) })),
    ...overrides,
  } as any;
}

function defaultSendResult(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    response: 'Agent response',
    sessionId: 'session-1',
    usage: { inputTokens: 100, outputTokens: 50, totalCostUsd: 0.001, contextUsagePercent: 5 },
    ...extra,
  };
}

function createMockDeps(): QueueDeps & { _mocks: Record<string, ReturnType<typeof mock.fn>> } {
  const mockGetAgentCwd = mock.fn(async () => '/home/agent' as string | null);
  const mockSend = mock.fn(async () => defaultSendResult());
  const mockDownload = mock.fn(async () => ({
    downloaded: [] as { originalName: string; savedPath: string }[],
    failed: [] as string[],
  }));
  const mockFormat = mock.fn(() => '');
  const mockLoggerError = mock.fn();
  const mockChannelGet = mock.fn(
    () =>
      ({
        channel_id: 'channel-1',
        agent_id: 'agent-1',
        session_id: 'session-1',
      }) as any,
  );
  const mockThreadGet = mock.fn(
    () =>
      ({
        thread_id: 'thread-1',
        channel_id: 'channel-1',
        agent_id: 'agent-1',
        session_id: 'session-1',
      }) as any,
  );

  return {
    maestro: { getAgentCwd: mockGetAgentCwd as any, send: mockSend as any },
    channelDb: { get: mockChannelGet as any, updateSession: mock.fn() },
    threadDb: { get: mockThreadGet as any, updateSession: mock.fn() },
    splitMessage: (text: string) => [text],
    downloadAttachments: mockDownload as any,
    formatAttachmentRefs: mockFormat as any,
    logger: { error: mockLoggerError as any },
    _mocks: {
      getAgentCwd: mockGetAgentCwd,
      send: mockSend,
      download: mockDownload,
      format: mockFormat,
    },
  };
}

// Allow async queue processing to settle
const settle = () => new Promise((r) => setTimeout(r, 50));

// --- Tests ---

test('queue calls downloadAttachments when message has attachments', async () => {
  const deps = createMockDeps();
  const attachmentData = {
    downloaded: [
      { originalName: 'file.txt', savedPath: '/home/agent/.maestro/discord-files/123-file.txt' },
    ],
    failed: [],
  };
  deps._mocks.download.mock.mockImplementation(async () => attachmentData);
  deps._mocks.format.mock.mockImplementation(
    () => '[Attached: /home/agent/.maestro/discord-files/123-file.txt]',
  );

  const { enqueue } = createQueue(deps);
  const msg = makeMessage({
    content: 'check this file',
    attachments: {
      size: 1,
      values: () => [{ url: 'https://cdn.example.com/file.txt', name: 'file.txt', size: 100 }],
    },
  });

  enqueue(msg);
  await settle();

  // downloadAttachments should have been called
  assert.equal(deps._mocks.download.mock.callCount(), 1);
  assert.equal(deps._mocks.getAgentCwd.mock.callCount(), 1);
  assert.equal(deps._mocks.getAgentCwd.mock.calls[0].arguments[0], 'agent-1');

  // formatAttachmentRefs should have been called with the downloaded files
  assert.equal(deps._mocks.format.mock.callCount(), 1);

  // maestro.send should receive the combined message
  assert.equal(deps._mocks.send.mock.callCount(), 1);
  const sentMessage = deps._mocks.send.mock.calls[0].arguments[1];
  assert.equal(
    sentMessage,
    'check this file\n\n[Attached: /home/agent/.maestro/discord-files/123-file.txt]',
  );
});

test('queue does not call downloadAttachments when message has no attachments', async () => {
  const deps = createMockDeps();
  const { enqueue } = createQueue(deps);

  enqueue(makeMessage({ content: 'just text', attachments: { size: 0, values: () => [] } }));
  await settle();

  assert.equal(deps._mocks.download.mock.callCount(), 0);
  assert.equal(deps._mocks.getAgentCwd.mock.callCount(), 0);

  // maestro.send should receive only the text content
  assert.equal(deps._mocks.send.mock.callCount(), 1);
  assert.equal(deps._mocks.send.mock.calls[0].arguments[1], 'just text');
});

test('queue sends only attachment refs when message content is empty', async () => {
  const deps = createMockDeps();
  deps._mocks.download.mock.mockImplementation(async () => ({
    downloaded: [
      { originalName: 'img.png', savedPath: '/home/agent/.maestro/discord-files/456-img.png' },
    ],
    failed: [],
  }));
  deps._mocks.format.mock.mockImplementation(
    () => '[Attached: /home/agent/.maestro/discord-files/456-img.png]',
  );

  const { enqueue } = createQueue(deps);
  enqueue(
    makeMessage({
      content: '',
      attachments: {
        size: 1,
        values: () => [{ url: 'https://cdn.example.com/img.png', name: 'img.png', size: 200 }],
      },
    }),
  );
  await settle();

  assert.equal(deps._mocks.send.mock.callCount(), 1);
  const sentMessage = deps._mocks.send.mock.calls[0].arguments[1];
  assert.equal(sentMessage, '[Attached: /home/agent/.maestro/discord-files/456-img.png]');
});

test('queue handles attachment download failure gracefully', async () => {
  const deps = createMockDeps();
  deps._mocks.download.mock.mockImplementation(async () => {
    throw new Error('Network timeout');
  });

  const { enqueue } = createQueue(deps);
  const msg = makeMessage({
    content: 'check this file',
    attachments: {
      size: 1,
      values: () => [{ url: 'https://cdn.example.com/file.txt', name: 'file.txt', size: 100 }],
    },
  });

  enqueue(msg);
  await settle();

  // Should log the error
  assert.equal((deps.logger.error as unknown as ReturnType<typeof mock.fn>).mock.callCount(), 1);
  const logArgs = (deps.logger.error as unknown as ReturnType<typeof mock.fn>).mock.calls[0]
    .arguments;
  assert.equal(logArgs[0], 'queue:attachment-download');
  assert.ok((logArgs[1] as string).includes('Network timeout'));

  // Should warn the user
  const sendCalls = msg.channel.send.mock.calls;
  const warningCall = sendCalls.find(
    (c: { arguments: unknown[] }) =>
      typeof c.arguments[0] === 'string' &&
      c.arguments[0].includes('Failed to download attachments'),
  );
  assert.ok(warningCall, 'Expected a warning about failed downloads');

  // Should still send the message text to the agent (without attachment refs)
  assert.equal(deps._mocks.send.mock.callCount(), 1);
  assert.equal(deps._mocks.send.mock.calls[0].arguments[1], 'check this file');
});

test('queue shows specific file names when some downloads fail', async () => {
  const deps = createMockDeps();
  deps._mocks.download.mock.mockImplementation(async () => ({
    downloaded: [
      { originalName: 'ok.txt', savedPath: '/home/agent/.maestro/discord-files/ok.txt' },
    ],
    failed: ['broken.png', 'huge.bin'],
  }));
  deps._mocks.format.mock.mockImplementation(
    () => '[Attached: /home/agent/.maestro/discord-files/ok.txt]',
  );

  const { enqueue } = createQueue(deps);
  const msg = makeMessage({
    content: 'files here',
    attachments: {
      size: 3,
      values: () => [
        { url: 'u1', name: 'ok.txt', size: 100 },
        { url: 'u2', name: 'broken.png', size: 100 },
        { url: 'u3', name: 'huge.bin', size: 100 },
      ],
    },
  });

  enqueue(msg);
  await settle();

  // Should warn about the specific failed files
  const sendCalls = msg.channel.send.mock.calls;
  const warningCall = sendCalls.find(
    (c: { arguments: unknown[] }) =>
      typeof c.arguments[0] === 'string' &&
      c.arguments[0].includes('broken.png') &&
      c.arguments[0].includes('huge.bin'),
  );
  assert.ok(warningCall, 'Expected a warning naming the failed files');

  // Should still send the message with the successful attachment ref
  assert.equal(deps._mocks.send.mock.callCount(), 1);
  const sentMessage = deps._mocks.send.mock.calls[0].arguments[1];
  assert.ok((sentMessage as string).includes('[Attached:'));
});

test('queue warns when agent cwd cannot be resolved for attachments', async () => {
  const deps = createMockDeps();
  deps._mocks.getAgentCwd.mock.mockImplementation(async () => null);

  const { enqueue } = createQueue(deps);
  const msg = makeMessage({
    content: 'here is a file',
    attachments: {
      size: 1,
      values: () => [{ url: 'https://cdn.example.com/file.txt', name: 'file.txt', size: 100 }],
    },
  });

  enqueue(msg);
  await settle();

  // downloadAttachments should NOT be called if cwd is null
  assert.equal(deps._mocks.download.mock.callCount(), 0);

  // Channel should receive a warning message
  const sendCalls = msg.channel.send.mock.calls;
  const warningCall = sendCalls.find(
    (c: { arguments: unknown[] }) =>
      typeof c.arguments[0] === 'string' &&
      c.arguments[0].includes('Could not resolve agent working directory'),
  );
  assert.ok(warningCall, 'Expected a warning about unresolved agent cwd');
});

test('queue uses contentOverride when provided', async () => {
  const deps = createMockDeps();
  const { enqueue } = createQueue(deps);
  enqueue(makeMessage({ content: 'original text' }), { contentOverride: 'transcribed text' });
  await settle();

  assert.equal(deps._mocks.send.mock.callCount(), 1);
  assert.equal(deps._mocks.send.mock.calls[0].arguments[1], 'transcribed text');
});

test('queue skips attachment downloads when attachmentsOverride is empty', async () => {
  const deps = createMockDeps();
  const { enqueue } = createQueue(deps);
  enqueue(
    makeMessage({
      content: 'voice text',
      attachments: {
        size: 1,
        values: () => [{ url: 'https://cdn.example.com/voice.ogg', name: 'voice.ogg', size: 100 }],
      },
    }),
    { attachmentsOverride: { size: 0, values: () => [] } as any },
  );
  await settle();

  assert.equal(deps._mocks.download.mock.callCount(), 0);
  assert.equal(deps._mocks.send.mock.callCount(), 1);
  assert.equal(deps._mocks.send.mock.calls[0].arguments[1], 'voice text');
});

test('queue downloads only the attachmentsOverride collection (drops voice in mixed messages)', async () => {
  const deps = createMockDeps();
  const downloadedFile = {
    originalName: 'photo.png',
    savedPath: '/home/agent/.maestro/discord-files/photo.png',
  };
  deps._mocks.download.mock.mockImplementation(async () => ({
    downloaded: [downloadedFile],
    failed: [],
  }));
  deps._mocks.format.mock.mockImplementation(() => `[Attached: ${downloadedFile.savedPath}]`);

  const image = { url: 'https://cdn.example.com/photo.png', name: 'photo.png', size: 100 };
  const overrideAttachments = { size: 1, values: () => [image] } as any;

  const { enqueue } = createQueue(deps);
  enqueue(
    makeMessage({
      content: 'see photo',
      // The original message still carries both the voice file and the image…
      attachments: {
        size: 2,
        values: () => [
          { url: 'https://cdn.example.com/voice.ogg', name: 'voice.ogg', size: 100 },
          image,
        ],
      },
    }),
    {
      contentOverride: 'see photo\n\nhello from voice',
      // …but only the non-voice subset is forwarded for download.
      attachmentsOverride: overrideAttachments,
    },
  );
  await settle();

  assert.equal(deps._mocks.download.mock.callCount(), 1);
  assert.equal(
    deps._mocks.download.mock.calls[0].arguments[0],
    overrideAttachments,
    'queue should pass the override (image only), not the original mixed attachments, to downloadAttachments',
  );
  assert.equal(deps._mocks.send.mock.callCount(), 1);
  assert.equal(
    deps._mocks.send.mock.calls[0].arguments[1],
    `see photo\n\nhello from voice\n\n[Attached: ${downloadedFile.savedPath}]`,
  );
});
