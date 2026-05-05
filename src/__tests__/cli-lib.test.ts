import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { AddressInfo } from 'net';
import { DEFAULT_PORT, parsePort, postToSendApi } from '../cli/lib';

// --- parsePort ---

test('parsePort returns the fallback when value is undefined', () => {
  assert.equal(parsePort(undefined), DEFAULT_PORT);
  assert.equal(parsePort(undefined, 9999), 9999);
});

test('parsePort accepts valid integer port strings', () => {
  assert.equal(parsePort('1'), 1);
  assert.equal(parsePort('80'), 80);
  assert.equal(parsePort('3457'), 3457);
  assert.equal(parsePort('65535'), 65535);
});

test('parsePort rejects values with non-digit characters', () => {
  assert.throws(() => parsePort('123abc'), /must be an integer/);
  assert.throws(() => parsePort('abc'), /must be an integer/);
  assert.throws(() => parsePort(' 80'), /must be an integer/);
  assert.throws(() => parsePort('80 '), /must be an integer/);
  assert.throws(() => parsePort('-80'), /must be an integer/);
  assert.throws(() => parsePort('80.5'), /must be an integer/);
  assert.throws(() => parsePort('0x50'), /must be an integer/);
});

test('parsePort rejects empty string', () => {
  assert.throws(() => parsePort(''), /must be an integer/);
});

test('parsePort rejects values out of TCP range', () => {
  assert.throws(() => parsePort('0'), /1 and 65535/);
  assert.throws(() => parsePort('65536'), /1 and 65535/);
  assert.throws(() => parsePort('99999'), /1 and 65535/);
});

// --- postToSendApi ---

test('postToSendApi resolves with parsed JSON on success', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, channelId: 'ch-' + parsed.agentId }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const result = await postToSendApi({ agentId: 'a-1', message: 'hi' }, port);
    assert.equal(result.success, true);
    assert.equal(result.channelId, 'ch-a-1');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('postToSendApi rejects with timeout error when server stalls', async () => {
  // A server that accepts the request but never responds.
  const server = http.createServer(() => {
    /* never calls res.end */
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await assert.rejects(
      postToSendApi({ agentId: 'a-1', message: 'hi' }, port, 100),
      /timed out/i,
    );
  } finally {
    // closeAllConnections required to free the stalled socket
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('postToSendApi reports a friendly message on ECONNREFUSED', async () => {
  // Use a port that nothing is listening on. Picking 1 is reliably refused.
  await assert.rejects(
    postToSendApi({ agentId: 'a-1', message: 'hi' }, 1, 1000),
    /not running|not started|ECONNREFUSED/i,
  );
});

test('postToSendApi rejects on invalid JSON response', async () => {
  const server = http.createServer((_req, res) => {
    res.end('not-json{{{');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await assert.rejects(
      postToSendApi({ agentId: 'a-1', message: 'hi' }, port),
      /Invalid response from bot/,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('postToSendApi only settles once when timeout fires', async () => {
  // Server accepts but is slow; we set a tight timeout so the timer fires first,
  // then the server eventually responds. The promise must already be settled.
  const server = http.createServer((_req, res) => {
    setTimeout(() => res.end(JSON.stringify({ success: true })), 200);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    await assert.rejects(
      postToSendApi({ agentId: 'a-1', message: 'hi' }, port, 50),
      /timed out/i,
    );
    // Wait long enough for the slow server to attempt a response.
    await new Promise((resolve) => setTimeout(resolve, 300));
    // If the timeout fix is wrong, the second resolve/reject would throw an
    // UnhandledPromiseRejection here. Surviving the wait is the assertion.
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
