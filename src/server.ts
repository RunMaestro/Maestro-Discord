import http from 'http';
import { Client, ChannelType, CategoryChannel, SendableChannels } from 'discord.js';

export interface AgentChannelRecord {
  channel_id: string;
  guild_id: string;
  agent_id: string;
  agent_name: string;
  session_id: string | null;
  read_only: number;
  created_at: number;
}

export interface SendRequest {
  agentId: string;
  message: string;
  mention?: boolean;
}

export type ServerDeps = {
  channelDb: {
    getByAgentId(agentId: string): AgentChannelRecord | undefined;
    register(channelId: string, guildId: string, agentId: string, agentName: string): void;
  };
  maestro: {
    listAgents(): Promise<Array<{ id: string; name: string; toolType: string; cwd: string }>>;
  };
  splitMessage: (content: string) => string[];
  config: { guildId: string; apiPort: number; mentionUserId: string };
  logger: { error(...args: unknown[]): unknown };
};

const MAX_BODY_SIZE = 1_048_576; // 1 MB

export function parseBody(req: http.IncomingMessage): Promise<SendRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString();
        resolve(JSON.parse(body) as SendRequest);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: object) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createServerHandler(client: Client, deps: ServerDeps) {
  const pendingChannels = new Map<string, Promise<AgentChannelRecord>>();
  let pendingCategory: Promise<CategoryChannel> | null = null;

  async function findOrCreateChannel(agentId: string): Promise<AgentChannelRecord> {
    const existing = deps.channelDb.getByAgentId(agentId);
    if (existing) return existing;

    // Deduplicate concurrent creation for the same agent
    const pending = pendingChannels.get(agentId);
    if (pending) return pending;

    const promise = (async () => {
      const agents = await deps.maestro.listAgents();
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) throw new Error(`Agent not found: ${agentId}`);

      const guild = await client.guilds.fetch(deps.config.guildId);

      // Find or create "Maestro Agents" category (deduplicated across concurrent requests)
      let category = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === 'Maestro Agents'
      );
      if (!category) {
        if (!pendingCategory) {
          pendingCategory = guild.channels.create({
            name: 'Maestro Agents',
            type: ChannelType.GuildCategory,
          });
        }
        try {
          category = await pendingCategory;
        } finally {
          pendingCategory = null;
        }
      }

      const channelName = `agent-${agent.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
      const channel = (await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category!.id,
        topic: `Maestro agent: ${agent.name} (${agent.id}) | ${agent.toolType} | ${agent.cwd}`,
      }));

      deps.channelDb.register(channel.id, guild.id, agent.id, agent.name);

      return deps.channelDb.getByAgentId(agentId)!;
    })();

    pendingChannels.set(agentId, promise);
    try {
      return await promise;
    } finally {
      pendingChannels.delete(agentId);
    }
  }

  async function handleSend(req: http.IncomingMessage, res: http.ServerResponse) {
    // Client readiness check
    if (!client.isReady()) {
      await deps.logger.error('api', 'Bot is not connected to Discord');
      sendJson(res, 503, { success: false, error: 'Bot is not connected to Discord' });
      return;
    }

    // Validate Content-Type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      sendJson(res, 415, { success: false, error: 'Content-Type must be application/json' });
      return;
    }

    // Parse body
    let body: SendRequest;
    try {
      body = await parseBody(req);
    } catch (err) {
      const message = (err as Error).message;
      const status = message === 'Request body too large' ? 413 : 400;
      sendJson(res, status, { success: false, error: message });
      return;
    }

    // Validate required fields
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.agentId !== 'string' ||
      body.agentId.trim() === '' ||
      typeof body.message !== 'string' ||
      body.message.trim() === ''
    ) {
      sendJson(res, 400, { success: false, error: 'agentId and message are required non-empty strings' });
      return;
    }

    // Find or create channel
    let record;
    try {
      record = await findOrCreateChannel(body.agentId);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('Agent not found:')) {
        sendJson(res, 404, { success: false, error: msg });
      } else {
        await deps.logger.error('server/findOrCreateChannel', msg);
        sendJson(res, 500, { success: false, error: msg });
      }
      return;
    }

    // Fetch Discord channel
    let channel: SendableChannels;
    try {
      const fetched = await client.channels.fetch(record.channel_id);
      if (!fetched?.isSendable()) {
        throw new Error(`Configured channel ${record.channel_id} is missing or not sendable`);
      }
      channel = fetched;
    } catch (err) {
      const msg = `Failed to fetch channel ${record.channel_id}: ${(err as Error).message}`;
      await deps.logger.error('server/fetchChannel', msg);
      sendJson(res, 500, { success: false, error: msg });
      return;
    }

    // Build message content
    let content = body.message;
    if (body.mention && deps.config.mentionUserId) {
      content = `<@${deps.config.mentionUserId}> ${content}`;
    }

    const parts = deps.splitMessage(content);

    // Send each part with retry for rate limits
    for (const part of parts) {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await channel.send(part);
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err as Error;
          const discordErr = err as { status?: number; retryAfter?: number };
          const isRateLimited = discordErr.status === 429 || discordErr.retryAfter != null;
          if (isRateLimited) {
            const delay = discordErr.retryAfter ?? 1000;
            await new Promise((r) => setTimeout(r, delay));
          } else {
            break; // non-rate-limit error, don't retry
          }
        }
      }
      if (lastError) {
        const discordErr = lastError as Error & { status?: number; retryAfter?: number };
        const isRateLimited = discordErr.status === 429 || discordErr.retryAfter != null;
        if (isRateLimited) {
          await deps.logger.error('api', 'Rate limited by Discord after 3 retries');
          sendJson(res, 429, { success: false, error: 'Rate limited by Discord, retry later' });
        } else {
          await deps.logger.error('api', lastError.message);
          sendJson(res, 500, { success: false, error: lastError.message });
        }
        return;
      }
    }

    sendJson(res, 200, { success: true, channelId: record.channel_id });
  }

  return function handler(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url || '';

    if (url === '/api/health') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { success: false, error: 'Method not allowed' });
        return;
      }
      const ready = client.isReady();
      sendJson(res, ready ? 200 : 503, {
        success: ready,
        status: ready ? 'ok' : 'not_ready',
        uptime: process.uptime(),
      });
      return;
    }

    if (url === '/api/send') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'Method not allowed' });
        return;
      }
      handleSend(req, res).catch(async (err) => {
        const msg = (err as Error).message || 'Internal server error';
        await deps.logger.error('server/unhandled', msg);
        sendJson(res, 500, { success: false, error: msg });
      });
      return;
    }

    sendJson(res, 404, { success: false, error: 'Not found' });
  };
}

export function startServer(client: Client): http.Server {
  // Lazy imports to avoid pulling in native deps at module scope (testability)
  const { channelDb } = require('./db') as typeof import('./db');
  const { maestro } = require('./services/maestro') as typeof import('./services/maestro');
  const { splitMessage } = require('./utils/splitMessage') as typeof import('./utils/splitMessage');
  const { config } = require('./config') as typeof import('./config');
  const { logger } = require('./services/logger') as typeof import('./services/logger');

  const handler = createServerHandler(client, {
    channelDb,
    maestro,
    splitMessage,
    config,
    logger,
  });

  const server = http.createServer(handler);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`API server failed to start: port ${config.apiPort} is already in use`);
    } else {
      console.error('API server error:', err.message);
    }
    process.exit(1);
  });

  server.listen(config.apiPort, '127.0.0.1', () => {
    console.log(`API server listening on http://127.0.0.1:${config.apiPort}`);
  });

  return server;
}
