import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

type ServerDeps = import('../server').ServerDeps;

const mod: {
  createServerHandler?: typeof import('../server').createServerHandler;
  parseBody?: typeof import('../server').parseBody;
} = {};

before(async () => {
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.DISCORD_CLIENT_ID = 'test-client';
  process.env.DISCORD_GUILD_ID = 'test-guild';
  const imported = await import('../server');
  mod.createServerHandler = imported.createServerHandler;
  mod.parseBody = imported.parseBody;
});

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    isReady: () => true,
    channels: {
      fetch: async (id: string) => ({
        id,
        isSendable: () => true,
        send: async () => ({}),
        members: { filter: () => ({ size: 0, map: () => [] }) },
      }),
    },
    guilds: { fetch: async () => ({}) },
    ...overrides,
  } as any;
}

function makeDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    channelDb: {
      getByAgentId: () => ({ channel_id: 'ch-1', guild_id: 'g-1', agent_id: 'a-1', agent_name: 'Test', session_id: null, read_only: 0, created_at: 0 }),
      register: () => undefined,
    },
    maestro: { listAgents: async () => [] },
    splitMessage: (s: string) => [s],
    config: { guildId: 'g-1', apiPort: 0, mentionUserId: '' },
    logger: { error: async () => undefined },
    ...overrides,
  };
}

function request(server: http.Server, options: { method: string; path: string; body?: object; contentType?: string }): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = options.body ? JSON.stringify(options.body) : undefined;
    const ct = options.contentType ?? (payload ? 'application/json' : undefined);
    const headers: Record<string, string | number> = {};
    if (ct) headers['Content-Type'] = ct;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      { hostname: '127.0.0.1', port: addr.port, path: options.path, method: options.method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function startTestServer(client: any, deps: ServerDeps): Promise<http.Server> {
  const handler = mod.createServerHandler!(client, deps);
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// --- Health endpoint ---

test('GET /api/health returns 200 when client is ready', async () => {
  const server = await startTestServer(makeClient(), makeDeps());
  try {
    const res = await request(server, { method: 'GET', path: '/api/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.uptime, 'number');
  } finally {
    server.close();
  }
});

test('GET /api/health returns 503 when client is not ready', async () => {
  const server = await startTestServer(makeClient({ isReady: () => false }), makeDeps());
  try {
    const res = await request(server, { method: 'GET', path: '/api/health' });
    assert.equal(res.status, 503);
    assert.equal(res.body.success, false);
    assert.equal(res.body.status, 'not_ready');
  } finally {
    server.close();
  }
});

test('POST /api/health returns 405', async () => {
  const server = await startTestServer(makeClient(), makeDeps());
  try {
    const res = await request(server, { method: 'POST', path: '/api/health', body: {} });
    assert.equal(res.status, 405);
  } finally {
    server.close();
  }
});

// --- Unknown route ---

test('unknown route returns 404', async () => {
  const server = await startTestServer(makeClient(), makeDeps());
  try {
    const res = await request(server, { method: 'GET', path: '/api/unknown' });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

// --- Send endpoint ---

test('GET /api/send returns 405', async () => {
  const server = await startTestServer(makeClient(), makeDeps());
  try {
    const res = await request(server, { method: 'GET', path: '/api/send' });
    assert.equal(res.status, 405);
  } finally {
    server.close();
  }
});

test('POST /api/send returns 503 when client is not ready', async () => {
  const server = await startTestServer(makeClient({ isReady: () => false }), makeDeps());
  try {
    const res = await request(server, { method: 'POST', path: '/api/send', body: { agentId: 'a-1', message: 'hi' } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Bot is not connected to Discord');
  } finally {
    server.close();
  }
});

test('POST /api/send returns 400 for missing fields', async () => {
  const server = await startTestServer(makeClient(), makeDeps());
  try {
    const res = await request(server, { method: 'POST', path: '/api/send', body: { agentId: 'a-1' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /required/);
  } finally {
    server.close();
  }
});

test('POST /api/send returns 200 on success', async () => {
  const sentMessages: string[] = [];
  const client = makeClient({
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async (msg: string) => { sentMessages.push(msg); },
      }),
    },
  });
  const server = await startTestServer(client, makeDeps());
  try {
    const res = await request(server, { method: 'POST', path: '/api/send', body: { agentId: 'a-1', message: 'hello' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.channelId, 'ch-1');
    assert.deepEqual(sentMessages, ['hello']);
  } finally {
    server.close();
  }
});

test('POST /api/send prepends mention when mention=true and mentionUserId is set', async () => {
  const sentMessages: string[] = [];
  const client = makeClient({
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async (msg: string) => { sentMessages.push(msg); },
      }),
    },
  });
  const deps = makeDeps({ config: { guildId: 'g-1', apiPort: 0, mentionUserId: '999' } });
  const server = await startTestServer(client, deps);
  try {
    const res = await request(server, { method: 'POST', path: '/api/send', body: { agentId: 'a-1', message: 'done', mention: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(sentMessages, ['<@999> done']);
  } finally {
    server.close();
  }
});

test('POST /api/send does not mention when mentionUserId is empty', async () => {
  const sentMessages: string[] = [];
  const client = makeClient({
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async (msg: string) => { sentMessages.push(msg); },
      }),
    },
  });
  const server = await startTestServer(client, makeDeps());
  try {
    const res = await request(server, { method: 'POST', path: '/api/send', body: { agentId: 'a-1', message: 'done', mention: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(sentMessages, ['done']);
  } finally {
    server.close();
  }
});

test('POST /api/send returns 404 for unknown agent', async () => {
  const deps = makeDeps({
    channelDb: {
      getByAgentId: () => undefined,
      register: () => undefined,
    },
    maestro: { listAgents: async () => [{ id: 'other', name: 'Other', toolType: 'x', cwd: '/' }] },
  });
  const server = await startTestServer(makeClient(), deps);
  try {
    const res = await request(server, { method: 'POST', path: '/api/send', body: { agentId: 'missing', message: 'hi' } });
    assert.equal(res.status, 404);
    assert.match(res.body.error, /Agent not found/);
  } finally {
    server.close();
  }
});

test('POST /api/send returns 415 for wrong content type', async () => {
  const server = await startTestServer(makeClient(), makeDeps());
  try {
    const addr = server.address() as { port: number };
    const res = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: addr.port, path: '/api/send', method: 'POST', headers: { 'Content-Type': 'text/plain' } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
        },
      );
      req.on('error', reject);
      req.write('not json');
      req.end();
    });
    assert.equal(res.status, 415);
  } finally {
    server.close();
  }
});

// --- parseBody ---

test('parseBody rejects invalid JSON', async () => {
  const { Readable } = await import('node:stream');
  const req = new Readable({ read() { this.push('not json'); this.push(null); } }) as any;
  req.headers = {};
  req.destroy = () => {};
  await assert.rejects(mod.parseBody!(req), /Invalid JSON/);
});
