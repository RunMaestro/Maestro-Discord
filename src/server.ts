import http from 'http';
import { Client, ChannelType, TextChannel } from 'discord.js';
import { config } from './config';
import { channelDb } from './db';
import { maestro } from './services/maestro';
import { splitMessage } from './utils/splitMessage';
import { logger } from './services/logger';

interface SendRequest {
  agentId: string;
  message: string;
  mention?: boolean;
}

const MAX_BODY_SIZE = 1_048_576; // 1 MB

function parseBody(req: http.IncomingMessage): Promise<SendRequest> {
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

async function findOrCreateChannel(client: Client, agentId: string) {
  const existing = channelDb.getByAgentId(agentId);
  if (existing) return existing;

  const agents = await maestro.listAgents();
  const agent = agents.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  const guild = await client.guilds.fetch(config.guildId);

  // Find or create "Maestro Agents" category
  let category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === 'Maestro Agents'
  );
  if (!category) {
    category = await guild.channels.create({
      name: 'Maestro Agents',
      type: ChannelType.GuildCategory,
    });
  }

  const channelName = `agent-${agent.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  const channel = (await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Maestro agent: ${agent.name} (${agent.id}) | ${agent.toolType} | ${agent.cwd}`,
  })) as TextChannel;

  channelDb.register(channel.id, guild.id, agent.id, agent.name);

  return channelDb.getByAgentId(agentId)!;
}

function sendJson(res: http.ServerResponse, status: number, data: object) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleSend(client: Client, req: http.IncomingMessage, res: http.ServerResponse) {
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
    sendJson(res, 400, { success: false, error: (err as Error).message });
    return;
  }

  // Validate required fields
  if (!body.agentId || typeof body.agentId !== 'string' || !body.message || typeof body.message !== 'string') {
    sendJson(res, 400, { success: false, error: 'agentId and message are required non-empty strings' });
    return;
  }

  // Find or create channel
  let record;
  try {
    record = await findOrCreateChannel(client, body.agentId);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith('Agent not found:')) {
      sendJson(res, 404, { success: false, error: msg });
    } else {
      await logger.error('server/findOrCreateChannel', msg);
      sendJson(res, 500, { success: false, error: msg });
    }
    return;
  }

  // Fetch Discord channel
  let channel: TextChannel;
  try {
    const fetched = await client.channels.fetch(record.channel_id);
    channel = fetched as TextChannel;
  } catch (err) {
    const msg = `Failed to fetch channel ${record.channel_id}: ${(err as Error).message}`;
    await logger.error('server/fetchChannel', msg);
    sendJson(res, 500, { success: false, error: msg });
    return;
  }

  // Build message content
  let content = body.message;
  if (body.mention) {
    const members = channel.members.filter((m) => !m.user.bot);
    if (members.size > 0) {
      const mentions = members.map((m) => m.toString()).join(' ');
      content = `${mentions} ${content}`;
    }
  }

  const parts = splitMessage(content);

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
        const retryAfter = (err as { retryAfter?: number }).retryAfter;
        if (retryAfter) {
          await new Promise((r) => setTimeout(r, retryAfter));
        } else {
          break; // non-rate-limit error, don't retry
        }
      }
    }
    if (lastError) {
      await logger.error('server/send', lastError.message);
      sendJson(res, 429, { success: false, error: lastError.message });
      return;
    }
  }

  sendJson(res, 200, { success: true, channelId: record.channel_id });
}

export function startServer(client: Client): http.Server {
  const server = http.createServer((req, res) => {
    const url = req.url || '';

    if (url === '/api/send') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'Method not allowed' });
        return;
      }
      handleSend(client, req, res).catch(async (err) => {
        const msg = (err as Error).message || 'Internal server error';
        await logger.error('server/unhandled', msg);
        sendJson(res, 500, { success: false, error: msg });
      });
      return;
    }

    sendJson(res, 404, { success: false, error: 'Not found' });
  });

  server.listen(config.apiPort, '127.0.0.1', () => {
    console.log(`API server listening on http://127.0.0.1:${config.apiPort}`);
  });

  return server;
}
